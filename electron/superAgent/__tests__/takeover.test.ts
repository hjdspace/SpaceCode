// @vitest-environment node
/**
 * T09 #79 接管与交还：
 *  - 接管/交还只切面板态：workerTakeover/workerRelease 不改调度（队列快照原样）；
 *  - 同一项目同时至多一个接管：同 ticket 幂等、异 ticket 冲突、跨项目互不影响；
 *  - 接管输入先落库再投递：workerMessage 走 Domain.addInput（requestId 幂等），
 *    不直连引擎；重投有对账依据 —— 可证明未接受（pending）才重投，
 *    无法确定转 uncertain 并产生 Attention，禁止盲目重投；
 *  - 交还/关闭标签不残留接管态；workerUnbind 一并释放接管。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createSuperAgentDomain,
  type SuperAgentDomain,
} from '../domain'
import { createSuperAgentService, type SuperAgentService } from '../service'
import { isSuperAgentDomainError } from '../errors'

function dispatchTicket(domain: SuperAgentDomain, title = '修复登录') {
  return domain.dispatch({
    requestId: `req-${title}`,
    title,
    repoRoot: 'D:/repo',
    text: `${title}：登录按钮无响应`,
    actor: 'tester',
  })
}

describe('domain markInputUncertain（T09 #79）', () => {
  it('把投递结果未知的 Input 标为 uncertain 并产生 delivery Attention', () => {
    const domain = createSuperAgentDomain()
    const created = dispatchTicket(domain)
    const added = domain.addInput({
      ticketId: created.ticket.ticketId,
      requestId: 'msg-1',
      kind: 'text',
      human: true,
      text: '继续修复',
    })

    const result = domain.markInputUncertain({ inputId: added.input.inputId, reason: 'deliveryUnknown' })

    expect(result.input.status).toBe('uncertain')
    expect(result.duplicate).toBe(false)
    expect(result.attentionId).not.toBeNull()
    const attention = domain.state.attentions[result.attentionId as string]
    expect(attention.kind).toBe('delivery')
    expect(attention.askedBy).toBe(added.input.inputId)
    expect(attention.status).toBe('open')
    // Attention 让阶段进入等人：uncertain 必须让人看见，而不是静默重投
    expect(domain.stageOf(created.ticket.ticketId)).toBe('person/answer')
  })

  it('重复标记幂等：不新建第二个 Attention，duplicate=true', () => {
    const domain = createSuperAgentDomain()
    const created = dispatchTicket(domain)
    const added = domain.addInput({
      ticketId: created.ticket.ticketId,
      requestId: 'msg-1',
      kind: 'text',
      human: true,
      text: '继续修复',
    })

    const first = domain.markInputUncertain({ inputId: added.input.inputId })
    const second = domain.markInputUncertain({ inputId: added.input.inputId })

    expect(second.duplicate).toBe(true)
    expect(second.attentionId).toBe(first.attentionId)
    expect(
      Object.values(domain.state.attentions).filter((a) => a.ticketId === created.ticket.ticketId),
    ).toHaveLength(1)
  })

  it('未知的 Input 抛 inputNotFound', () => {
    const domain = createSuperAgentDomain()
    expect(() => domain.markInputUncertain({ inputId: 'input-x' })).toThrowError(
      expect.objectContaining({ code: 'inputNotFound' }),
    )
  })
})

describe('domain requeueInput（T09 #79）', () => {
  it('把已投未读的 Input 退回 pending（可证明未接受才允许重投）', () => {
    const domain = createSuperAgentDomain()
    const created = dispatchTicket(domain)
    const added = domain.addInput({
      ticketId: created.ticket.ticketId,
      requestId: 'msg-1',
      kind: 'text',
      human: true,
      text: '继续修复',
    })
    expect(added.input.status).toBe('delivered')

    const requeued = domain.requeueInput({ inputId: added.input.inputId })

    expect(requeued.status).toBe('pending')
    expect(requeued.deliveredTo).toBeNull()
    expect(requeued.deliveredAt).toBeNull()
  })

  it('pending 的 Input 再退回属于冲突，read/failed/uncertain 一律拒绝', () => {
    const domain = createSuperAgentDomain()
    const created = dispatchTicket(domain)
    const added = domain.addInput({
      ticketId: created.ticket.ticketId,
      requestId: 'msg-1',
      kind: 'text',
      human: true,
      text: '继续修复',
    })

    expect(() => domain.requeueInput({ inputId: 'input-x' })).toThrowError(
      expect.objectContaining({ code: 'inputNotFound' }),
    )

    domain.requeueInput({ inputId: added.input.inputId })
    expect(() => domain.requeueInput({ inputId: added.input.inputId })).toThrowError(
      expect.objectContaining({ code: 'conflict' }),
    )

    domain.markInputUncertain({ inputId: added.input.inputId })
    expect(() => domain.requeueInput({ inputId: added.input.inputId })).toThrowError(
      expect.objectContaining({ code: 'conflict' }),
    )
  })
})

describe('domain addInput 与执行状态（T09 #79：不搅动调度）', () => {
  it('Assignment 结束后新消息只落库为 pending，不改派任何执行', () => {
    const domain = createSuperAgentDomain()
    const created = dispatchTicket(domain)
    domain.endAssignment({ assignmentId: created.assignment.assignmentId, reason: 'completed' })

    const added = domain.addInput({
      ticketId: created.ticket.ticketId,
      requestId: 'msg-2',
      kind: 'text',
      human: true,
      text: '验收追问',
    })

    expect(added.delivered).toBe(false)
    expect(added.input.status).toBe('pending')
  })
})

function takeOverTwoTickets(service: SuperAgentService, repoRoot: string) {
  const first = service.dispatch(repoRoot, {
    requestId: 'req-1',
    title: '工单一',
    text: '目标一',
  })
  const second = service.dispatch(repoRoot, {
    requestId: 'req-2',
    title: '工单二',
    text: '目标二',
  })
  return { first, second }
}

describe('service workerTakeover / workerRelease（T09 #79）', () => {
  it('接管只切面板态：队列快照原样，不触发任何调度变化', () => {
    const service = createSuperAgentService()
    const { first } = takeOverTwoTickets(service, 'D:/repo')
    const before = service.queue('D:/repo')

    const state = service.workerTakeover('D:/repo', first.ticketId)

    expect(state.ticketId).toBe(first.ticketId)
    expect(service.queue('D:/repo')).toEqual(before)
  })

  it('同一 ticket 重复接管幂等；其他 ticket 冲突 takeoverConflict；不同项目互不影响', () => {
    const service = createSuperAgentService()
    const { first, second } = takeOverTwoTickets(service, 'D:/repo')
    const other = takeOverTwoTickets(service, 'D:/other').first

    service.workerTakeover('D:/repo', first.ticketId)
    const again = service.workerTakeover('D:/repo', first.ticketId)
    expect(again.ticketId).toBe(first.ticketId)

    expect(() => service.workerTakeover('D:/repo', second.ticketId)).toThrowError(
      expect.objectContaining({ code: 'takeoverConflict' }),
    )

    // 接管态按项目隔离：另一项目的面板不互抢
    expect(service.workerTakeover('D:/other', other.ticketId).ticketId).toBe(other.ticketId)
  })

  it('未知工单拒绝接管；接管镜像在 workerBind 快照里可见', () => {
    const service = createSuperAgentService()
    const { first } = takeOverTwoTickets(service, 'D:/repo')

    expect(() => service.workerTakeover('D:/repo', 'ticket-x')).toThrowError(
      expect.objectContaining({ code: 'ticketNotFound' }),
    )

    service.workerTakeover('D:/repo', first.ticketId)
    const mirror = service.workerBind('D:/repo', first.ticketId)
    expect(mirror.takenOver).toBe(true)
  })

  it('交还释放接管且幂等；接管/交还经 onTakeoverChanged 广播', () => {
    const onTakeoverChanged = vi.fn()
    const service = createSuperAgentService({ onTakeoverChanged })
    const { first } = takeOverTwoTickets(service, 'D:/repo')

    service.workerTakeover('D:/repo', first.ticketId)
    expect(onTakeoverChanged).toHaveBeenLastCalledWith('D:/repo', {
      repoRoot: 'D:/repo',
      takeover: { repoRoot: 'D:/repo', ticketId: first.ticketId, at: expect.any(String) },
    })

    expect(service.workerRelease('D:/repo', first.ticketId)).toBe(true)
    expect(onTakeoverChanged).toHaveBeenLastCalledWith('D:/repo', {
      repoRoot: 'D:/repo',
      takeover: null,
    })

    // 交还不残留接管态：重复交还、对未接管工单交还都成功
    expect(service.workerRelease('D:/repo', first.ticketId)).toBe(true)
    expect(service.workerBind('D:/repo', first.ticketId).takenOver).toBe(false)
  })

  it('关闭镜像标签一并释放接管，不残留面板态', () => {
    const service = createSuperAgentService()
    const { first } = takeOverTwoTickets(service, 'D:/repo')
    service.workerTakeover('D:/repo', first.ticketId)

    service.workerUnbind('D:/repo', first.ticketId)

    expect(service.workerBind('D:/repo', first.ticketId).takenOver).toBe(false)
  })
})

describe('service workerMessage（T09 #79）', () => {
  it('未接管时拒绝 workerMessage（takeoverRequired）', async () => {
    const service = createSuperAgentService()
    const { first } = takeOverTwoTickets(service, 'D:/repo')

    await expect(
      service.workerMessage('D:/repo', { requestId: 'msg-1', ticketId: first.ticketId, text: 'hi' }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'takeoverRequired' }))

    // 接管了别的工单也不行：多面板不互抢
    const both = takeOverTwoTickets(service, 'D:/repo2')
    service.workerTakeover('D:/repo2', both.second.ticketId)
    await expect(
      service.workerMessage('D:/repo2', {
        requestId: 'msg-1',
        ticketId: both.first.ticketId,
        text: 'hi',
      }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'takeoverRequired' }))
  })

  it('接管输入先落库再投递：requestId 幂等，重复提交返回原 Input', async () => {
    const deliverer = vi.fn().mockResolvedValue('accepted')
    const service = createSuperAgentService({ workerDeliverer: deliverer })
    const { first } = takeOverTwoTickets(service, 'D:/repo')
    service.workerTakeover('D:/repo', first.ticketId)

    const result = await service.workerMessage('D:/repo', {
      requestId: 'msg-1',
      ticketId: first.ticketId,
      text: '请改用另一个方案',
    })

    expect(result.duplicate).toBe(false)
    expect(result.delivered).toBe(true)
    expect(result.status).toBe('delivered')
    // 先落库再投递：deliverer 拿到的是已落库 Input 的 inputId / requestId / sessionId
    expect(deliverer).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: first.ticketId,
        inputId: result.inputId,
        requestId: 'msg-1',
        text: '请改用另一个方案',
      }),
    )

    // requestId 对账：重复提交不产生第二条 Input
    const again = await service.workerMessage('D:/repo', {
      requestId: 'msg-1',
      ticketId: first.ticketId,
      text: '请改用另一个方案',
    })
    expect(again.inputId).toBe(result.inputId)
    expect(again.duplicate).toBe(true)
  })

  it('投递结果未知时转 uncertain + Attention，且不盲目重投', async () => {
    const deliverer = vi.fn().mockResolvedValue('unknown')
    const service = createSuperAgentService({ workerDeliverer: deliverer })
    const { first } = takeOverTwoTickets(service, 'D:/repo')
    service.workerTakeover('D:/repo', first.ticketId)

    const result = await service.workerMessage('D:/repo', {
      requestId: 'msg-1',
      ticketId: first.ticketId,
      text: '请改用另一个方案',
    })

    expect(result.status).toBe('uncertain')
    expect(deliverer).toHaveBeenCalledTimes(1)

    // 同 requestId 重试：uncertain 期间禁止重投（对账依据：无法证明未接受）
    const retry = await service.workerMessage('D:/repo', {
      requestId: 'msg-1',
      ticketId: first.ticketId,
      text: '请改用另一个方案',
    })
    expect(retry.status).toBe('uncertain')
    expect(retry.duplicate).toBe(true)
    expect(deliverer).toHaveBeenCalledTimes(1)
  })

  it('可证明未接受才重投：notAccepted 退回 pending，重试再次投递成功', async () => {
    const deliverer = vi.fn().mockResolvedValueOnce('notAccepted').mockResolvedValueOnce('accepted')
    const service = createSuperAgentService({ workerDeliverer: deliverer })
    const { first } = takeOverTwoTickets(service, 'D:/repo')
    service.workerTakeover('D:/repo', first.ticketId)

    const first_ = await service.workerMessage('D:/repo', {
      requestId: 'msg-1',
      ticketId: first.ticketId,
      text: '请改用另一个方案',
    })
    expect(first_.status).toBe('pending')
    expect(first_.delivered).toBe(false)

    // requestId 对账：仍是 pending（可证明未接受）→ 允许重投
    const second_ = await service.workerMessage('D:/repo', {
      requestId: 'msg-1',
      ticketId: first.ticketId,
      text: '请改用另一个方案',
    })
    expect(second_.status).toBe('delivered')
    expect(second_.duplicate).toBe(true)
    expect(deliverer).toHaveBeenCalledTimes(2)
  })

  it('空文本拒绝：invalidWorkerMessage', async () => {
    const service = createSuperAgentService()
    const { first } = takeOverTwoTickets(service, 'D:/repo')
    service.workerTakeover('D:/repo', first.ticketId)

    await expect(
      service.workerMessage('D:/repo', { requestId: 'msg-1', ticketId: first.ticketId, text: '  ' }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'invalidWorkerMessage' }))
  })

  it('accepted 后同 requestId 重试不再投递（已接受有对账依据）', async () => {
    const deliverer = vi.fn().mockResolvedValue('accepted')
    const service = createSuperAgentService({ workerDeliverer: deliverer })
    const { first } = takeOverTwoTickets(service, 'D:/repo')
    service.workerTakeover('D:/repo', first.ticketId)

    await service.workerMessage('D:/repo', {
      requestId: 'msg-1',
      ticketId: first.ticketId,
      text: '请改用另一个方案',
    })
    const retry = await service.workerMessage('D:/repo', {
      requestId: 'msg-1',
      ticketId: first.ticketId,
      text: '请改用另一个方案',
    })

    expect(retry.status).toBe('delivered')
    expect(retry.duplicate).toBe(true)
    expect(deliverer).toHaveBeenCalledTimes(1)
  })
})

describe('errors 接线（T09 #79）', () => {
  it('takeoverRequired/takeoverConflict/invalidWorkerMessage 是稳定错误码且可序列化', async () => {
    const { serializeSuperAgentError, superAgentError } = await import('../errors')
    for (const code of ['takeoverRequired', 'takeoverConflict', 'invalidWorkerMessage'] as const) {
      const payload = serializeSuperAgentError(superAgentError(code))
      expect(payload.known).toBe(true)
      expect(payload.i18nKey).toBe(`superAgent.errors.${code}`)
    }
    expect(isSuperAgentDomainError(superAgentError('takeoverRequired'))).toBe(true)
  })
})
