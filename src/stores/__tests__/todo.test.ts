import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ActiveTodoReminder,
  Todo,
  TodoAgentOperation,
  TodoChangePayload,
  TodoGroup,
  TodoSyncState,
} from '@/shared/channels/todo'

const todoApi = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  restore: vi.fn(),
  bulkStatus: vi.fn(),
  bulkRemove: vi.fn(),
  reorder: vi.fn(),
  touchSession: vi.fn(),
  listGroups: vi.fn(),
  createGroup: vi.fn(),
  renameGroup: vi.fn(),
  removeGroup: vi.fn(),
  listActiveReminders: vi.fn(),
  acknowledgeReminder: vi.fn(),
  snoozeReminder: vi.fn(),
  getSyncState: vi.fn(),
  requestSyncAccess: vi.fn(),
  setSyncConfig: vi.fn(),
  syncNow: vi.fn(),
  resolveSyncConflict: vi.fn(),
  onChanged: vi.fn(),
  onAgentOperation: vi.fn(),
  onReminderDue: vi.fn(),
  onSyncStateChanged: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({ api: { todo: todoApi } }))

import { useTodoStore } from '../todo'
import { combineDateAndTime, dueBucket, formatDueShort, splitDueAt } from '@/utils/todoTime'

/** 本地时间 10:00，视图边界（今天/明天/7 天）都以此为锚。 */
const NOW = new Date(2026, 10, 14, 10, 0, 0, 0).getTime()
const HOUR = 3600_000
const DAY = 24 * HOUR

function makeTodo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    title: `todo ${overrides.id}`,
    status: 'open',
    priority: 'medium',
    tags: [],
    reminders: [],
    sessionLinks: [],
    orderIndex: 0,
    createdAt: NOW - DAY,
    updatedAt: NOW - HOUR,
    ...overrides,
  }
}

function makeGroup(id: string, name = id): TodoGroup {
  return { id, name, color: 'teal', orderIndex: 0, createdAt: NOW - DAY }
}

function makeSyncState(overrides: Partial<TodoSyncState> = {}): TodoSyncState {
  return {
    supported: true,
    permission: 'granted',
    config: { enabled: true, listId: 'list-1' },
    lists: [{ id: 'list-1', title: 'Reminders', writable: true }],
    conflicts: [],
    syncing: false,
    ...overrides,
  }
}

type Listener<T> = (payload: T) => void
const listeners: {
  changed: Listener<TodoChangePayload>[]
  agent: Listener<TodoAgentOperation>[]
  reminder: Listener<ActiveTodoReminder[]>[]
  sync: Listener<TodoSyncState>[]
} = { changed: [], agent: [], reminder: [], sync: [] }
const offSpies = { changed: vi.fn(), agent: vi.fn(), reminder: vi.fn(), sync: vi.fn() }

function emitChange(payload: TodoChangePayload): void {
  for (const listener of listeners.changed) listener(payload)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  listeners.changed = []
  listeners.agent = []
  listeners.reminder = []
  listeners.sync = []
  setActivePinia(createPinia())

  todoApi.list.mockResolvedValue([])
  todoApi.listGroups.mockResolvedValue([])
  todoApi.listActiveReminders.mockResolvedValue([])
  todoApi.getSyncState.mockResolvedValue(makeSyncState({ supported: false, permission: 'unsupported' }))
  todoApi.get.mockResolvedValue(null)
  todoApi.create.mockResolvedValue({ ok: false, reason: 'not-found' })
  todoApi.update.mockResolvedValue({ ok: false, reason: 'not-found' })
  todoApi.remove.mockResolvedValue({ ok: false, reason: 'not-found' })
  todoApi.restore.mockResolvedValue({ ok: false, reason: 'not-found' })
  todoApi.bulkStatus.mockResolvedValue([])
  todoApi.bulkRemove.mockResolvedValue([])
  todoApi.reorder.mockResolvedValue([])
  todoApi.touchSession.mockResolvedValue(null)
  todoApi.createGroup.mockResolvedValue({ ok: false, reason: 'invalid-name' })
  todoApi.renameGroup.mockResolvedValue({ ok: false, reason: 'not-found' })
  todoApi.removeGroup.mockResolvedValue({ ok: false })
  todoApi.acknowledgeReminder.mockResolvedValue({ ok: true })
  todoApi.snoozeReminder.mockResolvedValue({ ok: true })
  todoApi.requestSyncAccess.mockResolvedValue({ ok: true, state: makeSyncState() })
  todoApi.setSyncConfig.mockResolvedValue({ ok: true, state: makeSyncState() })
  todoApi.syncNow.mockResolvedValue({ ok: true, state: makeSyncState() })
  todoApi.resolveSyncConflict.mockResolvedValue({ ok: true, state: makeSyncState() })

  todoApi.onChanged.mockImplementation((cb: Listener<TodoChangePayload>) => {
    listeners.changed.push(cb)
    return offSpies.changed
  })
  todoApi.onAgentOperation.mockImplementation((cb: Listener<TodoAgentOperation>) => {
    listeners.agent.push(cb)
    return offSpies.agent
  })
  todoApi.onReminderDue.mockImplementation((cb: Listener<ActiveTodoReminder[]>) => {
    listeners.reminder.push(cb)
    return offSpies.reminder
  })
  todoApi.onSyncStateChanged.mockImplementation((cb: Listener<TodoSyncState>) => {
    listeners.sync.push(cb)
    return offSpies.sync
  })
})

afterEach(() => {
  useTodoStore().unsubscribe()
  vi.useRealTimers()
})

describe('todo store — load & subscribe', () => {
  it('loads todos, groups, reminders and sync state in one pass', async () => {
    const todo = makeTodo({ id: 'a' })
    todoApi.list.mockResolvedValue([todo])
    todoApi.listGroups.mockResolvedValue([makeGroup('g1', 'Inbox')])
    todoApi.listActiveReminders.mockResolvedValue([
      { id: 'r1', todoId: 'a', todoTitle: todo.title, priority: 'high', triggerAt: NOW },
    ])
    todoApi.getSyncState.mockResolvedValue(makeSyncState())

    const store = useTodoStore()
    await store.load()

    expect(store.todos).toEqual([todo])
    expect(store.groups.map(g => g.name)).toEqual(['Inbox'])
    expect(store.activeReminders).toHaveLength(1)
    expect(store.syncState.supported).toBe(true)
    expect(store.loaded).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.error).toBeNull()
    expect(todoApi.list).toHaveBeenCalledWith({ limit: 500 })
  })

  it('subscribes once even when the panel mounts repeatedly', async () => {
    const store = useTodoStore()
    await store.load()
    await store.load()
    store.subscribe()
    expect(todoApi.onChanged).toHaveBeenCalledTimes(1)
    expect(todoApi.onReminderDue).toHaveBeenCalledTimes(1)
    expect(listeners.changed).toHaveLength(1)
  })

  it('surfaces load-failed instead of throwing', async () => {
    todoApi.list.mockRejectedValue(new Error('ipc down'))
    const store = useTodoStore()
    await store.load()
    expect(store.error).toBe('load-failed')
    expect(store.loading).toBe(false)
  })

  it('unsubscribe detaches every listener and clears highlights', async () => {
    const store = useTodoStore()
    await store.load()
    for (const listener of listeners.agent) {
      listener({ sessionId: 's1', action: 'updated', todoId: 'a', title: 'x' })
    }
    expect(Object.keys(store.agentHighlights)).toEqual(['a'])
    store.unsubscribe()
    expect(offSpies.changed).toHaveBeenCalledTimes(1)
    expect(offSpies.agent).toHaveBeenCalledTimes(1)
    expect(offSpies.reminder).toHaveBeenCalledTimes(1)
    expect(offSpies.sync).toHaveBeenCalledTimes(1)
    expect(store.agentHighlights).toEqual({})
    store.subscribe()
    expect(todoApi.onChanged).toHaveBeenCalledTimes(2)
  })
})

describe('todo store — views, search, sort', () => {
  async function seed() {
    const store = useTodoStore()
    store.todos = [
      makeTodo({ id: 'overdue', dueAt: NOW - 2 * HOUR, title: '修复登录' }),
      makeTodo({ id: 'today', dueAt: NOW + 3 * HOUR, notes: '写回归测试' }),
      makeTodo({ id: 'tomorrow', dueAt: NOW + DAY }),
      makeTodo({ id: 'later', dueAt: NOW + 30 * DAY, tags: ['inbox'] }),
      makeTodo({ id: 'someday' }),
      makeTodo({ id: 'done', status: 'completed', completedAt: NOW - HOUR }),
      makeTodo({ id: 'grouped', groupId: 'g1', title: '分组里的' }),
    ]
    store.groups = [makeGroup('g1', '工作')]
    return store
  }

  it('all view shows only open items', async () => {
    const store = await seed()
    expect(store.sortedTodos.map(t => t.id)).not.toContain('done')
    expect(store.sortedTodos).toHaveLength(6)
  })

  it('today view includes overdue but not tomorrow', async () => {
    const store = await seed()
    store.setView('today')
    expect(store.sortedTodos.map(t => t.id).sort()).toEqual(['overdue', 'today'])
    expect(store.counts.overdue).toBe(1)
  })

  it('upcoming view is the next seven days, excluding today', async () => {
    const store = await seed()
    store.setView('upcoming')
    expect(store.sortedTodos.map(t => t.id)).toEqual(['tomorrow'])
  })

  it('completed view shows finished items only', async () => {
    const store = await seed()
    store.setView('completed')
    expect(store.sortedTodos.map(t => t.id)).toEqual(['done'])
  })

  it('group view is scoped to the active group and keeps completed visible', async () => {
    const store = await seed()
    store.todos.push(makeTodo({ id: 'grouped-done', groupId: 'g1', status: 'completed' }))
    store.openGroup('g1')
    expect(store.sortedTodos.map(t => t.id)).toEqual(['grouped', 'grouped-done'])
    store.setView('all')
    expect(store.activeGroupId).toBeNull()
  })

  it('search matches title, notes and tags case-insensitively', async () => {
    const store = await seed()
    store.search = '修复'
    expect(store.sortedTodos.map(t => t.id)).toEqual(['overdue'])
    store.search = '回归'
    expect(store.sortedTodos.map(t => t.id)).toEqual(['today'])
    store.search = 'INBOX'
    expect(store.sortedTodos.map(t => t.id)).toEqual(['later'])
    store.search = '   '
    expect(store.sortedTodos).toHaveLength(6)
  })

  it('smart sort puts dated work first and undated last', async () => {
    const store = await seed()
    expect(store.sortedTodos.map(t => t.id)).toEqual([
      'overdue', 'today', 'tomorrow', 'later', 'someday', 'grouped',
    ])
  })

  it('manual sort follows orderIndex', async () => {
    const store = await seed()
    store.todos = store.todos.map((todo, index) => ({ ...todo, orderIndex: 100 - index }))
    store.sortMode = 'manual'
    expect(store.sortedTodos[0].id).toBe('grouped')
  })

  it('priority, created and title sorts are live', async () => {
    const store = await seed()
    store.todos = store.todos.map(todo => ({
      ...todo,
      priority: todo.id === 'someday' ? 'high' : 'low',
      createdAt: todo.id === 'today' ? NOW : NOW - DAY,
    }))
    store.sortMode = 'priority'
    expect(store.sortedTodos[0].id).toBe('someday')
    store.sortMode = 'created'
    expect(store.sortedTodos[0].id).toBe('today')
    store.sortMode = 'title'
    expect(store.sortedTodos.map(t => t.title)).toEqual([...store.sortedTodos.map(t => t.title)].sort((a, b) => a.localeCompare(b)))
    store.sortMode = 'due'
    expect(store.sortedTodos[0].id).toBe('overdue')
  })

  it('counts feed the sidebar badges', async () => {
    const store = await seed()
    expect(store.counts.all).toBe(6)
    expect(store.counts.today).toBe(2)
    expect(store.counts.upcoming).toBe(1)
    expect(store.counts.completed).toBe(1)
    expect(store.counts.byGroup.get('g1')).toBe(1)
    expect(store.counts.ungrouped).toBe(5)
    expect(store.openCount).toBe(6)
    expect(store.overdueCount).toBe(1)
  })
})

describe('todo store — optimistic mutations', () => {
  it('create shows the row before the IPC round-trip and swaps in the server record', async () => {
    const store = useTodoStore()
    const server = makeTodo({ id: 'real', title: '新任务' })
    let resolveCreate!: (value: unknown) => void
    todoApi.create.mockReturnValue(new Promise(resolve => { resolveCreate = resolve }))

    const pending = store.createTodo({ title: '新任务' })
    expect(store.todos).toHaveLength(1)
    expect(store.todos[0].title).toBe('新任务')
    expect(store.pendingIds).toEqual([store.todos[0].id])

    resolveCreate({ ok: true, todo: server })
    await pending
    expect(store.todos).toEqual([server])
    expect(store.pendingIds).toEqual([])
  })

  it('create failure removes the optimistic row and reports the reason', async () => {
    const store = useTodoStore()
    todoApi.create.mockResolvedValue({ ok: false, reason: 'invalid-title' })
    const created = await store.createTodo({ title: '   ' })
    expect(created).toBeNull()
    expect(store.todos).toEqual([])
    expect(store.error).toBe('invalid-title')
  })

  it('update applies locally then reconciles with the server snapshot', async () => {
    const store = useTodoStore()
    store.todos = [makeTodo({ id: 'a', title: '旧标题' })]
    todoApi.update.mockResolvedValue({ ok: true, todo: makeTodo({ id: 'a', title: '新标题', updatedAt: NOW }) })

    const pending = store.updateTodo({ id: 'a', title: '新标题' })
    expect(store.todos[0].title).toBe('新标题')
    expect(store.pendingIds).toEqual(['a'])
    await pending

    expect(todoApi.update).toHaveBeenCalledWith({ id: 'a', title: '新标题', expectedUpdatedAt: NOW - HOUR })
    expect(store.todos[0].updatedAt).toBe(NOW)
    expect(store.pendingIds).toEqual([])
  })

  it('conflict rolls back and pulls the authoritative record', async () => {
    const store = useTodoStore()
    const local = makeTodo({ id: 'a', title: '本地' })
    const remote = makeTodo({ id: 'a', title: 'Agent 改过的', updatedAt: NOW })
    store.todos = [local]
    todoApi.update.mockResolvedValue({ ok: false, reason: 'conflict' })
    todoApi.get.mockResolvedValue(remote)

    const result = await store.updateTodo({ id: 'a', title: '我改的' })
    expect(result).toBeNull()
    expect(store.error).toBe('conflict')
    expect(store.todos[0]).toEqual(remote)
  })

  it('read-only rejection restores the previous row without a refetch', async () => {
    const store = useTodoStore()
    const local = makeTodo({ id: 'a', title: '只读' })
    store.todos = [local]
    todoApi.update.mockResolvedValue({ ok: false, reason: 'read-only' })
    await store.updateTodo({ id: 'a', title: '改不动' })
    expect(store.todos[0]).toEqual(local)
    expect(store.error).toBe('read-only')
    expect(todoApi.get).not.toHaveBeenCalled()
  })

  it('dueAt null clears the date locally', async () => {
    const store = useTodoStore()
    store.todos = [makeTodo({ id: 'a', dueAt: NOW })]
    todoApi.update.mockResolvedValue({ ok: true, todo: makeTodo({ id: 'a' }) })
    const pending = store.updateTodo({ id: 'a', dueAt: null })
    expect(store.todos[0].dueAt).toBeUndefined()
    await pending
  })

  it('toggleStatus flips open → completed → open', async () => {
    const store = useTodoStore()
    const todo = makeTodo({ id: 'a' })
    store.todos = [todo]
    todoApi.update.mockResolvedValue({ ok: true, todo: { ...todo, status: 'completed' } })
    await store.toggleStatus(todo)
    expect(todoApi.update).toHaveBeenCalledWith({ id: 'a', status: 'completed', expectedUpdatedAt: todo.updatedAt })
    expect(store.todos[0].status).toBe('completed')
  })

  it('setPriority and moveToGroup go through the same update path', async () => {
    const store = useTodoStore()
    store.todos = [makeTodo({ id: 'a' })]
    todoApi.update.mockResolvedValue({ ok: true, todo: makeTodo({ id: 'a', priority: 'high', groupId: 'g1' }) })
    await store.setPriority('a', 'high')
    await store.moveToGroup('a', 'g1')
    expect(todoApi.update).toHaveBeenNthCalledWith(1, expect.objectContaining({ priority: 'high' }))
    expect(todoApi.update).toHaveBeenNthCalledWith(2, expect.objectContaining({ groupId: 'g1' }))
    expect(store.todos[0].groupId).toBe('g1')
  })

  it('touchSession merges the session trace', async () => {
    const store = useTodoStore()
    store.todos = [makeTodo({ id: 'a' })]
    todoApi.touchSession.mockResolvedValue(
      makeTodo({ id: 'a', sessionLinks: [{ sessionId: 's1', firstTouchedAt: NOW, lastTouchedAt: NOW }] }),
    )
    await store.touchSession('a', 's1')
    expect(store.todos[0].sessionLinks).toHaveLength(1)
  })
})

describe('todo store — delete, undo, bulk, reorder', () => {
  it('remove hides the row immediately and offers undo', async () => {
    const store = useTodoStore()
    const todo = makeTodo({ id: 'a' })
    store.todos = [todo]
    store.detailId = 'a'
    store.selectedIds = ['a']
    todoApi.remove.mockResolvedValue({ ok: true, removed: todo })

    expect(await store.removeTodo('a')).toBe(true)
    expect(store.todos).toEqual([])
    expect(store.detailId).toBeNull()
    expect(store.selectedIds).toEqual([])
    expect(store.hasUndo).toBe(true)
    expect(store.undoBatch?.todos).toEqual([todo])
  })

  it('failed remove puts the row back', async () => {
    const store = useTodoStore()
    const todo = makeTodo({ id: 'a' })
    store.todos = [todo]
    todoApi.remove.mockResolvedValue({ ok: false, reason: 'read-only' })
    expect(await store.removeTodo('a')).toBe(false)
    expect(store.todos).toEqual([todo])
    expect(store.error).toBe('read-only')
    expect(store.hasUndo).toBe(false)
  })

  it('undo restores the full snapshot including id and links', async () => {
    const store = useTodoStore()
    const todo = makeTodo({
      id: 'a',
      sessionLinks: [{ sessionId: 's1', firstTouchedAt: NOW, lastTouchedAt: NOW }],
    })
    store.todos = [todo]
    todoApi.remove.mockResolvedValue({ ok: true, removed: todo })
    todoApi.restore.mockResolvedValue({ ok: true, todo })

    await store.removeTodo('a')
    await store.undoRemove()
    expect(todoApi.restore).toHaveBeenCalledWith(todo)
    expect(store.todos).toEqual([todo])
    expect(store.hasUndo).toBe(false)
  })

  it('undo window expires on its own', async () => {
    const store = useTodoStore()
    const todo = makeTodo({ id: 'a' })
    store.todos = [todo]
    todoApi.remove.mockResolvedValue({ ok: true, removed: todo })
    await store.removeTodo('a')
    vi.advanceTimersByTime(10_001)
    expect(store.hasUndo).toBe(false)
  })

  it('dismissUndo drops the batch without restoring', async () => {
    const store = useTodoStore()
    const todo = makeTodo({ id: 'a' })
    store.todos = [todo]
    todoApi.remove.mockResolvedValue({ ok: true, removed: todo })
    await store.removeTodo('a')
    store.dismissUndo()
    await store.undoRemove()
    expect(todoApi.restore).not.toHaveBeenCalled()
  })

  it('failed restore removes the row again rather than lying about it', async () => {
    const store = useTodoStore()
    const todo = makeTodo({ id: 'a' })
    store.todos = [todo]
    todoApi.remove.mockResolvedValue({ ok: true, removed: todo })
    todoApi.restore.mockResolvedValue({ ok: false, reason: 'not-found' })
    await store.removeTodo('a')
    await store.undoRemove()
    expect(store.todos).toEqual([])
    expect(store.error).toBe('not-found')
  })

  it('bulkStatus rolls back rows the main process refused (read-only list)', async () => {
    const store = useTodoStore()
    const writable = makeTodo({ id: 'a' })
    const readOnly = makeTodo({ id: 'b' })
    store.todos = [writable, readOnly]
    store.selectedIds = ['a', 'b']
    todoApi.bulkStatus.mockResolvedValue([{ ...writable, status: 'completed' }])

    await store.bulkStatus(['a', 'b'], 'completed')
    expect(store.todos.find(t => t.id === 'a')?.status).toBe('completed')
    expect(store.todos.find(t => t.id === 'b')?.status).toBe('open')
    expect(store.selectedIds).toEqual([])
  })

  it('bulkRemove keeps refused rows and undoes the rest', async () => {
    const store = useTodoStore()
    const a = makeTodo({ id: 'a' })
    const b = makeTodo({ id: 'b' })
    store.todos = [a, b]
    todoApi.bulkRemove.mockResolvedValue([a])
    todoApi.restore.mockResolvedValue({ ok: true, todo: a })

    await store.bulkRemove(['a', 'b'])
    expect(store.todos.map(t => t.id)).toEqual(['b'])
    expect(store.undoBatch?.todos).toEqual([a])
    await store.undoRemove()
    expect(store.todos.map(t => t.id).sort()).toEqual(['a', 'b'])
  })

  it('empty bulk calls are no-ops', async () => {
    const store = useTodoStore()
    await store.bulkStatus([], 'completed')
    await store.bulkRemove([])
    expect(todoApi.bulkStatus).not.toHaveBeenCalled()
    expect(todoApi.bulkRemove).not.toHaveBeenCalled()
  })

  it('reorder switches to manual and applies the new indices', async () => {
    const store = useTodoStore()
    store.todos = [makeTodo({ id: 'a', orderIndex: 0 }), makeTodo({ id: 'b', orderIndex: 1 })]
    todoApi.reorder.mockResolvedValue([
      makeTodo({ id: 'a', orderIndex: 1 }),
      makeTodo({ id: 'b', orderIndex: 0 }),
    ])
    await store.reorder(['b', 'a'])
    expect(store.sortMode).toBe('manual')
    expect(store.sortedTodos.map(t => t.id)).toEqual(['b', 'a'])
  })

  it('reorder failure restores the previous order', async () => {
    const store = useTodoStore()
    const original = [makeTodo({ id: 'a', orderIndex: 0 }), makeTodo({ id: 'b', orderIndex: 1 })]
    store.todos = original
    todoApi.reorder.mockResolvedValue([])
    await store.reorder(['b', 'a'])
    expect(store.todos).toEqual(original)
  })
})

describe('todo store — groups', () => {
  it('creates a group and reports duplicate names', async () => {
    const store = useTodoStore()
    todoApi.createGroup.mockResolvedValue({ ok: true, group: makeGroup('g1', '工作') })
    expect((await store.createGroup('工作', 'teal'))?.id).toBe('g1')
    expect(store.groups).toHaveLength(1)

    todoApi.createGroup.mockResolvedValue({ ok: false, reason: 'duplicate-name' })
    expect(await store.createGroup('工作')).toBeNull()
    expect(store.error).toBe('duplicate-name')
    expect(store.groups).toHaveLength(1)
  })

  it('renames a group in place', async () => {
    const store = useTodoStore()
    store.groups = [makeGroup('g1', '旧名')]
    todoApi.renameGroup.mockResolvedValue({ ok: true, group: makeGroup('g1', '新名') })
    expect(await store.renameGroup('g1', '新名')).toBe(true)
    expect(store.groups[0].name).toBe('新名')
  })

  it('removing a group ungroups its todos and leaves the group view', async () => {
    const store = useTodoStore()
    store.groups = [makeGroup('g1')]
    store.todos = [makeTodo({ id: 'a', groupId: 'g1' })]
    store.openGroup('g1')
    todoApi.removeGroup.mockResolvedValue({ ok: true })

    expect(await store.removeGroup('g1')).toBe(true)
    expect(store.groups).toEqual([])
    expect(store.todos[0].groupId).toBeUndefined()
    expect(store.view).toBe('all')
    expect(store.activeGroupId).toBeNull()
  })

  it('failed group removal changes nothing', async () => {
    const store = useTodoStore()
    store.groups = [makeGroup('g1')]
    todoApi.removeGroup.mockResolvedValue({ ok: false })
    expect(await store.removeGroup('g1')).toBe(false)
    expect(store.groups).toHaveLength(1)
  })
})

describe('todo store — pushed events', () => {
  it('upserts and removes from a change payload, closing detail and selection', async () => {
    const store = useTodoStore()
    await store.load()
    store.todos = [makeTodo({ id: 'a' }), makeTodo({ id: 'b' })]
    store.detailId = 'b'
    store.selectedIds = ['b']

    emitChange({ todos: [makeTodo({ id: 'c', title: 'Agent 新建' })], source: 'agent' })
    expect(store.todos.map(t => t.id)).toEqual(['a', 'b', 'c'])
    expect(store.agentHighlights.c).toBeTypeOf('number')

    emitChange({ removedIds: ['b'], source: 'sync' })
    expect(store.todos.map(t => t.id)).toEqual(['a', 'c'])
    expect(store.detailId).toBeNull()
    expect(store.selectedIds).toEqual([])
  })

  it('clears the pending flag when the server snapshot lands', async () => {
    const store = useTodoStore()
    store.subscribe()
    store.todos = [makeTodo({ id: 'a' })]
    store.pendingIds = ['a']
    emitChange({ todos: [makeTodo({ id: 'a', title: '落盘' })], source: 'user' })
    expect(store.pendingIds).toEqual([])
  })

  it('merges groups and falls back to all when the active group disappears', async () => {
    const store = useTodoStore()
    await store.load()
    emitChange({ groups: [makeGroup('g1'), makeGroup('g2')], source: 'user' })
    store.openGroup('g2')
    emitChange({ removedGroupIds: ['g2'], source: 'user' })
    expect(store.groups.map(g => g.id)).toEqual(['g1'])
    expect(store.view).toBe('all')
  })

  it('agent highlight fades after its window', async () => {
    const store = useTodoStore()
    await store.load()
    emitChange({ todos: [makeTodo({ id: 'a' })], source: 'agent' })
    expect(store.agentHighlights.a).toBeDefined()
    vi.advanceTimersByTime(6001)
    expect(store.agentHighlights.a).toBeUndefined()
  })

  it('records agent activity newest-first and caps the log', async () => {
    const store = useTodoStore()
    await store.load()
    for (let i = 0; i < 35; i++) {
      for (const listener of listeners.agent) {
        listener({ sessionId: 's1', action: 'created', todoId: `t${i}`, title: `任务 ${i}` })
      }
    }
    expect(store.agentActivity).toHaveLength(30)
    expect(store.agentActivity[0].todoId).toBe('t34')
    store.clearAgentActivity()
    expect(store.agentActivity).toEqual([])
  })

  it('reminder pushes replace the active set (main sends the whole table)', async () => {
    const store = useTodoStore()
    await store.load()
    const first: ActiveTodoReminder = { id: 'r1', todoId: 'a', todoTitle: 'A', priority: 'high', triggerAt: NOW }
    const second: ActiveTodoReminder = { id: 'r2', todoId: 'b', todoTitle: 'B', priority: 'low', triggerAt: NOW - HOUR }
    for (const listener of listeners.reminder) listener([first, second])
    expect(store.activeReminders.map(r => r.id)).toEqual(['r2', 'r1'])
    for (const listener of listeners.reminder) listener([first])
    expect(store.activeReminders.map(r => r.id)).toEqual(['r1'])
  })

  it('sync state pushes land in the store and drive the conflict badge', async () => {
    const store = useTodoStore()
    await store.load()
    const state = makeSyncState({
      conflicts: [{
        id: 'c1', todoId: 'a', todoTitle: '本地', nativeTitle: '系统', kind: 'changed',
        localUpdatedAt: NOW, detectedAt: NOW,
      }],
    })
    for (const listener of listeners.sync) listener(state)
    expect(store.syncState).toEqual(state)
    expect(store.conflictCount).toBe(1)
  })
})

describe('todo store — reminders & sync actions', () => {
  it('acknowledge drops the card and refetches when main refuses', async () => {
    const store = useTodoStore()
    store.activeReminders = [{ id: 'r1', todoId: 'a', todoTitle: 'A', priority: 'medium', triggerAt: NOW }]
    await store.acknowledgeReminder('a', 'r1')
    expect(store.activeReminders).toEqual([])

    store.activeReminders = [{ id: 'r2', todoId: 'a', todoTitle: 'A', priority: 'medium', triggerAt: NOW }]
    todoApi.acknowledgeReminder.mockResolvedValue({ ok: false })
    todoApi.listActiveReminders.mockResolvedValue([
      { id: 'r2', todoId: 'a', todoTitle: 'A', priority: 'medium', triggerAt: NOW },
    ])
    await store.acknowledgeReminder('a', 'r2')
    expect(store.activeReminders.map(r => r.id)).toEqual(['r2'])
  })

  it('snooze merges the updated todo so the next trigger shows up', async () => {
    const store = useTodoStore()
    store.todos = [makeTodo({ id: 'a' })]
    store.activeReminders = [{ id: 'r1', todoId: 'a', todoTitle: 'A', priority: 'medium', triggerAt: NOW }]
    todoApi.get.mockResolvedValue(
      makeTodo({ id: 'a', reminders: [{ id: 'r1', triggerAt: NOW, status: 'pending', origin: 'manual', snoozedUntil: NOW + 10 * 60_000 }] }),
    )
    await store.snoozeReminder('a', 'r1', 10)
    expect(todoApi.snoozeReminder).toHaveBeenCalledWith('a', 'r1', 10)
    expect(store.activeReminders).toEqual([])
    expect(store.todos[0].reminders[0].snoozedUntil).toBe(NOW + 10 * 60_000)
  })

  it('syncNow flips syncing, applies the returned state and reloads the table', async () => {
    const store = useTodoStore()
    store.todos = []
    todoApi.list.mockResolvedValue([makeTodo({ id: 'from-mac' })])
    let resolveSync!: (value: unknown) => void
    todoApi.syncNow.mockReturnValue(new Promise(resolve => { resolveSync = resolve }))

    const pending = store.syncNow()
    expect(store.syncState.syncing).toBe(true)
    resolveSync({ ok: true, state: makeSyncState({ lastSyncAt: NOW }) })
    expect(await pending).toBe(true)
    expect(store.syncState.syncing).toBe(false)
    expect(store.syncState.lastSyncAt).toBe(NOW)
    expect(store.todos.map(t => t.id)).toEqual(['from-mac'])
  })

  it('sync failure surfaces sync-failed with the returned state', async () => {
    const store = useTodoStore()
    todoApi.requestSyncAccess.mockResolvedValue({
      ok: false, error: 'permission-denied', state: makeSyncState({ permission: 'denied' }),
    })
    expect(await store.requestSyncAccess()).toBe(false)
    expect(store.error).toBe('sync-failed')
    expect(store.syncState.permission).toBe('denied')
  })

  it('setSyncConfig and resolveSyncConflict refresh the table', async () => {
    const store = useTodoStore()
    todoApi.list.mockResolvedValue([makeTodo({ id: 'a' })])
    expect(await store.setSyncConfig({ enabled: true, listId: 'list-1' })).toBe(true)
    expect(todoApi.setSyncConfig).toHaveBeenCalledWith({ enabled: true, listId: 'list-1' })
    expect(await store.resolveSyncConflict('c1', 'native')).toBe(true)
    expect(todoApi.resolveSyncConflict).toHaveBeenCalledWith('c1', 'native')
    expect(store.todos.map(t => t.id)).toEqual(['a'])
    expect(store.error).toBeNull()
  })
})

describe('todo store — selection & reference helpers', () => {
  it('selection toggles, selects all visible and clears on view change', async () => {
    const store = useTodoStore()
    store.todos = [makeTodo({ id: 'a' }), makeTodo({ id: 'b' })]
    store.toggleSelect('a')
    expect(store.selectedIds).toEqual(['a'])
    store.toggleSelect('a')
    expect(store.selectedIds).toEqual([])
    store.toggleSelectAllVisible()
    expect(store.allVisibleSelected).toBe(true)
    expect(store.selectionCount).toBe(2)
    store.toggleSelectAllVisible()
    expect(store.selectedIds).toEqual([])
    store.toggleSelect('a')
    store.setView('today')
    expect(store.selectedIds).toEqual([])
    store.toggleSelect('a')
    store.clearSelection()
    expect(store.selectedIds).toEqual([])
  })

  it('detailTodo tracks the open row and vanishes with it', async () => {
    const store = useTodoStore()
    store.subscribe()
    store.todos = [makeTodo({ id: 'a' })]
    store.openDetail('a')
    expect(store.detailTodo?.id).toBe('a')
    emitChange({ removedIds: ['a'], source: 'agent' })
    expect(store.detailTodo).toBeNull()
    store.openDetail(null)
    expect(store.detailId).toBeNull()
  })

  it('groupById resolves row chips', async () => {
    const store = useTodoStore()
    store.groups = [makeGroup('g1', '工作')]
    expect(store.groupById.get('g1')?.name).toBe('工作')
  })

  it('reference search returns open work first and honours the limit', async () => {
    const store = useTodoStore()
    store.todos = [
      makeTodo({ id: 'done', title: '引用 已完成', status: 'completed' }),
      makeTodo({ id: 'later', title: '引用 无期限' }),
      makeTodo({ id: 'soon', title: '引用 今天', dueAt: NOW + HOUR }),
    ]
    expect(store.searchForReference('引用').map(t => t.id)).toEqual(['soon', 'later', 'done'])
    expect(store.searchForReference('引用', 1).map(t => t.id)).toEqual(['soon'])
    expect(store.searchForReference('不存在')).toEqual([])
    expect(store.findTodo('soon')?.id).toBe('soon')
    expect(store.findTodo('missing')).toBeNull()
  })

  it('clearError dismisses the banner', async () => {
    const store = useTodoStore()
    store.error = 'conflict'
    store.clearError()
    expect(store.error).toBeNull()
  })
})

describe('todo time helpers', () => {
  it('split and combine round-trip in local time', () => {
    const ms = combineDateAndTime('2026-11-14', '09:30')
    expect(ms).not.toBeNull()
    expect(splitDueAt(ms as number)).toEqual({ date: '2026-11-14', time: '09:30' })
  })

  it('date-only defaults to 09:00 so a fresh todo is not instantly overdue', () => {
    const ms = combineDateAndTime('2026-11-14', '')
    expect(splitDueAt(ms as number).time).toBe('09:00')
  })

  it('rejects malformed dates and impossible times', () => {
    expect(combineDateAndTime('2026/11/14', '09:00')).toBeNull()
    expect(combineDateAndTime('', '09:00')).toBeNull()
    expect(combineDateAndTime('2026-11-14', '25:00')).toBeNull()
  })

  it('buckets drive the row label', () => {
    expect(dueBucket(makeTodo({ id: 'a', dueAt: NOW - HOUR }), NOW)).toBe('overdue')
    expect(dueBucket(makeTodo({ id: 'a', dueAt: NOW + HOUR }), NOW)).toBe('today')
    expect(dueBucket(makeTodo({ id: 'a', dueAt: NOW + DAY }), NOW)).toBe('tomorrow')
    expect(dueBucket(makeTodo({ id: 'a', dueAt: NOW + 3 * DAY }), NOW)).toBe('week')
    expect(dueBucket(makeTodo({ id: 'a', dueAt: NOW + 40 * DAY }), NOW)).toBe('later')
    expect(dueBucket(makeTodo({ id: 'a' }), NOW)).toBe('none')
    // 已完成的过期项不该继续标红
    expect(dueBucket(makeTodo({ id: 'a', dueAt: NOW - HOUR, status: 'completed' }), NOW)).toBe('today')
  })

  it('short due format drops the date for today and keeps the year across new year', () => {
    expect(formatDueShort(NOW + HOUR, NOW, 'zh-CN')).toBe('11:00')
    expect(formatDueShort(NOW + 2 * DAY, NOW, 'zh-CN')).toContain('16')
    expect(formatDueShort(new Date(2027, 0, 2, 8, 0).getTime(), NOW, 'en-US')).toContain('2027')
  })
})