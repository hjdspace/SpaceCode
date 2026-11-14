/**
 * Agent 的待办工具面 — 工具定义（JSON Schema）与调用分发。
 *
 * 这一层不碰 Electron、不碰文件系统：写入全部委托给 TodoAgentApi，
 * 所以「Agent 建的待办」和「用户在面板里建的待办」走的是同一个 store，
 * 广播、提醒调度、macOS 同步都自动跟上。
 *
 * 时间口径：读出去一律是带本地时区偏移的 ISO 字符串（模型读得懂 epoch 的能力很差），
 * 写进来接受 ISO / epoch 毫秒 / `+30m` 这类相对量，以及 `now`。
 */
import {
  TODO_GROUP_NAME_MAX_LENGTH,
  TODO_LIST_LIMIT_MAX,
  TODO_TAG_MAX_COUNT,
  TODO_TITLE_MAX_LENGTH,
} from '@/shared/channels/todo'
import type {
  CreateTodoInput,
  Todo,
  TodoGroup,
  TodoListQuery,
  TodoMutationReason,
  TodoPriority,
  UpdateTodoInput,
} from '@/shared/channels/todo'
import type { TodoAgentApi } from './todoService'

/** MCP tools/call 的返回形态（只用到 text content，宿主两个引擎都认这一种）。 */
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** 一次调用的上下文：会话用于留痕，工作区用于给新建待办归位。 */
export interface TodoToolContext {
  sessionId: string | null
  projectRoot: string | null
}

const TIME_DESCRIPTION =
  'Time as ISO 8601 (e.g. "2026-11-14T09:00:00+08:00" or "2026-11-14 09:00"), epoch milliseconds, "now", or a relative offset like "+30m", "+2h", "+1d", "+1w".'

const RELATIVE_PATTERN = /^\+(\d+)(m|h|d|w)$/
const UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
}

/** 解析不了返回 null —— 调用方要能区分「没给」和「给错了」。 */
export function parseTodoTime(value: unknown, now: number): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (text.toLowerCase() === 'now') return now
  const relative = RELATIVE_PATTERN.exec(text.toLowerCase())
  if (relative) {
    const amount = Number(relative[1])
    if (!Number.isFinite(amount)) return null
    return now + amount * UNIT_MS[relative[2]]
  }
  if (/^\d{10,}$/.test(text)) return Number(text)
  // 不带时区的写法按本地时间解释：用户和模型说「明天九点」指的都是本机九点。
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)
    ? text.replace(' ', 'T')
    : text
  const parsed = Date.parse(normalized)
  return Number.isNaN(parsed) ? null : parsed
}

function pad(value: number, width = 2): string {
  return String(Math.abs(value)).padStart(width, '0')
}

/** 带本地偏移的 ISO —— toISOString() 会给 Z，模型据此推算本地时间时经常算错。 */
export function toLocalIso(ms: number): string {
  const date = new Date(ms)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes < 0 ? '-' : '+'
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offset}`
  )
}

function serializeTodo(todo: Todo, groups: TodoGroup[]): Record<string, unknown> {
  const group = todo.groupId ? groups.find(g => g.id === todo.groupId) : undefined
  const out: Record<string, unknown> = {
    id: todo.id,
    title: todo.title,
    status: todo.status,
    priority: todo.priority,
    tags: todo.tags,
    createdAt: toLocalIso(todo.createdAt),
    updatedAt: toLocalIso(todo.updatedAt),
  }
  if (todo.notes) out.notes = todo.notes
  if (todo.dueAt !== undefined) out.dueAt = toLocalIso(todo.dueAt)
  if (todo.completedAt !== undefined) out.completedAt = toLocalIso(todo.completedAt)
  if (group) out.group = { id: group.id, name: group.name }
  if (todo.projectRoot) out.projectRoot = todo.projectRoot
  if (todo.reminders.length > 0) {
    out.reminders = todo.reminders.map(reminder => ({
      id: reminder.id,
      at: toLocalIso(reminder.snoozedUntil ?? reminder.triggerAt),
      status: reminder.status,
      followsDueDate: reminder.origin === 'due',
    }))
  }
  if (todo.sessionLinks.length > 0) {
    out.sessionIds = todo.sessionLinks.map(link => link.sessionId)
  }
  if (todo.nativeOrigin) {
    out.syncedWith = { source: 'macOS Reminders', list: todo.nativeOrigin.listTitle }
    // 只读来源改不动，模型必须知道失败不是自己参数写错了。
    if (!todo.nativeOrigin.canWrite) out.readOnly = true
  }
  return out
}

function text(payload: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

function fail(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

const REASON_MESSAGE: Record<TodoMutationReason, string> = {
  'not-found': 'No todo with that id. Call list_todos to find the current id.',
  conflict: 'The todo changed since you read it. Call get_todo again and retry with the fresh content.',
  'invalid-title': `Title must be a non-empty string of at most ${TODO_TITLE_MAX_LENGTH} characters.`,
  'read-only': 'This todo comes from a read-only macOS Reminders list, so it cannot be edited here. Ask the user to change it in Reminders.',
  'group-not-found': 'No group with that id. Call list_groups, or create_group first.',
}

function mutationFailure(reason: TodoMutationReason): McpToolResult {
  return fail(REASON_MESSAGE[reason])
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function asPriority(value: unknown): TodoPriority | undefined {
  return value === 'low' || value === 'medium' || value === 'high' ? value : undefined
}

function asTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.filter((tag): tag is string => typeof tag === 'string').slice(0, TODO_TAG_MAX_COUNT)
}

function requireId(args: Record<string, unknown>): string | null {
  const id = asString(args.id)?.trim()
  return id ? id : null
}

const OBJECT_SCHEMA = { type: 'object', additionalProperties: false } as const

export const TODO_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_todos',
    description:
      'List the user\'s todos, unfinished first, then by due time. Use this to find a todo id before reading or editing it, and to check what is already tracked before creating duplicates.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: {
        status: { type: 'string', enum: ['open', 'completed'], description: 'Filter by status. Omit for both.' },
        groupId: { type: 'string', description: 'Only todos in this group.' },
        search: { type: 'string', description: 'Case-insensitive substring match on title, notes and tags.' },
        dueBefore: { type: 'string', description: `Only todos due at or before this time. ${TIME_DESCRIPTION}` },
        projectRoot: { type: 'string', description: 'Only todos belonging to this workspace path.' },
        limit: { type: 'integer', minimum: 1, maximum: TODO_LIST_LIMIT_MAX, description: `Defaults to ${TODO_LIST_LIMIT_MAX}.` },
      },
    },
  },
  {
    name: 'get_todo',
    description:
      'Read one todo in full: notes, due time, reminders, tags and the chat sessions that touched it. Always call this for every todo the user referenced in their message before continuing that work — the notes hold the progress recorded so far.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: { id: { type: 'string', description: 'Todo id.' } },
      required: ['id'],
    },
  },
  {
    name: 'create_todo',
    description:
      'Create a todo. Use this when the user wants to park half-finished work, or asks to be reminded of something. Put concrete resume instructions in notes (what is done, what is left, which files matter) so a later session can pick it up without re-deriving it. Setting dueAt automatically creates a reminder at that time.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: {
        title: { type: 'string', maxLength: TODO_TITLE_MAX_LENGTH, description: 'Short imperative summary.' },
        notes: { type: 'string', description: 'Progress so far and the exact next step.' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Defaults to medium.' },
        dueAt: { type: 'string', description: `Planned completion time. ${TIME_DESCRIPTION}` },
        reminders: { type: 'array', items: { type: 'string' }, description: `Extra reminder times. ${TIME_DESCRIPTION}` },
        groupId: { type: 'string', description: 'Group id from list_groups.' },
        tags: { type: 'array', items: { type: 'string' }, description: `At most ${TODO_TAG_MAX_COUNT} short labels.` },
        projectRoot: { type: 'string', description: 'Workspace this todo belongs to. Defaults to the current workspace.' },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_todo',
    description:
      'Update a todo. Only the fields you pass change. Use this to append progress to notes as work proceeds, to reschedule, or to re-prioritise. Passing dueAt as an empty string clears it.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: {
        id: { type: 'string' },
        title: { type: 'string', maxLength: TODO_TITLE_MAX_LENGTH },
        notes: { type: 'string', description: 'Replaces the notes. Read the todo first so earlier progress is not lost.' },
        priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        dueAt: { type: 'string', description: `New planned time, or "" to clear. ${TIME_DESCRIPTION}` },
        groupId: { type: 'string', description: 'Group id, or "" to ungroup.' },
        tags: { type: 'array', items: { type: 'string' } },
        reminders: { type: 'array', items: { type: 'string' }, description: 'Replaces the reminder list.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'complete_todo',
    description:
      'Mark a todo finished and stop its reminders. Call this as soon as the work it describes is actually done, without waiting to be asked.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'reopen_todo',
    description: 'Reopen a completed todo. Reminders already in the past stay silent; future ones arm again.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'delete_todo',
    description:
      'Delete a todo permanently. Only do this when the user explicitly asks to delete it; to finish work use complete_todo instead.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
  },
  {
    name: 'set_reminders',
    description:
      `Replace a todo's reminder times. Each one raises a desktop notification when it comes due. ${TIME_DESCRIPTION}`,
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: {
        id: { type: 'string' },
        at: { type: 'array', items: { type: 'string' }, description: 'Reminder times; an empty array removes them all.' },
      },
      required: ['id', 'at'],
    },
  },
  {
    name: 'list_groups',
    description: 'List todo groups with their ids, names and colours.',
    inputSchema: { ...OBJECT_SCHEMA, properties: {} },
  },
  {
    name: 'create_group',
    description: 'Create a todo group (e.g. "Work", "Errands). Names are unique.',
    inputSchema: {
      ...OBJECT_SCHEMA,
      properties: {
        name: { type: 'string', maxLength: TODO_GROUP_NAME_MAX_LENGTH },
        color: {
          type: 'string',
          enum: ['teal', 'blue', 'violet', 'amber', 'rose', 'green', 'cyan', 'magenta'],
          description: 'Palette token; picked automatically when omitted.',
        },
      },
      required: ['name'],
    },
  },
]

export const TODO_MCP_TOOL_NAMES = TODO_MCP_TOOLS.map(tool => tool.name)

function parseTimes(values: unknown[], now: number): { times: number[] } | { invalid: string } {
  const times: number[] = []
  for (const value of values) {
    const parsed = parseTodoTime(value, now)
    if (parsed === null) return { invalid: String(value) }
    times.push(parsed)
  }
  return { times }
}

const INVALID_TIME = (value: string): McpToolResult =>
  fail(`Could not read the time "${value}". ${TIME_DESCRIPTION}`)

/**
 * 分发一次 tools/call。任何失败都回 isError + 可读原因，让模型自己纠正参数，
 * 而不是抛 JSON-RPC 错误 —— 后者在两个引擎里都会变成一句无信息量的「工具调用失败」。
 */
export async function callTodoTool(
  name: string,
  rawArgs: unknown,
  api: TodoAgentApi,
  context: TodoToolContext,
  now: number = Date.now(),
): Promise<McpToolResult> {
  const args: Record<string, unknown> =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {}
  const groups = async (): Promise<TodoGroup[]> => await api.listGroups()

  switch (name) {
    case 'list_todos': {
      const query: TodoListQuery = {}
      if (args.status === 'open' || args.status === 'completed') query.status = args.status
      const groupId = asString(args.groupId)
      if (groupId) query.groupId = groupId
      const search = asString(args.search)
      if (search) query.search = search
      const projectRoot = asString(args.projectRoot)
      if (projectRoot) query.projectRoot = projectRoot
      if (args.dueBefore !== undefined && args.dueBefore !== '') {
        const dueBefore = parseTodoTime(args.dueBefore, now)
        if (dueBefore === null) return INVALID_TIME(String(args.dueBefore))
        query.dueBefore = dueBefore
      }
      if (typeof args.limit === 'number' && Number.isFinite(args.limit)) query.limit = Math.round(args.limit)
      const todos = await api.list(query)
      const allGroups = await groups()
      return text({ count: todos.length, todos: todos.map(todo => serializeTodo(todo, allGroups)) })
    }

    case 'get_todo': {
      const id = requireId(args)
      if (!id) return fail('id is required.')
      const todo = await api.get(id)
      if (!todo) return mutationFailure('not-found')
      return text(serializeTodo(todo, await groups()))
    }

    case 'create_todo': {
      const title = asString(args.title)?.trim()
      if (!title) return mutationFailure('invalid-title')
      const input: CreateTodoInput = { title }
      const notes = asString(args.notes)
      if (notes) input.notes = notes
      const priority = asPriority(args.priority)
      if (priority) input.priority = priority
      const groupId = asString(args.groupId)
      if (groupId) input.groupId = groupId
      const tags = asTags(args.tags)
      if (tags) input.tags = tags
      if (args.dueAt !== undefined && args.dueAt !== '') {
        const dueAt = parseTodoTime(args.dueAt, now)
        if (dueAt === null) return INVALID_TIME(String(args.dueAt))
        input.dueAt = dueAt
      }
      if (Array.isArray(args.reminders)) {
        const parsed = parseTimes(args.reminders, now)
        if ('invalid' in parsed) return INVALID_TIME(parsed.invalid)
        input.reminders = parsed.times
      }
      const projectRoot = asString(args.projectRoot) ?? context.projectRoot
      if (projectRoot) input.projectRoot = projectRoot
      const result = await api.create(input)
      if (!result.ok) return mutationFailure(result.reason)
      return text(serializeTodo(result.todo, await groups()))
    }

    case 'update_todo':
    case 'complete_todo':
    case 'reopen_todo':
    case 'set_reminders': {
      const id = requireId(args)
      if (!id) return fail('id is required.')
      const input: UpdateTodoInput = { id }
      if (name === 'complete_todo') input.status = 'completed'
      if (name === 'reopen_todo') input.status = 'open'
      if (name === 'update_todo') {
        if (args.title !== undefined) input.title = asString(args.title) ?? ''
        if (args.notes !== undefined) input.notes = asString(args.notes) ?? ''
        const priority = asPriority(args.priority)
        if (priority) input.priority = priority
        if (args.groupId !== undefined) input.groupId = asString(args.groupId) ?? ''
        const tags = asTags(args.tags)
        if (tags) input.tags = tags
        if (args.dueAt !== undefined) {
          if (args.dueAt === '' || args.dueAt === null) input.dueAt = null
          else {
            const dueAt = parseTodoTime(args.dueAt, now)
            if (dueAt === null) return INVALID_TIME(String(args.dueAt))
            input.dueAt = dueAt
          }
        }
      }
      const reminderValues = name === 'set_reminders' ? args.at : args.reminders
      if (name === 'set_reminders' && !Array.isArray(reminderValues)) {
        return fail('at is required and must be an array of times.')
      }
      if (Array.isArray(reminderValues)) {
        const parsed = parseTimes(reminderValues, now)
        if ('invalid' in parsed) return INVALID_TIME(parsed.invalid)
        input.reminders = parsed.times
      }
      const result = await api.update(input)
      if (!result.ok) return mutationFailure(result.reason)
      return text(serializeTodo(result.todo, await groups()))
    }

    case 'delete_todo': {
      const id = requireId(args)
      if (!id) return fail('id is required.')
      const result = await api.remove(id)
      if (!result.ok) return mutationFailure(result.reason)
      return text({ deleted: true, id: result.removed.id, title: result.removed.title })
    }

    case 'list_groups':
      return text({ groups: (await groups()).map(group => ({ id: group.id, name: group.name, color: group.color })) })

    case 'create_group': {
      const groupName = asString(args.name)?.trim()
      if (!groupName) return fail(`name is required and must be at most ${TODO_GROUP_NAME_MAX_LENGTH} characters.`)
      const result = await api.createGroup(groupName, asString(args.color))
      if (!result.ok) {
        return fail(
          result.reason === 'duplicate-name'
            ? `A group named "${groupName}" already exists. Call list_groups to reuse its id.`
            : `Invalid group name. Use 1..${TODO_GROUP_NAME_MAX_LENGTH} characters.`,
        )
      }
      return text({ id: result.group.id, name: result.group.name, color: result.group.color })
    }

    default:
      return fail(`Unknown tool "${name}". Available tools: ${TODO_MCP_TOOL_NAMES.join(', ')}.`)
  }
}