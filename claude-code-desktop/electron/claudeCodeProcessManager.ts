import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import { randomUUID } from 'crypto'

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
    // 从 electron 目录向上找到 claude-code 目录
    // electron/claudeCodeProcessManager.ts -> electron/ -> claude-code-desktop/ -> root/
    this.cliRoot = path.resolve(__dirname, '../../claude-code')
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
    // 1. 构建产物 (生产环境)
    // 注意：dist/cli.js 是用 Bun 构建的，shebang 是 #!/usr/bin/env bun
    // 需要使用 bun 运行，而不是 node
    const distCli = path.join(this.cliRoot, 'dist/cli.js')
    if (fs.existsSync(distCli)) {
      return { command: 'bun', args: ['run', distCli] }
    }

    // 2. 源码 (开发环境, 需要 bun)
    // 直接使用 bun 运行 cli.tsx，而不是通过 dev.ts
    // dev.ts 使用 Bun.spawnSync 会导致 stdio 继承问题
    const cliPath = path.join(this.cliRoot, 'src/entrypoints/cli.tsx')
    if (fs.existsSync(cliPath)) {
      // 设置基本的环境变量
      const defineArgs = this.getMacroDefines()
      const featureArgs = this.getFeatureArgs()
      return {
        command: 'bun',
        args: ['run', ...defineArgs, ...featureArgs, cliPath]
      }
    }

    // 3. 全局安装
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
