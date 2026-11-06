// @vitest-environment node
/**
 * RouterRunner 的会话归属与路由协议（T21）。
 *
 * 覆盖的是「Router 不再自己干活」这一层：
 *  - 会话以空工具面启动，角色说明走 appendSystemPrompt（稳定前缀，不逐轮重写）；
 *  - 人的消息先推气泡再投递（引擎不回显宿主写进 stdin 的消息）；
 *  - 回复尾部的 super-agent:route 块解析成 accept/attach/retry/stop，每条一个稳定
 *    requestId（带实例号，重启后的第一轮不会与重启前撞键），同一轮重复落定不会
 *    重复建单；
 *  - 工单目标是本轮人的原话，Router 只留 ≤30 字旁注；
 *  - 每项目同一时刻最多一轮：忙时新到的中继排队，不并发写同一 stdin；
 *  - 中止只作用于 Router，不影响 Worker。
 */
import { describe, expect, it } from 'vitest'
import {
  SUPER_AGENT_ROUTE_REPAIR_PROMPT,
  SUPER_AGENT_ROUTER_ROLE_PROMPT,
} from '../prompts'
import {
  createSuperAgentRouterRunner,
  type SuperAgentRouterAttachInput,
  type SuperAgentRouterDispatchInput,
  type SuperAgentRouterRetryInput,
  type SuperAgentRouterRouteRejection,
  type SuperAgentRouterStopInput,
} from '../routerRunner'
import { wrapSuperAgentHostContext } from '@/shared/promptEnvelope'
import { createFakeBridge, routeFence } from './fakeBridge'

const REPO = '/repo/a'
const SESSION = 'router-session'
/** 固定实例号：route 幂等键里的 epoch 不进断言正文，只验证它参与了区分。 */
const EPOCH = 'e1'

/** 人消息轮交给引擎的正文：原话 + 带信封的宿主注入段。 */
function engineHuman(text: string, ...hostBlocks: string[]): string {
  return [text, wrapSuperAgentHostContext(hostBlocks)].filter(Boolean).join('\n\n')
}

function makeRunner(statusContext?: () => string, epoch = EPOCH) {
  const fake = createFakeBridge()
  const dispatched: SuperAgentRouterDispatchInput[] = []
  const attached: SuperAgentRouterAttachInput[] = []
  const retried: SuperAgentRouterRetryInput[] = []
  const stopped: SuperAgentRouterStopInput[] = []
  const statuses: boolean[] = []
  const failures: string[] = []
  const rejections: SuperAgentRouterRouteRejection[] = []

  const runner = createSuperAgentRouterRunner({
    repoRoot: REPO,
    sessionId: SESSION,
    runnerEpoch: epoch,
    bridge: fake.bridge,
    hooks: {
      dispatch: (input) => {
        dispatched.push(input)
        return { ticketId: `ticket-${dispatched.length}` }
      },
      attach: (input) => {
        attached.push(input)
      },
      retry: (input) => {
        retried.push(input)
      },
      stop: (input) => {
        stopped.push(input)
      },
      onStatusChanged: (running) => statuses.push(running),
      onFailure: (code) => failures.push(code),
      onRouteRejected: (info) => rejections.push(info),
      ...(statusContext ? { statusContext } : {}),
    },
  })
  return {
    runner, fake, dispatched, attached, retried, stopped, statuses, failures, rejections,
  }
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createSuperAgentRouterRunner message', () => {
  it('starts the router without tools or the conflicting plan workflow', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '帮我把登录页修好' })

    expect(fake.started).toHaveLength(1)
    expect(fake.started[0]).toMatchObject({ sessionId: SESSION })
    expect(fake.started[0]?.config).toMatchObject({
      cwd: REPO,
      permissionMode: 'default',
      appendSystemPrompt: SUPER_AGENT_ROUTER_ROLE_PROMPT,
      // 全部工具从引擎工具池移除：Router 只说话不出手，不借 plan 引入冲突的工作流
      allowedTools: [],
    })
    expect(fake.sent[0]?.content).toBe(engineHuman('帮我把登录页修好', SUPER_AGENT_ROUTER_ROLE_PROMPT))
  })

  it('pushes the human bubble before sending, with the display text', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '@src/login.ts 看下这个', displayText: '看下这个' })

    expect(fake.pushed).toHaveLength(1)
    expect(fake.pushed[0]).toMatchObject({
      sessionId: SESSION,
      content: '看下这个',
      sessionType: 'superAgent',
      projectPath: REPO,
      permissionMode: 'default',
    })
  })

  it('passes image attachments through to the engine', async () => {
    const { runner, fake } = makeRunner()
    const images = [{ id: 'i1', name: 'shot.png', type: 'image', mimeType: 'image/png', previewUrl: '', data: 'x' }]
    await runner.message({ text: '这个界面不对', images })

    expect(fake.sent[0]?.images).toEqual(images)
  })

  it('reports running while the turn is in flight and idle after the result', async () => {
    const { runner, fake, statuses } = makeRunner()
    await runner.message({ text: '你好' })
    expect(statuses).toEqual([true])
    expect(runner.isRunning()).toBe(true)

    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'ignore', reason: '普通问答' }]) })
    expect(statuses).toEqual([true, false])
    expect(runner.isRunning()).toBe(false)
  })

  it('reuses the same session for the next turn instead of spawning again', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '第一句' })
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'ignore', reason: '无需执行' }]) })
    await runner.message({ text: '第二句' })

    expect(fake.started).toHaveLength(1)
    expect(fake.sent).toHaveLength(2)
  })

  it('restarts the session after the engine exited', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '第一句' })
    fake.emit(SESSION, 'exit', { exitCode: 0 })
    await runner.message({ text: '第二句' })

    expect(fake.started).toHaveLength(2)
  })
})

describe('createSuperAgentRouterRunner route protocol', () => {
  it('carries the human words as the ticket goal, not the router paraphrase', async () => {
    const { runner, fake, dispatched } = makeRunner()
    await runner.message({ text: '把设置页的保存按钮文案改成"保存"，顺手补个测试' })
    fake.emit(SESSION, 'result', {
      result: `好。\n\n${routeFence([
        { kind: 'accept', title: '改保存按钮文案', note: '文案与测试一起做' },
      ])}`,
    })

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toMatchObject({
      title: '改保存按钮文案',
      // 目标是人说的那句话；Router 写的只有旁注
      text: '把设置页的保存按钮文案改成"保存"，顺手补个测试',
      note: '文案与测试一起做',
      requestId: `route:${SESSION}:${EPOCH}:1:0`,
    })
  })

  it('creates one ticket per accept with a stable per-turn id', async () => {
    const { runner, fake, dispatched } = makeRunner()
    await runner.message({ text: '分两张工单做' })
    fake.emit(SESSION, 'result', {
      result: `已建两张工单。\n\n${routeFence([
        { kind: 'accept', title: '表单校验收口', note: 'validateField' },
        { kind: 'accept', title: 'debounce 去重', note: null },
      ])}`,
    })

    expect(dispatched).toHaveLength(2)
    expect(dispatched[0]?.text).toBe('分两张工单做')
    expect(dispatched[0]?.note).toBe('validateField')
    expect(dispatched[1]?.requestId).toBe(`route:${SESSION}:${EPOCH}:1:1`)
  })

  it('attaches the human words to an existing ticket', async () => {
    const { runner, fake, attached, dispatched } = makeRunner()
    await runner.message({ text: '上次那个按钮也顺带对齐一下间距' })
    fake.emit(SESSION, 'result', {
      result: routeFence([{ kind: 'attach', ticketId: 'ticket-9', note: '同一处改动' }])
    })

    expect(dispatched).toHaveLength(0)
    expect(attached).toHaveLength(1)
    expect(attached[0]).toMatchObject({
      requestId: `route:${SESSION}:${EPOCH}:1:0`,
      ticketId: 'ticket-9',
    })
    // 原话在前、旁注在后：Worker 先看到人说了什么
    expect(attached[0]?.text).toBe('上次那个按钮也顺带对齐一下间距\n\n[Router 旁注｜不授权、不替代上面的原文] 同一处改动')
  })

  it('stops only the ticket the router names', async () => {
    const { runner, fake, stopped } = makeRunner()
    await runner.message({ text: '第二张先别做了' })
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'stop', ticketId: 'ticket-2' }]) })

    expect(stopped).toEqual([{ requestId: `route:${SESSION}:${EPOCH}:1:0`, ticketId: 'ticket-2', note: null }])
  })

  it('routes a retry to the generation-bumping exit, not to attach', async () => {
    const { runner, fake, attached, retried } = makeRunner()
    await runner.message({ text: '那张失败的重新执行' })
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'retry', ticketId: 'ticket-5' }]) })

    // attach 复用代次、投一条人消息；重跑必须是另一条出口，否则消息只会投不出去
    expect(attached).toHaveLength(0)
    expect(retried).toEqual([{ requestId: `route:${SESSION}:${EPOCH}:1:0`, ticketId: 'ticket-5' }])
  })

  it('gives the first turn after a restart a fresh id instead of colliding with the old one', async () => {
    const before = makeRunner()
    await before.runner.message({ text: '建一张单' })
    before.fake.emit('router-session', 'result', { result: routeFence([{ kind: 'accept', title: 'a' }]) })

    // 重启：turnSeq 又从 1 数起，只有实例号能把两轮分开
    const after = makeRunner(undefined, 'e2')
    await after.runner.message({ text: '重新执行' })
    after.fake.emit('router-session', 'result', { result: routeFence([{ kind: 'retry', ticketId: 'ticket-1' }]) })

    // 同一个领域实例会把同键不同载荷的重复请求判成 conflict 并整条丢弃 ——
    // 那正是重启后第一轮路由凭空消失的原因。
    expect(after.retried[0]?.requestId).not.toBe(before.dispatched[0]?.requestId)
    expect(after.retried[0]?.requestId).toBe(`route:${SESSION}:e2:1:0`)
  })

  it('does nothing for ignore, and does not fail on it', async () => {
    const { runner, fake, dispatched, attached, stopped, failures } = makeRunner()
    await runner.message({ text: '你觉得这个布局怎么样' })
    fake.emit(SESSION, 'result', {
      result: `在讨论阶段。\n\n${routeFence([{ kind: 'ignore', reason: '普通讨论，没有实现意图' }])}`,
    })

    expect(dispatched).toHaveLength(0)
    expect(attached).toHaveLength(0)
    expect(stopped).toHaveLength(0)
    expect(failures).toHaveLength(0)
  })

  it('refuses an attach that arrives on a relayed turn with no human words to carry', async () => {
    const { runner, fake, attached, failures } = makeRunner()
    runner.relay('[工单事件] ticket-1 ready')
    await flush()
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'attach', ticketId: 'ticket-1' }]) })

    // 中继轮没有人的原话可带，attach 无从成立：计健康，不投转述
    expect(attached).toHaveLength(0)
    expect(failures).toEqual(['attachWithoutSource'])
  })

  it('deduplicates a repeated result of the same turn via the idempotency key', async () => {
    const { runner, fake, dispatched } = makeRunner()
    await runner.message({ text: '建单' })
    const text = routeFence([{ kind: 'accept', title: 'a' }])
    fake.emit(SESSION, 'result', { result: text })
    fake.emit(SESSION, 'result', { result: text })

    // 同轮重复落定 → 同 requestId；领域侧按它幂等，不会多建一张
    expect(dispatched).toHaveLength(2)
    expect(dispatched[0]?.requestId).toBe(dispatched[1]?.requestId)
  })

  it('gives the next turn a new id so a genuinely repeated request still creates work', async () => {
    const { runner, fake, dispatched } = makeRunner()
    const text = routeFence([{ kind: 'accept', title: 'a' }])
    await runner.message({ text: '建单' })
    fake.emit(SESSION, 'result', { result: text })
    await runner.message({ text: '再建一次' })
    fake.emit(SESSION, 'result', { result: text })

    expect(dispatched[0]?.requestId).not.toBe(dispatched[1]?.requestId)
    // 新一轮的原话跟着换：目标不能停在上一轮人的话上
    expect(dispatched[1]?.text).toBe('再建一次')
  })

  it('does not dispatch for an ordinary chat reply', async () => {
    const { runner, fake, dispatched, failures } = makeRunner()
    await runner.message({ text: '你好' })
    fake.emit(SESSION, 'result', {
      result: `你好！\n\n${routeFence([{ kind: 'ignore', reason: '普通闲聊' }])}`,
    })

    expect(dispatched).toHaveLength(0)
    expect(failures).toHaveLength(0)
  })

  it('repairs a missing route instead of dropping an execution request', async () => {
    const { runner, fake, dispatched, failures } = makeRunner()
    await runner.message({ text: '重启覆盖率会话' })
    fake.emit(SESSION, 'result', {
      result: '我先检查部分产出，然后重启覆盖率跑，并派一个 Explore 代理。',
    })

    expect(dispatched).toHaveLength(0)
    expect(fake.sent).toHaveLength(2)
    expect(fake.sent[1]?.content).toBe(wrapSuperAgentHostContext([SUPER_AGENT_ROUTE_REPAIR_PROMPT]))
    expect(runner.isRunning()).toBe(true)

    fake.emit(SESSION, 'result', {
      result: routeFence([{ kind: 'accept', title: '重启覆盖率会话与测试探索' }]),
    })

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toMatchObject({
      text: '重启覆盖率会话',
      title: '重启覆盖率会话与测试探索',
      requestId: `route:${SESSION}:${EPOCH}:1:0`,
    })
    expect(failures).toHaveLength(0)
    expect(runner.isRunning()).toBe(false)
  })

  it('repairs a missing route at most once per human turn', async () => {
    const { runner, fake, dispatched, failures } = makeRunner()
    await runner.message({ text: '重启覆盖率会话' })
    fake.emit(SESSION, 'result', { result: '我来重启。' })
    fake.emit(SESSION, 'result', { result: '还是没有路由块。' })

    expect(fake.sent).toHaveLength(2)
    expect(dispatched).toHaveLength(0)
    expect(failures).toEqual(['routeMissing'])
    expect(runner.isRunning()).toBe(false)
  })

  it('refuses two conflicting blocks instead of picking one', async () => {
    const { runner, fake, dispatched, failures } = makeRunner()
    await runner.message({ text: '建单' })
    fake.emit(SESSION, 'result', {
      result: `${routeFence([{ kind: 'accept', title: 'a' }])}\n\n${routeFence([{ kind: 'accept', title: 'c' }])}`,
    })

    expect(dispatched).toHaveLength(0)
    expect(failures).toEqual(['routeNotUnique'])
  })

  it('records a protocol failure when the domain rejects the suggestion', async () => {
    const fake = createFakeBridge()
    const failures: string[] = []
    const runner = createSuperAgentRouterRunner({
      repoRoot: REPO,
      sessionId: SESSION,
      bridge: fake.bridge,
      hooks: {
        dispatch: () => {
          throw Object.assign(new Error('duplicate request'), { code: 'conflict' })
        },
        attach: () => {},
        retry: () => {},
        stop: () => {},
        onStatusChanged: () => {},
        onFailure: (code) => failures.push(code),
      },
    })
    await runner.message({ text: '建单' })
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'accept', title: 'a' }]) })

    // 建单被拒不能抛穿事件回调：转成稳定 code 上报健康，其余回复不受影响
    expect(failures).toEqual(['conflict'])
    runner.dispose()
  })

  it('keeps the other routes alive when one of them is refused', async () => {
    const fake = createFakeBridge()
    const stopped: string[] = []
    const failures: string[] = []
    const runner = createSuperAgentRouterRunner({
      repoRoot: REPO,
      sessionId: SESSION,
      bridge: fake.bridge,
      hooks: {
        dispatch: () => {
          throw Object.assign(new Error('ended'), { code: 'ticketEnded' })
        },
        attach: () => {},
        retry: () => {},
        stop: (input) => stopped.push(input.ticketId),
        onStatusChanged: () => {},
        onFailure: (code) => failures.push(code),
      },
    })
    await runner.message({ text: '那张别做了，改做这个' })
    fake.emit(SESSION, 'result', {
      result: routeFence([
        { kind: 'accept', title: 'a' },
        { kind: 'stop', ticketId: 'ticket-3' },
      ]),
    })

    // 一条被拒不拖累同批其余指令：人说的"别做了"仍然要落到停止上
    expect(failures).toEqual(['ticketEnded'])
    expect(stopped).toEqual(['ticket-3'])
    runner.dispose()
  })

  it('feeds a refused route back to the conversation instead of only counting health', async () => {
    const fake = createFakeBridge()
    const rejections: SuperAgentRouterRouteRejection[] = []
    const runner = createSuperAgentRouterRunner({
      repoRoot: REPO,
      sessionId: SESSION,
      runnerEpoch: EPOCH,
      bridge: fake.bridge,
      hooks: {
        dispatch: () => ({ ticketId: 'ticket-1' }),
        attach: () => {
          throw Object.assign(new Error('no live assignment'), { code: 'assignmentEnded' })
        },
        retry: () => {},
        stop: () => {},
        onStatusChanged: () => {},
        onFailure: () => {},
        onRouteRejected: (info) => rejections.push(info),
      },
    })
    await runner.message({ text: '重新执行那张单' })
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'attach', ticketId: 'ticket-9' }]) })

    // 只累计健康计数的话，人听到的仍是 Router 按承诺编好的那句"已经重跑"
    expect(rejections).toEqual([
      { kind: 'attach', ticketId: 'ticket-9', code: 'assignmentEnded', humanTurn: true },
    ])
    runner.dispose()
  })

  it('does not feed back a refusal raised on a relayed turn', async () => {
    const { runner, fake, rejections } = makeRunner()
    runner.relay('[工单事件] ticket-1 ready')
    await flush()
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'attach', ticketId: 'ticket-1' }]) })

    // 中继轮本身就没有人的原话；再回灌一条中继只会自我循环
    expect(rejections).toEqual([
      { kind: 'attach', ticketId: 'ticket-1', code: 'attachWithoutSource', humanTurn: false },
    ])
  })

  it('ignores events from other sessions', async () => {
    const { runner, fake, dispatched } = makeRunner()
    await runner.message({ text: '建单' })
    fake.emit('other-session', 'result', { result: routeFence([{ kind: 'accept', title: 'a' }]) })

    expect(dispatched).toHaveLength(0)
    expect(runner.isRunning()).toBe(true)
  })
})

describe('createSuperAgentRouterRunner queueing', () => {
  it('queues a relayed ticket event behind the running turn', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '现在怎么样了' })
    runner.relay('[工单事件] ticket-1 ready')

    expect(fake.sent).toHaveLength(1)
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'ignore', reason: '汇报队列状态' }]) })
    await flush()
    expect(fake.sent).toHaveLength(2)
    expect(fake.sent[1]?.content).toBe(wrapSuperAgentHostContext(['[工单事件] ticket-1 ready']))
  })

  it('does not push a bubble for relayed events', async () => {
    const { runner, fake } = makeRunner()
    runner.relay('[工单事件] ticket-1 ready')
    await flush()

    expect(fake.pushed).toHaveLength(0)
    expect(fake.sent).toHaveLength(1)
  })

  it('does not request a route repair for a relayed ticket update', async () => {
    const { runner, fake, failures } = makeRunner()
    runner.relay('[工单事件] ticket-1 ready')
    await flush()
    fake.emit(SESSION, 'result', { result: '覆盖率工单已完成。' })
    await flush()

    expect(fake.sent).toHaveLength(1)
    expect(failures).toHaveLength(0)
    expect(runner.isRunning()).toBe(false)
  })

  it('keeps the input queued when the engine refuses the write', async () => {
    const { runner, fake, failures, statuses } = makeRunner()
    fake.failNextSend = new Error('stdin closed')
    await runner.message({ text: '建单' })

    expect(runner.isRunning()).toBe(false)
    expect(failures.length).toBeGreaterThan(0)
    expect(statuses[statuses.length - 1]).toBe(false)
    expect(fake.sent).toHaveLength(0)

    // 消息不丢：再泵一次时先把没投出去的那条投出去，队列一次只走一轮
    runner.relay('补一次')
    await flush()
    expect(fake.sent.map((call) => call.content)).toEqual([engineHuman('建单', SUPER_AGENT_ROUTER_ROLE_PROMPT)])

    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'ignore', reason: '无需执行' }]) })
    await flush()
    expect(fake.sent.map((call) => call.content)).toEqual([
      engineHuman('建单', SUPER_AGENT_ROUTER_ROLE_PROMPT),
      wrapSuperAgentHostContext(['补一次']),
    ])
  })
})

describe('createSuperAgentRouterRunner status context', () => {
  it('appends the ticket index to the engine input, not to the human bubble', async () => {
    const { runner, fake } = makeRunner(() => '[工单快照]\n槽位：1/1 执行中 · 0 排队')
    await runner.message({ text: '现在有哪些活', displayText: '现在有哪些活' })

    expect(fake.sent[0]?.content).toBe(
      engineHuman('现在有哪些活', SUPER_AGENT_ROUTER_ROLE_PROMPT, '[工单快照]\n槽位：1/1 执行中 · 0 排队'),
    )
    // 气泡只给人自己打的那句话，快照是宿主与模型之间的东西
    expect(fake.pushed[0]?.content).toBe('现在有哪些活')
  })

  it('rebuilds the snapshot each turn instead of freezing the first one', async () => {
    let snapshot = 'A'
    const { runner, fake } = makeRunner(() => snapshot)
    await runner.message({ text: '第一问' })
    snapshot = 'B'
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'ignore', reason: '无需执行' }]) })
    await runner.message({ text: '第二问' })

    expect(fake.sent[0]?.content).toBe(engineHuman('第一问', SUPER_AGENT_ROUTER_ROLE_PROMPT, 'A'))
    expect(fake.sent[1]?.content).toBe(engineHuman('第二问', SUPER_AGENT_ROUTER_ROLE_PROMPT, 'B'))
  })

  it('does not stack the snapshot onto relayed ticket events', async () => {
    const { runner, fake } = makeRunner(() => '[工单快照]')
    runner.relay('[工单事件] ticket-1 ready')
    await flush()

    expect(fake.sent[0]?.content).toBe(wrapSuperAgentHostContext(['[工单事件] ticket-1 ready']))
  })

  it('keeps the role contract when the host has no ticket status to report', async () => {
    const { runner, fake } = makeRunner(() => '')
    await runner.message({ text: '你好' })

    expect(fake.sent[0]?.content).toBe(engineHuman('你好', SUPER_AGENT_ROUTER_ROLE_PROMPT))
  })
})

describe('createSuperAgentRouterRunner model', () => {
  it('starts the session with the picked model resolved for the engine', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '建单', model: 'glm-5-3-flash' })

    expect(fake.started[0]?.config?.model).toBe('glm-5-3-flash')
  })

  it('keeps the settings slot model when the composer has no choice', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '你好' })

    // fake loadConfig 给的 sonnet 就是设置页槽位值，不该被覆盖
    expect(fake.started[0]?.config?.model).toBe('sonnet')
  })

  it('switching the model on a live session stops and respawns it with the new model', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '第一句', model: 'a' })
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'ignore', reason: '无需执行' }]) })
    await runner.message({ text: '第二句', model: 'b' })

    // 不发 set_model 控制请求：别名由引擎进程按 spawn 时的环境解析，进程起来
    // 之后才同步进 settings.json 的槽位会被解析成旧值（选 A 跑 B 且无从察觉）。
    // 停掉重拉走冷启动，引擎重读 settings.json。
    expect(fake.stopped).toEqual([SESSION])
    expect(fake.started).toHaveLength(2)
    expect(fake.started[1]?.config?.model).toBe('b')
    // 两句话都投出去了，没有丢
    expect(fake.sent.map((call) => call.content)).toEqual([
      engineHuman('第一句', SUPER_AGENT_ROUTER_ROLE_PROMPT),
      engineHuman('第二句', SUPER_AGENT_ROUTER_ROLE_PROMPT),
    ])
  })

  it('does not restart for the same choice', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '第一句', model: 'a' })
    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'ignore', reason: '无需执行' }]) })
    await runner.message({ text: '第二句', model: 'a' })

    expect(fake.started).toHaveLength(1)
    expect(fake.stopped).toHaveLength(0)
  })

  it('applies the choice to a session restarted after the engine exited', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '第一句', model: 'a' })
    fake.emit(SESSION, 'exit', { exitCode: 0 })
    await runner.message({ text: '第二句' })

    // 重开时不再重复停进程，但选择要跟着新配置留住
    expect(fake.stopped).toHaveLength(0)
    expect(fake.started).toHaveLength(2)
    expect(fake.started[1]?.config?.model).toBe('a')
  })
})

describe('createSuperAgentRouterRunner abort', () => {
  it('aborts only the router turn and flushes the queued input', async () => {
    const { runner, fake, statuses } = makeRunner()
    await runner.message({ text: '慢一点' })
    runner.relay('排队的一条')
    await runner.abortTurn()

    expect(fake.aborted).toEqual([SESSION])
    // 中止即收敛为空闲；随后队列里那条立刻起新轮，状态又回到 running
    expect(statuses).toEqual([true, false, true])
    await flush()
    expect(fake.sent.map((call) => call.content)).toEqual([
      engineHuman('慢一点', SUPER_AGENT_ROUTER_ROLE_PROMPT),
      wrapSuperAgentHostContext(['排队的一条']),
    ])
  })

  it('does nothing when no turn is in flight', async () => {
    const { runner, fake } = makeRunner()
    await runner.abortTurn()
    expect(fake.aborted).toHaveLength(0)
  })

  it('settles false while a turn is still running', async () => {
    const { runner, fake } = makeRunner()
    await runner.message({ text: '还在想' })
    expect(await runner.settle(20)).toBe(false)

    fake.emit(SESSION, 'result', { result: routeFence([{ kind: 'ignore', reason: '无需执行' }]) })
    expect(await runner.settle(20)).toBe(true)
  })
})
