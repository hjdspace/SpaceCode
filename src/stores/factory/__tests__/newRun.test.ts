/**
 * 新建运行弹窗的候选投影：本地待办与 GitHub issue 统一成可选/跳过列表。
 */
import { describe, it, expect } from 'vitest'
import type { FactoryBacklogItem, FactoryGithubIssue } from '@/shared/factory'
import { backlogCandidates, githubCandidates } from '../newRun'

function item(overrides: Partial<FactoryBacklogItem> = {}): FactoryBacklogItem {
  return {
    id: 'bl-1',
    title: '登录态在刷新后丢失',
    goal: '',
    createdAt: '2026-10-28T10:00:00Z',
    order: 0,
    ...overrides,
  }
}

function issue(overrides: Partial<FactoryGithubIssue> = {}): FactoryGithubIssue {
  return {
    number: 12,
    title: '会话搜索无结果时缺少空态',
    body: '',
    labels: [],
    state: 'open',
    claimed: false,
    ...overrides,
  }
}

describe('backlogCandidates', () => {
  it('keeps backlog order and only exposes a goal when present', () => {
    expect(
      backlogCandidates(
        [item(), item({ id: 'bl-2', title: '第二件事', goal: '补空态', order: 1 })],
        [],
      ),
    ).toEqual([
      { id: 'bl-1', title: '登录态在刷新后丢失', claimed: false },
      { id: 'bl-2', title: '第二件事', detail: '补空态', claimed: false },
    ])
  })

  it('marks tasks already held by an unfinished run', () => {
    const candidates = backlogCandidates(
      [item(), item({ id: 'bl-2', title: '第二件事', order: 1 })],
      ['bl-2'],
    )
    expect(candidates.map((candidate) => candidate.claimed)).toEqual([false, true])
  })
})

describe('githubCandidates', () => {
  it('prefixes issue titles with their number and joins labels', () => {
    const candidates = githubCandidates([
      issue({ labels: ['ready-for-agent', 'ui'] }),
      issue({ number: 13, title: '另一个 issue' }),
    ])
    expect(candidates).toEqual([
      {
        id: '12',
        title: '#12 会话搜索无结果时缺少空态',
        detail: 'ready-for-agent · ui',
        claimed: false,
      },
      { id: '13', title: '#13 另一个 issue', claimed: false },
    ])
  })

  it('keeps the claimed flag from the issue list', () => {
    const candidates = githubCandidates([issue({ claimed: true })])
    expect(candidates[0].claimed).toBe(true)
  })
})
