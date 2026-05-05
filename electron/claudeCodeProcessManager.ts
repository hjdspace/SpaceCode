import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { randomUUID } from 'crypto'
import { app } from 'electron'

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
}

export class ClaudeCodeProcessManager extends EventEmitter {
  private process: ChildProcess | null = null
  private sessionId: string | null = null
  private buffer: string = ''
  private cliRoot: string
  private currentConfig: SessionConfig | null = null

  constructor() {
    super()
    // 根据是否打包选择 engine 目录路径
    // 开发环境: electron/ -> root/engine/
    // 生产环境: resources/engine/
    const isPackaged = app.isPackaged
    if (isPackaged) {
      this.cliRoot = path.join(process.resourcesPath, 'engine')
    } else {
      this.cliRoot = path.resolve(__dirname, '../engine')
    }
  }

  private resolveBunPath(): string {
    const bundled = path.join(this.cliRoot, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun')
    if (fs.existsSync(bundled)) return bundled
    const userInstalled = process.platform === 'win32'
      ? path.join(os.homedir(), '.bun', 'bin', 'bun.exe')
      : path.join(os.homedir(), '.bun', 'bin', 'bun')
    if (fs.existsSync(userInstalled)) return userInstalled
    return 'bun'
  }

  isSessionActive(): boolean {
    return this.process !== null && !this.process.killed
  }

  async startSession(config: SessionConfig): Promise<string> {
    // 如果已经有活跃的会话，且工作目录相同，则复用
    if (this.isSessionActive() && this.currentConfig?.cwd === config.cwd) {
      return this.sessionId!
    }

    // 如果有旧的会话，先停止
    if (this.process) {
      await this.stop()
    }

    const { command, args: cliArgs } = this.resolveCliCommand()
    const args = [...cliArgs, ...this.buildArgs(config)]
    const env = this.buildEnv(config)

    this.currentConfig = config

    this.process = spawn(command, args, {
      cwd: config.cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    })

    // 进程启动失败时立即触发
    this.process.on('error', (err) => {
      this.emit('error', err)
    })

    // 解析 stdout 的 NDJSON stream
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
          } catch (e) {
            // JSON 解析错误时静默处理
          }
        }
      }
    })

    // stderr 用于日志
    this.process.stderr!.on('data', (data) => {
      this.emit('log', data.toString())
    })

    this.process.on('exit', (code, signal) => {
      this.emit('exit', code)
      this.process = null
    })

    return this.sessionId = randomUUID()
  }

  async sendMessage(content: string): Promise<void> {
    if (!this.process) throw new Error('No active session')
    // CLI 期望的消息格式: { type: 'user', message: { role: 'user', content } }
    const msg = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content
      }
    }) + '\n'
    this.process.stdin!.write(msg)
  }

  async abort(): Promise<void> {
    if (this.process?.stdin?.writable) {
      // 发送正确的 control_request 消息格式来中断当前对话轮次
      // 引擎期望的格式: { type: 'control_request', request_id: '...', request: { subtype: 'interrupt' } }
      const abortMessage = {
        type: 'control_request',
        request_id: randomUUID(),
        request: {
          subtype: 'interrupt'
        }
      }
      this.process.stdin.write(JSON.stringify(abortMessage) + '\n')
    }
  }

  async stop(): Promise<void> {
    if (this.process) {
      this.process.kill()
      this.process = null
      this.sessionId = null
    }
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  private buildArgs(config: SessionConfig): string[] {
    const args: string[] = []

    // CLI 入口由 resolveCliCommand 提供，这里只添加通用参数
    args.push(
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--include-partial-messages', // 启用流式消息输出
    )

    // 引擎通过 settings.json 的 modelType 字段判断 API provider
    // 我们写入临时 settings.json 并通过 --settings 传入
    const provider = (config.provider || 'anthropic').toLowerCase()
    const modelType = provider === 'openai' ? 'openai'
      : provider === 'gemini' ? 'gemini'
      : provider === 'grok' ? 'grok'
      : undefined

    if (modelType) {
      const settingsDir = path.join(os.tmpdir(), 'SpaceCode')
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

    // 批次1新增：权限提示工具输出方式
    args.push('--permission-prompt-tool', 'stdio')

    // 批次1新增：添加 Claude 配置目录 (~/.claude)
    const claudeDir = path.join(os.homedir(), '.claude')
    if (fs.existsSync(claudeDir)) {
      args.push('--add-dir', claudeDir)
    }

    // 批次1新增：thinking 模式开关
    args.push('--thinking', config.thinkingEnabled ? 'enabled' : 'disabled')

    return args
  }

  private buildEnv(config: SessionConfig): Record<string, string> {
    const env: Record<string, string> = {}
    const provider = (config.provider || 'anthropic').toLowerCase()

    // 统一设置 provider，供引擎按供应商选择 API 适配器
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
      // 默认走 Anthropic 兼容路径
      if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey
      if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl
    }

    // 兼容部分网关/适配器读取 Anthropic 变量的场景
    if (config.apiKey && !env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = config.apiKey
    }

    // 确保 bun 能找到正确的项目根目录
    env.CLAUDE_CODE_ROOT = this.cliRoot

    // 批次1新增：Windows Git Bash 路径检测与设置
    const gitBashPath = this.findGitBashPath()
    if (gitBashPath && !process.env.CLAUDE_CODE_GIT_BASH_PATH) {
      env.CLAUDE_CODE_GIT_BASH_PATH = gitBashPath
    }

    // 批次1新增：提升 Read 工具的每文件 token 上限
    if (!process.env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS) {
      env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS = '80000'
    }

    // TODO: 保留此代码以备后续需要强制禁用 Todo V2 功能时启用
    // env.CLAUDE_CODE_ENABLE_TASKS = 'false'
    return env
  }

  /**
   * 检测 Windows 上的 Git Bash 路径（Claude Code SDK 需要）
   */
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
    // Fallback: try `where git` and derive bash path from it
    try {
      const out = require('child_process').execSync('where git', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      const gitExe = out.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)[0]
      if (gitExe) {
        const bashFromGit = path.join(path.dirname(path.dirname(gitExe)), 'bin', 'bash.exe')
        if (fs.existsSync(bashFromGit)) return bashFromGit
      }
    } catch (_) {}
    return null
  }

  private resolveCliCommand(): { command: string; args: string[] } {
    const isDev = !app.isPackaged

    // 开发模式：优先使用源码（更快迭代，无需等待构建）
    if (isDev) {
      const srcCliPath = path.join(this.cliRoot, 'src/entrypoints/cli.tsx')
      if (fs.existsSync(srcCliPath)) {
        const defineArgs = this.getMacroDefines()
        const featureArgs = this.getFeatureArgs()
        const bunArgs = ['run', ...defineArgs, ...featureArgs]
        // 开发模式：添加 preload 和 env-file（Bun 选项，必须放在 run 和入口文件之间）
        const preloadPath = path.join(this.cliRoot, 'preload.ts')
        if (fs.existsSync(preloadPath)) {
          bunArgs.push('--preload', preloadPath)
        }
        const envFilePath = path.join(this.cliRoot, '.env')
        if (fs.existsSync(envFilePath)) {
          bunArgs.push('--env-file=' + envFilePath)
        }
        bunArgs.push(srcCliPath)
        return {
          command: this.resolveBunPath(),
          args: bunArgs
        }
      }
    }

    // 生产模式：优先使用构建产物（启动更快）
    const distCli = path.join(this.cliRoot, 'dist/cli.js')
    if (fs.existsSync(distCli)) {
      return { command: this.resolveBunPath(), args: ['run', distCli] }
    }

    // 回退到源码（生产环境但无构建产物时）
    const srcCliPath = path.join(this.cliRoot, 'src/entrypoints/cli.tsx')
    if (fs.existsSync(srcCliPath)) {
      const defineArgs = this.getMacroDefines()
      const featureArgs = this.getFeatureArgs()
      const bunArgs = ['run', ...defineArgs, ...featureArgs]
      // 回退到源码时也添加 preload 和 env-file
      const preloadPath = path.join(this.cliRoot, 'preload.ts')
      if (fs.existsSync(preloadPath)) {
        bunArgs.push('--preload', preloadPath)
      }
      const envFilePath = path.join(this.cliRoot, '.env')
      if (fs.existsSync(envFilePath)) {
        bunArgs.push('--env-file=' + envFilePath)
      }
      bunArgs.push(srcCliPath)
      return {
        command: this.resolveBunPath(),
        args: bunArgs
      }
    }

    // 最后回退到全局安装的 claude 命令
    return { command: 'claude', args: [] }
  }

  private getMacroDefines(): string[] {
    // 基本的 MACRO 定义，用于开发模式
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
    // 默认启用的功能
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
      'PROACTIVE', //'REVIEW_ARTIFACT', // API 请求无响应，需进一步排查 schema 兼容性
      'WEB_BROWSER_TOOL', 'BUILDING_CLAUDE_APPS', /*'RUN_SKILL_GENERATOR',*/
    ]
    return features.flatMap(f => ['--feature', f])
  }

  private handleSDKMessage(msg: any) {
    switch (msg.type) {
      case 'assistant': {
        // Agent 完整响应（包含思考过程、工具调用等）
        const content = msg.message?.content
        let textPreview = ''
        let reasoningPreview = ''
        let toolNames: string[] = []

        if (Array.isArray(content)) {
          const textItem = content.find((c: any) => c.type === 'text')
          const reasoningItem = content.find((c: any) => c.type === 'thinking')
          const toolUses = content.filter((c: any) => c.type === 'tool_use')

          if (textItem?.text) textPreview = textItem.text.slice(0, 200)
          if (reasoningItem?.thinking || reasoningItem?.text) {
            reasoningPreview = (reasoningItem.thinking || reasoningItem.text).slice(0, 200)
          }
          toolNames = toolUses.map((t: any) => t.name)
        } else if (typeof content === 'string') {
          textPreview = content.slice(0, 200)
        }

        console.log('[LLM] Assistant response:', {
          text: textPreview || '(no text)',
          reasoning: reasoningPreview || '(no reasoning)',
          tools: toolNames.length > 0 ? toolNames : '(no tools)'
        })
        this.emit('assistant', msg)
        break
      }
      case 'user': {
        // 用户输入消息
        const userContent = msg.message?.content
        const userText = typeof userContent === 'string'
          ? userContent
          : JSON.stringify(userContent)
        console.log('[LLM] User message:', userText.slice(0, 200))
        this.emit('user', msg)
        break
      }
      case 'tool_use': {
        // 工具调用开始
        const toolName = msg.name || msg.tool_use?.name
        const toolInput = msg.input || msg.tool_use?.input
        console.log('[LLM] Tool call:', toolName, '| Input:', JSON.stringify(toolInput).slice(0, 300))
        this.emit('tool_use', msg)
        break
      }
      case 'tool_result': {
        // 工具调用结果
        const toolUseId = msg.tool_use_id || msg.tool_result?.tool_use_id
        const output = msg.output || msg.tool_result?.output
        const isError = msg.is_error || msg.tool_result?.is_error
        console.log('[LLM] Tool result:', toolUseId, '| Status:', isError ? 'ERROR' : 'OK', '| Output:', String(output).slice(0, 300))
        this.emit('tool_result', msg)
        break
      }
      case 'system':
        if (msg.subtype === 'compact_boundary')
          this.emit('compact', msg)
        else if (msg.subtype === 'api_retry')
          this.emit('api_retry', msg)
        else
          this.emit('system', msg)
        break
      case 'stream_event': {
        const delta = msg.event?.delta
        if (delta?.thinking) {
          console.log('[LLM] Thinking:', delta.thinking.slice(0, 200))
        }
        this.emit('stream_event', msg)
        break
      }
      case 'result':
        // 对话结束
        console.log('[LLM] Response complete')
        this.emit('result', msg)
        break
      default:
        this.emit('unknown', msg)
    }
  }
}
