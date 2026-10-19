/**
 * chat-list-utils 测试 — 侧栏会话列表的分组/折叠持久化/相对时间。
 *
 * groupSessionsByProject 是会话列表的骨架：workingDirectory 归一化后分组、
 * 组内按 updatedAt DESC、组间按最新会话时间排序。历史坏数据（重复反斜杠的
 * cwd、缺失 updatedAt）都在这里兜底，回归代价是侧栏出现重复项目组。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  loadCollapsedProjects,
  saveCollapsedProjects,
  groupSessionsByProject,
  formatRelativeTime,
  parseDBDate,
} from '@/utils/chat-list-utils'
import type { Session } from '@/types'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    title: 'session',
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    processStatus: 'idle',
    isTabOpen: false,
    lastActivityAt: 0,
    ...overrides,
  } as Session
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('loadCollapsedProjects / saveCollapsedProjects', () => {
  it('returns an empty set when nothing is stored', () => {
    expect(loadCollapsedProjects()).toEqual(new Set())
  })

  it('round-trips a set of collapsed project keys', () => {
    saveCollapsedProjects(new Set(['D:\\a', 'D:\\b']))
    expect(loadCollapsedProjects()).toEqual(new Set(['D:\\a', 'D:\\b']))
  })

  it('returns an empty set on corrupted JSON instead of throwing', () => {
    localStorage.setItem('claude-code:collapsed-projects', 'not-json{')
    expect(loadCollapsedProjects()).toEqual(new Set())
  })

  it('persists an empty set as an empty array', () => {
    saveCollapsedProjects(new Set())
    expect(loadCollapsedProjects()).toEqual(new Set())
  })
})

describe('groupSessionsByProject', () => {
  it('returns [] for an empty session list', () => {
    expect(groupSessionsByProject([])).toEqual([])
  })

  it('groups sessions by working directory, sorted by latest activity', () => {
    const sessions = [
      makeSession({ id: 'old-a', workingDirectory: '/proj/a', updatedAt: 100 }),
      makeSession({ id: 'b1', workingDirectory: '/proj/b', updatedAt: 500 }),
      makeSession({ id: 'new-a', workingDirectory: '/proj/a', updatedAt: 300 }),
    ]
    const groups = groupSessionsByProject(sessions)
    expect(groups.map(g => g.workingDirectory)).toEqual(['/proj/b', '/proj/a'])
    // 组内按 updatedAt DESC
    expect(groups[1].sessions.map(s => s.id)).toEqual(['new-a', 'old-a'])
    expect(groups[0].latestUpdatedAt).toBe(500)
  })

  it('merges directories that normalize to the same path', () => {
    const sessions = [
      makeSession({ id: 's1', workingDirectory: '/proj//a', updatedAt: 1 }),
      makeSession({ id: 's2', workingDirectory: '/proj/a', updatedAt: 2 }),
    ]
    const groups = groupSessionsByProject(sessions)
    expect(groups).toHaveLength(1)
    expect(groups[0].sessions).toHaveLength(2)
  })

  it('falls back to createdAt when updatedAt is missing', () => {
    const sessions = [
      makeSession({ id: 's1', workingDirectory: '/p', updatedAt: 0, createdAt: 10 }),
      makeSession({ id: 's2', workingDirectory: '/p', updatedAt: 0, createdAt: 20 }),
    ]
    const groups = groupSessionsByProject(sessions)
    expect(groups[0].sessions.map(s => s.id)).toEqual(['s2', 's1'])
    expect(groups[0].latestUpdatedAt).toBe(20)
  })

  it('uses the last path segment as displayName', () => {
    const groups = groupSessionsByProject([
      makeSession({ workingDirectory: '/Users/me/my-project', updatedAt: 1 }),
    ])
    expect(groups[0].displayName).toBe('my-project')
  })

  it('names an empty working directory 默认项目', () => {
    const groups = groupSessionsByProject([makeSession({ workingDirectory: '' })])
    expect(groups[0].displayName).toBe('默认项目')
  })

  it('names a trailing-separator directory Project when no segment remains', () => {
    // POSIX 归一化会去掉尾部斜杠，构造一个 split 后 pop 为空的分支：
    // Windows 反斜杠路径尾部带分隔符时 normalize 同样折叠，这里直接验证兜底
    const groups = groupSessionsByProject([makeSession({ workingDirectory: '/', updatedAt: 1 })])
    // '/' 归一化后仍是 '/', split 后 pop 得到 '' → 'Project'
    expect(groups[0].displayName).toBe('Project')
  })
})

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-18T12:00:00Z'))
  })

  function ago(ms: number): string {
    return new Date(Date.now() - ms).toISOString()
  }

  it('reports Just now for less than a minute', () => {
    expect(formatRelativeTime(ago(30_000))).toBe('Just now')
  })

  it('reports minutes for under an hour', () => {
    expect(formatRelativeTime(ago(5 * 60_000))).toBe('5m ago')
    expect(formatRelativeTime(ago(59 * 60_000))).toBe('59m ago')
  })

  it('reports hours for under a day', () => {
    expect(formatRelativeTime(ago(3 * 3_600_000))).toBe('3h ago')
    expect(formatRelativeTime(ago(23 * 3_600_000))).toBe('23h ago')
  })

  it('reports days for under a week', () => {
    expect(formatRelativeTime(ago(2 * 86_400_000))).toBe('2d ago')
    expect(formatRelativeTime(ago(6 * 86_400_000))).toBe('6d ago')
  })

  it('falls back to a locale date string at a week or more', () => {
    const result = formatRelativeTime(ago(8 * 86_400_000))
    expect(result).not.toMatch(/ago$/)
    expect(result).toBe(new Date(ago(8 * 86_400_000)).toLocaleDateString())
  })
})

describe('parseDBDate', () => {
  it('parses an ISO date string into a Date', () => {
    const d = parseDBDate('2026-10-18T12:00:00Z')
    expect(d).toBeInstanceOf(Date)
    expect(d.toISOString()).toBe('2026-10-18T12:00:00.000Z')
  })
})
