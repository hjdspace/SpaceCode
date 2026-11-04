// @vitest-environment node
/**
 * T11 #81 崩溃恢复领域规则与启动恢复顺序：
 *  - running → interrupted：重启后不出现「进程已退出但 Assignment 仍 running」；
 *  - busy 判定：仍在执行未 handoff、或 handoff Report 后又有新 Input 的工单
 *    建 generation+1 恢复 Assignment；非 busy（waiting/ready/blocked/failed/
 *    权限等待）保持原 Assignment、Attention 与阶段，不自动 launch；
 *  - delivered 未 read 的输入对账：未读回队首并清会话副本（只投一次）；
 *    已 read 不重复投递；uncertain 保持并保留 Attention；
 *  - 恢复按原 queueOrder oldest first，且幂等：二次恢复不重复建代次；
 *  - 暂停是持久领域事实：暂停期间 addInput 只落库不投递。
 */
import { describe, expect, it } from 'vitest'
import {
  createSuperAgentDomain,
  type DispatchResult,
  type SuperAgentDomain,
} from '../domain'
import { runStartupRecovery } from '../recovery'
import type { SuperAgentDomainState } from '../model'

const AT = '2026-01-01T00:00:00.000Z'

let counter = 0
function makeDomain(initialState?: SuperAgentDomainState): SuperAgentDomain {
  counter = 0
  return createSuperAgentDomain({
    now: () => new Date(AT),
    newId: (kind) => `${kind}-${++counter}`,
    ...(initialState ? { initialState } : {}),
  })
}

function codeOf(fn: () => unknown): string {
  try {
    fn()
    return '<no-error>'
  } catch (err) {
    return (err as { code?: string }).code ?? '<no-code>'
  }
}

function dispatch(domain: SuperAgentDomain, n: number): DispatchResult {
  return domain.dispatch({
    requestId: `req-${n}`,
    title: `工单 ${n}`,
    repoRoot: '/repo',
    text: `目标 ${n}`,
    actor: 'tester',
  })
}

function launchLatest(domain: SuperAgentDomain, ticketId: string): string {
  const ticket = domain.state.tickets[ticketId]
  const assignmentId = ticket.assignmentIds[ticket.assignmentIds.length - 1]
  domain.launchAssignment({ assignmentId })
  return assignmentId
}

function addHumanInput(domain: SuperAgentDomain, ticketId: string, n: number) {
  return domain.addInput({
    ticketId,
    requestId: `input-${n}`,
    kind: 'text',
    human: true,
    text: `人消息 ${n}`,
  })
}

describe('重启恢复：running 标 interrupted 与 busy 判定', () => {
  it('仍在执行且未 handoff 的工单标 interrupted 并建 generation+1 的恢复 Assignment', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    launchLatest(domain, ticket.ticketId)

    const result = runStartupRecovery(domain)

    expect(result.interrupted).toHaveLength(1)
    expect(result.interrupted[0]).toMatchObject({ ticketId: ticket.ticketId })
    expect(result.recovered).toHaveLength(1)
    const recovered = result.recovered[0]
    expect(recovered.ticketId).toBe(ticket.ticketId)
    expect(recovered.generation).toBe(2)

    const gen2 = domain.state.assignments[recovered.assignmentId]
    expect(gen2.state).toBe('pending')
    expect(gen2.generation).toBe(2)
    // 原代次收尾为 interrupted，不再 running
    const gen1 = domain.state.assignments[ticket.assignmentIds[0]]
    expect(gen1.state).toBe('interrupted')
    expect(gen1.endedReason).toBe('interrupted')
  })

  it('ready 后无新输入的工单保持 person/review：原 Assignment、Attention 与阶段不自动 launch', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    const assignmentId = launchLatest(domain, ticket.ticketId)
    domain.report({
      ticketId: ticket.ticketId,
      assignmentId,
      reportId: 'rep-ready',
      kind: 'ready',
      summary: '已完成',
    })

    const result = runStartupRecovery(domain)

    expect(result.recovered).toEqual([])
    expect(ticket.assignmentIds).toHaveLength(1)
    expect(domain.stageOf(ticket.ticketId)).toBe('person/review')
    expect(domain.state.assignments[assignmentId].state).toBe('interrupted')
  })

  it('waiting/ready handoff 后又有新 Input 的工单恢复新代次', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    const assignmentId = launchLatest(domain, ticket.ticketId)
    domain.report({
      ticketId: ticket.ticketId,
      assignmentId,
      reportId: 'rep-waiting',
      kind: 'waiting',
      summary: '等待补充信息',
    })
    addHumanInput(domain, ticket.ticketId, 1)

    const result = runStartupRecovery(domain)

    expect(result.recovered).toHaveLength(1)
    expect(result.recovered[0].generation).toBe(2)
  })

  it('blocked/failed 后无新人消息的工单保持人工阶段，不恢复代次', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    const assignmentId = launchLatest(domain, ticket.ticketId)
    domain.report({
      ticketId: ticket.ticketId,
      assignmentId,
      reportId: 'rep-blocked',
      kind: 'blocked',
      summary: '被外部依赖挡住',
    })

    const result = runStartupRecovery(domain)

    expect(result.recovered).toEqual([])
    expect(domain.stageOf(ticket.ticketId)).toBe('person/blocked')
  })

  it('权限等待（open Attention）的工单保持 person/answer，不自动 launch', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    const assignmentId = launchLatest(domain, ticket.ticketId)
    const asked = addHumanInput(domain, ticket.ticketId, 1)
    domain.report({
      ticketId: ticket.ticketId,
      assignmentId,
      reportId: 'rep-question',
      kind: 'waiting',
      summary: '需要确认',
      question: '继续吗？',
      askedBy: asked.input.inputId,
    })

    const result = runStartupRecovery(domain)

    expect(result.recovered).toEqual([])
    expect(domain.stageOf(ticket.ticketId)).toBe('person/answer')
    const openAttentions = Object.values(domain.state.attentions).filter(
      (attention) => attention.status === 'open',
    )
    expect(openAttentions).toHaveLength(1)
  })

  it('恢复按原 queueOrder oldest first：中断代次先创建者先恢复', () => {
    const domain = makeDomain()
    const first = dispatch(domain, 1).ticket
    const second = dispatch(domain, 2).ticket
    launchLatest(domain, first.ticketId)
    launchLatest(domain, second.ticketId)

    const result = runStartupRecovery(domain)

    expect(result.recovered.map((item) => item.ticketId)).toEqual([
      first.ticketId,
      second.ticketId,
    ])
    const firstGen2 = domain.state.assignments[result.recovered[0].assignmentId]
    const secondGen2 = domain.state.assignments[result.recovered[1].assignmentId]
    expect(firstGen2.createdOrdinal).toBeLessThan(secondGen2.createdOrdinal)
  })

  it('恢复幂等：对已恢复状态二次运行不重复建代次、不重复对账', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    launchLatest(domain, ticket.ticketId)
    addHumanInput(domain, ticket.ticketId, 1)

    const first = runStartupRecovery(domain)
    const second = runStartupRecovery(domain)

    expect(first.recovered).toHaveLength(1)
    expect(second.interrupted).toEqual([])
    expect(second.recovered).toEqual([])
    expect(second.requeued).toEqual([])
    expect(ticket.assignmentIds).toHaveLength(2)
  })
})

describe('重启恢复：delivered 未 read 的输入对账', () => {
  it('未读输入回队首并清会话副本：退回 pending 且 deliveredTo 清空，只投一次', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    launchLatest(domain, ticket.ticketId)
    const added = addHumanInput(domain, ticket.ticketId, 1)
    expect(added.input.status).toBe('delivered')

    const result = runStartupRecovery(domain)

    expect(result.requeued.map((item) => item.inputId)).toEqual([added.input.inputId])
    const input = domain.state.inputs[added.input.inputId]
    expect(input.status).toBe('pending')
    expect(input.deliveredTo).toBeNull()
    expect(input.deliveredAt).toBeNull()
  })

  it('已 read 的输入不重复投递：保持 read 与投递归属', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    const assignmentId = launchLatest(domain, ticket.ticketId)
    const added = addHumanInput(domain, ticket.ticketId, 1)
    domain.markInputRead({ inputId: added.input.inputId })

    const result = runStartupRecovery(domain)

    expect(result.requeued).toEqual([])
    const input = domain.state.inputs[added.input.inputId]
    expect(input.status).toBe('read')
    expect(input.deliveredTo).toBe(assignmentId)
  })

  it('uncertain 输入保持 uncertain 并保留 delivery Attention，不盲目重投', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    launchLatest(domain, ticket.ticketId)
    const added = addHumanInput(domain, ticket.ticketId, 1)
    domain.markInputUncertain({ inputId: added.input.inputId, reason: 'deliveryUnknown' })

    const result = runStartupRecovery(domain)

    expect(result.requeued).toEqual([])
    expect(domain.state.inputs[added.input.inputId].status).toBe('uncertain')
    const open = Object.values(domain.state.attentions).filter(
      (attention) => attention.status === 'open' && attention.kind === 'delivery',
    )
    expect(open).toHaveLength(1)
  })

  it('对账只针对最新代次被中断的工单，不影响仍在排队的工单', () => {
    const domain = makeDomain()
    const running = dispatch(domain, 1).ticket
    launchLatest(domain, running.ticketId)
    const delivered = addHumanInput(domain, running.ticketId, 1)
    // 第二张工单从未启动：其 Input（pending latest 下直接落 delivered）不参与对账
    const queued = dispatch(domain, 2).ticket
    const queuedInput = domain.addInput({
      ticketId: queued.ticketId,
      requestId: 'input-9',
      kind: 'text',
      human: true,
      text: '排队中的消息',
    })

    const result = runStartupRecovery(domain)

    expect(result.requeued.map((item) => item.inputId)).toEqual([delivered.input.inputId])
    // 排队工单的输入保持 delivered：最新代次未被中断，不回队、不清会话副本
    expect(queuedInput.input.status).toBe('delivered')
    expect(queuedInput.input.deliveredTo).not.toBeNull()
    expect(queued.assignmentIds).toHaveLength(1)
  })
})

describe('领域接缝：recoverTicket / markInputRead / pauseProject', () => {
  it('recoverTicket 只在最新代次为 interrupted 时建 generation+1 的 pending 恢复代次', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    const assignmentId = launchLatest(domain, ticket.ticketId)
    domain.endAssignment({ assignmentId, reason: 'interrupted' })

    const result = domain.recoverTicket({ ticketId: ticket.ticketId })

    expect(result.assignment.state).toBe('pending')
    expect(result.assignment.generation).toBe(2)
    expect(codeOf(() => domain.recoverTicket({ ticketId: ticket.ticketId }))).toBe('notRetryable')
  })

  it('recoverTicket 拒绝已结束工单与排队中的最新代次', () => {
    const domain = makeDomain()
    const stopped = dispatch(domain, 1).ticket
    domain.ticketStop({ ticketId: stopped.ticketId })
    expect(codeOf(() => domain.recoverTicket({ ticketId: stopped.ticketId }))).toBe('ticketEnded')

    const queued = dispatch(domain, 2).ticket
    expect(codeOf(() => domain.recoverTicket({ ticketId: queued.ticketId }))).toBe('notRetryable')
  })

  it('markInputRead 把已投递输入标为已读，幂等且拒绝未投递输入', () => {
    const domain = makeDomain()
    const { ticket } = dispatch(domain, 1)
    launchLatest(domain, ticket.ticketId)
    const added = addHumanInput(domain, ticket.ticketId, 1)

    domain.markInputRead({ inputId: added.input.inputId })
    const read = domain.markInputRead({ inputId: added.input.inputId })
    expect(read.status).toBe('read')
    expect(read.readAt).toBe(AT)

    // blocked 闸门后的非人输入保持 pending（只有 human 输入能解闸）
    const gated = dispatch(domain, 2).ticket
    const gatedAssignmentId = launchLatest(domain, gated.ticketId)
    domain.report({
      ticketId: gated.ticketId,
      assignmentId: gatedAssignmentId,
      reportId: 'rep-blocked',
      kind: 'blocked',
      summary: '被挡住',
    })
    const pendingInput = domain.addInput({
      ticketId: gated.ticketId,
      requestId: 'input-8',
      kind: 'note',
      human: false,
      text: '未投递的备注',
    })
    expect(pendingInput.input.status).toBe('pending')
    expect(codeOf(() => domain.markInputRead({ inputId: pendingInput.input.inputId }))).toBe('conflict')
  })

  it('暂停是领域事实：暂停期间 addInput 只落库不投递，恢复后重新可投递', () => {
    const domain = makeDomain()
    expect(domain.state.paused).toBe(false)

    const { ticket } = dispatch(domain, 1)
    launchLatest(domain, ticket.ticketId)
    domain.pauseProject()

    const added = addHumanInput(domain, ticket.ticketId, 1)
    expect(added.delivered).toBe(false)
    expect(added.input.status).toBe('pending')

    domain.resumeProject()
    expect(domain.state.paused).toBe(false)
    const next = addHumanInput(domain, ticket.ticketId, 2)
    expect(next.delivered).toBe(true)
    expect(next.input.status).toBe('delivered')
  })

  it('pauseProject/resumeProject 幂等且可重复切换', () => {
    const domain = makeDomain()
    domain.pauseProject()
    domain.pauseProject()
    expect(domain.state.paused).toBe(true)
    domain.resumeProject()
    domain.resumeProject()
    expect(domain.state.paused).toBe(false)
  })

  it('initialState 重水化补默认字段并保留既有事实（前向兼容）', () => {
    const base = makeDomain()
    const { ticket } = dispatch(base, 1)
    const persisted = JSON.parse(JSON.stringify(base.state)) as SuperAgentDomainState
    // 模拟旧版本快照缺少新字段：删除后仍应恢复默认值
    const legacy = { ...persisted } as unknown as Record<string, unknown>
    delete legacy.paused
    delete legacy.pausedAt
    delete legacy.handbacks

    const revived = makeDomain(legacy as unknown as SuperAgentDomainState)
    expect(revived.state.paused).toBe(false)
    expect(revived.state.pausedAt).toBeNull()
    expect(revived.state.handbacks).toEqual([])
    expect(revived.state.tickets[ticket.ticketId].title).toBe('工单 1')
    expect(revived.state.seq).toBeGreaterThan(0)
  })

  it('重水化后的工单阶段与原状态一致（派生不依赖内存外的隐藏状态）', () => {
    const base = makeDomain()
    const { ticket } = dispatch(base, 1)
    const assignmentId = launchLatest(base, ticket.ticketId)
    base.report({
      ticketId: ticket.ticketId,
      assignmentId,
      reportId: 'rep-ready',
      kind: 'ready',
      summary: '已完成',
    })
    const persisted = JSON.parse(JSON.stringify(base.state)) as SuperAgentDomainState

    const revived = makeDomain(persisted)
    expect(revived.stageOf(ticket.ticketId)).toBe('person/review')
  })
})
