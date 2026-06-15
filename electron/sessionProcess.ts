import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { proxyManager } from './proxyManager'
import { info, warn, error, debug, processRaw, setSessionLogPath, sdkMessage, traceEvent } from './logger'
import {
  ControlProtocolHandler,
  encodeJsonLine,
  type PermissionDecision,
  type PermissionMode,
  type CanUseToolRequest,
  type ElicitationRequest,
} from './controlProtocol'

export interface SessionConfig {
  cwd: string
  model?: string
  provider?: 'anthropic' | 'openai' | 'gemini' | string
  baseUrl?: string
  /** CLI 支持的权限模式: acceptEdits, bypassPermissions, default, dontAsk, plan */
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan'
  /** 推理深度: low, medium, high, max */
  effortLevel?: 'low' | 'medium' | 'high' | 'max'
  systemPrompt?: string
  appendSystemPrompt?: string
  maxTurns?: number
  maxBudgetUsd?: number
  apiKey?: string
  verbose?: boolean
  /** Agent type for the session (e.g. 'general-purpose', 'Explore', 'Plan'). Passed as --agent flag. */
  agent?: string
  /** 允许的工具列表（传给 CLI --allowedTools），空数组或 undefined 表示允许全部 */
  allowedTools?: string[]
  /** 是否启用 thinking 模式 (extended thinking) */
  thinkingEnabled?: boolean
  /** 要恢复的会话 ID，使用 --resume 参数启动 */
  resumeSessionId?: string
  engineSource?: 'bundled' | 'installed'
  installedCliPath?: string
}

export type ProcessStatus = 'starting' | 'active' | 'idle' | 'suspended' | 'exited'

export interface SDKMessage {
  type: string
  [key: string]: any
}

export class SessionProcess extends EventEmitter {
  readonly sessionId: string
  engineSessionId: string | null = null
  process: ChildProcess | null = null
  config: SessionConfig
  status: ProcessStatus = 'starting'
  eventBuffer: SDKMessage[] = []
  lastActivityAt: number = Date.now()
  currentPermissionMode: PermissionMode = 'default'

  // 工具调用状态追踪
  private pendingToolCalls: Set<string> = new Set()
  private isProcessing: boolean = false

  // 控制协议处理器：负责 can_use_tool / control_response / elicitation 等
  private readonly controlProtocol: ControlProtocolHandler

  private cliRoot: string

  constructor(sessionId: string, config: SessionConfig) {
    super()
    this.sessionId = sessionId
    this.config = config
    this.currentPermissionMode = (config.permissionMode as PermissionMode) || 'default'
    const isPackaged = app.isPackaged
    if (isPackaged) {
      this.cliRoot = path.join(process.resourcesPath, 'engine')
    } else {
      this.cliRoot = path.resolve(__dirname, '../engine')
    }
    debug('SessionProcess', `Constructed | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)

    this.controlProtocol = new ControlProtocolHandler((message) => this.writeStdin(message))
    this.controlProtocol.on('sdk_message', (msg: any) => this.handleSDKMessage(msg))
    this.controlProtocol.on('permission_request', (req: CanUseToolRequest) => {
      info(
        'SessionProcess',
        `[${this.sessionId.slice(0, 8)}] control_request: can_use_tool | requestId=${req.requestId.slice(0, 8)} | tool=${req.toolName} | toolUseId=${req.toolUseId.slice(0, 8)}`,
      )
      traceEvent({
        sessionId: this.sessionId,
        engineSessionId: this.engineSessionId || undefined,
        actor: 'system',
        type: 'permission_request',
        status: 'started',
        title: `Permission request: ${req.toolName}`,
        input: { tool_name: req.toolName, input: req.input, tool_use_id: req.toolUseId },
        metadata: { requestId: req.requestId, agentId: req.agentId },
      })
      this.lastActivityAt = Date.now()
      this.emit('permission_request', {
        sessionId: this.sessionId,
        requestId: req.requestId,
        toolName: req.toolName,
        input: req.input,
        toolUseId: req.toolUseId,
        agentId: req.agentId,
        description: req.description,
        title: req.title,
        displayName: req.displayName,
        blockedPath: req.blockedPath,
        decisionReason: req.decisionReason,
        permissionSuggestions: req.permissionSuggestions,
      })
    })
    this.controlProtocol.on('permission_request_cancelled', (info_: { requestId: string; reason?: string }) => {
      this.emit('permission_request_cancelled', {
        sessionId: this.sessionId,
        requestId: info_.requestId,
        reason: info_.reason,
      })
    })
    this.controlProtocol.on('elicitation_request', (req: ElicitationRequest) => {
      info(
        'SessionProcess',
        `[${this.sessionId.slice(0, 8)}] control_request: elicitation | requestId=${req.requestId.slice(0, 8)} | server=${req.mcpServerName}`,
      )
      this.lastActivityAt = Date.now()
      this.emit('elicitation_request', {
        sessionId: this.sessionId,
        requestId: req.requestId,
        mcpServerName: req.mcpServerName,
        message: req.message,
        mode: req.mode,
        url: req.url,
        elicitationId: req.elicitationId,
        requestedSchema: req.requestedSchema,
      })
    })
  }

  async start(): Promise<void> {
    this.status = 'starting'
    // 创建会话级日志文件
    setSessionLogPath(this.sessionId)
    traceEvent({
      sessionId: this.sessionId,
      actor: 'system',
      type: 'session_start',
      status: 'started',
      title: 'Claude Code session starting',
      input: {
        cwd: this.config.cwd,
        provider: this.config.provider,
        model: this.config.model,
        agent: this.config.agent,
        permissionMode: this.config.permissionMode,
      },
    })

    const builtArgs = this.buildArgs(this.config)
    const baseEnv = await this.buildEnv(this.config)
    const desktopCli = path.join(this.cliRoot, 'dist-desktop/cli.js')
    let launch = this.resolveCliCommand()
    let canRetryENOENT =
      app.isPackaged &&
      fs.existsSync(desktopCli) &&
      launch.command !== process.execPath &&
      launch.launcherEnv?.ELECTRON_RUN_AS_NODE !== '1'

    for (let attempt = 0; attempt < 2; attempt++) {
      const env = { ...process.env, ...baseEnv, ...(launch.launcherEnv ?? {}) }
      const args = [...launch.args, ...builtArgs]

      info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Starting process | command=${launch.command} | args=${args.join(' ')} | cwd=${this.config.cwd}`)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Process env keys=[${Object.keys(env).join(',')}] | provider=${this.config.provider} | model=${this.config.model}`)

      const useShell = process.platform === 'win32' && launch.command.toLowerCase().endsWith('.cmd')
      const proc = spawn(launch.command, args, {
        cwd: this.config.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: useShell,
        windowsHide: true,
      })

      const outcome = await this.waitForSpawnOrError(proc)

      if (outcome === 'spawn') {
        this.process = proc
        this.attachProcessListeners(proc)
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Process spawned | pid=${proc.pid}`)
        traceEvent({
          sessionId: this.sessionId,
          actor: 'system',
          type: 'process_spawn',
          status: 'completed',
          title: 'Engine process spawned',
          metadata: { pid: proc.pid, command: launch.command, cwd: this.config.cwd },
        })
        this.status = 'active'
        this.lastActivityAt = Date.now()
        return
      }

      const err = outcome
      proc.removeAllListeners()

      if (err.code === 'ENOENT' && canRetryENOENT && attempt === 0) {
        const bunPath = launch.command
        let bunDiag = ''
        try {
          const st = fs.statSync(bunPath)
          bunDiag = `exists=true | isFile=${st.isFile()} | size=${st.size}`
        } catch {
          bunDiag = 'exists=false'
        }
        warn(
          'SessionProcess',
          `[${this.sessionId.slice(0, 8)}] CLI spawn ENOENT (${err.message}); retrying with ELECTRON_RUN_AS_NODE + dist-desktop/cli.js | originalCommand=${bunPath} | ${bunDiag}`,
        )
        canRetryENOENT = false
        launch = {
          command: process.execPath,
          args: [desktopCli],
          launcherEnv: { ELECTRON_RUN_AS_NODE: '1' },
        }
        continue
      }

      this.process = proc
      this.attachProcessListeners(proc)
      this.status = 'exited'
      error('SessionProcess', `[${this.sessionId.slice(0, 8)}] Process error | pid=${proc.pid}`, { error: err.message, stack: err.stack })
      traceEvent({
        sessionId: this.sessionId,
        actor: 'system',
        type: 'process_error',
        status: 'failed',
        title: 'Engine process failed to start',
        error: { message: err.message, stack: err.stack },
      })
      this.emit('error', err)
      throw err
    }
  }

  /** Resolves when the child either successfully spawns or fails synchronously (e.g. ENOENT). */
  private waitForSpawnOrError(proc: ChildProcess): Promise<'spawn' | NodeJS.ErrnoException> {
    return new Promise((resolve) => {
      proc.once('spawn', () => resolve('spawn'))
      proc.once('error', (e: NodeJS.ErrnoException) => resolve(e))
    })
  }

  private attachProcessListeners(proc: ChildProcess): void {
    proc.on('error', (err) => {
      this.status = 'exited'
      error('SessionProcess', `[${this.sessionId.slice(0, 8)}] Process error | pid=${proc.pid}`, { error: err.message, stack: err.stack })
      traceEvent({
        sessionId: this.sessionId,
        actor: 'system',
        type: 'process_error',
        status: 'failed',
        title: 'Engine process error',
        error: { message: err.message, stack: err.stack },
      })
      this.emit('error', err)
    })

    proc.stdout!.on('data', (data) => {
      const dataStr = data.toString()
      processRaw(this.sessionId, 'stdout', dataStr)
      const { parseErrors } = this.controlProtocol.feedStdoutChunk(dataStr)
      for (const { line, error: err } of parseErrors) {
        warn('SessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to parse SDK message`, { line: line.slice(0, 200), error: String(err) })
      }
    })

    proc.stderr!.on('data', (data) => {
      const dataStr = data.toString()
      processRaw(this.sessionId, 'stderr', dataStr)
      this.emit('log', dataStr)
    })

    proc.on('exit', (code, signal) => {
      info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Process exited | code=${code} | signal=${signal} | pid=${this.process?.pid}`)
      traceEvent({
        sessionId: this.sessionId,
        actor: 'system',
        type: 'process_exit',
        status: code === 0 || code === null ? 'completed' : 'failed',
        title: 'Engine process exited',
        metadata: { code, signal, pid: this.process?.pid },
      })
      if (this.status !== 'suspended') {
        this.status = 'exited'
      }
      // Reject pending outbound control_requests and emit cancellation events
      // for any open inbound permission prompts so the UI can clean up.
      this.controlProtocol.rejectAllPending(`process_exit (code=${code}, signal=${signal})`)
      this.emit('exit', code)
      this.process = null
    })
  }

  async resume(): Promise<void> {
    if (!this.engineSessionId) {
      throw new Error('Cannot resume: no engineSessionId')
    }
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Resuming session | engineSessionId=${this.engineSessionId}`)
    await this.start()
  }

  sendMessage(content: string, images?: any[]): void {
    if (!this.process) throw new Error('No active process')
    
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Sending user message | contentLen=${content.length} | images=${images?.length || 0} | preview="${content.slice(0, 100)}"`)
    traceEvent({
      sessionId: this.sessionId,
      actor: 'user',
      type: 'user_message',
      status: 'completed',
      title: 'User message sent to engine',
      input: { content, images: images?.length || 0 },
    })
    
    // 处理图片：保存到临时目录并生成 @-引用
    let imageRefs = ''
    if (images && images.length > 0) {
      const uploadDir = this.getUploadDir()
      for (const img of images) {
        try {
          const savedPath = this.saveImageToTemp(img, uploadDir)
          imageRefs += `@"${savedPath}" `
        } catch (err) {
          error('SessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to save image: ${img.name}`, err)
        }
      }
    }
    
    // 构建最终消息内容，添加 @-引用前缀
    let finalContent = content
    if (imageRefs) {
      finalContent = `${imageRefs}${content || 'Please analyze the attached images.'}`.trim()
    }
    
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: finalContent }
    }) + '\n'
    try {
      this.process.stdin!.write(msg)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Message written to stdin successfully`)
    } catch (err) {
      error('SessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to write to stdin`, { error: String(err) })
      throw err
    }
  }

  submitToolAnswer(toolCallId: string, answers: Record<string, string>): void {
    if (!this.process) throw new Error('No active process')
    
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Submitting tool answer | toolId=${toolCallId.slice(0, 8)} | answers=${JSON.stringify(answers)}`)
    traceEvent({
      sessionId: this.sessionId,
      actor: 'user',
      type: 'tool_answer',
      status: 'completed',
      title: 'User submitted tool answer',
      input: { toolCallId, answers },
    })
    
    const msg = JSON.stringify({
      type: 'user',
      message: { 
        role: 'user', 
        content: [{
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: JSON.stringify({ answers })
        }]
      }
    }) + '\n'
    try {
      this.process.stdin!.write(msg)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Tool answer written to stdin successfully`)
    } catch (err) {
      error('SessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to write tool answer to stdin`, { error: String(err) })
      throw err
    }
  }

  skipToolAnswer(toolCallId: string): void {
    if (!this.process) throw new Error('No active process')
    
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Skipping tool answer | toolId=${toolCallId.slice(0, 8)}`)
    traceEvent({
      sessionId: this.sessionId,
      actor: 'user',
      type: 'tool_skip',
      status: 'completed',
      title: 'User skipped tool answer',
      input: { toolCallId },
    })
    
    const msg = JSON.stringify({
      type: 'user',
      message: { 
        role: 'user', 
        content: [{
          type: 'tool_result',
          tool_use_id: toolCallId,
          content: '',
          is_error: false
        }]
      }
    }) + '\n'
    try {
      this.process.stdin!.write(msg)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Tool skip written to stdin successfully`)
    } catch (err) {
      error('SessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to write tool skip to stdin`, { error: String(err) })
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
  
  private saveImageToTemp(img: any, uploadDir: string): string {
    // 从 data URL 提取 base64 数据
    const matches = img.data.match(/^data:([^;]+);base64,(.+)$/)
    if (!matches) {
      throw new Error('Invalid image data format')
    }
    
    const mimeType = matches[1]
    const base64Data = matches[2]
    
    // 根据 MIME 类型确定文件扩展名
    const ext = this.getExtensionFromMimeType(mimeType) || 'png'
    const fileName = `${randomUUID()}-${img.name.replace(/[^a-zA-Z0-9.-]/g, '_')}.${ext}`
    const filePath = path.join(uploadDir, fileName)
    
    // 解码并保存
    const buffer = Buffer.from(base64Data, 'base64')
    fs.writeFileSync(filePath, buffer)
    
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Image saved | name=${img.name} | path=${filePath}`)
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

  abort(): void {
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Sending abort/interrupt control_request`)
    if (this.process?.stdin?.writable) {
      this.controlProtocol.interrupt()
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // control_request / control_response 协议
  // ──────────────────────────────────────────────────────────────────────

  /**
   * 用户对一次 can_use_tool 询问做出决定（来自前端授权弹窗 / AskUserQuestion / ExitPlanMode 等）。
   *
   * 注意：不要把它和 submitToolAnswer 搞混了。
   * - submitToolAnswer 是「工具自己执行完，把结果作为 tool_result 推回」，用于
   *   AskUserQuestion 这类返回 answers 的工具的 output。
   * - respondPermission 是「告诉引擎是否允许此工具调用」，对应 can_use_tool 的 control_response。
   */
  respondPermission(requestId: string, decision: PermissionDecision): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('No active process')
    }
    const pending = this.controlProtocol.getPendingPermissionRequest(requestId)
    info(
      'SessionProcess',
      `[${this.sessionId.slice(0, 8)}] Responding to can_use_tool | requestId=${requestId.slice(0, 8)} | tool=${pending?.toolName || '?'} | behavior=${decision.behavior}`,
    )
    traceEvent({
      sessionId: this.sessionId,
      actor: 'user',
      type: 'permission_decision',
      status: 'completed',
      title: `User ${decision.behavior === 'allow' ? 'allowed' : 'denied'} ${pending?.toolName || 'tool'}`,
      input: { requestId, decision },
      metadata: { toolUseId: pending?.toolUseId },
    })
    this.controlProtocol.respondPermission(requestId, decision)
  }

  /**
   * Helper: 用「允许」回应 can_use_tool。updatedInput 缺省为原始 input，等价于「直接放行」。
   */
  allowPermission(
    requestId: string,
    updatedInput?: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
  ): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('No active process')
    }
    this.controlProtocol.allowPermission(requestId, updatedInput, decisionClassification)
  }

  /**
   * Helper: 用「拒绝」回应 can_use_tool。
   */
  denyPermission(
    requestId: string,
    message: string = 'User denied',
    options: { interrupt?: boolean } = {},
  ): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('No active process')
    }
    this.controlProtocol.denyPermission(requestId, message, options)
  }

  /**
   * Returns the ids of in-flight permission prompts (the engine asked, the
   * user has not answered yet).
   */
  getPendingPermissionRequestIds(): string[] {
    return this.controlProtocol.getPendingPermissionRequestIds()
  }

  /**
   * 应答一个引擎发来的 elicitation control_request（MCP 服务器要求用户输入）。
   */
  respondElicitation(
    requestId: string,
    response: { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> },
  ): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('No active process')
    }
    info(
      'SessionProcess',
      `[${this.sessionId.slice(0, 8)}] Responding to elicitation | requestId=${requestId.slice(0, 8)} | action=${response.action}`,
    )
    this.writeStdin({
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response },
    })
  }

  setPermissionMode(mode: PermissionMode): Promise<void> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error('No active process'))
    }
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] setPermissionMode → ${mode}`)
    return this.controlProtocol.setPermissionMode(mode).then(() => {
      this.currentPermissionMode = mode
    })
  }

  setModel(model: string | undefined): Promise<void> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error('No active process'))
    }
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] setModel → ${model || '(default)'}`)
    return this.controlProtocol.setModel(model)
  }

  getMcpStatus(): Promise<Record<string, unknown> | undefined> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error('No active process'))
    }
    return this.controlProtocol.getMcpStatus()
  }

  getContextUsage(): Promise<Record<string, unknown> | undefined> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error('No active process'))
    }
    return this.controlProtocol.getContextUsage()
  }

  getSettings(): Promise<Record<string, unknown> | undefined> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error('No active process'))
    }
    return this.controlProtocol.getSettings()
  }

  stopTask(taskId: string): Promise<void> {
    if (!this.process?.stdin?.writable) {
      return Promise.reject(new Error('No active process'))
    }
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] stopTask | taskId=${taskId}`)
    return this.controlProtocol.stopTask(taskId)
  }

  private writeStdin(message: unknown): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('Cannot write: stdin not writable')
    }
    this.process.stdin.write(encodeJsonLine(message))
  }

  suspend(): void {
    if (!this.process) return
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Suspending process | pid=${this.process.pid} | pendingTools=${this.pendingToolCalls.size}`)
    this.status = 'suspended'
    try {
      this.process.kill()
    } catch {}
    this.process = null
  }

  kill(): void {
    if (this.process) {
      const pid = this.process.pid
      info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Killing process | pid=${pid}`)
      try {
        // Windows 上使用 taskkill /F /T 强制终止整个进程树
        if (process.platform === 'win32' && pid) {
          try {
            const { execSync } = require('child_process')
            execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', timeout: 5000 })
            info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Process tree killed via taskkill | pid=${pid}`)
          } catch {
            // taskkill 失败时回退到默认 kill
            this.process.kill('SIGKILL')
          }
        } else {
          // Unix/Linux/macOS 使用 SIGKILL
          this.process.kill('SIGKILL')
        }
      } catch {}
      this.process = null
    }
    this.status = 'exited'
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  /**
   * 检查会话是否可以安全挂起
   */
  canSafelySuspend(): boolean {
    if (this.pendingToolCalls.size > 0) {
      return false
    }
    if (this.isProcessing && this.status === 'active') {
      return false
    }
    return true
  }

  getPendingToolCount(): number {
    return this.pendingToolCalls.size
  }

  /**
   * 入站消息路由：把控制协议消息消化掉，其余继续走原有 handleSDKMessage 逻辑。
   *
   * 实际工作由 ControlProtocolHandler 完成；此处保留是为了便于打日志。
   */
  private handleSDKMessage(msg: SDKMessage) {
    this.lastActivityAt = Date.now()
    sdkMessage(this.sessionId, msg.type, msg)

    if (msg.type === 'result') {
      this.status = 'idle'
      this.isProcessing = false
      info('SessionProcess', `[${this.sessionId.slice(0, 8)}] LLM response complete (result) | costUsd=${msg.cost_usd} | durationMs=${msg.duration_ms} | numTurns=${msg.num_turns}`)
      traceEvent({
        sessionId: this.sessionId,
        engineSessionId: this.engineSessionId || undefined,
        actor: 'assistant',
        type: 'result',
        status: 'completed',
        title: 'Agent response completed',
        output: { result: msg.result, stop_reason: msg.stop_reason },
        metadata: { costUsd: msg.cost_usd, durationMs: msg.duration_ms, numTurns: msg.num_turns },
      })
    } else if (msg.type === 'assistant' || msg.type === 'tool_use' || msg.type === 'stream_event') {
      this.status = 'active'
      this.isProcessing = true
    }

    // 追踪工具调用状态
    if (msg.type === 'tool_use') {
      const toolId = msg.id || msg.tool_use?.id
      const toolName = msg.name || msg.tool_use?.name
      if (toolId) {
        this.pendingToolCalls.add(toolId)
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Tool call started | id=${toolId} | name=${toolName} | pendingCount=${this.pendingToolCalls.size}`)
        traceEvent({
          sessionId: this.sessionId,
          engineSessionId: this.engineSessionId || undefined,
          actor: 'tool',
          type: 'tool_call',
          status: 'started',
          title: String(toolName || 'Tool call'),
          input: msg.input || msg.tool_use?.input || {},
          metadata: { toolId, toolName, pendingCount: this.pendingToolCalls.size },
        })
      }
    } else if (msg.type === 'tool_result') {
      const toolId = msg.tool_use_id || msg.tool_result?.tool_use_id
      const isError = msg.is_error || msg.tool_result?.is_error
      if (toolId) {
        this.pendingToolCalls.delete(toolId)
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Tool result received | id=${toolId} | error=${!!isError} | pendingCount=${this.pendingToolCalls.size}`)
        traceEvent({
          sessionId: this.sessionId,
          engineSessionId: this.engineSessionId || undefined,
          actor: 'tool',
          type: 'tool_result',
          status: isError ? 'failed' : 'completed',
          title: 'Tool result',
          output: msg.output ?? msg.content ?? msg.tool_result?.output ?? msg.tool_result?.content,
          metadata: { toolId, isError: !!isError, pendingCount: this.pendingToolCalls.size },
        })
      }
    }

    if (msg.type === 'system' && msg.subtype === 'init') {
      const sid = msg.session_id
      if (sid) {
        this.engineSessionId = sid
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Engine session initialized | engineSessionId=${sid} | tools=${JSON.stringify(msg.tools || []).slice(0, 200)}`)
        traceEvent({
          sessionId: this.sessionId,
          engineSessionId: sid,
          actor: 'system',
          type: 'engine_session_init',
          status: 'completed',
          title: 'Engine session initialized',
          metadata: { tools: msg.tools || [] },
        })
      }
    }

    if (msg.type === 'stream_event') {
      const ev = msg.event || msg
      if (ev.type === 'message_start') {
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] stream_event: message_start | model=${ev.message?.model}`)
      } else if (ev.type === 'message_stop') {
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] stream_event: message_stop`)
      }
    }

    // assistant 消息的详细日志
    if (msg.type === 'assistant') {
      const content = msg.message?.content
      if (Array.isArray(content)) {
        const textItem = content.find((c: any) => c.type === 'text')
        const thinkingItem = content.find((c: any) => c.type === 'thinking')
        const toolUses = content.filter((c: any) => c.type === 'tool_use')
        for (const toolUse of toolUses) {
          if (toolUse.id) {
            this.pendingToolCalls.add(toolUse.id)
          }
        }
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] assistant message | textLen=${textItem?.text?.length || 0} | thinkingLen=${thinkingItem?.thinking?.length || thinkingItem?.text?.length || 0} | toolCalls=${toolUses.length} | toolNames=[${toolUses.map((t: any) => t.name).join(',')}]`)
        traceEvent({
          sessionId: this.sessionId,
          engineSessionId: this.engineSessionId || undefined,
          actor: 'assistant',
          type: 'assistant_message',
          status: 'completed',
          title: 'Assistant message',
          output: { text: textItem?.text, thinking: thinkingItem?.thinking || thinkingItem?.text },
          metadata: { toolCalls: toolUses.length, toolNames: toolUses.map((t: any) => t.name) },
        })
      } else if (typeof content === 'string') {
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] assistant message (string) | contentLen=${content.length}`)
        traceEvent({
          sessionId: this.sessionId,
          engineSessionId: this.engineSessionId || undefined,
          actor: 'assistant',
          type: 'assistant_message',
          status: 'completed',
          title: 'Assistant message',
          output: { text: content },
        })
      }
    }

    this.emit('message', msg)
  }

  private buildArgs(config: SessionConfig): string[] {
    const args: string[] = []
    args.push(
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    )

    const provider = (config.provider || 'anthropic').toLowerCase()
    const useProxy = config.engineSource === 'installed' && provider !== 'anthropic' && proxyManager.getProxyUrl()
    const modelType = provider === 'openai' ? 'openai'
      : provider === 'gemini' ? 'gemini'
      : provider === 'grok' ? 'grok'
      : undefined

    if (useProxy) {
      const settingsDir = path.join(os.tmpdir(), 'SpaceCode')
      try { fs.mkdirSync(settingsDir, { recursive: true }) } catch {}
      const settingsPath = path.join(settingsDir, `settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
      const proxyUrl = proxyManager.getProxyUrl()!

      // 不设置 ANTHROPIC_DEFAULT_*_MODEL，让官网 claude-code 使用默认模型
      // 代理会返回可用的模型列表，官网 claude-code 会自动选择
      const settingsContent: Record<string, unknown> = {
        modelType: 'anthropic',
        env: {
          ANTHROPIC_BASE_URL: proxyUrl,
          ANTHROPIC_API_KEY: 'sk-spacecode-proxy',
          // 清空所有模型相关的环境变量，让官网 CLI 使用默认行为
          ANTHROPIC_DEFAULT_HAIKU_MODEL: '',
          ANTHROPIC_DEFAULT_SONNET_MODEL: '',
          ANTHROPIC_DEFAULT_OPUS_MODEL: '',
          OPENAI_BASE_URL: '',
          OPENAI_API_KEY: '',
          OPENAI_MODEL: '',
          OPENAI_ENABLE_THINKING: '',
          CLAUDE_CODE_USE_OPENAI: '',
          OPENAI_DEFAULT_HAIKU_MODEL: '',
          OPENAI_DEFAULT_SONNET_MODEL: '',
          OPENAI_DEFAULT_OPUS_MODEL: '',
          GEMINI_BASE_URL: '',
          GEMINI_API_KEY: '',
          GEMINI_MODEL: '',
          CLAUDE_CODE_USE_GEMINI: '',
          GEMINI_DEFAULT_HAIKU_MODEL: '',
          GEMINI_DEFAULT_SONNET_MODEL: '',
          GEMINI_DEFAULT_OPUS_MODEL: '',
        },
      }
      fs.writeFileSync(settingsPath, JSON.stringify(settingsContent, null, 2), 'utf8')
      args.push('--settings', settingsPath)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Created temp settings file (proxy mode) | path=${settingsPath} | modelType=anthropic | ANTHROPIC_BASE_URL=${proxyUrl}`)
    } else if (modelType) {
      const settingsDir = path.join(os.tmpdir(), 'SpaceCode')
      try { fs.mkdirSync(settingsDir, { recursive: true }) } catch {}
      const settingsPath = path.join(settingsDir, `settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
      const settingsContent: Record<string, unknown> = { modelType }
      if (config.model) settingsContent.model = config.model
      fs.writeFileSync(settingsPath, JSON.stringify(settingsContent, null, 2), 'utf8')
      args.push('--settings', settingsPath)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Created temp settings file | path=${settingsPath} | modelType=${modelType}`)
    }

    // 在非代理模式下传递用户配置的模型
    // 代理模式下不传递 --model，让官网 CLI 使用 ANTHROPIC_DEFAULT_*_MODEL 环境变量
    if (config.model && !useProxy) {
      args.push('--model', config.model)
    }
    if (config.permissionMode) args.push('--permission-mode', config.permissionMode)
    args.push('--allow-dangerously-skip-permissions')
    if (config.effortLevel) args.push('--effort', config.effortLevel)
    if (config.systemPrompt) args.push('--system-prompt', config.systemPrompt)

    const askUserGuidance = [
      'When you need to ask the user clarifying questions, present choices, or gather preferences, you MUST use the AskUserQuestion tool instead of writing questions as plain text.',
      'If AskUserQuestion is not in your available tool list (it may be deferred behind ToolSearch), first call ToolSearch({query: "select:AskUserQuestion"}) to load its schema, then call it.',
      'This applies to all skills including brainstorming — always use AskUserQuestion for interactive questions with options.',
    ].join(' ')
    const finalAppendPrompt = config.appendSystemPrompt
      ? config.appendSystemPrompt + '\n\n' + askUserGuidance
      : askUserGuidance
    args.push('--append-system-prompt', finalAppendPrompt)
    if (config.maxTurns) args.push('--max-turns', String(config.maxTurns))
    if (config.maxBudgetUsd) args.push('--max-budget-usd', String(config.maxBudgetUsd))
    if (config.agent) args.push('--agent', config.agent)
    if (config.allowedTools && config.allowedTools.length > 0) {
      args.push('--allowedTools', ...config.allowedTools)
    }

    args.push('--permission-prompt-tool', 'stdio')

    const claudeDir = path.join(os.homedir(), '.claude')
    if (fs.existsSync(claudeDir)) {
      args.push('--add-dir', claudeDir)
    }

    args.push('--thinking', config.thinkingEnabled ? 'enabled' : 'disabled')

    // 首先检查是否有需要恢复的历史会话 ID
    if (config.resumeSessionId) {
      args.push('--resume', config.resumeSessionId)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Added --resume flag | resumeSessionId=${config.resumeSessionId}`)
    } else if (this.engineSessionId && this.status === 'suspended') {
      args.push('--resume', this.engineSessionId)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Added --resume flag | engineSessionId=${this.engineSessionId}`)
    } else if (this.transcriptFileExists(config.cwd, this.sessionId)) {
      // engine 收到 --session-id 时会检查 ~/.claude/projects/<sanitized-cwd>/<uuid>.jsonl
      // 是否已存在；如果存在就立即 exit(1) 并打印 "Session ID ... is already in use"。
      // 这种情况在重启 Electron / 进程被 evict 后再次发消息时必现：前端 chat 会话
      // id 在 localStorage 里持久化，但 engineSessionId / 内存里的 status 都丢了，
      // 走到 --session-id 分支就会撞上磁盘上的旧 jsonl。
      // 用 --resume 接续历史，等价于 IDE 重启后继续聊。
      args.push('--resume', this.sessionId)
      debug(
        'SessionProcess',
        `[${this.sessionId.slice(0, 8)}] transcript already exists, using --resume to continue | sessionId=${this.sessionId}`,
      )
    } else {
      args.push('--session-id', this.sessionId)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Added --session-id flag | sessionId=${this.sessionId}`)
    }

    return args
  }

  /**
   * Returns true when ~/.claude/projects/<sanitized-cwd>/<sessionId>.jsonl already
   * exists. Mirrors engine/src/utils/sessionStorage.ts:sessionIdExists() so we can
   * decide between --session-id (fresh) and --resume (continue) without round-tripping
   * through the engine.
   *
   * Must use the SAME resolution rules as the engine, otherwise we miss the on-disk
   * transcript here, fall back to --session-id, and the engine kills itself with
   * "Session ID ... is already in use". The engine resolves:
   *   - claude config dir = process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')
   *     (engine/src/utils/envUtils.ts:getClaudeConfigHomeDir — XDG_CONFIG_HOME is NOT used)
   *   - cwd = realpathSync(process.cwd()) at engine bootstrap
   *     (engine/src/utils/state.ts:getOriginalCwd)
   * On Linux desktops XDG_CONFIG_HOME is commonly set to ~/.config, which previously
   * caused this check to look under ~/.config/claude while the engine wrote/read
   * ~/.claude — making model-switch + resend reliably crash the engine.
   */
  private transcriptFileExists(cwd: string, sessionId: string): boolean {
    try {
      const claudeDir = process.env.CLAUDE_CONFIG_DIR
        ? process.env.CLAUDE_CONFIG_DIR
        : path.join(os.homedir(), '.claude')
      const projectsDir = path.join(claudeDir, 'projects')

      const candidates = new Set<string>()
      candidates.add(cwd)
      try {
        candidates.add(fs.realpathSync(cwd))
      } catch {}

      for (const candidate of candidates) {
        const sanitized = candidate.replace(/[^a-zA-Z0-9]/g, '-')
        const transcript = path.join(projectsDir, sanitized, `${sessionId}.jsonl`)
        if (fs.existsSync(transcript)) return true
      }
      return false
    } catch {
      return false
    }
  }

  private async buildEnv(config: SessionConfig): Promise<Record<string, string>> {
    const env: Record<string, string> = {}
    const provider = (config.provider || 'anthropic').toLowerCase()
    env.LLM_PROVIDER = provider

    if (provider === 'openai') {
      env.CLAUDE_CODE_USE_OPENAI = '1'
      if (config.apiKey) env.OPENAI_API_KEY = config.apiKey
      if (config.baseUrl) env.OPENAI_BASE_URL = config.baseUrl
      if (config.model) env.OPENAI_MODEL = config.model
      env.OPENAI_ENABLE_THINKING = config.thinkingEnabled ? '1' : '0'
    } else if (provider === 'gemini') {
      env.CLAUDE_CODE_USE_GEMINI = '1'
      if (config.apiKey) env.GEMINI_API_KEY = config.apiKey
      if (config.baseUrl) env.GEMINI_BASE_URL = config.baseUrl
      if (config.model) env.GEMINI_MODEL = config.model
    } else {
      if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey
      if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl
    }

    // 兼容部分网关/适配器读取 Anthropic 变量的场景
    if (config.apiKey && !env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = config.apiKey
    }

    env.CLAUDE_CODE_ROOT = this.cliRoot

    env.CLAUDE_CODE_ENTRYPOINT = 'claude-desktop'

    const gitBashPath = this.findGitBashPath()
    if (gitBashPath && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
      env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Git Bash path detected | path=${gitBashPath}`)
    }

    if (!process.env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS) {
      env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS = '80000'
    }

    // Force-enable v2 task tools (TaskCreate / TaskGet / TaskUpdate / TaskList).
    // Without this, the engine sees `getIsNonInteractiveSession() === true`
    // (we always pass `--print`) and isTodoV2Enabled() returns false, so the
    // four task tools are stripped from the tool list. The desktop UI is the
    // user-facing surface for these tools, so we always want them present.
    // See engine/src/utils/tasks.ts:isTodoV2Enabled().
    if (!process.env.CLAUDE_CODE_ENABLE_TASKS) {
      env.CLAUDE_CODE_ENABLE_TASKS = '1'
    }

    // Force-enable file history checkpointing for the SDK / non-interactive code path.
    // The engine always sees `getIsNonInteractiveSession() === true` because we pass
    // `--print --output-format stream-json`. Under that path,
    // engine/src/utils/fileHistory.ts:fileHistoryEnabledSdk() requires this flag to
    // be truthy, otherwise fileHistoryTrackEdit / fileHistoryMakeSnapshot all early-return,
    // no backups are written to ~/.claude/file-history/{sessionId}/, and no
    // file-history-snapshot entries are appended to the session JSONL — which means the
    // turn-change card UI never has any data to display.
    if (!process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING) {
      env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = '1'
    }

    if (config.engineSource === 'installed' && config.provider !== 'anthropic') {
      const proxyUrl = proxyManager.getProxyUrl()
      if (proxyUrl) {
        env.ANTHROPIC_BASE_URL = proxyUrl
        env.ANTHROPIC_API_KEY = 'sk-spacecode-proxy'
        env.OPENAI_BASE_URL = ''
        env.OPENAI_API_KEY = ''
        env.OPENAI_MODEL = ''
        env.OPENAI_ENABLE_THINKING = ''
        env.CLAUDE_CODE_USE_OPENAI = ''
        env.OPENAI_DEFAULT_HAIKU_MODEL = ''
        env.OPENAI_DEFAULT_SONNET_MODEL = ''
        env.OPENAI_DEFAULT_OPUS_MODEL = ''
        env.GEMINI_BASE_URL = ''
        env.GEMINI_API_KEY = ''
        env.GEMINI_MODEL = ''
        env.CLAUDE_CODE_USE_GEMINI = ''
        env.GEMINI_DEFAULT_HAIKU_MODEL = ''
        env.GEMINI_DEFAULT_SONNET_MODEL = ''
        env.GEMINI_DEFAULT_OPUS_MODEL = ''
        debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using proxy: ${proxyUrl}`)
      } else {
        warn('SessionProcess', `[${this.sessionId.slice(0, 8)}] Proxy not running — attempting to start proxy for installed CLI with non-Anthropic provider`)
        try {
          const proxyConfig = this.buildProxyConfig(config)
          if (proxyConfig) {
            await proxyManager.start(proxyConfig)
            const startedUrl = proxyManager.getProxyUrl()
            if (startedUrl) {
              env.ANTHROPIC_BASE_URL = startedUrl
              env.ANTHROPIC_API_KEY = 'sk-spacecode-proxy'
              env.OPENAI_BASE_URL = ''
              env.OPENAI_API_KEY = ''
              env.OPENAI_MODEL = ''
              env.OPENAI_ENABLE_THINKING = ''
              env.CLAUDE_CODE_USE_OPENAI = ''
              env.OPENAI_DEFAULT_HAIKU_MODEL = ''
              env.OPENAI_DEFAULT_SONNET_MODEL = ''
              env.OPENAI_DEFAULT_OPUS_MODEL = ''
              env.GEMINI_BASE_URL = ''
              env.GEMINI_API_KEY = ''
              env.GEMINI_MODEL = ''
              env.CLAUDE_CODE_USE_GEMINI = ''
              env.GEMINI_DEFAULT_HAIKU_MODEL = ''
              env.GEMINI_DEFAULT_SONNET_MODEL = ''
              env.GEMINI_DEFAULT_OPUS_MODEL = ''
              debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Proxy started on demand: ${startedUrl}`)
            } else {
              warn('SessionProcess', `[${this.sessionId.slice(0, 8)}] Proxy started but URL is empty — falling back to direct OpenAI env vars`)
            }
          } else {
            warn('SessionProcess', `[${this.sessionId.slice(0, 8)}] Cannot build proxy config — falling back to direct OpenAI env vars. The installed CLI may not support CLAUDE_CODE_USE_OPENAI correctly.`)
          }
        } catch (err) {
          warn('SessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to start proxy on demand`, { error: String(err) })
        }
      }
    }

    debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] buildEnv | provider=${provider} | baseUrl=${config.baseUrl || '(empty)'} | apiKey=${config.apiKey ? '***set' : '(empty)'} | envKeys=[${Object.keys(env).join(',')}]`)

    return env
  }

  private buildProxyConfig(config: SessionConfig): import('./proxy/types').ProxyConfig | null {
    const provider = (config.provider || 'anthropic').toLowerCase()
    let upstreamProvider: 'openai_compatible' | 'anthropic'
    let upstreamBaseUrl = ''
    let upstreamApiKey = ''
    const modelMapping: import('./proxy/types').ModelMappingConfig = {}

    if (provider === 'openai' || provider === 'gemini') {
      upstreamProvider = 'openai_compatible'
      upstreamBaseUrl = (config.baseUrl || '').trim()
      upstreamApiKey = (config.apiKey || '').trim()
      if (config.model) {
        const trimmedModel = config.model.trim()
        // 将所有 Claude 模型名映射到用户配置的实际模型
        modelMapping.haikuModel = trimmedModel
        modelMapping.sonnetModel = trimmedModel
        modelMapping.opusModel = trimmedModel
        modelMapping.defaultModel = trimmedModel
      }
    } else if (provider === 'anthropic') {
      upstreamProvider = 'anthropic'
      upstreamBaseUrl = (config.baseUrl || '').trim()
      upstreamApiKey = (config.apiKey || '').trim()
      if (config.model) {
        const trimmedModel = config.model.trim()
        modelMapping.haikuModel = trimmedModel
        modelMapping.sonnetModel = trimmedModel
        modelMapping.opusModel = trimmedModel
        modelMapping.defaultModel = trimmedModel
      }
    } else {
      return null
    }

    if (!upstreamBaseUrl || !upstreamApiKey) return null

    return {
      host: '127.0.0.1',
      port: 34567,
      upstreamProvider,
      upstreamBaseUrl,
      upstreamApiKey,
      modelMapping,
    }
  }

  private findGitBashPath(): string | null {
    if (process.platform !== 'win32') return null
    if (process.env.CLAUDE_CODE_GIT_BASH_PATH && fs.existsSync(process.env.CLAUDE_CODE_GIT_BASH_PATH)) {
      return process.env.CLAUDE_CODE_GIT_BASH_PATH
    }
    const candidates = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Git', 'bin', 'bash.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
      process.env.ProgramW6432 && path.join(process.env.ProgramW6432, 'Git', 'bin', 'bash.exe'),
    ].filter(Boolean) as string[]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    try {
      const out = require('child_process').execSync('where git', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      const gitExe = out.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)[0]
      if (gitExe) {
        const bashFromGit = path.join(path.dirname(path.dirname(gitExe)), 'bin', 'bash.exe')
        if (fs.existsSync(bashFromGit)) return bashFromGit
      }
    } catch {}
    return null
  }

  private resolveCliCommand(): { command: string; args: string[]; launcherEnv?: Record<string, string> } {
    if (this.config.engineSource === 'installed' && this.config.installedCliPath) {
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (installed): ${this.config.installedCliPath}`)
      return { command: this.config.installedCliPath, args: [] }
    }

    const isDev = !app.isPackaged

    if (isDev) {
      const srcCliPath = path.join(this.cliRoot, 'src/entrypoints/cli.tsx')
      if (fs.existsSync(srcCliPath)) {
        const defineArgs = this.getMacroDefines()
        const featureArgs = this.getFeatureArgs()
        const bunArgs = ['run', ...defineArgs, ...featureArgs]
        const preloadPath = path.join(this.cliRoot, 'preload.ts')
        if (fs.existsSync(preloadPath)) {
          bunArgs.push('--preload', preloadPath)
        }
        const envFilePath = path.join(this.cliRoot, '.env')
        if (fs.existsSync(envFilePath)) {
          bunArgs.push('--env-file=' + envFilePath)
        }
        bunArgs.push(srcCliPath)
        const bunPath = this.resolveBunPath()
        debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (dev): bun at ${bunPath} | entry=${srcCliPath}`)
        return { command: bunPath, args: bunArgs }
      }
    }

    // Prefer the desktop single-bundle (dist-desktop/cli.js) for packaged builds
    const desktopCli = path.join(this.cliRoot, 'dist-desktop/cli.js')
    if (fs.existsSync(desktopCli)) {
      const bunPath = this.resolveBunPathForPackagedDesktop()
      if (bunPath) {
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (desktop bundle): bun at ${bunPath} | entry=${desktopCli}`)
        return { command: bunPath, args: ['run', desktopCli] }
      }
      warn(
        'SessionProcess',
        `[${this.sessionId.slice(0, 8)}] Bundled bun missing or unusable; running dist-desktop/cli.js via Electron Node (ELECTRON_RUN_AS_NODE).`,
      )
      info('SessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (desktop bundle): execPath=${process.execPath} | entry=${desktopCli}`)
      return {
        command: process.execPath,
        args: [desktopCli],
        launcherEnv: { ELECTRON_RUN_AS_NODE: '1' },
      }
    }

    // Fallback: split dist build
    const distCli = path.join(this.cliRoot, 'dist/cli.js')
    if (fs.existsSync(distCli)) {
      return { command: this.resolveBunPath(), args: ['run', distCli] }
    }

    const srcCliPath = path.join(this.cliRoot, 'src/entrypoints/cli.tsx')
    if (fs.existsSync(srcCliPath)) {
      const defineArgs = this.getMacroDefines()
      const featureArgs = this.getFeatureArgs()
      const bunArgs = ['run', ...defineArgs, ...featureArgs]
      const preloadPath = path.join(this.cliRoot, 'preload.ts')
      if (fs.existsSync(preloadPath)) {
        bunArgs.push('--preload', preloadPath)
      }
      const envFilePath = path.join(this.cliRoot, '.env')
      if (fs.existsSync(envFilePath)) {
        bunArgs.push('--env-file=' + envFilePath)
      }
      bunArgs.push(srcCliPath)
      const bunPath = this.resolveBunPath()
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (src fallback): bun at ${bunPath} | entry=${srcCliPath}`)
      return { command: bunPath, args: bunArgs }
    }

    warn('SessionProcess', `[${this.sessionId.slice(0, 8)}] No CLI found, falling back to global 'claude' command`)
    return { command: 'claude', args: [] }
  }

  /**
   * Reject placeholders / broken copies (existsSync alone is not enough on portable builds).
   * Real bun binaries are multi‑MB; empty or LFS-pointer files cause spawn ENOENT or instant failure.
   */
  private isProbableBunExecutable(absPath: string): boolean {
    try {
      const st = fs.statSync(absPath)
      const valid = st.isFile() && st.size >= 256 * 1024
      if (!valid) {
        warn('SessionProcess', `[${this.sessionId.slice(0, 8)}] isProbableBunExecutable: rejected | path=${absPath} | exists=${st.isFile()} | size=${st.size} | minRequired=${256 * 1024}`)
      }
      return valid
    } catch (e) {
      warn('SessionProcess', `[${this.sessionId.slice(0, 8)}] isProbableBunExecutable: stat failed | path=${absPath} | error=${String(e)}`)
      return false
    }
  }

  /** For dist-desktop: only return bun if the binary looks real; otherwise null so we can fall back to Electron-as-Node. */
  private resolveBunPathForPackagedDesktop(): string | null {
    const platform = process.platform
    const arch = process.arch
    const bunName = platform === 'win32' ? 'bun.exe' : 'bun'
    const bundledBun = path.join(this.cliRoot, 'bin', bunName)
    if (this.isProbableBunExecutable(bundledBun)) {
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using bundled bun: ${bundledBun}`)
      return bundledBun
    }

    const platformSuffix = platform === 'win32' ? 'windows-x64'
      : platform === 'darwin' ? (arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
      : 'linux-x64'
    const platformSpecificBun = path.join(this.cliRoot, 'bin', `bun-${platformSuffix}`)
    if (this.isProbableBunExecutable(platformSpecificBun)) {
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using platform-specific bun: ${platformSpecificBun}`)
      return platformSpecificBun
    }
    if (platform === 'win32') {
      const exe = `${platformSpecificBun}.exe`
      if (this.isProbableBunExecutable(exe)) {
        debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using platform-specific bun.exe: ${exe}`)
        return exe
      }
    }

    try {
      const { execSync } = require('child_process')
      let globalBun: string | null = null
      if (platform === 'win32') {
        globalBun = execSync('where bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim().split(/\r\n/)[0]?.trim() || null
      } else {
        globalBun = execSync('which bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim().split('\n')[0]?.trim() || null
      }
      if (globalBun && this.isProbableBunExecutable(globalBun)) {
        debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using global bun: ${globalBun}`)
        return globalBun
      }
    } catch {}

    return null
  }

  private resolveBunPath(): string {
    const platform = process.platform
    const arch = process.arch

    // 1. Check bundled bun first (instant fs check, no subprocess overhead)
    const bunName = platform === 'win32' ? 'bun.exe' : 'bun'
    const bundledBun = path.join(this.cliRoot, 'bin', bunName)
    if (this.isProbableBunExecutable(bundledBun)) {
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using bundled bun: ${bundledBun}`)
      return bundledBun
    }

    // 2. Check platform-specific bundled bun
    const platformSuffix = platform === 'win32' ? 'windows-x64'
      : platform === 'darwin' ? (arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
      : 'linux-x64'
    const platformSpecificBun = path.join(this.cliRoot, 'bin', `bun-${platformSuffix}`)
    if (this.isProbableBunExecutable(platformSpecificBun)) {
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using platform-specific bun: ${platformSpecificBun}`)
      return platformSpecificBun
    }
    if (platform === 'win32') {
      const exe = platformSpecificBun + '.exe'
      if (this.isProbableBunExecutable(exe)) {
        debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using platform-specific bun.exe: ${exe}`)
        return exe
      }
    }

    // 3. Fallback: find global bun (slower - spawns subprocess)
    try {
      const { execSync } = require('child_process')
      let globalBun: string | null = null
      if (platform === 'win32') {
        // Use 'where' instead of PowerShell for speed (~100ms vs ~2s)
        globalBun = execSync('where bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim().split(/\r\n/)[0]?.trim() || null
      } else {
        globalBun = execSync('which bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim().split('\n')[0]?.trim() || null
      }
      if (globalBun && this.isProbableBunExecutable(globalBun)) {
        debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using global bun: ${globalBun}`)
        return globalBun
      }
    } catch {}

    warn('SessionProcess', `[${this.sessionId.slice(0, 8)}] No bun binary found, falling back to PATH`)
    return 'bun'
  }

  private getMacroDefines(): string[] {
    const defines = [
      'MACRO.VERSION:2.1.888-dev',
      `MACRO.BUILD_TIME:${new Date().toISOString()}`,
      'MACRO.FEEDBACK_CHANNEL:""',
      'MACRO.ISSUES_EXPLAINER:""',
      'MACRO.NATIVE_PACKAGE_URL:""',
      'MACRO.PACKAGE_URL:""',
      'MACRO.VERSION_CHANGELOG:""',
    ]
    return defines.flatMap(d => ['-d', d])
  }

  private getFeatureArgs(): string[] {
    const features = [
      'BUDDY', 'TRANSCRIPT_CLASSIFIER', 'BRIDGE_MODE',
      'AGENT_TRIGGERS_REMOTE', 'CHICAGO_MCP', 'VOICE_MODE',
      'SHOT_STATS', 'PROMPT_CACHE_BREAK_DETECTION', 'TOKEN_BUDGET',
      'AGENT_TRIGGERS', 'ULTRATHINK', 'BUILTIN_EXPLORE_PLAN_AGENTS',
      'LODESTONE', 'EXTRACT_MEMORIES', 'VERIFICATION_AGENT',
      'KAIROS_BRIEF', 'AWAY_SUMMARY', 'ULTRAPLAN', 'DAEMON',
      'WORKFLOW_SCRIPTS', 'HISTORY_SNIP', 'CONTEXT_COLLAPSE',
      'MONITOR_TOOL', 'FORK_SUBAGENT', 'UDS_INBOX', 'KAIROS',
      'COORDINATOR_MODE', 'LAN_PIPES', 'POOR',
      'PROACTIVE', 'WEB_BROWSER_TOOL', 'BUILDING_CLAUDE_APPS',
    ]
    return features.flatMap(f => ['--feature', f])
  }
}
