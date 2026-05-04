import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { SessionConfig } from './claudeCodeProcessManager'
import { info, warn, error, debug, processRaw, setSessionLogPath } from './logger'

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

  // 工具调用状态追踪
  private pendingToolCalls: Set<string> = new Set()
  private isProcessing: boolean = false

  private cliRoot: string
  private buffer: string = ''

  constructor(sessionId: string, config: SessionConfig) {
    super()
    this.sessionId = sessionId
    this.config = config
    const isPackaged = app.isPackaged
    if (isPackaged) {
      this.cliRoot = path.join(process.resourcesPath, 'engine')
    } else {
      this.cliRoot = path.resolve(__dirname, '../engine')
    }
    debug('SessionProcess', `Constructed | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)
  }

  async start(): Promise<void> {
    this.status = 'starting'
    const { command, args: cliArgs } = this.resolveCliCommand()
    const args = [...cliArgs, ...this.buildArgs(this.config)]
    const env = this.buildEnv(this.config)

    // 创建会话级日志文件
    setSessionLogPath(this.sessionId)

    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Starting process | command=${command} | args=${args.join(' ')} | cwd=${this.config.cwd}`)
    debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Process env keys=[${Object.keys(env).join(',')}] | provider=${this.config.provider} | model=${this.config.model}`)

    this.process = spawn(command, args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    })

    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Process spawned | pid=${this.process.pid}`)

    this.process.on('error', (err) => {
      this.status = 'exited'
      error('SessionProcess', `[${this.sessionId.slice(0, 8)}] Process error | pid=${this.process?.pid}`, { error: err.message, stack: err.stack })
      this.emit('error', err)
    })

    this.process.stdout!.on('data', (data) => {
      const dataStr = data.toString()
      // 记录原始 stdout
      processRaw(this.sessionId, 'stdout', dataStr)

      this.buffer += dataStr
      const bufferedLines = this.buffer.split('\n')
      this.buffer = bufferedLines.pop() || ''
      for (const line of bufferedLines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line)
            this.handleSDKMessage(msg)
          } catch (e) {
            warn('SessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to parse SDK message`, { line: line.slice(0, 200), error: String(e) })
          }
        }
      }
    })

    this.process.stderr!.on('data', (data) => {
      const dataStr = data.toString()
      // 记录 stderr
      processRaw(this.sessionId, 'stderr', dataStr)
      this.emit('log', dataStr)
    })

    this.process.on('exit', (code, signal) => {
      info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Process exited | code=${code} | signal=${signal} | pid=${this.process?.pid}`)
      if (this.status !== 'suspended') {
        this.status = 'exited'
      }
      this.emit('exit', code)
      this.process = null
    })

    this.status = 'active'
    this.lastActivityAt = Date.now()
  }

  async resume(): Promise<void> {
    if (!this.engineSessionId) {
      throw new Error('Cannot resume: no engineSessionId')
    }
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Resuming session | engineSessionId=${this.engineSessionId}`)
    await this.start()
  }

  sendMessage(content: string): void {
    if (!this.process) throw new Error('No active process')
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Sending user message | contentLen=${content.length} | preview="${content.slice(0, 100)}"`)
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content }
    }) + '\n'
    try {
      this.process.stdin!.write(msg)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Message written to stdin successfully`)
    } catch (err) {
      error('SessionProcess', `[${this.sessionId.slice(0, 8)}] Failed to write to stdin`, { error: String(err) })
      throw err
    }
  }

  abort(): void {
    info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Sending abort/interrupt control_request`)
    if (this.process?.stdin?.writable) {
      const abortMessage = {
        type: 'control_request',
        request_id: randomUUID(),
        request: { subtype: 'interrupt' }
      }
      this.process.stdin.write(JSON.stringify(abortMessage) + '\n')
    }
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

  private handleSDKMessage(msg: SDKMessage) {
    this.lastActivityAt = Date.now()

    if (msg.type === 'result') {
      this.status = 'idle'
      this.isProcessing = false
      info('SessionProcess', `[${this.sessionId.slice(0, 8)}] LLM response complete (result) | costUsd=${msg.cost_usd} | durationMs=${msg.duration_ms} | numTurns=${msg.num_turns}`)
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
      }
    } else if (msg.type === 'tool_result') {
      const toolId = msg.tool_use_id || msg.tool_result?.tool_use_id
      const isError = msg.is_error || msg.tool_result?.is_error
      if (toolId) {
        this.pendingToolCalls.delete(toolId)
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Tool result received | id=${toolId} | error=${!!isError} | pendingCount=${this.pendingToolCalls.size}`)
      }
    }

    if (msg.type === 'system' && msg.subtype === 'init') {
      const sid = msg.session_id
      if (sid) {
        this.engineSessionId = sid
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] Engine session initialized | engineSessionId=${sid} | tools=${JSON.stringify(msg.tools || []).slice(0, 200)}`)
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
      } else if (typeof content === 'string') {
        info('SessionProcess', `[${this.sessionId.slice(0, 8)}] assistant message (string) | contentLen=${content.length}`)
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
    const modelType = provider === 'openai' ? 'openai'
      : provider === 'gemini' ? 'gemini'
      : provider === 'grok' ? 'grok'
      : undefined

    if (modelType) {
      const settingsDir = path.join(os.tmpdir(), 'claude-code-gui')
      try { fs.mkdirSync(settingsDir, { recursive: true }) } catch {}
      const settingsPath = path.join(settingsDir, `settings-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
      const settingsContent: Record<string, unknown> = { modelType }
      if (config.model) settingsContent.model = config.model
      fs.writeFileSync(settingsPath, JSON.stringify(settingsContent, null, 2), 'utf8')
      args.push('--settings', settingsPath)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Created temp settings file | path=${settingsPath} | modelType=${modelType}`)
    }

    if (config.model) args.push('--model', config.model)
    if (config.permissionMode) args.push('--permission-mode', config.permissionMode)
    if (config.effortLevel) args.push('--effort', config.effortLevel)
    if (config.systemPrompt) args.push('--system-prompt', config.systemPrompt)
    if (config.appendSystemPrompt) args.push('--append-system-prompt', config.appendSystemPrompt)
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

    if (this.engineSessionId && this.status === 'suspended') {
      args.push('--resume', this.engineSessionId)
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Added --resume flag | engineSessionId=${this.engineSessionId}`)
    }

    return args
  }

  private buildEnv(config: SessionConfig): Record<string, string> {
    const env: Record<string, string> = {}
    const provider = (config.provider || 'anthropic').toLowerCase()
    env.LLM_PROVIDER = provider

    if (provider === 'openai') {
      if (config.apiKey) env.OPENAI_API_KEY = config.apiKey
      if (config.baseUrl) env.OPENAI_BASE_URL = config.baseUrl
      if (config.model) env.OPENAI_MODEL = config.model
    } else if (provider === 'gemini') {
      if (config.apiKey) env.GEMINI_API_KEY = config.apiKey
      if (config.baseUrl) env.GEMINI_BASE_URL = config.baseUrl
      if (config.model) env.GEMINI_MODEL = config.model
    } else {
      if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey
      if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl
    }

    if (config.apiKey && !env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = config.apiKey
    }

    env.CLAUDE_CODE_ROOT = this.cliRoot

    const gitBashPath = this.findGitBashPath()
    if (gitBashPath && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
      env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Git Bash path detected | path=${gitBashPath}`)
    }

    if (!process.env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS) {
      env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS = '80000'
    }

    return env
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

  private resolveCliCommand(): { command: string; args: string[] } {
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
      const bunPath = this.resolveBunPath()
      info('SessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (desktop bundle): bun at ${bunPath} | entry=${desktopCli}`)
      return { command: bunPath, args: ['run', desktopCli] }
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

  private resolveBunPath(): string {
    const platform = process.platform
    const arch = process.arch

    // 1. Check bundled bun first (instant fs check, no subprocess overhead)
    const bunName = platform === 'win32' ? 'bun.exe' : 'bun'
    const bundledBun = path.join(this.cliRoot, 'bin', bunName)
    if (fs.existsSync(bundledBun)) {
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using bundled bun: ${bundledBun}`)
      return bundledBun
    }

    // 2. Check platform-specific bundled bun
    const platformSuffix = platform === 'win32' ? 'windows-x64'
      : platform === 'darwin' ? (arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
      : 'linux-x64'
    const platformSpecificBun = path.join(this.cliRoot, 'bin', `bun-${platformSuffix}`)
    if (fs.existsSync(platformSpecificBun)) {
      debug('SessionProcess', `[${this.sessionId.slice(0, 8)}] Using platform-specific bun: ${platformSpecificBun}`)
      return platformSpecificBun
    }
    if (platform === 'win32') {
      const exe = platformSpecificBun + '.exe'
      if (fs.existsSync(exe)) {
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
        globalBun = execSync('where bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim().split('\r\n')[0]
      } else {
        globalBun = execSync('which bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim().split('\n')[0]
      }
      if (globalBun && fs.existsSync(globalBun)) {
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
