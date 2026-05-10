import { EventEmitter } from 'events'
import * as path from 'path'
import * as fs from 'fs'
import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'
import type { ProcessStatus } from '../sessionProcess'
import type { EngineSessionConfig } from './types'
import { info, warn, error, debug } from '../logger'

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

  constructor(sessionId: string, config: EngineSessionConfig) {
    super()
    this.sessionId = sessionId
    this.config = config
    debug('PiSessionProcess', `Constructed | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)
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

      if (cliPath === 'pi') {
        // Global `pi` CLI command
        command = 'pi'
        spawnArgs = ['--mode', 'rpc', ...baseArgs]
      } else if (cliPath === 'npx') {
        // Fallback: npx @mariozechner/pi-coding-agent
        command = 'npx'
        spawnArgs = ['@mariozechner/pi-coding-agent', '--mode', 'rpc', ...baseArgs]
      } else {
        // Direct path to cli.js - run with node
        command = 'node'
        spawnArgs = [cliPath, '--mode', 'rpc', ...baseArgs]
      }

      info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Starting Pi RPC process | command=${command} | args=${spawnArgs.join(' ')}`)

      this._process = spawn(command, spawnArgs, {
        cwd: this.config.cwd,
        env,
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

  async sendMessage(content: string): Promise<void> {
    if (!this._process || this.status === 'exited') {
      throw new Error(`Session ${this.sessionId} has no active process`)
    }

    this.status = 'active'
    this._isProcessing = true
    this.lastActivityAt = Date.now()

    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Sending prompt | contentLen=${content.length}`)

    try {
      const id = `req_${++this._requestId}`
      const command = { id, type: 'prompt', message: content }
      
      // Wait for response confirmation
      const responsePromise = new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this._pendingRequests.delete(id)
          reject(new Error('Timeout waiting for prompt response'))
        }, 30000)
        
        this._pendingRequests.set(id, {
          resolve: (response) => {
            clearTimeout(timeout)
            resolve(response)
          },
          reject: (error) => {
            clearTimeout(timeout)
            reject(error)
          }
        })
      })
      
      const message = JSON.stringify(command) + '\n'
      this._process.stdin?.write(message)
      
      // Wait for response
      const response = await responsePromise
      
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

  async abort(): Promise<void> {
    if (!this._process) return

    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Aborting current operation`)
    try {
      const message = JSON.stringify({ type: 'abort' }) + '\n'
      this._process.stdin?.write(message)
    } catch (err) {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Abort failed`, err)
    }
  }

  async setThinkingLevel(level: string): Promise<void> {
    if (!this._process) return

    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Setting thinking level | level=${level}`)
    try {
      const message = JSON.stringify({ type: 'set_thinking_level', level }) + '\n'
      this._process.stdin?.write(message)
    } catch (err) {
      warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Set thinking level failed`, err)
    }
  }

  async suspend(): Promise<void> {
    if (!this._process) return

    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Suspending | pendingTools=${this._pendingToolCalls.size}`)

    this.status = 'suspended'
    this._process.stdin?.end()
    this._process = null
  }

  async resume(): Promise<void> {
    info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Resuming session`)
    await this.start()
  }

  async kill(): Promise<void> {
    if (this._process) {
      info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] Killing process`)
      this._process.kill('SIGTERM')
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

  private resolveCliPath(): string {
    const isPackaged = app.isPackaged

    // Strategy 1: __dirname-relative paths (works in both dev and packaged modes)
    // In dev: __dirname = dist-electron/ → ../../ = project root
    // In packaged: __dirname = app.asar/dist-electron/ → ../../ = app root
    const devPaths = [
      path.resolve(__dirname, '../../node_modules/@mariozechner/pi-coding-agent/dist/cli.js'),
      path.resolve(__dirname, '../../../node_modules/@mariozechner/pi-coding-agent/dist/cli.js'),
    ]
    for (const p of devPaths) {
      if (fs.existsSync(p)) {
        info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (__dirname-relative): ${p}`)
        return p
      }
    }

    // Strategy 2: app.getAppPath()-relative (reliable in Electron dev mode)
    if (!isPackaged) {
      try {
        const appPath = app.getAppPath()
        const appRoot = appPath.endsWith('.asar') ? path.dirname(appPath) : appPath
        const appRelativePath = path.join(appRoot, 'node_modules/@mariozechner/pi-coding-agent/dist/cli.js')
        if (fs.existsSync(appRelativePath)) {
          info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (appPath-relative): ${appRelativePath}`)
          return appRelativePath
        }
        // Also check local pi-engine monorepo
        const localPiPath = path.join(appRoot, 'pi-engine/packages/coding-agent/dist/cli.js')
        if (fs.existsSync(localPiPath)) {
          info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (local pi-engine): ${localPiPath}`)
          return localPiPath
        }
      } catch {
        // app might not be ready
      }
    }

    // Strategy 3: process.cwd()-relative (fallback for unusual setups)
    const cwdPath = path.join(process.cwd(), 'node_modules/@mariozechner/pi-coding-agent/dist/cli.js')
    if (fs.existsSync(cwdPath)) {
      info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (cwd-relative): ${cwdPath}`)
      return cwdPath
    }

    // Strategy 4: Packaged app: look in resources
    const packagedPaths = [
      path.join(process.resourcesPath || '', 'node_modules/@mariozechner/pi-coding-agent/dist/cli.js'),
      path.join(process.resourcesPath || '', 'pi-engine/dist/cli.js'),
    ]
    for (const p of packagedPaths) {
      if (fs.existsSync(p)) {
        info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (packaged): ${p}`)
        return p
      }
    }

    // Strategy 5: Check if `pi` CLI is available globally
    try {
      const { execSync } = require('child_process')
      const cmd = process.platform === 'win32' ? 'where pi' : 'which pi'
      execSync(cmd, { stdio: 'ignore' })
      info('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] CLI resolved (global 'pi' command)`)
      return 'pi'
    } catch {
      // pi not available globally
    }

    // Fallback: try to use npx
    warn('PiSessionProcess', `[${this.sessionId.slice(0, 8)}] No pi CLI found, falling back to npx`)
    return 'npx'
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

    // Note: pi-ai does not read OPENAI_BASE_URL. Built-in providers have their baseUrl
    // baked into the model registry (openrouter → https://openrouter.ai/api/v1, etc.)
    // so the baseUrl passed in config is only used to detect which provider to use.
    // For truly custom endpoints, the user needs a models.json entry.

    return env
  }

  private buildArgs(): string[] {
    const args: string[] = []

    const provider = this.resolveEffectiveProvider()
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
    if (this.config.thinkingEnabled) args.push('--thinking', 'medium')
    if (this.config.systemPrompt) args.push('--system-prompt', this.config.systemPrompt)
    if (this.config.appendSystemPrompt) args.push('--append-system-prompt', this.config.appendSystemPrompt)

    return args
  }
}
