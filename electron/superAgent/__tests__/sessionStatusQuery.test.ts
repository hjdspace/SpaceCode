// @vitest-environment node
/**
 * sessionStatusQuery 契约（设计 §8.3）：Router 每轮看到的编排事实。
 *
 * 它要回答的是"现在有哪些活"，所以：
 *  - 只列未结束工单，已结束（completed/stopped/dropped）不再占用索引；
 *  - 队列位来自 scheduler，currentTool/elapsed 来自投影 —— 都是既有真源，
 *    这里只做汇总，不另起一份状态；
 *  - progress Report 不算结论，索引里只给最新那份能向人交代的；
 *  - 拿不到的事实如实标 unknown。
 */
import { describe, expect, it } from 'vitest'
import type {
  SuperAgentQueueSnapshot,
  SuperAgentTicketProgress,
} from '@/shared/channels/superAgent'
import { createSuperAgentDomain } from '../domain'
import { createSuperAgentProgressProjector } from '../progressProjector'
import { renderSuperAgentRouterStatusContext } from '../prompts'
import { createSuperAgentSessionStatusQuery } from '../sessionStatusQuery'
import { superAgentWorkerEngineSessionId } from '../sessionId'

const REPO = 'D:/repo'

function emptyQueue(maxWorkers = 1): SuperAgentQueueSnapshot {
  return { repoRoot: REPO, maxWorkers, running: [], queued: [] }
}

function harness() {
  let counter = 0
  const nextId = (prefix: string) => `${prefix}-${(counter += 1)}`
  const domain = createSuperAgentDomain({ newId: () => nextId('id') })
  const projector = createSuperAgentProgressProjector({
    domain,
    repoRoot: REPO,
    onTicketUpdated: () => {},
    onTicketProgress: () => {},
  })
  let queue = emptyQueue()
  const progressById = new Map<string, SuperAgentTicketProgress>()

  const query = createSuperAgentSessionStatusQuery({
    repoRoot: REPO,
    domain,
    cards: () => projector.cards(),
    queue: () => queue,
    progress: (ticketId) => progressById.get(ticketId) ?? null,
    nowMs: () => Date.parse('2026-11-05T05:00:00.000Z'),
  })

  function dispatchTicket(title: string) {
    const result = domain.dispatch({
      requestId: nextId('req'),
      title,
      repoRoot: REPO,
      text: `${title} 的任务说明`,
      actor: 'tester',
    })
    projector.sync()
    return { ticketId: result.ticket.ticketId, assignmentId: result.assignment.assignmentId }
  }

  return {
    domain,
    projector,
    query,
    dispatchTicket,
    setQueue(next: SuperAgentQueueSnapshot) {
      queue = next
    },
    setProgress(ticketId: string, progress: SuperAgentTicketProgress) {
      progressById.set(ticketId, progress)
    },
  }
}

describe('createSuperAgentSessionStatusQuery', () => {
  it('lists an open ticket with its queue position and no conclusive report yet', () => {
    const h = harness()
    const { ticketId, assignmentId } = h.dispatchTicket('修复登录')
    h.domain.launchAssignment({ assignmentId })
    h.projector.sync()
    h.setQueue({
      ...emptyQueue(),
      running: [{
        ticketId, title: '修复登录', position: 0, state: 'running', dirty: null,
      }],
    })

    const snapshot = h.query.statusQuery()

    expect(snapshot.slots).toEqual({ maxWorkers: 1, running: 1, queued: 0 })
    expect(snapshot.tickets).toHaveLength(1)
    expect(snapshot.tickets[0]).toMatchObject({
      ticketId,
      title: '修复登录',
      state: 'working',
      queuePosition: 0,
      latestReport: null,
      waitingForHuman: false,
    })
  })

  it('drops finished tickets and keeps the light progress facts it was given', () => {
    const h = harness()
    const running = h.dispatchTicket('还在跑')
    const done = h.dispatchTicket('已经收工')
    h.domain.launchAssignment({ assignmentId: running.assignmentId })
    h.domain.launchAssignment({ assignmentId: done.assignmentId })
    h.domain.report({
      ticketId: done.ticketId,
      assignmentId: done.assignmentId,
      reportId: 'report-done',
      kind: 'ready',
      summary: '改完并自测通过',
    })
    h.domain.ticketAccept({ ticketId: done.ticketId })
    h.projector.sync()
    h.setProgress(running.ticketId, {
      repoRoot: REPO,
      seq: 3,
      ticketId: running.ticketId,
      state: 'working',
      assignmentId: running.assignmentId,
      currentTool: 'Bash',
      elapsedMs: 200_000,
      toolCalls: 12,
      lastActivityAt: '2026-11-05T04:59:00.000Z',
    })

    const snapshot = h.query.statusQuery()

    expect(snapshot.tickets.map((ticket) => ticket.ticketId)).toEqual([running.ticketId])
    expect(snapshot.tickets[0]).toMatchObject({
      state: 'working',
      currentTool: 'Bash',
      elapsedMs: 200_000,
      lastActivityAt: '2026-11-05T04:59:00.000Z',
    })
  })

  it('keeps ended tickets and their worker session ids available for an explicit resume', () => {
    const h = harness()
    const done = h.dispatchTicket('分析覆盖率')
    h.domain.launchAssignment({ assignmentId: done.assignmentId })
    h.domain.report({
      ticketId: done.ticketId,
      assignmentId: done.assignmentId,
      reportId: 'report-done',
      kind: 'ready',
      summary: '覆盖率分析完成',
    })
    h.domain.ticketAccept({ ticketId: done.ticketId })
    h.projector.sync()

    const snapshot = h.query.statusQuery()
    const workerSessionId = superAgentWorkerEngineSessionId(done.ticketId)

    expect(snapshot.tickets).toEqual([])
    expect(snapshot.endedTickets).toEqual([
      expect.objectContaining({
        ticketId: done.ticketId,
        title: '分析覆盖率',
        state: 'completed',
        workerSessionId,
      }),
    ])
    const context = renderSuperAgentRouterStatusContext(snapshot)
    expect(context).toContain('[已结束工单]')
    expect(context).toContain(done.ticketId)
    expect(context).toContain(workerSessionId)
  })

  it('surfaces the latest conclusive report and flags tickets waiting for a person', () => {
    const h = harness()
    const { ticketId, assignmentId } = h.dispatchTicket('补测试用例')
    h.domain.report({
      ticketId,
      assignmentId,
      reportId: 'report-progress',
      kind: 'progress',
      summary: '已写完两个用例',
    })
    h.domain.report({
      ticketId,
      assignmentId,
      reportId: 'report-failed',
      kind: 'failed',
      summary: 'vitest 起不来，缺 @swc/core',
    })
    h.projector.sync()

    const entry = h.query.statusQuery().tickets[0]

    expect(entry.state).toBe('failed')
    expect(entry.waitingForHuman).toBe(true)
    // progress 只说明"还在动"，能向人交代的是最后那份 failed
    expect(entry.latestReport).toMatchObject({ kind: 'failed', summary: 'vitest 起不来，缺 @swc/core' })
  })

  it('counts open attentions per ticket and reports background jobs as unknown', () => {
    const h = harness()
    const { ticketId, assignmentId } = h.dispatchTicket('要人拍板')
    // Worker 的提问必须挂在一条人消息上（领域校验 asker 是 human input）
    const asked = h.domain.addInput({
      ticketId,
      requestId: 'req-ask',
      kind: 'text',
      human: true,
      text: '范围你定',
    })
    h.domain.report({
      ticketId,
      assignmentId,
      reportId: 'report-ask',
      kind: 'waiting',
      summary: '需要决定范围',
      question: '只补单测还是连集成一起补？',
      askedBy: asked.input.inputId,
    })
    h.projector.sync()

    const snapshot = h.query.statusQuery()

    expect(snapshot.backgroundJobs).toBe('unknown')
    expect(snapshot.pendingAttention).toBe(1)
    expect(snapshot.tickets[0]).toMatchObject({ state: 'answer', waitingForHuman: true })
  })

  it('marks the snapshot with the domain sequence it was read at', () => {
    const h = harness()
    const before = h.query.statusQuery()
    h.dispatchTicket('新派一张')

    const after = h.query.statusQuery()

    expect(after.seq).toBeGreaterThan(before.seq)
    expect(after.asOf).toBe('2026-11-05T05:00:00.000Z')
  })
})

describe('renderSuperAgentRouterStatusContext', () => {
  it('says there is no active work instead of emitting an empty list', () => {
    const text = renderSuperAgentRouterStatusContext({
      repoRoot: REPO,
      asOf: '2026-11-05T05:00:00.000Z',
      seq: 0,
      slots: { maxWorkers: 1, running: 0, queued: 0 },
      backgroundJobs: 'unknown',
      pendingAttention: 0,
      tickets: [],
      endedTickets: [],
    })

    expect(text).toContain('[工单快照]')
    expect(text).toContain('当前没有活跃工单')
  })

  it('renders each ticket with stage, elapsed time, tool and the report to hand back', () => {
    const text = renderSuperAgentRouterStatusContext({
      repoRoot: REPO,
      asOf: '2026-11-05T05:00:00.000Z',
      seq: 7,
      slots: { maxWorkers: 1, running: 1, queued: 1 },
      backgroundJobs: 'unknown',
      pendingAttention: 0,
      endedTickets: [],
      tickets: [
        {
          ticketId: 'ticket-1',
          title: '补测试用例',
          workerSessionId: 'worker-session-1',
          state: 'working',
          assignmentId: 'a1',
          generation: 1,
          queuePosition: 0,
          currentTool: 'Bash',
          elapsedMs: 200_000,
          lastActivityAt: '2026-11-05T04:59:00.000Z',
          waitingForHuman: false,
          latestReport: null,
        },
        {
          ticketId: 'ticket-2',
          title: '收口表单校验',
          workerSessionId: 'worker-session-2',
          state: 'queued',
          assignmentId: 'a2',
          generation: 1,
          queuePosition: 1,
          currentTool: null,
          elapsedMs: null,
          lastActivityAt: '2026-11-05T04:50:00.000Z',
          waitingForHuman: false,
          latestReport: { kind: 'failed', summary: '缺依赖', at: '2026-11-05T04:50:00.000Z' },
        },
      ],
    })

    // 工单号原样给出：attach/stop 回填的就是这个串
    expect(text).toContain('工单 ticket-1「补测试用例」：执行中 · 第 1 代 · 已跑 3 分 20 秒 · 当前工具 Bash')
    expect(text).toContain('工单 ticket-2「收口表单校验」：排队中 · 第 1 代 · 队列位 1')
    expect(text).toContain('最新汇报（失败）：缺依赖')
    expect(text).toContain('槽位：1/1 执行中 · 1 排队')
    // 明确告诉模型别再自己翻历史
    expect(text).toContain('不要翻 git 历史或读文件推断')
    expect(text).toContain('`attach`/`stop` 用下面的工单号')
  })
})
