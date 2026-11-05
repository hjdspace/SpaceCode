/**
 * RouterRunner：Router 会话改由主进程拥有（设计 §4.2、§6.3）。
 *
 * 之前 Router 就是渲染端的一条普通聊天：走 turnStore、带全套写文件工具，
 * 于是"让它做事它自己就做了"。这里把它挪回主进程，并钉住两件事：
 *
 * 1. **不能自己干活** —— 会话以 `permissionMode='plan'` 启动，写与执行在引擎层
 *    就被拒；角色说明再补一条"不要请求进入执行模式"，避免它把 plan 当成
 *    "先出计划再批准"的通道。工具面裁剪要等 EngineSessionConfig 支持
 *    allowedTools，那是另一件事（设计 §3.2 第 2 条），这里不假装已实现。
 * 2. **动手只能靠路由指令** —— 回复尾部的 ```super-agent:route 块由宿主解析：
 *    accept 逐条走 service.dispatch 落 Decision/Mandate，attach 落一张工单的
 *    人消息输入，stop 走停止命令；授权仍由领域生成，模型拿不到（设计 §8.4）。
 * 3. **人的原话不经过 Router 的手** —— 本轮人说的是什么，宿主就原样带给 Worker
 *    当工单目标；Router 的 \`note\` 只是路由旁注（≤30 字），没有转述的通道。
 *
 * 每项目同一时刻最多一轮：新到的中继说明排队到下一批，不并发写同一 stdin；
 * Router 不阻塞等 Worker —— 工单结果由 Executor 作为新输入投进会话尾部。
 */
import {
  SUPER_AGENT_ROUTER_ROLE_PROMPT,
  renderSuperAgentAttachedMessage,
} from './prompts'
import { parseSuperAgentRouteText, type SuperAgentRouteAction } from './routerActions'
import { superAgentError } from './errors'
import type { SuperAgentEngineBridge } from './engineBridge'

export interface SuperAgentRouterDispatchInput {
  requestId: string
  title: string
  /** 工单目标：本轮人的原话；中继轮没有原话，才退回 Router 的路由说明。 */
  text: string
  /** Router 的路由说明（≤30 字，见 MAX_ROUTE_NOTE_CHARS）。 */
  note: string | null
}

export interface SuperAgentRouterAttachInput {
  requestId: string
  ticketId: string
  /** 挂接给该工单正文：本轮人的原话（含旁注标注）。 */
  text: string
}

export interface SuperAgentRouterStopInput {
  requestId: string
  ticketId: string
  note: string | null
}

export interface SuperAgentRouterRunnerOptions {
  repoRoot: string
  sessionId: string
  /** 引擎接缝（生产注入真实通路；测试注入 fake）。 */
  bridge: SuperAgentEngineBridge
  hooks: {
    /** 建单派工：幂等键由本轮 turn 序号派生，重复解析同一回复不会重复建单。 */
    dispatch(input: SuperAgentRouterDispatchInput): { ticketId: string }
    /** 把这轮人的原话挂到已有工单：与「继续追问」同一条投递路径。 */
    attach(input: SuperAgentRouterAttachInput): void
    /** 停一张工单：只有人明确要求停止时 Router 才会给出这条指令。 */
    stop(input: SuperAgentRouterStopInput): void
    /** 运行状态变化：service 据此更新快照 router.running 并广播。 */
    onStatusChanged(running: boolean): void
    /** 路由协议失败/引擎失败：计入健康，不打断人正在看的回复。 */
    onFailure(code: string): void
    /** 会话标题（渲染端会话名）。 */
    titleOf?(): string
    /**
     * 活跃工单索引（设计 §8.1）：每轮追加到人消息尾部的一次性事实。
     * 返回空串表示本轮不注入。不放 system 说明 —— 那会打没前缀缓存。
     */
    statusContext?(): string
  }
}

/** 待投递的一轮输入：正文 + 给人看的气泡文本 + 图片附件。 */
export interface SuperAgentRouterInput {
  text: string
  displayText?: string
  images?: unknown[]
  /** 输入框当前选中的模型（显示名）；不带它 Router 只会用设置页的槽位模型。 */
  model?: string
}

export interface SuperAgentRouterRunner {
  /** 人发来的消息：先推气泡，再排队投递。 */
  message(input: SuperAgentRouterInput): Promise<void>
  /** 工单事件中继：不推气泡（它不是人说的话）。 */
  relay(text: string): void
  /** 中止当前 Router 轮次；不影响任何 Worker。 */
  abortTurn(): Promise<void>
  isRunning(): boolean
  /** 有界等待在途轮次落定（shutdown 语义）。 */
  settle(timeoutMs: number): Promise<boolean>
  dispose(): void
}

function resultText(data: unknown): string {
  const record = data as { result?: unknown } | null | undefined
  return typeof record?.result === 'string' ? record.result : ''
}

export function createSuperAgentRouterRunner(
  options: SuperAgentRouterRunnerOptions,
): SuperAgentRouterRunner {
  const bridge = options.bridge
  const { repoRoot, sessionId, hooks } = options

  /**
   * 待投递输入（人的消息与工单事件按到达顺序串行投递）。
   * `human` 决定这一轮要不要配活跃工单索引 —— 只有人在问话时才需要。
   */
  const queue: { input: SuperAgentRouterInput; human: boolean }[] = []
  let turnInFlight = false
  let started = false
  /** 轮次序号：与 route 下标一起构成幂等键。 */
  let turnSeq = 0
  /**
   * 本轮的来源正文：人说的那句话，宿主直接拿它当工单目标。
   * 中继轮（工单事件）没有人的原话，为 null。
   */
  let turnSourceText: string | null = null
  /** 用户在输入框选中的模型（显示名）；null = 没选过，沿用设置页槽位。 */
  let selectedModel: string | null = null
  /** 已经落到当前这条会话上的模型选择；与 selectedModel 不一致才需要动作。 */
  let appliedModel: string | null = null

  const routerConfig = () => {
    const base = bridge.loadConfig(repoRoot)
    return {
      ...base,
      cwd: repoRoot,
      permissionMode: 'plan' as const,
      appendSystemPrompt: SUPER_AGENT_ROUTER_ROLE_PROMPT,
      // 输入框的选择优先于设置页槽位；按引擎解析（claude-code 要槽位别名，pi 要真名），
      // 否则指定的模型会被代理静默丢弃 —— 见 src/utils/engineModel。
      ...(selectedModel
        ? { model: bridge.resolveModelAlias(selectedModel, base.engineType) }
        : {}),
    }
  }

  async function ensureStarted(): Promise<void> {
    if (started) return
    await bridge.startSession(sessionId, routerConfig())
    appliedModel = selectedModel
    started = true
  }

  /**
   * 把输入框的模型选择落到引擎上。
   *
   * 会话还没起 → 由 routerConfig 带进 spawn。已经活着 → 走控制请求在线换，
   * 控制请求失败就把会话停掉、下一轮按新模型重新拉起（与主聊天同一回退路径），
   * 而不是让人以为下拉框生效了。
   */
  async function applyModelSelection(): Promise<void> {
    if (!started || selectedModel === null || appliedModel === selectedModel) return
    const base = bridge.loadConfig(repoRoot)
    try {
      await bridge.setModel(sessionId, bridge.resolveModelAlias(selectedModel, base.engineType))
      appliedModel = selectedModel
    } catch {
      await bridge.stop(sessionId).catch(() => undefined)
      started = false
      appliedModel = null
    }
  }

  function errorCode(err: unknown, fallback: string): string {
    return err && typeof err === 'object' && 'code' in err
      ? String((err as { code: unknown }).code)
      : fallback
  }

  function settleRoute(text: string): void {
    let routes: SuperAgentRouteAction[]
    try {
      routes = parseSuperAgentRouteText(text).routes
    } catch (err) {
      hooks.onFailure(errorCode(err, 'routeInvalid'))
      return
    }
    const seq = turnSeq
    // 目标 = 本轮人的原话，不是 Router 的转述；中继轮没有原话，才退回路由说明。
    const sourceText = turnSourceText
    routes.forEach((route, index) => {
      const requestId = `route:${sessionId}:${seq}:${index}`
      try {
        if (route.kind === 'accept') {
          hooks.dispatch({
            requestId,
            title: route.title,
            text: sourceText ?? route.note ?? route.title,
            note: route.note,
          })
        } else if (route.kind === 'attach') {
          // attach 的全部内容就是"这条人消息属于那张单"；本轮没有人的原话可带时
          // 它无从成立 —— 拒绝比投一段转述更诚实。
          if (sourceText === null) {
            throw superAgentError('attachWithoutSource', { ticketId: route.ticketId })
          }
          hooks.attach({
            requestId,
            ticketId: route.ticketId,
            text: renderSuperAgentAttachedMessage({ note: route.note, sourceText }),
          })
        } else if (route.kind === 'stop') {
          hooks.stop({ requestId, ticketId: route.ticketId, note: route.note })
        }
        // ignore 是"什么都不做"的显式记录：领域侧没有对应动作，也不该有。
      } catch (err) {
        hooks.onFailure(errorCode(err, 'invalidDispatch'))
      }
    })
  }

  const unsubscribe = bridge.onRouteEvent((sid, eventType, data) => {
    if (sid !== sessionId) return
    if (eventType === 'result') {
      turnInFlight = false
      settleRoute(resultText(data))
      hooks.onStatusChanged(false)
      void pump()
    } else if (eventType === 'error') {
      turnInFlight = false
      hooks.onFailure('engineLaunchFailed')
      hooks.onStatusChanged(false)
      void pump()
    } else if (eventType === 'exit') {
      // 进程退场：下一轮按稳定 id 重新拉起（引擎自己 --resume 历史）。
      turnInFlight = false
      started = false
      appliedModel = null
      hooks.onStatusChanged(false)
      void pump()
    }
  })

  /**
   * 交给引擎的正文：原文 + 本轮的活跃工单索引。
   *
   * 快照只进引擎输入，不进气泡 —— 给人看的仍是他自己打的那句话。工单事件中继
   * 不带它：那条输入本身就是工单事实，再叠一份索引只是重复花 token。
   */
  function engineText(input: SuperAgentRouterInput, human: boolean): string {
    if (!human) return input.text
    const context = hooks.statusContext?.() ?? ''
    if (context === '') return input.text
    return `${input.text}\n\n${context}`
  }

  async function pump(): Promise<void> {
    if (turnInFlight || queue.length === 0) return
    const next = queue.shift()
    if (next === undefined) return
    turnInFlight = true
    turnSeq += 1
    // 这一轮的目标正文只可能在"人在问话"时存在；中继轮带的是工单事实，不是需求。
    turnSourceText = next.human ? next.input.text : null
    hooks.onStatusChanged(true)
    try {
      await applyModelSelection()
      await ensureStarted()
      await bridge.sendMessage(sessionId, engineText(next.input, next.human), next.input.images)
    } catch (err) {
      // 投递失败：这一轮不算开始，输入留在队首等下一次泵送（不丢消息）。
      queue.unshift(next)
      turnInFlight = false
      hooks.onFailure(errorCode(err, 'engineLaunchFailed'))
      hooks.onStatusChanged(false)
    }
  }

  return {
    async message(input: SuperAgentRouterInput): Promise<void> {
      bridge.pushUserMessage({
        sessionId,
        content: input.displayText ?? input.text,
        title: hooks.titleOf?.() ?? 'Super Agent',
        projectPath: repoRoot,
        permissionMode: 'plan',
      })
      if (input.model !== undefined && input.model !== '' && input.model !== selectedModel) {
        selectedModel = input.model
      }
      queue.push({ input, human: true })
      await pump()
    },

    relay(text: string): void {
      queue.push({ input: { text }, human: false })
      void pump()
    },

    async abortTurn(): Promise<void> {
      if (!turnInFlight) return
      try {
        await bridge.abort(sessionId)
      } catch {
        // abort 失败仍按中止处理：状态收敛比细节重要，Worker 不受影响
      }
      turnInFlight = false
      hooks.onStatusChanged(false)
      void pump()
    },

    isRunning(): boolean {
      return turnInFlight
    },

    async settle(timeoutMs: number): Promise<boolean> {
      const deadline = Date.now() + timeoutMs
      while (turnInFlight) {
        if (Date.now() >= deadline) return false
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return true
    },

    dispose(): void {
      unsubscribe()
      queue.length = 0
      turnInFlight = false
    },
  }
}
