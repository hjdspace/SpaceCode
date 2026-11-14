/**
 * Todo 仓储 — 待办、分组、提醒、会话关联的唯一写入路径。
 *
 * 口径参考 Proma 的 planning-manager（SQLite）：乐观并发（expectedUpdatedAt）、
 * 规范化排序（未完成优先 → 计划时间升序 → 最近更新降序）、完成时收口提醒、
 * 会话痕迹与内容更新分离。这里换成 JSON 文件 + 原子替换，与 cronFileStore 一致，
 * 免掉 better-sqlite3 的 Electron ABI 重编译。
 *
 * 待办是跨项目的日常事项，所以文件落在 userData 而不是项目根；
 * 「属于哪个工作区」记在 todo.projectRoot 上。
 *
 * 路径由调用方注入（createTodoStore），因此这一层不 import electron，
 * 测试可以直接在临时目录上跑真实读写。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import {
  TODO_GROUP_COLORS,
  TODO_GROUP_NAME_MAX_LENGTH,
  TODO_LIST_LIMIT_MAX,
  TODO_SNOOZE_MAX_MINUTES,
  TODO_SNOOZE_MIN_MINUTES,
  TODO_TAG_MAX_COUNT,
  TODO_TAG_MAX_LENGTH,
  TODO_TITLE_MAX_LENGTH,
} from '@/shared/channels/todo'
import type {
  ActiveTodoReminder,
  CreateTodoInput,
  Todo,
  TodoGroup,
  TodoGroupMutation,
  TodoListQuery,
  TodoMutation,
  TodoPriority,
  TodoReminder,
  TodoRemoveResult,
  TodoStatus,
  UpdateTodoInput,
} from '@/shared/channels/todo'

interface TodoFile {
  version: number
  todos: Todo[]
  groups: TodoGroup[]
}

const FILE_VERSION = 1
const PRIORITIES: TodoPriority[] = ['low', 'medium', 'high']

export interface TodoStoreOptions {
  filePath: string
  /** 注入时钟，测试用它把「到点」变成确定行为 */
  now?: () => number
}

export interface TodoSyncPatch {
  upserts: Todo[]
  removedIds: string[]
}

export interface TodoStore {
  list(query?: TodoListQuery): Todo[]
  /** 整表，不受 list 的 500 上限影响；同步要看到全部绑定，漏一条就会误判成系统侧删除。 */
  all(): Todo[]
  get(id: string): Todo | null
  create(input: CreateTodoInput): TodoMutation
  update(input: UpdateTodoInput): TodoMutation
  remove(id: string): TodoRemoveResult
  restore(todo: Todo): TodoMutation
  bulkStatus(ids: string[], status: TodoStatus): Todo[]
  bulkRemove(ids: string[]): Todo[]
  reorder(ids: string[]): Todo[]
  touchSession(id: string, sessionId: string): Todo | null
  listGroups(): TodoGroup[]
  createGroup(name: string, color?: string): TodoGroupMutation
  renameGroup(id: string, name: string): TodoGroupMutation
  removeGroup(id: string): { ok: boolean }
  activeReminders(at?: number): ActiveTodoReminder[]
  claimDueReminders(at?: number): ActiveTodoReminder[]
  acknowledgeReminder(todoId: string, reminderId: string): boolean
  snoozeReminder(todoId: string, reminderId: string, minutes: number): boolean
  findByNativeId(listId: string, externalId: string): Todo | null
  applySyncPatch(patch: TodoSyncPatch): TodoSyncPatch
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().slice(0, TODO_TAG_MAX_LENGTH)
    if (!tag || out.includes(tag)) continue
    out.push(tag)
    if (out.length >= TODO_TAG_MAX_COUNT) break
  }
  return out
}

function normalizePriority(value: unknown): TodoPriority {
  return PRIORITIES.includes(value as TodoPriority) ? (value as TodoPriority) : 'medium'
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeReminder(raw: unknown, fallbackOrigin: TodoReminder['origin']): TodoReminder | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<TodoReminder>
  const triggerAt = finiteNumber(r.triggerAt)
  if (triggerAt === undefined) return null
  const status: TodoReminder['status'] =
    r.status === 'acknowledged' || r.status === 'completed' ? r.status : 'pending'
  const reminder: TodoReminder = {
    id: typeof r.id === 'string' && r.id ? r.id : randomUUID(),
    triggerAt,
    status,
    origin: r.origin === 'due' ? 'due' : r.origin === 'manual' ? 'manual' : fallbackOrigin,
  }
  const snoozedUntil = finiteNumber(r.snoozedUntil)
  if (snoozedUntil !== undefined) reminder.snoozedUntil = snoozedUntil
  const lastNotifiedAt = finiteNumber(r.lastNotifiedAt)
  if (lastNotifiedAt !== undefined) reminder.lastNotifiedAt = lastNotifiedAt
  const acknowledgedAt = finiteNumber(r.acknowledgedAt)
  if (acknowledgedAt !== undefined) reminder.acknowledgedAt = acknowledgedAt
  return reminder
}

/**
 * 磁盘上的记录可能来自旧版本或手改。缺字段补默认、非法记录丢掉，
 * 而不是让一条坏数据把整个面板变成空白。
 */
function normalizeTodo(raw: unknown): Todo | null {
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Partial<Todo>
  if (typeof t.id !== 'string' || !t.id) return null
  if (typeof t.title !== 'string' || !t.title.trim()) return null
  const createdAt = finiteNumber(t.createdAt) ?? 0
  const todo: Todo = {
    id: t.id,
    title: t.title.trim().slice(0, TODO_TITLE_MAX_LENGTH),
    status: t.status === 'completed' ? 'completed' : 'open',
    priority: normalizePriority(t.priority),
    tags: normalizeTags(t.tags),
    reminders: Array.isArray(t.reminders)
      ? t.reminders.map(r => normalizeReminder(r, 'manual')).filter((r): r is TodoReminder => r !== null)
      : [],
    sessionLinks: Array.isArray(t.sessionLinks)
      ? t.sessionLinks
          .filter(l => l && typeof l.sessionId === 'string' && l.sessionId)
          .map(l => ({
            sessionId: l.sessionId,
            firstTouchedAt: finiteNumber(l.firstTouchedAt) ?? createdAt,
            lastTouchedAt: finiteNumber(l.lastTouchedAt) ?? createdAt,
          }))
      : [],
    orderIndex: finiteNumber(t.orderIndex) ?? 0,
    createdAt,
    updatedAt: finiteNumber(t.updatedAt) ?? createdAt,
  }
  if (typeof t.notes === 'string' && t.notes) todo.notes = t.notes
  const dueAt = finiteNumber(t.dueAt)
  if (dueAt !== undefined) todo.dueAt = dueAt
  if (typeof t.groupId === 'string' && t.groupId) todo.groupId = t.groupId
  if (typeof t.projectRoot === 'string' && t.projectRoot) todo.projectRoot = t.projectRoot
  const completedAt = finiteNumber(t.completedAt)
  if (completedAt !== undefined) todo.completedAt = completedAt
  if (t.nativeOrigin && typeof t.nativeOrigin === 'object' && t.nativeOrigin.source === 'macos-reminders') {
    const n = t.nativeOrigin
    if (typeof n.listId === 'string' && typeof n.externalId === 'string') {
      todo.nativeOrigin = {
        source: 'macos-reminders',
        listId: n.listId,
        listTitle: typeof n.listTitle === 'string' ? n.listTitle : '',
        externalId: n.externalId,
        canWrite: n.canWrite !== false,
        ...(typeof n.syncedHash === 'string' ? { syncedHash: n.syncedHash } : {}),
        ...(n.dueDateOnly === true ? { dueDateOnly: true } : {}),
      }
    }
  }
  return todo
}

function normalizeGroup(raw: unknown): TodoGroup | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Partial<TodoGroup>
  if (typeof g.id !== 'string' || !g.id) return null
  if (typeof g.name !== 'string' || !g.name.trim()) return null
  return {
    id: g.id,
    name: g.name.trim().slice(0, TODO_GROUP_NAME_MAX_LENGTH),
    color: TODO_GROUP_COLORS.includes(g.color as (typeof TODO_GROUP_COLORS)[number])
      ? (g.color as string)
      : TODO_GROUP_COLORS[0],
    orderIndex: finiteNumber(g.orderIndex) ?? 0,
    createdAt: finiteNumber(g.createdAt) ?? 0,
  }
}

/**
 * 规范化排序：未完成在前 → 有计划时间的按时间升序（无计划时间排最后）→ 最近更新在前。
 * 手动排序（orderIndex）是渲染层的视图选项，仓储始终返回这一种顺序，
 * 免得同一份数据在 Agent 与 UI 眼里排法不同。
 */
export function compareTodos(a: Todo, b: Todo): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1
  const aDue = a.dueAt
  const bDue = b.dueAt
  if (aDue !== bDue) {
    if (aDue === undefined) return 1
    if (bDue === undefined) return -1
    return aDue - bDue
  }
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
  return a.createdAt - b.createdAt
}

function effectiveReminderAt(reminder: TodoReminder): number {
  return reminder.snoozedUntil ?? reminder.triggerAt
}

function toActiveReminder(todo: Todo, reminder: TodoReminder): ActiveTodoReminder {
  return {
    id: reminder.id,
    todoId: todo.id,
    todoTitle: todo.title,
    priority: todo.priority,
    triggerAt: reminder.triggerAt,
    ...(reminder.snoozedUntil !== undefined ? { snoozedUntil: reminder.snoozedUntil } : {}),
  }
}

function makeReminder(triggerAt: number, origin: TodoReminder['origin']): TodoReminder {
  return { id: randomUUID(), triggerAt, status: 'pending', origin }
}

export function createTodoStore(options: TodoStoreOptions): TodoStore {
  const { filePath } = options
  const now = options.now ?? Date.now

  function read(): TodoFile {
    if (!existsSync(filePath)) return { version: FILE_VERSION, todos: [], groups: [] }
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<TodoFile>
      return {
        version: FILE_VERSION,
        todos: Array.isArray(raw.todos)
          ? raw.todos.map(normalizeTodo).filter((t): t is Todo => t !== null)
          : [],
        groups: Array.isArray(raw.groups)
          ? raw.groups.map(normalizeGroup).filter((g): g is TodoGroup => g !== null)
          : [],
      }
    } catch {
      // 半截写入 / 手改坏的文件不该让面板打不开；下一次写入会覆盖成合法结构。
      return { version: FILE_VERSION, todos: [], groups: [] }
    }
  }

  function write(file: TodoFile): void {
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`
    writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf-8')
    renameSync(tmpPath, filePath)
  }

  /** 每次操作都重新读盘：UI、Agent、提醒调度、系统同步是四个写入方，缓存必然漂移。 */
  function mutate<T>(fn: (file: TodoFile) => { result: T; dirty: boolean }): T {
    const file = read()
    const { result, dirty } = fn(file)
    if (dirty) write(file)
    return result
  }

  function bumpUpdatedAt(prev: number): number {
    // 同一毫秒内的连续编辑也要产生新版本号，否则 expectedUpdatedAt 撞不出冲突。
    return Math.max(now(), prev + 1)
  }

  function upsertSessionLink(todo: Todo, sessionId: string | undefined, at: number): void {
    if (!sessionId) return
    const existing = todo.sessionLinks.find(l => l.sessionId === sessionId)
    if (existing) {
      existing.lastTouchedAt = at
      return
    }
    todo.sessionLinks.push({ sessionId, firstTouchedAt: at, lastTouchedAt: at })
  }

  function isReadOnly(todo: Todo): boolean {
    return todo.nativeOrigin !== undefined && todo.nativeOrigin.canWrite === false
  }

  function buildReminders(input: { reminders?: number[]; dueAt?: number }): TodoReminder[] {
    if (Array.isArray(input.reminders)) {
      // 显式列表里正好落在计划时间上的那条按 due 记账，之后改计划时间它会跟着走。
      const list = input.reminders
        .filter(t => Number.isFinite(t))
        .map(t => makeReminder(t, t === input.dueAt ? 'due' : 'manual'))
      if (input.dueAt !== undefined && !list.some(r => r.triggerAt === input.dueAt)) {
        list.push(makeReminder(input.dueAt, 'due'))
      }
      return list.sort((a, b) => a.triggerAt - b.triggerAt)
    }
    return input.dueAt !== undefined ? [makeReminder(input.dueAt, 'due')] : []
  }

  /** 计划时间变了，跟随它的那条提醒也要跟着走；时间被清掉则删除该提醒。 */
  function maintainDueReminder(todo: Todo, remindersReplaced: boolean): void {
    const dueIndex = todo.reminders.findIndex(r => r.origin === 'due')
    if (todo.dueAt === undefined) {
      if (dueIndex >= 0) todo.reminders.splice(dueIndex, 1)
      return
    }
    if (dueIndex >= 0) {
      const reminder = todo.reminders[dueIndex]
      if (reminder.triggerAt !== todo.dueAt) {
        reminder.triggerAt = todo.dueAt
        delete reminder.snoozedUntil
        delete reminder.lastNotifiedAt
        if (reminder.status === 'acknowledged') {
          reminder.status = 'pending'
          delete reminder.acknowledgedAt
        }
      }
      return
    }
    if (!remindersReplaced) todo.reminders.push(makeReminder(todo.dueAt, 'due'))
  }

  function applyStatus(todo: Todo, status: TodoStatus, at: number): void {
    if (todo.status === status) return
    todo.status = status
    if (status === 'completed') {
      todo.completedAt = at
      for (const reminder of todo.reminders) {
        if (reminder.status === 'pending') reminder.status = 'completed'
      }
      return
    }
    delete todo.completedAt
    for (const reminder of todo.reminders) {
      // 只复活未来的提醒：已经过去的那些重新变 pending 会立刻再弹一次通知。
      if (reminder.status === 'completed' && effectiveReminderAt(reminder) > at) {
        reminder.status = 'pending'
        delete reminder.lastNotifiedAt
      }
    }
  }

  function updateInFile(file: TodoFile, input: UpdateTodoInput, at: number): TodoMutation {
    const todo = file.todos.find(t => t.id === input.id)
    if (!todo) return { ok: false, reason: 'not-found' }
    if (input.expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== todo.updatedAt) {
      return { ok: false, reason: 'conflict', todo }
    }
    if (isReadOnly(todo)) return { ok: false, reason: 'read-only', todo }

    if (input.title !== undefined) {
      const title = input.title.trim()
      if (!title || title.length > TODO_TITLE_MAX_LENGTH) return { ok: false, reason: 'invalid-title', todo }
      todo.title = title
    }
    if (input.notes !== undefined) {
      if (input.notes) todo.notes = input.notes
      else delete todo.notes
    }
    if (input.priority !== undefined) todo.priority = normalizePriority(input.priority)
    if (input.groupId !== undefined) {
      if (input.groupId === null || input.groupId === '') delete todo.groupId
      else {
        if (!file.groups.some(g => g.id === input.groupId)) return { ok: false, reason: 'group-not-found', todo }
        todo.groupId = input.groupId
      }
    }
    if (input.tags !== undefined) todo.tags = normalizeTags(input.tags)
    if (input.projectRoot !== undefined) {
      if (input.projectRoot) todo.projectRoot = input.projectRoot
      else delete todo.projectRoot
    }
    if (input.dueAt !== undefined) {
      if (input.dueAt === null) delete todo.dueAt
      else if (Number.isFinite(input.dueAt)) todo.dueAt = input.dueAt
    }
    const remindersReplaced = Array.isArray(input.reminders)
    if (remindersReplaced) {
      todo.reminders = buildReminders({ reminders: input.reminders, dueAt: todo.dueAt })
    }
    maintainDueReminder(todo, remindersReplaced)
    if (input.status !== undefined) applyStatus(todo, input.status, at)

    todo.updatedAt = bumpUpdatedAt(todo.updatedAt)
    return { ok: true, todo }
  }

  return {
    list(query = {}) {
      const file = read()
      const search = query.search?.trim().toLowerCase()
      let todos = file.todos.filter(todo => {
        if (query.status && todo.status !== query.status) return false
        if (query.groupId && todo.groupId !== query.groupId) return false
        if (query.projectRoot && todo.projectRoot !== query.projectRoot) return false
        if (query.dueBefore !== undefined && (todo.dueAt === undefined || todo.dueAt > query.dueBefore)) return false
        if (search) {
          const haystack = `${todo.title}\n${todo.notes ?? ''}\n${todo.tags.join(' ')}`.toLowerCase()
          if (!haystack.includes(search)) return false
        }
        return true
      })
      todos = todos.sort(compareTodos)
      const limit = Math.min(Math.max(query.limit ?? TODO_LIST_LIMIT_MAX, 1), TODO_LIST_LIMIT_MAX)
      return todos.slice(0, limit)
    },

    get(id) {
      return read().todos.find(t => t.id === id) ?? null
    },

    all() {
      return read().todos.sort(compareTodos)
    },

    create(input) {
      const title = (input.title ?? '').trim()
      if (!title || title.length > TODO_TITLE_MAX_LENGTH) return { ok: false, reason: 'invalid-title' }
      return mutate(file => {
        if (input.groupId && !file.groups.some(g => g.id === input.groupId)) {
          return { result: { ok: false, reason: 'group-not-found' } as TodoMutation, dirty: false }
        }
        const at = now()
        const dueAt = finiteNumber(input.dueAt)
        const todo: Todo = {
          id: randomUUID(),
          title,
          status: 'open',
          priority: normalizePriority(input.priority),
          tags: normalizeTags(input.tags),
          reminders: buildReminders({ reminders: input.reminders, dueAt }),
          sessionLinks: [],
          orderIndex: file.todos.reduce((max, t) => Math.max(max, t.orderIndex), -1) + 1,
          createdAt: at,
          updatedAt: at,
        }
        if (input.notes) todo.notes = input.notes
        if (dueAt !== undefined) todo.dueAt = dueAt
        if (input.groupId) todo.groupId = input.groupId
        if (input.projectRoot) todo.projectRoot = input.projectRoot
        upsertSessionLink(todo, input.sessionId, at)
        file.todos.push(todo)
        return { result: { ok: true, todo } as TodoMutation, dirty: true }
      })
    },

    update(input) {
      const file = read()
      const before = file.todos.find(t => t.id === input.id)
      const snapshot = before ? JSON.stringify(before) : null
      const result = updateInFile(file, input, now())
      if (!result.ok) {
        // 校验是逐字段做的，失败前可能已经改了几个字段：不写盘，
        // 并且回给调用方的必须是读盘时的样子，否则 UI 会拿脏对象覆盖本地状态。
        return snapshot ? { ...result, todo: JSON.parse(snapshot) as Todo } : result
      }
      write(file)
      return result
    },

    remove(id) {
      return mutate(file => {
        const index = file.todos.findIndex(t => t.id === id)
        if (index < 0) return { result: { ok: false, reason: 'not-found' } as TodoRemoveResult, dirty: false }
        const [removed] = file.todos.splice(index, 1)
        return { result: { ok: true, removed } as TodoRemoveResult, dirty: true }
      })
    },

    restore(todo) {
      const normalized = normalizeTodo(todo)
      if (!normalized) return { ok: false, reason: 'invalid-title' }
      return mutate(file => {
        const existing = file.todos.find(t => t.id === normalized.id)
        if (existing) return { result: { ok: false, reason: 'conflict', todo: existing } as TodoMutation, dirty: false }
        file.todos.push(normalized)
        return { result: { ok: true, todo: normalized } as TodoMutation, dirty: true }
      })
    },

    bulkStatus(ids, status) {
      return mutate(file => {
        const at = now()
        const changed: Todo[] = []
        for (const id of new Set(ids)) {
          const result = updateInFile(file, { id, status }, at)
          if (result.ok) changed.push(result.todo)
        }
        return { result: changed, dirty: changed.length > 0 }
      })
    },

    bulkRemove(ids) {
      return mutate(file => {
        const wanted = new Set(ids)
        const removed = file.todos.filter(t => wanted.has(t.id))
        if (removed.length === 0) return { result: [] as Todo[], dirty: false }
        file.todos = file.todos.filter(t => !wanted.has(t.id))
        return { result: removed, dirty: true }
      })
    },

    reorder(ids) {
      return mutate(file => {
        const byId = new Map(file.todos.map(t => [t.id, t]))
        const ordered: Todo[] = []
        for (const id of ids) {
          const todo = byId.get(id)
          if (todo && !ordered.includes(todo)) ordered.push(todo)
        }
        const rest = file.todos
          .filter(t => !ordered.includes(t))
          .sort((a, b) => a.orderIndex - b.orderIndex)
        const final = [...ordered, ...rest]
        let dirty = false
        final.forEach((todo, index) => {
          if (todo.orderIndex !== index) {
            todo.orderIndex = index
            dirty = true
          }
        })
        // 排序是视图状态，不动 updatedAt —— 否则拖动一次就把别人正在编辑的版本判成冲突。
        return { result: file.todos.slice().sort(compareTodos), dirty }
      })
    },

    touchSession(id, sessionId) {
      return mutate(file => {
        const todo = file.todos.find(t => t.id === id)
        if (!todo || !sessionId) return { result: null as Todo | null, dirty: false }
        upsertSessionLink(todo, sessionId, now())
        return { result: todo as Todo | null, dirty: true }
      })
    },

    listGroups() {
      return read().groups.slice().sort((a, b) => a.orderIndex - b.orderIndex || a.createdAt - b.createdAt)
    },

    createGroup(name, color) {
      const trimmed = (name ?? '').trim()
      if (!trimmed || trimmed.length > TODO_GROUP_NAME_MAX_LENGTH) return { ok: false, reason: 'invalid-name' }
      return mutate(file => {
        if (file.groups.some(g => g.name.toLowerCase() === trimmed.toLowerCase())) {
          return { result: { ok: false, reason: 'duplicate-name' } as TodoGroupMutation, dirty: false }
        }
        const group: TodoGroup = {
          id: randomUUID(),
          name: trimmed,
          color: TODO_GROUP_COLORS.includes(color as (typeof TODO_GROUP_COLORS)[number])
            ? (color as string)
            : TODO_GROUP_COLORS[file.groups.length % TODO_GROUP_COLORS.length],
          orderIndex: file.groups.reduce((max, g) => Math.max(max, g.orderIndex), -1) + 1,
          createdAt: now(),
        }
        file.groups.push(group)
        return { result: { ok: true, group } as TodoGroupMutation, dirty: true }
      })
    },

    renameGroup(id, name) {
      const trimmed = (name ?? '').trim()
      if (!trimmed || trimmed.length > TODO_GROUP_NAME_MAX_LENGTH) return { ok: false, reason: 'invalid-name' }
      return mutate(file => {
        const group = file.groups.find(g => g.id === id)
        if (!group) return { result: { ok: false, reason: 'not-found' } as TodoGroupMutation, dirty: false }
        if (file.groups.some(g => g.id !== id && g.name.toLowerCase() === trimmed.toLowerCase())) {
          return { result: { ok: false, reason: 'duplicate-name' } as TodoGroupMutation, dirty: false }
        }
        group.name = trimmed
        return { result: { ok: true, group } as TodoGroupMutation, dirty: true }
      })
    },

    removeGroup(id) {
      return mutate(file => {
        const index = file.groups.findIndex(g => g.id === id)
        if (index < 0) return { result: { ok: false } as { ok: boolean }, dirty: false }
        file.groups.splice(index, 1)
        // 分组只是归类，删组不该连带删掉里面的待办。
        for (const todo of file.todos) {
          if (todo.groupId === id) delete todo.groupId
        }
        return { result: { ok: true } as { ok: boolean }, dirty: true }
      })
    },

    activeReminders(at) {
      const atMs = at ?? now()
      const file = read()
      const out: ActiveTodoReminder[] = []
      for (const todo of file.todos) {
        if (todo.status !== 'open') continue
        for (const reminder of todo.reminders) {
          if (reminder.status !== 'pending') continue
          if (effectiveReminderAt(reminder) > atMs) continue
          out.push(toActiveReminder(todo, reminder))
        }
      }
      return out.sort((a, b) => effectiveTrigger(a) - effectiveTrigger(b))
    },

    claimDueReminders(at) {
      const atMs = at ?? now()
      return mutate(file => {
        const claimed: ActiveTodoReminder[] = []
        for (const todo of file.todos) {
          if (todo.status !== 'open') continue
          for (const reminder of todo.reminders) {
            if (reminder.status !== 'pending') continue
            const effective = effectiveReminderAt(reminder)
            if (effective > atMs) continue
            // 一个提醒周期只通知一次；贪睡会清掉 lastNotifiedAt 重新武装。
            if (reminder.lastNotifiedAt !== undefined && reminder.lastNotifiedAt >= effective) continue
            reminder.lastNotifiedAt = atMs
            claimed.push(toActiveReminder(todo, reminder))
          }
        }
        return { result: claimed.sort((a, b) => effectiveTrigger(a) - effectiveTrigger(b)), dirty: claimed.length > 0 }
      })
    },

    acknowledgeReminder(todoId, reminderId) {
      return mutate(file => {
        const reminder = file.todos.find(t => t.id === todoId)?.reminders.find(r => r.id === reminderId)
        if (!reminder) return { result: false, dirty: false }
        reminder.status = 'acknowledged'
        reminder.acknowledgedAt = now()
        return { result: true, dirty: true }
      })
    },

    snoozeReminder(todoId, reminderId, minutes) {
      if (!Number.isFinite(minutes) || minutes < TODO_SNOOZE_MIN_MINUTES || minutes > TODO_SNOOZE_MAX_MINUTES) {
        return false
      }
      return mutate(file => {
        const reminder = file.todos.find(t => t.id === todoId)?.reminders.find(r => r.id === reminderId)
        if (!reminder) return { result: false, dirty: false }
        reminder.status = 'pending'
        reminder.snoozedUntil = now() + Math.round(minutes) * 60_000
        delete reminder.lastNotifiedAt
        delete reminder.acknowledgedAt
        return { result: true, dirty: true }
      })
    },

    findByNativeId(listId, externalId) {
      return (
        read().todos.find(
          t => t.nativeOrigin?.listId === listId && t.nativeOrigin.externalId === externalId,
        ) ?? null
      )
    },

    applySyncPatch(patch) {
      return mutate(file => {
        const upserts: Todo[] = []
        for (const raw of patch.upserts) {
          const todo = normalizeTodo(raw)
          if (!todo) continue
          const index = file.todos.findIndex(t => t.id === todo.id)
          if (index >= 0) file.todos[index] = todo
          else file.todos.push(todo)
          upserts.push(todo)
        }
        const wanted = new Set(patch.removedIds)
        const removedIds = file.todos.filter(t => wanted.has(t.id)).map(t => t.id)
        if (removedIds.length > 0) file.todos = file.todos.filter(t => !wanted.has(t.id))
        return {
          result: { upserts, removedIds },
          dirty: upserts.length > 0 || removedIds.length > 0,
        }
      })
    },
  }
}

function effectiveTrigger(reminder: ActiveTodoReminder): number {
  return reminder.snoozedUntil ?? reminder.triggerAt
}