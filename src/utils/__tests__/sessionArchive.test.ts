import { describe, expect, it } from 'vitest'
import type { Session } from '@/types'
import {
  AUTO_ARCHIVE_DAY_OPTIONS,
  collectAutoArchiveIds,
  filterArchivedSessions,
  getArchivedAt,
  groupArchivedSessionsByProject,
} from '../sessionArchive'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0)

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    title: 'Session',
    messages: [],
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW - 30 * DAY,
    processStatus: 'none',
    isTabOpen: true,
    lastActivityAt: NOW - 30 * DAY,
    ...overrides,
  }
}

describe('getArchivedAt', () => {
  it('prefers archivedAt, then updatedAt, then createdAt', () => {
    expect(getArchivedAt(session({ archivedAt: 3, updatedAt: 2, createdAt: 1 }))).toBe(3)
    expect(getArchivedAt(session({ updatedAt: 2, createdAt: 1 }))).toBe(2)
    expect(getArchivedAt(session({ updatedAt: 0, createdAt: 1 }))).toBe(1)
  })

  it('returns 0 rather than NaN when every timestamp is missing', () => {
    expect(getArchivedAt(session({ archivedAt: undefined, updatedAt: 0, createdAt: 0 }))).toBe(0)
  })
})

describe('collectAutoArchiveIds', () => {
  it('is a no-op when auto-archive is disabled or the threshold is nonsense', () => {
    const stale = [session()]
    expect(collectAutoArchiveIds(stale, 0, NOW)).toEqual([])
    expect(collectAutoArchiveIds(stale, -7, NOW)).toEqual([])
    expect(collectAutoArchiveIds(stale, Number.NaN, NOW)).toEqual([])
    expect(collectAutoArchiveIds(stale, Number.POSITIVE_INFINITY, NOW)).toEqual([])
  })

  it('archives sessions older than the threshold and keeps fresher ones', () => {
    const sessions = [
      session({ id: 'stale', updatedAt: NOW - 8 * DAY }),
      session({ id: 'fresh', updatedAt: NOW - 6 * DAY }),
      // 恰好落在阈值上不算“超过”，要留在侧栏
      session({ id: 'edge', updatedAt: NOW - 7 * DAY }),
    ]
    expect(collectAutoArchiveIds(sessions, 7, NOW)).toEqual(['stale'])
  })

  it('falls back to createdAt when updatedAt is missing', () => {
    expect(collectAutoArchiveIds([session({ updatedAt: 0, createdAt: NOW - 40 * DAY })], 30, NOW))
      .toEqual(['s1'])
  })

  it('never hides a running task, an already archived row, or a non-sidebar session', () => {
    const sessions = [
      session({ id: 'running', processStatus: 'active' }),
      session({ id: 'starting', processStatus: 'starting' }),
      session({ id: 'archived', archived: true }),
      session({ id: 'side-task', ephemeral: true }),
      session({ id: 'observed', observedSession: true }),
      session({ id: 'router', sessionType: 'superAgent' }),
      session({ id: 'chat' }),
    ]
    expect(collectAutoArchiveIds(sessions, 7, NOW)).toEqual(['chat'])
  })
})

describe('filterArchivedSessions', () => {
  const sessions = [
    session({ id: 'a', title: 'Fix login bug', archived: true, workingDirectory: 'D:\\AI\\SpaceCode' }),
    session({ id: 'b', title: 'Write docs', archived: true, workingDirectory: 'D:/AI/Proma' }),
    session({ id: 'c', title: 'Loose end', archived: true }),
    session({ id: 'd', title: 'Still live', archived: false, workingDirectory: 'D:\\AI\\SpaceCode' }),
  ]

  it('only ever returns archived sessions', () => {
    expect(filterArchivedSessions(sessions).map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('matches the query against title and path, case-insensitively and trimmed', () => {
    expect(filterArchivedSessions(sessions, { query: '  LOGIN ' }).map(s => s.id)).toEqual(['a'])
    expect(filterArchivedSessions(sessions, { query: 'proma' }).map(s => s.id)).toEqual(['b'])
    expect(filterArchivedSessions(sessions, { query: '   ' }).map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('filters by normalized project path so slash styles land in the same bucket', () => {
    expect(filterArchivedSessions(sessions, { project: 'D:/AI/SpaceCode' }).map(s => s.id)).toEqual(['a'])
  })

  it('treats an empty project as "no project" and undefined as "no filter"', () => {
    expect(filterArchivedSessions(sessions, { project: '' }).map(s => s.id)).toEqual(['c'])
    expect(filterArchivedSessions(sessions, { project: undefined }).map(s => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('combines query and project', () => {
    expect(filterArchivedSessions(sessions, { query: 'docs', project: 'D:\\AI\\SpaceCode' })).toEqual([])
  })
})

describe('groupArchivedSessionsByProject', () => {
  it('groups by normalized path and sorts inside and across groups by archive time', () => {
    const groups = groupArchivedSessionsByProject([
      session({ id: 'old', archived: true, archivedAt: NOW - 5 * DAY, workingDirectory: 'D:\\AI\\SpaceCode' }),
      session({ id: 'newest', archived: true, archivedAt: NOW, workingDirectory: 'D:/AI/SpaceCode' }),
      session({ id: 'other', archived: true, archivedAt: NOW - DAY, workingDirectory: '/work/proma' }),
    ])

    expect(groups.map(g => g.workingDirectory)).toEqual(['D:\\AI\\SpaceCode', '/work/proma'])
    expect(groups[0].displayName).toBe('SpaceCode')
    expect(groups[0].sessions.map(s => s.id)).toEqual(['newest', 'old'])
    expect(groups[0].latestArchivedAt).toBe(NOW)
    expect(groups[1].displayName).toBe('proma')
  })

  it('keeps unassigned sessions in their own empty-key group', () => {
    const groups = groupArchivedSessionsByProject([session({ archived: true, archivedAt: NOW })])
    expect(groups).toHaveLength(1)
    expect(groups[0].workingDirectory).toBe('')
    expect(groups[0].displayName).toBe('')
  })

  it('does not mutate the input order', () => {
    const input = [
      session({ id: 'a', archived: true, archivedAt: 1 }),
      session({ id: 'b', archived: true, archivedAt: 2 }),
    ]
    groupArchivedSessionsByProject(input)
    expect(input.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('returns nothing for an empty list', () => {
    expect(groupArchivedSessionsByProject([])).toEqual([])
  })
})

describe('AUTO_ARCHIVE_DAY_OPTIONS', () => {
  it('offers disabled first so the default never hides old sessions', () => {
    expect(AUTO_ARCHIVE_DAY_OPTIONS).toEqual([0, 7, 14, 30])
  })
})