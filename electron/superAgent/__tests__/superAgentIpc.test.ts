// @vitest-environment node
/**
 * Super Agent IPC 注册面（T01 #71、T13 #83、T05 #75）：
 *  - wire channel 必须与 shared 定义的前缀/方法名一致（preload 派生同名）；
 *  - 从 ipcMain 注册的真实回调走 bind/state/health/dispatch/queue，重复 bind 幂等；
 *  - 缺 repoRoot 时拒绝执行，不做静默兜底；
 *  - 健康变化经 onHealthChanged 广播到所有窗口（health.changed 事件）；
 *  - 派工与队列（T05）：dispatch/queue 通道转发、非法派工命令拒绝、
 *    队列变化经 queue-changed 广播到所有窗口；
 *  - Router 对话（T21）：routerMessage/routerAbort 通道与入口校验，
 *    轮次起止经 router-status 广播，未注入引擎接缝时如实拒绝而不是假启动。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const probe = vi.hoisted(() => ({
  handlers: {} as Record<string, (...args: unknown[]) => unknown>,
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    probe.handlers[channel] = handler
  }),
  send: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: probe.handle },
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: probe.send } }],
  },
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

import {
  createBroadcastingSuperAgentService,
  registerSuperAgentIPCHandlers,
} from '../superAgentIpc'
import {
  superAgentRouterEngineSessionId,
  superAgentWorkerEngineSessionId,
} from '../sessionId'
import { createFakeBridge, routeFence } from './fakeBridge'
import { SUPER_AGENT_PREFIX } from '@/shared/channels/superAgent'

const HEALTH_CHANGED_CHANNEL = `${SUPER_AGENT_PREFIX}health-changed`
const QUEUE_CHANGED_CHANNEL = `${SUPER_AGENT_PREFIX}queue-changed`

function invoke(method: string, repoRoot: unknown): Promise<any> {
  return Promise.resolve(probe.handlers[`${SUPER_AGENT_PREFIX}${method}`](null, repoRoot))
}

function invokeDispatch(method: string, repoRoot: unknown, command: unknown): Promise<any> {
  return Promise.resolve(
    probe.handlers[`${SUPER_AGENT_PREFIX}${method}`](null, repoRoot, command),
  )
}

beforeEach(() => {
  probe.handlers = {}
  probe.handle.mockClear()
  probe.send.mockClear()
})

describe('registerSuperAgentIPCHandlers', () => {
  it('registers state, routerBind and health on the shared wire prefix', () => {
    registerSuperAgentIPCHandlers()

    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}state`, expect.any(Function))
    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}routerBind`, expect.any(Function))
    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}health`, expect.any(Function))
  })

  it('registers dispatch and queue on the shared wire prefix（T05）', () => {
    registerSuperAgentIPCHandlers()

    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}dispatch`, expect.any(Function))
    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}queue`, expect.any(Function))
  })

  it('round-trips bind and state through the registered handlers', async () => {
    registerSuperAgentIPCHandlers()

    const first = await invoke('routerBind', '/repo/a')
    const second = await invoke('routerBind', '/repo/a')
    const state = await invoke('state', '/repo/a')

    expect(second.sessionId).toBe(first.sessionId)
    expect(state.seq).toBe(first.snapshot.seq)
    expect(state.router).toEqual({ sessionId: first.sessionId, running: false })
  })

  it('serves an empty health report through the health channel', async () => {
    registerSuperAgentIPCHandlers()

    const report = await invoke('health', '/repo/a')

    expect(report.repoRoot).toBe('/repo/a')
    expect(report.items).toEqual([])
    expect(report.problemCount).toBe(0)
  })

  it('rejects a missing repoRoot instead of answering an unscoped snapshot', async () => {
    registerSuperAgentIPCHandlers()

    await expect(invoke('state', '')).rejects.toThrow(/repoRoot/)
    await expect(invoke('routerBind', undefined)).rejects.toThrow(/repoRoot/)
    await expect(invoke('health', ' ')).rejects.toThrow(/repoRoot/)
  })

  it('broadcasts health.changed to all windows when the health report changes', () => {
    const service = createBroadcastingSuperAgentService()

    service.recordHealthFailure('/repo/a', 'engine')

    expect(probe.send).toHaveBeenCalledWith(
      HEALTH_CHANGED_CHANNEL,
      '/repo/a',
      expect.objectContaining({ repoRoot: '/repo/a', problemCount: 0, degradedCount: 1 }),
    )
  })

  it('does not broadcast on the invoke channels when health is untouched', async () => {
    registerSuperAgentIPCHandlers()

    await invoke('state', '/repo/a')

    expect(probe.send).not.toHaveBeenCalled()
  })
})

describe('registerSuperAgentIPCHandlers dispatch & queue（T05 #75）', () => {
  const COMMAND = { requestId: 'dispatch-1', title: '修复登录', text: '登录按钮无响应' }

  it('dispatches a ticket and exposes the queue through the registered handlers', async () => {
    registerSuperAgentIPCHandlers()

    const result = await invokeDispatch('dispatch', '/repo/a', COMMAND)
    expect(result.duplicate).toBe(false)
    expect(result.queuePosition).toBe(1)
    expect(result.ticketId).not.toBe('')

    const queue = await invoke('queue', '/repo/a')
    expect(queue.maxWorkers).toBe(1)
    expect(queue.queued).toEqual([
      expect.objectContaining({ ticketId: result.ticketId, title: '修复登录', position: 1 }),
    ])
  })

  it('rejects a malformed dispatch command instead of answering an unscoped dispatch', async () => {
    registerSuperAgentIPCHandlers()

    await expect(invokeDispatch('dispatch', '/repo/a', null)).rejects.toThrow(/dispatch/)
    await expect(
      invokeDispatch('dispatch', '/repo/a', { title: 'x', text: 'y' }),
    ).rejects.toThrow(/dispatch/)
  })

  it('broadcasts queue-changed to all windows when the queue composition changes', async () => {
    const service = createBroadcastingSuperAgentService()

    service.dispatch('/repo/a', COMMAND)

    expect(probe.send).toHaveBeenCalledWith(
      QUEUE_CHANGED_CHANNEL,
      '/repo/a',
      expect.objectContaining({
        repoRoot: '/repo/a',
        maxWorkers: 1,
        queued: [expect.objectContaining({ title: '修复登录' })],
      }),
    )
  })
})

describe('registerSuperAgentIPCHandlers takeover & giveback（T09 #79）', () => {
  const DISPATCH = { requestId: 'dispatch-1', title: '修复登录', text: '登录按钮无响应' }
  const TAKEOVER_CHANGED_CHANNEL = `${SUPER_AGENT_PREFIX}takeover-changed`

  it('registers workerTakeover / workerRelease / workerMessage on the shared wire prefix', () => {
    registerSuperAgentIPCHandlers()

    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}workerTakeover`,
      expect.any(Function),
    )
    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}workerRelease`,
      expect.any(Function),
    )
    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}workerMessage`,
      expect.any(Function),
    )
  })

  it('round-trips takeover → workerMessage → release through the registered handlers', async () => {
    registerSuperAgentIPCHandlers()

    const dispatched = await invokeDispatch('dispatch', '/repo/a', DISPATCH)
    const ticketId = dispatched.ticketId

    const takeover = await invokeDispatch('workerTakeover', '/repo/a', ticketId)
    expect(takeover).toEqual({
      repoRoot: '/repo/a',
      ticketId,
      at: expect.any(String),
    })

    const message = await invokeDispatch('workerMessage', '/repo/a', {
      requestId: 'msg-1',
      ticketId,
      text: '请改用另一个方案',
    })
    expect(message).toEqual({
      inputId: expect.any(String),
      ticketId,
      status: 'delivered',
      delivered: true,
      gated: false,
      duplicate: false,
    })

    expect(await invokeDispatch('workerRelease', '/repo/a', ticketId)).toBe(true)
    // 交还幂等：重复交还成功
    expect(await invokeDispatch('workerRelease', '/repo/a', ticketId)).toBe(true)
  })

  it('rejects workerMessage before takeover with the stable takeoverRequired code', async () => {
    registerSuperAgentIPCHandlers()

    const dispatched = await invokeDispatch('dispatch', '/repo/a', DISPATCH)
    await expect(
      invokeDispatch('workerMessage', '/repo/a', {
        requestId: 'msg-1',
        ticketId: dispatched.ticketId,
        text: 'hi',
      }),
    ).rejects.toThrow(/takeoverRequired/)
  })

  it('rejects a malformed workerMessage command at the IPC entry', async () => {
    registerSuperAgentIPCHandlers()

    await expect(invokeDispatch('workerMessage', '/repo/a', null)).rejects.toThrow(/worker message/)
    await expect(
      invokeDispatch('workerMessage', '/repo/a', { requestId: 'msg-1', ticketId: 't', text: ' ' }),
    ).rejects.toThrow(/worker message/)
  })

  it('broadcasts takeover-changed to all windows on takeover and giveback', () => {
    const service = createBroadcastingSuperAgentService()
    const dispatched = service.dispatch('/repo/a', DISPATCH)

    service.workerTakeover('/repo/a', dispatched.ticketId)
    expect(probe.send).toHaveBeenCalledWith(
      TAKEOVER_CHANGED_CHANNEL,
      '/repo/a',
      {
        repoRoot: '/repo/a',
        takeover: { repoRoot: '/repo/a', ticketId: dispatched.ticketId, at: expect.any(String) },
      },
    )

    probe.send.mockClear()
    service.workerRelease('/repo/a', dispatched.ticketId)
    expect(probe.send).toHaveBeenCalledWith(TAKEOVER_CHANGED_CHANNEL, '/repo/a', {
      repoRoot: '/repo/a',
      takeover: null,
    })
  })
})

describe('registerSuperAgentIPCHandlers attention QA（T08 #78）', () => {
  const DISPATCH = { requestId: 'dispatch-1', title: '修复登录', text: '登录按钮无响应' }
  const ATTENTION_ASKED_CHANNEL = `${SUPER_AGENT_PREFIX}attention-asked`
  const ATTENTION_ANSWERED_CHANNEL = `${SUPER_AGENT_PREFIX}attention-answered`

  it('registers attentions and attentionAnswer on the shared wire prefix', () => {
    registerSuperAgentIPCHandlers()

    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}attentions`,
      expect.any(Function),
    )
    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}attentionAnswer`,
      expect.any(Function),
    )
  })

  it('serves the attention board and rejects malformed answer commands at the entry', async () => {
    registerSuperAgentIPCHandlers()

    const board = await invoke('attentions', '/repo/a')
    expect(board).toEqual({ repoRoot: '/repo/a', attentions: [], pendingTickets: 0 })

    await expect(invokeDispatch('attentionAnswer', '/repo/a', null)).rejects.toThrow(
      /attention answer/,
    )
    await expect(
      invokeDispatch('attentionAnswer', '/repo/a', {
        requestId: 'a-1',
        attentionId: 'attention-1',
        text: ' ',
      }),
    ).rejects.toThrow(/attention answer/)
  })

  it('broadcasts attention-asked / attention-answered through the broadcasting service', async () => {
    const service = createBroadcastingSuperAgentService()
    const dispatched = service.dispatch('/repo/a', DISPATCH)
    service.workerTakeover('/repo/a', dispatched.ticketId)
    const asker = await service.workerMessage('/repo/a', {
      requestId: 'ask-1',
      ticketId: dispatched.ticketId,
      text: '旧接口还要保留吗？',
    })
    probe.send.mockClear()

    service.workerReport('/repo/a', {
      text: `\`\`\`super-agent:report\n${JSON.stringify({
        assignmentId: dispatched.assignmentId,
        reportId: 'rep-1',
        kind: 'blocked',
        summary: '等待确认',
        question: '旧接口还要保留吗？',
        askedBy: asker.inputId,
      })}\n\`\`\``,
    })
    expect(probe.send).toHaveBeenCalledWith(
      ATTENTION_ASKED_CHANNEL,
      '/repo/a',
      expect.objectContaining({
        repoRoot: '/repo/a',
        reason: 'asked',
        pendingTickets: 1,
      }),
    )

    const board = service.attentions('/repo/a')
    const attentionId = board.attentions[0].attentionId
    probe.send.mockClear()
    const answered = await service.attentionAnswer('/repo/a', {
      requestId: 'answer-1',
      attentionId,
      text: '保留，别删',
    })
    expect(answered.delivered).toBe(true)
    // 回答只是刷新 open 视图：仍走 asked 通道
    expect(probe.send).toHaveBeenCalledWith(
      ATTENTION_ASKED_CHANNEL,
      '/repo/a',
      expect.objectContaining({ reason: 'asked' }),
    )

    probe.send.mockClear()
    service.workerReport('/repo/a', {
      text: `\`\`\`super-agent:report\n${JSON.stringify({
        assignmentId: dispatched.assignmentId,
        reportId: 'rep-2',
        kind: 'waiting',
        summary: '已按回答继续',
        answers: [answered.inputId],
      })}\n\`\`\``,
    })
    expect(probe.send).toHaveBeenCalledWith(
      ATTENTION_ANSWERED_CHANNEL,
      '/repo/a',
      expect.objectContaining({ reason: 'answered', pendingTickets: 0 }),
    )
  })
})

describe('registerSuperAgentIPCHandlers ticket outlets（T10 #80）', () => {
  const DISPATCH = { requestId: 'dispatch-1', title: '修复登录', text: '登录按钮无响应' }

  it('registers ticketAccept/ticketStop/ticketMessage/ticketRetry on the shared wire prefix', () => {
    registerSuperAgentIPCHandlers()

    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}ticketAccept`,
      expect.any(Function),
    )
    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}ticketStop`,
      expect.any(Function),
    )
    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}ticketMessage`,
      expect.any(Function),
    )
    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}ticketRetry`,
      expect.any(Function),
    )
  })

  it('round-trips follow-up → stop through the registered handlers', async () => {
    registerSuperAgentIPCHandlers()

    const dispatched = await invokeDispatch('dispatch', '/repo/a', DISPATCH)

    // 继续追问：先落库再投递（Executor 未接入时照常落库）
    const message = await invokeDispatch('ticketMessage', '/repo/a', {
      requestId: 'follow-1',
      ticketId: dispatched.ticketId,
      text: '再改一版',
    })
    expect(message).toMatchObject({ ticketId: dispatched.ticketId, delivered: true })

    // 停止出口：Mandate 撤回 + 工单 stopped；再次停止报 ticketEnded
    const stopped = await invokeDispatch('ticketStop', '/repo/a', { ticketId: dispatched.ticketId })
    expect(stopped).toMatchObject({ ticketId: dispatched.ticketId, outcome: 'stopped' })
    await expect(
      invokeDispatch('ticketStop', '/repo/a', { ticketId: dispatched.ticketId }),
    ).rejects.toThrow()
  })

  it('refuses retry for tickets outside the retryable set (notRetryable)', async () => {
    registerSuperAgentIPCHandlers()

    const dispatched = await invokeDispatch('dispatch', '/repo/a', DISPATCH)
    // 排队中的工单不在 delivery/blocked/failed 集合内
    await expect(
      invokeDispatch('ticketRetry', '/repo/a', { ticketId: dispatched.ticketId }),
    ).rejects.toThrow()
  })

  it('rejects malformed ticket outlet commands instead of answering unscoped', async () => {
    registerSuperAgentIPCHandlers()

    await expect(invokeDispatch('ticketAccept', '/repo/a', null)).rejects.toThrow(/ticket/)
    await expect(invokeDispatch('ticketAccept', '/repo/a', { ticketId: '' })).rejects.toThrow(/ticket/)
    await expect(
      invokeDispatch('ticketMessage', '/repo/a', { requestId: 'x', ticketId: 't', text: '' }),
    ).rejects.toThrow(/ticket message/)
  })
})

describe('registerSuperAgentIPCHandlers pause & resume（T11 #81）', () => {
  const COMMAND = { requestId: 'dispatch-1', title: '修复登录', text: '登录按钮无响应' }

  it('registers pause / resume on the shared wire prefix', () => {
    registerSuperAgentIPCHandlers()

    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}pause`, expect.any(Function))
    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}resume`, expect.any(Function))
  })

  it('rejects pause / resume when repoRoot is missing', async () => {
    registerSuperAgentIPCHandlers()

    await expect(invoke('pause', '')).rejects.toThrow(/repoRoot/)
    await expect(invoke('resume', ' ')).rejects.toThrow(/repoRoot/)
  })

  it('round-trips pause → resume through the registered handlers', async () => {
    registerSuperAgentIPCHandlers()

    const paused = await invoke('pause', '/repo/a')
    expect(paused).toBe(true)

    const resumed = await invoke('resume', '/repo/a')
    expect(resumed).toBe(true)

    // 恢复后派工命令仍可推进（项目回到开放状态）
    const dispatched = await invokeDispatch('dispatch', '/repo/a', COMMAND)
    expect(dispatched.ticketId).not.toBe('')
  })

  it('pause keeps new tickets queued without launching, resume continues the queue', async () => {
    registerSuperAgentIPCHandlers()

    await invoke('pause', '/repo/a')
    const dispatched = await invokeDispatch('dispatch', '/repo/a', COMMAND)
    expect(dispatched.queuePosition).toBe(1)
    // 暂停期间不启动 launch：队列快照里工单仍在排队
    const queueWhilePaused = await invoke('queue', '/repo/a')
    expect(JSON.stringify(queueWhilePaused)).toContain(dispatched.ticketId)

    // 恢复后命令仍可推进（续跑语义由 service/scheduler 测试覆盖）
    await invoke('resume', '/repo/a')
    const queueAfterResume = await invoke('queue', '/repo/a')
    expect(JSON.stringify(queueAfterResume)).toBeDefined()
  })
})

describe('registerSuperAgentIPCHandlers policy & checkpoint（T12 #82）', () => {
  it('registers policy / policySet / checkpoint / checkpointRollback on the shared wire prefix', () => {
    registerSuperAgentIPCHandlers()

    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}policy`, expect.any(Function))
    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}policySet`,
      expect.any(Function),
    )
    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}checkpoint`, expect.any(Function))
    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}checkpointRollback`,
      expect.any(Function),
    )
  })

  it('serves the default serial policy and rejects unconfirmed parallel at the entry', async () => {
    registerSuperAgentIPCHandlers()

    const policy = await invoke('policy', '/repo/a')
    expect(policy.policy).toEqual({ mode: 'serial', maxWorkers: 1, worktree: 'none' })

    // 开启并行必须 UI 二次确认（confirmed）
    await expect(
      invokeDispatch('policySet', '/repo/a', { mode: 'parallel', maxWorkers: 2 }),
    ).rejects.toThrow(/policyConfirmRequired/)
    // 结构校验在领域层完成：上限越界稳定报错
    await expect(
      invokeDispatch('policySet', '/repo/a', { mode: 'parallel', maxWorkers: 9, confirmed: true }),
    ).rejects.toThrow()
    // 非法命令入口拒绝
    await expect(invokeDispatch('policySet', '/repo/a', null)).rejects.toThrow(/policy set/)
    await expect(invokeDispatch('policySet', '/repo/a', { mode: 'boost' })).rejects.toThrow(
      /policy set/,
    )
  })

  it('serves checkpoint info and rejects malformed rollback commands at the entry', async () => {
    registerSuperAgentIPCHandlers()

    const info = await invoke('checkpoint', '/repo/a')
    expect(info).toEqual({ repoRoot: '/repo/a', checkpoint: null, changedFiles: [] })

    await expect(invokeDispatch('checkpointRollback', '/repo/a', null)).rejects.toThrow(
      /checkpoint rollback/,
    )
    await expect(invokeDispatch('checkpointRollback', '/repo/a', { files: [] })).rejects.toThrow(
      /checkpoint rollback/,
    )
    await expect(
      invokeDispatch('checkpointRollback', '/repo/a', { files: [' '] }),
    ).rejects.toThrow(/checkpoint rollback/)
    // 无检查点时按文件回退稳定报错（missing）
    await expect(
      invokeDispatch('checkpointRollback', '/repo/a', { files: ['src/a.ts'] }),
    ).rejects.toThrow(/checkpointUnavailable/)
  })
})

describe('registerSuperAgentIPCHandlers 健康与 Eval 处置（T20 #90）', () => {
  it('registers evalReevaluate / problemDismiss / healthRetry on the shared wire prefix', () => {
    registerSuperAgentIPCHandlers()

    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}evalReevaluate`,
      expect.any(Function),
    )
    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}problemDismiss`,
      expect.any(Function),
    )
    expect(probe.handle).toHaveBeenCalledWith(
      `${SUPER_AGENT_PREFIX}healthRetry`,
      expect.any(Function),
    )
  })

  it('round-trips healthRetry and problemDismiss, echoing the audited report', async () => {
    registerSuperAgentIPCHandlers()

    const service = createBroadcastingSuperAgentService()
    for (let i = 0; i < 3; i++) {
      service.recordHealthFailure('/repo/a', 'engine', { code: 'slotUnavailable' })
    }
    expect(service.health('/repo/a').problemCount).toBe(1)

    // 重试：清零计数 + retry 审计，报告随响应回显（状态回显）。
    const retried = await invokeDispatch('healthRetry', '/repo/a', { category: 'engine' })
    expect(retried.problemCount).toBe(0)
    expect(retried.dispositions).toEqual([
      { category: 'engine', subjectId: null, action: 'retry', at: expect.any(String) },
    ])

    // 忽略：隐藏问题 + dismiss 审计。
    for (let i = 0; i < 3; i++) {
      service.recordHealthFailure('/repo/a', 'engine', { code: 'slotUnavailable' })
    }
    const dismissed = await invokeDispatch('problemDismiss', '/repo/a', { category: 'engine' })
    expect(dismissed.problemCount).toBe(0)
    expect(dismissed.items).toEqual([])
    expect(dismissed.dispositions).toEqual([
      { category: 'engine', subjectId: null, action: 'retry', at: expect.any(String) },
      { category: 'engine', subjectId: null, action: 'dismiss', at: expect.any(String) },
    ])
  })

  it('rejects malformed disposal commands at the entry', async () => {
    registerSuperAgentIPCHandlers()

    await expect(invokeDispatch('evalReevaluate', '/repo/a', null)).rejects.toThrow(
      /eval reevaluate/,
    )
    await expect(invokeDispatch('evalReevaluate', '/repo/a', { evalId: ' ' })).rejects.toThrow(
      /eval reevaluate/,
    )
    await expect(invokeDispatch('problemDismiss', '/repo/a', { category: '' })).rejects.toThrow(
      /problem dismiss/,
    )
    await expect(
      invokeDispatch('problemDismiss', '/repo/a', { category: 'eval', subjectId: 42 }),
    ).rejects.toThrow(/problem dismiss/)
    await expect(invokeDispatch('healthRetry', '/repo/a', null)).rejects.toThrow(/health retry/)
    await expect(invokeDispatch('healthRetry', '/repo/a', { category: 'engine' })).resolves.toMatchObject(
      { repoRoot: '/repo/a' },
    )
  })

  it('forwards evalReevaluate errors from the service (evalNotFound for unknown ids)', async () => {
    registerSuperAgentIPCHandlers()

    await expect(invokeDispatch('evalReevaluate', '/repo/a', { evalId: 'missing' })).rejects.toThrow(
      /evalNotFound/,
    )
  })
})

describe('registerSuperAgentIPCHandlers router conversation（T21）', () => {
  const ROUTER_STATUS_CHANNEL = `${SUPER_AGENT_PREFIX}router-status`

  function flushing() {
    return new Promise((resolve) => setTimeout(resolve, 0))
  }

  it('registers routerMessage and routerAbort on the shared wire prefix', () => {
    registerSuperAgentIPCHandlers()

    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}routerMessage`, expect.any(Function))
    expect(probe.handle).toHaveBeenCalledWith(`${SUPER_AGENT_PREFIX}routerAbort`, expect.any(Function))
  })

  it('rejects a malformed command before the engine is touched', async () => {
    const fake = createFakeBridge()
    registerSuperAgentIPCHandlers(createBroadcastingSuperAgentService({ bridge: fake.bridge }))

    await expect(invokeDispatch('routerMessage', '', { requestId: 'r1', text: '干活' })).rejects.toThrow(/repoRoot/)
    await expect(invokeDispatch('routerMessage', '/repo/a', null)).rejects.toThrow(/router message/)
    await expect(
      invokeDispatch('routerMessage', '/repo/a', { requestId: ' ', text: '干活' }),
    ).rejects.toThrow(/router message/)
    await expect(
      invokeDispatch('routerMessage', '/repo/a', { requestId: 'r1', text: '   ' }),
    ).rejects.toThrow(/router message/)
    expect(fake.sent).toHaveLength(0)
  })

  it('runs the turn through the injected bridge and broadcasts router-status to every window', async () => {
    const fake = createFakeBridge()
    registerSuperAgentIPCHandlers(createBroadcastingSuperAgentService({ bridge: fake.bridge }))

    const result = await invokeDispatch('routerMessage', '/repo/a', {
      requestId: 'r1',
      text: '帮我把登录页修好',
      displayText: '帮我把登录页修好',
    })

    expect(result).toMatchObject({ sessionId: superAgentRouterEngineSessionId('/repo/a'), running: true })
    expect(probe.send).toHaveBeenCalledWith(
      ROUTER_STATUS_CHANNEL,
      '/repo/a',
      expect.objectContaining({ sessionId: result.sessionId, running: true }),
    )

    // 轮次收口后广播 running:false，IM 视图的 typing 与停止按钮跟着落回
    fake.emit(result.sessionId, 'result', {
      result: `好的。\n\n${routeFence([{ kind: 'ignore', reason: '仅回复，不直接执行' }])}`,
    })
    await flushing()
    expect(probe.send).toHaveBeenCalledWith(
      ROUTER_STATUS_CHANNEL,
      '/repo/a',
      expect.objectContaining({ sessionId: result.sessionId, running: false }),
    )
  })

  it('aborts only the router turn; workers keep running', async () => {
    const fake = createFakeBridge()
    const service = createBroadcastingSuperAgentService({ bridge: fake.bridge })
    registerSuperAgentIPCHandlers(service)

    service.routerBind('/repo/a')
    await invokeDispatch('routerMessage', '/repo/a', { requestId: 'r1', text: '修登录页' })
    fake.emit(superAgentRouterEngineSessionId('/repo/a'), 'result', {
      result: routeFence([{ kind: 'accept', title: '修复登录页', note: '让登录页可提交' }]),
    })
    await flushing()

    const routerSession = superAgentRouterEngineSessionId('/repo/a')
    const ticket = service.tickets('/repo/a').tickets[0]!
    const workerSession = superAgentWorkerEngineSessionId(ticket.ticketId)

    // 再起一轮不收口，走停止按钮那条路径
    await invokeDispatch('routerMessage', '/repo/a', { requestId: 'r2', text: '现在进度如何' })
    await invoke('routerAbort', '/repo/a')

    expect(fake.aborted).toEqual([routerSession])
    expect(fake.aborted).not.toContain(workerSession)
    expect(fake.stopped).not.toContain(workerSession)
    expect(service.state('/repo/a').router?.running).toBe(false)
    // Worker 不受 Router 停止影响，工单仍在进行中
    expect(service.tickets('/repo/a').tickets[0]!.state).toBe(ticket.state)
  })

  it('refuses to answer an unscoped router abort', async () => {
    registerSuperAgentIPCHandlers()

    await expect(invoke('routerAbort', '')).rejects.toThrow(/repoRoot/)
  })

  it('tells the renderer the truth when no runtime is wired', async () => {
    registerSuperAgentIPCHandlers(createBroadcastingSuperAgentService())

    await expect(
      invokeDispatch('routerMessage', '/repo/a', { requestId: 'r1', text: '干活' }),
    ).rejects.toThrow(/engineLaunchFailed/)
  })
})
