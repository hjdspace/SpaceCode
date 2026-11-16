/**
 * Todo 服务 — IPC handler、变更广播、到点提醒调度。
 *
 * 三个写入方（用户 UI / Agent 的 MCP 工具 / macOS 提醒事项同步）都经过同一个
 * store，因此广播也集中在这里：任何一方改完，其余方的界面立刻收到增量。
 *
 * createTodoService 把 Electron 依赖（窗口广播、系统通知、语言）作为参数注入，
 * 所以调度与广播逻辑可以在测试里用真实 store + 假通知跑完整一轮。
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { eventChannels } from '@/shared/channelMap'
import type { DeriveHandler } from '@/shared/channelMap'
import { registerHandlers } from '@/shared/handlerRegistry'
import { todoNamespace } from '@/shared/channels/todo'
import type {
  ActiveTodoReminder,
  TodoAgentOperation,
  TodoChangePayload,
} from '@/shared/channels/todo'
import { createTodoStore, type TodoStore } from './todoStore'
import { createRemindersSync, type TodoSyncController } from './remindersSync'
import { startTodoMcpServer, stopTodoMcpServer } from './todoMcpServer'
import { showSystemNotification } from '../infra/notificationService'
import { info, warn } from '../infra/logger'

export const TODO_FILE_NAME = 'spacecode-todos.json'
export const TODO_SYNC_FILE_NAME = 'spacecode-todo-sync.json'
/** 与 Proma 的提醒轮询同量级：30s 一次，足够准时又不空转。 */
export const TODO_REMINDER_TICK_MS = 30_000

const EVENTS = eventChannels(todoNamespace.events, 'todo:')

const NOTIFICATION_TITLE: Record<'zh-CN' | 'en-US', string> = {
  'zh-CN': '待办提醒',
  'en-US': 'Todo reminder',
}

export interface TodoServiceDeps {
  store: TodoStore
  sync: TodoSyncController
  send: (channel: string, ...args: unknown[]) => void
  notify: (reminder: ActiveTodoReminder, locale: 'zh-CN' | 'en-US') => void
  getLocale?: () => 'zh-CN' | 'en-US'
}

export interface TodoService {
  handlers: DeriveHandler<typeof todoNamespace.channels>
  /** Agent 侧的写入面：同一套 store，但广播标记为 agent 并附带会话痕迹。 */
  forAgent(sessionId: string | null): TodoAgentApi
  /** 跑一轮提醒：认领到点的 → 发系统通知 → 推送当前提醒集合 */
  tick(): ActiveTodoReminder[]
  publishReminders(): void
  broadcastChange(payload: TodoChangePayload): void
  broadcastAgentOperation(operation: TodoAgentOperation): void
}

export interface TodoAgentApi {
  list: DeriveHandler<typeof todoNamespace.channels>['list']
  get: DeriveHandler<typeof todoNamespace.channels>['get']
  create: DeriveHandler<typeof todoNamespace.channels>['create']
  update: DeriveHandler<typeof todoNamespace.channels>['update']
  remove: DeriveHandler<typeof todoNamespace.channels>['remove']
  listGroups: DeriveHandler<typeof todoNamespace.channels>['listGroups']
  createGroup: DeriveHandler<typeof todoNamespace.channels>['createGroup']
  touchSession(id: string): void
}

function reminderSignature(reminders: ActiveTodoReminder[]): string {
  return reminders.map(r => `${r.id}@${r.snoozedUntil ?? r.triggerAt}`).join('|')
}

export function createTodoService(deps: TodoServiceDeps): TodoService {
  const { store, sync, send, notify } = deps
  let lastSignature = ''

  function publishReminders(): void {
    const reminders = store.activeReminders()
    const signature = reminderSignature(reminders)
    if (signature === lastSignature) return
    lastSignature = signature
    send(EVENTS.onReminderDue, reminders)
  }

  function broadcastChange(payload: TodoChangePayload): void {
    send(EVENTS.onChanged, payload)
    // 完成 / 改时间 / 删除都会改变到点集合，提醒栏必须跟着收口。
    publishReminders()
  }

  function broadcastAgentOperation(operation: TodoAgentOperation): void {
    send(EVENTS.onAgentOperation, operation)
  }

  sync.subscribe(event => {
    if (event.kind === 'state') {
      send(EVENTS.onSyncStateChanged, event.state)
      return
    }
    if (event.patch.upserts.length > 0 || event.patch.removedIds.length > 0) {
      broadcastChange({
        todos: event.patch.upserts,
        removedIds: event.patch.removedIds,
        source: 'sync',
      })
    }
  })

  const handlers: DeriveHandler<typeof todoNamespace.channels> = {
    list: query => store.list(query),
    get: id => store.get(id),
    create: input => {
      const result = store.create(input)
      if (result.ok) broadcastChange({ todos: [result.todo], source: 'user' })
      return result
    },
    update: input => {
      const result = store.update(input)
      if (result.ok) broadcastChange({ todos: [result.todo], source: 'user' })
      return result
    },
    remove: id => {
      const result = store.remove(id)
      if (result.ok) {
        // 已同步的条目要留墓碑，否则下一轮拉取会把它原样导回来。
        sync.noteLocalDeletions([result.removed])
        broadcastChange({ removedIds: [result.removed.id], source: 'user' })
      }
      return result
    },
    restore: todo => {
      const result = store.restore(todo)
      if (result.ok) {
        sync.noteLocalRestorations([result.todo])
        broadcastChange({ todos: [result.todo], source: 'user' })
      }
      return result
    },
    bulkStatus: (ids, status) => {
      const changed = store.bulkStatus(ids, status)
      if (changed.length > 0) broadcastChange({ todos: changed, source: 'user' })
      return changed
    },
    bulkRemove: ids => {
      const removed = store.bulkRemove(ids)
      if (removed.length > 0) {
        sync.noteLocalDeletions(removed)
        broadcastChange({ removedIds: removed.map(t => t.id), source: 'user' })
      }
      return removed
    },
    reorder: ids => {
      const todos = store.reorder(ids)
      broadcastChange({ todos, source: 'user' })
      return todos
    },
    touchSession: (id, sessionId) => {
      const todo = store.touchSession(id, sessionId)
      if (todo) broadcastChange({ todos: [todo], source: 'user' })
      return todo
    },
    listGroups: () => store.listGroups(),
    createGroup: (name, color) => {
      const result = store.createGroup(name, color)
      if (result.ok) broadcastChange({ groups: [result.group], source: 'user' })
      return result
    },
    renameGroup: (id, name) => {
      const result = store.renameGroup(id, name)
      if (result.ok) broadcastChange({ groups: [result.group], source: 'user' })
      return result
    },
    removeGroup: id => {
      const result = store.removeGroup(id)
      if (result.ok) {
        // 删组会把组内待办的 groupId 摘掉，整表回传让渲染层不必自己猜。
        broadcastChange({ removedGroupIds: [id], todos: store.list(), source: 'user' })
      }
      return result
    },
    listActiveReminders: () => store.activeReminders(),
    acknowledgeReminder: (todoId, reminderId) => {
      const ok = store.acknowledgeReminder(todoId, reminderId)
      if (ok) publishReminders()
      return { ok }
    },
    snoozeReminder: (todoId, reminderId, minutes) => {
      const ok = store.snoozeReminder(todoId, reminderId, minutes)
      if (ok) publishReminders()
      return { ok }
    },
    getSyncState: () => sync.getState(),
    requestSyncAccess: () => sync.requestAccess(),
    setSyncConfig: config => sync.setConfig(config),
    syncNow: () => sync.syncNow(),
    resolveSyncConflict: (conflictId, keep) => sync.resolveConflict(conflictId, keep),
  }

  function agentApi(sessionId: string | null): TodoAgentApi {
    function announce(
      action: TodoAgentOperation['action'],
      todo: { id: string; title: string },
    ): void {
      const current = store.get(todo.id)
      if (current) broadcastChange({ todos: [current], source: 'agent' })
      broadcastAgentOperation({ sessionId, action, todoId: todo.id, title: todo.title })
    }

    return {
      list: query => store.list(query),
      get: id => {
        const todo = store.get(id)
        // 读过也算痕迹：用户问「这条待办上次聊到哪」时要能反查到会话。
        if (todo && sessionId) {
          const touched = store.touchSession(id, sessionId)
          if (touched) broadcastChange({ todos: [touched], source: 'agent' })
        }
        return store.get(id)
      },
      create: input => {
        const result = store.create({ ...input, sessionId: input.sessionId ?? sessionId ?? undefined })
        if (result.ok) announce('created', result.todo)
        return result
      },
      update: input => {
        const result = store.update(input)
        if (result.ok) {
          if (sessionId) store.touchSession(result.todo.id, sessionId)
          const action: TodoAgentOperation['action'] =
            input.status === 'completed' ? 'completed' : input.status === 'open' ? 'reopened' : 'updated'
          announce(action, result.todo)
        }
        return result
      },
      remove: id => {
        const result = store.remove(id)
        if (result.ok) {
          sync.noteLocalDeletions([result.removed])
          broadcastChange({ removedIds: [result.removed.id], source: 'agent' })
          broadcastAgentOperation({ sessionId, action: 'deleted', todoId: result.removed.id, title: result.removed.title })
        }
        return result
      },
      listGroups: () => store.listGroups(),
      createGroup: (name, color) => {
        const result = store.createGroup(name, color)
        if (result.ok) broadcastChange({ groups: [result.group], source: 'agent' })
        return result
      },
      touchSession: id => {
        if (!sessionId) return
        const touched = store.touchSession(id, sessionId)
        if (touched) broadcastChange({ todos: [touched], source: 'agent' })
      },
    }
  }

  return {
    handlers,
    forAgent: agentApi,
    tick() {
      const claimed = store.claimDueReminders()
      const locale = deps.getLocale?.() ?? 'zh-CN'
      for (const reminder of claimed) {
        try {
          notify(reminder, locale)
        } catch (err) {
          warn('Todo', `Reminder notification failed | todo=${reminder.todoId}`, { error: String(err) })
        }
      }
      publishReminders()
      return claimed
    },
    publishReminders,
    broadcastChange,
    broadcastAgentOperation,
  }
}

// ── 单例与 Electron 接线 ────────────────────────────────────────

let store: TodoStore | null = null
let sync: TodoSyncController | null = null
let service: TodoService | null = null
let reminderTimer: ReturnType<typeof setInterval> | null = null

export function getTodoStore(): TodoStore {
  if (!store) {
    store = createTodoStore({ filePath: join(app.getPath('userData'), TODO_FILE_NAME) })
  }
  return store
}

/** 界面语言存在渲染层写下的 gui-settings.json 里，主进程只读取，不维护第二份状态。 */
function readGuiLocale(): 'zh-CN' | 'en-US' {
  try {
    const settingsPath = join(app.getPath('home'), '.claude', 'gui-settings.json')
    if (!existsSync(settingsPath)) return 'zh-CN'
    const raw = readFileSync(settingsPath, 'utf-8')
    if (!raw.trim()) return 'zh-CN'
    return JSON.parse(raw)?.language === 'en-US' ? 'en-US' : 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

function broadcastToWindows(channel: string, ...args: unknown[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args)
  }
}

export function getTodoSync(): TodoSyncController {
  if (!sync) {
    sync = createRemindersSync({
      store: getTodoStore(),
      configPath: join(app.getPath('userData'), TODO_SYNC_FILE_NAME),
    })
  }
  return sync
}

export function getTodoService(): TodoService {
  if (!service) {
    service = createTodoService({
      store: getTodoStore(),
      sync: getTodoSync(),
      send: broadcastToWindows,
      notify: (reminder, locale) => {
        showSystemNotification({
          title: NOTIFICATION_TITLE[locale],
          message: reminder.todoTitle,
          window: BrowserWindow.getAllWindows()[0] ?? null,
        })
      },
      getLocale: readGuiLocale,
    })
  }
  return service
}

export function startTodoReminderScheduler(): void {
  if (reminderTimer) return
  const svc = getTodoService()
  // 启动即跑一轮：应用没开的时候到点的提醒，开机后应该马上看到。
  svc.tick()
  reminderTimer = setInterval(() => svc.tick(), TODO_REMINDER_TICK_MS)
  info('Todo', `Reminder scheduler started | intervalMs=${TODO_REMINDER_TICK_MS}`)
}

export function stopTodoReminderScheduler(): void {
  if (reminderTimer) {
    clearInterval(reminderTimer)
    reminderTimer = null
  }
}

export function registerTodoIPCHandlers(): void {
  registerHandlers(ipcMain, todoNamespace.channels, 'todo:', getTodoService().handlers)
  startTodoReminderScheduler()
  getTodoSync().start()
  // Agent 的待办工具面：起不来只是这一轮没有工具，用户面板照常可用。
  void startTodoMcpServer(sessionId => getTodoService().forAgent(sessionId)).catch(() => {})
  app.on('before-quit', () => {
    stopTodoReminderScheduler()
    getTodoSync().stop()
    void stopTodoMcpServer()
    info('Todo', 'Reminder scheduler stopped on before-quit')
  })
  info('Todo', 'Todo IPC handlers registered')
}