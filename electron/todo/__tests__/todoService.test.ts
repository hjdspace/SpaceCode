// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTodoStore, type TodoStore } from '../todoStore'
import { createTodoService, type TodoService } from '../todoService'
import type { TodoSyncController, TodoSyncEvent } from '../remindersSync'
import type { ActiveTodoReminder, Todo, TodoChangePayload, TodoSyncState } from '@/shared/channels/todo'
import { todoNamespace } from '@/shared/channels/todo'

let dir: string
let store: TodoStore
let clock: number
let sent: Array<{ channel: string; args: unknown[] }>
let notified: Array<{ reminder: ActiveTodoReminder; locale: string }>
let service: TodoService
let sync: FakeSync

const SYNC_STATE: TodoSyncState = {
  supported: false,
  permission: 'unsupported',
  config: { enabled: false, listId: null },
  lists: [],
  conflicts: [],
  syncing: false,
}

interface FakeSync extends TodoSyncController {
  deleted: Todo[][]
  restored: Todo[][]
  emit(event: TodoSyncEvent): void
}

function fakeSync(): FakeSync {
  const listeners = new Set<(event: TodoSyncEvent) => void>()
  const controller: FakeSync = {
    deleted: [],
    restored: [],
    getState: () => SYNC_STATE,
    requestAccess: vi.fn(async () => ({ ok: true as const, state: SYNC_STATE })),
    setConfig: vi.fn(async () => ({ ok: true as const, state: SYNC_STATE })),
    syncNow: vi.fn(async () => ({ ok: true as const, state: SYNC_STATE })),
    resolveConflict: vi.fn(async () => ({ ok: true as const, state: SYNC_STATE })),
    noteLocalDeletions: todos => { controller.deleted.push(todos) },
    noteLocalRestorations: todos => { controller.restored.push(todos) },
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    start: vi.fn(),
    stop: vi.fn(),
    emit: event => { for (const listener of listeners) listener(event) },
  }
  return controller
}

function changes(): TodoChangePayload[] {
  return sent.filter(s => s.channel === 'todo:changed').map(s => s.args[0] as TodoChangePayload)
}

function reminderSnapshots(): ActiveTodoReminder[][] {
  return sent.filter(s => s.channel === 'todo:reminder-due').map(s => s.args[0] as ActiveTodoReminder[])
}

function make(title: string, extra: Partial<Parameters<TodoStore['create']>[0]> = {}): Todo {
  const result = store.create({ title, ...extra })
  if (!result.ok) throw new Error(result.reason)
  return result.todo
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spacecode-todo-service-'))
  clock = new Date(2026, 10, 13, 9, 0).getTime()
  store = createTodoStore({ filePath: join(dir, 'todos.json'), now: () => clock })
  sent = []
  notified = []
  sync = fakeSync()
  service = createTodoService({
    store,
    sync,
    send: (channel, ...args) => sent.push({ channel, args }),
    notify: (reminder, locale) => notified.push({ reminder, locale }),
    getLocale: () => 'en-US',
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('user mutations broadcast', () => {
  it('broadcasts a created todo with source=user', async () => {
    const result = await service.handlers.create({ title: '写发布说明' })
    if (!result.ok) throw new Error(result.reason)
    expect(changes()).toEqual([{ todos: [result.todo], source: 'user' }])
  })

  it('stays silent when a mutation is rejected', async () => {
    await service.handlers.create({ title: '  ' })
    await service.handlers.update({ id: 'ghost', title: 'x' })
    await service.handlers.remove('ghost')
    await service.handlers.bulkStatus(['ghost'], 'completed')
    await service.handlers.bulkRemove(['ghost'])
    await service.handlers.createGroup('')
    expect(sent).toEqual([])
  })

  it('broadcasts removals and feeds the sync tombstones', async () => {
    const todo = make('a')
    const removed = await service.handlers.remove(todo.id)
    if (!removed.ok) throw new Error(removed.reason)
    expect(changes()).toEqual([{ removedIds: [todo.id], source: 'user' }])
    expect(sync.deleted).toEqual([[todo]])

    const restored = await service.handlers.restore(removed.removed)
    if (!restored.ok) throw new Error(restored.reason)
    expect(sync.restored).toEqual([[todo]])
    expect(changes()[1]).toEqual({ todos: [todo], source: 'user' })
  })

  it('feeds bulk removals to the sync layer too', async () => {
    const a = make('a')
    const b = make('b')
    await service.handlers.bulkRemove([a.id, b.id])
    expect(sync.deleted).toEqual([[a, b]])
    expect(changes()[0].removedIds).toEqual([a.id, b.id])
  })

  it('returns the whole table after removing a group so unassigned todos update', async () => {
    const group = await service.handlers.createGroup('工作')
    if (!group.ok) throw new Error(group.reason)
    const todo = make('a', { groupId: group.group.id })
    await service.handlers.removeGroup(group.group.id)
    const last = changes()[changes().length - 1]
    expect(last.removedGroupIds).toEqual([group.group.id])
    expect(last.todos?.[0].id).toBe(todo.id)
    expect(last.todos?.[0].groupId).toBeUndefined()
  })

  it('broadcasts group create/rename and manual reorder', async () => {
    const group = await service.handlers.createGroup('工作')
    if (!group.ok) throw new Error(group.reason)
    await service.handlers.renameGroup(group.group.id, '项目')
    expect(changes()[1].groups?.[0].name).toBe('项目')
    const a = make('a')
    const b = make('b')
    const reordered = await service.handlers.reorder([b.id, a.id])
    expect(reordered.find(t => t.id === b.id)?.orderIndex).toBe(0)
    expect(changes()[2].todos).toHaveLength(2)
  })

  it('broadcasts a session touch', async () => {
    const todo = make('a')
    const touched = await service.handlers.touchSession(todo.id, 's1')
    expect(touched?.sessionLinks[0].sessionId).toBe('s1')
    expect(changes()[0].todos?.[0].sessionLinks[0].sessionId).toBe('s1')
  })
})

describe('reminder scheduling', () => {
  it('notifies once per reminder and pushes the active snapshot', async () => {
    const todo = make('交周报', { reminders: [clock - 1_000] })
    const claimed = service.tick()
    expect(claimed).toHaveLength(1)
    expect(notified).toEqual([{ reminder: claimed[0], locale: 'en-US' }])
    expect(reminderSnapshots()).toEqual([claimed])
    expect(store.get(todo.id)?.reminders[0].lastNotifiedAt).toBe(clock)

    expect(service.tick()).toEqual([])
    expect(notified).toHaveLength(1)
    // 集合没变就不重复推送
    expect(reminderSnapshots()).toHaveLength(1)
  })

  it('drops the reminder from the rail when the todo is completed', async () => {
    const todo = make('a', { reminders: [clock - 1] })
    service.tick()
    await service.handlers.update({ id: todo.id, status: 'completed' })
    const snapshots = reminderSnapshots()
    expect(snapshots[snapshots.length - 1]).toEqual([])
  })

  it('acknowledging removes it, snoozing re-arms it later', async () => {
    const todo = make('a', { reminders: [clock - 1] })
    service.tick()
    const reminderId = store.get(todo.id)!.reminders[0].id
    expect(await service.handlers.acknowledgeReminder(todo.id, reminderId)).toEqual({ ok: true })
    expect(reminderSnapshots()[reminderSnapshots().length - 1]).toEqual([])

    expect(await service.handlers.snoozeReminder(todo.id, reminderId, 5)).toEqual({ ok: true })
    clock += 5 * 60_000
    expect(service.tick()).toHaveLength(1)
    expect(notified).toHaveLength(2)
  })

  it('rejects an out-of-range snooze without publishing', async () => {
    const todo = make('a', { reminders: [clock - 1] })
    service.tick()
    const before = sent.length
    expect(await service.handlers.snoozeReminder(todo.id, 'ghost', 5)).toEqual({ ok: false })
    expect(await service.handlers.snoozeReminder(todo.id, store.get(todo.id)!.reminders[0].id, 0)).toEqual({ ok: false })
    expect(sent).toHaveLength(before)
  })

  it('keeps ticking when a notification throws', () => {
    const failing = createTodoService({
      store,
      sync,
      send: (channel, ...args) => sent.push({ channel, args }),
      notify: () => { throw new Error('no notification daemon') },
    })
    make('a', { reminders: [clock - 1] })
    expect(failing.tick()).toHaveLength(1)
  })

  it('lists active reminders on demand', async () => {
    make('a', { reminders: [clock - 1] })
    expect(await service.handlers.listActiveReminders()).toHaveLength(1)
  })
})

describe('sync wiring', () => {
  it('forwards state events and todo patches from the sync layer', () => {
    const todo = make('a')
    sync.emit({ kind: 'state', state: { ...SYNC_STATE, supported: true } })
    expect(sent[sent.length - 1]?.channel).toBe('todo:sync-state')

    sync.emit({ kind: 'todos', patch: { upserts: [todo], removedIds: [] } })
    expect(changes()[changes().length - 1]).toEqual({ todos: [todo], removedIds: [], source: 'sync' })

    const count = sent.length
    sync.emit({ kind: 'todos', patch: { upserts: [], removedIds: [] } })
    expect(sent).toHaveLength(count)
  })

  it('delegates the sync channels', async () => {
    expect(await service.handlers.getSyncState()).toEqual(SYNC_STATE)
    await service.handlers.requestSyncAccess()
    await service.handlers.setSyncConfig({ enabled: true })
    await service.handlers.syncNow()
    await service.handlers.resolveSyncConflict('c1', 'local')
    expect(sync.requestAccess).toHaveBeenCalled()
    expect(sync.setConfig).toHaveBeenCalledWith({ enabled: true })
    expect(sync.syncNow).toHaveBeenCalled()
    expect(sync.resolveConflict).toHaveBeenCalledWith('c1', 'local')
  })

  it('implements every declared channel', () => {
    // registerHandlers 只注册存在的 key：名字对不上的通道会被静默跳过，
    // 渲染层拿到的是 "No handler registered for ..."，不是编译错误。
    const missing = Object.keys(todoNamespace.channels).filter(
      name => typeof (service.handlers as Record<string, unknown>)[name] !== 'function',
    )
    expect(missing).toEqual([])
  })
})

describe('agent surface', () => {
  it('tags agent writes, links the session and announces the operation', async () => {
    const agent = service.forAgent('session-1')
    const created = await agent.create({ title: 'Agent 建的' })
    if (!created.ok) throw new Error(created.reason)
    expect(created.todo.sessionLinks[0].sessionId).toBe('session-1')
    expect(changes()[0]).toEqual({ todos: [created.todo], source: 'agent' })
    expect(sent[sent.length - 1]).toEqual({
      channel: 'todo:agent-operation',
      args: [{ sessionId: 'session-1', action: 'created', todoId: created.todo.id, title: 'Agent 建的' }],
    })
  })

  it('reports completed / reopened / updated / deleted actions', async () => {
    const agent = service.forAgent('s1')
    const created = await agent.create({ title: 'a' })
    if (!created.ok) throw new Error(created.reason)
    await agent.update({ id: created.todo.id, notes: '进度' })
    await agent.update({ id: created.todo.id, status: 'completed' })
    await agent.update({ id: created.todo.id, status: 'open' })
    await agent.remove(created.todo.id)
    const actions = sent.filter(s => s.channel === 'todo:agent-operation').map(s => (s.args[0] as { action: string }).action)
    expect(actions).toEqual(['created', 'updated', 'completed', 'reopened', 'deleted'])
    expect(sync.deleted).toHaveLength(1)
  })

  it('records a read as a session link without changing updatedAt', async () => {
    const todo = make('a')
    const agent = service.forAgent('s2')
    const read = await agent.get(todo.id)
    expect(read?.updatedAt).toBe(todo.updatedAt)
    expect(read?.sessionLinks).toEqual([{ sessionId: 's2', firstTouchedAt: clock, lastTouchedAt: clock }])
    expect(changes()[changes().length - 1]?.source).toBe('agent')
  })

  it('works without a session id', async () => {
    const agent = service.forAgent(null)
    const created = await agent.create({ title: 'a' })
    if (!created.ok) throw new Error(created.reason)
    expect(created.todo.sessionLinks).toEqual([])
    expect(await agent.get(created.todo.id)).not.toBeNull()
    agent.touchSession(created.todo.id)
    expect((await agent.get(created.todo.id))?.sessionLinks).toEqual([])
    expect((sent[sent.length - 1]?.args[0] as { sessionId: string | null }).sessionId).toBeNull()
  })

  it('keeps rejected agent writes silent', async () => {
    const agent = service.forAgent('s1')
    expect(await agent.create({ title: '' })).toEqual({ ok: false, reason: 'invalid-title' })
    expect(await agent.remove('ghost')).toEqual({ ok: false, reason: 'not-found' })
    expect(await agent.createGroup('')).toEqual({ ok: false, reason: 'invalid-name' })
    expect(sent).toEqual([])
  })

  it('exposes groups to the agent and broadcasts new ones', async () => {
    const agent = service.forAgent('s1')
    const group = await agent.createGroup('工作', 'rose')
    if (!group.ok) throw new Error(group.reason)
    expect(await agent.listGroups()).toEqual([group.group])
    expect(changes()[0]).toEqual({ groups: [group.group], source: 'agent' })
  })
})