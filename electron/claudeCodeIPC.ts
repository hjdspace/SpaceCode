import { ipcMain, BrowserWindow } from 'electron'
import { EngineFactory } from './engines/EngineFactory'
import type { EngineSessionConfig, AgentInfo } from './engines/types'
import { info, warn, error, debug } from './logger'

let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window
  EngineFactory.setMainWindow(window)
}

export function registerClaudeCodeIPC() {
  info('ClaudeCodeIPC', 'Initializing with EngineFactory')

  ipcMain.handle('claude-code:startSession', async (_, sessionId: string, config: EngineSessionConfig) => {
    const engineType = config.engineType || 'claude-code'
    info('ClaudeCodeIPC', `→ startSession | sessionId=${sessionId.slice(0, 8)} | engine=${engineType} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)
    const startMs = Date.now()
    try {
      const engine = EngineFactory.getEngine(engineType)
      await engine.startSession(sessionId, config)
      const status = engine.getSessionStatus(sessionId)
      info('ClaudeCodeIPC', `← startSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms | status=${status?.status} | isRunning=${status?.isRunning}`)
      return status
    } catch (err) {
      error('ClaudeCodeIPC', `✗ startSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:sendMessage', async (_, sessionId: string, content: string) => {
    info('ClaudeCodeIPC', `→ sendMessage | sessionId=${sessionId.slice(0, 8)} | contentLen=${content.length}`)
    const startMs = Date.now()
    try {
      const engine = findEngineForSession(sessionId)
      engine.sendMessage(sessionId, content)
      info('ClaudeCodeIPC', `← sendMessage | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`)
    } catch (err) {
      error('ClaudeCodeIPC', `✗ sendMessage | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:abort', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ abort | sessionId=${sessionId.slice(0, 8)}`)
    const engine = findEngineForSession(sessionId)
    await engine.abort(sessionId)
  })

  ipcMain.handle('claude-code:stop', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ stop | sessionId=${sessionId.slice(0, 8)}`)
    const engine = findEngineForSession(sessionId)
    await engine.stop(sessionId)
  })

  ipcMain.handle('claude-code:suspendSession', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ suspendSession | sessionId=${sessionId.slice(0, 8)}`)
    const engine = findEngineForSession(sessionId)
    engine.suspendSession?.(sessionId)
  })

  ipcMain.handle('claude-code:resumeSession', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ resumeSession | sessionId=${sessionId.slice(0, 8)}`)
    const startMs = Date.now()
    try {
      const engine = findEngineForSession(sessionId)
      await engine.resumeSession?.(sessionId)
      const status = engine.getSessionStatus(sessionId)
      info('ClaudeCodeIPC', `← resumeSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms | status=${status?.status}`)
      return status
    } catch (err) {
      error('ClaudeCodeIPC', `✗ resumeSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:getSessionStatus', async (_, sessionId: string) => {
    debug('ClaudeCodeIPC', `→ getSessionStatus | sessionId=${sessionId.slice(0, 8)}`)
    const engine = findEngineForSession(sessionId)
    return engine.getSessionStatus(sessionId)
  })

  ipcMain.handle('claude-code:getActiveSessions', async () => {
    debug('ClaudeCodeIPC', '→ getActiveSessions')
    const allSessions: any[] = []
    for (const engine of EngineFactory.getAllEngines()) {
      allSessions.push(...engine.getActiveSessions())
    }
    return allSessions
  })

  ipcMain.handle('claude-code:isSessionActive', async (_, sessionId?: string) => {
    debug('ClaudeCodeIPC', `→ isSessionActive | sessionId=${sessionId?.slice(0, 8) || '(all)'}`)
    if (sessionId) {
      const engine = findEngineForSession(sessionId)
      const status = engine.getSessionStatus(sessionId)
      return status?.isRunning ?? false
    }
    for (const engine of EngineFactory.getAllEngines()) {
      if (engine.getActiveSessions().length > 0) return true
    }
    return false
  })

  ipcMain.handle('claude-code:log', async () => {
  })

  ipcMain.handle('claude-code:listAgents', async (_, cwd?: string, engineType?: string) => {
    debug('ClaudeCodeIPC', `→ listAgents | cwd=${cwd || '(none)'} | engine=${engineType || '(default)'}`)
    const type = (engineType as any) || 'claude-code'
    const engine = EngineFactory.getEngine(type)
    if (engine.listAgents) {
      return engine.listAgents(cwd)
    }
    return []
  })

  ipcMain.handle('claude-code:isEngineAvailable', async (_, engineType: string) => {
    debug('ClaudeCodeIPC', `→ isEngineAvailable | engine=${engineType}`)
    return EngineFactory.isEngineAvailable(engineType as any)
  })
}

function findEngineForSession(sessionId: string) {
  for (const engine of EngineFactory.getAllEngines()) {
    if (engine.getSessionStatus(sessionId)) {
      return engine
    }
  }
  return EngineFactory.getEngine('claude-code')
}

export function getPool(): { killAll: () => void } | null {
  return null
}
