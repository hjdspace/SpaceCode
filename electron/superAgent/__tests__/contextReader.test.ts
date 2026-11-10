// @vitest-environment node
/**
 * Thread 上下文读取（#102）：预算集中、资源分页、角色隔离与评估窗口。
 *
 * 覆盖验收：
 *  - contextBudget 的预算值与设计 §8.1 一致；
 *  - trigger/thread/ticket 及其子资源可分页读取，截断带总量与续读指针；
 *  - 文本页分页结果可重组原文；
 *  - Worker 只能读自己工单、已到达 Trigger 与订阅 Thread；跨工单不可见；
 *  - 评估窗口包含开头若干条与候选前后各若干条，并带 read 指针。
 */
import { describe, expect, it } from 'vitest'
import { SUPER_AGENT_CONTEXT_BUDGETS } from '../contextBudget'
import {
  createSuperAgentContextReader,
  renderSuperAgentEvalThreadWindow,
  type SuperAgentReadListPage,
  type SuperAgentReadTextPage,
} from '../contextReader'
import { createSuperAgentDomain } from '../domain'

const AT = '2026-01-01T00:00:00.000Z'

interface Fixture {
  domain: ReturnType<typeof createSuperAgentDomain>
  /** th1 上的 20 条 Trigger（按到达顺序）。 */
  triggerIds: string[]
  ticketA: ReturnType<ReturnType<typeof createSuperAgentDomain>['createTicket']>['ticket']
  /** 与 ticketA 共享 th1 的另一张工单。 */
  ticketC: ReturnType<ReturnType<typeof createSuperAgentDomain>['createTicket']>['ticket']
  /** 独立 th2 上的工单。 */
  ticketB: ReturnType<ReturnType<typeof createSuperAgentDomain>['createTicket']>['ticket']
  /** th2 上与两张工单都无关的 Trigger。 */
  unrelatedTriggerId: string
}

function makeFixture(): Fixture {
  let counter = 0
  const domain = createSuperAgentDomain({
    now: () => new Date(AT),
    newId: (kind) => `${kind}-${++counter}`,
  })

  const triggerIds: string[] = []
  for (let index = 0; index < 20; index += 1) {
    const text =
      index === 3
        ? `消息 ${index}：${'y'.repeat(900)}`
        : index === 9 || index === 10
          ? `消息 ${index}：${'x'.repeat(2400)}`
          : `消息 ${index}：${'a'.repeat(200)}`
    triggerIds.push(
      domain.intakeTrigger({
        key: `k-${index}`,
        source: 'feishu-im',
        threadIds: ['th1'],
        actor: 'u1',
        human: true,
        addressed: 'mention',
        text,
      }).trigger.triggerId,
    )
  }

  const ticketA = domain.createTicket({
    requestId: 'req-a',
    title: '修登录',
    repoRoot: '/repo',
    trigger: {
      key: 'k-a',
      source: 'feishu-im',
      threadIds: ['th1'],
      actor: 'u1',
      human: true,
      addressed: 'mention',
      text: '请修登录',
    },
  }).ticket

  // 同一 Thread 上另一张工单：Worker A 不应看到它的订阅与授权。
  const ticketC = domain.createTicket({
    requestId: 'req-c',
    title: '另一张工单',
    repoRoot: '/repo',
    trigger: {
      key: 'k-c',
      source: 'feishu-im',
      threadIds: ['th1'],
      actor: 'u2',
      human: true,
      addressed: 'mention',
      text: '顺手改一下文案',
    },
  }).ticket

  const ticketB = domain.createTicket({
    requestId: 'req-b',
    title: '另一个 Thread',
    repoRoot: '/repo',
    trigger: {
      key: 'k-b',
      source: 'feishu-im',
      threadIds: ['th2'],
      actor: 'u3',
      human: true,
      addressed: 'mention',
      text: '别的事',
    },
  }).ticket

  const unrelatedTriggerId = domain.intakeTrigger({
    key: 'k-unrelated',
    source: 'feishu-im',
    threadIds: ['th2'],
    actor: 'u3',
    human: true,
    addressed: 'mention',
    text: '无关消息',
  }).trigger.triggerId

  return { domain, triggerIds, ticketA, ticketC, ticketB, unrelatedTriggerId }
}

function textPageOf(result: SuperAgentReadTextPage | SuperAgentReadListPage): SuperAgentReadTextPage {
  if (result.kind !== 'text') throw new Error('expected text page')
  return result
}

describe('contextBudget', () => {
  it('集中定义设计 §8.1 的预算值', () => {
    expect(SUPER_AGENT_CONTEXT_BUDGETS).toMatchObject({
      triggerPreviewChars: 160,
      workerTriggerChars: 600,
      assignmentChars: 1500,
      textPageChars: 4000,
      textPageMaxChars: 8000,
      listDefault: 20,
      listMax: 50,
      evalWindowHead: 5,
      evalWindowNeighbors: 5,
      evalMessageChars: 400,
      evalNeighborChars: 1200,
    })
  })
})

describe('readResource：文本页与分页', () => {
  it('Trigger 原文可分页读取，截断带总量/续读指针且分页可重组原文', () => {
    const f = makeFixture()
    const reader = createSuperAgentContextReader({ domain: f.domain })
    const resourceId = `trigger/${f.triggerIds[10]!}`

    const first = textPageOf(reader.readResource({ kind: 'router' }, resourceId, 0, 400))
    expect(first.totalChars).toBeGreaterThan(400)
    expect(first.read).toBe(400)
    expect(first.nextOffset).toBe(400)
    expect(first.text.length).toBe(400)

    // 逐页读到末尾，重组出的原文必须与完整文本一致（分页不丢字也不重复）。
    let reconstructed = first.text
    let nextOffset = first.nextOffset
    while (nextOffset !== null) {
      const page = textPageOf(reader.readResource({ kind: 'router' }, resourceId, nextOffset, 400))
      expect(page.offset).toBe(nextOffset)
      reconstructed += page.text
      nextOffset = page.nextOffset
    }

    const full = textPageOf(
      reader.readResource({ kind: 'router' }, resourceId, 0, SUPER_AGENT_CONTEXT_BUDGETS.textPageMaxChars),
    )
    expect(reconstructed).toBe(full.text)
    expect(full.text).toContain(`消息 10：${'x'.repeat(200)}`)
    expect(full.nextOffset).toBeNull()
    expect(full.read).toBe(full.totalChars)
  })

  it('limit 缺省/超上限时按设计预算收敛', () => {
    const f = makeFixture()
    const reader = createSuperAgentContextReader({ domain: f.domain })
    const resourceId = `trigger/${f.triggerIds[0]!}`

    const defaulted = textPageOf(reader.readResource({ kind: 'router' }, resourceId))
    const read = Math.min(defaulted.totalChars, SUPER_AGENT_CONTEXT_BUDGETS.textPageChars)
    expect(defaulted.read).toBe(read)

    const oversized = textPageOf(reader.readResource({ kind: 'router' }, resourceId, 0, 99_999))
    expect(oversized.read).toBe(
      Math.min(oversized.totalChars, SUPER_AGENT_CONTEXT_BUDGETS.textPageMaxChars),
    )
  })

  it('Thread 时间线带 Trigger 预览与续读指针，并列出订阅工单', () => {
    const f = makeFixture()
    const reader = createSuperAgentContextReader({ domain: f.domain })
    const page = textPageOf(reader.readResource({ kind: 'router' }, 'thread/th1', 0, 8000))

    expect(page.text).toContain('## 时间线')
    expect(page.text).toContain(`trigger/${f.triggerIds[0]!}`)
    expect(page.text).toContain('total_chars=')
    expect(page.text).toContain(f.ticketA.ticketId)
    expect(page.text).toContain(f.ticketC.ticketId)
  })

  it('Ticket 详情与 inputs/report 子资源可读，assignments 走列表预算', () => {
    const f = makeFixture()
    const reader = createSuperAgentContextReader({ domain: f.domain })
    f.domain.startAssignment({ ticketId: f.ticketA.ticketId })
    f.domain.addInput({
      ticketId: f.ticketA.ticketId,
      requestId: 'input-1',
      kind: 'text',
      human: true,
      text: '补充：只在密码错误时弹',
    })

    const detail = textPageOf(
      reader.readResource({ kind: 'router' }, `ticket/${f.ticketA.ticketId}`, 0, 8000),
    )
    expect(detail.text).toContain(f.ticketA.title)
    expect(detail.text).toContain(f.ticketA.mandateId)

    const inputs = textPageOf(
      reader.readResource({ kind: 'router' }, `ticket/${f.ticketA.ticketId}/inputs`, 0, 8000),
    )
    expect(inputs.text).toContain('补充：只在密码错误时弹')

    const report = textPageOf(
      reader.readResource({ kind: 'router' }, `ticket/${f.ticketA.ticketId}/report`, 0, 8000),
    )
    expect(report.kind).toBe('text')

    const assignments = reader.readResource(
      { kind: 'router' },
      `ticket/${f.ticketA.ticketId}/assignments`,
      0,
      99_999,
    )
    expect(assignments.kind).toBe('list')
    const list = assignments as SuperAgentReadListPage
    expect(list.items).toHaveLength(1)
    expect(list.limit).toBe(SUPER_AGENT_CONTEXT_BUDGETS.listMax)
    expect(list.nextOffset).toBeNull()
  })
})

describe('readResource：Worker 角色隔离', () => {
  it('只能读自己的 Ticket 与其子资源，跨工单按不存在处理', () => {
    const f = makeFixture()
    const reader = createSuperAgentContextReader({ domain: f.domain })
    const worker = { kind: 'worker' as const, ticketId: f.ticketA.ticketId }

    expect(() => reader.readResource(worker, `ticket/${f.ticketC.ticketId}`)).toThrow(/ticketNotFound/)
    expect(() => reader.readResource(worker, `ticket/${f.ticketB.ticketId}/inputs`)).toThrow(
      /ticketNotFound/,
    )
    expect(reader.readResource(worker, `ticket/${f.ticketA.ticketId}`).kind).toBe('text')
  })

  it('可读订阅 Thread 上的 Trigger，未订阅 Thread 的资源不可见', () => {
    const f = makeFixture()
    const reader = createSuperAgentContextReader({ domain: f.domain })
    const worker = { kind: 'worker' as const, ticketId: f.ticketA.ticketId }

    expect(reader.readResource(worker, `trigger/${f.triggerIds[0]!}`).kind).toBe('text')
    expect(() => reader.readResource(worker, `trigger/${f.unrelatedTriggerId}`)).toThrow(
      /triggerNotFound/,
    )
    expect(() => reader.readResource(worker, 'thread/th2')).toThrow(/threadNotFound/)
    expect(reader.readResource(worker, 'thread/th1').kind).toBe('text')
  })

  it('Worker 读共享 Thread 时不暴露其他工单的订阅与授权', () => {
    const f = makeFixture()
    const reader = createSuperAgentContextReader({ domain: f.domain })
    const worker = { kind: 'worker' as const, ticketId: f.ticketA.ticketId }
    const page = textPageOf(reader.readResource(worker, 'thread/th1', 0, 8000))
    const text = page.text

    expect(text).toContain(f.ticketA.ticketId)
    expect(text).not.toContain(f.ticketC.ticketId)
    expect(text).not.toContain('mandate-')
    expect(text).not.toContain('Decision')
  })
})

describe('评估窗口', () => {
  it('包含开头 5 条与候选前后各 5 条，普通消息 400、紧邻 1200，并带 read 指针', () => {
    const f = makeFixture()
    const window = renderSuperAgentEvalThreadWindow(f.domain.state, 'th1', [f.triggerIds[10]!])

    expect(window).not.toBeNull()
    const text = window!.text
    expect(text).toContain('## Thread 窗口')
    expect(text).toContain('消息 0：')
    expect(text).toContain('消息 4：')
    expect(text).toContain('消息 5：')
    expect(text).toContain('消息 15：')
    expect(text).not.toContain('消息 16：')
    expect(text).not.toContain('消息 19：')
    expect(text).toContain('[候选]')
    // 头部普通消息按 400 截断，候选与紧邻按 1200 截断
    expect(text).toContain(`read=${SUPER_AGENT_CONTEXT_BUDGETS.evalMessageChars}`)
    expect(text).toContain(`read=${SUPER_AGENT_CONTEXT_BUDGETS.evalNeighborChars}`)
    expect(text).toContain(`续读 trigger/${f.triggerIds[3]!}`)
    expect(text).toContain(`续读 trigger/${f.triggerIds[10]!}`)
    expect(window!.includedTriggerIds).toEqual(
      f.triggerIds.slice(0, 16),
    )
  })

  it('Thread 不存在时返回 null，不伪造窗口', () => {
    const f = makeFixture()
    expect(renderSuperAgentEvalThreadWindow(f.domain.state, 'missing', ['trigger-x'])).toBeNull()
  })
})
