/**
 * RouterRunner：Router 会话改由主进程拥有（设计 §4.2、§6.3）。
 *
 * 之前 Router 就是渲染端的一条普通聊天：走 turnStore、带全套写文件工具，
 * 于是"让它做事它自己就做了"。这里把它挪回主进程，并钉住两件事：
 *
 * 1. **不能自己干活** —— `allowedTools: []` 把全部工具从引擎工具池移除（设计 §3.2
 *    第 2 条）：Router 只需要说话与路由围栏，看文件/跑命令是 Worker 的活。不能用
 *    plan 模式兼任这道闸门：plan 注入的"禁止后台动作、必须 ExitPlanMode"与文本路由
 *    协议冲突，模型会把宿主建单也误判成自己执行后台任务。
 * 2. **动手只能靠路由指令** —— 回复尾部的 ```super-agent:route 块由宿主解析：
 *    accept 逐条走 service.dispatch 落 Decision/Mandate，attach 落一张工单的
 *    人消息输入，retry 走 scheduler.retry 起新一代，stop 走停止命令；授权仍由
 *    领域生成，模型拿不到（设计 §8.4）。attach 与 retry 分家是有意的：前者只投
 *    消息、复用代次，后者才换代次，混成一个动词就会给人一个兑现不了的重跑。
 * 3. **人的原话不经过 Router 的手** —— 宿主保存需求原文和后续约束，直接带给 Worker；
 *    Router 的 \`note\` 只是路由旁注（≤30 字），没有转述的通道。
 *
 * 每项目同一时刻最多一轮：新到的中继说明排队到下一批，不并发写同一 stdin；
 * Router 不阻塞等 Worker —— 工单结果由 Executor 作为新输入投进会话尾部。
 */
import { randomUUID } from 'crypto'
import {
  SUPER_AGENT_ROUTE_REPAIR_PROMPT,
  SUPER_AGENT_ROUTER_ROLE_PROMPT,
  renderSuperAgentAttachedMessage,
} from './prompts'
import {
  findSuperAgentRouteBlocks,
  parseSuperAgentRouteText,
  type SuperAgentRouteAction,
} from './routerActions'
import { superAgentError } from './errors'
import { wrapSuperAgentHostContext } from '@/shared/promptEnvelope'
import type { SuperAgentEngineBridge } from './engineBridge'

export interface SuperAgentRouterDispatchInput {
  requestId: string
  title: string
  /** 宿主保存的人消息原文与后续约束，不接受 Router 改写目标。 */
  text: string
  /** Router 的路由说明（≤30 字，见 MAX_ROUTE_NOTE_CHARS）。 */
  note: string | null
  model?: string
}

export interface SuperAgentRouterSource {
  requestId: string
  text: string
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

export interface SuperAgentRouterRetryInput {
  requestId: string
  ticketId: string
}

/** 路由指令被领域拒绝：kind/ticketId/code 够人看清"哪条没执行、为什么"。 */
export interface SuperAgentRouterRouteRejection {
  kind: SuperAgentRouteAction['kind']
  ticketId: string | null
  code: string
  /** 本轮有没有人的原话可带；中继轮的拒绝不再回灌，避免自我循环。 */
  humanTurn: boolean
}

export interface SuperAgentRouterRunnerOptions {
  repoRoot: string
  sessionId: string
  /**
   * route 幂等键的实例判别量，缺省取一个随机 id。
   *
   * sessionId 跨重启稳定、turnSeq 每个实例从 1 重新数，两者拼出来的键在重启后
   * 会与重启前那一轮撞上：领域侧把重复解析当幂等回放，`assertSameFact` 载荷不同
   * 就直接抛 conflict，于是每次重启后的第一轮路由动作凭空消失。加一层实例号后，
   * 键只在同一实例内重复（那才是它要防的"同一回复解析两次"）。
   */
  runnerEpoch?: string
  /** 引擎接缝（生产注入真实通路；测试注入 fake）。 */
  bridge: SuperAgentEngineBridge
  hooks: {
    /** 建单派工：幂等键由本轮 turn 序号派生，重复解析同一回复不会重复建单。 */
    dispatch(input: SuperAgentRouterDispatchInput): { ticketId: string }
    /** 把这轮人的原话挂到已有工单：与「继续追问」同一条投递路径。 */
    attach(input: SuperAgentRouterAttachInput): void
    /** 让一张 open 但已失败的工单以新一代重跑：复用同一个 Worker 会话，代次 +1。 */
    retry(input: SuperAgentRouterRetryInput): void
    /** 停一张工单：只有人明确要求停止时 Router 才会给出这条指令。 */
    stop(input: SuperAgentRouterStopInput): void
    /** 运行状态变化：service 据此更新快照 router.running 并广播。 */
    onStatusChanged(running: boolean): void
    /** 路由协议失败/引擎失败：计入健康，不打断人正在看的回复。 */
    onFailure(code: string): void
    /**
     * 路由指令被领域拒绝：除计入健康外，把"这条没执行"作为事实回灌给 Router，
     * 让它向人如实交代。宿主没动手却没人知道，人听到的就是一句兑现不了的承诺。
     */
    onRouteRejected?(info: SuperAgentRouterRouteRejection): void
    /** 会话标题（渲染端会话名）。 */
    titleOf?(): string
    /**
     * 活跃工单索引（设计 §8.1）：每轮追加到人消息尾部的一次性事实。
     * 返回空串表示本轮不注入。不放 system 说明 —— 那会打没前缀缓存。
     */
    statusContext?(): string
    sourceRequests?(requestId: string): SuperAgentRouterSource[]
  }
}

/** 待投递的一轮输入：正文 + 给人看的气泡文本 + 图片附件。 */
export interface SuperAgentRouterInput {
  requestId?: string
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
  const epoch = options.runnerEpoch ?? randomUUID()

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
  let turnSources: SuperAgentRouterSource[] = []
  /** 用户在输入框选中的模型（显示名）；null = 没选过，沿用设置页槽位。 */
  let selectedModel: string | null = null
  /** 已经落到当前这条会话上的模型选择；与 selectedModel 不一致才需要动作。 */
  let appliedModel: string | null = null
  /** 当前人的轮次是否已要求补一次路由；中继轮不补，单个轮次最多补一次。 */
  let routeRepairSent = false

  const routerConfig = () => {
    const base = bridge.loadConfig(repoRoot)
    return {
      ...base,
      cwd: repoRoot,
      permissionMode: 'default' as const,
      appendSystemPrompt: SUPER_AGENT_ROUTER_ROLE_PROMPT,
      // 全部工具移除：Router 只说话不出手（见文件头第 1 条）。引擎收到 --tools ""。
      allowedTools: [],
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
   * 会话还没起 → 由 routerConfig 带进 spawn。已经活着 → 停掉重拉，不发 set_model
   * 控制请求：别名（haiku/sonnet/opus）由引擎在**自己进程内**解析，读的是 spawn
   * 时从 settings.json 拿到的 ANTHROPIC_DEFAULT_*_MODEL，而槽位配置往往是进程起来
   * 之后才同步进去的 —— 控制请求会拿旧环境解析，选了 A 跑的还是 B，且请求本身
   * "成功"、无从察觉。停掉重拉走冷启动，引擎重读 settings.json，与主聊天切换
   * 失败的重启回退是同一条路径。
   */
  async function applyModelSelection(): Promise<void> {
    if (!started || selectedModel === null || appliedModel === selectedModel) return
    await bridge.stop(sessionId).catch(() => undefined)
    started = false
    appliedModel = null
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
    const sourceText = turnSourceText
    routes.forEach((route, index) => {
      const requestId = `route:${sessionId}:${epoch}:${seq}:${index}`
      try {
        if (route.kind === 'accept') {
          if (sourceText === null) throw superAgentError('routeInvalid', { field: 'sourceRequestId' })
          let goal = sourceText
          if (route.sourceRequestId) {
            const sourceIndex = turnSources.findIndex((source) => source.requestId === route.sourceRequestId)
            if (sourceIndex < 0) throw superAgentError('routeInvalid', { field: 'sourceRequestId' })
            const source = turnSources[sourceIndex]!
            const followups = turnSources.slice(sourceIndex + 1)
            goal = source.text
            if (followups.length) {
              goal += `\n\n## 后续人消息（按时间排序，保留补充、撤回与范围约束）\n\n${JSON.stringify(followups)}`
            }
          } else if (turnSources.length > 1) {
            goal = `本轮人消息：\n\n${sourceText}\n\n## 前文人消息（按时间排序，仅供核对任务来源）\n\n${JSON.stringify(turnSources.slice(0, -1))}\n\n这不是执行全部历史需求的清单。本轮明确的新任务只按本轮执行；续接任务须核对人的原话与后续撤回、暂停和范围约束，不得重复已派发的任务。问候不构成新的执行授权，任务归属不明确时先提问。`
          }
          hooks.dispatch({
            requestId,
            title: route.title,
            text: goal,
            note: route.note,
            model: selectedModel ?? undefined,
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
        } else if (route.kind === 'retry') {
          hooks.retry({ requestId, ticketId: route.ticketId })
        } else if (route.kind === 'stop') {
          hooks.stop({ requestId, ticketId: route.ticketId, note: route.note })
        }
        // ignore 是"什么都不做"的显式记录：领域侧没有对应动作，也不该有。
      } catch (err) {
        const code = errorCode(err, 'invalidDispatch')
        hooks.onFailure(code)
        // 指令被领域拒绝时除累计健康外，还要把"这条没执行"作为事实送回会话尾部：
        // 否则人听到的永远是 Router 按自己承诺编出来的进展。
        hooks.onRouteRejected?.({
          kind: route.kind,
          ticketId: 'ticketId' in route ? route.ticketId : null,
          code,
          humanTurn: sourceText !== null,
        })
      }
    })
  }

  async function repairRoute(): Promise<void> {
    const repairTurn = turnSeq
    try {
      await bridge.sendMessage(sessionId, wrapSuperAgentHostContext([SUPER_AGENT_ROUTE_REPAIR_PROMPT]))
    } catch (err) {
      // 中止后可能已经开始下一轮，迟到的补正失败不能收敛掉新轮次。
      if (repairTurn !== turnSeq || !turnInFlight) return
      turnInFlight = false
      hooks.onFailure(errorCode(err, 'engineLaunchFailed'))
      hooks.onStatusChanged(false)
      void pump()
    }
  }

  const unsubscribe = bridge.onRouteEvent((sid, eventType, data) => {
    if (sid !== sessionId) return
    if (eventType === 'result') {
      const text = resultText(data)
      const missingRoute = turnSourceText !== null && findSuperAgentRouteBlocks(text).length === 0
      if (missingRoute && !routeRepairSent) {
        routeRepairSent = true
        void repairRoute()
        return
      }
      turnInFlight = false
      if (missingRoute) hooks.onFailure('routeMissing')
      settleRoute(text)
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
   * 交给引擎的正文：原文 + 宿主注入段（Router 契约 + 本轮的活跃工单索引）。
   *
   * 安装版 CLI 的 --resume 会复用历史 prompt snapshot，argv/initialize 的新 append
   * 都进不了 API 请求（本地假上游实测）。契约必须随人的轮次追加到会话尾部，旧
   * 普通聊天恢复成 Router 后才能看到。它们只进引擎输入，不进气泡。
   *
   * 注入段一律包在成对标记里：引擎转录按 type:'user' 记下整段正文，回放时
   * parseEngineUserPrompt 靠这对标记把它摘掉，人重启后看到的还是自己打的那句。
   */
  function engineText(input: SuperAgentRouterInput, human: boolean): string {
    if (!human) return wrapSuperAgentHostContext([input.text])
    const sources = turnSources.length
      ? `[人消息索引]\n${JSON.stringify(turnSources.map((source) => ({
          requestId: source.requestId,
          preview: source.text.slice(0, 160),
        })))}\n引用前文任务时填写 sourceRequestId；宿主会取完整原话并保留后续约束，不要用标题或旁注改写目标。`
      : ''
    const hostContext = wrapSuperAgentHostContext([
      SUPER_AGENT_ROUTER_ROLE_PROMPT,
      hooks.statusContext?.() ?? '',
      sources,
    ])
    return [input.text, hostContext].filter(Boolean).join('\n\n')
  }

  async function pump(): Promise<void> {
    if (turnInFlight || queue.length === 0) return
    const next = queue.shift()
    if (next === undefined) return
    turnInFlight = true
    turnSeq += 1
    routeRepairSent = false
    // 这一轮的目标正文只可能在"人在问话"时存在；中继轮带的是工单事实，不是需求。
    turnSourceText = next.human ? next.input.text : null
    turnSources = next.human && next.input.requestId
      ? hooks.sourceRequests?.(next.input.requestId) ?? []
      : []
    if (next.input.model) selectedModel = next.input.model
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
        permissionMode: 'default',
      })
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
