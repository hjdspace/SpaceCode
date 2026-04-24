import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import { randomUUID } from 'crypto'
import { app } from 'electron'

export interface SessionConfig {
  cwd: string
  model?: string
  /** CLI 支持的权限模式: acceptEdits, bypassPermissions, default, dontAsk, plan */
  permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'dontAsk' | 'plan'
  systemPrompt?: string
  appendSystemPrompt?: string
  maxTurns?: number
  maxBudgetUsd?: number
  apiKey?: string
  verbose?: boolean
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

  /**
   * 解析 Bun 可执行文件路径
   * 优先级：1. 捆绑的 bun 二进制 > 2. 系统 PATH 中的 bun
   */
  private resolveBunPath(): string {
    const platform = process.platform
    const bunName = platform === 'win32' ? 'bun.exe' : 'bun'

    // 1. 优先使用捆绑的 bun 二进制
    const bundledBun = path.join(
      this.cliRoot, 'bin', bunName
    )

    if (fs.existsSync(bundledBun)) {
      console.log('[Engine] Using bundled bun:', bundledBun)
      return bundledBun
    }

    // 2. 检查用户是否通过 npm/yarn 全局安装了 bun
    try {
      const { execSync } = require('child_process')
      const cmd = platform === 'win32' ? 'where bun' : 'which bun'
      const globalBun = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim().split('\n')[0]
      if (globalBun && fs.existsSync(globalBun)) {
        console.log('[Engine] Using global bun:', globalBun)
        return globalBun
      }
    } catch {
      // not found, fall through
    }

    // 3. 回退到 PATH 中的 bun
    console.log('[Engine] Using bun from PATH')
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

    this.process.on('error', (error) => {
      this.emit('error', error)
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
      this.process.stdin.write(JSON.stringify({ type: 'abort' }) + '\n')
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
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--include-partial-messages', // 启用流式消息输出
    ]
    if (config.model) args.push('--model', config.model)
    if (config.permissionMode) args.push('--permission-mode', config.permissionMode)
    if (config.systemPrompt) args.push('--system-prompt', config.systemPrompt)
    if (config.appendSystemPrompt) args.push('--append-system-prompt', config.appendSystemPrompt)
    if (config.maxTurns) args.push('--max-turns', String(config.maxTurns))
    if (config.maxBudgetUsd) args.push('--max-budget-usd', String(config.maxBudgetUsd))
    return args
  }

  private buildEnv(config: SessionConfig): Record<string, string> {
    const env: Record<string, string> = {}
    if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey
    // 确保 bun 能找到正确的项目根目录
    env.CLaude_CODE_ROOT = this.cliRoot
    return env
  }

  private resolveCliCommand(): { command: string; args: string[] } {
    const isDev = !app.isPackaged

    // 开发模式：优先使用源码（更快迭代，无需等待构建）
    if (isDev) {
      const srcCliPath = path.join(this.cliRoot, 'src/entrypoints/cli.tsx')
      if (fs.existsSync(srcCliPath)) {
        console.log('[Engine] Using source code (dev mode):', srcCliPath)
        const defineArgs = this.getMacroDefines()
        const featureArgs = this.getFeatureArgs()
        return {
          command: this.resolveBunPath(),
          args: ['run', ...defineArgs, ...featureArgs, srcCliPath]
        }
      }
    }

    // 生产模式：优先使用构建产物（启动更快）
    const distCli = path.join(this.cliRoot, 'dist/cli.js')
    if (fs.existsSync(distCli)) {
      console.log('[Engine] Using built distribution:', distCli)
      return { command: this.resolveBunPath(), args: ['run', distCli] }
    }

    // 回退到源码（生产环境但无构建产物时）
    const srcCliPath = path.join(this.cliRoot, 'src/entrypoints/cli.tsx')
    if (fs.existsSync(srcCliPath)) {
      console.log('[Engine] Using source code (fallback):', srcCliPath)
      const defineArgs = this.getMacroDefines()
      const featureArgs = this.getFeatureArgs()
      return {
        command: this.resolveBunPath(),
        args: ['run', ...defineArgs, ...featureArgs, srcCliPath]
      }
    }

    // 最后回退到全局安装的 claude 命令
    console.warn('[Engine] No local engine found, falling back to global claude command')
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
    ]
    return features.flatMap(f => ['--feature', f])
  }

  private handleSDKMessage(msg: any) {
    switch (msg.type) {
      case 'assistant':
        this.emit('assistant', msg)
        break
      case 'user':
        this.emit('user', msg)
        break
      case 'tool_use':
        this.emit('tool_use', msg)
        break
      case 'tool_result':
        this.emit('tool_result', msg)
        break
      case 'system':
        if (msg.subtype === 'compact_boundary')
          this.emit('compact', msg)
        else if (msg.subtype === 'api_retry')
          this.emit('api_retry', msg)
        else
          this.emit('system', msg)
        break
      case 'result':
        this.emit('result', msg)
        break
      case 'stream_event':
        this.emit('stream_event', msg)
        break
      default:
        this.emit('unknown', msg)
    }
  }
}
