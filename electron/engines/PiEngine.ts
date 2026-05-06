import type { BrowserWindow } from 'electron'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, AgentInfo } from './types'
import { mapPiEvent } from './PiEventMapper'
import { info, warn, error } from '../logger'
import { codingTools } from '@mariozechner/pi-coding-agent/dist/tools/index.js'

interface PiSessionEntry {
  agent: any
  unsubscribe: () => void
  config: EngineSessionConfig
  status: 'starting' | 'active' | 'idle' | 'exited'
}

const PROVIDER_API_MAP: Record<string, string> = {
  anthropic: 'anthropic-messages',
  openai: 'openai-completions',
  google: 'google-generative-ai',
  xai: 'openai-completions',
  groq: 'openai-completions',
  cerebras: 'openai-completions',
  openrouter: 'openai-completions',
  zai: 'openai-completions',
}

const PROVIDER_BASE_URL_MAP: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com',
  xai: 'https://api.x.ai/v1',
  groq: 'https://api.groq.com/openai/v1',
  cerebras: 'https://api.cerebras.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  zai: 'https://api.zai.chat/v1',
}

let piSdkAvailable: boolean | null = null
let piAgentModule: any = null
let piAiModule: any = null

async function loadPiSdk(): Promise<boolean> {
  if (piSdkAvailable !== null) return piSdkAvailable
  try {
    piAgentModule = await import('@mariozechner/pi-agent')
    piAiModule = await import('@mariozechner/pi-ai')
    piSdkAvailable = true
    info('PiEngine', 'pi-agent SDK loaded successfully')
  } catch (err) {
    piSdkAvailable = false
    warn('PiEngine', 'pi-agent SDK not available', { error: String(err) })
  }
  return piSdkAvailable
}

export class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'
  private mainWindow: BrowserWindow | null = null
  private sessions: Map<string, PiSessionEntry> = new Map()

  static async isAvailableAsync(): Promise<boolean> {
    return loadPiSdk()
  }

  static isAvailable(): boolean {
    if (piSdkAvailable === null) {
      loadPiSdk()
    }
    return piSdkAvailable === true
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    info('PiEngine', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)

    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId)!
      if (existing.status === 'active' || existing.status === 'idle') {
        info('PiEngine', `[${sessionId.slice(0, 8)}] Session already active, reusing`)
        return
      }
    }

    const available = await loadPiSdk()
    if (!available) {
      throw new Error(
        'pi-coding-agent SDK is not installed. ' +
        'Please install it with: npm install @mariozechner/pi-coding-agent'
      )
    }

    try {
      const { Agent } = piAgentModule
      const { ProviderTransport } = piAgentModule

      const modelId = config.model || 'claude-sonnet-4-20250514'
      const provider = config.provider || 'anthropic'

      let model: any = null
      if (piAiModule?.getModel) {
        model = piAiModule.getModel(provider, modelId)
      }

      if (!model) {
        const api = PROVIDER_API_MAP[provider] || 'openai-completions'
        const baseUrl = config.baseUrl || PROVIDER_BASE_URL_MAP[provider] || 'https://api.openai.com/v1'
        model = {
          id: modelId,
          name: modelId,
          api,
          provider,
          baseUrl,
          reasoning: !!config.thinkingEnabled,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 32000,
        }
        info('PiEngine', `[${sessionId.slice(0, 8)}] Model not in registry, constructed default | id=${modelId} | api=${api} | baseUrl=${baseUrl} | reasoning=${model.reasoning}`)
      }

      const transportOptions: any = {}
      if (config.apiKey) {
        transportOptions.getApiKey = (_provider: string) => {
          return config.apiKey
        }
      }

      const transport = new ProviderTransport(transportOptions)

      const agentOptions: any = {
        transport,
        tools: codingTools,
        queueMode: 'one-at-a-time',
        initialState: {
          systemPrompt: `You are a helpful coding assistant. Working directory: ${config.cwd}`,
          model,
          thinkingLevel: config.thinkingEnabled ? 'medium' : 'off',
        },
      }

      const agent = new Agent(agentOptions)

      const unsubscribe = agent.subscribe((event: any) => {
        this.handlePiEvent(sessionId, event)
      })

      this.sessions.set(sessionId, {
        agent,
        unsubscribe,
        config,
        status: 'idle',
      })

      info('PiEngine', `[${sessionId.slice(0, 8)}] Session started successfully | model=${modelId} | provider=${provider}`)
    } catch (err) {
      error('PiEngine', `[${sessionId.slice(0, 8)}] Failed to start session`, { error: String(err) })
      throw err
    }
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) throw new Error(`Session ${sessionId} not found`)

    info('PiEngine', `[${sessionId.slice(0, 8)}] Sending message | contentLen=${content.length}`)
    entry.status = 'active'
    try {
      await entry.agent.prompt(content)
      entry.status = 'idle'
    } catch (err) {
      entry.status = 'idle'
      error('PiEngine', `[${sessionId.slice(0, 8)}] Error sending message`, { error: String(err) })
      throw err
    }
  }

  updateThinkingLevel(sessionId: string, enabled: boolean): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) {
      warn('PiEngine', `[${sessionId.slice(0, 8)}] updateThinkingLevel: session not found`)
      return
    }

    const level = enabled ? 'medium' : 'off'
    entry.agent.setThinkingLevel(level)

    const currentModel = entry.agent.state?.model
    if (currentModel && typeof currentModel === 'object') {
      const updatedModel = { ...currentModel, reasoning: !!enabled }
      entry.agent.setModel(updatedModel)
      info('PiEngine', `[${sessionId.slice(0, 8)}] Model reasoning updated | reasoning=${!!enabled}`)
    }

    entry.config.thinkingEnabled = enabled
    info('PiEngine', `[${sessionId.slice(0, 8)}] Thinking level updated | enabled=${enabled} | level=${level}`)
  }

  async abort(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    info('PiEngine', `[${sessionId.slice(0, 8)}] Aborting session`)
    try {
      entry.agent.abort()
    } catch (err) {
      error('PiEngine', `[${sessionId.slice(0, 8)}] Error aborting session`, { error: String(err) })
    }
  }

  async stop(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    info('PiEngine', `[${sessionId.slice(0, 8)}] Stopping session`)
    entry.unsubscribe()
    this.sessions.delete(sessionId)
  }

  suspendSession?(sessionId: string): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    info('PiEngine', `[${sessionId.slice(0, 8)}] Suspending session`)
    entry.status = 'exited'
  }

  async resumeSession?(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    info('PiEngine', `[${sessionId.slice(0, 8)}] Resuming session`)
    entry.status = 'idle'
  }

  getSessionStatus(sessionId: string): EngineSessionStatus | null {
    const entry = this.sessions.get(sessionId)
    if (!entry) return null
    return {
      sessionId,
      engineSessionId: null,
      status: entry.status,
      isRunning: entry.status === 'active',
    }
  }

  getActiveSessions(): EngineSessionStatus[] {
    return Array.from(this.sessions.entries()).map(([sessionId, entry]) => ({
      sessionId,
      engineSessionId: null,
      status: entry.status,
      isRunning: entry.status === 'active',
    }))
  }

  async listAgents(cwd?: string): Promise<AgentInfo[]> {
    return [
      {
        agentType: 'general-purpose',
        description: 'Pi coding agent - general purpose coding assistant',
        source: 'built-in',
      },
    ]
  }

  private handlePiEvent(sessionId: string, event: any): void {
    const unifiedEvent = mapPiEvent(sessionId, event)
    if (!unifiedEvent) return

    const windowAvailable = this.mainWindow && !this.mainWindow.isDestroyed()
    if (windowAvailable) {
      this.mainWindow!.webContents.send(`claude-code:${unifiedEvent.type}`, { sessionId, data: unifiedEvent.data })
    } else {
      warn('PiEngine', `[${sessionId.slice(0, 8)}] Cannot route event to renderer | type=${unifiedEvent.type}`)
    }
  }
}
