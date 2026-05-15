import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { app } from 'electron'

/**
 * 会话历史管理器 - 复用 Claude Code Engine 的会话存储逻辑
 */

// 类型定义（从 engine/src/utils/listSessionsImpl.ts 复制）
export interface SessionLite {
  projectPath: string
  sessionId: string
  /** May be undefined for old sessions. */
  metadata?: SessionMetadata
  /** May be undefined for corrupt sessions. */
  firstUserMessage?: string
  /** May be undefined for corrupt sessions or old sessions. */
  lastMessageTimestamp?: number
}

export interface SessionMetadata {
  customTitle?: string
  /** May be undefined for older sessions. */
  lastPrompt?: string
  /** May be undefined for older sessions. */
  gitBranch?: string
  /** May be undefined for older sessions. */
  timestamps?: {
    /** ISO 8601 timestamp of the session creation. */
    createdAt?: string
    /** ISO 8601 timestamp of the last message in the session. */
    lastMessageAt?: string
  }
}

// 关键路径函数
function getClaudeConfigHomeDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'claude')
  }
  return path.join(os.homedir(), '.claude')
}

function getClaudeProjectsDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'projects')
}

// 会话存储读取函数（简化版，从 engine/src/utils/sessionStorage.ts 提取）
function sanitizePath(pathStr: string): string {
  return pathStr.replace(/[/\\:*?"<>|]/g, '_')
}

function getProjectDir(projectPath: string): string {
  return path.join(getClaudeProjectsDir(), sanitizePath(projectPath))
}

async function readSessionLite(projectPath: string, sessionId: string): Promise<SessionLite | undefined> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)
  if (!fs.existsSync(sessionPath)) {
    return undefined
  }

  let firstUserMessage: string | undefined
  let lastMessageTimestamp: number | undefined
  let metadata: SessionMetadata | undefined

  try {
    // 先尝试读取元数据文件
    const metadataPath = path.join(getProjectDir(projectPath), `${sessionId}.metadata.json`)
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
        // 提取时间戳
        if (metadata?.timestamps?.lastMessageAt) {
          lastMessageTimestamp = new Date(metadata.timestamps.lastMessageAt).getTime()
        }
      } catch {
        // 元数据读取失败，继续尝试读取会话文件
      }
    }

    // 读取会话文件获取第一条用户消息
    const fileContent = fs.readFileSync(sessionPath, 'utf8')
    const lines = fileContent.split('\n').filter(line => line.trim())

    for (const line of lines) {
      try {
        const msg = JSON.parse(line)
        if (msg.type === 'user' && !firstUserMessage) {
          const content = msg.message?.content
          firstUserMessage = typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.find((c: any) => c.type === 'text')?.text || ''
              : ''
        }
        // 如果有时间戳字段，尝试更新
        if (msg.timestamp && !metadata?.timestamps?.lastMessageAt) {
          const ts = new Date(msg.timestamp).getTime()
          if (!isNaN(ts)) {
            lastMessageTimestamp = ts
          }
        }
      } catch {
        continue
      }
    }
  } catch {
    // 读取失败，返回基本信息
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
    return []
  }

  const sessions: SessionLite[] = []
  const entries = fs.readdirSync(projectDir)

  for (const entry of entries) {
    if (entry.endsWith('.jsonl')) {
      const sessionId = entry.slice(0, -'.jsonl'.length)
      const session = await readSessionLite(cwd, sessionId)
      if (session) {
        sessions.push(session)
      }
    }
  }

  // 按时间倒序排列
  sessions.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
  return sessions
}

async function loadAllProjectsSessions(): Promise<SessionLite[]> {
  const projectsDir = getClaudeProjectsDir()
  if (!fs.existsSync(projectsDir)) {
    return []
  }

  const sessions: SessionLite[] = []
  const entries = fs.readdirSync(projectsDir)

  for (const entry of entries) {
    const projectPath = decodeSanitizedPath(entry)
    const projectSessions = await loadSameProjectSessions(projectPath)
    sessions.push(...projectSessions)
  }

  // 按时间倒序排列
  sessions.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
  return sessions
}

function decodeSanitizedPath(sanitized: string): string {
  // 这是简化版，实际需要反向映射
  // 对于跨项目会话，我们可以通过其他方式处理
  return sanitized
}

// 导出会话恢复所需的完整会话数据
async function loadFullSession(projectPath: string, sessionId: string): Promise<any> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)
  if (!fs.existsSync(sessionPath)) {
    return undefined
  }

  const messages: any[] = []
  const fileContent = fs.readFileSync(sessionPath, 'utf8')
  const lines = fileContent.split('\n').filter(line => line.trim())

  for (const line of lines) {
    try {
      messages.push(JSON.parse(line))
    } catch {
      continue
    }
  }

  // 读取元数据
  let metadata: SessionMetadata | undefined
  const metadataPath = path.join(getProjectDir(projectPath), `${sessionId}.metadata.json`)
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    } catch {}
  }

  return { messages, metadata, projectPath, sessionId }
}

export const SessionHistoryManager = {
  /** 获取当前项目的会话列表 */
  async listProjectSessions(cwd: string): Promise<SessionLite[]> {
    return loadSameProjectSessions(cwd)
  },

  /** 获取所有项目的会话列表 */
  async listAllSessions(): Promise<SessionLite[]> {
    return loadAllProjectsSessions()
  },

  /** 获取完整会话数据（用于恢复） */
  async getFullSession(projectPath: string, sessionId: string): Promise<any> {
    return loadFullSession(projectPath, sessionId)
  },

  /** 获取会话显示标题 */
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

  /** 格式化时间显示 */
  formatTimestamp(timestamp?: number): string {
    if (!timestamp) return ''
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    // 1 天内
    if (diff < 24 * 60 * 60 * 1000) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    // 1 周内
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleDateString(undefined, { weekday: 'short' })
    }
    // 其他
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
}
