// @vitest-environment node
/**
 * Source Ingestor：游标续读、断档全量重拉、fan-out、建单候选、坏事件隔离与限流退避（T15 #85）。
 *
 * 全部通过注入 Fake Source 与真实 Domain 验证公开行为，不访问网络。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSuperAgentDomain, type SuperAgentDomain } from '../domain'
import { createSourceCursorStore, SOURCE_CURSORS_FILE } from '../sources/cursorStore'
import { createSourceQuarantine } from '../sources/quarantine'
import {
  createSourceIngestor,
  type SourceCandidate,
  type SourceIngestor,
} from '../sources/ingestor'
import type { ExternalSource, SourceEvent, SourcePollPage } from '../sources/types'

let roots: string[] = []
let ingestors: SourceIngestor[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

function event(partial: Partial<SourceEvent> & { key: string }): SourceEvent {
  return {
    source: 'fake',
    threadIds: ['fake:thread:t1'],
    actor: 'fake:user:u1',
    human: true,
    addressed: null,
    channel: 'fake:chat:c1',
    url: null,
    text: 'hello',
    at: '2026-01-01T00:00:00.000Z',
    meta: {},
    ...partial,
  }
}

function page(partial: Partial<SourcePollPage> = {}): SourcePollPage {
  return { events: [], nextCursor: null, hasMore: false, gap: false, ...partial }
}

/** 脚本化 Source：按顺序返回预置页，记录每次 poll 的游标。 */
class FakeSource implements ExternalSource {
  readonly id: string
  private pages: SourcePollPage[]
  private index = 0
  error: Error | null = null
  polls: Array<{ cursor: string | null; limit: number }> = []

  constructor(id: string, pages: SourcePollPage[] = []) {
    this.id = id
    this.pages = pages
  }

  appendPages(pages: SourcePollPage[]): void {
    this.pages.push(...pages)
  }

  async poll(cursor: string | null, limit: number): Promise<SourcePollPage> {
    this.polls.push({ cursor, limit })
    if (this.error) throw this.error
    const next = this.pages[this.index]
    this.index += 1
    return next ?? page()
  }
}

interface Harness {
  domain: SuperAgentDomain
  source: FakeSource
  ingestor: SourceIngestor
  candidates: SourceCandidate[]
}

function harness(pages: SourcePollPage[] = [], sourceId = 'fake'): Harness {
  const domain = createSuperAgentDomain({
    now: () => new Date('2026-01-01T00:00:00Z'),
    newId: (kind) => `${kind}-${Math.random().toString(36).slice(2, 8)}`,
  })
  const dir = tempDir('sa-ingestor-')
  const source = new FakeSource(sourceId, pages)
  const candidates: SourceCandidate[] = []
  const ingestor = createSourceIngestor({
    domain,
    sources: [source],
    cursorStore: createSourceCursorStore(dir),
    quarantine: createSourceQuarantine(dir),
    onCandidate: (candidate) => candidates.push(candidate),
  })
  ingestors.push(ingestor)
  return { domain, source, ingestor, candidates }
}

afterEach(() => {
  vi.useRealTimers()
  for (const ingestor of ingestors) ingestor.stop()
  ingestors = []
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('cursor 续读', () => {
  it('advances the cursor only after a successful batch and resumes from it after restart', async () => {
    const e1 = event({ key: 'e1' })
    const e2 = event({ key: 'e2' })
    const h = harness([
      page({ events: [e1, e2], nextCursor: 'c2', hasMore: false }),
    ])

    await h.ingestor.pollOnce('fake')
    expect(Object.keys(h.domain.state.triggers)).toHaveLength(2)
    expect(h.ingestor.status()[0].cursor).toBe('c2')

    // 「重启」：先把游标文件落到新目录，再用它构造新 ingestor，poll 从 c2 续读而非从头。
    const dir2 = tempDir('sa-ingestor-')
    copyFileSync(join(roots[0], SOURCE_CURSORS_FILE), join(dir2, SOURCE_CURSORS_FILE))
    const source2 = new FakeSource('fake')
    const ingestor2 = createSourceIngestor({
      domain: createSuperAgentDomain(),
      sources: [source2],
      cursorStore: createSourceCursorStore(dir2),
      quarantine: createSourceQuarantine(dir2),
    })
    ingestors.push(ingestor2)
    await ingestor2.pollOnce('fake')
    expect(source2.polls[0].cursor).toBe('c2')
  })

  it('keeps the cursor when a poll fails, so the failed batch is retried whole', async () => {
    const h = harness([])
    h.source.appendPages([page({ events: [event({ key: 'e1' })], nextCursor: 'c1' })])
    await h.ingestor.pollOnce('fake')
    expect(h.ingestor.status()[0].cursor).toBe('c1')

    h.source.error = new Error('network down')
    await expect(h.ingestor.pollOnce('fake')).rejects.toThrow('network down')
    expect(h.ingestor.status()[0].cursor).toBe('c1')
    expect(h.ingestor.status()[0].consecutiveFailures).toBe(1)
    expect(h.ingestor.status()[0].lastError).toBe('network down')
  })
})

describe('断档全量重拉', () => {
  it('detects a gap, re-pulls from the beginning and does not lose or duplicate messages', async () => {
    const e1 = event({ key: 'e1' })
    const e2 = event({ key: 'e2' })
    const e3 = event({ key: 'e3' })
    const h = harness([
      page({ events: [e1], nextCursor: 'c1' }),
      // 从 c1 续读时报告断档：c1 之后的消息已无法保证连续。
      page({ events: [e3], nextCursor: 'c3', gap: true }),
      // 全量重拉：从头返回完整历史。
      page({ events: [e1, e2, e3], nextCursor: 'c3-full', hasMore: false }),
    ])

    await h.ingestor.pollOnce('fake')
    expect(Object.keys(h.domain.state.triggers)).toHaveLength(1)

    await h.ingestor.pollOnce('fake')
    // 断档页被丢弃，重拉从 null 游标开始，三条消息全部进入且 e1 不重复。
    expect(h.source.polls.map((p) => p.cursor)).toEqual([null, 'c1', null])
    expect(Object.keys(h.domain.state.triggers)).toHaveLength(3)
    expect(h.ingestor.status()[0].cursor).toBe('c3-full')
  })

  it('follows hasMore pagination within one poll and persists the final cursor', async () => {
    const h = harness([
      page({ events: [event({ key: 'e1' })], nextCursor: 'p1', hasMore: true }),
      page({ events: [event({ key: 'e2' })], nextCursor: 'p2', hasMore: true }),
      page({ events: [event({ key: 'e3' })], nextCursor: 'p3', hasMore: false }),
    ])
    await h.ingestor.pollOnce('fake')
    expect(Object.keys(h.domain.state.triggers)).toHaveLength(3)
    expect(h.source.polls.map((p) => p.cursor)).toEqual([null, 'p1', 'p2'])
    expect(h.ingestor.status()[0].cursor).toBe('p3')
  })

  it('rejects a page claiming hasMore without a cursor', async () => {
    const h = harness([page({ events: [], nextCursor: null, hasMore: true })])
    await expect(h.ingestor.pollOnce('fake')).rejects.toThrow()
  })
})

describe('intake fan-out', () => {
  function ticketOnThread(domain: SuperAgentDomain, threadId: string, key: string) {
    return domain.createTicket({
      requestId: `req-${key}`,
      title: `T ${key}`,
      repoRoot: '/repo',
      trigger: {
        key,
        source: 'desktop',
        threadIds: [threadId],
        actor: 'desktop:user:local',
        human: true,
        text: 'dispatch',
      },
    }).ticket
  }

  it('delivers an addressed trigger to subscribed tickets as a wake-capable input', async () => {
    const h = harness([])
    const ticket = ticketOnThread(h.domain, 'fake:thread:t1', 'd1')
    const trigger = event({
      key: 'e1',
      threadIds: ['fake:thread:t1'],
      addressed: 'mention',
      text: '@SuperAgent 修一下登录',
    })
    h.source.appendPages([page({ events: [trigger], nextCursor: 'c1' })])

    await h.ingestor.pollOnce('fake')
    expect(ticket.inputIds).toHaveLength(1)
    const input = h.domain.state.inputs[ticket.inputIds[0]]
    expect(input.triggerId).toBeTruthy()
    expect(input.human).toBe(true)
    expect(input.context).toBe(false)
    expect(input.text).toBe('@SuperAgent 修一下登录')
    // 候选不应触发：已有正常订阅消费了该 Trigger。
    expect(h.candidates).toHaveLength(0)
  })

  it('delivers non-addressed human messages to adjudicable subscriptions as owned inputs (T17 fast path)', async () => {
    const h = harness([])
    const ticket = ticketOnThread(h.domain, 'fake:thread:t1', 'd1')
    h.source.appendPages([
      page({ events: [event({ key: 'e1', threadIds: ['fake:thread:t1'], addressed: null })] }),
    ])

    await h.ingestor.pollOnce('fake')
    const input = h.domain.state.inputs[ticket.inputIds[0]]
    // T17 #87：人消息归所有可裁决订阅（不再要求 addressed，由 Worker 判断 scope，
    // 越权走 handback 交回）。
    expect(input.context).toBe(false)
    expect(input.human).toBe(true)
  })

  it('honors contextOnly subscriptions even for addressed triggers', async () => {
    const h = harness([])
    const domain = h.domain
    const ticket = domain.createTicket({
      requestId: 'req-d1',
      title: 'T d1',
      repoRoot: '/repo',
      trigger: {
        key: 'd1',
        source: 'desktop',
        threadIds: ['fake:thread:t1'],
        actor: 'desktop:user:local',
        human: true,
        text: 'dispatch',
      },
    }).ticket
    // 把订阅改成 contextOnly：群消息只读订阅。
    domain.state.threads['fake:thread:t1'].subscriptions[0].contextOnly = true

    h.source.appendPages([
      page({ events: [event({ key: 'e1', threadIds: ['fake:thread:t1'], addressed: 'mention' })] }),
    ])
    await h.ingestor.pollOnce('fake')
    const input = h.domain.state.inputs[ticket.inputIds[0]]
    expect(input.context).toBe(true)
  })

  it('does not duplicate inputs when the same events are re-pulled', async () => {
    const h = harness([])
    const ticket = ticketOnThread(h.domain, 'fake:thread:t1', 'd1')
    const trigger = event({ key: 'e1', threadIds: ['fake:thread:t1'], addressed: 'mention' })
    h.source.appendPages([
      page({ events: [trigger], nextCursor: 'c1' }),
      page({ events: [trigger], nextCursor: 'c1' }),
    ])

    await h.ingestor.pollOnce('fake')
    await h.ingestor.pollOnce('fake')
    expect(ticket.inputIds).toHaveLength(1)
  })

  it('skips ended tickets and triggers already bound to a ticket by creation', async () => {
    const h = harness([])
    const ticket = ticketOnThread(h.domain, 'fake:thread:t1', 'd1')
    h.domain.endTicket({ ticketId: ticket.ticketId, outcome: 'stopped', by: 'user', reason: 'done' })

    h.source.appendPages([
      page({ events: [event({ key: 'e1', threadIds: ['fake:thread:t1'], addressed: 'mention' })] }),
    ])
    await h.ingestor.pollOnce('fake')
    // 工单已结束：不投递，也不再产生候选（已结束的订阅不唤醒）。
    expect(ticket.inputIds).toHaveLength(0)
  })
})

describe('建单候选', () => {
  it('emits a candidate with channel context for addressed triggers without subscriptions', async () => {
    const h = harness([])
    h.source.appendPages([
      page({
        events: [
          event({ key: 'e1', addressed: 'mention', channel: 'feishu:chat:oc_9', text: '@SuperAgent 帮我查' }),
        ],
      }),
    ])
    await h.ingestor.pollOnce('fake')

    expect(h.candidates).toHaveLength(1)
    expect(h.candidates[0].reason).toBe('mention')
    expect(h.candidates[0].trigger.key).toBe('e1')
    expect(h.candidates[0].trigger.channel).toBe('feishu:chat:oc_9')
    expect(h.candidates[0].trigger.threadIds).toEqual(['fake:thread:t1'])
  })

  it('does not emit candidates for non-addressed, non-human or already-consumed triggers', async () => {
    const h = harness([])
    h.source.appendPages([
      page({
        events: [
          event({ key: 'e1', addressed: null }),
          event({ key: 'e2', addressed: 'direct', human: false }),
        ],
      }),
    ])
    await h.ingestor.pollOnce('fake')
    expect(h.candidates).toHaveLength(0)

    // 已被建单消费过的 Trigger 重放时不再成为候选。
    const domain = h.domain
    domain.createTicket({
      requestId: 'req-x',
      title: 'T x',
      repoRoot: '/repo',
      trigger: {
        key: 'e2',
        source: 'fake',
        threadIds: ['fake:thread:t1'],
        actor: 'fake:user:u1',
        human: true,
        text: '@SuperAgent 帮我查',
      },
    })
    h.source.appendPages([page({ events: [event({ key: 'e2', addressed: 'direct', human: true })] })])
    await h.ingestor.pollOnce('fake')
    expect(h.candidates).toHaveLength(0)
  })
})

describe('T17 订阅 fast path 与寿命', () => {
  function ticketOnThread(domain: SuperAgentDomain, threadId: string, key: string) {
    return domain.createTicket({
      requestId: `req-${key}`,
      title: `T ${key}`,
      repoRoot: '/repo',
      trigger: {
        key,
        source: 'desktop',
        threadIds: [threadId],
        actor: 'desktop:user:local',
        human: true,
        text: 'dispatch',
      },
    }).ticket
  }

  it('suppresses bot candidates once a live adjudicable subscription consumed the thread event', async () => {
    const h = harness([])
    h.domain.setPolicy({
      acceptMode: 'observe',
      admissions: [{ source: 'fake', channels: [], allowlist: [], bots: ['fake:bot:ci'] }],
    })

    // 对照：无订阅的 Thread 上，准入的 bot 事件仍是候选。
    h.source.appendPages([
      page({ events: [event({ key: 'e1', human: false, addressed: 'direct', actor: 'fake:bot:ci' })], nextCursor: 'c1' }),
    ])
    await h.ingestor.pollOnce('fake')
    expect(h.candidates).toHaveLength(1)

    // 有存活可裁决订阅：同 Thread 后续事件直达 Worker（上下文输入），不再进 Eval。
    const ticket = ticketOnThread(h.domain, 'fake:thread:t1', 'd1')
    h.source.appendPages([
      page({ events: [event({ key: 'e2', human: false, addressed: 'direct', actor: 'fake:bot:ci' })], nextCursor: 'c2' }),
    ])
    await h.ingestor.pollOnce('fake')
    expect(h.candidates).toHaveLength(1)
    const input = h.domain.state.inputs[ticket.inputIds[0]]
    expect(input.context).toBe(true)
    expect(input.human).toBe(false)
  })

  it('prunes subscriptions past their TTL before each poll (停止轮询)', async () => {
    let nowMs = 0
    let counter = 0
    const domain = createSuperAgentDomain({
      now: () => new Date(Date.parse('2026-01-01T00:00:00Z') + nowMs),
      newId: (kind) => `${kind}-${++counter}`,
      subscriptionTtlMs: 1_000,
    })
    const dir = tempDir('sa-ingestor-')
    const source = new FakeSource('fake')
    const ingestor = createSourceIngestor({
      domain,
      sources: [source],
      cursorStore: createSourceCursorStore(dir),
      quarantine: createSourceQuarantine(dir),
    })
    ingestors.push(ingestor)

    const ticket = ticketOnThread(domain, 'fake:thread:t1', 'd1')
    domain.endTicket({
      ticketId: ticket.ticketId,
      outcome: 'completed',
      by: 'user',
      reason: 'done',
    })

    source.appendPages([page({ events: [event({ key: 'e1' })], nextCursor: 'c1' })])
    await ingestor.pollOnce('fake')
    // TTL 内：订阅保留（已结束未停止的工单最多保留两周）。
    expect(domain.state.threads['fake:thread:t1'].subscriptions).toHaveLength(1)

    nowMs = 1_001
    source.appendPages([page({ events: [event({ key: 'e2' })], nextCursor: 'c2' })])
    await ingestor.pollOnce('fake')
    // 超过订阅寿命：轮询前清理，该 Thread 不再因订阅被轮询（只走普通 intake）。
    expect(domain.state.threads['fake:thread:t1'].subscriptions).toHaveLength(0)
  })
})

describe('订阅恢复（T25 #98）', () => {
  function ticketOnThread(domain: SuperAgentDomain, threadId: string, key: string) {
    return domain.createTicket({
      requestId: `req-${key}`,
      title: `T ${key}`,
      repoRoot: '/repo',
      trigger: {
        key,
        source: 'fake',
        threadIds: [threadId],
        actor: 'fake:user:u1',
        human: true,
        addressed: 'mention',
        text: 'dispatch',
      },
    }).ticket
  }

  function endCompleted(domain: SuperAgentDomain, ticketId: string): void {
    domain.endTicket({ ticketId, outcome: 'completed', by: 'user', reason: 'done' })
  }

  it('resumes an ended-but-not-stopped ticket from a human message with a resumed input', async () => {
    const h = harness([])
    const ticket = ticketOnThread(h.domain, 'fake:thread:t1', 'd1')
    endCompleted(h.domain, ticket.ticketId)
    h.source.appendPages([
      page({
        events: [event({ key: 'e1', threadIds: ['fake:thread:t1'], addressed: 'mention', text: '接着改' })],
        nextCursor: 'c1',
      }),
    ])

    await h.ingestor.pollOnce('fake')

    expect(ticket.state).toBe('open')
    expect(ticket.ended).toBeNull()
    expect(ticket.inputIds).toHaveLength(1)
    const input = h.domain.state.inputs[ticket.inputIds[0]]
    expect(input.kind).toBe('resumed')
    expect(input.human).toBe(true)
    expect(input.context).toBe(false)
    expect(input.text).toBe('接着改')
    expect(input.triggerId).toBeTruthy()
    // 不新建 Assignment / Eval：只落恢复事实，后续交既有投递/闸门路径。
    expect(ticket.assignmentIds).toHaveLength(0)
    expect(Object.keys(h.domain.state.evals)).toHaveLength(0)
    expect(h.candidates).toHaveLength(0)
  })

  it('never resumes an ended ticket from bot or CI messages', async () => {
    const h = harness([])
    h.domain.setPolicy({
      admissions: [{ source: 'fake', channels: [], allowlist: [], bots: ['fake:bot:ci'] }],
    })
    const ticket = ticketOnThread(h.domain, 'fake:thread:t1', 'd1')
    endCompleted(h.domain, ticket.ticketId)
    h.source.appendPages([
      page({
        events: [
          event({
            key: 'e1',
            threadIds: ['fake:thread:t1'],
            human: false,
            actor: 'fake:bot:ci',
            addressed: 'direct',
            text: 'CI 更新',
          }),
        ],
        nextCursor: 'c1',
      }),
    ])

    await h.ingestor.pollOnce('fake')

    expect(ticket.state).toBe('ended')
    expect(ticket.inputIds).toHaveLength(0)
    // bot 消息不进工单，但仍按准入规则进 Eval 候选。
    expect(h.candidates).toHaveLength(1)
  })

  it('does not swallow the message when the original mandate no longer admits', async () => {
    const h = harness([])
    const ticket = ticketOnThread(h.domain, 'fake:thread:t1', 'd1')
    endCompleted(h.domain, ticket.ticketId)
    // 原 Mandate 的来源 Trigger 无 channel → 新 Policy 的 scope 不再准入；
    // 新消息走另一个被准入的 channel。
    h.domain.setPolicy({
      admissions: [{ source: 'fake', channels: ['fake:chat:other'], allowlist: [], bots: [] }],
    })
    h.source.appendPages([
      page({
        events: [
          event({
            key: 'e1',
            threadIds: ['fake:thread:t1'],
            channel: 'fake:chat:other',
            addressed: 'mention',
          }),
        ],
        nextCursor: 'c1',
      }),
    ])

    await h.ingestor.pollOnce('fake')

    expect(ticket.state).toBe('ended')
    expect(ticket.inputIds).toHaveLength(0)
    expect(h.candidates).toHaveLength(1)
  })

  it('never re-consumes a message the ticket released when it ended', async () => {
    const h = harness([])
    const ticket = ticketOnThread(h.domain, 'fake:thread:t1', 'd1')
    const e1 = event({ key: 'e1', threadIds: ['fake:thread:t1'], addressed: 'mention' })
    h.source.appendPages([page({ events: [e1], nextCursor: 'c1' }), page({ events: [e1], nextCursor: 'c1' })])
    await h.ingestor.pollOnce('fake')
    endCompleted(h.domain, ticket.ticketId)
    expect(h.domain.state.inputs[ticket.inputIds[0]].releasedAt).not.toBeNull()

    await h.ingestor.pollOnce('fake')

    expect(ticket.state).toBe('ended')
    expect(ticket.inputIds).toHaveLength(1)
    // 已交回的消息回到 Eval 候选路径，不再静默吞掉。
    expect(h.candidates).toHaveLength(1)
  })
})

describe('GitHub PR 订阅（#97）', () => {
  const PR_THREAD = 'github:pr:acme/app:42'

  function ticketFollowingPr(domain: SuperAgentDomain, key: string) {
    const ticket = domain.createTicket({
      requestId: `req-${key}`,
      title: `T ${key}`,
      repoRoot: '/repo',
      trigger: {
        key,
        source: 'desktop',
        threadIds: ['desktop:thread:1'],
        actor: 'desktop:user:local',
        human: true,
        text: '跟踪 PR',
      },
    }).ticket
    domain.followThread({ ticketId: ticket.ticketId, threadId: PR_THREAD, source: 'github-pr' })
    return ticket
  }

  it('wakes the following ticket on a human review and keeps resolved comments as context', async () => {
    const h = harness([], 'github-pr')
    const ticket = ticketFollowingPr(h.domain, 'd1')

    h.source.appendPages([
      page({
        events: [
          event({
            key: 'github-pr:review:acme/app#42:r1',
            source: 'github-pr',
            threadIds: [PR_THREAD],
            actor: 'github:user:bob',
            text: '请修 X',
          }),
        ],
        nextCursor: 'c1',
      }),
    ])
    await h.ingestor.pollOnce('github-pr')
    const first = h.domain.state.inputs[ticket.inputIds[0]]
    expect(first.human).toBe(true)
    expect(first.context).toBe(false)

    h.source.appendPages([
      page({
        events: [
          event({
            key: 'github-pr:comment:acme/app#42:c1',
            source: 'github-pr',
            threadIds: [PR_THREAD],
            human: false,
            text: '线程已解决',
          }),
        ],
        nextCursor: 'c2',
      }),
    ])
    await h.ingestor.pollOnce('github-pr')
    const second = h.domain.state.inputs[ticket.inputIds[1]]
    expect(second.human).toBe(false)
    expect(second.context).toBe(true)
  })

  it('ends the following ticket once across replayed merged terminations', async () => {
    const done = {
      threadId: PR_THREAD,
      outcome: 'merged' as const,
      at: '2026-01-01T00:00:03.000Z',
      reason: 'pr-merged:octocat',
    }
    const h = harness([page({ threadDone: [done], nextCursor: 'c1' })], 'github-pr')
    const ticket = ticketFollowingPr(h.domain, 'd1')

    await h.ingestor.pollOnce('github-pr')
    expect(ticket.state).toBe('ended')
    expect(ticket.ended?.outcome).toBe('merged')
    expect(ticket.follows).toEqual([PR_THREAD])

    // 断档重放：同一终止信号不重复结束、不抛错。
    h.source.appendPages([page({ threadDone: [done], nextCursor: 'c2' })])
    await h.ingestor.pollOnce('github-pr')
    expect(ticket.state).toBe('ended')
    expect(ticket.ended?.outcome).toBe('merged')
  })
})

describe('坏事件隔离', () => {
  it('quarantines invalid events, still intakes valid ones and advances the cursor', async () => {
    const h = harness([
      page({
        events: [event({ key: 'good' }), { garbage: true }],
        nextCursor: 'c1',
      }),
    ])
    await h.ingestor.pollOnce('fake')

    expect(Object.keys(h.domain.state.triggers)).toHaveLength(1)
    const report = h.ingestor.quarantineReport()
    expect(report).toHaveLength(1)
    expect(report[0].sourceId).toBe('fake')
    expect(report[0].raw).toContain('garbage')
    expect(h.ingestor.status()[0].quarantined).toBe(1)
    expect(h.ingestor.status()[0].cursor).toBe('c1')
  })
})

describe('限流重连', () => {
  it('backs off exponentially on failures, resets on success and never blocks', async () => {
    vi.useFakeTimers()
    const h = harness([])
    h.source.error = new Error('boom')

    h.ingestor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.source.polls).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.source.polls).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(h.source.polls).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(4_000)
    expect(h.source.polls).toHaveLength(4)
    expect(h.ingestor.status()[0].consecutiveFailures).toBe(4)

    // 恢复：退避清零，回到固定轮询间隔。
    h.source.error = null
    h.source.appendPages([page({ events: [event({ key: 'e1' })], nextCursor: 'c1' })])
    await vi.advanceTimersByTimeAsync(8_000)
    expect(h.ingestor.status()[0].consecutiveFailures).toBe(0)
    expect(h.ingestor.status()[0].cursor).toBe('c1')

    await vi.advanceTimersByTimeAsync(2_000)
    expect(h.source.polls).toHaveLength(6)
  })

  it('caps the backoff delay', async () => {
    vi.useFakeTimers()
    const h = harness(
      [],
      'fake',
    )
    // 缩短退避参数，避免测试推进过长虚拟时间。
    const domain = h.domain
    const dir = tempDir('sa-ingestor-')
    const source = new FakeSource('fake')
    source.error = new Error('boom')
    const ingestor = createSourceIngestor({
      domain,
      sources: [source],
      cursorStore: createSourceCursorStore(dir),
      quarantine: createSourceQuarantine(dir),
      pollIntervalMs: 100,
      backoffBaseMs: 100,
      backoffCapMs: 400,
    })
    ingestors.push(ingestor)

    ingestor.start()
    await vi.advanceTimersByTimeAsync(0)
    for (let i = 1; i <= 8; i += 1) {
      await vi.advanceTimersByTimeAsync(400)
    }
    // 退避封顶 400ms：t=100/300/700/…/3100 共 9 次重试，加首次共 10 次 poll。
    expect(source.polls.length).toBe(10)
    expect(ingestor.status()[0].consecutiveFailures).toBe(10)
  })

  it('stops polling after stop()', async () => {
    vi.useFakeTimers()
    const h = harness([])
    h.source.appendPages([page({ events: [event({ key: 'e1' })], nextCursor: 'c1' })])

    h.ingestor.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.source.polls).toHaveLength(1)

    h.ingestor.stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(h.source.polls).toHaveLength(1)
    expect(h.ingestor.status()[0].running).toBe(false)
  })
})
