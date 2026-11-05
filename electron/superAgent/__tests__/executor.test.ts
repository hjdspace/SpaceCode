// @vitest-environment node
/**
 * Worker Executor 的引擎通路契约（T21）。
 *
 * 覆盖的是「派出去的任务真的有人在跑」这一层：
 *  - 启动配置：Worker 以 bypassPermissions 起（人工逐次点授权会把后台执行变成陪跑），
 *    角色说明走 appendSystemPrompt，工作目录用调度器给的实际目录；
 *  - 指派身份：assignmentId 随首条消息给出（Report 必须逐字回填），气泡先推再发；
 *  - launch promise 的语义：引擎接受首条消息 ≠ 任务完成，只有最终 Report 或
 *    协议失败/中断才落定 —— 调度器的槽位就是靠它持有的；
 *  - 投递：能证明接受才回 accepted，否则回 unknown（禁止盲目重投）；
 *  - 停止：abort + stop。
 */
import { describe, expect, it } from 'vitest'
import { createSuperAgentExecutor, type SuperAgentExecutorHooks } from '../executor'
import { SUPER_AGENT_WORKER_ROLE_PROMPT } from '../prompts'
import type { WorkerLaunchRequest } from '../scheduler'
import type { SuperAgentReportKind } from '../model'
import { createFakeBridge, reportFence } from './fakeBridge'

const REPO = '/repo/a'

/** 让 launch 的 await 链跑到底（一次微任务不够，promise 还套着 async 帧）。 */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function launchRequest(overrides: Partial<WorkerLaunchRequest> = {}): WorkerLaunchRequest {
  return {
    ticketId: 'ticket-1',
    assignmentId: 'assignment-1',
    repoRoot: REPO,
    firstMessage: '# 工单指派：修登录\n\n## 目标\n\n让登录页可用',
    workspace: {
      head: 'abc123',
      dirty: false,
      statusText: '',
      entries: [],
    },
    worktree: null,
    ...overrides,
  }
}

function makeExecutor(hookOverrides: Partial<SuperAgentExecutorHooks> = {}) {
  const fake = createFakeBridge()
  const ingests: string[] = []
  const failures: Parameters<SuperAgentExecutorHooks['onProtocolFailure']>[0][] = []
  const interruptions: Parameters<SuperAgentExecutorHooks['onInterrupted']>[0][] = []
  const relays: Parameters<NonNullable<SuperAgentExecutorHooks['relay']>>[0][] = []

  const hooks: SuperAgentExecutorHooks = {
    ingest: (text) => {
      ingests.push(text)
      const kind = /"kind":"(\w+)"/.exec(text)?.[1] ?? 'progress'
      const summary = /"summary":"([^"]*)"/.exec(text)?.[1] ?? ''
      const final = kind !== 'progress'
      return {
        final,
        kind: kind as SuperAgentReportKind,
        summary: summary || null,
        ticketId: 'ticket-1',
      }
    },
    onProtocolFailure: (context) => failures.push(context),
    onInterrupted: (context) => interruptions.push(context),
    relay: (info) => relays.push(info),
    ...hookOverrides,
  }

  const executor = createSuperAgentExecutor({
    bridge: fake.bridge,
    resolveGeneration: () => 2,
    titleOf: () => '修登录',
    hooks,
  })
  return { executor, fake, ingests, failures, interruptions, relays }
}

describe('createSuperAgentExecutor launch', () => {
  it('starts the worker session with the launch directory and the worker role prompt', async () => {
    const { executor, fake } = makeExecutor()
    const launched = executor.launch(launchRequest())
    await flush()

    expect(fake.started).toHaveLength(1)
    const [start] = fake.started
    expect(start?.sessionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(start?.config).toMatchObject({
      cwd: REPO,
      permissionMode: 'bypassPermissions',
      appendSystemPrompt: SUPER_AGENT_WORKER_ROLE_PROMPT,
    })
    // 首条消息 = 调度器组装的指派 + 本次执行身份（assignmentId 要逐字回填）
    const sent = fake.sent[0]?.content ?? ''
    expect(sent).toContain('让登录页可用')
    expect(sent).toContain('assignment-1')
    expect(sent).toContain('generation: 2')
    await fake.emit(fake.started[0]!.sessionId, 'result', {
      result: reportFence({ assignmentId: 'assignment-1', reportId: 'r1', kind: 'ready', summary: 'done' }),
    })
    await launched
  })

  it('pushes the assignment bubble before sending, so the panel shows who assigned it', async () => {
    const { executor, fake } = makeExecutor()
    const launched = executor.launch(launchRequest())
    await flush()

    expect(fake.pushed).toHaveLength(1)
    expect(fake.pushed[0]).toMatchObject({
      content: expect.stringContaining('assignment-1'),
      title: '修登录',
      projectPath: REPO,
      permissionMode: 'bypassPermissions',
    })
    await fake.emit(fake.started[0]!.sessionId, 'result', {
      result: reportFence({ assignmentId: 'assignment-1', reportId: 'r1', kind: 'waiting', summary: '等' }),
    })
    await launched
  })

  it('does not treat a progress-only turn as completion, but still frees the slot', async () => {
    const { executor, fake, failures } = makeExecutor()
    let settled = false
    const launched = executor.launch(launchRequest()).then(() => {
      settled = true
    })
    await flush()
    const sessionId = fake.started[0]!.sessionId

    // progress 只算进展：调度槽位不能因为「还在跑」被白占，turn 已结束就按协议失败落定
    fake.emit(sessionId, 'result', {
      result: reportFence({ assignmentId: 'assignment-1', reportId: 'p1', kind: 'progress', summary: '半路' }),
    })
    await flush()
    expect(settled).toBe(true)
    expect(failures).toHaveLength(1)
    await launched
  })

  it('resolves on the final report and relays it to the router exactly once', async () => {
    const { executor, fake, relays } = makeExecutor()
    const launched = executor.launch(launchRequest())
    await flush()
    const sessionId = fake.started[0]!.sessionId

    fake.emit(sessionId, 'result', {
      result: reportFence({ assignmentId: 'assignment-1', reportId: 'r1', kind: 'ready', summary: '改完了' }),
    })
    await launched
    expect(relays).toEqual([
      { ticketId: 'ticket-1', kind: 'ready', summary: '改完了' },
    ])

    // 迟到的同会话事件不再触发中继（上一代事件只审计）
    fake.emit(sessionId, 'result', {
      result: reportFence({ assignmentId: 'assignment-1', reportId: 'r2', kind: 'ready', summary: 'again' }),
    })
    expect(relays).toHaveLength(1)
  })

  it('treats a turn without any report as a protocol failure, never as completion', async () => {
    const { executor, fake, failures, interruptions } = makeExecutor()
    const launched = executor.launch(launchRequest())
    await flush()
    const sessionId = fake.started[0]!.sessionId

    fake.emit(sessionId, 'result', { result: '我觉得已经改好了' })
    await launched
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ ticketId: 'ticket-1', assignmentId: 'assignment-1' })
    expect(interruptions).toHaveLength(0)
  })

  it('records an engine error as an interruption and frees the slot', async () => {
    const { executor, fake, interruptions } = makeExecutor()
    const launched = executor.launch(launchRequest())
    await flush()
    expect(executor.isRunning('ticket-1')).toBe(true)

    fake.emit(fake.started[0]!.sessionId, 'error', { message: 'upstream 502' })
    await launched
    expect(interruptions).toEqual([
      { ticketId: 'ticket-1', assignmentId: 'assignment-1', reason: 'upstream 502' },
    ])
    expect(executor.isRunning('ticket-1')).toBe(false)
  })

  it('rejects the launch when the engine cannot start, so the scheduler marks it failed', async () => {
    const { executor, fake } = makeExecutor()
    fake.failNextStart = new Error('spawn failed')
    await expect(executor.launch(launchRequest())).rejects.toThrow('spawn failed')
    expect(executor.isRunning('ticket-1')).toBe(false)
    expect(fake.pushed).toHaveLength(1)
  })

  it('ignores events of sessions it does not own', async () => {
    const { executor, fake, ingests } = makeExecutor()
    const launched = executor.launch(launchRequest())
    await flush()
    fake.emit('some-other-session', 'result', { result: 'hello' })
    expect(ingests).toHaveLength(0)
    fake.emit(fake.started[0]!.sessionId, 'result', {
      result: reportFence({ assignmentId: 'assignment-1', reportId: 'r1', kind: 'waiting', summary: '等' }),
    })
    await launched
  })
})

describe('createSuperAgentExecutor deliver', () => {
  it('sends into the live worker session and reports acceptance', async () => {
    const { executor, fake } = makeExecutor()
    const launched = executor.launch(launchRequest())
    await flush()
    const sessionId = fake.started[0]!.sessionId

    const outcome = await executor.deliver({
      ticketId: 'ticket-1',
      inputId: 'input-1',
      requestId: 'req-1',
      repoRoot: REPO,
      sessionId,
      text: '旧接口还要保留吗？',
    })
    expect(outcome).toBe('accepted')
    expect(fake.sent[1]?.content).toBe('旧接口还要保留吗？')
    await fake.emit(sessionId, 'result', {
      result: reportFence({ assignmentId: 'assignment-1', reportId: 'r1', kind: 'waiting', summary: '等' }),
    })
    await launched
  })

  it('reports unknown instead of pretending the write landed', async () => {
    const { executor, fake } = makeExecutor()
    fake.failNextSend = new Error('stdin closed')
    const outcome = await executor.deliver({
      ticketId: 'ticket-1',
      inputId: 'input-1',
      requestId: 'req-1',
      repoRoot: REPO,
      sessionId: 'worker-session',
      text: '继续',
    })
    expect(outcome).toBe('unknown')
  })

  it('restarts an idle worker session before delivering', async () => {
    const { executor, fake } = makeExecutor()
    const outcome = await executor.deliver({
      ticketId: 'ticket-1',
      inputId: 'input-1',
      requestId: 'req-1',
      repoRoot: REPO,
      // 会话此刻不在 Executor 手里（进程重启/空闲退出）：按传入的稳定 id 重新拉起
      sessionId: 'worker-session-1',
      text: '继续',
    })
    expect(outcome).toBe('accepted')
    expect(fake.started).toHaveLength(1)
    expect(fake.started[0]).toMatchObject({ sessionId: 'worker-session-1' })
    expect(fake.started[0]?.config).toMatchObject({ cwd: REPO })
  })

  it('refuses to deliver without a known working directory', async () => {
    const { executor } = makeExecutor()
    const outcome = await executor.deliver({
      ticketId: 'ticket-1',
      inputId: 'input-1',
      requestId: 'req-1',
      repoRoot: '',
      sessionId: 'worker-session',
      text: '继续',
    })
    expect(outcome).toBe('unknown')
  })
})

describe('createSuperAgentExecutor stop and settle', () => {
  it('aborts then stops the worker session when the ticket is stopped', async () => {
    const { executor, fake } = makeExecutor()
    const launched = executor.launch(launchRequest())
    await flush()
    const sessionId = fake.started[0]!.sessionId

    await executor.stopTicket('ticket-1')
    expect(fake.aborted).toEqual([sessionId])
    expect(fake.stopped).toEqual([sessionId])
    expect(executor.isRunning('ticket-1')).toBe(false)
    await launched
  })

  it('does nothing for a ticket with no live session', async () => {
    const { executor, fake } = makeExecutor()
    await executor.stopTicket('ticket-none')
    expect(fake.aborted).toHaveLength(0)
  })

  it('settles within bound once every run has ended', async () => {
    const { executor, fake } = makeExecutor()
    const launched = executor.launch(launchRequest())
    await flush()
    expect(await executor.settle(50)).toBe(false)

    fake.emit(fake.started[0]!.sessionId, 'result', {
      result: reportFence({ assignmentId: 'assignment-1', reportId: 'r1', kind: 'ready', summary: 'done' }),
    })
    await launched
    expect(await executor.settle(50)).toBe(true)
  })

  it('stops listening after dispose', async () => {
    const { executor, fake, ingests } = makeExecutor()
    const launched = executor.launch(launchRequest())
    await flush()
    executor.dispose()
    fake.emit(fake.started[0]!.sessionId, 'result', { result: 'whatever' })
    expect(ingests).toHaveLength(0)
    await launched
  })
})
