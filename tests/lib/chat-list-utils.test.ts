import { describe, it, expect } from 'vitest'
import { groupSessionsByProject } from '@/utils/chat-list-utils'
import type { Session } from '@/types'

function makeSession(overrides: Partial<Session>): Session {
  return {
    id: 'session-' + Math.random().toString(36).slice(2),
    title: 'Test',
    messages: [],
    createdAt: 1000,
    updatedAt: 1000,
    processStatus: 'none',
    isTabOpen: false,
    lastActivityAt: 1000,
    mode: 'code',
    ...overrides,
  } as Session
}

describe('groupSessionsByProject — 坏路径归一化合并', () => {
  it('workingDirectory 含重复反斜杠的会话与正常路径合并为同一组', () => {
    const sessions = [
      makeSession({ id: 'a', workingDirectory: 'D:\\AI\\SpaceCode', updatedAt: 3000 }),
      makeSession({ id: 'b', workingDirectory: 'D:\\\\AI\\SpaceCode', updatedAt: 2000 }),
    ]

    const groups = groupSessionsByProject(sessions)

    expect(groups).toHaveLength(1)
    expect(groups[0].workingDirectory).toBe('D:\\AI\\SpaceCode')
    expect(groups[0].displayName).toBe('SpaceCode')
    expect(groups[0].sessions.map(s => s.id)).toEqual(['a', 'b'])
  })

  it('正斜杠写法的同一路径也合并进同一组', () => {
    const sessions = [
      makeSession({ workingDirectory: 'D:\\AI\\SpaceCode' }),
      makeSession({ workingDirectory: 'D:/AI/SpaceCode' }),
    ]

    const groups = groupSessionsByProject(sessions)

    expect(groups).toHaveLength(1)
    expect(groups[0].workingDirectory).toBe('D:\\AI\\SpaceCode')
  })

  it('无 workingDirectory 的会话仍归入空路径组', () => {
    const sessions = [makeSession({ workingDirectory: undefined })]
    const groups = groupSessionsByProject(sessions)

    expect(groups).toHaveLength(1)
    expect(groups[0].workingDirectory).toBe('')
    expect(groups[0].displayName).toBe('默认项目')
  })

  it('不同路径仍分为不同组', () => {
    const sessions = [
      makeSession({ workingDirectory: 'D:\\AI\\SpaceCode' }),
      makeSession({ workingDirectory: 'D:\\other\\proj' }),
    ]
    expect(groupSessionsByProject(sessions)).toHaveLength(2)
  })
})
