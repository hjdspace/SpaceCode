// @vitest-environment node
/**
 * Worker 权限档 + 权限 Attention（T23 #94）。
 *
 * 覆盖验收：
 *  - Worker 一律以 bypassPermissions 起（不再逐次向人要权限）；
 *  - 引擎 permission_request 落成持久 Attention（带 sessionId/requestId 审计），
 *    同一请求幂等，等待期间释放调度槽位；
 *  - 回答先重新取得槽位再向原 request 应答（allow/deny），Worker 随后继续；
 *  - 请求被取消/工单停止时 Attention 撤回，不留下永久气泡。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentService } from '../service'
import { superAgentWorkerEngineSessionId } from '../sessionId'
import { createFakeBridge, reportFence } from './fakeBridge'

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function makeService(repoRoot: string) {
  const fake = createFakeBridge()
  const service = createSuperAgentService({ bridge: fake.bridge })
  return { service, fake, repoRoot }
}

describe('worker permission mode', () => {
  it('starts the worker in bypass permissions regardless of the policy', async () => {
    const { service, fake, repoRoot } = makeService('/repo/permission-serial')
    service.dispatch(repoRoot, { requestId: 'req-1', title: '修复登录', text: '让登录页可提交' })
    await flush()

    const workerSession = superAgentWorkerEngineSessionId(
      service.tickets(repoRoot).tickets[0]!.ticketId,
    )
    expect(fake.started.find((call) => call.sessionId === workerSession)?.config).toMatchObject({
      permissionMode: 'bypassPermissions',
    })
    expect(fake.pushed.find((call) => call.sessionId === workerSession)?.permissionMode).toBe(
      'bypassPermissions',
    )
  })
})

describe('permission attention', () => {
  it('turns a permission request into a persistent attention and releases the slot', async () => {
    const { service, fake, repoRoot } = makeService('/repo/permission-ask')
    const dispatched = service.dispatch(repoRoot, {
      requestId: 'req-1',
      title: '修复登录',
      text: '让登录页可提交',
    })
    await flush()
    const workerSession = superAgentWorkerEngineSessionId(dispatched.ticketId)

    fake.emit(workerSession, 'permission_request', {
      requestId: 'permission-1',
      toolName: 'Edit',
      description: '修改 src/a.ts',
    })
    fake.emit(workerSession, 'permission_request', {
      requestId: 'permission-1',
      toolName: 'Edit',
      description: '修改 src/a.ts',
    })
    await flush()

    const board = service.attentions(repoRoot)
    expect(board.attentions).toHaveLength(1)
    expect(board.attentions[0]).toMatchObject({
      ticketId: dispatched.ticketId,
      assignmentId: dispatched.assignmentId,
      kind: 'permission',
      status: 'open',
      sessionId: workerSession,
      requestId: 'permission-1',
      question: '权限请求：Edit（修改 src/a.ts）',
    })
    // 等权限期间不占逻辑槽位（进程现场仍由 Executor 持有）
    expect(service.queue(repoRoot).running).toHaveLength(0)
  })

  it('reacquires the slot before allowing the original request, then lets the worker continue', async () => {
    const { service, fake, repoRoot } = makeService('/repo/permission-allow')
    const dispatched = service.dispatch(repoRoot, {
      requestId: 'req-1',
      title: '修复登录',
      text: '让登录页可提交',
    })
    await flush()
    const workerSession = superAgentWorkerEngineSessionId(dispatched.ticketId)

    fake.emit(workerSession, 'permission_request', {
      requestId: 'permission-1',
      toolName: 'Edit',
      description: '修改 src/a.ts',
    })
    await flush()
    const attention = service.attentions(repoRoot).attentions[0]!

    const result = await service.attentionAnswer(repoRoot, {
      requestId: 'answer-1',
      attentionId: attention.attentionId,
      decision: 'allow',
    })

    expect(result).toMatchObject({
      attentionId: attention.attentionId,
      ticketId: dispatched.ticketId,
      inputId: null,
      delivered: true,
      gated: false,
      duplicate: false,
    })
    expect(fake.allowed).toEqual([{ sessionId: workerSession, requestId: 'permission-1' }])
    expect(service.attentions(repoRoot).attentions[0]?.status).toBe('answered')
    expect(service.queue(repoRoot).running.map((entry) => entry.ticketId)).toEqual([
      dispatched.ticketId,
    ])

    fake.emit(workerSession, 'result', {
      result: reportFence({
        assignmentId: dispatched.assignmentId,
        reportId: 'r1',
        kind: 'waiting',
        summary: '已继续',
      }),
    })
    await flush()
    expect(service.queue(repoRoot).running).toHaveLength(0)
  })

  it('denies the original request with the human reason', async () => {
    const { service, fake, repoRoot } = makeService('/repo/permission-deny')
    const dispatched = service.dispatch(repoRoot, {
      requestId: 'req-1',
      title: '清理临时文件',
      text: '清理临时文件',
    })
    await flush()
    const workerSession = superAgentWorkerEngineSessionId(dispatched.ticketId)

    fake.emit(workerSession, 'permission_request', {
      requestId: 'permission-1',
      toolName: 'Bash',
      description: '执行 rm -rf',
    })
    await flush()
    const attention = service.attentions(repoRoot).attentions[0]!

    const result = await service.attentionAnswer(repoRoot, {
      requestId: 'answer-1',
      attentionId: attention.attentionId,
      decision: 'deny',
      text: '这个目录不能删',
    })

    expect(result.inputId).toBeNull()
    expect(fake.denied).toEqual([
      {
        sessionId: workerSession,
        requestId: 'permission-1',
        message: '这个目录不能删',
        options: { interrupt: false },
      },
    ])
    expect(service.attentions(repoRoot).attentions[0]?.status).toBe('answered')
  })

  it('withdraws the attention when the engine cancels the request', async () => {
    const { service, fake, repoRoot } = makeService('/repo/permission-cancel')
    const dispatched = service.dispatch(repoRoot, {
      requestId: 'req-1',
      title: '修复登录',
      text: '让登录页可提交',
    })
    await flush()
    const workerSession = superAgentWorkerEngineSessionId(dispatched.ticketId)

    fake.emit(workerSession, 'permission_request', {
      requestId: 'permission-1',
      toolName: 'Edit',
      description: '修改 src/a.ts',
    })
    await flush()
    expect(service.attentions(repoRoot).attentions[0]?.status).toBe('open')

    fake.emit(workerSession, 'permission_request_cancelled', {
      requestId: 'permission-1',
      reason: 'aborted',
    })
    await flush()

    expect(service.attentions(repoRoot).attentions[0]?.status).toBe('withdrawn')
    expect(fake.allowed).toHaveLength(0)
    expect(fake.denied).toHaveLength(0)
    // 引擎侧裁决后 Worker 会继续跑：调度账重新占槽，不留下免费的并行度。
    expect(service.queue(repoRoot).running.map((entry) => entry.ticketId)).toEqual([
      dispatched.ticketId,
    ])

    fake.emit(workerSession, 'result', {
      result: reportFence({
        assignmentId: dispatched.assignmentId,
        reportId: 'r1',
        kind: 'waiting',
        summary: '已继续',
      }),
    })
    await flush()
    expect(service.queue(repoRoot).running).toHaveLength(0)
  })

  it('rejects a permission answer without a decision', async () => {
    const { service, fake, repoRoot } = makeService('/repo/permission-invalid')
    const dispatched = service.dispatch(repoRoot, {
      requestId: 'req-1',
      title: '修复登录',
      text: '让登录页可提交',
    })
    await flush()
    const workerSession = superAgentWorkerEngineSessionId(dispatched.ticketId)

    fake.emit(workerSession, 'permission_request', {
      requestId: 'permission-1',
      toolName: 'Edit',
      description: '修改 src/a.ts',
    })
    await flush()
    const attention = service.attentions(repoRoot).attentions[0]!

    await expect(
      service.attentionAnswer(repoRoot, {
        requestId: 'answer-1',
        attentionId: attention.attentionId,
        text: '随便写点什么',
      }),
    ).rejects.toThrow(/invalidAnswer/)
    expect(fake.allowed).toHaveLength(0)
    expect(fake.denied).toHaveLength(0)
  })
})
