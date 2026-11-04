// @vitest-environment node
/**
 * Super Agent IPC 注册面（T01 #71、T13 #83、T05 #75）：
 *  - wire channel 必须与 shared 定义的前缀/方法名一致（preload 派生同名）；
 *  - 从 ipcMain 注册的真实回调走 bind/state/health/dispatch/queue，重复 bind 幂等；
 *  - 缺 repoRoot 时拒绝执行，不做静默兜底；
 *  - 健康变化经 onHealthChanged 广播到所有窗口（health.changed 事件）；
 *  - 派工与队列（T05）：dispatch/queue 通道转发、非法派工命令拒绝、
 *    队列变化经 queue-changed 广播到所有窗口。
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
