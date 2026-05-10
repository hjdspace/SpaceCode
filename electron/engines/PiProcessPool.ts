import { BrowserWindow } from 'electron'
import { PiSessionProcess } from './PiSessionProcess'
import type { EngineSessionConfig, EngineSessionStatus } from './types'
import type { ProcessStatus } from '../sessionProcess'
import { mapPiEvent } from './PiEventMapper'
import { info, warn, error, debug } from '../logger'

const MAX_PROCESSES = 3

export class PiProcessPool {
  private processes: Map<string, PiSessionProcess> = new Map()
  private mainWindow: BrowserWindow | null = null

  private poolHandlers: Map<string, {
    message: (msg: any) => void
    exit: (code: number | null, signal?: NodeJS.Signals | null, stderrTail?: string) => void
    error: (err: Error) => void
  }> = new Map()

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  getActiveCount(): number {
    return Array.from(this.processes.values()).filter(p => p.isRunning()).length
  }

  getSessionStatus(sessionId: string): EngineSessionStatus | null {
    const proc = this.processes.get(sessionId)
    if (!proc) return null

    return {
      sessionId: proc.sessionId,
      engineSessionId: null,
      status: proc.status,
      isRunning: proc.isRunning(),
    }
  }

  getActiveSessions(): EngineSessionStatus[] {
    return Array.from(this.processes.values()).map(proc => ({
      sessionId: proc.sessionId,
      engineSessionId: null,
      status: proc.status,
      isRunning: proc.isRunning(),
    }))
  }

  getProcess(sessionId: string): PiSessionProcess | undefined {
    return this.processes.get(sessionId)
  }

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    info('PiProcessPool', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd}`)

    if (this.processes.has(sessionId)) {
      const existing = this.processes.get(sessionId)!
      if (existing.isRunning()) {
        info('PiProcessPool', `[${sessionId.slice(0, 8)}] Session already running, reusing`)
        return
      }
      if (existing.status === 'suspended') {
        info('PiProcessPool', `[${sessionId.slice(0, 8)}] Session is suspended, resuming`)
        await this.resumeSession(sessionId)
        return
      }
    }

    this.evictIfNeeded()

    const proc = new PiSessionProcess(sessionId, config)
    this.processes.set(sessionId, proc)

    this.attachPoolHandlers(sessionId, proc)

    try {
      await proc.start()
      info('PiProcessPool', `[${sessionId.slice(0, 8)}] Session started | totalActive=${this.getActiveCount()}`)
    } catch (err) {
      error('PiProcessPool', `[${sessionId.slice(0, 8)}] Failed to start session`, err)
      this.detachPoolHandlers(sessionId, proc)
      this.processes.delete(sessionId)
      throw err
    }
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      error('PiProcessPool', `[${sessionId.slice(0, 8)}] sendMessage failed: no active process`)
      throw new Error(`Session ${sessionId} has no active process`)
    }

    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Forwarding user message | contentLen=${content.length}`)
    await proc.sendMessage(content)
  }

  abortSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return

    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Aborting session`)
    proc.abort()
  }

  suspendSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return

    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Suspending session | canSafelySuspend=${proc.canSafelySuspend()}`)
    proc.suspend()
    this.routeEvent(sessionId, 'suspended', { reason: 'user_request' })
  }

  async resumeSession(sessionId: string): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc) throw new Error(`Session ${sessionId} not found`)
    if (proc.status !== 'suspended') throw new Error(`Session ${sessionId} is not suspended`)

    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Resuming session`)

    this.evictIfNeeded()

    this.detachPoolHandlers(sessionId, proc)
    this.attachPoolHandlers(sessionId, proc)

    try {
      await proc.resume()
      info('PiProcessPool', `[${sessionId.slice(0, 8)}] Session resumed successfully`)
    } catch (err) {
      error('PiProcessPool', `[${sessionId.slice(0, 8)}] Failed to resume session`, err)
      throw err
    }
  }

  killSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return

    info('PiProcessPool', `[${sessionId.slice(0, 8)}] Killing session`)
    this.detachPoolHandlers(sessionId, proc)
    proc.kill()
    this.processes.delete(sessionId)
  }

  killAll(): void {
    this.processes.forEach((proc, sessionId) => {
      this.detachPoolHandlers(sessionId, proc)
      proc.kill()
    })
    this.processes.clear()
    this.poolHandlers.clear()
  }

  private evictIfNeeded(): void {
    const runningCount = this.getActiveCount()
    if (runningCount < MAX_PROCESSES) return

    info('PiProcessPool', `Eviction needed | running=${runningCount} | max=${MAX_PROCESSES}`)

    const safeIdleCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && p.status === 'idle' && p.canSafelySuspend())
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    if (safeIdleCandidates.length > 0) {
      const victim = safeIdleCandidates[0]
      info('PiProcessPool', `[${victim.sessionId.slice(0, 8)}] Evicting idle session`)
      victim.suspend()
      this.routeEvent(victim.sessionId, 'suspended', { reason: 'eviction' })
      return
    }

    const safeActiveCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && p.status === 'active' && p.canSafelySuspend())
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    if (safeActiveCandidates.length > 0) {
      const victim = safeActiveCandidates[0]
      info('PiProcessPool', `[${victim.sessionId.slice(0, 8)}] Evicting active session`)
      victim.suspend()
      this.routeEvent(victim.sessionId, 'suspended', { reason: 'eviction' })
      return
    }

    warn('PiProcessPool', `Cannot evict: sessions have pending operations`)
  }

  private attachPoolHandlers(sessionId: string, proc: PiSessionProcess): void {
    const handlers = {
      message: (msg: any) => this.routeEvent(sessionId, msg.type, msg),
      exit: (code: number | null, signal?: NodeJS.Signals | null, stderrTail?: string) => {
        this.routeEvent(sessionId, 'exit', { code, signal, stderr: stderrTail })
      },
      error: (err: Error) => this.routeEvent(sessionId, 'error', { message: err.message }),
    }

    this.poolHandlers.set(sessionId, handlers)
    proc.on('message', handlers.message)
    proc.on('exit', handlers.exit)
    proc.on('error', handlers.error)

    debug('PiProcessPool', `[${sessionId.slice(0, 8)}] Pool handlers attached`)
  }

  private detachPoolHandlers(sessionId: string, proc: PiSessionProcess): void {
    const handlers = this.poolHandlers.get(sessionId)
    if (!handlers) return

    proc.removeListener('message', handlers.message)
    proc.removeListener('exit', handlers.exit)
    proc.removeListener('error', handlers.error)
    this.poolHandlers.delete(sessionId)

    debug('PiProcessPool', `[${sessionId.slice(0, 8)}] Pool handlers detached`)
  }

  private routeEvent(sessionId: string, eventType: string, data: any): void {
    const shortSid = sessionId.slice(0, 8)
    const windowAvailable = this.mainWindow && !this.mainWindow.isDestroyed()

    const unifiedEvent = mapPiEvent(sessionId, { type: eventType, ...data })

    if (!unifiedEvent) {
      info('PiProcessPool', `[${shortSid}] route → DROPPED | rawType=${eventType} | hasAssistantMsgEvent=${!!data?.assistantMessageEvent} | msgRole=${data?.message?.role || '(none)'}`)
      return
    }

    if (!windowAvailable) {
      warn('PiProcessPool', `[${shortSid}] Cannot route event | window unavailable | type=${eventType}`)
      return
    }

    this.mainWindow!.webContents.send(
      `claude-code:${unifiedEvent.type}`,
      { sessionId, data: unifiedEvent.data }
    )
    info('PiProcessPool', `[${shortSid}] route → renderer | type=${unifiedEvent.type}`)
  }
}
