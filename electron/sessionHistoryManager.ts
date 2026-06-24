import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { info, warn, error, debug } from './logger'

export interface SessionLite {
  projectPath: string
  sessionId: string
  metadata?: SessionMetadata
  firstUserMessage?: string
  lastMessageTimestamp?: number
}

export interface SessionMetadata {
  customTitle?: string
  lastPrompt?: string
  gitBranch?: string
  timestamps?: {
    createdAt?: string
    lastMessageAt?: string
  }
}

function getClaudeConfigHomeDir(): string {
  // 与引擎 envUtils.ts 对齐：优先读 CLAUDE_CONFIG_DIR，否则回退到 XDG_CONFIG_HOME 或 ~/.claude
  if (process.env.CLAUDE_CONFIG_DIR) {
    return process.env.CLAUDE_CONFIG_DIR
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'claude')
  }
  return path.join(os.homedir(), '.claude')
}

function getClaudeProjectsDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'projects')
}

function sanitizePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-')
}

function resolveRealPath(p: string): string {
  try {
    return fs.realpathSync(p).normalize('NFC')
  } catch {
    return p.normalize('NFC')
  }
}

function getProjectDir(projectPath: string): string {
  const resolvedPath = resolveRealPath(projectPath)
  return path.join(getClaudeProjectsDir(), sanitizePath(resolvedPath))
}

function decodeSanitizedPath(sanitized: string): string {
  if (/^[A-Z]--/.test(sanitized)) {
    const driveLetter = sanitized[0]
    const rest = sanitized.slice(2).replace(/-/g, path.sep)
    return `${driveLetter}:${path.sep}${rest}`
  }
  
  if (sanitized.startsWith('-')) {
    return sanitized.replace(/-/g, path.sep)
  }
  
  return sanitized
}

async function readSessionLite(
  projectPath: string,
  sessionId: string
): Promise<SessionLite | undefined> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)
  
  if (!fs.existsSync(sessionPath)) {
    debug('SessionHistory', `Session file not found: ${sessionPath}`)
    return undefined
  }
  
  let firstUserMessage: string | undefined
  let lastMessageTimestamp: number | undefined
  let metadata: SessionMetadata | undefined
  
  try {
    const metadataPath = path.join(
      getProjectDir(projectPath),
      `${sessionId}.metadata.json`
    )
    
    if (fs.existsSync(metadataPath)) {
      try {
        const raw = fs.readFileSync(metadataPath, 'utf8')
        metadata = JSON.parse(raw)
        
        if (metadata?.timestamps?.lastMessageAt) {
          lastMessageTimestamp = new Date(metadata.timestamps.lastMessageAt).getTime()
        }
        
        debug('SessionHistory', `Loaded metadata for session ${sessionId}`)
      } catch (e) {
        warn('SessionHistory', `Failed to parse metadata for ${sessionId}`, { error: String(e) })
      }
    }
    
    const fileContent = fs.readFileSync(sessionPath, 'utf8')
    const lines = fileContent.split('\n').filter(line => line.trim())
    
    for (const line of lines) {
      try {
        const msg = JSON.parse(line)
        
        if (msg.type === 'user' && !firstUserMessage) {
          const content = msg.message?.content
          
          if (typeof content === 'string') {
            firstUserMessage = content.trim()
          } else if (Array.isArray(content)) {
            const textItem = content.find((c: any) => c.type === 'text')
            firstUserMessage = textItem?.text?.trim() || ''
          }
        }
        
        if (!metadata?.timestamps?.lastMessageAt && msg.timestamp) {
          const ts = new Date(msg.timestamp).getTime()
          if (!isNaN(ts)) {
            if (!lastMessageTimestamp || ts > lastMessageTimestamp) {
              lastMessageTimestamp = ts
            }
          }
        }
      } catch (e) {
      }
    }
    
    if (lines.length === 0) {
      warn('SessionHistory', `Empty session file: ${sessionPath}`)
    }
    
  } catch (e) {
    error('SessionHistory', `Failed to read session file ${sessionPath}`, { error: String(e) })
    return undefined
  }
  
  return {
    projectPath,
    sessionId,
    metadata,
    firstUserMessage,
    lastMessageTimestamp,
  }
}

async function loadSameProjectSessions(cwd: string): Promise<SessionLite[]> {
  const projectDir = getProjectDir(cwd)
  
  if (!fs.existsSync(projectDir)) {
    info('SessionHistory', `Project directory not found: ${projectDir}`)
    return []
  }
  
  const sessions: SessionLite[] = []
  
  try {
    const entries = fs.readdirSync(projectDir)
    info('SessionHistory', `Found ${entries.length} entries in ${projectDir}`)
    
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue
      
      const sessionId = entry.slice(0, -'.jsonl'.length)
      
      if (sessionId.startsWith('.') || sessionId.endsWith('.tmp')) continue
      
      const session = await readSessionLite(cwd, sessionId)
      if (session) {
        sessions.push(session)
      }
    }
  } catch (e) {
    error('SessionHistory', `Failed to load sessions for project ${cwd}`, { error: String(e) })
  }
  
  sessions.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
  
  info('SessionHistory', `Loaded ${sessions.length} sessions for project ${cwd}`)
  return sessions
}

async function loadAllProjectsSessions(): Promise<SessionLite[]> {
  const projectsDir = getClaudeProjectsDir()
  
  if (!fs.existsSync(projectsDir)) {
    warn('SessionHistory', `Projects directory not found: ${projectsDir}`)
    return []
  }
  
  const allSessions: SessionLite[] = []
  
  try {
    const entries = fs.readdirSync(projectsDir)
    info('SessionHistory', `Found ${entries.length} project directories`)
    
    for (const entry of entries) {
      const entryPath = path.join(projectsDir, entry)
      
      try {
        if (!fs.statSync(entryPath).isDirectory()) continue
      } catch {
        continue
      }
      
      const projectPath = decodeSanitizedPath(entry)
      
      const projectSessions = await loadSameProjectSessions(projectPath)
      allSessions.push(...projectSessions)
    }
  } catch (e) {
    error('SessionHistory', `Failed to load all projects`, { error: String(e) })
  }
  
  const uniqueSessions = new Map<string, SessionLite>()
  for (const session of allSessions) {
    if (!uniqueSessions.has(session.sessionId)) {
      uniqueSessions.set(session.sessionId, session)
    }
  }
  
  const result = Array.from(uniqueSessions.values())
  result.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
  
  info('SessionHistory', `Total unique sessions: ${result.length}`)
  return result
}

async function loadFullSession(
  projectPath: string,
  sessionId: string
): Promise<any> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)
  
  if (!fs.existsSync(sessionPath)) {
    debug('SessionHistory', `Session file not found: ${sessionPath}`)
    return null
  }
  
  const messages: any[] = []
  const fileContent = fs.readFileSync(sessionPath, 'utf8')
  const lines = fileContent.split('\n').filter(line => line.trim())
  
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line))
    } catch (e) {
      warn('SessionHistory', `Failed to parse line in ${sessionId}`, { error: String(e) })
    }
  }
  
  let metadata: SessionMetadata | undefined
  const metadataPath = path.join(getProjectDir(projectPath), `${sessionId}.metadata.json`)
  
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    } catch (e) {
      warn('SessionHistory', `Failed to parse metadata for ${sessionId}`, { error: String(e) })
    }
  }
  
  return {
    messages,
    metadata,
    projectPath,
    sessionId,
  }
}

export const SessionHistoryManager = {
  async listProjectSessions(cwd: string): Promise<SessionLite[]> {
    return loadSameProjectSessions(cwd)
  },

  async listAllSessions(): Promise<SessionLite[]> {
    return loadAllProjectsSessions()
  },

  async getFullSession(projectPath: string, sessionId: string): Promise<any> {
    return loadFullSession(projectPath, sessionId)
  },

  getSessionTitle(session: SessionLite): string {
    if (session.metadata?.customTitle) {
      return session.metadata.customTitle
    }
    if (session.firstUserMessage) {
      const preview = session.firstUserMessage.slice(0, 60)
      return preview.length < session.firstUserMessage.length ? preview + '...' : preview
    }
    return `Session ${session.sessionId.slice(0, 8)}`
  },

  formatTimestamp(timestamp?: number): string {
    if (!timestamp) return ''

    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 24 * 60 * 60 * 1000) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleDateString(undefined, { weekday: 'short' })
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  },

  /**
   * 构造子代理 sidechain transcript JSONL 的绝对路径。
   * 与引擎 getAgentTranscriptPath 逻辑一致：
   *   {configHome}/projects/{sanitizePath(realpath(cwd))}/{sessionId}/subagents/agent-{agentId}.jsonl
   * 前端用此路径直接轮询 transcript，绕过 .output 符号链接（Windows 上符号链接创建失败导致空文件）。
   */
  getAgentTranscriptPath(projectPath: string, sessionId: string, agentId: string): string {
    return path.join(getProjectDir(projectPath), sessionId, 'subagents', `agent-${agentId}.jsonl`)
  },
}
