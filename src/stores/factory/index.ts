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
  FactoryEvent,
  FactoryEventPush,
  FactoryGithubAuthResult,
  FactoryPreflightResult,
  FactoryRun,
  FactoryRunCreateError,
  FactoryRunSnapshot,
  FactoryRunStopResult,
  FactorySetupContext,
  FactorySetupDraft,
  FactoryTask,
  FactoryTaskActionResult,
  FactoryTaskStartInput,
  FactoryTaskStartResult,
} from '@/shared/factory'
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

export const useFactoryStore = defineStore('factory', () => {
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  const configured = ref(false)
  const config = ref<FactoryConfig | null>(null)
  const configPath = ref('')
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

  const selectedId = ref<string | null>(null)
  const inspectorTab = ref<FactoryInspectorTab>('overview')

  const creatingRun = ref(false)
  const createRunError = ref<FactoryRunError | null>(null)

  // 实现阶段：事件流按任务缓存，seq 单调去重；动作错误交给检查器展示
  const eventsByTask = ref<Record<string, FactoryEvent[]>>({})
  const runEvents = ref<FactoryEvent[]>([])
  const eventsLoading = ref(false)
  const eventsError = ref<string | null>(null)
  const actionError = ref<FactoryActionError | null>(null)
  const startingId = ref<string | null>(null)
  const stopping = ref(false)
  const pendingDirtyId = ref<string | null>(null)

  const seenEventSeqs = new Set<string>()
  let unsubscribeEvents: (() => void) | null = null
  let subscribedRoot: string | null = null

  const selectedTask = computed(() => findTask(tasks.value, selectedId.value))
  const laneCounts = computed(() => computeLaneCounts(tasks.value))
  const selectedEvents = computed(() =>
    selectedId.value ? eventsByTask.value[selectedId.value] ?? [] : [],
  )
  const hasCommits = computed(() => (selectedTask.value?.commits?.length ?? 0) > 0)

  const boardReady = computed(() => configured.value && config.value !== null)

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

  function applySnapshot(snapshot: FactoryRunSnapshot | null): void {
    run.value = snapshot?.run ?? null
    tasks.value = snapshot?.tasks ?? []
    if (!findTask(tasks.value, selectedId.value)) {
      selectedId.value = tasks.value[0]?.id ?? null
      inspectorTab.value = 'overview'
    }
  }

  async function loadRun(root: string): Promise<void> {
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
      return true
    } catch {
      createRunError.value = { code: 'create-failed' }
      return false
    } finally {
      creatingRun.value = false
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

  function clearActionError(): void {
    actionError.value = null
    pendingDirtyId.value = null
  }

  function selectTask(id: string | null): void {
    selectedId.value = id
    inspectorTab.value = 'overview'
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
    run.value = null
    tasks.value = []
    runLoading.value = false
    runError.value = null
    selectedId.value = null
    inspectorTab.value = 'overview'
    creatingRun.value = false
    createRunError.value = null
    eventsByTask.value = {}
    runEvents.value = []
    eventsLoading.value = false
    eventsError.value = null
    actionError.value = null
    startingId.value = null
    stopping.value = false
    pendingDirtyId.value = null
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
    run,
    tasks,
    runLoading,
    runError,
    selectedId,
    inspectorTab,
    creatingRun,
    createRunError,
    eventsByTask,
    runEvents,
    eventsLoading,
    eventsError,
    actionError,
    startingId,
    stopping,
    pendingDirtyId,
    selectedEvents,
    hasCommits,
    selectedTask,
    laneCounts,
    boardReady,
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
    loadRun,
    createRun,
    applyPush,
    subscribeEvents,
    loadEvents,
    startTask,
    confirmDirtyStart,
    stopTask,
    stopRun,
    revealWorktree,
    clearActionError,
    selectTask,
    setInspectorTab,
    clearCreateRunError,
    reset,
  }
})
