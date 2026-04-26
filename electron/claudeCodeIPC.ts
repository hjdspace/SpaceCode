import { ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { ClaudeCodeProcessManager, SessionConfig } from './claudeCodeProcessManager'

export interface AgentInfo {
  agentType: string
  description: string
  source: 'built-in' | 'user' | 'project' | 'plugin'
  model?: string
  color?: string
}

// Built-in agents that are always available when feature flags are enabled
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

let manager: ClaudeCodeProcessManager | null = null
let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow) {
  mainWindow = window
}

export function registerClaudeCodeIPC() {
  manager = new ClaudeCodeProcessManager()

  // 转发 manager 事件到 renderer
  const forwardEvents = ['assistant', 'user', 'tool_use', 'tool_result', 'result', 'compact', 'stream_event', 'log', 'exit', 'error']
  for (const event of forwardEvents) {
    manager.on(event, (data) => {
      if (mainWindow) {
        mainWindow.webContents.send(`claude-code:${event}`, data)
      }
    })
  }

  ipcMain.handle('claude-code:startSession', async (_, config: SessionConfig) => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.startSession(config)
  })

  ipcMain.handle('claude-code:sendMessage', async (_, content: string) => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.sendMessage(content)
  })

  ipcMain.handle('claude-code:abort', async () => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.abort()
  })

  ipcMain.handle('claude-code:stop', async () => {
    if (!manager) throw new Error('Manager not initialized')
    return manager.stop()
  })

  ipcMain.handle('claude-code:isSessionActive', async () => {
    if (!manager) return false
    return manager.isSessionActive()
  })

  ipcMain.handle('claude-code:log', async () => {
    // 调试日志已禁用
  })

  ipcMain.handle('claude-code:listAgents', async (_, cwd?: string) => {
    const agents: AgentInfo[] = [...BUILTIN_AGENTS]

    // Discover custom agents from .claude/agents/ directories
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
          } catch {
            // skip unreadable files
          }
        }
      } catch {
        // skip inaccessible directories
      }
    }

    return agents
  })
}

export function getManager(): ClaudeCodeProcessManager | null {
  return manager
}
