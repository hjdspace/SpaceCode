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
import { mergeEligibility, type MergeEligibility } from '@/shared/factoryReview'
import {
  canAdvance,
  defaultDraft,
  draftFromConfig,
  setupStepErrors,
  type SetupStep,
} from './setup'
import { findTask, laneCounts as computeLaneCounts, type FactoryInspectorTab } from './board'

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

  const wizardOpen = ref(false)
  const step = ref<SetupStep>(1)
  const draft = ref<FactorySetupDraft>({})
  const saving = ref(false)
  const saveError = ref<string | null>(null)

  const tokenTesting = ref(false)
  const tokenResult = ref<FactoryGithubAuthResult | null>(null)

  // 看板：本地待办 + 当前运行投影 + 检查器选中
  const backlog = ref<FactoryBacklogItem[]>([])
  const backlogLoading = ref(false)
  const backlogError = ref<string | null>(null)

  const run = ref<FactoryRun | null>(null)
  const tasks = ref<FactoryTask[]>([])
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

  const creatingRun = ref(false)
  const createRunError = ref<FactoryRunError | null>(null)

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
  const pendingDirtyId = ref<string | null>(null)
  // 接管/交回/重试：各自的重入保护，避免重复点击并发调用
  const takingOver = ref(false)
  const returning = ref(false)
  const retrying = ref(false)

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

  const selectedTask = computed(() => findTask(tasks.value, selectedId.value))
  const laneCounts = computed(() => computeLaneCounts(tasks.value))
  const selectedEvents = computed(() =>
    selectedId.value ? eventsByTask.value[selectedId.value] ?? [] : [],
  )
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

  async function openWizard(root: string): Promise<void> {
    saveError.value = null
    tokenResult.value = null
    preflight.value = null
    step.value = 1
    if (!context.value) await loadContext(root)
    const ctx = context.value
    if (!ctx) return
    draft.value = ctx.existingConfig ? draftFromConfig(ctx.existingConfig) : defaultDraft(ctx)
    wizardOpen.value = true
  }

  function closeWizard(): void {
    wizardOpen.value = false
    saveError.value = null
  }

  async function runPreflight(root: string): Promise<void> {
    preflight.value = await api.factory.preflight(root, draft.value)
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

  async function save(root: string): Promise<boolean> {
    saving.value = true
    saveError.value = null
    try {
      const result = await api.factory.save(root, draft.value)
      if (!result.ok) {
        saveError.value = result.error ?? 'write-failed'
        if (result.preflight) preflight.value = result.preflight
        return false
      }
      wizardOpen.value = false
      await loadState(root)
      return true
    } finally {
      saving.value = false
    }
  }

  async function testToken(root: string, token: string, repo: string): Promise<void> {
    tokenTesting.value = true
    try {
      tokenResult.value = await api.factory.testGithubToken(root, token, repo)
      if (tokenResult.value.ok) await storeToken(token)
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

  async function checkGhAuth(): Promise<boolean> {
    const result = await api.factory.checkGhAuth()
    if (context.value) context.value = { ...context.value, ghLoggedIn: result.ok }
    return result.ok
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

  async function claimGithubIssues(root: string, issueNumbers: number[]): Promise<boolean> {
    githubClaiming.value = true
    githubClaimError.value = null
    try {
      const result: FactoryGithubClaimResult = await api.factory.githubClaim(root, { issueNumbers })
      if (!result.ok) {
        githubClaimError.value = {
          reason: result.reason,
          ...(result.failed ? { failed: result.failed } : {}),
          ...(result.detail ? { detail: result.detail } : {}),
        }
        return false
      }
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
        applySnapshot(result.snapshot)
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

  function applySnapshot(snapshot: FactoryRunSnapshot | null): void {
    run.value = snapshot?.run ?? null
    tasks.value = snapshot?.tasks ?? []
    if (!findTask(tasks.value, selectedId.value)) {
      const persisted = boardRoot ? readPersistedSelection(boardRoot) : null
      const restored = findTask(tasks.value, persisted)
      selectedId.value = restored?.id ?? tasks.value[0]?.id ?? null
      inspectorTab.value = 'overview'
    }
  }

  async function loadRun(root: string): Promise<void> {
    boardRoot = root
    runLoading.value = true
    runError.value = null
    try {
      applySnapshot(await api.factory.runLatest(root))
    } catch {
      runError.value = 'load-failed'
    } finally {
      runLoading.value = false
    }
  }

  async function createRun(root: string, taskIds: string[], concurrency?: number): Promise<boolean> {
    creatingRun.value = true
    createRunError.value = null
    try {
      const result = await api.factory.runCreate(root, {
        taskIds,
        ...(concurrency === undefined ? {} : { concurrency }),
      })
      if (!result.ok) {
        const ids = [...(result.duplicates ?? []), ...(result.missing ?? [])].join(', ')
        createRunError.value = { code: result.error, ...(ids ? { params: { ids } } : {}) }
        return false
      }
      applySnapshot(result.snapshot)
      // 新建运行默认待启动；立刻交给调度器，按并发上限自行领取。
      const started = await api.factory.runResume(root, result.snapshot.run.id)
      if (started.ok) applySnapshot(started.snapshot)
      else actionError.value = { code: started.error }
      return true
    } catch {
      createRunError.value = { code: 'create-failed' }
      return false
    } finally {
      creatingRun.value = false
    }
  }

  async function pauseRun(root: string, runId: string): Promise<FactoryRunControlResult> {
    pausing.value = true
    actionError.value = null
    try {
      const result = await api.factory.runPause(root, runId)
      if (result.ok) applySnapshot(result.snapshot)
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
      if (result.ok) applySnapshot(result.snapshot)
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
        config: draftConfig,
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
   * 主进程推送：按 seq 去重后把事件并进对应任务，快照只接受当前运行，
   * 避免切换项目后旧运行的事件覆盖看板。
   */
  function applyPush(push: FactoryEventPush): void {
    const { event, snapshot } = push
    if (run.value && snapshot.run.id !== run.value.id) return

    const key = `${event.runId}:${event.seq}`
    if (!seenEventSeqs.has(key)) {
      seenEventSeqs.add(key)
      if (event.taskId) {
        const list = eventsByTask.value[event.taskId] ?? []
        eventsByTask.value = {
          ...eventsByTask.value,
          [event.taskId]: [...list, event].sort((a, b) => a.seq - b.seq),
        }
      } else {
        runEvents.value = [...runEvents.value, event].sort((a, b) => a.seq - b.seq)
      }
    }

    applySnapshot(snapshot)
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
      eventsByTask.value = { ...eventsByTask.value, [taskId]: events }
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
        applySnapshot(result.snapshot)
        return result
      }
      actionError.value = {
        code: result.error,
        ...(result.detail ? { detail: result.detail } : {}),
      }
      if (result.error === 'dirty-worktree') pendingDirtyId.value = taskId
      return result
    } catch {
      actionError.value = { code: 'git-error' }
      return { ok: false, error: 'git-error' }
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
      if (result.ok) applySnapshot(result.snapshot)
      else actionError.value = { code: result.error }
      return result
    } catch {
      actionError.value = { code: 'stop-failed' }
      return { ok: false, error: 'stop-failed' }
    } finally {
      stopping.value = false
    }
  }

  async function stopRun(root: string, runId: string): Promise<FactoryRunStopResult> {
    stopping.value = true
    actionError.value = null
    try {
      const result = await api.factory.runStop(root, runId)
      if (result.ok) applySnapshot(result.snapshot)
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
      if (result.ok) applySnapshot(result.snapshot)
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
      if (result.ok) applySnapshot(result.snapshot)
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
      if (result.ok) applySnapshot(result.snapshot)
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
      if (result.ok) applySnapshot(result.snapshot)
      else actionError.value = { code: result.error, ...(result.detail ? { detail: result.detail } : {}) }
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
      if (result.ok) applySnapshot(result.snapshot)
      else actionError.value = { code: result.error, ...(result.detail ? { detail: result.detail } : {}) }
      return result
    } catch {
      actionError.value = { code: 'write-failed' }
      return { ok: false, error: 'write-failed' }
    } finally {
      returning.value = false
    }
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
      if (result.ok) applySnapshot(result.snapshot)
      else actionError.value = { code: result.error, ...(result.detail ? { detail: result.detail } : {}) }
      return result
    } catch {
      actionError.value = { code: 'git-error' }
      return { ok: false, error: 'git-error' }
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
        applySnapshot(result.snapshot)
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
        applySnapshot(result.snapshot)
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
    pendingIgnoreId.value = null
    writebackError.value = null
  }

  function setInspectorTab(tab: FactoryInspectorTab): void {
    inspectorTab.value = tab
  }

  function clearCreateRunError(): void {
    createRunError.value = null
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
    wizardOpen.value = false
    step.value = 1
    draft.value = {}
    saving.value = false
    saveError.value = null
    tokenTesting.value = false
    tokenResult.value = null
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
    runLoading.value = false
    runError.value = null
    selectedId.value = null
    inspectorTab.value = 'overview'
    creatingRun.value = false
    createRunError.value = null
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
    pendingDirtyId.value = null
    takingOver.value = false
    returning.value = false
    retrying.value = false
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
    wizardOpen,
    step,
    draft,
    saving,
    saveError,
    tokenTesting,
    tokenResult,
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
    runLoading,
    runError,
    selectedId,
    inspectorTab,
    creatingRun,
    createRunError,
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
    pendingDirtyId,
    takingOver,
    returning,
    retrying,
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
    runPreflight,
    next,
    back,
    save,
    testToken,
    storeToken,
    checkGhAuth,
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
    createRun,
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
    stopRun,
    revealWorktree,
    approveTask,
    requestChanges,
    fixTask,
    takeoverTask,
    returnTask,
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
    clearCreateRunError,
    reset,
  }
})
