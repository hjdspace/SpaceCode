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
import {
  PLAN_MODE_ENTER_COMMAND,
  PLAN_MODE_EXIT_COMMAND,
  resolvePlanModeExtensionPath,
} from './piPlanModeExtension'
import { resolveSubagentsExtensionPath } from './piSubagentsExtension'
import { findAgentDefinition } from './agentDefinitions'

/** pi RPC `prompt` 帧里的 ImageContent：扁平形状，与 Anthropic 的嵌套 source 不同 */
interface PiImageContent {
  type: 'image'
  data: string
  mimeType: string
}

/**
 * 扩展报自己模式时用的 statusKey。它在 session_start（含恢复）与各次切换上都会发
 * 一帧 setStatus —— 这是宿主唯一能拿到的回执，界面敢不敢说「计划模式已生效」就凭它 (#45)。
 */
const PLAN_MODE_STATUS_KEY = 'plan-mode'

/**
 * `formatStatus` 的六种取值里只有这两种落在 `state.enabled === true` 下。「带 statusText」
 * 不等于在 plan：计划存好或正在实现时报 plan saved / plan implementing，那时写权限是放开的。
 * 把那种文本当成「在 plan」等于在实现阶段不设闸 (#45)。
 */
const PLAN_MODE_ACTIVE_TEXTS = new Set(['plan active', 'plan ready'])
const PLAN_MODE_INACTIVE_TEXTS = new Set(['plan saved', 'plan implementing'])

/** 认不出的文本算「无从核验」(null)：既不声称生效，也不替引擎编一个状态。 */
function planModeStateOfStatus(text: unknown): boolean | null {
  if (typeof text !== 'string' || text.trim() === '') return false
  if (PLAN_MODE_ACTIVE_TEXTS.has(text)) return true
  return PLAN_MODE_INACTIVE_TEXTS.has(text) ? false : null
}

/**
 * RPC 里会 await 宿主的四类对话框 (docs/rpc-extension-ui.md)。它们不带 toolCallId，
 * 现有权限卡片没有可挂靠的时间线条目，所以宿主一律回 cancelled：扩展侧拿到
 * undefined/false，等价于「没批准」，会话不会挂死 (#45)。
 */
const EXTENSION_DIALOG_METHODS = new Set(['select', 'confirm', 'input', 'editor'])

/** pi 发来的扩展 UI 帧：type/id/method 恒有，其余按 method 变化 */
interface PiExtensionUiRequest {
  type: 'extension_ui_request'
  id?: string
  method?: string
  title?: string
  statusKey?: string
  statusText?: string
}

/** 等扩展回执的默认时限：实测回执在 ack 之前就到了，这里只兜「扩展没起来」 */
const PLAN_MODE_RECEIPT_TIMEOUT_MS = 5_000

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
   * 这次 spawn 有没有把 plan 模式扩展带上（`--extension` 真的拼进了命令行）。
   * 没带上就没有闸，也没有回执 —— 与「带上了但回执没到」是两件事，分开记才看得出是
   * 装不上还是没生效 (#45)。
   */
  planModeExtensionLoaded = false

  /**
   * 扩展回执的 plan 状态。null = 还没收到过回执，既不能说生效也不能说没生效；
   * 界面上的模式徽章在 null/false 而意图是 plan 时都不得声称只读已生效。
   */
  planModeActive: boolean | null = null

  /**
   * 所选 agent 有没有真的落到这次 spawn 上：null = 本会话没选 agent（不适用），
   * true = 定义正文已作为 `--append-system-prompt` 交给进程，false = 选了但落不上。
   * 界面在 false/null 而意图是某个 agent 时不得声称「正以该 agent 运行」 (#46)。
   */
  agentApplied: boolean | null = null

  /**
   * 这次 spawn 有没有带上子代理扩展。它管「能不能委派」，与 agentApplied 管的
   * 「本会话是谁」是两件事：扩展装不上时人设照样生效，只是不会委派。
   */
  subagentsExtensionLoaded = false

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
    // 每次 spawn 重新算：上一次进程收到的回执不能替这一次说话（挂起→恢复走的就是这里）
    this.planModeActive = null

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
   * 进出 plan 模式。扩展没有启动旗子（README: "There is no startup flag."），只能发它的
   * `/plan` 子命令；命令帧由 pi 直接执行，不进模型也不写历史。
   *
   * ack 只说明「命令被接住了」，模式到底生效没有得看扩展发的 setStatus 回执 —— 切换要求
   * 跑在空档，正跑着的时候 ack 照样是 handled 而回执不会来。等不到就返回 false，
   * 由调用方 fail closed，不能拿 ack 当生效 (#45)。
   */
  async setPlanMode(active: boolean): Promise<boolean> {
    const proc = this._process
    if (!proc || this.status === 'exited') {
      throw new Error(`Pi session ${this.sessionId.slice(0, 8)} has no running process to apply plan mode`)
    }
    if (!this.planModeExtensionLoaded) {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Plan mode requested on a process without the extension | active=${active}`)
      return false
    }

    const message = active ? PLAN_MODE_ENTER_COMMAND : PLAN_MODE_EXIT_COMMAND
    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Switching plan mode | command=${message}`)
    await this.rpcRequest(proc, { type: 'prompt', message, streamingBehavior: 'followUp' }, 30_000, `Timeout waiting for ${message}`)

    const applied = await this.waitForPlanModeReceipt(active)
    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Plan mode receipt | requested=${active} | applied=${applied}`)
    return applied
  }

  /** 等扩展把模式改成期望值；进程退出或超时都算没生效。 */
  private waitForPlanModeReceipt(expected: boolean): Promise<boolean> {
    if (this.planModeActive === expected) return Promise.resolve(true)

    return new Promise((resolve) => {
      const finish = (value: boolean) => {
        clearTimeout(timer)
        this.off('planModeState', onState)
        this.off('exit', onExit)
        resolve(value)
      }
      const onState = (state: boolean | null) => {
        if (state === expected) finish(true)
      }
      const onExit = () => finish(false)
      const timer = setTimeout(() => finish(false), PLAN_MODE_RECEIPT_TIMEOUT_MS)

      this.on('planModeState', onState)
      this.on('exit', onExit)
    })
  }

  /**
   * pi RPC 的对话框方法会 await 宿主回帧（docs/rpc-extension-ui.md）。宿主不回，扩展侧的
   * `await` 就永远不返回，整条会话停在那儿 —— 以前这里只 emit 不回，正是 #45 里最坏的
   * 那种失效形态。四类对话框一律回 cancelled：扩展拿到 undefined/false，等价于「没批准」，
   * 语义上仍是 fail-closed。
   */
  private declineExtensionDialog(event: PiExtensionUiRequest): void {
    if (!event.method || !EXTENSION_DIALOG_METHODS.has(event.method)) return
    if (typeof event.id !== 'string' || !event.id) {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Extension dialog request without an id | method=${event.method}`)
      return
    }

    this._process?.stdin?.write(JSON.stringify({ type: 'extension_ui_response', id: event.id, cancelled: true }) + '\n')
    warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Extension dialog cancelled by host | method=${event.method} | title=${String(event.title ?? '(none)').split('\n')[0].slice(0, 120)}`)
  }

  /**
   * 扩展用 setStatus('plan-mode') 报它自己的模式，取值见 PLAN_MODE_ACTIVE_TEXTS。
   * session_start（含挂起后恢复）也会发一帧，所以这一路同时覆盖「重启后接上的状态」。
   */
  private trackPlanModeReceipt(event: PiExtensionUiRequest): void {
    if (event.method !== 'setStatus' || event.statusKey !== PLAN_MODE_STATUS_KEY) return

    const active = planModeStateOfStatus(event.statusText)
    if (active === this.planModeActive) return

    this.planModeActive = active
    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Plan mode receipt | active=${active ?? '(unrecognized)'} | text=${event.statusText ?? '(cleared)'}`)
    this.emit('planModeState', active)
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
      this.trackPlanModeReceipt(event)
      this.declineExtensionDialog(event)
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

    // plan 的只读语义全靠这个扩展（来路与口径见 piPlanModeExtension）：起进程时不带它，
    // 就等于「界面显示计划模式、工具照写不误」 (#45)。
    this.planModeExtensionLoaded = false
    if (this.config.permissionMode === 'plan') {
      const extensionPath = resolvePlanModeExtensionPath()
      if (extensionPath) {
        args.push('--extension', extensionPath)
        this.planModeExtensionLoaded = true
      } else {
        warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Plan mode extension not loadable | plan cannot be enforced for this process`)
      }
    }

    this.applySelectedAgent(args)

    return args
  }

  /**
   * 把界面所选的 agent 真的落到这条会话上 (issue #46)。
   *
   * pi 没有 `--agent` 旗子（1.3.0 的 dist/cli/args.js 里根本没有），也没有能设主线程人设的
   * RPC 命令。而 Claude 那条 `--agent` 本身就是把定义正文当成主线程的 system prompt
   * （engine/src/main.tsx:2586 `systemPrompt = agentSystemPrompt`）—— 所以这里把同一段正文
   * 交给 `--append-system-prompt` 才是同构做法：pi 自己的工具说明留在 preamble，persona 作为
   * addendum 叠上去，两边都是「本会话以此 agent 运行」。
   *
   * 传的是文件路径而不是正文：pi 的 resolvePromptInput 认在盘的路径（并把它记进
   * appendSystemPromptSourcePaths），于是长人设不会撞上 Windows 的命令行长度上限，
   * 上游请求里出现的也正是这段正文 —— 探针测试就是照这个断言的。
   *
   * 同时带上子代理扩展：它让 `.pi/agents` 里的定义在 pi 侧成为一等公民并给出委派能力
   * （来路与口径见 piSubagentsExtension）。只在选了 agent 时带，跟 #45 一样按意图加载。
   */
  private applySelectedAgent(args: string[]): void {
    this.agentApplied = this.config.agent ? false : null
    this.subagentsExtensionLoaded = false
    const agent = this.config.agent
    if (!agent) return

    const extensionPath = resolveSubagentsExtensionPath()
    if (extensionPath) {
      args.push('--extension', extensionPath)
      this.subagentsExtensionLoaded = true
    } else {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Subagents extension not loadable | ${agent} cannot delegate for this process`)
    }

    const definition = findAgentDefinition(agent, { kinds: ['claude', 'pi'], cwd: this.config.cwd })
    if (!definition) {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Selected agent has no definition on disk | agent=${agent}`)
      return
    }
    if (!definition.body) {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Selected agent definition is empty | agent=${agent}`)
      return
    }

    const promptDir = path.join(os.tmpdir(), 'SpaceCode')
    const promptPath = path.join(promptDir, `pi-agent-${this.sessionId}.md`)
    try {
      fs.mkdirSync(promptDir, { recursive: true })
      // 按 sessionId 固定文件名：同一会话重启时覆盖，而不是往临时目录里越堆越多
      fs.writeFileSync(promptPath, definition.body, 'utf8')
    } catch (err) {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to write agent persona file | path=${promptPath}`, err)
      return
    }

    args.push('--append-system-prompt', promptPath)
    this.agentApplied = true
    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Agent persona attached | agent=${agent} | source=${definition.source} | bodyLen=${definition.body.length} | file=${promptPath}`)
  }
}
