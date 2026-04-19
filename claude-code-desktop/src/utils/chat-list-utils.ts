import type { Session } from '@/types'

const COLLAPSED_PROJECTS_KEY = 'claude-code:collapsed-projects'
export const COLLAPSED_INITIALIZED_KEY = 'claude-code:collapsed-initialized-v2'

export interface ProjectGroup {
  workingDirectory: string
  displayName: string
  sessions: Session[]
  latestUpdatedAt: number
}

export function loadCollapsedProjects(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(COLLAPSED_PROJECTS_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch {
    // ignore parse errors
  }
  return new Set()
}

export function saveCollapsedProjects(collapsed: Set<string>) {
  localStorage.setItem(COLLAPSED_PROJECTS_KEY, JSON.stringify([...collapsed]))
}

export function groupSessionsByProject(sessions: Session[]): ProjectGroup[] {
  if (sessions.length === 0) return []

  // 按 workingDirectory 分组
  const groups = new Map<string, Session[]>()

  for (const session of sessions) {
    const dir = session.workingDirectory || ''
    if (!groups.has(dir)) {
      groups.set(dir, [])
    }
    groups.get(dir)!.push(session)
  }

  // 转换为 ProjectGroup 数组
  const result: ProjectGroup[] = []

  for (const [workingDirectory, dirSessions] of groups) {
    // 对每个组内的会话按 updatedAt DESC 排序
    const sortedSessions = dirSessions.sort((a, b) => {
      const dateA = a.updatedAt || a.createdAt || 0
      const dateB = b.updatedAt || b.createdAt || 0
      return dateB - dateA
    })

    const displayName = workingDirectory
      ? workingDirectory.split(/[\\/]/).pop() || 'Project'
      : '默认项目'

    const latestUpdatedAt = sortedSessions[0]?.updatedAt || sortedSessions[0]?.createdAt || 0

    result.push({
      workingDirectory,
      displayName,
      sessions: sortedSessions,
      latestUpdatedAt
    })
  }

  // 按最新会话时间排序项目
  result.sort((a, b) => b.latestUpdatedAt - a.latestUpdatedAt)

  return result
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

export function parseDBDate(dateStr: string): Date {
  return new Date(dateStr)
}
