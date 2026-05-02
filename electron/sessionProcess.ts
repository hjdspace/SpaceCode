import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { SessionConfig } from './claudeCodeProcessManager'

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
  }

  async start(): Promise<void> {
    this.status = 'starting'
    const { command, args: cliArgs } = this.resolveCliCommand()
    const args = [...cliArgs, ...this.buildArgs(this.config)]
    const env = this.buildEnv(this.config)

    this.process = spawn(command, args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    })

    this.process.on('error', (err) => {
      this.status = 'exited'
      this.emit('error', err)
    })

    this.process.stdout!.on('data', (data) => {
      const dataStr = data.toString()
      this.buffer += dataStr
      const bufferedLines = this.buffer.split('\n')
      this.buffer = bufferedLines.pop() || ''
      for (const line of bufferedLines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line)
            this.handleSDKMessage(msg)
          } catch {}
        }
      }
    })

    this.process.stderr!.on('data', (data) => {
      this.emit('log', data.toString())
    })

    this.process.on('exit', (code, signal) => {
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
    await this.start()
  }

  sendMessage(content: string): void {
    if (!this.process) throw new Error('No active process')
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content }
    }) + '\n'
    this.process.stdin!.write(msg)
  }

  abort(): void {
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
    this.status = 'suspended'
    try {
      this.process.kill()
    } catch {}
    this.process = null
  }

  kill(): void {
    if (this.process) {
      try {
        this.process.kill()
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
   * 返回 true 表示可以安全挂起（没有进行中的工具调用或处理）
   */
  canSafelySuspend(): boolean {
    // 如果有未完成的工具调用，不能挂起
    if (this.pendingToolCalls.size > 0) {
      return false
    }
    // 如果正在处理中（收到 assistant/stream_event 但还没收到 result），不能挂起
    if (this.isProcessing && this.status === 'active') {
      return false
    }
    return true
  }

  /**
   * 获取当前待处理的工具调用数量
   */
  getPendingToolCount(): number {
    return this.pendingToolCalls.size
  }

  private handleSDKMessage(msg: SDKMessage) {
    this.lastActivityAt = Date.now()

    if (msg.type === 'result') {
      this.status = 'idle'
      this.isProcessing = false
    } else if (msg.type === 'assistant' || msg.type === 'tool_use' || msg.type === 'stream_event') {
      this.status = 'active'
      this.isProcessing = true
    }

    // 追踪工具调用状态
    if (msg.type === 'tool_use') {
      const toolId = msg.id || msg.tool_use?.id
      if (toolId) {
        this.pendingToolCalls.add(toolId)
      }
    } else if (msg.type === 'tool_result') {
      const toolId = msg.tool_use_id || msg.tool_result?.tool_use_id
      if (toolId) {
        this.pendingToolCalls.delete(toolId)
      }
    }

    if (msg.type === 'system' && msg.subtype === 'init') {
      const sid = msg.session_id
      if (sid) {
        this.engineSessionId = sid
      }
    }

    this.emit('message', msg)
  }

  private buildArgs(config: SessionConfig): string[] {
    const args: string[] = []
    args.push(
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
        return { command: this.resolveBunPath(), args: bunArgs }
      }
    }

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
      return { command: this.resolveBunPath(), args: bunArgs }
    }

    return { command: 'claude', args: [] }
  }

  private resolveBunPath(): string {
    const platform = process.platform
    const arch = process.arch
    const platformSuffix = platform === 'win32' ? 'windows-x64'
      : platform === 'darwin' ? (arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64')
      : 'linux-x64'
    const platformSpecificBun = path.join(this.cliRoot, 'bin', `bun-${platformSuffix}`)
    if (fs.existsSync(platformSpecificBun)) return platformSpecificBun
    if (platform === 'win32') {
      const exe = platformSpecificBun + '.exe'
      if (fs.existsSync(exe)) return exe
    }
    const bunName = platform === 'win32' ? 'bun.exe' : 'bun'
    const bundledBun = path.join(this.cliRoot, 'bin', bunName)
    if (fs.existsSync(bundledBun)) return bundledBun
    try {
      const { execSync } = require('child_process')
      let globalBun: string | null = null
      if (platform === 'win32') {
        const cmd = 'powershell -NoProfile -Command "Get-Command bun -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source"'
        globalBun = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim()
      } else {
        globalBun = execSync('which bun', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split('\n')[0]
      }
      if (globalBun && fs.existsSync(globalBun)) return globalBun
    } catch {}
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
