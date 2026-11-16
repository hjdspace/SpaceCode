/**
 * Todo store — 待办面板的唯一状态源。
 *
 * 四个写入方（用户 UI、Agent 的 MCP 工具、到点提醒调度、macOS 同步）都在主进程
 * 落盘后广播 `todo:changed`，所以这里的手动订阅是「最终一致的收口」：本地先做
 * 乐观更新保证手感，随后到达的广播用服务端快照覆盖，冲突时回滚到快照。
 *
 * 订阅由 store 自己持有（幂等），面板反复开关不会叠加监听。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api } from '@/services/electronAPI'
import { TODO_LIST_LIMIT_MAX } from '@/shared/channels/todo'
import type {
  ActiveTodoReminder,
  CreateTodoInput,
  Todo,
  TodoAgentOperation,
  TodoChangePayload,
  TodoGroup,
  TodoMutationReason,
  TodoPriority,
  TodoStatus,
  TodoSyncActionResult,
  TodoSyncConfig,
  TodoSyncState,
  UpdateTodoInput,
} from '@/shared/channels/todo'
import { endOfDay, isOverdue, isUpcoming } from '@/utils/todoTime'

export type TodoView = 'all' | 'today' | 'upcoming' | 'completed' | 'group'
export type TodoSortMode = 'smart' | 'manual' | 'due' | 'priority' | 'created' | 'title'

export type TodoErrorKey =
  | TodoMutationReason
  | 'invalid-name'
  | 'duplicate-name'
  | 'load-failed'
  | 'sync-failed'

/** Agent 动过的行高亮多久 —— 够用户看清「哪条是 Agent 改的」，又不会长期染色。 */
const AGENT_HIGHLIGHT_MS = 6000
const UNDO_WINDOW_MS = 10000
const AGENT_ACTIVITY_LIMIT = 30
const PRIORITY_WEIGHT: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 }

function emptySyncState(): TodoSyncState {
  return {
    supported: false,
    permission: 'unknown',
    config: { enabled: false, listId: null },
    lists: [],
    conflicts: [],
    syncing: false,
  }
}

/** 未完成优先 → 计划时间升序（无时间垫底）→ 优先级 → 最近更新。与主进程排序同口径。 */
function compareSmart(a: Todo, b: Todo): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1
  const aDue = a.dueAt ?? Number.POSITIVE_INFINITY
  const bDue = b.dueAt ?? Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue
  if (a.priority !== b.priority) return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority]
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return a.createdAt - b.createdAt
}

export const useTodoStore = defineStore('todo', () => {
  const todos = ref<Todo[]>([])
  const groups = ref<TodoGroup[]>([])
  const loading = ref(false)
  const loaded = ref(false)
  const error = ref<TodoErrorKey | null>(null)

  const view = ref<TodoView>('all')
  const activeGroupId = ref<string | null>(null)
  const search = ref('')
  const sortMode = ref<TodoSortMode>('smart')
  const selectedIds = ref<string[]>([])
  const detailId = ref<string | null>(null)
  /** 正在与主进程对账的行：UI 据此压低透明度并禁用重复提交。 */
  const pendingIds = ref<string[]>([])

  const activeReminders = ref<ActiveTodoReminder[]>([])
  const agentActivity = ref<TodoAgentOperation[]>([])
  const agentHighlights = ref<Record<string, number>>({})
  const syncState = ref<TodoSyncState>(emptySyncState())
  const undoBatch = ref<{ todos: Todo[]; expiresAt: number } | null>(null)

  let tempSeq = 0
  let subscribed = false
  let unsubscribes: Array<() => void> = []
  let undoTimer: ReturnType<typeof setTimeout> | null = null
  const highlightTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const groupById = computed(() => new Map(groups.value.map(group => [group.id, group])))
  const detailTodo = computed(() => todos.value.find(todo => todo.id === detailId.value) ?? null)
  const selectionCount = computed(() => selectedIds.value.length)
  const hasUndo = computed(() => undoBatch.value !== null)

  function matchesView(todo: Todo, now: number): boolean {
    switch (view.value) {
      case 'today':
        return todo.status === 'open' && todo.dueAt !== undefined && todo.dueAt <= endOfDay(now)
      case 'upcoming':
        return todo.status === 'open' && isUpcoming(todo, now)
      case 'completed':
        return todo.status === 'completed'
      case 'group':
        if (activeGroupId.value === null) return false
        // 空 id 是侧栏的「未分组」入口，判定要与 counts.ungrouped 用同一个谓词。
        if (activeGroupId.value === '') return !todo.groupId
        return todo.groupId === activeGroupId.value
      default:
        return todo.status === 'open'
    }
  }

  function matchesSearch(todo: Todo, needle: string): boolean {
    if (!needle) return true
    if (todo.title.toLowerCase().includes(needle)) return true
    if (todo.notes?.toLowerCase().includes(needle)) return true
    return todo.tags.some(tag => tag.toLowerCase().includes(needle))
  }

  /** 视图 + 搜索之后的结果，未排序；计数与「全选可见」都用它。 */
  const visibleTodos = computed(() => {
    const now = Date.now()
    const needle = search.value.trim().toLowerCase()
    return todos.value.filter(todo => matchesView(todo, now) && matchesSearch(todo, needle))
  })

  const sortedTodos = computed(() => {
    const list = [...visibleTodos.value]
    switch (sortMode.value) {
      case 'manual':
        return list.sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt - b.createdAt)
      case 'due':
        return list.sort(
          (a, b) => (a.dueAt ?? Number.POSITIVE_INFINITY) - (b.dueAt ?? Number.POSITIVE_INFINITY) || compareSmart(a, b),
        )
      case 'priority':
        return list.sort((a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority] || compareSmart(a, b))
      case 'created':
        return list.sort((a, b) => b.createdAt - a.createdAt)
      case 'title':
        return list.sort((a, b) => a.title.localeCompare(b.title))
      default:
        return list.sort(compareSmart)
    }
  })

  const allVisibleSelected = computed(
    () => sortedTodos.value.length > 0 && sortedTodos.value.every(todo => selectedIds.value.includes(todo.id)),
  )

  /** 侧栏徽章：today 含逾期，逾期单独再给一个数，红色角标才有依据。 */
  const counts = computed(() => {
    const now = Date.now()
    const open = todos.value.filter(todo => todo.status === 'open')
    const byGroup = new Map<string, number>()
    for (const todo of open) {
      if (todo.groupId) byGroup.set(todo.groupId, (byGroup.get(todo.groupId) ?? 0) + 1)
    }
    return {
      all: open.length,
      today: open.filter(todo => todo.dueAt !== undefined && todo.dueAt <= endOfDay(now)).length,
      upcoming: open.filter(todo => isUpcoming(todo, now)).length,
      completed: todos.value.length - open.length,
      overdue: open.filter(todo => isOverdue(todo, now)).length,
      ungrouped: open.filter(todo => !todo.groupId).length,
      byGroup,
    }
  })

  const overdueCount = computed(() => counts.value.overdue)
  const openCount = computed(() => counts.value.all)
  const conflictCount = computed(() => syncState.value.conflicts.length)

  function replaceTodo(next: Todo): void {
    const index = todos.value.findIndex(todo => todo.id === next.id)
    if (index < 0) todos.value = [...todos.value, next]
    else todos.value = todos.value.map(todo => (todo.id === next.id ? next : todo))
  }

  function dropTodos(ids: string[]): void {
    if (ids.length === 0) return
    const gone = new Set(ids)
    todos.value = todos.value.filter(todo => !gone.has(todo.id))
    selectedIds.value = selectedIds.value.filter(id => !gone.has(id))
    if (detailId.value && gone.has(detailId.value)) detailId.value = null
  }

  function setPending(id: string, on: boolean): void {
    if (on) {
      if (!pendingIds.value.includes(id)) pendingIds.value = [...pendingIds.value, id]
    } else {
      pendingIds.value = pendingIds.value.filter(item => item !== id)
    }
  }

  function highlightAgentTodo(id: string): void {
    agentHighlights.value = { ...agentHighlights.value, [id]: Date.now() }
    const existing = highlightTimers.get(id)
    if (existing) clearTimeout(existing)
    highlightTimers.set(
      id,
      setTimeout(() => {
        highlightTimers.delete(id)
        const next = { ...agentHighlights.value }
        delete next[id]
        agentHighlights.value = next
      }, AGENT_HIGHLIGHT_MS),
    )
  }

  function applyChange(payload: TodoChangePayload): void {
    for (const todo of payload.todos ?? []) {
      replaceTodo(todo)
      // 服务端快照到达即结束乐观态，否则行会一直半透明。
      setPending(todo.id, false)
    }
    dropTodos(payload.removedIds ?? [])
    if (payload.groups) {
      const merged = new Map(groups.value.map(group => [group.id, group]))
      for (const group of payload.groups) merged.set(group.id, group)
      groups.value = [...merged.values()].sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt - b.createdAt)
    }
    for (const id of payload.removedGroupIds ?? []) {
      groups.value = groups.value.filter(group => group.id !== id)
      if (activeGroupId.value === id) {
        activeGroupId.value = null
        view.value = 'all'
      }
    }
    if (payload.source === 'agent') {
      for (const todo of payload.todos ?? []) highlightAgentTodo(todo.id)
    }
  }

  function applyAgentOperation(operation: TodoAgentOperation): void {
    agentActivity.value = [operation, ...agentActivity.value].slice(0, AGENT_ACTIVITY_LIMIT)
    highlightAgentTodo(operation.todoId)
  }

  /** 主进程发的是当前活跃提醒的整表（签名去重后），不是增量，所以直接替换。 */
  function applyReminderDue(reminders: ActiveTodoReminder[]): void {
    activeReminders.value = [...reminders].sort((a, b) => a.triggerAt - b.triggerAt)
  }

  /** 幂等：面板每次挂载都调用，只有第一次真正接上 IPC。 */
  function subscribe(): void {
    if (subscribed) return
    subscribed = true
    unsubscribes = [
      api.todo.onChanged(applyChange),
      api.todo.onAgentOperation(applyAgentOperation),
      api.todo.onReminderDue(applyReminderDue),
      api.todo.onSyncStateChanged(state => {
        syncState.value = state
      }),
    ]
  }

  function unsubscribe(): void {
    for (const off of unsubscribes) off()
    unsubscribes = []
    subscribed = false
    for (const timer of highlightTimers.values()) clearTimeout(timer)
    highlightTimers.clear()
    agentHighlights.value = {}
    clearUndoTimer()
  }

  async function load(): Promise<void> {
    subscribe()
    loading.value = true
    try {
      const [list, groupList, reminders, sync] = await Promise.all([
        api.todo.list({ limit: TODO_LIST_LIMIT_MAX }),
        api.todo.listGroups(),
        api.todo.listActiveReminders(),
        api.todo.getSyncState(),
      ])
      todos.value = list
      groups.value = groupList
      activeReminders.value = reminders
      syncState.value = sync
      error.value = null
      loaded.value = true
    } catch {
      error.value = 'load-failed'
    } finally {
      loading.value = false
    }
  }

  async function refresh(): Promise<void> {
    const [list, groupList] = await Promise.all([api.todo.list({ limit: TODO_LIST_LIMIT_MAX }), api.todo.listGroups()])
    todos.value = list
    groups.value = groupList
  }

  async function createTodo(input: CreateTodoInput): Promise<Todo | null> {
    const tempId = `pending-${++tempSeq}`
    const now = Date.now()
    const optimistic: Todo = {
      id: tempId,
      title: input.title,
      notes: input.notes,
      status: 'open',
      priority: input.priority ?? 'medium',
      dueAt: input.dueAt,
      groupId: input.groupId,
      tags: input.tags ?? [],
      reminders: [],
      sessionLinks: [],
      projectRoot: input.projectRoot,
      orderIndex: -now,
      createdAt: now,
      updatedAt: now,
    }
    todos.value = [optimistic, ...todos.value]
    setPending(tempId, true)
    const result = await api.todo.create(input)
    setPending(tempId, false)
    todos.value = todos.value.filter(todo => todo.id !== tempId)
    if (!result.ok) {
      error.value = result.reason
      return null
    }
    replaceTodo(result.todo)
    error.value = null
    return result.todo
  }

  /** 乐观改写；失败（含 expectedUpdatedAt 冲突）回滚到本地快照并拉服务端真值。 */
  async function updateTodo(input: UpdateTodoInput): Promise<Todo | null> {
    const previous = todos.value.find(todo => todo.id === input.id)
    if (!previous) return null
    const optimistic: Todo = {
      ...previous,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt ?? undefined } : {}),
      ...(input.groupId !== undefined ? { groupId: input.groupId ?? undefined } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      updatedAt: Date.now(),
    }
    replaceTodo(optimistic)
    setPending(input.id, true)
    const result = await api.todo.update({ ...input, expectedUpdatedAt: input.expectedUpdatedAt ?? previous.updatedAt })
    setPending(input.id, false)
    if (result.ok) {
      replaceTodo(result.todo)
      error.value = null
      return result.todo
    }
    error.value = result.reason
    replaceTodo(result.todo ?? previous)
    if (result.reason === 'conflict' || result.reason === 'not-found') {
      const fresh = await api.todo.get(input.id)
      if (fresh) replaceTodo(fresh)
      else dropTodos([input.id])
    }
    return null
  }

  async function toggleStatus(todo: Todo): Promise<Todo | null> {
    const next: TodoStatus = todo.status === 'open' ? 'completed' : 'open'
    return updateTodo({ id: todo.id, status: next, expectedUpdatedAt: todo.updatedAt })
  }

  async function setPriority(id: string, priority: TodoPriority): Promise<Todo | null> {
    return updateTodo({ id, priority })
  }

  async function moveToGroup(id: string, groupId: string | null): Promise<Todo | null> {
    return updateTodo({ id, groupId })
  }

  function clearUndoTimer(): void {
    if (undoTimer) clearTimeout(undoTimer)
    undoTimer = null
  }

  function offerUndo(removed: Todo[]): void {
    if (removed.length === 0) return
    clearUndoTimer()
    undoBatch.value = { todos: removed, expiresAt: Date.now() + UNDO_WINDOW_MS }
    undoTimer = setTimeout(() => {
      undoBatch.value = null
      undoTimer = null
    }, UNDO_WINDOW_MS)
  }

  function dismissUndo(): void {
    clearUndoTimer()
    undoBatch.value = null
  }

  async function removeTodo(id: string): Promise<boolean> {
    const previous = todos.value.find(todo => todo.id === id)
    if (!previous) return false
    dropTodos([id])
    const result = await api.todo.remove(id)
    if (!result.ok) {
      error.value = result.reason
      replaceTodo(previous)
      return false
    }
    offerUndo([result.removed])
    return true
  }

  async function undoRemove(): Promise<void> {
    const batch = undoBatch.value
    if (!batch) return
    dismissUndo()
    for (const todo of batch.todos) replaceTodo(todo)
    const failed: Todo[] = []
    for (const todo of batch.todos) {
      const result = await api.todo.restore(todo)
      if (!result.ok) failed.push(todo)
      else replaceTodo(result.todo)
    }
    if (failed.length > 0) {
      dropTodos(failed.map(todo => todo.id))
      error.value = 'not-found'
    }
  }

  async function bulkStatus(ids: string[], status: TodoStatus): Promise<void> {
    if (ids.length === 0) return
    const snapshots = new Map(todos.value.map(todo => [todo.id, todo]))
    const target = new Set(ids)
    todos.value = todos.value.map(todo =>
      target.has(todo.id) ? { ...todo, status, updatedAt: Date.now() } : todo,
    )
    const updated = await api.todo.bulkStatus(ids, status)
    const applied = new Set(updated.map(todo => todo.id))
    for (const todo of updated) replaceTodo(todo)
    // 只读（macOS 只读列表）或被别人删掉的行不会出现在返回里，回滚它们。
    for (const id of ids) {
      if (applied.has(id)) continue
      const snapshot = snapshots.get(id)
      if (snapshot) replaceTodo(snapshot)
    }
    selectedIds.value = []
  }

  async function bulkRemove(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const snapshots = todos.value.filter(todo => ids.includes(todo.id))
    dropTodos(ids)
    const removed = await api.todo.bulkRemove(ids)
    const removedIds = new Set(removed.map(todo => todo.id))
    for (const snapshot of snapshots) {
      if (!removedIds.has(snapshot.id)) replaceTodo(snapshot)
    }
    offerUndo(removed)
    selectedIds.value = []
  }

  /** 拖拽落位：ids 是当前可见顺序，先本地重排保证跟手，再让主进程重编号。 */
  async function reorder(ids: string[]): Promise<void> {
    const snapshots = todos.value
    const order = new Map(ids.map((id, index) => [id, index]))
    todos.value = todos.value.map(todo =>
      order.has(todo.id) ? { ...todo, orderIndex: order.get(todo.id) as number } : todo,
    )
    sortMode.value = 'manual'
    const updated = await api.todo.reorder(ids)
    if (updated.length === 0) {
      todos.value = snapshots
      return
    }
    for (const todo of updated) replaceTodo(todo)
  }

  async function touchSession(id: string, sessionId: string): Promise<void> {
    const todo = await api.todo.touchSession(id, sessionId)
    if (todo) replaceTodo(todo)
  }

  async function createGroup(name: string, color?: string): Promise<TodoGroup | null> {
    const result = await api.todo.createGroup(name, color)
    if (!result.ok) {
      error.value = result.reason
      return null
    }
    if (!groups.value.some(group => group.id === result.group.id)) {
      groups.value = [...groups.value, result.group]
    }
    error.value = null
    return result.group
  }

  async function renameGroup(id: string, name: string): Promise<boolean> {
    const result = await api.todo.renameGroup(id, name)
    if (!result.ok) {
      error.value = result.reason
      return false
    }
    groups.value = groups.value.map(group => (group.id === id ? result.group : group))
    error.value = null
    return true
  }

  async function removeGroup(id: string): Promise<boolean> {
    const result = await api.todo.removeGroup(id)
    if (!result.ok) return false
    groups.value = groups.value.filter(group => group.id !== id)
    // 删组不删待办，只是把它们放回未分组。
    todos.value = todos.value.map(todo => (todo.groupId === id ? { ...todo, groupId: undefined } : todo))
    if (activeGroupId.value === id) {
      activeGroupId.value = null
      view.value = 'all'
    }
    return true
  }

  async function acknowledgeReminder(todoId: string, reminderId: string): Promise<void> {
    activeReminders.value = activeReminders.value.filter(reminder => reminder.id !== reminderId)
    const result = await api.todo.acknowledgeReminder(todoId, reminderId)
    if (!result.ok) await refreshReminders()
  }

  async function snoozeReminder(todoId: string, reminderId: string, minutes: number): Promise<void> {
    activeReminders.value = activeReminders.value.filter(reminder => reminder.id !== reminderId)
    const result = await api.todo.snoozeReminder(todoId, reminderId, minutes)
    if (!result.ok) await refreshReminders()
    else {
      const todo = await api.todo.get(todoId)
      if (todo) replaceTodo(todo)
    }
  }

  async function refreshReminders(): Promise<void> {
    activeReminders.value = await api.todo.listActiveReminders()
  }

  function applySyncResult(result: TodoSyncActionResult): boolean {
    syncState.value = result.state
    if (!result.ok) error.value = 'sync-failed'
    else error.value = null
    return result.ok
  }

  async function requestSyncAccess(): Promise<boolean> {
    return applySyncResult(await api.todo.requestSyncAccess())
  }

  async function setSyncConfig(config: Partial<TodoSyncConfig>): Promise<boolean> {
    return applySyncResult(await api.todo.setSyncConfig(config))
  }

  async function syncNow(): Promise<boolean> {
    syncState.value = { ...syncState.value, syncing: true }
    const ok = applySyncResult(await api.todo.syncNow())
    await refresh()
    return ok
  }

  async function resolveSyncConflict(conflictId: string, keep: 'local' | 'native'): Promise<boolean> {
    const ok = applySyncResult(await api.todo.resolveSyncConflict(conflictId, keep))
    await refresh()
    return ok
  }

  function setView(next: TodoView): void {
    view.value = next
    if (next !== 'group') activeGroupId.value = null
    selectedIds.value = []
  }

  function openGroup(id: string): void {
    view.value = 'group'
    activeGroupId.value = id
    selectedIds.value = []
  }

  function openDetail(id: string | null): void {
    detailId.value = id
  }

  function toggleSelect(id: string): void {
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter(item => item !== id)
      : [...selectedIds.value, id]
  }

  function toggleSelectAllVisible(): void {
    selectedIds.value = allVisibleSelected.value ? [] : sortedTodos.value.map(todo => todo.id)
  }

  function clearSelection(): void {
    selectedIds.value = []
  }

  function clearError(): void {
    error.value = null
  }

  function clearAgentActivity(): void {
    agentActivity.value = []
  }

  /** 输入框引用与「让 Agent 处理」都从这里取最新快照，避免拿到过期标题。 */
  function findTodo(id: string): Todo | null {
    return todos.value.find(todo => todo.id === id) ?? null
  }

  /** 引用候选：搜索命中的未完成待办优先，已完成的垫底。 */
  function searchForReference(query: string, limit = 8): Todo[] {
    const needle = query.trim().toLowerCase()
    const matched = todos.value.filter(todo => matchesSearch(todo, needle))
    return matched.sort(compareSmart).slice(0, limit)
  }

  return {
    todos, groups, loading, loaded, error,
    view, activeGroupId, search, sortMode, selectedIds, detailId, pendingIds,
    activeReminders, agentActivity, agentHighlights, syncState, undoBatch,
    groupById, detailTodo, selectionCount, hasUndo, visibleTodos, sortedTodos, allVisibleSelected,
    counts, overdueCount, openCount, conflictCount,
    subscribe, unsubscribe, load, refresh,
    createTodo, updateTodo, toggleStatus, setPriority, moveToGroup,
    removeTodo, undoRemove, dismissUndo, bulkStatus, bulkRemove, reorder, touchSession,
    createGroup, renameGroup, removeGroup,
    acknowledgeReminder, snoozeReminder, refreshReminders,
    requestSyncAccess, setSyncConfig, syncNow, resolveSyncConflict,
    setView, openGroup, openDetail, toggleSelect, toggleSelectAllVisible, clearSelection,
    clearError, clearAgentActivity, findTodo, searchForReference,
  }
})