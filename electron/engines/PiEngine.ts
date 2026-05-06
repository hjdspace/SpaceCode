import type { BrowserWindow } from 'electron'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, AgentInfo } from './types'
import { mapPiEvent } from './PiEventMapper'
import { info, warn, error } from '../logger'

interface PiSessionEntry {
  agent: any
  unsubscribe: () => void
  config: EngineSessionConfig
  status: 'starting' | 'active' | 'idle' | 'exited'
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
      const { codingTools } = await import('@mariozechner/pi-coding-agent')

      const transportOptions: any = {}
      if (config.apiKey) {
        transportOptions.getApiKey = (provider: string) => {
          if (provider === config.provider) return config.apiKey
          return undefined
        }
      }
      if (config.baseUrl) {
        transportOptions.corsProxyUrl = config.baseUrl
      }

      const transport = new ProviderTransport(transportOptions)

      const modelId = config.model || 'claude-sonnet-4-20250514'
      const provider = config.provider || 'anthropic'

      const agentOptions: any = {
        transport,
        tools: codingTools(config.cwd),
        queueMode: 'one-at-a-time',
        initialState: {
          systemPrompt: `You are a helpful coding assistant. Working directory: ${config.cwd}`,
          model: { id: modelId, provider },
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
