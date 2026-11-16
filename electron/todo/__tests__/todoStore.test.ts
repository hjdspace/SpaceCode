// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { createTodoStore, compareTodos, type TodoStore } from '../todoStore'
import type { Todo } from '@/shared/channels/todo'

let dir: string
let filePath: string
let clock: number
let store: TodoStore

/** 建一条待办并断言创建成功，返回落盘后的对象 */
function make(input: Parameters<TodoStore['create']>[0]): Todo {
  const result = store.create(input)
  if (!result.ok) throw new Error(`create failed: ${result.reason}`)
  return result.todo
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spacecode-todo-'))
  filePath = join(dir, 'nested', 'spacecode-todos.json')
  clock = 1_700_000_000_000
  store = createTodoStore({ filePath, now: () => clock })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('create', () => {
  it('fills defaults and creates the parent directory on first write', () => {
    const todo = make({ title:  '  写发布说明  ' })
    expect(todo.title).toBe('写发布说明')
    expect(todo.status).toBe('open')
    expect(todo.priority).toBe('medium')
    expect(todo.tags).toEqual([])
    expect(todo.reminders).toEqual([])
    expect(todo.orderIndex).toBe(0)
    expect(todo.createdAt).toBe(clock)
    expect(existsSync(filePath)).toBe(true)
    expect(store.get(todo.id)?.title).toBe('写发布说明')
  })

  it('rejects empty and over-long titles without writing', () => {
    expect(store.create({ title: '   ' })).toEqual({ ok: false, reason: 'invalid-title' })
    expect(store.create({ title: 'x'.repeat(501) })).toEqual({ ok: false, reason: 'invalid-title' })
    expect(existsSync(filePath)).toBe(false)
  })

  it('rejects an unknown group', () => {
    expect(store.create({ title: 'a', groupId: 'nope' })).toEqual({ ok: false, reason: 'group-not-found' })
  })

  it('auto-creates a due reminder when dueAt is set and reminders are omitted', () => {
    const todo = make({ title: '交周报', dueAt: clock + 60_000 })
    expect(todo.reminders).toHaveLength(1)
    expect(todo.reminders[0]).toMatchObject({ triggerAt: clock + 60_000, origin: 'due', status: 'pending' })
  })

  it('keeps explicit reminders and does not duplicate the due one', () => {
    const todo = make({ title: '评审', dueAt: clock + 60_000, reminders: [clock + 60_000, clock + 1_000] })
    expect(todo.reminders.map(r => r.triggerAt)).toEqual([clock + 1_000, clock + 60_000])
    expect(todo.reminders.map(r => r.origin)).toEqual(['manual', 'due'])
  })

  it('records the creating session and normalizes tags', () => {
    const todo = make({ title: 'a', sessionId: 's1', tags: [' 后端 ', '后端', '', 'x'.repeat(60)] })
    expect(todo.sessionLinks).toEqual([{ sessionId: 's1', firstTouchedAt: clock, lastTouchedAt: clock }])
    expect(todo.tags).toEqual(['后端', 'x'.repeat(40)])
  })

  it('appends new todos after existing ones in manual order', () => {
    make({ title: 'a' })
    expect(make({ title: 'b' }).orderIndex).toBe(1)
  })
})

describe('persistence', () => {
  it('survives a new store instance on the same file', () => {
    const todo = make({ title: '持久化', notes: '半截进度', dueAt: clock + 5_000, sessionId: 's1' })
    const reopened = createTodoStore({ filePath, now: () => clock })
    expect(reopened.get(todo.id)).toEqual(todo)
  })

  it('leaves no temp file behind', () => {
    make({ title: 'a' })
    expect(readFileSync(filePath, 'utf-8')).toContain('"version": 1')
    expect(readdirSync(dirname(filePath))).toEqual(['spacecode-todos.json'])
  })

  it('recovers from a corrupt file instead of throwing', () => {
    make({ title: 'a' })
    writeFileSync(filePath, '{ half written', 'utf-8')
    expect(store.list()).toEqual([])
    expect(make({ title: 'b' }).title).toBe('b')
  })

  it('drops invalid records and repairs missing fields', () => {
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({
      todos: [
        { id: 'ok', title: ' legacy ', createdAt: 5 },
        { id: '', title: 'no id' },
        { id: 'x', title: '   ' },
        null,
      ],
      groups: [{ id: 'g', name: ' 分组 ', createdAt: 1 }, { id: 'bad' }],
    }), 'utf-8')
    const todos = store.list()
    expect(todos).toHaveLength(1)
    expect(todos[0]).toMatchObject({ id: 'ok', title: 'legacy', updatedAt: 5, tags: [], reminders: [], orderIndex: 0 })
    expect(store.listGroups()).toEqual([{ id: 'g', name: '分组', color: 'teal', orderIndex: 0, createdAt: 1 }])
  })
})

describe('list', () => {
  it('sorts open first, then by due date, undated last, then most recently updated', () => {
    const undated = make({ title: 'undated' })
    clock += 10
    const later = make({ title: 'later', dueAt: 2_000 })
    clock += 10
    const sooner = make({ title: 'sooner', dueAt: 1_000 })
    clock += 10
    const done = make({ title: 'done', dueAt: 500 })
    store.update({ id: done.id, status: 'completed' })
    expect(store.list().map(t => t.title)).toEqual(['sooner', 'later', 'undated', 'done'])
    expect(compareTodos(sooner, later)).toBeLessThan(0)
    expect(compareTodos(undated, sooner)).toBeGreaterThan(0)
  })

  it('filters by status, group, project, dueBefore and search across title/notes/tags', () => {
    const group = store.createGroup('工作')
    if (!group.ok) throw new Error('group')
    const a = make({ title: '修登录 Bug', notes: 'OAuth 回调', groupId: group.group.id, projectRoot: '/p1', dueAt: 1_000 })
    make({ title: '买菜', tags: ['生活'], projectRoot: '/p2', dueAt: 9_000 })
    make({ title: '无期限' })
    store.update({ id: a.id, status: 'completed' })

    expect(store.list({ status: 'completed' }).map(t => t.title)).toEqual(['修登录 Bug'])
    expect(store.list({ groupId: group.group.id }).map(t => t.title)).toEqual(['修登录 Bug'])
    expect(store.list({ projectRoot: '/p2' }).map(t => t.title)).toEqual(['买菜'])
    expect(store.list({ dueBefore: 5_000 }).map(t => t.title)).toEqual(['修登录 Bug'])
    expect(store.list({ search: 'oauth' }).map(t => t.title)).toEqual(['修登录 Bug'])
    expect(store.list({ search: '生活' }).map(t => t.title)).toEqual(['买菜'])
    expect(store.list({ search: '不存在' })).toEqual([])
  })

  it('clamps the limit into 1..500', () => {
    make({ title: 'a' })
    clock += 1
    make({ title: 'b' })
    expect(store.list({ limit: 1 })).toHaveLength(1)
    expect(store.list({ limit: 0 })).toHaveLength(1)
    expect(store.list({ limit: 99_999 })).toHaveLength(2)
  })
})

describe('update', () => {
  it('detects a stale expectedUpdatedAt and returns the current record', () => {
    const todo = make({ title: 'a' })
    clock += 1
    store.update({ id: todo.id, title: 'b' })
    const conflict = store.update({ id: todo.id, title: 'c', expectedUpdatedAt: todo.updatedAt })
    expect(conflict.ok).toBe(false)
    if (conflict.ok) throw new Error('expected conflict')
    expect(conflict.reason).toBe('conflict')
    expect(conflict.todo?.title).toBe('b')
    expect(store.get(todo.id)?.title).toBe('b')
  })

  it('accepts the current expectedUpdatedAt', () => {
    const todo = make({ title: 'a' })
    clock += 1
    const ok = store.update({ id: todo.id, title: 'b', expectedUpdatedAt: todo.updatedAt })
    expect(ok.ok).toBe(true)
  })

  it('always advances updatedAt even within the same millisecond', () => {
    const todo = make({ title: 'a' })
    const second = store.update({ id: todo.id, title: 'b' })
    if (!second.ok) throw new Error('update')
    const third = store.update({ id: todo.id, title: 'c' })
    if (!third.ok) throw new Error('update')
    expect(second.todo.updatedAt).toBe(todo.updatedAt + 1)
    expect(third.todo.updatedAt).toBe(todo.updatedAt + 2)
  })

  it('does not persist partial changes when validation fails', () => {
    const todo = make({ title: 'a', notes: 'keep' })
    const failed = store.update({ id: todo.id, notes: 'changed', title: '  ' })
    expect(failed.ok).toBe(false)
    if (failed.ok) throw new Error('expected failure')
    expect(failed.todo?.notes).toBe('keep')
    expect(store.get(todo.id)?.notes).toBe('keep')
  })

  it('reports not-found and group-not-found', () => {
    expect(store.update({ id: 'missing', title: 'a' })).toEqual({ ok: false, reason: 'not-found' })
    const todo = make({ title: 'a' })
    expect(store.update({ id: todo.id, groupId: 'ghost' }).ok).toBe(false)
  })

  it('clears optional fields with null and empty string', () => {
    const group = store.createGroup('工作')
    if (!group.ok) throw new Error('group')
    const todo = make({ title: 'a', notes: 'n', dueAt: clock + 10, groupId: group.group.id, projectRoot: '/p' })
    const cleared = store.update({ id: todo.id, notes: '', dueAt: null, groupId: null, projectRoot: null })
    if (!cleared.ok) throw new Error('update')
    expect(cleared.todo.notes).toBeUndefined()
    expect(cleared.todo.dueAt).toBeUndefined()
    expect(cleared.todo.groupId).toBeUndefined()
    expect(cleared.todo.projectRoot).toBeUndefined()
    expect(cleared.todo.reminders).toEqual([])
  })

  it('moves the due reminder with dueAt and re-arms an acknowledged one', () => {
    const todo = make({ title: 'a', dueAt: clock + 1_000 })
    store.acknowledgeReminder(todo.id, todo.reminders[0].id)
    const moved = store.update({ id: todo.id, dueAt: clock + 9_000 })
    if (!moved.ok) throw new Error('update')
    expect(moved.todo.reminders).toHaveLength(1)
    expect(moved.todo.reminders[0]).toMatchObject({ triggerAt: clock + 9_000, status: 'pending', origin: 'due' })
    expect(moved.todo.reminders[0].acknowledgedAt).toBeUndefined()
  })

  it('blocks edits on a read-only native list item', () => {
    const todo = make({ title: '系统事项' })
    store.applySyncPatch({
      upserts: [{ ...todo, nativeOrigin: { source: 'macos-reminders', listId: 'L', listTitle: '共享', externalId: 'E', canWrite: false } }],
      removedIds: [],
    })
    const blocked = store.update({ id: todo.id, title: '改名' })
    expect(blocked.ok).toBe(false)
    if (blocked.ok) throw new Error('expected read-only')
    expect(blocked.reason).toBe('read-only')
    expect(store.get(todo.id)?.title).toBe('系统事项')
    expect(store.findByNativeId('L', 'E')?.id).toBe(todo.id)
  })
})

describe('status transitions', () => {
  it('completing closes pending reminders and stamps completedAt', () => {
    const todo = make({ title: 'a', reminders: [clock - 10, clock + 10_000] })
    const done = store.update({ id: todo.id, status: 'completed' })
    if (!done.ok) throw new Error('update')
    expect(done.todo.completedAt).toBe(clock)
    expect(done.todo.reminders.every(r => r.status === 'completed')).toBe(true)
    expect(store.activeReminders()).toEqual([])
  })

  it('reopening clears completedAt and revives only future reminders', () => {
    const todo = make({ title: 'a', reminders: [clock - 10, clock + 10_000] })
    store.update({ id: todo.id, status: 'completed' })
    const reopened = store.update({ id: todo.id, status: 'open' })
    if (!reopened.ok) throw new Error('update')
    expect(reopened.todo.completedAt).toBeUndefined()
    expect(reopened.todo.reminders.map(r => r.status)).toEqual(['completed', 'pending'])
  })

  it('is idempotent for a no-op status write', () => {
    const todo = make({ title: 'a' })
    const again = store.update({ id: todo.id, status: 'open' })
    if (!again.ok) throw new Error('update')
    expect(again.todo.completedAt).toBeUndefined()
  })
})

describe('remove / restore', () => {
  it('round-trips a deleted todo with its identity intact', () => {
    const todo = make({ title: 'a', sessionId: 's1', notes: 'n' })
    const removed = store.remove(todo.id)
    if (!removed.ok) throw new Error('remove')
    expect(removed.removed).toEqual(todo)
    expect(store.get(todo.id)).toBeNull()
    const restored = store.restore(removed.removed)
    if (!restored.ok) throw new Error('restore')
    expect(store.get(todo.id)).toEqual(todo)
  })

  it('reports not-found and refuses to overwrite an existing id', () => {
    expect(store.remove('ghost')).toEqual({ ok: false, reason: 'not-found' })
    const todo = make({ title: 'a' })
    const again = store.restore(todo)
    expect(again.ok).toBe(false)
    if (again.ok) throw new Error('expected conflict')
    expect(again.reason).toBe('conflict')
    expect(store.restore({ ...todo, title: '   ' })).toEqual({ ok: false, reason: 'invalid-title' })
  })
})

describe('bulk operations', () => {
  it('bulkStatus changes only writable existing todos', () => {
    const a = make({ title: 'a' })
    const b = make({ title: 'b' })
    store.applySyncPatch({
      upserts: [{ ...b, nativeOrigin: { source: 'macos-reminders', listId: 'L', listTitle: 'l', externalId: 'E', canWrite: false } }],
      removedIds: [],
    })
    const changed = store.bulkStatus([a.id, b.id, 'ghost', a.id], 'completed')
    expect(changed.map(t => t.id)).toEqual([a.id])
    expect(store.get(b.id)?.status).toBe('open')
  })

  it('bulkRemove returns the removed snapshots and skips a no-op write', () => {
    const a = make({ title: 'a' })
    const b = make({ title: 'b' })
    expect(store.bulkRemove(['ghost'])).toEqual([])
    expect(store.bulkRemove([a.id, b.id]).map(t => t.title)).toEqual(['a', 'b'])
    expect(store.list()).toEqual([])
  })
})

describe('reorder', () => {
  it('assigns manual order without touching updatedAt', () => {
    const a = make({ title: 'a' })
    clock += 1
    const b = make({ title: 'b' })
    clock += 1
    const c = make({ title: 'c' })
    const reordered = store.reorder([c.id, a.id])
    expect(reordered.find(t => t.id === c.id)?.orderIndex).toBe(0)
    expect(reordered.find(t => t.id === a.id)?.orderIndex).toBe(1)
    expect(reordered.find(t => t.id === b.id)?.orderIndex).toBe(2)
    expect(store.get(a.id)?.updatedAt).toBe(a.updatedAt)
    expect(store.get(c.id)?.updatedAt).toBe(c.updatedAt)
  })

  it('ignores unknown and duplicate ids', () => {
    const a = make({ title: 'a' })
    const b = make({ title: 'b' })
    store.reorder([b.id, 'ghost', b.id, a.id])
    expect(store.get(b.id)?.orderIndex).toBe(0)
    expect(store.get(a.id)?.orderIndex).toBe(1)
  })
})

describe('session links', () => {
  it('upserts per session and leaves updatedAt alone', () => {
    const todo = make({ title: 'a', sessionId: 's1' })
    clock += 500
    const touched = store.touchSession(todo.id, 's1')
    expect(touched?.updatedAt).toBe(todo.updatedAt)
    expect(touched?.sessionLinks).toEqual([{ sessionId: 's1', firstTouchedAt: todo.createdAt, lastTouchedAt: clock }])
    store.touchSession(todo.id, 's2')
    expect(store.get(todo.id)?.sessionLinks.map(l => l.sessionId)).toEqual(['s1', 's2'])
    expect(store.touchSession('ghost', 's1')).toBeNull()
    expect(store.touchSession(todo.id, '')).toBeNull()
  })
})

describe('groups', () => {
  it('creates with a rotating palette color and rejects duplicates case-insensitively', () => {
    const first = store.createGroup('工作')
    if (!first.ok) throw new Error('group')
    expect(first.group.color).toBe('teal')
    const second = store.createGroup('生活', 'rose')
    if (!second.ok) throw new Error('group')
    expect(second.group.color).toBe('rose')
    expect(store.createGroup(' 工作 ')).toEqual({ ok: false, reason: 'duplicate-name' })
    expect(store.createGroup('  ')).toEqual({ ok: false, reason: 'invalid-name' })
    expect(store.createGroup('x'.repeat(61))).toEqual({ ok: false, reason: 'invalid-name' })
  })

  it('renames and reports missing / duplicate targets', () => {
    const a = store.createGroup('工作')
    const b = store.createGroup('生活')
    if (!a.ok || !b.ok) throw new Error('group')
    expect(store.renameGroup(a.group.id, ' 项目 ').ok).toBe(true)
    expect(store.listGroups()[0].name).toBe('项目')
    expect(store.renameGroup(a.group.id, '生活')).toEqual({ ok: false, reason: 'duplicate-name' })
    expect(store.renameGroup('ghost', 'x')).toEqual({ ok: false, reason: 'not-found' })
    expect(store.renameGroup(a.group.id, '')).toEqual({ ok: false, reason: 'invalid-name' })
  })

  it('removing a group unassigns its todos but keeps them', () => {
    const group = store.createGroup('工作')
    if (!group.ok) throw new Error('group')
    const todo = make({ title: 'a', groupId: group.group.id })
    expect(store.removeGroup(group.group.id)).toEqual({ ok: true })
    expect(store.removeGroup(group.group.id)).toEqual({ ok: false })
    expect(store.get(todo.id)?.groupId).toBeUndefined()
    expect(store.list()).toHaveLength(1)
  })
})

describe('reminders', () => {
  it('claims each due reminder once per cycle', () => {
    const todo = make({ title: 'a', reminders: [clock - 1_000, clock + 60_000] })
    const first = store.claimDueReminders()
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ todoId: todo.id, todoTitle: 'a', triggerAt: clock - 1_000 })
    expect(store.claimDueReminders()).toEqual([])
    clock += 60_000
    expect(store.claimDueReminders()).toHaveLength(1)
  })

  it('snooze re-arms the notification and hides it until the new time', () => {
    const todo = make({ title: 'a', reminders: [clock - 1_000] })
    store.claimDueReminders()
    expect(store.snoozeReminder(todo.id, todo.reminders[0].id, 10)).toBe(true)
    expect(store.activeReminders()).toEqual([])
    clock += 10 * 60_000
    const active = store.activeReminders()
    expect(active).toHaveLength(1)
    expect(active[0].snoozedUntil).toBe(clock)
    expect(store.claimDueReminders()).toHaveLength(1)
  })

  it('validates the snooze window and unknown ids', () => {
    const todo = make({ title: 'a', reminders: [clock] })
    expect(store.snoozeReminder(todo.id, todo.reminders[0].id, 0)).toBe(false)
    expect(store.snoozeReminder(todo.id, todo.reminders[0].id, 10_081)).toBe(false)
    expect(store.snoozeReminder(todo.id, todo.reminders[0].id, Number.NaN)).toBe(false)
    expect(store.snoozeReminder(todo.id, 'ghost', 5)).toBe(false)
    expect(store.snoozeReminder('ghost', todo.reminders[0].id, 5)).toBe(false)
  })

  it('acknowledge removes it from the rail; completed todos never remind', () => {
    const a = make({ title: 'a', reminders: [clock - 1] })
    const b = make({ title: 'b', reminders: [clock - 2] })
    expect(store.activeReminders().map(r => r.todoId)).toEqual([b.id, a.id])
    expect(store.acknowledgeReminder(a.id, a.reminders[0].id)).toBe(true)
    expect(store.acknowledgeReminder(a.id, 'ghost')).toBe(false)
    expect(store.acknowledgeReminder('ghost', a.reminders[0].id)).toBe(false)
    store.update({ id: b.id, status: 'completed' })
    expect(store.activeReminders()).toEqual([])
    expect(store.claimDueReminders()).toEqual([])
  })

  it('honours an injected evaluation time', () => {
    make({ title: 'a', reminders: [clock + 5_000] })
    expect(store.activeReminders(clock + 4_999)).toEqual([])
    expect(store.activeReminders(clock + 5_000)).toHaveLength(1)
  })
})

describe('applySyncPatch', () => {
  it('upserts by id, removes by id and reports what actually changed', () => {
    const a = make({ title: 'a' })
    const b = make({ title: 'b' })
    const patch = store.applySyncPatch({
      upserts: [{ ...a, title: 'a2', updatedAt: a.updatedAt + 1 }, { ...b, id: 'new-from-native' }],
      removedIds: [b.id, 'ghost'],
    })
    expect(patch.upserts.map(t => t.id)).toEqual([a.id, 'new-from-native'])
    expect(patch.removedIds).toEqual([b.id])
    expect(store.list().map(t => t.title).sort()).toEqual(['a2', 'b'])
    expect(store.applySyncPatch({ upserts: [], removedIds: [] })).toEqual({ upserts: [], removedIds: [] })
  })
})