import { BrowserWindow } from 'electron'
import { SessionProcess, ProcessStatus } from './sessionProcess'
import { SessionConfig } from './claudeCodeProcessManager'
import { info, warn, error, debug } from './logger'

const MAX_PROCESSES = 3

export interface SessionStatusInfo {
  sessionId: string
  engineSessionId: string | null
  status: ProcessStatus
  isRunning: boolean
}

export class ClaudeCodeProcessPool {
  private processes: Map<string, SessionProcess> = new Map()
  private mainWindow: BrowserWindow | null = null
  private poolHandlers: Map<string, { message: (msg: any) => void; log: (data: string) => void; exit: (code: number | null) => void; error: (err: Error) => void }> = new Map()

  setMainWindow(window: BrowserWindow) {
    this.mainWindow = window
  }

  async startSession(sessionId: string, config: SessionConfig): Promise<void> {
    info('ProcessPool', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model} | existing=${this.processes.has(sessionId)}`)

    if (this.processes.has(sessionId)) {
      const existing = this.processes.get(sessionId)!
      if (existing.isRunning()) {
        info('ProcessPool', `[${sessionId.slice(0, 8)}] Session already running, reusing`)
        return
      }
      if (existing.status === 'suspended' && existing.engineSessionId) {
        info('ProcessPool', `[${sessionId.slice(0, 8)}] Session is suspended, resuming | engineSessionId=${existing.engineSessionId}`)
        await this.resumeSession(sessionId)
        return
      }
      // Dead/exited entry — drop it so a fresh process can take over cleanly.
      info('ProcessPool', `[${sessionId.slice(0, 8)}] Evicting stale session entry | status=${existing.status}`)
      this.detachPoolHandlers(sessionId, existing)
      this.processes.delete(sessionId)
    }

    this.evictIfNeeded()

    const proc = new SessionProcess(sessionId, config)
    this.processes.set(sessionId, proc)

    this.attachPoolHandlers(sessionId, proc)

    try {
      await proc.start()
      info('ProcessPool', `[${sessionId.slice(0, 8)}] Session started successfully | pid=${proc.process?.pid} | totalActive=${Array.from(this.processes.values()).filter(p => p.isRunning()).length}`)
    } catch (err) {
      error('ProcessPool', `[${sessionId.slice(0, 8)}] Failed to start session`, { error: String(err) })
      throw err
    }
  }

  async resumeSession(sessionId: string): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc) throw new Error(`Session ${sessionId} not found`)
    if (proc.status !== 'suspended') throw new Error(`Session ${sessionId} is not suspended`)

    info('ProcessPool', `[${sessionId.slice(0, 8)}] Resuming session | engineSessionId=${proc.engineSessionId}`)

    this.evictIfNeeded()

    this.detachPoolHandlers(sessionId, proc)
    this.attachPoolHandlers(sessionId, proc)

    try {
      await proc.resume()
      info('ProcessPool', `[${sessionId.slice(0, 8)}] Session resumed successfully`)
    } catch (err) {
      error('ProcessPool', `[${sessionId.slice(0, 8)}] Failed to resume session`, { error: String(err) })
      throw err
    }
  }

  suspendSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Suspending session | canSafelySuspend=${proc.canSafelySuspend()} | pendingTools=${proc.getPendingToolCount()}`)
    proc.suspend()
  }

  sendMessage(sessionId: string, content: string, images?: any[]): void {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) {
      error('ProcessPool', `[${sessionId.slice(0, 8)}] sendMessage failed: no active process | hasProcess=${!!proc} | isRunning=${proc?.isRunning()}`)
      throw new Error(`Session ${sessionId} has no active process`)
    }
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Forwarding user message | contentLen=${content.length} | images=${images?.length || 0}`)
    proc.sendMessage(content, images)
  }

  abortSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Aborting session`)
    proc.abort()
  }

  killSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return
    info('ProcessPool', `[${sessionId.slice(0, 8)}] Killing session`)
    this.detachPoolHandlers(sessionId, proc)
    proc.kill()
    this.processes.delete(sessionId)
  }

  getSessionStatus(sessionId: string): SessionStatusInfo | null {
    const proc = this.processes.get(sessionId)
    if (!proc) return null
    return {
      sessionId: proc.sessionId,
      engineSessionId: proc.engineSessionId,
      status: proc.status,
      isRunning: proc.isRunning()
    }
  }

  getActiveSessions(): SessionStatusInfo[] {
    return Array.from(this.processes.values()).map(proc => ({
      sessionId: proc.sessionId,
      engineSessionId: proc.engineSessionId,
      status: proc.status,
      isRunning: proc.isRunning()
    }))
  }

  getEngineSessionId(sessionId: string): string | null {
    return this.processes.get(sessionId)?.engineSessionId ?? null
  }

  killAll(): void {
    info('ProcessPool', `Killing all sessions | count=${this.processes.size}`)
    for (const [sessionId, proc] of this.processes.entries()) {
      this.detachPoolHandlers(sessionId, proc)
      proc.kill()
    }
    this.processes.clear()
    this.poolHandlers.clear()
  }

  private evictIfNeeded(): void {
    const runningCount = Array.from(this.processes.values()).filter(p => p.isRunning()).length
    if (runningCount < MAX_PROCESSES) return

    info('ProcessPool', `Eviction needed | runningCount=${runningCount} | max=${MAX_PROCESSES}`)

    // 首先尝试驱逐可以安全挂起的 idle 会话
    const safeIdleCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && p.status === 'idle' && p.canSafelySuspend())
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    if (safeIdleCandidates.length > 0) {
      const victim = safeIdleCandidates[0]
      info('ProcessPool', `[${victim.sessionId.slice(0, 8)}] Evicting idle session | lastActivity=${new Date(victim.lastActivityAt).toISOString()}`)
      victim.suspend()
      this.routeEvent(victim.sessionId, 'suspended', { reason: 'eviction' })
      return
    }

    // 其次尝试驱逐可以安全挂起的 active 会话
    const safeActiveCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && p.status === 'active' && p.canSafelySuspend())
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    if (safeActiveCandidates.length > 0) {
      const victim = safeActiveCandidates[0]
      info('ProcessPool', `[${victim.sessionId.slice(0, 8)}] Evicting active session | lastActivity=${new Date(victim.lastActivityAt).toISOString()}`)
      victim.suspend()
      this.routeEvent(victim.sessionId, 'suspended', { reason: 'eviction' })
      return
    }

    // 如果没有可以安全挂起的会话，记录警告但不强制驱逐
    const unsafeCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && !p.canSafelySuspend())

    if (unsafeCandidates.length > 0) {
      warn('ProcessPool', `Cannot evict any session: ${unsafeCandidates.length} session(s) have pending operations. Waiting for operations to complete.`)
      unsafeCandidates.forEach(p => {
        this.routeEvent(p.sessionId, 'eviction_blocked', {
          reason: 'pending_operations',
          pendingTools: p.getPendingToolCount()
        })
      })
    }
  }

  private attachPoolHandlers(sessionId: string, proc: SessionProcess): void {
    const handlers = {
      message: (msg: any) => this.routeEvent(sessionId, msg.type, msg),
      log: (data: string) => this.routeEvent(sessionId, 'log', data),
      exit: (code: number | null) => this.routeEvent(sessionId, 'exit', code),
      error: (err: Error) => this.routeEvent(sessionId, 'error', { message: err.message }),
    }
    this.poolHandlers.set(sessionId, handlers)
    proc.on('message', handlers.message)
    proc.on('log', handlers.log)
    proc.on('exit', handlers.exit)
    proc.on('error', handlers.error)
    debug('ProcessPool', `[${sessionId.slice(0, 8)}] Pool handlers attached`)
  }

  private detachPoolHandlers(sessionId: string, proc: SessionProcess): void {
    const handlers = this.poolHandlers.get(sessionId)
    if (!handlers) return
    proc.removeListener('message', handlers.message)
    proc.removeListener('log', handlers.log)
    proc.removeListener('exit', handlers.exit)
    proc.removeListener('error', handlers.error)
    this.poolHandlers.delete(sessionId)
    debug('ProcessPool', `[${sessionId.slice(0, 8)}] Pool handlers detached`)
  }

  private routeEvent(sessionId: string, eventType: string, data: any) {
    const shortSid = sessionId.slice(0, 8)
    const windowAvailable = this.mainWindow && !this.mainWindow.isDestroyed()

    // 详细记录事件路由
    if (eventType === 'stream_event') {
      const ev = data?.event || data
      if (ev.type === 'message_stop') {
        info('ProcessPool', `[${shortSid}] route → renderer | type=stream_event | subType=message_stop`)
      }
    } else if (eventType === 'exit') {
      info('ProcessPool', `[${shortSid}] route → renderer | type=${eventType} | code=${data}`)
    } else if (eventType === 'error') {
      error('ProcessPool', `[${shortSid}] route → renderer | type=${eventType}`, data)
    } else if (eventType === 'log') {
      debug('ProcessPool', `[${shortSid}] route → renderer | type=${eventType} | data=${String(data).slice(0, 200)}`)
    } else {
      // assistant, tool_use, tool_result, result, system, user 等
      info('ProcessPool', `[${shortSid}] route → renderer | type=${eventType} | windowAvailable=${windowAvailable}`)
    }

    if (windowAvailable) {
      this.mainWindow!.webContents.send(`claude-code:${eventType}`, { sessionId, data })
    } else {
      warn('ProcessPool', `[${shortSid}] Cannot route event to renderer | windowAvailable=${windowAvailable} | type=${eventType}`)
    }
  }
}
