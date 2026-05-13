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
    let engineType = config.engineType || 'claude-code'
    info('ClaudeCodeIPC', `→ startSession | sessionId=${sessionId.slice(0, 8)} | engine=${engineType} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)
    const startMs = Date.now()
    try {
      if (engineType !== 'claude-code' && !(await EngineFactory.isEngineAvailableAsync(engineType))) {
        warn('ClaudeCodeIPC', `Engine "${engineType}" not available, falling back to claude-code | sessionId=${sessionId.slice(0, 8)}`)
        engineType = 'claude-code'
      }
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

  ipcMain.handle('claude-code:sendMessage', async (_, sessionId: string, content: string, images?: any[]) => {
    info('ClaudeCodeIPC', `→ sendMessage | sessionId=${sessionId.slice(0, 8)} | contentLen=${content.length} | images=${images?.length || 0}`)
    const startMs = Date.now()
    try {
      const engine = findEngineForSession(sessionId)
      await engine.sendMessage(sessionId, content, images)
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
    // Stop on every engine that still tracks this session so switching engines
    // leaves no dangling entries that `findEngineForSession` could resurrect.
    for (const engine of EngineFactory.getAllEngines()) {
      if (engine.getSessionStatus(sessionId)) {
        try {
          await engine.stop(sessionId)
        } catch (err) {
          warn('ClaudeCodeIPC', `stop failed on engine=${engine.type} | sessionId=${sessionId.slice(0, 8)}`, { error: String(err) })
        }
      }
    }
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

  ipcMain.handle('claude-code:updateThinkingLevel', async (_, sessionId: string, enabled: boolean) => {
    info('ClaudeCodeIPC', `→ updateThinkingLevel | sessionId=${sessionId.slice(0, 8)} | enabled=${enabled}`)
    try {
      const engine = findEngineForSession(sessionId)
      if (engine.type === 'pi' && typeof (engine as any).updateThinkingLevel === 'function') {
        ;(engine as any).updateThinkingLevel(sessionId, enabled)
      }
    } catch (err) {
      error('ClaudeCodeIPC', `✗ updateThinkingLevel | sessionId=${sessionId.slice(0, 8)}`, { error: String(err) })
    }
  })

  ipcMain.handle('claude-code:isEngineAvailable', async (_, engineType: string) => {
    debug('ClaudeCodeIPC', `→ isEngineAvailable | engine=${engineType}`)
    return EngineFactory.isEngineAvailableAsync(engineType as any)
  })

  ipcMain.handle('claude-code:submitToolAnswer', async (_, sessionId: string, toolCallId: string, answers: Record<string, string>) => {
    info('ClaudeCodeIPC', `→ submitToolAnswer | sessionId=${sessionId.slice(0, 8)} | toolId=${toolCallId.slice(0, 8)} | answers=${JSON.stringify(answers)}`)
    const startMs = Date.now()
    try {
      const engine = findEngineForSession(sessionId)
      if (typeof engine.submitToolAnswer === 'function') {
        await engine.submitToolAnswer(sessionId, toolCallId, answers)
        info('ClaudeCodeIPC', `← submitToolAnswer | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`)
      } else {
        warn('ClaudeCodeIPC', `submitToolAnswer not implemented in engine=${engine.type}`)
      }
    } catch (err) {
      error('ClaudeCodeIPC', `✗ submitToolAnswer | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:skipToolAnswer', async (_, sessionId: string, toolCallId: string) => {
    info('ClaudeCodeIPC', `→ skipToolAnswer | sessionId=${sessionId.slice(0, 8)} | toolId=${toolCallId.slice(0, 8)}`)
    const startMs = Date.now()
    try {
      const engine = findEngineForSession(sessionId)
      if (typeof engine.skipToolAnswer === 'function') {
        await engine.skipToolAnswer(sessionId, toolCallId)
        info('ClaudeCodeIPC', `← skipToolAnswer | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`)
      } else {
        warn('ClaudeCodeIPC', `skipToolAnswer not implemented in engine=${engine.type}`)
      }
    } catch (err) {
      error('ClaudeCodeIPC', `✗ skipToolAnswer | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })
}

function findEngineForSession(sessionId: string) {
  // Prefer an engine that actually has a live process for this session. This
  // matters when the user switches engines on an existing session: the old
  // engine's pool may still remember the session (its `exit` handler does not
  // evict the map entry), so a naive lookup would keep routing messages to
  // the dead engine.
  let fallback: ReturnType<typeof EngineFactory.getEngine> | null = null
  for (const engine of EngineFactory.getAllEngines()) {
    const status = engine.getSessionStatus(sessionId)
    if (!status) continue
    if (status.isRunning) {
      return engine
    }
    if (!fallback) fallback = engine
  }
  if (fallback) return fallback
  return EngineFactory.getEngine('claude-code')
}

export function getPool(): { killAll: () => void } | null {
  return null
}
