import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { ClaudeCodeProcessPool } from './claudeCodeProcessPool'
import { SessionConfig } from './claudeCodeProcessManager'
import { info, warn, error, debug } from './logger'

export interface AgentInfo {
  agentType: string
  description: string
  source: 'built-in' | 'user' | 'project' | 'plugin'
  model?: string
  color?: string
}

const BUILTIN_AGENTS: AgentInfo[] = [
  {
    agentType: 'general-purpose',
    description: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.',
    source: 'built-in',
  },
  {
    agentType: 'Explore',
    description: 'Fast read-only agent specialized for exploring codebases — finding files, searching code, answering questions about the codebase.',
    source: 'built-in',
    model: 'haiku',
    color: 'blue',
  },
  {
    agentType: 'Plan',
    description: 'Software architect agent for designing implementation plans. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
    source: 'built-in',
    model: 'inherit',
    color: 'purple',
  },
  {
    agentType: 'verification',
    description: 'Verification specialist that tries to break implementations. Runs builds, tests, linters, and adversarial probes to produce a PASS/FAIL verdict.',
    source: 'built-in',
    model: 'inherit',
    color: 'red',
  },
]

let pool: ClaudeCodeProcessPool | null = null
let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window
  if (pool) pool.setMainWindow(window)
}

export function registerClaudeCodeIPC() {
  pool = new ClaudeCodeProcessPool()
  if (mainWindow) pool.setMainWindow(mainWindow)
  info('ClaudeCodeIPC', 'Process pool initialized')

  ipcMain.handle('claude-code:startSession', async (_, sessionId: string, config: SessionConfig) => {
    info('ClaudeCodeIPC', `→ startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model} | baseUrl=${config.baseUrl || '(empty)'} | agent=${config.agent || '(none)'}`)
    const startMs = Date.now()
    try {
      if (!pool) throw new Error('Pool not initialized')
      await pool.startSession(sessionId, config)
      const status = pool.getSessionStatus(sessionId)
      info('ClaudeCodeIPC', `← startSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms | status=${status?.status} | isRunning=${status?.isRunning}`)
      return status
    } catch (err) {
      error('ClaudeCodeIPC', `✗ startSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:sendMessage', async (_, sessionId: string, content: string) => {
    info('ClaudeCodeIPC', `→ sendMessage | sessionId=${sessionId.slice(0, 8)} | contentLen=${content.length} | preview="${content.slice(0, 80)}"`)
    const startMs = Date.now()
    try {
      if (!pool) throw new Error('Pool not initialized')
      pool.sendMessage(sessionId, content)
      info('ClaudeCodeIPC', `← sendMessage | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms | forwarded to process`)
    } catch (err) {
      error('ClaudeCodeIPC', `✗ sendMessage | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:abort', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ abort | sessionId=${sessionId.slice(0, 8)}`)
    if (!pool) throw new Error('Pool not initialized')
    pool.abortSession(sessionId)
  })

  ipcMain.handle('claude-code:stop', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ stop | sessionId=${sessionId.slice(0, 8)}`)
    if (!pool) throw new Error('Pool not initialized')
    pool.killSession(sessionId)
  })

  ipcMain.handle('claude-code:suspendSession', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ suspendSession | sessionId=${sessionId.slice(0, 8)}`)
    if (!pool) throw new Error('Pool not initialized')
    pool.suspendSession(sessionId)
  })

  ipcMain.handle('claude-code:resumeSession', async (_, sessionId: string) => {
    info('ClaudeCodeIPC', `→ resumeSession | sessionId=${sessionId.slice(0, 8)}`)
    const startMs = Date.now()
    try {
      if (!pool) throw new Error('Pool not initialized')
      await pool.resumeSession(sessionId)
      const status = pool.getSessionStatus(sessionId)
      info('ClaudeCodeIPC', `← resumeSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms | status=${status?.status}`)
      return status
    } catch (err) {
      error('ClaudeCodeIPC', `✗ resumeSession | sessionId=${sessionId.slice(0, 8)} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  })

  ipcMain.handle('claude-code:getSessionStatus', async (_, sessionId: string) => {
    debug('ClaudeCodeIPC', `→ getSessionStatus | sessionId=${sessionId.slice(0, 8)}`)
    if (!pool) return null
    return pool.getSessionStatus(sessionId)
  })

  ipcMain.handle('claude-code:getActiveSessions', async () => {
    debug('ClaudeCodeIPC', '→ getActiveSessions')
    if (!pool) return []
    return pool.getActiveSessions()
  })

  ipcMain.handle('claude-code:isSessionActive', async (_, sessionId?: string) => {
    debug('ClaudeCodeIPC', `→ isSessionActive | sessionId=${sessionId?.slice(0, 8) || '(all)'}`)
    if (!pool) return false
    if (sessionId) {
      const status = pool.getSessionStatus(sessionId)
      return status?.isRunning ?? false
    }
    return pool.getActiveSessions().length > 0
  })

  ipcMain.handle('claude-code:log', async () => {
  })

  ipcMain.handle('claude-code:listAgents', async (_, cwd?: string) => {
    debug('ClaudeCodeIPC', `→ listAgents | cwd=${cwd || '(none)'}`)
    const agents: AgentInfo[] = [...BUILTIN_AGENTS]

    const searchDirs: string[] = []
    if (cwd) {
      searchDirs.push(path.join(cwd, '.claude', 'agents'))
    }
    const homeDir = process.env.HOME || process.env.USERPROFILE
    if (homeDir) {
      searchDirs.push(path.join(homeDir, '.claude', 'agents'))
    }

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue
      const isProject = dir !== path.join(homeDir!, '.claude', 'agents')
      try {
        const entries = fs.readdirSync(dir).filter(f => f.endsWith('.md'))
        for (const entry of entries) {
          const filePath = path.join(dir, entry)
          try {
            const content = fs.readFileSync(filePath, 'utf8')
            const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
            if (!frontmatterMatch) continue
            const fm = frontmatterMatch[1]
            const nameMatch = fm.match(/^name:\s*['"]?([^'"\n]+)['"]?/m)
            const descMatch = fm.match(/^description:\s*['"]?([^'"\n]+)['"]?/m)
            const modelMatch = fm.match(/^model:\s*['"]?([^'"\n]+)['"]?/m)
            const colorMatch = fm.match(/^color:\s*['"]?([^'"\n]+)['"]?/m)
            if (nameMatch) {
              agents.push({
                agentType: nameMatch[1].trim(),
                description: descMatch ? descMatch[1].trim() : '',
                source: isProject ? 'project' : 'user',
                model: modelMatch?.[1]?.trim(),
                color: colorMatch?.[1]?.trim(),
              })
            }
          } catch {}
        }
      } catch {}
    }

    debug('ClaudeCodeIPC', `← listAgents | count=${agents.length}`)
    return agents
  })
}

export function getPool(): ClaudeCodeProcessPool | null {
  return pool
}
