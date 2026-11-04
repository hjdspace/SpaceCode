// @vitest-environment node
/**
 * service 层 T06 契约（#76）：
 *  - workerReport：严格解析 → 领域迁移 → 投影；伪造 assignmentId 稳定拒绝；
 *    重复 reportId 幂等确认；Report 更新现有卡片（列表不重复）；
 *  - tickets：全量看板 + seq 水位；
 *  - onTicketUpdated/onTicketProgress 事件链路（含 preparing 子态）。
 */
import { describe, expect, it, vi } from 'vitest'
import type {
  SuperAgentTicketProgress,
  SuperAgentTicketUpdateEvent,
} from '@/shared/channels/superAgent'
import { isSuperAgentDomainError } from '../errors'
import { createSuperAgentService } from '../service'
import { SUPER_AGENT_REPORT_FENCE } from '../reportParser'
import type { WorkerLauncher } from '../scheduler'

const REPO = 'D:/repo'

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

function reportText(assignmentId: string, reportId: string, extra: Record<string, unknown> = {}): string {
  return `\`\`\`${SUPER_AGENT_REPORT_FENCE}\n${JSON.stringify({
    assignmentId,
    reportId,
    kind: 'progress',
    summary: '推进中',
    ...extra,
  })}\n\`\`\``
}

interface Ctx {
  updates: Array<[string, SuperAgentTicketUpdateEvent]>
  progress: Array<[string, SuperAgentTicketProgress]>
}

function makeService(ctx: Ctx, launcher: WorkerLauncher | null = null) {
  return createSuperAgentService({
    launcher,
    onTicketUpdated: (repoRoot, event) => ctx.updates.push([repoRoot, event]),
    onTicketProgress: (repoRoot, payload) => ctx.progress.push([repoRoot, payload]),
  })
}

function dispatch(service: ReturnType<typeof makeService>) {
  return service.dispatch(REPO, {
    requestId: nextId('req'),
    title: '修复登录',
    text: '登录按钮无响应',
    actor: 'tester',
  })
}

describe('tickets 看板', () => {
  it('returns an empty board before any dispatch', () => {
    const ctx: Ctx = { updates: [], progress: [] }
    const service = makeService(ctx)
    const board = service.tickets(REPO)
    expect(board.seq).toBe(0)
    expect(board.tickets).toEqual([])
  })

  it('returns the card with domain seq watermark after dispatch', () => {
    const ctx: Ctx = { updates: [], progress: [] }
    const service = makeService(ctx)
    const { ticketId, assignmentId } = dispatch(service)

    const board = service.tickets(REPO)
    expect(board.tickets).toHaveLength(1)
    expect(board.tickets[0]).toMatchObject({
      ticketId,
      assignmentId,
      state: 'queued',
      generation: 1,
    })
    expect(board.seq).toBeGreaterThan(0)
    // dispatch 即时投影，事件只发一次
    expect(ctx.updates).toHaveLength(1)
    expect(ctx.updates[0][0]).toBe(REPO)
  })
})

describe('workerReport 严格接缝', () => {
  it('applies a valid report and updates the existing card in place', () => {
    const ctx: Ctx = { updates: [], progress: [] }
    const service = makeService(ctx)
    const { ticketId, assignmentId } = dispatch(service)
    ctx.updates.length = 0

    const result = service.workerReport(REPO, {
      text: reportText(assignmentId, nextId('rep'), {
        currentTool: 'Edit',
        toolCalls: 2,
        elapsedMs: 800,
      }),
    })

    expect(result).toMatchObject({ ticketId, kind: 'progress', summary: '推进中', duplicate: false })
    const board = service.tickets(REPO)
    expect(board.tickets).toHaveLength(1)
    expect(board.tickets[0].state).toBe('queued')
    // 卡片身份不变：仍是一张卡，只是状态原位更新
    expect(board.tickets[0].ticketId).toBe(ticketId)
    // progress Report 的轻量事实进入节流投影
    expect(ctx.progress.map(([, p]) => p.currentTool)).toEqual(['Edit'])
  })

  it('rejects forged assignmentId with a stable code (assignmentNotFound)', () => {
    const ctx: Ctx = { updates: [], progress: [] }
    const service = makeService(ctx)
    try {
      service.workerReport(REPO, { text: reportText('assignment-forged', nextId('rep')) })
      throw new Error('should have thrown')
    } catch (err) {
      expect(isSuperAgentDomainError(err)).toBe(true)
      if (isSuperAgentDomainError(err)) expect(err.code).toBe('assignmentNotFound')
    }
  })

  it('rejects misaligned report for an ended assignment (assignmentEnded)', async () => {
    const ctx: Ctx = { updates: [], progress: [] }
    const launcher: WorkerLauncher = {
      launch: () => Promise.reject(new Error('engine down')),
    }
    const service = makeService(ctx, launcher)
    const { assignmentId } = dispatch(service)
    // launch 失败 → assignment 以 failed 收尾（ended），工单未结束
    await vi.waitFor(() => {
      if (service.tickets(REPO).tickets[0].state !== 'idle') throw new Error('not idle yet')
    })

    try {
      // 旧代迟到 Report：assignment 已结束，稳定拒绝且不新增卡片状态
      service.workerReport(REPO, { text: reportText(assignmentId, nextId('rep-late')) })
      throw new Error('should have thrown')
    } catch (err) {
      expect(isSuperAgentDomainError(err)).toBe(true)
      if (isSuperAgentDomainError(err)) expect(err.code).toBe('assignmentEnded')
    }
    expect(service.tickets(REPO).tickets[0].state).toBe('idle')
  })

  it('confirms duplicates idempotently without a new card', () => {
    const ctx: Ctx = { updates: [], progress: [] }
    const service = makeService(ctx)
    const { ticketId, assignmentId } = dispatch(service)
    const reportId = nextId('rep')
    const text = reportText(assignmentId, reportId)

    const first = service.workerReport(REPO, { text })
    const second = service.workerReport(REPO, { text })

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.reportId).toBe(reportId)
    expect(service.tickets(REPO).tickets).toHaveLength(1)
    expect(service.tickets(REPO).tickets[0].ticketId).toBe(ticketId)
  })

  it('propagates parser protocol failures as stable codes', () => {
    const ctx: Ctx = { updates: [], progress: [] }
    const service = makeService(ctx)
    const { assignmentId } = dispatch(service)

    const cases: Array<[string, string]> = [
      ['没有报告块的普通消息', 'reportMissing'],
      [`\`\`\`${SUPER_AGENT_REPORT_FENCE}\n{}\n\`\`\`\n\`\`\`${SUPER_AGENT_REPORT_FENCE}\n{}\n\`\`\``, 'reportNotUnique'],
      [`\`\`\`${SUPER_AGENT_REPORT_FENCE}\n{oops}\n\`\`\``, 'reportUnparsable'],
      [`\`\`\`${SUPER_AGENT_REPORT_FENCE}\n[]\n\`\`\``, 'reportInvalid'],
    ]
    for (const [text, code] of cases) {
      try {
        service.workerReport(REPO, { text })
        throw new Error(`expected ${code}`)
      } catch (err) {
        expect(isSuperAgentDomainError(err)).toBe(true)
        if (isSuperAgentDomainError(err)) expect(err.code).toBe(code)
      }
    }
    expect(assignmentId).toBeTruthy()
  })
})

describe('preparing 子态与 launcher 生命周期', () => {
  it('flips the card to preparing while the slot is reserved before launch', async () => {
    const ctx: Ctx = { updates: [], progress: [] }
    // 用对象持有 resolve，避免 TS 对闭包内赋值的窄化
    const release = { resume: null as null | (() => void) }
    const launcher: WorkerLauncher = {
      launch: () =>
        new Promise<void>((resolve) => {
          release.resume = resolve
        }),
    }
    const service = makeService(ctx, launcher)
    const { ticketId } = dispatch(service)

    // 占槽是同步的：dispatch 返回时卡片应已投影为 preparing
    expect(ctx.updates).toHaveLength(1)
    expect(ctx.updates[0][1].tickets[0].state).toBe('preparing')
    expect(service.tickets(REPO).tickets[0]).toMatchObject({ ticketId, state: 'preparing' })

    await vi.waitFor(() => {
      // launch 回报 assignmentStarted 后回到领域阶段（无 Report 时为 working）
      const card = service.tickets(REPO).tickets[0]
      if (card.state !== 'working') throw new Error('not working yet')
    })
    release.resume?.()
  })

  it('returns the card to idle (awaiting person) when launch rejects', async () => {
    const ctx: Ctx = { updates: [], progress: [] }
    const launcher: WorkerLauncher = {
      launch: () => Promise.reject(new Error('engine down')),
    }
    const service = makeService(ctx, launcher)
    dispatch(service)

    // launch 失败：assignment 以 failed 收尾、无 failed Report —— 领域阶段为
    // idle（等人决定重试/停止），卡片如实投影，不伪造 failed
    await vi.waitFor(() => {
      const card = service.tickets(REPO).tickets[0]
      if (card.state !== 'idle') throw new Error('not idle yet')
    })
    // 失败也走健康接缝（effect:launch）
    const report = service.health(REPO)
    expect(report.items.length).toBeGreaterThan(0)
  })
})
