import { BrowserWindow } from 'electron'
import { SessionProcess, ProcessStatus } from './sessionProcess'
import { SessionConfig } from './claudeCodeProcessManager'

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
    if (this.processes.has(sessionId)) {
      const existing = this.processes.get(sessionId)!
      if (existing.isRunning()) return
      if (existing.status === 'suspended' && existing.engineSessionId) {
        await this.resumeSession(sessionId)
        return
      }
    }

    this.evictIfNeeded()

    const proc = new SessionProcess(sessionId, config)
    this.processes.set(sessionId, proc)

    this.attachPoolHandlers(sessionId, proc)

    await proc.start()
  }

  async resumeSession(sessionId: string): Promise<void> {
    const proc = this.processes.get(sessionId)
    if (!proc) throw new Error(`Session ${sessionId} not found`)
    if (proc.status !== 'suspended') throw new Error(`Session ${sessionId} is not suspended`)

    this.evictIfNeeded()

    this.detachPoolHandlers(sessionId, proc)
    this.attachPoolHandlers(sessionId, proc)

    await proc.resume()
  }

  suspendSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return
    proc.suspend()
  }

  sendMessage(sessionId: string, content: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc || !proc.isRunning()) throw new Error(`Session ${sessionId} has no active process`)
    proc.sendMessage(content)
  }

  abortSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return
    proc.abort()
  }

  killSession(sessionId: string): void {
    const proc = this.processes.get(sessionId)
    if (!proc) return
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

    // 首先尝试驱逐可以安全挂起的 idle 会话
    const safeIdleCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && p.status === 'idle' && p.canSafelySuspend())
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    if (safeIdleCandidates.length > 0) {
      safeIdleCandidates[0].suspend()
      this.routeEvent(safeIdleCandidates[0].sessionId, 'suspended', { reason: 'eviction' })
      return
    }

    // 其次尝试驱逐可以安全挂起的 active 会话
    const safeActiveCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && p.status === 'active' && p.canSafelySuspend())
      .sort((a, b) => a.lastActivityAt - b.lastActivityAt)

    if (safeActiveCandidates.length > 0) {
      safeActiveCandidates[0].suspend()
      this.routeEvent(safeActiveCandidates[0].sessionId, 'suspended', { reason: 'eviction' })
      return
    }

    // 如果没有可以安全挂起的会话，记录警告但不强制驱逐
    // 避免中断正在进行的工具调用或文件操作
    const unsafeCandidates = Array.from(this.processes.values())
      .filter(p => p.isRunning() && !p.canSafelySuspend())

    if (unsafeCandidates.length > 0) {
      console.warn(
        `[ProcessPool] Cannot evict any session: ${unsafeCandidates.length} session(s) have pending operations. ` +
        `Waiting for operations to complete before starting new session.`
      )
      // 通知渲染进程驱逐失败，需要等待
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
  }

  private detachPoolHandlers(sessionId: string, proc: SessionProcess): void {
    const handlers = this.poolHandlers.get(sessionId)
    if (!handlers) return
    proc.removeListener('message', handlers.message)
    proc.removeListener('log', handlers.log)
    proc.removeListener('exit', handlers.exit)
    proc.removeListener('error', handlers.error)
    this.poolHandlers.delete(sessionId)
  }

  private routeEvent(sessionId: string, eventType: string, data: any) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(`claude-code:${eventType}`, { sessionId, data })
    }
  }
}
