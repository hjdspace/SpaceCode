/**
 * 与 macOS 提醒事项的双向同步。
 *
 * 判定「谁改了」靠三方比较：本地内容指纹、系统内容指纹、上次达成一致时记下的
 * syncedHash。只有一边动过就跟随那一边；两边都动过且结果不同则记冲突交给用户，
 * 绝不静默覆盖 —— 这是 Proma 的口径，也是唯一不会丢用户输入的做法。
 *
 * 本地删除靠墓碑（tombstone）表达：没有它，下一次拉取会把刚删掉的条目重新导入。
 * 墓碑由服务层在删除/撤销删除时喂进来（noteLocalDeletions / noteLocalRestorations）。
 *
 * 传输层可注入，所以整条推拉链能在非 macOS 上用假 osascript 跑完整一轮。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type {
  RemindersListInfo,
  Todo,
  TodoSyncActionResult,
  TodoSyncConflict,
  TodoSyncConfig,
  TodoSyncErrorCode,
  TodoSyncPermission,
  TodoSyncState,
} from '@/shared/channels/todo'
import type { TodoStore, TodoSyncPatch } from './todoStore'
import { RemindersBridgeError, createRemindersBridge, type RemindersBridge } from './remindersBridge'
import {
  contentToNativeWrite,
  nativeContentHash,
  nativeToContent,
  todoContentHash,
  type NativeReminder,
  type TodoContent,
} from './remindersMapping'
import type { NativeCreate, NativeUpdate, PushOps } from './remindersScript'
import { warn } from '../infra/logger'

export const REMINDERS_AUTO_SYNC_MS = 5 * 60_000

export type TodoSyncEvent =
  | { kind: 'state'; state: TodoSyncState }
  | { kind: 'todos'; patch: TodoSyncPatch }

export interface TodoSyncController {
  getState(): TodoSyncState
  requestAccess(): Promise<TodoSyncActionResult>
  setConfig(config: Partial<TodoSyncConfig>): Promise<TodoSyncActionResult>
  syncNow(): Promise<TodoSyncActionResult>
  resolveConflict(conflictId: string, keep: 'local' | 'native'): Promise<TodoSyncActionResult>
  noteLocalDeletions(todos: Todo[]): void
  noteLocalRestorations(todos: Todo[]): void
  subscribe(listener: (event: TodoSyncEvent) => void): () => void
  start(): void
  stop(): void
}

interface Tombstone {
  listId: string
  externalId: string
}

interface SyncFile {
  config: TodoSyncConfig
  permission: TodoSyncPermission
  conflicts: TodoSyncConflict[]
  tombstones: Tombstone[]
}

export interface RemindersSyncOptions {
  store: TodoStore
  configPath: string
  bridge?: RemindersBridge
  now?: () => number
  autoSyncIntervalMs?: number
}

const WRITE_DENIED_PATTERN = /not authoriz|read.?only|cannot be modified|can't be modified|-10000/i

function emptyFile(): SyncFile {
  return {
    config: { enabled: false, listId: null },
    permission: 'unknown',
    conflicts: [],
    tombstones: [],
  }
}

function contentOf(todo: Todo): TodoContent {
  return {
    title: todo.title,
    notes: todo.notes,
    status: todo.status,
    priority: todo.priority,
    dueAt: todo.dueAt,
  }
}

/** 系统侧改了内容后，本地要跟着动，但提醒/分组/标签/会话痕迹是本地独有的，保留。 */
function applyNativeContent(todo: Todo, content: TodoContent, hash: string, at: number, dueDateOnly: boolean): Todo {
  const next: Todo = {
    ...todo,
    title: content.title,
    status: content.status,
    priority: content.priority,
    updatedAt: Math.max(at, todo.updatedAt + 1),
    reminders: todo.reminders.map(r => ({ ...r })),
    nativeOrigin: {
      source: 'macos-reminders',
      listId: todo.nativeOrigin?.listId ?? '',
      listTitle: todo.nativeOrigin?.listTitle ?? '',
      externalId: todo.nativeOrigin?.externalId ?? '',
      canWrite: todo.nativeOrigin?.canWrite !== false,
      syncedHash: hash,
      ...(dueDateOnly ? { dueDateOnly: true } : {}),
    },
  }
  if (content.notes) next.notes = content.notes
  else delete next.notes
  if (content.dueAt === undefined) delete next.dueAt
  else next.dueAt = content.dueAt
  if (content.status === 'completed') next.completedAt = todo.completedAt ?? at
  else delete next.completedAt

  const dueIndex = next.reminders.findIndex(r => r.origin === 'due')
  if (content.dueAt === undefined) {
    if (dueIndex >= 0) next.reminders.splice(dueIndex, 1)
  } else if (dueIndex >= 0) {
    next.reminders[dueIndex].triggerAt = content.dueAt
    delete next.reminders[dueIndex].snoozedUntil
    delete next.reminders[dueIndex].lastNotifiedAt
  } else {
    next.reminders.push({ id: randomUUID(), triggerAt: content.dueAt, status: 'pending', origin: 'due' })
  }
  if (next.status === 'completed') {
    for (const reminder of next.reminders) {
      if (reminder.status === 'pending') reminder.status = 'completed'
    }
  }
  return next
}

function todoFromNative(native: NativeReminder, list: RemindersListInfo, at: number, orderIndex: number): Todo {
  const content = nativeToContent(native)
  const todo: Todo = {
    id: randomUUID(),
    title: content.title || list.title,
    status: content.status,
    priority: content.priority,
    tags: [],
    reminders:
      content.dueAt !== undefined && content.status === 'open'
        ? [{ id: randomUUID(), triggerAt: content.dueAt, status: 'pending', origin: 'due' }]
        : [],
    sessionLinks: [],
    orderIndex,
    createdAt: at,
    updatedAt: at,
    nativeOrigin: {
      source: 'macos-reminders',
      listId: list.id,
      listTitle: list.title,
      externalId: native.id,
      canWrite: list.writable,
      syncedHash: nativeContentHash(native),
      ...(native.dueDateOnly ? { dueDateOnly: true } : {}),
    },
  }
  if (content.notes) todo.notes = content.notes
  if (content.dueAt !== undefined) todo.dueAt = content.dueAt
  if (content.status === 'completed') todo.completedAt = at
  return todo
}

export function createRemindersSync(options: RemindersSyncOptions): TodoSyncController {
  const { store, configPath } = options
  const bridge = options.bridge ?? createRemindersBridge()
  const now = options.now ?? Date.now
  const autoSyncIntervalMs = options.autoSyncIntervalMs ?? REMINDERS_AUTO_SYNC_MS

  let file = readFile()
  let lists: RemindersListInfo[] = []
  let syncing = false
  let lastError: TodoSyncErrorCode | undefined
  let timer: ReturnType<typeof setInterval> | null = null
  const listeners = new Set<(event: TodoSyncEvent) => void>()

  function readFile(): SyncFile {
    if (!existsSync(configPath)) return emptyFile()
    try {
      const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as Partial<SyncFile>
      const base = emptyFile()
      return {
        config: {
          enabled: raw.config?.enabled === true,
          listId: typeof raw.config?.listId === 'string' ? raw.config.listId : null,
          ...(typeof raw.config?.lastSyncAt === 'number' ? { lastSyncAt: raw.config.lastSyncAt } : {}),
        },
        permission: raw.permission ?? base.permission,
        conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
        tombstones: Array.isArray(raw.tombstones) ? raw.tombstones : [],
      }
    } catch {
      return emptyFile()
    }
  }

  function persist(): void {
    const dir = dirname(configPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmpPath = `${configPath}.tmp.${process.pid}.${Date.now()}`
    writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf-8')
    renameSync(tmpPath, configPath)
  }

  function emit(event: TodoSyncEvent): void {
    for (const listener of listeners) listener(event)
  }

  function state(): TodoSyncState {
    return {
      supported: bridge.supported,
      permission: bridge.supported ? file.permission : 'unsupported',
      config: { ...file.config },
      lists: lists.map(l => ({ ...l })),
      conflicts: file.conflicts.map(c => ({ ...c })),
      syncing,
      ...(file.config.lastSyncAt !== undefined ? { lastSyncAt: file.config.lastSyncAt } : {}),
      ...(lastError ? { lastError } : {}),
    }
  }

  function publishState(): void {
    emit({ kind: 'state', state: state() })
  }

  function ok(): TodoSyncActionResult {
    return { ok: true, state: state() }
  }

  function failure(error: TodoSyncErrorCode): TodoSyncActionResult {
    lastError = error
    publishState()
    return { ok: false, error, state: state() }
  }

  function errorCodeOf(err: unknown): TodoSyncErrorCode {
    if (err instanceof RemindersBridgeError) return err.code
    return 'script-failed'
  }

  function selectedList(): RemindersListInfo | null {
    return lists.find(l => l.id === file.config.listId) ?? null
  }

  function upsertConflict(conflict: TodoSyncConflict): void {
    const index = file.conflicts.findIndex(c => c.todoId === conflict.todoId)
    if (index >= 0) file.conflicts[index] = conflict
    else file.conflicts.push(conflict)
  }

  function markReadOnly(todo: Todo, upserts: Map<string, Todo>): void {
    const current = upserts.get(todo.id) ?? todo
    const listId = current.nativeOrigin?.listId ?? file.config.listId
    lists = lists.map(l => (l.id === listId ? { ...l, writable: false } : l))
    if (!current.nativeOrigin) return
    upserts.set(todo.id, {
      ...current,
      nativeOrigin: { ...current.nativeOrigin, canWrite: false },
    })
  }

  /** 拉取 + 推送一轮。调用方保证 supported / enabled / listId 都就位。 */
  async function runSync(): Promise<TodoSyncActionResult> {
    const listId = file.config.listId
    if (!listId) return failure('no-list-selected')

    let natives: NativeReminder[]
    try {
      natives = await bridge.fetch(listId)
    } catch (err) {
      const code = errorCodeOf(err)
      if (code === 'permission-denied') {
        file.permission = 'denied'
        persist()
      }
      warn('TodoSync', `Fetch failed | list=${listId} | code=${code}`, { error: String(err) })
      return failure(code)
    }

    const at = now()
    const list: RemindersListInfo = selectedList() ?? { id: listId, title: '', writable: true }
    const nativeById = new Map(natives.map(n => [n.id, n]))
    const all = store.all()
    const bound = all.filter(t => t.nativeOrigin?.listId === listId)
    const boundByExternal = new Map(bound.map(t => [t.nativeOrigin!.externalId, t]))
    const upserts = new Map<string, Todo>()
    const removedIds: string[] = []
    const creates: NativeCreate[] = []
    const updates: NativeUpdate[] = []
    const deletes: string[] = []
    let orderIndex = all.reduce((max, t) => Math.max(max, t.orderIndex), -1) + 1

    // ── 拉取：系统 → 本地 ──
    // 有墓碑的条目本轮不导入：用户刚在本地删掉它，导回来再删一次等于闪一下。
    const tombstoned = new Set(file.tombstones.filter(t => t.listId === listId).map(t => t.externalId))
    for (const native of natives) {
      if (tombstoned.has(native.id)) continue
      const nativeHash = nativeContentHash(native)
      const local = boundByExternal.get(native.id)
      if (!local) {
        const created = todoFromNative(native, list, at, orderIndex++)
        upserts.set(created.id, created)
        continue
      }
      const localHash = todoContentHash(contentOf(local))
      const agreed = local.nativeOrigin?.syncedHash
      const nativeChanged = nativeHash !== agreed
      const localChanged = localHash !== agreed
      if (nativeChanged && localChanged && nativeHash !== localHash) {
        upsertConflict({
          id: randomUUID(),
          todoId: local.id,
          todoTitle: local.title,
          nativeTitle: native.title,
          kind: 'changed',
          localUpdatedAt: local.updatedAt,
          detectedAt: at,
        })
        continue
      }
      if (nativeChanged && nativeHash !== localHash) {
        upserts.set(local.id, applyNativeContent(local, nativeToContent(native), nativeHash, at, native.dueDateOnly === true))
        continue
      }
      if (localChanged && localHash !== nativeHash && local.nativeOrigin?.canWrite !== false) {
        updates.push({ id: native.id, ...contentToNativeWrite(contentOf(local)) })
        continue
      }
      if (local.nativeOrigin?.syncedHash !== localHash) {
        // 内容其实一致，只是指纹没记全（例如首次接管一条旧绑定），补记即可。
        upserts.set(local.id, {
          ...local,
          nativeOrigin: { ...local.nativeOrigin!, syncedHash: localHash },
        })
      }
    }

    // ── 系统侧删除 ──
    for (const [externalId, local] of boundByExternal) {
      if (nativeById.has(externalId)) continue
      const localHash = todoContentHash(contentOf(local))
      if (localHash === local.nativeOrigin?.syncedHash) {
        removedIds.push(local.id)
        upserts.delete(local.id)
      } else {
        upsertConflict({
          id: randomUUID(),
          todoId: local.id,
          todoTitle: local.title,
          nativeTitle: local.title,
          kind: 'deleted',
          localUpdatedAt: local.updatedAt,
          detectedAt: at,
        })
      }
    }

    // ── 本地删除 → 系统（墓碑）──
    // 系统侧已经没有的墓碑直接作废：没有东西可删，留着只会每轮空转。
    const otherListTombstones = file.tombstones.filter(t => t.listId !== listId)
    let keptTombstones = file.tombstones
      .filter(t => t.listId === listId)
      .filter(t => nativeById.has(t.externalId))
    deletes.push(...keptTombstones.map(t => t.externalId))

    // ── 本地新建 → 系统 ──
    for (const todo of all) {
      if (todo.nativeOrigin) continue
      creates.push({ key: todo.id, ...contentToNativeWrite(contentOf(todo)) })
    }

    let pushFailed: TodoSyncErrorCode | null = null
    // 已知只读的列表不再尝试写：每轮重复失败只会刷日志，拉取仍然继续。
    const listWritable = selectedList()?.writable !== false
    if (listWritable && (creates.length > 0 || updates.length > 0 || deletes.length > 0)) {
      const ops: PushOps = { listId, creates, updates, deletes }
      try {
        const result = await bridge.push(ops)
        const pushedById = new Map(all.map(t => [t.id, t]))
        for (const created of result.created) {
          const local = upserts.get(created.key) ?? pushedById.get(created.key)
          if (!local) continue
          const hash = todoContentHash(contentOf(local))
          upserts.set(local.id, {
            ...local,
            nativeOrigin: {
              source: 'macos-reminders',
              listId,
              listTitle: list.title,
              externalId: created.id,
              canWrite: true,
              syncedHash: hash,
              ...(contentToNativeWrite(contentOf(local)).dueDateOnly ? { dueDateOnly: true } : {}),
            },
          })
        }
        for (const externalId of result.updated) {
          const local = boundByExternal.get(externalId)
          if (!local) continue
          const current = upserts.get(local.id) ?? local
          upserts.set(local.id, {
            ...current,
            nativeOrigin: { ...current.nativeOrigin!, syncedHash: todoContentHash(contentOf(current)) },
          })
        }
        const deletedSet = new Set(result.deleted)
        keptTombstones = keptTombstones.filter(t => !deletedSet.has(t.externalId))
        for (const error of result.errors) {
          warn('TodoSync', `Push item failed | key=${error.key} | ${error.message}`)
          const local = pushedById.get(error.key) ?? boundByExternal.get(error.key)
          if (local && WRITE_DENIED_PATTERN.test(error.message)) markReadOnly(local, upserts)
          else pushFailed = 'script-failed'
        }
      } catch (err) {
        const code = errorCodeOf(err)
        if (code === 'permission-denied') {
          file.permission = 'denied'
          lists = lists.map(l => (l.id === listId ? { ...l, writable: false } : l))
        }
        warn('TodoSync', `Push failed | list=${listId} | code=${code}`, { error: String(err) })
        pushFailed = code
      }
    }

    file.tombstones = [...otherListTombstones, ...keptTombstones]
    file.config.lastSyncAt = at
    if (file.permission !== 'denied') file.permission = 'granted'
    lastError = pushFailed ?? undefined
    persist()

    const patch = store.applySyncPatch({ upserts: [...upserts.values()], removedIds })
    if (patch.upserts.length > 0 || patch.removedIds.length > 0) emit({ kind: 'todos', patch })
    publishState()
    return pushFailed ? { ok: false, error: pushFailed, state: state() } : ok()
  }

  async function syncNow(): Promise<TodoSyncActionResult> {
    if (!bridge.supported) return failure('unsupported-platform')
    if (!file.config.enabled) return ok()
    if (!file.config.listId) return failure('no-list-selected')
    // 上一轮还在跑就直接返回当前状态：并发两轮会互相覆盖 syncedHash。
    if (syncing) return ok()
    syncing = true
    publishState()
    try {
      return await runSync()
    } finally {
      syncing = false
      publishState()
    }
  }

  return {
    getState: state,

    async requestAccess() {
      if (!bridge.supported) return failure('unsupported-platform')
      try {
        const nativeLists = await bridge.listLists()
        lists = nativeLists.map(l => ({ id: l.id, title: l.title, writable: true }))
        file.permission = 'granted'
        lastError = undefined
        persist()
        publishState()
        return ok()
      } catch (err) {
        const code = errorCodeOf(err)
        if (code === 'permission-denied') {
          file.permission = 'denied'
          persist()
        }
        return failure(code)
      }
    },

    async setConfig(config) {
      const next: TodoSyncConfig = {
        enabled: config.enabled ?? file.config.enabled,
        listId: config.listId === undefined ? file.config.listId : config.listId,
        ...(file.config.lastSyncAt !== undefined ? { lastSyncAt: file.config.lastSyncAt } : {}),
      }
      if (next.enabled && !next.listId) return failure('no-list-selected')
      const listChanged = next.listId !== file.config.listId
      file.config = next
      // 冲突属于旧列表，换列表后不再成立；已同步的待办留在原列表，不迁移。
      if (listChanged) file.conflicts = []
      lastError = undefined
      persist()
      publishState()
      if (!next.enabled) return ok()
      if (!bridge.supported) return failure('unsupported-platform')
      return syncNow()
    },

    syncNow,

    async resolveConflict(conflictId, keep) {
      const conflict = file.conflicts.find(c => c.id === conflictId)
      if (!conflict) return ok()
      const listId = file.config.listId
      if (!listId) return failure('no-list-selected')
      const local = store.get(conflict.todoId)
      if (!local?.nativeOrigin) {
        file.conflicts = file.conflicts.filter(c => c.id !== conflictId)
        persist()
        publishState()
        return ok()
      }
      const at = now()
      try {
        if (keep === 'local') {
          const write = contentToNativeWrite(contentOf(local))
          const exists = conflict.kind === 'changed'
          const result = await bridge.push({
            listId,
            creates: exists ? [] : [{ key: local.id, ...write }],
            updates: exists ? [{ id: local.nativeOrigin.externalId, ...write }] : [],
            deletes: [],
          })
          const externalId = exists ? local.nativeOrigin.externalId : result.created[0]?.id
          if (!externalId) return failure('script-failed')
          store.applySyncPatch({
            upserts: [{
              ...local,
              nativeOrigin: {
                ...local.nativeOrigin,
                listId,
                externalId,
                canWrite: true,
                syncedHash: todoContentHash(contentOf(local)),
              },
            }],
            removedIds: [],
          })
        } else {
          const natives = await bridge.fetch(listId)
          const native = natives.find(n => n.id === local.nativeOrigin?.externalId)
          if (!native) {
            const patch = store.applySyncPatch({ upserts: [], removedIds: [local.id] })
            if (patch.removedIds.length > 0) emit({ kind: 'todos', patch })
          } else {
            const merged = applyNativeContent(local, nativeToContent(native), nativeContentHash(native), at, native.dueDateOnly === true)
            const patch = store.applySyncPatch({ upserts: [merged], removedIds: [] })
            emit({ kind: 'todos', patch })
          }
        }
      } catch (err) {
        return failure(errorCodeOf(err))
      }
      file.conflicts = file.conflicts.filter(c => c.id !== conflictId)
      persist()
      publishState()
      const changed = store.get(local.id)
      if (changed) emit({ kind: 'todos', patch: { upserts: [changed], removedIds: [] } })
      return ok()
    },

    noteLocalDeletions(todos) {
      let dirty = false
      for (const todo of todos) {
        if (!todo.nativeOrigin) continue
        const { listId, externalId } = todo.nativeOrigin
        if (file.tombstones.some(t => t.listId === listId && t.externalId === externalId)) continue
        file.tombstones.push({ listId, externalId })
        dirty = true
      }
      // 本地删除同时作废这条待办上的未决冲突。
      const ids = new Set(todos.map(t => t.id))
      const before = file.conflicts.length
      file.conflicts = file.conflicts.filter(c => !ids.has(c.todoId))
      if (dirty || file.conflicts.length !== before) {
        persist()
        publishState()
      }
    },

    noteLocalRestorations(todos) {
      const keys = new Set(
        todos.filter(t => t.nativeOrigin).map(t => `${t.nativeOrigin!.listId}::${t.nativeOrigin!.externalId}`),
      )
      if (keys.size === 0) return
      const before = file.tombstones.length
      file.tombstones = file.tombstones.filter(t => !keys.has(`${t.listId}::${t.externalId}`))
      if (file.tombstones.length !== before) {
        persist()
        publishState()
      }
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    start() {
      if (timer || !bridge.supported || !file.config.enabled) return
      timer = setInterval(() => {
        void syncNow()
      }, autoSyncIntervalMs)
      void syncNow()
    },

    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}