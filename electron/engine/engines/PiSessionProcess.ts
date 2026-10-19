import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'
import type { ProcessStatus } from '../../session/sessionProcess'
import type { EngineSessionConfig, ImageAttachment } from './types'
import { toPiThinkingLevel } from '@/shared/effort'
import { info, warn, error, debug } from '../../infra/logger'
import {
  killTree as engineKillTree,
  isProbableBunExecutable as engineIsProbableBunExecutable,
} from '../../session/engineChildProcess'
import { toBase64ImagePayload } from '../../session/imageContentBlock'
import { detectPiCli, MIN_PI_VERSION } from './piCliResolver'

/** pi RPC `prompt` 帧里的 ImageContent：扁平形状，与 Anthropic 的嵌套 source 不同 */
interface PiImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export class PiSessionProcess extends EventEmitter {
  readonly sessionId: string
  status: ProcessStatus = 'starting'
  config: EngineSessionConfig

  private _process: ChildProcess | null = null
  private _pendingToolCalls: Set<string> = new Set()
  private _isProcessing: boolean = false
  lastActivityAt: number = Date.now()
  private _stdoutDecoder: StringDecoder = new StringDecoder('utf8')
  private _stdoutBuffer: string = ''
  private _stderrBuffer: string = ''
  private readonly _maxStderrBytes = 8 * 1024

  // RPC request tracking
  private _requestId: number = 0
  private _pendingRequests: Map<string, { resolve: (response: any) => void; reject: (error: Error) => void }> = new Map()

  /** pi 自己生成的会话文件名：构造时由池注入以接上历史，运行中由 get_state 补记 */
  private _piSessionFile: string | null

  /**
   * 实际 spawn 的那个 pi 的版本，以及它是否满足宿主的能力下限。null = 还没解析过，
   * 或无从核验 —— 界面对 null/false 都不能声称能力可用 (#52)。
   */
  engineVersion: string | null = null
  engineVersionCompatible: boolean | null = null

  /**
   * @param resumeSessionFile 由池按历史记录注入的 pi 会话文件；不传则起一个空白会话。
   *   走构造参数而不是 config —— config 要跨 IPC，这个路径只该由主进程决定。
   */
  constructor(sessionId: string, config: EngineSessionConfig, resumeSessionFile?: string) {
    super()
    this.sessionId = sessionId
    this.config = config
    this._piSessionFile = resumeSessionFile ?? null
    debug('PiSessionProcess', `Constructed | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}${resumeSessionFile ? ` | resume=${resumeSessionFile}` : ''}`)
  }

  async start(): Promise<void> {
    this.status = 'starting'

    try {
      const cliPath = this.resolveCliPath()
      const baseArgs = this.buildArgs()
      const env = { ...process.env, ...this.buildEnv() }

      // Determine spawn command based on what resolveCliPath returned
      let command: string
      let spawnArgs: string[]
      let launcherEnv: Record<string, string> | undefined

      if (cliPath === 'pi') {
        // Global `pi` CLI command — it brings its own runtime
        command = 'pi'
        spawnArgs = ['--mode', 'rpc', ...baseArgs]
      } else {
        // Direct path to cli.js — prefer ELECTRON_RUN_AS_NODE over bun.
        // Bun may buffer stdout in chunk mode, causing streaming events to be delayed
        // until the buffer fills or the process exits. Node.js (ELECTRON_RUN_AS_NODE)
        // flushes stdout on each \n, which is required for real-time RPC events.
        command = process.execPath
        spawnArgs = [cliPath, '--mode', 'rpc', ...baseArgs]
        launcherEnv = { ELECTRON_RUN_AS_NODE: '1' }
        info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Using ELECTRON_RUN_AS_NODE | execPath=${process.execPath} | entry=${cliPath}`)
      }

      const spawnEnv = launcherEnv ? { ...env, ...launcherEnv } : env

      info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Starting Pi RPC process | command=${command} | args=${spawnArgs.join(' ')} | envKeys=${launcherEnv ? Object.keys(launcherEnv).join(',') : '(none)'}`)

      this._process = spawn(command, spawnArgs, {
        cwd: this.config.cwd,
        env: spawnEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      this._process.stdout?.on('data', (data: Buffer | string) => {
        this._stdoutBuffer += typeof data === 'string' ? data : this._stdoutDecoder.write(data)

        while (true) {
          const newlineIndex = this._stdoutBuffer.indexOf('\n')
          if (newlineIndex === -1) break

          const line = this._stdoutBuffer.slice(0, newlineIndex)
          this._stdoutBuffer = this._stdoutBuffer.slice(newlineIndex + 1)

          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            this.handleAgentEvent(event)
          } catch {
            debug('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] stdout: ${line}`)
          }
        }
      })

      this._process.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString()
        // Keep a bounded tail of stderr so we can surface it if the process dies
        this._stderrBuffer = (this._stderrBuffer + chunk).slice(-this._maxStderrBytes)
        for (const line of chunk.split(/\r?\n/)) {
          const trimmed = line.trim()
          if (!trimmed) continue
          warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] stderr: ${trimmed}`)
        }
      })

      this._process.on('exit', (code, signal) => {
        info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Process exited with code ${code}${signal ? ` | signal=${signal}` : ''}`)
        this.status = 'exited'
        this._isProcessing = false

        // Reject any pending RPC requests so callers fail fast instead of waiting for timeout
        if (this._pendingRequests.size > 0) {
          const stderrTail = this._stderrBuffer.trim()
          const baseMessage = `Pi RPC process exited with code ${code ?? 'null'}${signal ? ` (signal ${signal})` : ''}`
          const message = stderrTail
            ? `${baseMessage}: ${stderrTail.split(/\r?\n/).slice(-5).join(' | ')}`
            : baseMessage
          for (const pending of this._pendingRequests.values()) {
            try { pending.reject(new Error(message)) } catch {}
          }
          this._pendingRequests.clear()
        }

        this.emit('exit', code, signal, this._stderrBuffer.trim())
      })

      this._process.on('error', (err) => {
        error('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Process error`, err)
        this.status = 'exited'
        this.emit('error', err)
      })

      // Wait a moment for process to start
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (this._process && !this._process.killed) {
            resolve()
          } else {
            reject(new Error('Process failed to start'))
          }
        }, 500)

        this._process?.on('error', (err) => {
          clearTimeout(timeout)
          reject(err)
        })

        this._process?.on('exit', (code, signal) => {
          clearTimeout(timeout)
          const stderrTail = this._stderrBuffer.trim()
          const baseMessage = `Process exited early with code ${code}${signal ? ` (signal ${signal})` : ''}`
          const message = stderrTail
            ? `${baseMessage}: ${stderrTail.split(/\r?\n/).slice(-5).join(' | ')}`
            : baseMessage
          reject(new Error(message))
        })
      })

      this.status = 'idle'
      this.lastActivityAt = Date.now()
      info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] RPC process started successfully`)
    } catch (err) {
      this.status = 'exited'
      error('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to start RPC process`, err)
      this.emit('error', err)
      throw err
    }
  }

  async sendMessage(content: string, images?: ImageAttachment[]): Promise<void> {
    if (!this._process || this.status === 'exited') {
      throw new Error(`Session ${this.sessionId} has no active process`)
    }

    this.status = 'active'
    this._isProcessing = true
    this.lastActivityAt = Date.now()

    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Sending prompt | contentLen=${content.length} | images=${images?.length || 0}`)

    // 图片按 pi 的 ImageContent 内联进 prompt 帧。走 `@"路径"` → Read 那条链时，
    // 非 Anthropic 网关会把 Read 结果里的 image block 整块丢掉，模型只拿到路径拿不到像素。
    const inlineImages: PiImageContent[] = []
    let imageRefs = ''
    if (images && images.length > 0) {
      let uploadDir: string | null = null
      for (const img of images) {
        const payload = toBase64ImagePayload(img)
        if (payload) {
          inlineImages.push({ type: 'image', data: payload.data, mimeType: payload.mediaType })
          continue
        }
        // 内联不了的类型（BMP/SVG/HEIC 等）退回文件路径引用，至少维持原有的可见性
        try {
          uploadDir ??= this.getUploadDir()
          const savedPath = this.saveImageToTemp(img, uploadDir)
          imageRefs += `@"${savedPath}" `
        } catch (err) {
          error('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to save image: ${img.name}`, err)
        }
      }
    }

    // 构建最终消息内容，添加 @-引用前缀
    let finalContent = content
    if (imageRefs) {
      finalContent = `${imageRefs}${content || 'Please analyze the attached images.'}`.trim()
    }
    if (inlineImages.length > 0 && !finalContent) {
      finalContent = 'Please analyze the attached images.'
    }

    try {
      const response = await this.rpcRequest(
        this._process,
        {
          type: 'prompt',
          message: finalContent,
          // Pi 在 run 进行中收到不带该字段的 prompt 帧会直接抛
          // "Agent is already processing..."，这条消息就被引擎丢掉了 —— 而宿主此时
          // 往往已经因为一次 429 结算了 turn，两边对「引擎是否在跑」的判断并不一致。
          // followUp 让引擎排到当前 run 之后再执行；引擎空闲时该字段被忽略。
          streamingBehavior: 'followUp',
          ...(inlineImages.length > 0 ? { images: inlineImages } : {}),
        },
        30000,
        'Timeout waiting for prompt response',
      )

      if (!response.success) {
        this.status = 'idle'
        this._isProcessing = false
        throw new Error(response.error || 'Prompt failed')
      }
      
      info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Prompt accepted`)
    } catch (err) {
      this.status = 'idle'
      this._isProcessing = false
      error('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Prompt failed`, err)
      throw err
    }
  }

  private getUploadDir(): string {
    const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
    const uploadDir = path.join(configDir, 'uploads', this.sessionId)
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    return uploadDir
  }

  private saveImageToTemp(img: ImageAttachment, uploadDir: string): string {
    const matches = img.data.match(/^data:([^;]+);base64,(.+)$/)
    if (!matches) {
      throw new Error('Invalid image data format')
    }
    
    const mimeType = matches[1]
    const base64Data = matches[2]
    
    const ext = this.getExtensionFromMimeType(mimeType) || 'png'
    const fileName = `${randomUUID()}-${img.name.replace(/[^a-zA-Z0-9.-]/g, '_')}.${ext}`
    const filePath = path.join(uploadDir, fileName)
    
    const buffer = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(filePath, buffer)
    
    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Image saved | name=${img.name} | path=${filePath}`)
    return filePath
  }

  private getExtensionFromMimeType(mimeType: string): string | null {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/bmp': 'bmp',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    }
    return mimeToExt[mimeType] || null
  }

  async abort(): Promise<void> {
    if (!this._process) return

    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Aborting current operation`)
    try {
      // 等 ack 而不是写完就算停：pi 的 session.abort() 内部 await waitForIdle()，
      // acked 才代表这一轮真的一次性收尾了。自动重试靠它在重发前串行，
      // 否则重发会撞上还在拆解的 run。超时与进程退出只告警，维持尽力而为的语义。
      await this.rpcRequest(this._process, { type: 'abort' }, 10_000, 'Timeout waiting for abort response')
    } catch (err) {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Abort failed`, err)
    }
  }

  async setThinkingLevel(level: string): Promise<void> {
    if (!this._process) {
      // 子进程已经没了：这条设置谁都收不到。静默 return 会让上层以为"已下发"，
      // 界面就停在一个从没生效的开关上。
      throw new Error(`Pi session ${this.sessionId.slice(0, 8)} has no running process to apply thinking level`)
    }

    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Setting thinking level | level=${level}`)
    try {
      const message = JSON.stringify({ type: 'set_thinking_level', level }) + '\n'
      this._process.stdin?.write(message)
    } catch (err) {
      // 写不进去就是没生效，别降级成 warn 冒充成功。
      throw new Error(`Failed to write set_thinking_level to pi: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * 写一帧 RPC 并按 id 等它的 response。进程在等待期间退出时由 exit 处理器统一 reject。
   */
  private rpcRequest(
    proc: ChildProcess,
    command: Record<string, unknown>,
    timeoutMs: number,
    timeoutMessage: string,
  ): Promise<any> {
    const id = `req_${++this._requestId}`
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(id)
        reject(new Error(timeoutMessage))
      }, timeoutMs)

      this._pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timer)
          resolve(response)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })

      proc.stdin?.write(JSON.stringify({ id, ...command }) + '\n')
    })
  }

  /**
   * 向在飞的进程要一次 get_state 并记下它的会话文件。
   * 拿不到不影响本轮，只是恢复时退回到「新会话」——不阻塞挂起。
   *
   * 超时由调用方定：挂起路径要快，进程刚起来那次的探测可以等久一些 ——
   * pi 装载扩展与模型表可能就要十几秒，这一趟问早了只会白问。
   */
  async captureSessionFile(timeoutMs = 3000): Promise<void> {
    if (!this._process) return
    try {
      const response = await this.rpcRequest(this._process, { type: 'get_state' }, timeoutMs, 'Timeout waiting for session state')
      const sessionFile = response?.data?.sessionFile
      if (response?.success && typeof sessionFile === 'string' && sessionFile) {
        this._piSessionFile = sessionFile
        info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Recorded Pi session file | ${sessionFile}`)
      } else {
        warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] get_state returned no sessionFile | success=${response?.success}`)
      }
    } catch (err) {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to capture Pi session file`, err)
    }
  }

  getPiSessionFile(): string | null {
    return this._piSessionFile
  }

  async suspend(): Promise<void> {
    if (!this._process) return

    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Suspending | pendingTools=${this._pendingToolCalls.size}`)

    // 状态先行置位：suspend 在池里是 fire-and-forget，多等一次 get_state 期间
    // 不能让别人把这条会话当成还在跑的进程复用掉。
    this.status = 'suspended'
    const proc = this._process
    await this.captureSessionFile()
    proc.stdin?.end()
    this._process = null
  }

  async resume(): Promise<void> {
    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Resuming session`)
    await this.start()
  }

  async kill(): Promise<void> {
    if (this._process) {
      engineKillTree(this._process, `PiSessionProcess[${this.sessionId.slice(0, 8)}]`)
      this._process = null
    }
    this.status = 'exited'
    this._isProcessing = false
    this._pendingToolCalls.clear()
  }

  canSafelySuspend(): boolean {
    return this._pendingToolCalls.size === 0 && !this._isProcessing
  }

  getPendingToolCount(): number {
    return this._pendingToolCalls.size
  }

  isRunning(): boolean {
    return this._process !== null && this.status !== 'exited' && this.status !== 'suspended'
  }

  private handleAgentEvent(event: any): void {
    this.lastActivityAt = Date.now()

    // Check if this is a response to a pending request
    if (event.type === 'response' && event.id && this._pendingRequests.has(event.id)) {
      const pending = this._pendingRequests.get(event.id)!
      this._pendingRequests.delete(event.id)
      pending.resolve(event)
      debug('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] RPC response | command=${event.command} | success=${event.success}`)
      return
    }

    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Agent event | type=${event.type}${event.assistantMessageEvent ? ` | subType=${event.assistantMessageEvent.type}` : ''}${event.message ? ` | msgRole=${event.message.role} | msgContentLen=${Array.isArray(event.message.content) ? event.message.content.length : typeof event.message.content === 'string' ? event.message.content.length : -1}` : ''}`)

    if (event.type === 'response') {
      debug('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] RPC response | command=${event.command} | success=${event.success}`)
      return
    }

    if (event.type === 'extension_ui_request') {
      debug('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Extension UI request | method=${event.method}`)
      this.emit('message', event)
      return
    }

    if (event.type === 'agent_end') {
      this.status = 'idle'
      this._isProcessing = false
    } else if (event.type === 'agent_start') {
      this.status = 'active'
      this._isProcessing = true
    }

    if (event.type === 'tool_execution_start') {
      this._pendingToolCalls.add(event.toolCallId)
    } else if (event.type === 'tool_execution_end') {
      this._pendingToolCalls.delete(event.toolCallId)
    }

    this.emit('message', event)
  }

  /**
   * 解析这次真正该 spawn 哪个 pi，并把它的版本记到会话上。
   *
   * 不可用就直接抛：宁可会话起不来，也不能让「界面说可用、进程其实是另一个引擎」跑下去。
   * 候选序列与版本判定都收在 piCliResolver —— PiEngine 的可用性走同一个函数，两边不可能再
   * 各算一套 (issue #52)。
   */
  private resolveCliPath(): string {
    const cli = detectPiCli()
    this.engineVersion = cli.version
    this.engineVersionCompatible = cli.available

    if (!cli.entry || !cli.available) {
      const detail = cli.reason === 'version-too-old'
        ? `pi ${cli.version} is below the required ${MIN_PI_VERSION}`
        : cli.reason === 'version-unknown'
          ? 'the pi version could not be verified'
          : app.isPackaged
            ? 'the bundled pi shipped with this build is missing'
            : 'no pi CLI found'
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Pi unavailable | reason=${cli.reason} | ${detail}`)
      throw new Error(`Pi engine is not usable: ${detail}`)
    }

    return cli.entry
  }

  /**
   * Resolve the path to a usable bun binary for running the Pi CLI.
   * Checks: bundled bun in engine/bin → platform-specific bundled bun → global bun.
   * Returns null if no usable bun is found (caller should fall back to ELECTRON_RUN_AS_NODE).
   */
  private resolveBunPath(): string | null {
    const platform = process.platform
    const arch = process.arch

    // 1. Bundled bun in engine/bin (same location as Claude Code engine)
    const bunName = platform === 'win32' ? 'bun.exe' : 'bun'
    const resourcesDir = process.resourcesPath || ''
    const bundledBun = path.join(resourcesDir, 'engine', 'bin', bunName)
    if (this.isProbableBunExecutable(bundledBun)) {
      return bundledBun
    }

    // 2. Platform-specific bundled bun
    const platformSuffix = platform === 'win32' ? 'windows-x64'
      : platform === 'darwin' ? (arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
      : 'linux-x64'
    const platformSpecificBun = path.join(resourcesDir, 'engine', 'bin', `bun-${platformSuffix}`)
    if (this.isProbableBunExecutable(platformSpecificBun)) {
      return platformSpecificBun
    }
    if (platform === 'win32') {
      const exe = `${platformSpecificBun}.exe`
      if (this.isProbableBunExecutable(exe)) {
        return exe
      }
    }

    // 3. Dev mode: check relative to __dirname
    const devBun = path.resolve(__dirname, '../../engine/bin', bunName)
    if (this.isProbableBunExecutable(devBun)) {
      return devBun
    }

    // 4. Global bun
    try {
      const { execSync } = require('child_process')
      const cmd = platform === 'win32' ? 'where bun' : 'which bun'
      const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim()
      const globalBun = output.split(/\r?\n/)[0]?.trim()
      if (globalBun && this.isProbableBunExecutable(globalBun)) {
        return globalBun
      }
    } catch {
      // bun not available globally
    }

    return null
  }

  /**
   * Check if a file exists and looks like a real bun executable (not a placeholder or LFS pointer).
   * Delegates to EngineChildProcess.isProbableBunExecutable for the shared implementation.
   */
  private isProbableBunExecutable(absPath: string): boolean {
    return engineIsProbableBunExecutable(absPath)
  }

  /**
   * Map well-known OpenAI-compatible base URLs to their canonical pi-ai provider id.
   * SpaceCode's UI commonly sets `provider=openai` together with a custom baseUrl when
   * the user is actually talking to OpenRouter / DeepSeek / Groq / etc. The pi CLI
   * resolves models by provider name, so we need to map the baseUrl back to the
   * provider that pi-ai knows about.
   *
   * Returns undefined when the baseUrl is not a recognized alternate backend so the
   * caller can keep the original provider value.
   */
  private detectProviderFromBaseUrl(baseUrl: string | undefined): string | undefined {
    if (!baseUrl) return undefined
    const lower = baseUrl.toLowerCase()
    const table: Array<[RegExp, string]> = [
      [/openrouter\.ai/, 'openrouter'],
      [/api\.deepseek\.com/, 'deepseek'],
      [/api\.groq\.com/, 'groq'],
      [/api\.x\.ai/, 'xai'],
      [/api\.cerebras\.ai/, 'cerebras'],
      [/api\.moonshot\.ai/, 'moonshotai'],
      [/api\.moonshot\.cn/, 'moonshotai-cn'],
      [/api\.minimax\.io/, 'minimax'],
      [/api\.minimaxi\.com/, 'minimax-cn'],
      [/api\.mistral\.ai/, 'mistral'],
      [/ai-gateway\.vercel\.sh/, 'vercel-ai-gateway'],
      [/api\.fireworks\.ai/, 'fireworks'],
      [/api\.z\.ai/, 'zai'],
      [/generativelanguage\.googleapis\.com/, 'google'],
      [/api\.anthropic\.com/, 'anthropic'],
    ]
    for (const [re, provider] of table) {
      if (re.test(lower)) return provider
    }
    return undefined
  }

  /**
   * Resolve the effective provider we should pass to the pi CLI.
   * Preference order:
   *   1. Provider inferred from baseUrl (handles openai-compatible backends like OpenRouter)
   *   2. Explicitly configured provider
   *   3. undefined (let pi pick a default)
   */
  private resolveEffectiveProvider(): string | undefined {
    const fromBaseUrl = this.detectProviderFromBaseUrl(this.config.baseUrl)
    if (fromBaseUrl) return fromBaseUrl
    const raw = this.config.provider?.toLowerCase().trim()
    if (!raw) return undefined
    return raw
  }

  private buildEnv(): Record<string, string> {
    const env: Record<string, string> = {}
    const provider = this.resolveEffectiveProvider()

    if (this.config.apiKey) {
      if (this.shouldUseCompatProvider()) {
        // The compat provider references "$OPENAI_API_KEY" in models.json, so Pi CLI
        // reads the key from this env var. pi >=0.77 resolves a bare "OPENAI_API_KEY"
        // as a literal instead (only $NAME / ${NAME} are env references now), which
        // would authenticate with the string "OPENAI_API_KEY" and 401.
        env['OPENAI_API_KEY'] = this.config.apiKey
      } else {
        // Populate the env var(s) pi-ai reads for this provider so auth works without
        // requiring the user to pre-configure ~/.pi/agent/auth.json.
        const envKeysByProvider: Record<string, string[]> = {
          openai: ['OPENAI_API_KEY'],
          openrouter: ['OPENROUTER_API_KEY'],
          anthropic: ['ANTHROPIC_API_KEY'],
          google: ['GEMINI_API_KEY'],
          deepseek: ['DEEPSEEK_API_KEY'],
          groq: ['GROQ_API_KEY'],
          xai: ['XAI_API_KEY'],
          cerebras: ['CEREBRAS_API_KEY'],
          moonshotai: ['MOONSHOT_API_KEY'],
          'moonshotai-cn': ['MOONSHOT_API_KEY'],
          minimax: ['MINIMAX_API_KEY'],
          'minimax-cn': ['MINIMAX_API_KEY'],
          mistral: ['MISTRAL_API_KEY'],
          'vercel-ai-gateway': ['AI_GATEWAY_API_KEY'],
          fireworks: ['FIREWORKS_API_KEY'],
          zai: ['ZAI_API_KEY'],
        }
        const keys = (provider && envKeysByProvider[provider]) || ['ANTHROPIC_API_KEY']
        for (const key of keys) {
          env[key] = this.config.apiKey
        }
      }
    }

    // If a custom baseUrl is provided, write it to ~/.pi/agent/models.json
    // so Pi CLI's model registry picks up the custom endpoint.
    // Pi CLI does not read OPENAI_BASE_URL — the baseUrl is baked into the
    // built-in model registry. The only way to override it is via models.json.
    if (this.config.baseUrl && provider) {
      this.writeModelsJsonOverride(provider, this.config.baseUrl)
    }

    return env
  }

  /**
   * Name of the compatibility provider we create in models.json when the user
   * configures a custom baseUrl with the `openai` provider. The built-in
   * `openai` provider defaults to the OpenAI Responses API (`/v1/responses`),
   * but most third-party OpenAI-compatible endpoints only support the Chat
   * Completions API (`/v1/chat/completions`). The compat provider uses
   * `api: "openai-completions"` to route requests correctly.
   */
  private static readonly COMPAT_PROVIDER_NAME = 'openai-compat'

  /**
   * Determine if we should use a compatibility provider instead of the built-in
   * `openai` provider. Returns true when:
   *   - The effective provider is `openai`
   *   - A custom baseUrl is configured
   *   - The baseUrl is NOT the real OpenAI endpoint (api.openai.com)
   *
   * When detectProviderFromBaseUrl() recognizes the baseUrl (e.g. deepseek,
   * openrouter), resolveEffectiveProvider() returns that provider instead of
   * `openai`, so this method returns false — those providers already use
   * `openai-completions` API.
   */
  private shouldUseCompatProvider(): boolean {
    const provider = this.resolveEffectiveProvider()
    if (provider !== 'openai') return false
    if (!this.config.baseUrl) return false
    const lower = this.config.baseUrl.toLowerCase()
    if (lower.includes('api.openai.com')) return false
    return true
  }

  /** 用户没给某个模型配窗口时，沿用 pi 自己在 models.json 里用的默认值。 */
  private static readonly DEFAULT_CONTEXT_WINDOW = 128000

  /**
   * 用户在模型设置里为该模型配的上下文窗口（token 数）。
   *
   * `modelContextWindows` 以实际模型名（如 kimi-k3）为键，chatSession 会按别名再补一份
   * 同值键；pi 的 config.model 是真名，所以先按注册用的 modelId（去掉 provider 前缀）查，
   * 再按原始 config.model 查，都查不到才退回 pi 的默认。
   */
  private resolveContextWindow(modelId: string): number {
    const windows = this.config.modelContextWindows
    if (!windows) return PiSessionProcess.DEFAULT_CONTEXT_WINDOW
    for (const key of [modelId, this.config.model]) {
      const value = key ? windows[key] : undefined
      if (typeof value === 'number' && value > 0) return value
    }
    return PiSessionProcess.DEFAULT_CONTEXT_WINDOW
  }

  /**
   * Write a models.json override so Pi CLI can use custom OpenAI-compatible
   * endpoints.
   *
   * When the effective provider is `openai` with a custom (non-OpenAI) baseUrl,
   * we create a separate `openai-compat` provider entry that uses the
   * `openai-completions` API (`/v1/chat/completions`) instead of the default
   * `openai-responses` API (`/v1/responses`). Most third-party endpoints only
   * support Chat Completions.
   *
   * For other providers, we simply set the baseUrl override.
   */
  private writeModelsJsonOverride(provider: string, baseUrl: string): void {
    try {
      const configDir = path.join(os.homedir(), '.pi', 'agent')
      const modelsJsonPath = path.join(configDir, 'models.json')

      // Read existing models.json if present
      let existing: any = { providers: {} }
      if (fs.existsSync(modelsJsonPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf-8'))
          if (!existing.providers) existing.providers = {}
        } catch {
          existing = { providers: {} }
        }
      }

      if (this.shouldUseCompatProvider()) {
        // Create a custom provider that uses openai-completions API
        // instead of the default openai-responses API
        const compatName = PiSessionProcess.COMPAT_PROVIDER_NAME
        if (!existing.providers[compatName]) {
          existing.providers[compatName] = {}
        }
        const cp = existing.providers[compatName]
        cp.name = 'OpenAI Compatible'
        cp.api = 'openai-completions'
        cp.baseUrl = baseUrl
        cp.apiKey = '$OPENAI_API_KEY'
        cp.compat = {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: 'max_tokens',
          supportsStrictMode: false,
        }

        // Add the model if specified
        if (this.config.model) {
          const modelId = this.config.model.replace(/^openai\//i, '')
          if (!cp.models) cp.models = []
          // Remove existing entry for this model to avoid duplicates
          cp.models = cp.models.filter((m: any) => m.id !== modelId)
          cp.models.push({
            id: modelId,
            name: modelId,
            reasoning: false,
            input: ['text', 'image'],
            contextWindow: this.resolveContextWindow(modelId),
            maxTokens: 16384,
          })
        }

        info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Wrote models.json compat provider | provider=${compatName} | api=openai-completions | baseUrl=${baseUrl} | model=${this.config.model}`)
      } else {
        // Original behavior: just set baseUrl for the provider
        if (!existing.providers[provider]) {
          existing.providers[provider] = {}
        }
        existing.providers[provider].baseUrl = baseUrl
        info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Wrote models.json override | provider=${provider} | baseUrl=${baseUrl}`)
      }

      // Ensure directory exists
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true })
      }

      fs.writeFileSync(modelsJsonPath, JSON.stringify(existing, null, 2), 'utf-8')
    } catch (err) {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to write models.json override`, err)
    }
  }

  private buildArgs(): string[] {
    const args: string[] = []

    // When using the compat provider (openai-compat), pass that as --provider
    // so Pi CLI resolves the model from our custom models.json entry.
    const provider = this.shouldUseCompatProvider()
      ? PiSessionProcess.COMPAT_PROVIDER_NAME
      : this.resolveEffectiveProvider()

    if (provider) {
      args.push('--provider', provider)
    }

    if (this.config.model) {
      // Strip a leading "<provider>/" if the user/UI already embedded it to match
      // the provider we resolved. pi's resolver tolerates this, but stripping it
      // makes the fallback model builder kick in cleanly for unknown custom ids.
      let model = this.config.model
      if (provider) {
        const prefix = `${provider}/`.toLowerCase()
        if (model.toLowerCase().startsWith(prefix)) {
          model = model.slice(prefix.length)
        }
      }
      args.push('--model', model)
    }
    if (this.config.apiKey) args.push('--api-key', this.config.apiKey)
    // 关着就什么都不传（pi 自己按 off 走），保持既有参数形态不变；开着才把档位带上 ——
    // 此前这里写死 medium，用户选的深度根本没进 pi。
    if (this.config.thinkingEnabled === true) {
      args.push('--thinking', toPiThinkingLevel(true, this.config.effortLevel ?? 'medium'))
    }
    // 带上 pi 自己的会话文件，否则新进程起来就是一个没有历史的新会话
    if (this._piSessionFile) args.push('--session', this._piSessionFile)
    if (this.config.systemPrompt) args.push('--system-prompt', this.config.systemPrompt)
    if (this.config.appendSystemPrompt) args.push('--append-system-prompt', this.config.appendSystemPrompt)

    return args
  }
}
