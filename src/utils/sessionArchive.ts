import type { Session } from '@/types'
import { normalizeAbsolutePath } from './normalizePath'

/** 自动归档下拉的可选天数，0 表示禁用。 */
export const AUTO_ARCHIVE_DAY_OPTIONS = [0, 7, 14, 30] as const

const DAY_MS = 86_400_000

export interface ArchivedSessionGroup {
  workingDirectory: string
  displayName: string
  sessions: Session[]
  latestArchivedAt: number
}

export interface ArchivedSessionFilters {
  query?: string
  /** 项目绝对路径（内部会归一化）；空串表示只看无归属会话，undefined 表示不过滤。 */
  project?: string
}

/** 归档时间：旧数据没有 archivedAt 时退回最后活动时间，不让排序出现 NaN。 */
export function getArchivedAt(session: Session): number {
  return session.archivedAt || session.updatedAt || session.createdAt || 0
}

/**
 * 挑出该自动归档的会话 id。
 *
 * 运行中的会话跳过：自动归档会把会话移出侧栏，正在跑的任务随之从视野里消失，
 * 用户既看不到进度也找不到停止入口。等它跑完、下一次检查再归档。
 */
export function collectAutoArchiveIds(
  sessions: Session[],
  days: number,
  now: number = Date.now(),
): string[] {
  if (!Number.isFinite(days) || days <= 0) return []
  const threshold = now - days * DAY_MS

  return sessions
    .filter(session =>
      !session.archived
      && !session.ephemeral
      && !session.observedSession
      && (session.sessionType ?? 'chat') === 'chat'
      && session.processStatus !== 'active'
      && session.processStatus !== 'starting'
      && (session.updatedAt || session.createdAt || 0) < threshold,
    )
    .map(session => session.id)
}

/** 归档管理页的搜索 + 项目筛选，全在前端做。 */
export function filterArchivedSessions(
  sessions: Session[],
  filters: ArchivedSessionFilters = {},
): Session[] {
  const query = (filters.query || '').trim().toLowerCase()
  const project = filters.project === undefined ? undefined : normalizeAbsolutePath(filters.project)

  return sessions.filter(session => {
    if (!session.archived) return false
    if (project !== undefined) {
      if (normalizeAbsolutePath(session.workingDirectory || '') !== project) return false
    }
    if (!query) return true
    const title = (session.title || '').toLowerCase()
    const path = (session.workingDirectory || '').toLowerCase()
    return title.includes(query) || path.includes(query)
  })
}

/** 按项目分组归档会话，组内与组间都按归档时间倒序。 */
export function groupArchivedSessionsByProject(sessions: Session[]): ArchivedSessionGroup[] {
  const groups = new Map<string, Session[]>()

  for (const session of sessions) {
    const dir = normalizeAbsolutePath(session.workingDirectory || '')
    const bucket = groups.get(dir)
    if (bucket) bucket.push(session)
    else groups.set(dir, [session])
  }

  const result: ArchivedSessionGroup[] = []
  for (const [workingDirectory, groupSessions] of groups) {
    const sorted = [...groupSessions].sort((a, b) => getArchivedAt(b) - getArchivedAt(a))
    result.push({
      workingDirectory,
      displayName: workingDirectory.split(/[\\/]/).filter(Boolean).pop() || workingDirectory,
      sessions: sorted,
      latestArchivedAt: getArchivedAt(sorted[0]),
    })
  }

  return result.sort((a, b) => b.latestArchivedAt - a.latestArchivedAt)
}