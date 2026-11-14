// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { createTodoStore, type TodoStore } from '../todoStore'
import { createRemindersSync } from '../remindersSync'
import { RemindersBridgeError, type RemindersBridge } from '../remindersBridge'
import { endOfLocalDay, type NativeReminder } from '../remindersMapping'
import type { PushOps, NativeList } from '../remindersScript'
import type { Todo } from '@/shared/channels/todo'

interface FakeBridge extends RemindersBridge {
  natives: NativeReminder[]
  pushes: PushOps[]
  failFetch(err: Error | null): void
  failPush(err: Error | null): void
  failLists(err: Error | null): void
  failItem(key: string, message: string): void
  addNative(native: NativeReminder): void
  editNative(id: string, patch: Partial<NativeReminder>): void
  dropNative(id: string): void
}

/** 假 osascript：行为与 PUSH_SCRIPT 一致（建/改/删 + 逐条错误回执），但全在内存里。 */
function createFakeBridge(options: { natives?: NativeReminder[]; supported?: boolean; lists?: NativeList[] } = {}): FakeBridge {
  let natives = (options.natives ?? []).map(n => ({ ...n }))
  let seq = natives.length
  let fetchError: Error | null = null
  let pushError: Error | null = null
  let listsError: Error | null = null
  const itemErrors = new Map<string, string>()
  const pushes: PushOps[] = []
  const lists = options.lists ?? [{ id: 'L1', title: '提醒事项' }, { id: 'L2', title: '工作' }]

  function applyWrite(target: NativeReminder, write: { title: string; notes: string; completed: boolean; dueAt: number | null; dueDateOnly: boolean; priority: number }): void {
    target.title = write.title
    if (write.notes) target.notes = write.notes
    else delete target.notes
    target.completed = write.completed
    target.priority = write.priority
    if (write.dueAt === null) {
      delete target.dueAt
      delete target.dueDateOnly
    } else {
      target.dueAt = write.dueAt
      if (write.dueDateOnly) target.dueDateOnly = true
      else delete target.dueDateOnly
    }
  }

  return {
    supported: options.supported ?? true,
    get natives() { return natives },
    pushes,
    failFetch: err => { fetchError = err },
    failPush: err => { pushError = err },
    failLists: err => { listsError = err },
    failItem: (key, message) => { itemErrors.set(key, message) },
    addNative: native => { natives.push({ ...native }); seq += 1 },
    editNative: (id, patch) => {
      const target = natives.find(n => n.id === id)
      if (target) Object.assign(target, patch)
    },
    dropNative: id => { natives = natives.filter(n => n.id !== id) },
    async listLists() {
      if (listsError) throw listsError
      return lists.map(l => ({ ...l }))
    },
    async fetch() {
      if (fetchError) throw fetchError
      return natives.map(n => ({ ...n }))
    },
    async push(ops) {
      pushes.push(ops)
      if (pushError) throw pushError
      const created: Array<{ key: string; id: string }> = []
      const updated: string[] = []
      const deleted: string[] = []
      const errors: Array<{ key: string; message: string }> = []
      for (const create of ops.creates) {
        const failure = itemErrors.get(create.key)
        if (failure) { errors.push({ key: create.key, message: failure }); continue }
        const id = `n${++seq}`
        const native: NativeReminder = { id, title: create.title, completed: create.completed, priority: create.priority }
        applyWrite(native, create)
        natives.push(native)
        created.push({ key: create.key, id })
      }
      for (const update of ops.updates) {
        const target = natives.find(n => n.id === update.id)
        const failure = itemErrors.get(update.id)
        if (failure) { errors.push({ key: update.id, message: failure }); continue }
        if (!target) { errors.push({ key: update.id, message: `reminder-not-found:${update.id}` }); continue }
        applyWrite(target, update)
        updated.push(update.id)
      }
      for (const externalId of ops.deletes) {
        const index = natives.findIndex(n => n.id === externalId)
        if (index < 0) { errors.push({ key: externalId, message: `reminder-not-found:${externalId}` }); continue }
        natives.splice(index, 1)
        deleted.push(externalId)
      }
      return { created, updated, deleted, errors }
    },
  }
}

let dir: string
let store: TodoStore
let configPath: string
let clock: number

function make(title: string, extra: Partial<Parameters<TodoStore['create']>[0]> = {}): Todo {
  const result = store.create({ title, ...extra })
  if (!result.ok) throw new Error(result.reason)
  return result.todo
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spacecode-todo-sync-'))
  configPath = join(dir, 'sync', 'config.json')
  clock = new Date(2026, 10, 13, 9, 0, 0, 0).getTime()
  store = createTodoStore({ filePath: join(dir, 'todos.json'), now: () => clock })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function setup(bridge: FakeBridge) {
  const events: Array<{ kind: string }> = []
  const sync = createRemindersSync({ store, configPath, bridge, now: () => clock })
  sync.subscribe(event => events.push(event))
  return { sync, events }
}

describe('platform support', () => {
  it('reports unsupported and refuses to sync off macOS', async () => {
    const bridge = createFakeBridge({ supported: false })
    const { sync } = setup(bridge)
    expect(sync.getState()).toMatchObject({ supported: false, permission: 'unsupported' })
    expect(await sync.requestAccess()).toMatchObject({ ok: false, error: 'unsupported-platform' })
    expect(await sync.syncNow()).toMatchObject({ ok: false, error: 'unsupported-platform' })
    expect(bridge.pushes).toHaveLength(0)
  })

  it('does nothing while disabled', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    make('本地事项')
    expect(await sync.syncNow()).toMatchObject({ ok: true })
    expect(bridge.pushes).toHaveLength(0)
    expect(sync.getState().config.enabled).toBe(false)
  })

  it('requires a selected list before enabling', async () => {
    const { sync } = setup(createFakeBridge())
    expect(await sync.setConfig({ enabled: true })).toMatchObject({ ok: false, error: 'no-list-selected' })
    expect(sync.getState().config.enabled).toBe(false)
  })
})

describe('access', () => {
  it('grants access and lists the available Reminders lists', async () => {
    const { sync } = setup(createFakeBridge())
    const result = await sync.requestAccess()
    expect(result.ok).toBe(true)
    expect(result.state.permission).toBe('granted')
    expect(result.state.lists).toEqual([
      { id: 'L1', title: '提醒事项', writable: true },
      { id: 'L2', title: '工作', writable: true },
    ])
  })

  it('records a denied automation permission', async () => {
    const bridge = createFakeBridge()
    bridge.failLists(new RemindersBridgeError('permission-denied', 'Not authorized (-1743)'))
    const { sync } = setup(bridge)
    expect(await sync.requestAccess()).toMatchObject({ ok: false, error: 'permission-denied' })
    expect(sync.getState().permission).toBe('denied')
    expect(createRemindersSync({ store, configPath, bridge }).getState().permission).toBe('denied')
  })

  it('surfaces a fetch failure without touching local data', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = make('本地事项')
    bridge.failFetch(new RemindersBridgeError('timeout', 'too slow'))
    expect(await sync.syncNow()).toMatchObject({ ok: false, error: 'timeout' })
    expect(store.get(todo.id)?.nativeOrigin).toBeUndefined()
    expect(sync.getState().lastError).toBe('timeout')
  })
})

describe('push: local → Reminders', () => {
  it('mirrors local todos once and stays quiet when nothing changed', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const dueAt = new Date(2026, 10, 13, 18, 0).getTime()
    const todo = make('  写发布说明 ', { notes: '细节', priority: 'high', dueAt })

    expect(await sync.syncNow()).toMatchObject({ ok: true })
    expect(bridge.pushes).toHaveLength(1)
    expect(bridge.pushes[0].creates).toEqual([{
      key: todo.id, title: '写发布说明', notes: '细节', completed: false, dueAt, dueDateOnly: false, priority: 1,
    }])
    const bound = store.get(todo.id)
    expect(bound?.nativeOrigin).toMatchObject({ listId: 'L1', listTitle: '提醒事项', externalId: 'n1', canWrite: true })
    expect(bound?.nativeOrigin?.syncedHash).toBeTruthy()

    expect(await sync.syncNow()).toMatchObject({ ok: true })
    expect(bridge.pushes).toHaveLength(1)
  })

  it('pushes a local edit when the system side is untouched', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = make('原标题')
    await sync.syncNow()
    clock += 1_000
    store.update({ id: todo.id, title: '新标题', status: 'completed' })
    await sync.syncNow()
    expect(bridge.pushes[1].updates).toEqual([{
      id: 'n1', title: '新标题', notes: '', completed: true, dueAt: null, dueDateOnly: false, priority: 5,
    }])
    expect(bridge.natives[0]).toMatchObject({ title: '新标题', completed: true })
  })

  it('marks date-only due dates so Reminders shows an all-day item', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    make('只看日期', { dueAt: endOfLocalDay(clock) })
    await sync.syncNow()
    expect(bridge.pushes[0].creates[0].dueDateOnly).toBe(true)
    expect(store.list()[0].nativeOrigin?.dueDateOnly).toBe(true)
    // 往返一轮后不应产生新的推送（系统把 allday 读回来仍是 23:59）
    await sync.syncNow()
    expect(bridge.pushes).toHaveLength(1)
  })

  it('marks a list read-only when the system refuses the write, and stops retrying', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = make('只读列表里的事项')
    bridge.failItem(todo.id, "Can't be modified: read-only list")
    const result = await sync.syncNow()
    expect(result.ok).toBe(true)
    expect(sync.getState().lists.find(l => l.id === 'L1')?.writable).toBe(false)
    // 写入失败的那条留在本地，不绑定；下一轮不再重复尝试
    expect(store.get(todo.id)?.nativeOrigin).toBeUndefined()
    await sync.syncNow()
    expect(bridge.pushes).toHaveLength(1)
  })

  it('flags a bound item read-only when an update is refused', async () => {
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: '系统事项', completed: false, priority: 5 }] })
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = store.list()[0]
    clock += 1_000
    store.update({ id: todo.id, title: '本地改名' })
    bridge.failItem('x1', 'read-only list')
    await sync.syncNow()
    expect(store.get(todo.id)?.nativeOrigin?.canWrite).toBe(false)
    expect(store.get(todo.id)?.title).toBe('本地改名')
    expect(sync.getState().lists.find(l => l.id === 'L1')?.writable).toBe(false)
  })

  it('reports a whole-push permission failure as denied', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    make('a')
    bridge.failPush(new RemindersBridgeError('permission-denied', 'Not authorized'))
    expect(await sync.syncNow()).toMatchObject({ ok: false, error: 'permission-denied' })
    expect(sync.getState().permission).toBe('denied')
    expect(store.list()[0].nativeOrigin).toBeUndefined()
  })
})

describe('pull: Reminders → local', () => {
  it('imports system items with a due reminder attached', async () => {
    const dueAt = new Date(2026, 10, 13, 15, 30).getTime()
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: '系统里的事', notes: '备注', completed: false, priority: 1, dueAt }] })
    const { sync, events } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todos = store.list()
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({ title: '系统里的事', notes: '备注', priority: 'high', dueAt })
    expect(todos[0].nativeOrigin).toMatchObject({ externalId: 'x1', listTitle: '提醒事项' })
    expect(todos[0].reminders).toEqual([expect.objectContaining({ triggerAt: dueAt, origin: 'due', status: 'pending' })])
    expect(events.some(e => e.kind === 'todos')).toBe(true)
    expect(bridge.pushes).toHaveLength(0)
  })

  it('applies a system-side edit when the local copy is untouched', async () => {
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: '旧', completed: false, priority: 5 }] })
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    bridge.editNative('x1', { title: '新', completed: true, priority: 9 })
    clock += 1_000
    await sync.syncNow()
    const todo = store.list()[0]
    expect(todo).toMatchObject({ title: '新', status: 'completed', priority: 'low' })
    expect(todo.completedAt).toBe(clock)
    expect(bridge.pushes).toHaveLength(0)
  })

  it('keeps local-only fields when applying system content', async () => {
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: '旧', completed: false, priority: 5 }] })
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const imported = store.list()[0]
    store.update({ id: imported.id, tags: ['本地标签'] })
    // 只改标签不参与同步指纹，因此系统侧的改名仍应直接落地
    bridge.editNative('x1', { title: '系统改名' })
    await sync.syncNow()
    expect(store.list()[0]).toMatchObject({ title: '系统改名', tags: ['本地标签'] })
  })

  it('removes the local copy when the system item is gone and local is unchanged', async () => {
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: '会被删', completed: false, priority: 5 }] })
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    bridge.dropNative('x1')
    await sync.syncNow()
    expect(store.list()).toEqual([])
  })

  it('leaves items bound to another list alone', async () => {
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: 'L1 的事', completed: false, priority: 5 }] })
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    await sync.setConfig({ listId: 'L2' })
    expect(store.list()[0].nativeOrigin?.listId).toBe('L1')
    bridge.dropNative('x1')
    await sync.syncNow()
    expect(store.list()).toHaveLength(1)
  })
})

describe('conflicts', () => {
  async function conflicting() {
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: '共同祖先', completed: false, priority: 5 }] })
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = store.list()[0]
    clock += 1_000
    store.update({ id: todo.id, title: '本地改了' })
    bridge.editNative('x1', { title: '系统改了' })
    await sync.syncNow()
    return { bridge, sync, todo }
  }

  it('records a conflict instead of overwriting either side', async () => {
    const { sync, todo } = await conflicting()
    const state = sync.getState()
    expect(state.conflicts).toHaveLength(1)
    expect(state.conflicts[0]).toMatchObject({ todoId: todo.id, todoTitle: '本地改了', nativeTitle: '系统改了', kind: 'changed' })
    expect(store.get(todo.id)?.title).toBe('本地改了')
  })

  it('keep=local pushes the local version and clears the conflict', async () => {
    const { bridge, sync, todo } = await conflicting()
    const conflictId = sync.getState().conflicts[0].id
    expect(await sync.resolveConflict(conflictId, 'local')).toMatchObject({ ok: true })
    expect(bridge.natives[0].title).toBe('本地改了')
    expect(sync.getState().conflicts).toEqual([])
    expect(store.get(todo.id)?.title).toBe('本地改了')
    await sync.syncNow()
    expect(sync.getState().conflicts).toEqual([])
  })

  it('keep=native applies the system version and clears the conflict', async () => {
    const { sync, todo } = await conflicting()
    const conflictId = sync.getState().conflicts[0].id
    await sync.resolveConflict(conflictId, 'native')
    expect(store.get(todo.id)?.title).toBe('系统改了')
    expect(sync.getState().conflicts).toEqual([])
    await sync.syncNow()
    expect(sync.getState().conflicts).toEqual([])
  })

  it('raises a deleted-conflict when the system item vanished but local was edited', async () => {
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: '祖先', completed: false, priority: 5 }] })
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = store.list()[0]
    clock += 1_000
    store.update({ id: todo.id, notes: '本地新进度' })
    bridge.dropNative('x1')
    await sync.syncNow()
    expect(sync.getState().conflicts[0]).toMatchObject({ kind: 'deleted', todoId: todo.id })
    expect(store.get(todo.id)).not.toBeNull()

    await sync.resolveConflict(sync.getState().conflicts[0].id, 'native')
    expect(store.get(todo.id)).toBeNull()
  })

  it('keep=local re-creates a system item that was deleted', async () => {
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: '祖先', completed: false, priority: 5 }] })
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = store.list()[0]
    clock += 1_000
    store.update({ id: todo.id, title: '本地保留' })
    bridge.dropNative('x1')
    await sync.syncNow()
    await sync.resolveConflict(sync.getState().conflicts[0].id, 'local')
    expect(bridge.natives).toHaveLength(1)
    expect(bridge.natives[0].title).toBe('本地保留')
    expect(store.get(todo.id)?.nativeOrigin?.externalId).toBe(bridge.natives[0].id)
  })

  it('ignores an unknown conflict id and drops conflicts for vanished todos', async () => {
    const { sync, todo } = await conflicting()
    expect(await sync.resolveConflict('ghost', 'local')).toMatchObject({ ok: true })
    const conflictId = sync.getState().conflicts[0].id
    store.remove(todo.id)
    expect(await sync.resolveConflict(conflictId, 'local')).toMatchObject({ ok: true })
    expect(sync.getState().conflicts).toEqual([])
  })
})

describe('local deletions', () => {
  it('propagates a tombstone to the system on the next cycle', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = make('要删的')
    await sync.syncNow()
    const bound = store.get(todo.id)!
    store.remove(todo.id)
    sync.noteLocalDeletions([bound])
    await sync.syncNow()
    expect(bridge.pushes[1].deletes).toEqual(['n1'])
    expect(bridge.natives).toEqual([])
    expect(store.list()).toEqual([])
    // 墓碑已兑现，不该每轮重复删
    await sync.syncNow()
    expect(bridge.pushes).toHaveLength(2)
  })

  it('undoing the delete cancels the tombstone', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = make('撤销删除')
    await sync.syncNow()
    const bound = store.get(todo.id)!
    store.remove(todo.id)
    sync.noteLocalDeletions([bound])
    store.restore(bound)
    sync.noteLocalRestorations([bound])
    await sync.syncNow()
    expect(bridge.natives).toHaveLength(1)
    expect(store.list()).toHaveLength(1)
  })

  it('drops a tombstone whose system item is already gone', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = make('两边都删')
    await sync.syncNow()
    const bound = store.get(todo.id)!
    store.remove(todo.id)
    sync.noteLocalDeletions([bound])
    bridge.dropNative('n1')
    await sync.syncNow()
    // 没有可删的东西，就不该再起一次 push
    expect(bridge.pushes).toHaveLength(1)
    await sync.syncNow()
    expect(bridge.pushes).toHaveLength(1)
    expect(store.list()).toEqual([])
  })

  it('ignores deletions of unsynced todos', async () => {
    const { sync } = setup(createFakeBridge())
    const todo = make('从未同步')
    sync.noteLocalDeletions([todo])
    sync.noteLocalRestorations([todo])
    expect(existsSync(configPath)).toBe(false)
  })
})

describe('persistence and lifecycle', () => {
  it('restores config, conflicts and tombstones from disk', async () => {
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: '祖先', completed: false, priority: 5 }] })
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = store.list()[0]
    clock += 1_000
    store.update({ id: todo.id, title: '本地' })
    bridge.editNative('x1', { title: '系统' })
    await sync.syncNow()

    const reopened = createRemindersSync({ store, configPath, bridge, now: () => clock })
    expect(reopened.getState().config).toMatchObject({ enabled: true, listId: 'L1', lastSyncAt: clock })
    expect(reopened.getState().conflicts).toHaveLength(1)
    expect(reopened.getState().permission).toBe('granted')
  })

  it('recovers from a corrupt config file', async () => {
    mkdirSync(dirname(configPath), { recursive: true })
    writeFileSync(configPath, '{ broken', 'utf-8')
    const { sync } = setup(createFakeBridge())
    expect(sync.getState().config).toEqual({ enabled: false, listId: null })
  })

  it('clears conflicts when switching lists', async () => {
    const bridge = createFakeBridge({ natives: [{ id: 'x1', title: '祖先', completed: false, priority: 5 }] })
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    const todo = store.list()[0]
    store.update({ id: todo.id, title: '本地' })
    bridge.editNative('x1', { title: '系统' })
    await sync.syncNow()
    expect(sync.getState().conflicts).toHaveLength(1)
    await sync.setConfig({ listId: 'L2' })
    expect(sync.getState().conflicts).toEqual([])
  })

  it('start/stop only arms the timer when enabled and supported', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    sync.start()
    expect(bridge.pushes).toHaveLength(0)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    make('自动同步')
    const before = bridge.pushes.length
    sync.start()
    await Promise.resolve()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(bridge.pushes.length).toBeGreaterThan(before)
    sync.stop()
    sync.stop()
  })

  it('does not run two cycles at once', async () => {
    const bridge = createFakeBridge()
    const { sync } = setup(bridge)
    await sync.requestAccess()
    await sync.setConfig({ enabled: true, listId: 'L1' })
    make('a')
    const [first, second] = await Promise.all([sync.syncNow(), sync.syncNow()])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(bridge.pushes).toHaveLength(1)
    expect(sync.getState().syncing).toBe(false)
  })

  it('stops forwarding events after unsubscribe', async () => {
    const bridge = createFakeBridge()
    const seen: string[] = []
    const sync = createRemindersSync({ store, configPath, bridge, now: () => clock })
    const unsubscribe = sync.subscribe(event => seen.push(event.kind))
    await sync.requestAccess()
    expect(seen).toContain('state')
    unsubscribe()
    const count = seen.length
    await sync.setConfig({ enabled: true, listId: 'L1' })
    expect(seen).toHaveLength(count)
  })
})