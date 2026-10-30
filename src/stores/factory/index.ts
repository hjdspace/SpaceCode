/**
 * Factory（AI 流水线）renderer store — 状态、初始化向导与预检的薄编排层。
 *
 * 所有判定与落盘都在主进程完成；这里只保存 UI 需要的快照，
 * 并把「能不能进入下一步」委托给纯逻辑模块 setup.ts。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/services/electronAPI'
import type {
  FactoryBacklogInput,
  FactoryBacklogItem,
  FactoryBacklogResult,
  FactoryBacklogUpdate,
  FactoryConfig,
  FactoryConfigSaveError,
  FactoryEvent,
  FactoryEventPush,
  FactoryGhLoginResult,
  FactoryGithubAuthResult,
  FactoryGithubClaimFailure,
  FactoryGithubClaimResult,
  FactoryGithubFailureReason,
  FactoryGithubIssue,
  FactoryGithubListInput,
  FactoryGithubWritebackRetryResult,
  FactoryMergeExecuteInput,
  FactoryMergeMode,
  FactoryMergePreflight,
  FactoryMergeResult,
  FactoryGithubRepo,
  FactoryPlanError,
  FactoryPlanResult,
  FactoryPreflightResult,
  FactoryReviewCommentInput,
  FactoryRun,
  FactoryRunControlResult,
  FactoryRunCreateError,
  FactoryRunSnapshot,
  FactoryRunStopResult,
  FactorySetupContext,
  FactorySetupDraft,
  FactoryStageConfig,
  FactoryStageKey,
  FactoryStorageState,
  FactoryTask,
  FactoryTaskActionResult,
  FactoryTaskRetryInput,
  FactoryTaskStartInput,
  FactoryTaskStartResult,
  FactoryTakeoverResult,
  FactoryReturnResult,
} from '@/shared/factory'
import { FACTORY_RUN_TAB_LIMIT } from '@/shared/factory'
import { mergeEligibility, type MergeEligibility } from '@/shared/factoryReview'
import {
  canAdvance,
  canJumpToStep,
  defaultDraft,
  draftFromConfig,
  setupStepErrors,
  type SetupStep,
} from './setup'
import { findTask, isTakenOver, laneCounts as computeLaneCounts, type FactoryInspectorTab } from './board'

export interface FactoryRunError {
  code: FactoryRunCreateError | 'create-failed'
  params?: Record<string, string | number>
}

/** 启动/停止类动作的失败码；渲染层用 factory.errors.* 翻译。 */
export interface FactoryActionError {
  code: string
  detail?: string
}

/** GitHub 操作失败：reason 交给 factory.github.errors.* 翻译。 */
export interface FactoryGithubActionError {
  reason:
    | FactoryGithubFailureReason
    | 'no-selection'
    | 'duplicate-issues'
    | 'all-failed'
    | 'partial-failed'
    | 'config-missing'
    | 'task-not-found'
    | 'not-github'
    | 'not-merged'
    | 'not-applicable'
  failed?: FactoryGithubClaimFailure[]
  detail?: string
}

/** 配置弹窗编辑副本：只深克隆会被改动的结构，避免把整份配置扩散成公共工具。 */
function cloneConfig(input: FactoryConfig): FactoryConfig {
  return {
    ...input,
    repo: { ...input.repo },
    agent: { ...input.agent },
    sandbox: { ...input.sandbox },
    tracker: { ...input.tracker },
    stages: {
      plan: { ...input.stages.plan },
      implement: { ...input.stages.implement },
      verify: { ...input.stages.verify },
      review: { ...input.stages.review },
      merge: { ...input.stages.merge },
    },
    commands: { ...input.commands },
    prompts: { ...input.prompts },
    limits: { ...input.limits },
  }
}

/**
 * 送进 IPC 前必须剥掉 Vue 的响应式 Proxy：上下文桥的结构化克隆遇到 Proxy
 * 会直接抛 “An object could not be cloned”。草稿与配置都只包含可 JSON 化的值。
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 登录轮询间隔：`gh auth status` 单次可能耗时数秒，间隔不能小于它。 */
const GH_LOGIN_POLL_INTERVAL_MS = 3000
/** 授权流程（用户在浏览器里操作）的最长存活时间。 */
const GH_LOGIN_POLL_TIMEOUT_MS = 5 * 60_000

export const useFactoryStore = defineStore('factory', () => {
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const configured = ref(false)
  const config = ref<FactoryConfig | null>(null)
  const configPath = ref('')
  /** 运行目录的只读/损坏状态；只读时所有推进动作在主进程侧也会被拒绝。 */
  const storage = ref<FactoryStorageState | null>(null)
  const context = ref<FactorySetupContext | null>(null)
  const preflight = ref<FactoryPreflightResult | null>(null)
  const preflightRunning = ref(false)
  const preflightError = ref<string | null>(null)

  const wizardOpen = ref(false)
  /** 保存成功后整页向导停在就绪页；回到看板即收起。 */
  const wizardDone = ref(false)
  /** 向导由配置弹窗的「重新初始化」进入：取消时回到弹窗，而不是看板。 */
  const wizardFromConfig = ref(false)
  const step = ref<SetupStep>(1)
  const draft = ref<FactorySetupDraft>({})
  const saving = ref(false)
  const saveError = ref<string | null>(null)
  /** GitHub 仓库下拉（按当前鉴权方式拉取）；失败时退回手填。 */
  const githubRepos = ref<FactoryGithubRepo[]>([])
  const githubReposLoading = ref(false)
  const githubReposError = ref<FactoryGithubFailureReason | null>(null)

  const tokenTesting = ref(false)
  const tokenResult = ref<FactoryGithubAuthResult | null>(null)
  /**
   * 第 3 步里刚敲进去、还没落进凭据库的 token。跟着向导会话走：
   * 关页签回来不用重敲，保存成功（已写入凭据库）后立刻丢弃。
   */
  const wizardToken = ref('')
  const ghChecking = ref(false)
  const ghLogin = ref<{ running: boolean; code?: string; url?: string; error?: string }>({ running: false })
  /** 下一次轮询的定时器；串行链上只有一枚。 */
  let ghLoginPoll: ReturnType<typeof setTimeout> | null = null
  /** 每次启动/停止递增：旧的轮询链看到序号变了就自行退出。 */
  let ghLoginPollEpoch = 0
  /** 正在飞的登录态探测：并发调用共享同一次 `gh auth status`。 */
  let ghAuthCheck: Promise<boolean> | null = null

  // 看板：本地待办 + 当前运行投影 + 检查器选中
  const backlog = ref<FactoryBacklogItem[]>([])
  const backlogLoading = ref(false)
  const backlogError = ref<string | null>(null)

  const run = ref<FactoryRun | null>(null)
  const tasks = ref<FactoryTask[]>([])
  /** 页签条：最近打开的运行，创建时间倒序。关闭只从视图移除，不删磁盘。 */
  const runTabs = ref<FactoryRun[]>([])
  const runLoading = ref(false)
  const runError = ref<string | null>(null)

  // GitHub 任务源：列表、标签过滤与批量领取
  const githubIssues = ref<FactoryGithubIssue[]>([])
  const githubIssuesLoading = ref(false)
  const githubIssuesError = ref<FactoryGithubActionError | null>(null)
  const githubLabel = ref('')
  const githubClaiming = ref(false)
  const githubClaimError = ref<FactoryGithubActionError | null>(null)
  const retryingWritebackId = ref<string | null>(null)
  const writebackError = ref<FactoryGithubActionError | null>(null)

  const selectedId = ref<string | null>(null)
  const inspectorTab = ref<FactoryInspectorTab>('overview')
  /** 收起只影响展示：选中项保留，重新选任务即展开。 */
  const inspectorOpen = ref(true)

  const creatingRun = ref(false)
  const createRunError = ref<FactoryRunError | null>(null)
  const planning = ref(false)
  const planError = ref<FactoryPlanError | null>(null)

  // 运行控制：暂停/恢复与配置弹窗；保存时带 revision 做乐观并发
  const pausing = ref(false)
  const configOpen = ref(false)
  const configDraft = ref<FactoryConfig | null>(null)
  const configSaving = ref(false)
  const configError = ref<FactoryConfigSaveError['error'] | null>(null)
  const configFieldErrors = ref<string[]>([])
  const configConflictRevision = ref<number | null>(null)
  /** 关闭合并人工闸门时的显式确认；首次保存会收到 confirm-required。 */
  const configConfirmGateOff = ref(false)

  // 实现阶段：事件流按任务缓存，seq 单调去重；动作错误交给检查器展示
  const eventsByTask = ref<Record<string, FactoryEvent[]>>({})
  const runEvents = ref<FactoryEvent[]>([])
  const eventsLoading = ref(false)
  const eventsError = ref<string | null>(null)
  const actionError = ref<FactoryActionError | null>(null)
  const startingId = ref<string | null>(null)
  const stopping = ref(false)
  const cancelling = ref(false)
  const pendingDirtyId = ref<string | null>(null)
  // 接管/交回/重试：各自的重入保护，避免重复点击并发调用
  const takingOver = ref(false)
  const returning = ref(false)
  const retrying = ref(false)
  /**
   * 看板内接管面板的目标任务。面板只在任务仍为接管中时出现，
   * 所以关闭它只是清掉这个 id —— 交回成功或被别的窗口结束接管都会自然收起。
   */
  const takeoverPanelTaskId = ref<string | null>(null)
  /** 交回时重跑验证没过：面板保持打开并说明原因，下一次打开面板或接管别的任务时清掉。 */
  const takeoverVerifyFailed = ref(false)

  // 审查阶段：批准/要求修改/修复与意见处理各自的重入保护
  const approving = ref(false)
  const fixing = ref(false)
  const updatingComment = ref(false)
  /** 忽略阻塞级意见时的二次确认目标。 */
  const pendingIgnoreId = ref<string | null>(null)

  // 合并闸门：弹窗打开即跑一次只读预检；勾选「已审查 diff」才允许提交
  const mergeOpen = ref(false)
  const mergeTaskId = ref<string | null>(null)
  const mergeMode = ref<FactoryMergeMode>('merge')
  const mergeConfirmed = ref(false)
  const mergeChecking = ref(false)
  const mergePreflight = ref<FactoryMergePreflight | null>(null)
  const mergeError = ref<FactoryActionError | null>(null)
  const merging = ref(false)

  const seenEventSeqs = new Set<string>()
  let unsubscribeEvents: (() => void) | null = null
  let subscribedRoot: string | null = null
  /** 切页签的请求令牌：慢返回的旧快照不能覆盖新选中的运行。 */
  let runRequest = 0

  /** 事件缓存按「运行 + 任务」隔离：同一条待办可能被多次运行领取。 */
  function eventKey(runId: string, taskId: string): string {
    return `${runId}:${taskId}`
  }

  const selectedTask = computed(() => findTask(tasks.value, selectedId.value))
  const takeoverPanelTask = computed(() => {
    const target = findTask(tasks.value, takeoverPanelTaskId.value)
    return target && isTakenOver(target) ? target : null
  })
  const laneCounts = computed(() => computeLaneCounts(tasks.value))
  const selectedEvents = computed(() => {
    const runId = run.value?.id
    const taskId = selectedId.value
    if (!runId || !taskId) return []
    return eventsByTask.value[eventKey(runId, taskId)] ?? []
  })
  const hasCommits = computed(() => (selectedTask.value?.commits?.length ?? 0) > 0)
  /** 批准按钮的资格：测试通过 + 审查通过 + 无未决阻塞意见。 */
  const selectedEligibility = computed<MergeEligibility>(() =>
    selectedTask.value ? mergeEligibility(selectedTask.value) : { ok: false, reasons: [] },
  )

  /**
   * 合并按钮：预检无致命项 + 已勾选审查确认 + 没有正在执行的预检/合并。
   * 预检尚未返回时也视为有阻塞，避免用户在没看预检前就点合并。
   */
  const mergeHasBlockers = computed(() => {
    const preflight = mergePreflight.value
    return preflight ? preflight.blockers.length > 0 : true
  })
  const canConfirmMerge = computed(
    () => mergeConfirmed.value && !mergeChecking.value && !merging.value && !mergeHasBlockers.value,
  )
  const mergeTarget = computed(
    () => mergePreflight.value?.targetBranch ?? config.value?.repo.baseBranch ?? 'main',
  )

  const boardReady = computed(() => configured.value && config.value !== null)
  /** 第二个窗口/进程拿不到写锁时为 true；看板只读并给出提示。 */
  const readonly = computed(() => storage.value !== null && !storage.value.writable)
  const corruptRuns = computed(() => storage.value?.corrupt ?? [])

  const stepErrors = computed(() => {
    if (!context.value) return []
    return setupStepErrors(step.value, draft.value, context.value)
  })

  const canGoNext = computed(() => {
    if (!context.value) return false
    return canAdvance(step.value, draft.value, context.value)
  })

  const blocking = computed(() => preflight.value?.blocking ?? true)

  async function loadState(root: string): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const state = await api.factory.state(root)
      configured.value = state.configured
      config.value = state.config
      configPath.value = state.configPath
      storage.value = state.storage ?? null
      loaded.value = true
    } catch (err) {
      error.value = String(err)
    } finally {
      loading.value = false
    }
  }

  async function loadContext(root: string): Promise<void> {
    try {
      context.value = await api.factory.context(root)
    } catch (err) {
      error.value = String(err)
    }
  }

  async function refresh(root: string): Promise<void> {
    await Promise.all([loadState(root), loadContext(root)])
  }

  /**
   * 打开整页向导。默认接着上次的草稿；`fresh` 给配置弹窗的「重新初始化」用：
   * 丢掉残留草稿，按磁盘上的配置从第 1 步重新回填。
   */
  async function openWizard(root: string, options: { fresh?: boolean } = {}): Promise<void> {
    saveError.value = null
    tokenResult.value = null
    preflight.value = null
    preflightError.value = null
    ghLogin.value = { running: false }
    // gh 登录态必须在打开这一刻重新确认。context 是页面挂载时的快照，
    // 期间在终端登录/退出、token 失效都反映不过来，界面会一直停在旧状态，
    // 只能靠手动刷新才发现。
    if (context.value) void checkGhAuth()
    // 上次的草稿还在（关页签回看过板）就接着用它；全新会话才回填磁盘上的配置。
    if (!options.fresh && Object.keys(draft.value).length > 0) {
      wizardOpen.value = true
      if (step.value === 4) await runPreflight(root)
      return
    }
    step.value = 1
    if (!context.value) await loadContext(root)
    const ctx = context.value
    if (!ctx) return
    draft.value = ctx.existingConfig ? draftFromConfig(ctx.existingConfig) : defaultDraft(ctx)
    wizardOpen.value = true
  }

  function closeWizard(): void {
    wizardOpen.value = false
    wizardDone.value = false
    wizardFromConfig.value = false
    saveError.value = null
    stopGhLoginPolling()
    ghLogin.value = { running: false }
  }

  /**
   * 配置弹窗的「重新初始化」：从第 1 步重走向导，草稿按磁盘上的配置重新回填，
   * 上次会话残留的草稿不参与。配置草稿保留，取消时回到弹窗还能接着改。
   */
  async function restartWizard(root: string): Promise<void> {
    await openWizard(root, { fresh: true })
    // 上下文缺失时向导不会打开：配置弹窗保持原样，别把用户留在空界面。
    if (!wizardOpen.value) return
    wizardFromConfig.value = true
    configOpen.value = false
  }

  /** 向导的取消口径：从配置弹窗进来的回到弹窗，否则收回看板。 */
  function cancelWizard(): void {
    const backToConfig = wizardFromConfig.value && configDraft.value !== null
    closeWizard()
    if (backToConfig) configOpen.value = true
  }

  /**
   * 每一次预检的序号。改一次验证命令就重跑一次，两条 IPC 会在路上重叠，
   * 而慢的那条对应的是已经作废的草稿：只允许最新一次写结果，否则旧响应
   * 后落地会把「完成配置」重新顶开。
   */
  let preflightEpoch = 0

  async function runPreflight(root: string): Promise<void> {
    const epoch = ++preflightEpoch
    preflightRunning.value = true
    preflightError.value = null
    try {
      const result = await api.factory.preflight(root, toPlain(draft.value))
      if (epoch !== preflightEpoch) return
      preflight.value = result
    } catch (err) {
      if (epoch !== preflightEpoch) return
      preflight.value = null
      preflightError.value = String(err)
    } finally {
      // 过期的那一次不许关掉还在飞的新一轮的进度标记。
      if (epoch === preflightEpoch) preflightRunning.value = false
    }
  }

  /** 按当前鉴权方式拉取 GitHub 仓库；token 为空时由主进程回退到已保存的凭据。 */
  async function loadGithubRepos(source: 'gh' | 'token', token?: string): Promise<void> {
    githubReposLoading.value = true
    try {
      const result = await api.factory.githubRepos(source, token)
      if (result.ok) {
        githubRepos.value = result.repos
        githubReposError.value = null
      } else {
        githubRepos.value = []
        githubReposError.value = result.reason
      }
    } catch {
      githubRepos.value = []
      githubReposError.value = 'network'
    } finally {
      githubReposLoading.value = false
    }
  }

  async function next(root: string): Promise<void> {
    if (!canGoNext.value) return
    if (step.value < 4) {
      step.value = (step.value + 1) as SetupStep
      if (step.value === 4) await runPreflight(root)
    }
  }

  function back(): void {
    if (step.value > 1) step.value = (step.value - 1) as SetupStep
  }

  /** 步骤条直接跳步：越过校验没过的步骤要挡住，落到第 4 步补跑预检。 */
  async function goToStep(target: SetupStep, root: string): Promise<void> {
    if (target === step.value || !context.value) return
    if (!canJumpToStep(target, draft.value, context.value)) return
    step.value = target
    if (target === 4) await runPreflight(root)
  }

  async function save(root: string): Promise<boolean> {
    saving.value = true
    saveError.value = null
    try {
      const result = await api.factory.save(root, toPlain(draft.value))
      if (!result.ok) {
        saveError.value = result.error ?? 'write-failed'
        if (result.preflight) preflight.value = result.preflight
        return false
      }
      wizardDone.value = true
      wizardToken.value = ''
      await loadState(root)
      return true
    } finally {
      saving.value = false
    }
  }

  async function testToken(root: string, token: string, repo: string, label?: string): Promise<void> {
    tokenTesting.value = true
    try {
      tokenResult.value = await api.factory.testGithubToken(root, token, repo, label)
      if (!tokenResult.value.ok) return
      await storeToken(token)
      // token 有效即可列出它可访问的仓库，向导仓库下拉不再依赖已打开项目。
      await loadGithubRepos('token', token)
    } finally {
      tokenTesting.value = false
    }
  }

  async function storeToken(token: string): Promise<boolean> {
    const result = await api.factory.saveGithubToken(token)
    if (!result.ok) {
      saveError.value = result.reason
      return false
    }
    return true
  }

  /**
   * 探测 `gh` 登录态。并发调用共享同一次 IPC：`gh auth status` 超时时若每次都
   * 新起一个，几秒内的轮询会堆出多个 gh 子进程，内存随之放大。
   */
  function startGhAuthCheck(): Promise<boolean> {
    return Promise.resolve()
      .then(() => api.factory.checkGhAuth())
      .then((result: FactoryGithubAuthResult) => {
        // 只在登录态真的变了才替换 context：每次无脑换对象会让下游依赖
        // context 的 watch/computed 每轮都重算。
        if (context.value && context.value.ghLoggedIn !== result.ok) {
          context.value = { ...context.value, ghLoggedIn: result.ok }
        }
        if (result.ok) {
          stopGhLoginPolling()
          ghLogin.value = { running: false }
        }
        return result.ok
      })
      .catch(() => false)
      .finally(() => {
        ghAuthCheck = null
      })
  }

  async function checkGhAuth(options: { quiet?: boolean } = {}): Promise<boolean> {
    if (!options.quiet) ghChecking.value = true
    try {
      ghAuthCheck ??= startGhAuthCheck()
      return await ghAuthCheck
    } finally {
      if (!options.quiet) ghChecking.value = false
    }
  }

  function stopGhLoginPolling(): void {
    ghLoginPollEpoch++
    if (ghLoginPoll) clearTimeout(ghLoginPoll)
    ghLoginPoll = null
  }

  /**
   * 发起 `gh auth login --web`：主进程返回浏览器里要输入的一次性代码，
   * 之后轮询登录状态，授权完成即收尾。
   *
   * 轮询用「上一次返回后才排下一次」的串行链，而不是固定间隔的 setInterval：
   * `gh auth status` 单次可达 10s，固定间隔会在它还没返回时再叠一次，进程越堆越多。
   */
  async function startGhLogin(): Promise<void> {
    if (ghLogin.value.running) return
    ghLogin.value = { running: true }
    let result: FactoryGhLoginResult
    try {
      result = await api.factory.startGhLogin()
    } catch {
      ghLogin.value = { running: false, error: 'unknown' }
      return
    }
    if (!result.ok) {
      ghLogin.value = { running: false, error: result.reason }
      return
    }
    ghLogin.value = {
      running: true,
      ...(result.code ? { code: result.code } : {}),
      ...(result.url ? { url: result.url } : {}),
    }
    stopGhLoginPolling()
    const epoch = ghLoginPollEpoch
    const startedAt = Date.now()
    const tick = async (): Promise<void> => {
      if (epoch !== ghLoginPollEpoch) return
      if (Date.now() - startedAt > GH_LOGIN_POLL_TIMEOUT_MS) {
        stopGhLoginPolling()
        ghLogin.value = { running: false, error: 'timeout' }
        return
      }
      if (await checkGhAuth({ quiet: true })) return
      // 探测期间可能已经关闭向导/重新发起登录，过期的链不再续命。
      if (epoch !== ghLoginPollEpoch) return
      ghLoginPoll = setTimeout(() => void tick(), GH_LOGIN_POLL_INTERVAL_MS)
    }
    ghLoginPoll = setTimeout(() => void tick(), GH_LOGIN_POLL_INTERVAL_MS)
  }

  async function loadBacklog(root: string): Promise<void> {
    backlogLoading.value = true
    backlogError.value = null
    try {
      backlog.value = await api.factory.backlogList(root)
    } catch {
      backlogError.value = 'load-failed'
    } finally {
      backlogLoading.value = false
    }
  }

  async function applyBacklogMutation(pending: Promise<FactoryBacklogResult>): Promise<boolean> {
    try {
      const result = await pending
      backlog.value = result.items
      if (!result.ok) {
        backlogError.value = result.error
        return false
      }
      backlogError.value = null
      return true
    } catch {
      backlogError.value = 'write-failed'
      return false
    }
  }

  function createBacklogTask(root: string, input: FactoryBacklogInput): Promise<boolean> {
    return applyBacklogMutation(api.factory.backlogCreate(root, input))
  }

  function updateBacklogTask(root: string, input: FactoryBacklogUpdate): Promise<boolean> {
    return applyBacklogMutation(api.factory.backlogUpdate(root, input))
  }

  function deleteBacklogTask(root: string, id: string): Promise<boolean> {
    return applyBacklogMutation(api.factory.backlogDelete(root, id))
  }

  function moveBacklogTask(root: string, id: string, direction: 'up' | 'down'): Promise<boolean> {
    return applyBacklogMutation(api.factory.backlogMove(root, id, direction))
  }

  async function loadGithubIssues(
    root: string,
    input: FactoryGithubListInput = {},
  ): Promise<void> {
    githubIssuesLoading.value = true
    githubIssuesError.value = null
    try {
      const result = await api.factory.githubIssues(root, {
        ...(githubLabel.value.trim() ? { label: githubLabel.value.trim() } : {}),
        ...input,
      })
      if (result.ok) {
        githubIssues.value = result.issues
      } else {
        githubIssues.value = []
        githubIssuesError.value = {
          reason: result.reason,
          ...(result.detail ? { detail: result.detail } : {}),
        }
      }
    } catch {
      githubIssues.value = []
      githubIssuesError.value = { reason: 'network' }
    } finally {
      githubIssuesLoading.value = false
    }
  }

  async function claimGithubIssues(
    root: string,
    issueNumbers: number[],
    concurrency?: number,
    dependencies?: Record<string, string[]>,
  ): Promise<boolean> {
    githubClaiming.value = true
    githubClaimError.value = null
    try {
      const result: FactoryGithubClaimResult = await api.factory.githubClaim(root, {
        issueNumbers,
        ...(concurrency === undefined ? {} : { concurrency }),
        ...(dependencies === undefined ? {} : { dependencies }),
      })
      if (!result.ok) {
        githubClaimError.value = {
          reason: result.reason,
          ...(result.failed ? { failed: result.failed } : {}),
          ...(result.detail ? { detail: result.detail } : {}),
        }
        return false
      }
      upsertRunTab(result.snapshot.run)
      applySnapshot(result.snapshot)
      const claimed = new Set(result.claimed)
      githubIssues.value = githubIssues.value.map((issue) =>
        claimed.has(issue.number) ? { ...issue, claimed: true } : issue,
      )
      if (result.failed.length > 0) {
        githubClaimError.value = { reason: 'partial-failed', failed: result.failed }
      }
      return true
    } catch {
      githubClaimError.value = { reason: 'network' }
      return false
    } finally {
      githubClaiming.value = false
    }
  }

  async function retryGithubWriteback(
    root: string,
    runId: string,
    taskId: string,
  ): Promise<boolean> {
    retryingWritebackId.value = taskId
    writebackError.value = null
    try {
      const result: FactoryGithubWritebackRetryResult = await api.factory.githubRetryWriteback(
        root,
        runId,
        taskId,
      )
      if (result.ok) {
        applyActionSnapshot(result.snapshot)
        return true
      }
      writebackError.value = { reason: result.reason }
      return false
    } catch {
      writebackError.value = { reason: 'network' }
      return false
    } finally {
      retryingWritebackId.value = null
    }
  }

  function setGithubLabel(label: string): void {
    githubLabel.value = label
  }

  /** 选中项按仓库持久化：重启后恢复上次查看的任务，与事件流保持一致。 */
  let boardRoot: string | null = null
  function selectionKey(root: string): string {
    return `factory:selected:${root}`
  }
  function readPersistedSelection(root: string): string | null {
    try {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(selectionKey(root))
    } catch {
      return null
    }
  }
  function persistSelection(id: string | null): void {
    if (!boardRoot || typeof localStorage === 'undefined') return
    try {
      if (id) localStorage.setItem(selectionKey(boardRoot), id)
      else localStorage.removeItem(selectionKey(boardRoot))
    } catch {
      // 存储不可用时只是丢失恢复能力，不影响看板本身。
    }
  }

  function mergeRunTab(list: FactoryRun[], next: FactoryRun): FactoryRun[] {
    return list.map((item) => (item.id === next.id ? { ...item, ...next } : item))
  }

  /** 页签摘要跟随运行快照更新；不在页签条里的运行不会被推送拉进来。 */
  function syncRunTab(next: FactoryRun): void {
    if (!runTabs.value.some((item) => item.id === next.id)) return
    runTabs.value = mergeRunTab(runTabs.value, next)
  }

  function upsertRunTab(next: FactoryRun): void {
    if (!runTabs.value.some((item) => item.id === next.id)) {
      runTabs.value = [next, ...runTabs.value].slice(0, FACTORY_RUN_TAB_LIMIT)
      return
    }
    runTabs.value = mergeRunTab(runTabs.value, next)
  }

  /** 选中项、检查器与合并弹窗都属于某一次运行；切运行前先整体复位。 */
  function clearRunScopedState(): void {
    selectedId.value = null
    inspectorTab.value = 'overview'
    inspectorOpen.value = true
    actionError.value = null
    pendingDirtyId.value = null
    pendingIgnoreId.value = null
    writebackError.value = null
    startingId.value = null
    retryingWritebackId.value = null
    updatingComment.value = false
    eventsError.value = null
    runEvents.value = []
    mergeOpen.value = false
    mergeTaskId.value = null
    mergePreflight.value = null
    mergeError.value = null
    takeoverPanelTaskId.value = null
    takeoverVerifyFailed.value = false
  }

  function applySnapshot(snapshot: FactoryRunSnapshot | null): void {
    const previousRunId = run.value?.id ?? null
    const nextRunId = snapshot?.run.id ?? null
    // 同一条待办可能出现在多个运行里：换了运行就重新选，不能沿用旧选中项。
    const switched = previousRunId !== null && nextRunId !== previousRunId
    if (switched) clearRunScopedState()

    run.value = snapshot?.run ?? null
    tasks.value = snapshot?.tasks ?? []
    if (run.value) syncRunTab(run.value)

    if (switched || !findTask(tasks.value, selectedId.value)) {
      const persisted = !switched && boardRoot ? readPersistedSelection(boardRoot) : null
      const restored = findTask(tasks.value, persisted)
      selectedId.value = restored?.id ?? tasks.value[0]?.id ?? null
      inspectorTab.value = 'overview'
    }
  }

  /**
   * 动作回包只更新发起动作的那个运行；用户已切到别的页签时，
   * 迟到的快照最多刷新旧页签摘要，不能把看板切回去。
   */
  function applyActionSnapshot(snapshot: FactoryRunSnapshot): void {
    if (!run.value || snapshot.run.id !== run.value.id) {
      syncRunTab(snapshot.run)
      return
    }
    applySnapshot(snapshot)
  }

  async function loadRun(root: string): Promise<void> {
    boardRoot = root
    runLoading.value = true
    runError.value = null
    try {
      const summaries = await api.factory.runList(root)
      runTabs.value = summaries
      const activeId = run.value?.id ?? null
      const keep =
        activeId && summaries.some((item) => item.id === activeId)
          ? activeId
          : summaries[0]?.id ?? null
      if (!keep) {
        runRequest += 1
        applySnapshot(null)
        return
      }
      const activeSummary = summaries.find((item) => item.id === keep)
      if (keep === activeId && activeSummary && run.value) {
        // 列表只刷新摘要；当前运行的快照由 IPC 推送与动作回包保持最新。
        run.value = { ...run.value, ...activeSummary }
        syncRunTab(run.value)
        return
      }
      await selectRun(root, keep)
    } catch {
      runError.value = 'load-failed'
    } finally {
      runLoading.value = false
    }
  }

  /** 页签切换：读对应运行的快照，并预热选中任务的事件流。 */
  async function selectRun(root: string, runId: string): Promise<void> {
    if (!runId || run.value?.id === runId) return
    const token = ++runRequest
    runLoading.value = true
    runError.value = null
    try {
      const snapshot = await api.factory.runGet(root, runId)
      if (token !== runRequest) return
      if (!snapshot) {
        runError.value = 'load-failed'
        return
      }
      applySnapshot(snapshot)
      const taskId = selectedId.value
      if (taskId) await loadEvents(root, snapshot.run.id, taskId)
    } catch {
      if (token === runRequest) runError.value = 'load-failed'
    } finally {
      if (token === runRequest) runLoading.value = false
    }
  }

  /** 关闭页签只从视图移除；当前页签被关时切到相邻页签，全关则回到空态。 */
  async function closeRun(root: string, runId: string): Promise<void> {
    const index = runTabs.value.findIndex((item) => item.id === runId)
    if (index < 0) return
    const remaining = runTabs.value.filter((item) => item.id !== runId)
    runTabs.value = remaining
    if (run.value?.id !== runId) return

    runRequest += 1
    applySnapshot(null)
    const next = remaining[index] ?? remaining[index - 1] ?? null
    if (next) await selectRun(root, next.id)
  }

  async function createRun(
    root: string,
    taskIds: string[],
    concurrency?: number,
    dependencies?: Record<string, string[]>,
  ): Promise<boolean> {
    creatingRun.value = true
    createRunError.value = null
    try {
      const result = await api.factory.runCreate(root, {
        taskIds,
        ...(concurrency === undefined ? {} : { concurrency }),
        ...(dependencies === undefined ? {} : { dependencies }),
      })
      if (!result.ok) {
        const ids = [...(result.duplicates ?? []), ...(result.missing ?? [])].join(', ')
        createRunError.value = { code: result.error, ...(ids ? { params: { ids } } : {}) }
        return false
      }
      upsertRunTab(result.snapshot.run)
      applySnapshot(result.snapshot)
      // 新建运行默认待启动；立刻交给调度器，按并发上限自行领取。
      const started = await api.factory.runResume(root, result.snapshot.run.id)
      if (started.ok) {
        upsertRunTab(started.snapshot.run)
        applyActionSnapshot(started.snapshot)
      } else actionError.value = { code: started.error }
      return true
    } catch {
      createRunError.value = { code: 'create-failed' }
      return false
    } finally {
      creatingRun.value = false
    }
  }

  /** 规划只是预览；确认创建运行前不落任何运行目录。 */
  async function requestPlan(root: string, candidateIds: string[]): Promise<FactoryPlanResult> {
    planning.value = true
    planError.value = null
    try {
      const result: FactoryPlanResult = await api.factory.plan(root, { candidateIds })
      if (!result.ok) {
        planError.value = result.error
        return result
      }
      return result
    } catch {
      planError.value = 'agent-error'
      return { ok: false, error: 'agent-error' }
    } finally {
      planning.value = false
    }
  }

  async function pauseRun(root: string, runId: string): Promise<FactoryRunControlResult> {
    pausing.value = true
    actionError.value = null
    try {
      const result = await api.factory.runPause(root, runId)
      if (result.ok) applyActionSnapshot(result.snapshot)
      else actionError.value = { code: result.error }
      return result
    } catch {
      actionError.value = { code: 'write-failed' }
      return { ok: false, error: 'run-not-found' }
    } finally {
      pausing.value = false
    }
  }

  async function resumeRun(root: string, runId: string): Promise<FactoryRunControlResult> {
    pausing.value = true
    actionError.value = null
    try {
      const result = await api.factory.runResume(root, runId)
      if (result.ok) applyActionSnapshot(result.snapshot)
      else actionError.value = { code: result.error }
      return result
    } catch {
      actionError.value = { code: 'write-failed' }
      return { ok: false, error: 'run-not-found' }
    } finally {
      pausing.value = false
    }
  }

  function openConfig(): void {
    if (!config.value) return
    configDraft.value = cloneConfig(config.value)
    configError.value = null
    configFieldErrors.value = []
    configConflictRevision.value = null
    configConfirmGateOff.value = false
    configOpen.value = true
  }

  function closeConfig(): void {
    configOpen.value = false
    configDraft.value = null
    configError.value = null
    configFieldErrors.value = []
    configConflictRevision.value = null
    configConfirmGateOff.value = false
  }

  function updateStage(key: FactoryStageKey, patch: Partial<FactoryStageConfig>): void {
    const draftConfig = configDraft.value
    if (!draftConfig) return
    draftConfig.stages[key] = { ...draftConfig.stages[key], ...patch }
  }

  function setConfigConcurrency(value: number): void {
    const draftConfig = configDraft.value
    if (!draftConfig) return
    draftConfig.agent = { ...draftConfig.agent, maxConcurrency: value }
  }

  function setConfigVerifyCommand(value: string): void {
    const draftConfig = configDraft.value
    if (!draftConfig) return
    draftConfig.commands = { ...draftConfig.commands, verify: value }
  }

  function setConfigGateConfirm(value: boolean): void {
    configConfirmGateOff.value = value
  }

  function setConfigMergeMode(mode: 'local' | 'pr'): void {
    const draftConfig = configDraft.value
    if (!draftConfig || draftConfig.tracker.type !== 'github-issues') return
    draftConfig.tracker = { ...draftConfig.tracker, mergeMode: mode }
  }

  async function saveConfig(root: string): Promise<boolean> {
    const draftConfig = configDraft.value
    if (!draftConfig) return false
    configSaving.value = true
    configError.value = null
    configFieldErrors.value = []
    configConflictRevision.value = null
    try {
      const result = await api.factory.configSave(root, {
        config: toPlain(draftConfig),
        ...(config.value ? { expectedRevision: config.value.revision } : {}),
        ...(configConfirmGateOff.value ? { confirmGateOff: true } : {}),
      })
      if (!result.ok) {
        configError.value = result.error
        if (result.error === 'invalid-config') configFieldErrors.value = result.errors
        if (result.error === 'revision-conflict') configConflictRevision.value = result.current
        return false
      }
      config.value = result.config
      closeConfig()
      return true
    } catch {
      configError.value = 'write-failed'
      return false
    } finally {
      configSaving.value = false
    }
  }

  /**
   * 主进程推送：事件按「运行 + 任务」缓存并按 seq 去重；页签摘要跟随更新，
   * 但只有当前运行的快照会覆盖看板，避免后台运行串改选中项。
   */
  function applyPush(push: FactoryEventPush): void {
    const { event, snapshot } = push
    const open = runTabs.value.some((item) => item.id === event.runId)
    if (open) syncRunTab(snapshot.run)

    const key = `${event.runId}:${event.seq}`
    if (open && !seenEventSeqs.has(key)) {
      seenEventSeqs.add(key)
      if (event.taskId) {
        const cacheKey = eventKey(event.runId, event.taskId)
        const list = eventsByTask.value[cacheKey] ?? []
        eventsByTask.value = {
          ...eventsByTask.value,
          [cacheKey]: [...list, event].sort((a, b) => a.seq - b.seq),
        }
      } else if (event.runId === run.value?.id) {
        runEvents.value = [...runEvents.value, event].sort((a, b) => a.seq - b.seq)
      }
    }

    if (run.value && snapshot.run.id === run.value.id) applySnapshot(snapshot)
  }

  /** 订阅主进程事件流；同一项目重复调用不会叠加监听。 */
  function subscribeEvents(root: string): void {
    if (subscribedRoot === root && unsubscribeEvents) return
    unsubscribeEvents?.()
    subscribedRoot = root
    unsubscribeEvents = api.factory.onEvent(applyPush)
  }

  async function loadEvents(root: string, runId: string, taskId: string): Promise<void> {
    eventsLoading.value = true
    eventsError.value = null
    try {
      const events = await api.factory.taskEvents(root, runId, taskId)
      eventsByTask.value = { ...eventsByTask.value, [eventKey(runId, taskId)]: events }
      for (const event of events) seenEventSeqs.add(`${event.runId}:${event.seq}`)
    } catch {
      eventsError.value = 'load-failed'
    } finally {
      eventsLoading.value = false
    }
  }

  async function startTask(
    root: string,
    runId: string,
    taskId: string,
    input: FactoryTaskStartInput = {},
  ): Promise<FactoryTaskStartResult> {
    startingId.value = taskId
    actionError.value = null
    pendingDirtyId.value = null
    try {
      const result = await api.factory.taskStart(root, runId, taskId, input)
      if (result.ok) {
        applyActionSnapshot(result.snapshot)
        return result
      }
      actionError.value = {
        code: result.error,
        ...(result.detail ? { detail: result.detail } : {}),
      }
      if (result.error === 'dirty-worktree') pendingDirtyId.value = taskId
      return result
    } catch {
      // 渲染层异常不等于 git 失败：冒充 git-error 会把真正的故障点藏起来。
      actionError.value = { code: 'action-failed' }
      return { ok: false, error: 'action-failed' }
    } finally {
      startingId.value = null
    }
  }

  function confirmDirtyStart(root: string, runId: string, taskId: string): Promise<FactoryTaskStartResult> {
    return startTask(root, runId, taskId, { confirmDirty: true })
  }

  async function stopTask(root: string, runId: string, taskId: string): Promise<FactoryTaskActionResult> {
    stopping.value = true
    actionError.value = null
    try {
      const result = await api.factory.taskStop(root, runId, taskId)
      if (result.ok) applyActionSnapshot(result.snapshot)
      else actionError.value = { code: result.error }
      return result
    } catch {
      actionError.value = { code: 'stop-failed' }
      return { ok: false, error: 'stop-failed' }
    } finally {
      stopping.value = false
    }
  }

  /** 放弃/移除：卡片与检查器底部都走这一条，结果与错误只有一份。 */
  async function cancelTask(root: string, runId: string, taskId: string): Promise<FactoryTaskActionResult> {
    cancelling.value = true
    actionError.value = null
    try {
      const result = await api.factory.taskCancel(root, runId, taskId)
      if (result.ok) applyActionSnapshot(result.snapshot)
      else actionError.value = { code: result.error }
      return result
    } catch {
      actionError.value = { code: 'write-failed' }
      return { ok: false, error: 'write-failed' }
    } finally {
      cancelling.value = false
    }
  }

  async function stopRun(root: string, runId: string): Promise<FactoryRunStopResult> {
    stopping.value = true
    actionError.value = null
    try {
      const result = await api.factory.runStop(root, runId)
      if (result.ok) applyActionSnapshot(result.snapshot)
      else actionError.value = { code: result.error }
      return result
    } catch {
      actionError.value = { code: 'stop-failed' }
      return { ok: false, error: 'stop-failed' }
    } finally {
      stopping.value = false
    }
  }

  async function revealWorktree(root: string, runId: string, taskId: string): Promise<boolean> {
    const result = await api.factory.worktreeReveal(root, runId, taskId)
    if (!result.ok) actionError.value = { code: result.error }
    return result.ok
  }

  async function approveTask(
    root: string,
    runId: string,
    taskId: string,
  ): Promise<FactoryTaskActionResult> {
    approving.value = true
    actionError.value = null
    try {
      const result = await api.factory.taskApprove(root, runId, taskId)
      if (result.ok) applyActionSnapshot(result.snapshot)
      else actionError.value = { code: result.error }
      return result
    } catch {
      actionError.value = { code: 'write-failed' }
      return { ok: false, error: 'write-failed' }
    } finally {
      approving.value = false
    }
  }

  async function requestChanges(
    root: string,
    runId: string,
    taskId: string,
  ): Promise<FactoryTaskActionResult> {
    actionError.value = null
    try {
      const result = await api.factory.taskRequestChanges(root, runId, taskId)
      if (result.ok) applyActionSnapshot(result.snapshot)
      else actionError.value = { code: result.error }
      return result
    } catch {
      actionError.value = { code: 'write-failed' }
      return { ok: false, error: 'write-failed' }
    }
  }

  async function fixTask(root: string, runId: string, taskId: string): Promise<FactoryTaskActionResult> {
    fixing.value = true
    actionError.value = null
    try {
      const result = await api.factory.taskFix(root, runId, taskId)
      if (result.ok) applyActionSnapshot(result.snapshot)
      else actionError.value = { code: result.error }
      return result
    } catch {
      actionError.value = { code: 'write-failed' }
      return { ok: false, error: 'write-failed' }
    } finally {
      fixing.value = false
    }
  }

  async function takeoverTask(
    root: string,
    runId: string,
    taskId: string,
  ): Promise<FactoryTakeoverResult> {
    takingOver.value = true
    actionError.value = null
    try {
      const result = await api.factory.taskTakeover(root, runId, taskId)
      if (result.ok) {
        applyActionSnapshot(result.snapshot)
        takeoverPanelTaskId.value = taskId
        takeoverVerifyFailed.value = false
      } else {
        actionError.value = { code: result.error, ...(result.detail ? { detail: result.detail } : {}) }
      }
      return result
    } catch {
      actionError.value = { code: 'agent-error' }
      return { ok: false, error: 'agent-error' }
    } finally {
      takingOver.value = false
    }
  }

  async function returnTask(root: string, runId: string, taskId: string): Promise<FactoryReturnResult> {
    returning.value = true
    actionError.value = null
    try {
      const result = await api.factory.taskReturn(root, runId, taskId)
      if (result.ok) {
        applyActionSnapshot(result.snapshot)
        takeoverVerifyFailed.value = result.verified === false
      } else {
        actionError.value = { code: result.error, ...(result.detail ? { detail: result.detail } : {}) }
      }
      return result
    } catch {
      actionError.value = { code: 'write-failed' }
      return { ok: false, error: 'write-failed' }
    } finally {
      returning.value = false
    }
  }

  /** 卡片角标与检查器按钮都用它重新打开面板，不重跑接管动作。 */
  function openTakeoverPanel(taskId: string): void {
    takeoverPanelTaskId.value = taskId
    takeoverVerifyFailed.value = false
  }

  /** 关闭面板不等于交回：任务的接管状态不受影响。 */
  function closeTakeoverPanel(): void {
    takeoverPanelTaskId.value = null
  }

  async function retryTask(
    root: string,
    runId: string,
    taskId: string,
    input?: FactoryTaskRetryInput,
  ): Promise<FactoryTaskActionResult> {
    retrying.value = true
    actionError.value = null
    try {
      const result = await api.factory.taskRetry(root, runId, taskId, input)
      if (result.ok) applyActionSnapshot(result.snapshot)
      else actionError.value = { code: result.error, ...(result.detail ? { detail: result.detail } : {}) }
      return result
    } catch {
      actionError.value = { code: 'action-failed' }
      return { ok: false, error: 'action-failed' }
    } finally {
      retrying.value = false
    }
  }

  async function updateComment(
    root: string,
    runId: string,
    taskId: string,
    input: FactoryReviewCommentInput,
  ): Promise<FactoryTaskActionResult> {
    updatingComment.value = true
    actionError.value = null
    try {
      const result = await api.factory.taskCommentUpdate(root, runId, taskId, input)
      if (result.ok) {
        applyActionSnapshot(result.snapshot)
        pendingIgnoreId.value = null
      } else {
        actionError.value = { code: result.error }
        pendingIgnoreId.value = result.error === 'confirm-required' ? input.commentId : null
      }
      return result
    } catch {
      actionError.value = { code: 'write-failed' }
      return { ok: false, error: 'write-failed' }
    } finally {
      updatingComment.value = false
    }
  }

  function acceptComment(root: string, runId: string, taskId: string, commentId: string) {
    return updateComment(root, runId, taskId, { commentId, action: 'accept' })
  }

  function ignoreComment(root: string, runId: string, taskId: string, commentId: string) {
    return updateComment(root, runId, taskId, { commentId, action: 'ignore' })
  }

  function confirmIgnoreComment(root: string, runId: string, taskId: string, commentId: string) {
    return updateComment(root, runId, taskId, { commentId, action: 'ignore', confirm: true })
  }

  function setMergeMode(mode: FactoryMergeMode): void {
    mergeMode.value = mode
  }

  function setMergeConfirmed(value: boolean): void {
    mergeConfirmed.value = value
  }

  function closeMerge(): void {
    mergeOpen.value = false
    mergeTaskId.value = null
    mergeMode.value = 'merge'
    mergeConfirmed.value = false
    mergePreflight.value = null
    mergeError.value = null
    merging.value = false
  }

  async function refreshMerge(root: string, runId: string, taskId?: string): Promise<void> {
    const target = taskId ?? mergeTaskId.value
    if (!target) return
    mergeChecking.value = true
    mergeError.value = null
    try {
      const result = await api.factory.mergePreflight(root, runId, target)
      if (result.ok) {
        mergePreflight.value = result.preflight
      } else {
        mergePreflight.value = null
        mergeError.value = { code: result.error, ...(result.detail ? { detail: result.detail } : {}) }
      }
    } catch {
      mergePreflight.value = null
      mergeError.value = { code: 'git-error' }
    } finally {
      mergeChecking.value = false
    }
  }

  /** 打开即预检；用户刷新时重新预检，不自动 rebase 基础分支。 */
  async function openMerge(root: string, runId: string, taskId: string): Promise<void> {
    mergeTaskId.value = taskId
    mergeMode.value = 'merge'
    mergeConfirmed.value = false
    mergePreflight.value = null
    mergeError.value = null
    mergeOpen.value = true
    await refreshMerge(root, runId, taskId)
  }

  async function confirmMerge(root: string, runId: string): Promise<FactoryMergeResult> {
    const taskId = mergeTaskId.value
    if (!taskId) return { ok: false, error: 'task-not-found' }
    merging.value = true
    mergeError.value = null
    try {
      const input: FactoryMergeExecuteInput = {
        mode: mergeMode.value,
        confirmed: mergeConfirmed.value,
      }
      const result = await api.factory.mergeExecute(root, runId, taskId, input)
      if (result.ok) {
        applyActionSnapshot(result.snapshot)
        mergeOpen.value = false
        mergeConfirmed.value = false
        return result
      }
      if (result.preflight) mergePreflight.value = result.preflight
      mergeError.value = { code: result.error, ...(result.detail ? { detail: result.detail } : {}) }
      return result
    } catch {
      mergeError.value = { code: 'git-error' }
      return { ok: false, error: 'git-error' }
    } finally {
      merging.value = false
    }
  }

  function clearActionError(): void {
    actionError.value = null
    pendingDirtyId.value = null
    pendingIgnoreId.value = null
    writebackError.value = null
  }

  function selectTask(id: string | null): void {
    selectedId.value = id
    persistSelection(id)
    inspectorTab.value = 'overview'
    if (id) inspectorOpen.value = true
    pendingIgnoreId.value = null
    writebackError.value = null
  }

  function closeInspector(): void {
    inspectorOpen.value = false
  }

  function setInspectorTab(tab: FactoryInspectorTab): void {
    inspectorTab.value = tab
  }

  /** 新建运行的两个入口（本地创建 / GitHub 领取）共用同一份旧错误清理。 */
  function clearNewRunErrors(): void {
    createRunError.value = null
    githubClaimError.value = null
    planError.value = null
  }

  function reset(): void {
    loading.value = false
    loaded.value = false
    error.value = null
    configured.value = false
    config.value = null
    configPath.value = ''
    storage.value = null
    context.value = null
    preflight.value = null
    preflightRunning.value = false
    preflightError.value = null
    wizardOpen.value = false
    wizardFromConfig.value = false
    wizardDone.value = false
    step.value = 1
    draft.value = {}
    saving.value = false
    saveError.value = null
    githubRepos.value = []
    githubReposLoading.value = false
    githubReposError.value = null
    tokenTesting.value = false
    tokenResult.value = null
    wizardToken.value = ''
    ghChecking.value = false
    stopGhLoginPolling()
    ghLogin.value = { running: false }
    backlog.value = []
    backlogLoading.value = false
    backlogError.value = null
    githubIssues.value = []
    githubIssuesLoading.value = false
    githubIssuesError.value = null
    githubLabel.value = ''
    githubClaiming.value = false
    githubClaimError.value = null
    retryingWritebackId.value = null
    writebackError.value = null
    run.value = null
    tasks.value = []
    runTabs.value = []
    runRequest += 1
    runLoading.value = false
    runError.value = null
    selectedId.value = null
    inspectorTab.value = 'overview'
    inspectorOpen.value = true
    creatingRun.value = false
    createRunError.value = null
    planning.value = false
    planError.value = null
    pausing.value = false
    configOpen.value = false
    configDraft.value = null
    configSaving.value = false
    configError.value = null
    configFieldErrors.value = []
    configConflictRevision.value = null
    configConfirmGateOff.value = false
    eventsByTask.value = {}
    runEvents.value = []
    eventsLoading.value = false
    eventsError.value = null
    actionError.value = null
    startingId.value = null
    stopping.value = false
    cancelling.value = false
    pendingDirtyId.value = null
    takingOver.value = false
    returning.value = false
    retrying.value = false
    takeoverPanelTaskId.value = null
    takeoverVerifyFailed.value = false
    approving.value = false
    fixing.value = false
    updatingComment.value = false
    pendingIgnoreId.value = null
    mergeOpen.value = false
    mergeTaskId.value = null
    mergeMode.value = 'merge'
    mergeConfirmed.value = false
    mergeChecking.value = false
    mergePreflight.value = null
    mergeError.value = null
    merging.value = false
    seenEventSeqs.clear()
    unsubscribeEvents?.()
    unsubscribeEvents = null
    subscribedRoot = null
  }

  return {
    loading,
    loaded,
    error,
    configured,
    config,
    configPath,
    storage,
    context,
    preflight,
    preflightRunning,
    preflightError,
    wizardOpen,
    wizardDone,
    step,
    draft,
    saving,
    saveError,
    githubRepos,
    githubReposLoading,
    githubReposError,
    tokenTesting,
    tokenResult,
    wizardToken,
    ghChecking,
    ghLogin,
    backlog,
    backlogLoading,
    backlogError,
    githubIssues,
    githubIssuesLoading,
    githubIssuesError,
    githubLabel,
    githubClaiming,
    githubClaimError,
    retryingWritebackId,
    writebackError,
    run,
    tasks,
    runTabs,
    runLoading,
    runError,
    selectedId,
    inspectorTab,
    inspectorOpen,
    creatingRun,
    createRunError,
    planning,
    planError,
    pausing,
    configOpen,
    configDraft,
    configSaving,
    configError,
    configFieldErrors,
    configConflictRevision,
    configConfirmGateOff,
    eventsByTask,
    runEvents,
    eventsLoading,
    eventsError,
    actionError,
    startingId,
    stopping,
    cancelling,
    pendingDirtyId,
    takingOver,
    returning,
    retrying,
    takeoverPanelTask,
    takeoverVerifyFailed,
    approving,
    fixing,
    updatingComment,
    pendingIgnoreId,
    mergeOpen,
    mergeTaskId,
    mergeMode,
    mergeConfirmed,
    mergeChecking,
    mergePreflight,
    mergeError,
    merging,
    mergeHasBlockers,
    canConfirmMerge,
    mergeTarget,
    selectedEvents,
    hasCommits,
    selectedTask,
    selectedEligibility,
    laneCounts,
    boardReady,
    readonly,
    corruptRuns,
    stepErrors,
    canGoNext,
    blocking,
    loadState,
    loadContext,
    refresh,
    openWizard,
    closeWizard,
    restartWizard,
    cancelWizard,
    runPreflight,
    loadGithubRepos,
    next,
    back,
    goToStep,
    save,
    testToken,
    storeToken,
    checkGhAuth,
    startGhLogin,
    loadBacklog,
    createBacklogTask,
    updateBacklogTask,
    deleteBacklogTask,
    moveBacklogTask,
    loadGithubIssues,
    claimGithubIssues,
    retryGithubWriteback,
    setGithubLabel,
    loadRun,
    selectRun,
    closeRun,
    createRun,
    requestPlan,
    pauseRun,
    resumeRun,
    openConfig,
    closeConfig,
    updateStage,
    setConfigConcurrency,
    setConfigVerifyCommand,
    setConfigGateConfirm,
    setConfigMergeMode,
    saveConfig,
    applyPush,
    subscribeEvents,
    loadEvents,
    startTask,
    confirmDirtyStart,
    stopTask,
    cancelTask,
    stopRun,
    revealWorktree,
    approveTask,
    requestChanges,
    fixTask,
    takeoverTask,
    returnTask,
    openTakeoverPanel,
    closeTakeoverPanel,
    retryTask,
    updateComment,
    acceptComment,
    ignoreComment,
    confirmIgnoreComment,
    setMergeMode,
    setMergeConfirmed,
    closeMerge,
    refreshMerge,
    openMerge,
    confirmMerge,
    clearActionError,
    selectTask,
    setInspectorTab,
    closeInspector,
    clearNewRunErrors,
    reset,
  }
})
