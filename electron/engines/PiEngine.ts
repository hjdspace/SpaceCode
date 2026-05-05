import type { BrowserWindow } from 'electron'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, AgentInfo, UnifiedEngineEvent } from './types'
import { mapPiEvent } from './PiEventMapper'
import { info, warn, error } from '../logger'

interface PiSessionEntry {
  session: any
  unsubscribe: () => void
  config: EngineSessionConfig
  status: 'starting' | 'active' | 'idle' | 'exited'
}

export class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'
  private mainWindow: BrowserWindow | null = null
  private sessions: Map<string, PiSessionEntry> = new Map()

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

    try {
      const { createAgentSession } = await import('@mariozechner/pi-coding-agent')
      const { AuthStorage } = await import('@mariozechner/pi-coding-agent')
      const { ModelRegistry } = await import('@mariozechner/pi-coding-agent')

      const authStorage = AuthStorage.create()
      if (config.apiKey && config.provider) {
        await authStorage.setApiKey(config.provider, config.apiKey)
      }

      const modelRegistry = ModelRegistry.create(authStorage)

      const piConfig: any = {
        cwd: config.cwd,
        authStorage,
        modelRegistry,
      }

      if (config.model) {
        const models = await modelRegistry.getAvailable()
        const matched = models.find((m: any) => m.id === config.model || m.id.includes(config.model!))
        if (matched) {
          piConfig.model = matched
        }
      }

      if (config.thinkingEnabled !== undefined) {
        piConfig.thinkingLevel = config.thinkingEnabled ? 'medium' : 'off'
      }

      const { session } = await createAgentSession(piConfig)

      const unsubscribe = session.subscribe((event: any) => {
        this.handlePiEvent(sessionId, event)
      })

      this.sessions.set(sessionId, {
        session,
        unsubscribe,
        config,
        status: 'idle',
      })

      info('PiEngine', `[${sessionId.slice(0, 8)}] Session started successfully`)
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
      await entry.session.prompt(content)
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
      await entry.session.abort()
    } catch (err) {
      error('PiEngine', `[${sessionId.slice(0, 8)}] Error aborting session`, { error: String(err) })
    }
  }

  async stop(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    info('PiEngine', `[${sessionId.slice(0, 8)}] Stopping session`)
    entry.unsubscribe()
    try {
      entry.session.dispose()
    } catch {}
    this.sessions.delete(sessionId)
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
