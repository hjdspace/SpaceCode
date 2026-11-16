/**
 * Todo Channel 定义 — todo 命名空间 IPC 的单一真相源。
 *
 * 参考 Proma 的 Planning 模型（Todo + 分组 + 提醒 + 会话关联 + 系统提醒事项来源），
 * 按 SpaceCode 的口径落成 JSON 文件存储：待办是跨项目的日常事项，因此不随
 * 项目根走，只在 todo.projectRoot 上记录「这件事属于哪个工作区」。
 *
 * 这份定义同时被四方消费：preload bridge、renderer api、主进程 handler、
 * 以及主进程内的 MCP 工具层（Agent 与用户走同一套 store 写入路径）。
 */
import { defineNamespace } from '@/shared/channelMap'
import type { DeriveRendererApi, DeriveEventApi } from '@/shared/channelMap'

export type TodoStatus = 'open' | 'completed'
export type TodoPriority = 'low' | 'medium' | 'high'

/** 分组色板：存 token 名而不是裸色值，暗色主题才能各自映射。 */
export const TODO_GROUP_COLORS = ['teal', 'blue', 'violet', 'amber', 'rose', 'green', 'cyan', 'magenta'] as const
export type TodoGroupColor = (typeof TODO_GROUP_COLORS)[number]

export const TODO_TITLE_MAX_LENGTH = 500
export const TODO_GROUP_NAME_MAX_LENGTH = 60
export const TODO_TAG_MAX_LENGTH = 40
export const TODO_TAG_MAX_COUNT = 20
/** 一次查询的返回上限；Agent 工具与 UI 共用，避免整表塞进上下文。 */
export const TODO_LIST_LIMIT_MAX = 500
export const TODO_SNOOZE_MIN_MINUTES = 1
export const TODO_SNOOZE_MAX_MINUTES = 10080

/** Agent 成功操作过这条待办的会话痕迹，按会话去重。 */
export interface TodoSessionLink {
  sessionId: string
  firstTouchedAt: number
  lastTouchedAt: number
}

/** 已连接的系统提醒事项来源；canWrite=false 的只读列表禁止本地改写。 */
export interface TodoNativeOrigin {
  source: 'macos-reminders'
  listId: string
  listTitle: string
  externalId: string
  canWrite: boolean
  /** 最近一次与系统对齐的内容指纹，用于跳过无变化的推送 */
  syncedHash?: string
  /** 系统侧只设了日期没有时刻 */
  dueDateOnly?: boolean
}

export type TodoReminderStatus = 'pending' | 'acknowledged' | 'completed'

export interface TodoReminder {
  id: string
  triggerAt: number
  snoozedUntil?: number
  status: TodoReminderStatus
  /** due = 跟随计划完成时间自动建的那一条；manual = 用户/Agent 显式设定 */
  origin: 'manual' | 'due'
  lastNotifiedAt?: number
  acknowledgedAt?: number
}

export interface Todo {
  id: string
  title: string
  notes?: string
  status: TodoStatus
  priority: TodoPriority
  /** 计划完成时间，Unix ms */
  dueAt?: number
  groupId?: string
  tags: string[]
  reminders: TodoReminder[]
  sessionLinks: TodoSessionLink[]
  /** 关联工作区；为空表示与项目无关的日常事项 */
  projectRoot?: string
  /** 手动排序序号，仅 sortMode='manual' 时参与排序 */
  orderIndex: number
  createdAt: number
  updatedAt: number
  completedAt?: number
  nativeOrigin?: TodoNativeOrigin
}

export interface TodoGroup {
  id: string
  name: string
  /** 取自 UI 色板的 token 名，不是裸色值 */
  color: string
  orderIndex: number
  createdAt: number
}

export interface TodoListQuery {
  status?: TodoStatus
  groupId?: string
  /** 标题/备注/标签的子串匹配 */
  search?: string
  dueBefore?: number
  projectRoot?: string
  limit?: number
}

export interface CreateTodoInput {
  title: string
  notes?: string
  priority?: TodoPriority
  dueAt?: number
  groupId?: string
  tags?: string[]
  /** 提醒时刻列表；省略且带 dueAt 时自动建一条跟随计划时间的提醒 */
  reminders?: number[]
  sessionId?: string
  projectRoot?: string
}

export interface UpdateTodoInput {
  id: string
  title?: string
  notes?: string
  priority?: TodoPriority
  /** null = 清除计划时间 */
  dueAt?: number | null
  groupId?: string | null
  tags?: string[]
  projectRoot?: string | null
  status?: TodoStatus
  reminders?: number[]
  expectedUpdatedAt?: number
}

export type TodoMutationReason =
  | 'not-found'
  | 'conflict'
  | 'invalid-title'
  | 'read-only'
  | 'group-not-found'

export type TodoMutation =
  | { ok: true; todo: Todo }
  | { ok: false; reason: TodoMutationReason; todo?: Todo }

export type TodoRemoveResult =
  | { ok: true; removed: Todo }
  | { ok: false; reason: TodoMutationReason }

export type TodoGroupMutation =
  | { ok: true; group: TodoGroup }
  | { ok: false; reason: 'invalid-name' | 'duplicate-name' | 'not-found' }

/** 一次变更的增量投影；source 让渲染层区分「我自己改的」与「Agent/同步改的」。 */
export interface TodoChangePayload {
  todos?: Todo[]
  removedIds?: string[]
  groups?: TodoGroup[]
  removedGroupIds?: string[]
  source: 'user' | 'agent' | 'sync' | 'reminder'
}

export interface TodoAgentOperation {
  sessionId: string | null
  action: 'created' | 'updated' | 'completed' | 'reopened' | 'deleted'
  todoId: string
  title: string
}

/** 到点提醒推给渲染层的形态：带上待办标题，提醒卡不需要再查一次。 */
export interface ActiveTodoReminder {
  id: string
  todoId: string
  todoTitle: string
  priority: TodoPriority
  triggerAt: number
  snoozedUntil?: number
}

export interface RemindersListInfo {
  id: string
  title: string
  writable: boolean
}

export interface TodoSyncConfig {
  enabled: boolean
  listId: string | null
  lastSyncAt?: number
}

export type TodoSyncPermission = 'unknown' | 'granted' | 'denied' | 'unsupported'

export type TodoSyncErrorCode =
  | 'unsupported-platform'
  | 'permission-denied'
  | 'script-failed'
  | 'no-list-selected'
  | 'timeout'

export interface TodoSyncConflict {
  id: string
  todoId: string
  todoTitle: string
  nativeTitle: string
  kind: 'changed' | 'deleted'
  localUpdatedAt: number
  detectedAt: number
}

export interface TodoSyncState {
  /** darwin + osascript 可用 */
  supported: boolean
  permission: TodoSyncPermission
  config: TodoSyncConfig
  lists: RemindersListInfo[]
  conflicts: TodoSyncConflict[]
  syncing: boolean
  lastSyncAt?: number
  lastError?: TodoSyncErrorCode
}

export type TodoSyncActionResult =
  | { ok: true; state: TodoSyncState }
  | { ok: false; error: TodoSyncErrorCode; state: TodoSyncState }

export const todoNamespace = defineNamespace({
  channels: {
    list: {
      req: [] as unknown as [query?: TodoListQuery],
      res: null as unknown as Todo[],
    },
    get: {
      req: [] as unknown as [id: string],
      res: null as unknown as Todo | null,
    },
    create: {
      req: [] as unknown as [input: CreateTodoInput],
      res: null as unknown as TodoMutation,
    },
    update: {
      req: [] as unknown as [input: UpdateTodoInput],
      res: null as unknown as TodoMutation,
    },
    remove: {
      req: [] as unknown as [id: string],
      res: null as unknown as TodoRemoveResult,
    },
    /** 撤销删除：把完整快照原样放回（含 id、时间戳、会话关联）。 */
    restore: {
      req: [] as unknown as [todo: Todo],
      res: null as unknown as TodoMutation,
    },
    bulkStatus: {
      req: [] as unknown as [ids: string[], status: TodoStatus],
      res: null as unknown as Todo[],
    },
    bulkRemove: {
      req: [] as unknown as [ids: string[]],
      res: null as unknown as Todo[],
    },
    reorder: {
      req: [] as unknown as [ids: string[]],
      res: null as unknown as Todo[],
    },
    touchSession: {
      req: [] as unknown as [id: string, sessionId: string],
      res: null as unknown as Todo | null,
    },
    listGroups: {
      req: [] as unknown as [],
      res: null as unknown as TodoGroup[],
    },
    createGroup: {
      req: [] as unknown as [name: string, color?: string],
      res: null as unknown as TodoGroupMutation,
    },
    renameGroup: {
      req: [] as unknown as [id: string, name: string],
      res: null as unknown as TodoGroupMutation,
    },
    removeGroup: {
      req: [] as unknown as [id: string],
      res: null as unknown as { ok: boolean },
    },
    listActiveReminders: {
      req: [] as unknown as [],
      res: null as unknown as ActiveTodoReminder[],
    },
    acknowledgeReminder: {
      req: [] as unknown as [todoId: string, reminderId: string],
      res: null as unknown as { ok: boolean },
    },
    snoozeReminder: {
      req: [] as unknown as [todoId: string, reminderId: string, minutes: number],
      res: null as unknown as { ok: boolean },
    },
    getSyncState: {
      req: [] as unknown as [],
      res: null as unknown as TodoSyncState,
    },
    requestSyncAccess: {
      req: [] as unknown as [],
      res: null as unknown as TodoSyncActionResult,
    },
    setSyncConfig: {
      req: [] as unknown as [config: Partial<TodoSyncConfig>],
      res: null as unknown as TodoSyncActionResult,
    },
    syncNow: {
      req: [] as unknown as [],
      res: null as unknown as TodoSyncActionResult,
    },
    resolveSyncConflict: {
      req: [] as unknown as [conflictId: string, keep: 'local' | 'native'],
      res: null as unknown as TodoSyncActionResult,
    },
  },
  events: {
    onChanged: {
      channel: 'changed',
      args: [] as unknown as [payload: TodoChangePayload],
    },
    onAgentOperation: {
      channel: 'agent-operation',
      args: [] as unknown as [operation: TodoAgentOperation],
    },
    onReminderDue: {
      channel: 'reminder-due',
      args: [] as unknown as [reminders: ActiveTodoReminder[]],
    },
    onSyncStateChanged: {
      channel: 'sync-state',
      args: [] as unknown as [state: TodoSyncState],
    },
  },
})

export type TodoChannelMap = typeof todoNamespace.channels
export type TodoEventMap = typeof todoNamespace.events
export type TodoRendererApi = DeriveRendererApi<TodoChannelMap>
export type TodoEventApi = DeriveEventApi<TodoEventMap>