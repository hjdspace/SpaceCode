// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTodoStore, type TodoStore } from '../todoStore'
import { createTodoService, type TodoService } from '../todoService'
import type { TodoSyncController } from '../remindersSync'
import type { TodoSyncState } from '@/shared/channels/todo'
import { callTodoTool, parseTodoTime, toLocalIso, TODO_MCP_TOOLS, TODO_MCP_TOOL_NAMES } from '../todoMcpTools'
import type { McpToolResult } from '../todoMcpTools'

let dir: string
let store: TodoStore
let service: TodoService
let clock: number
let agentCalls: string[]

const SYNC_STATE: TodoSyncState = {
  supported: false,
  permission: 'unsupported',
  config: { enabled: false, listId: null },
  lists: [],
  conflicts: [],
  syncing: false,
}

function silentSync(): TodoSyncController {
  return {
    getState: () => SYNC_STATE,
    requestAccess: async () => ({ ok: true, state: SYNC_STATE }),
    setConfig: async () => ({ ok: true, state: SYNC_STATE }),
    syncNow: async () => ({ ok: true, state: SYNC_STATE }),
    resolveConflict: async () => ({ ok: true, state: SYNC_STATE }),
    noteLocalDeletions: () => {},
    noteLocalRestorations: () => {},
    subscribe: () => () => {},
    start: () => {},
    stop: () => {},
  }
}

const CONTEXT = { sessionId: 'session-abc', projectRoot: 'D:/work/demo' }

async function call(name: string, args: unknown = {}): Promise<McpToolResult> {
  agentCalls.push(name)
  return callTodoTool(name, args, service.forAgent(CONTEXT.sessionId), CONTEXT, clock)
}

function payload(result: McpToolResult): Record<string, any> {
  expect(result.isError).toBeFalsy()
  return JSON.parse(result.content[0].text)
}

function errorText(result: McpToolResult): string {
  expect(result.isError).toBe(true)
  return result.content[0].text
}

function make(title: string, extra: Record<string, unknown> = {}) {
  const created = store.create({ title, ...extra })
  if (!created.ok) throw new Error(created.reason)
  return created.todo
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'spacecode-todo-mcp-'))
  clock = new Date(2026, 10, 13, 9, 0, 0).getTime()
  agentCalls = []
  store = createTodoStore({ filePath: join(dir, 'todos.json'), now: () => clock })
  service = createTodoService({
    store,
    sync: silentSync(),
    send: () => {},
    notify: () => {},
  })
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('time parsing', () => {
  it('reads epoch milliseconds, ISO strings and now', () => {
    expect(parseTodoTime(clock, clock)).toBe(clock)
    expect(parseTodoTime(String(clock), clock)).toBe(clock)
    expect(parseTodoTime('now', clock)).toBe(clock)
    expect(parseTodoTime('2026-11-14T09:00:00+08:00', clock)).toBe(Date.parse('2026-11-14T09:00:00+08:00'))
  })

  it('reads local wall-clock times without a zone', () => {
    const expected = new Date(2026, 10, 14, 9, 30).getTime()
    expect(parseTodoTime('2026-11-14 09:30', clock)).toBe(expected)
    expect(parseTodoTime('2026-11-14T09:30', clock)).toBe(expected)
    expect(parseTodoTime('2026-11-14T09:30:15', clock)).toBe(expected + 15_000)
  })

  it('reads relative offsets', () => {
    expect(parseTodoTime('+30m', clock)).toBe(clock + 30 * 60_000)
    expect(parseTodoTime('+2h', clock)).toBe(clock + 2 * 3_600_000)
    expect(parseTodoTime('+1d', clock)).toBe(clock + 86_400_000)
    expect(parseTodoTime('+1w', clock)).toBe(clock + 604_800_000)
  })

  it('rejects nonsense instead of guessing', () => {
    for (const value of ['', '   ', 'tomorrow', '+', '+m', '2026-13-45T99:00', null, undefined, {}, NaN]) {
      expect(parseTodoTime(value, clock)).toBeNull()
    }
  })

  it('renders local ISO with the machine offset, not Z', () => {
    const iso = toLocalIso(new Date(2026, 10, 13, 9, 5, 7).getTime())
    expect(iso.startsWith('2026-11-13T09:05:07')).toBe(true)
    expect(iso).toMatch(/[+-]\d{2}:\d{2}$/)
    expect(Date.parse(iso)).toBe(new Date(2026, 10, 13, 9, 5, 7).getTime())
  })
})

describe('tool definitions', () => {
  it('exposes unique names with object schemas', () => {
    expect(new Set(TODO_MCP_TOOL_NAMES).size).toBe(TODO_MCP_TOOLS.length)
    for (const tool of TODO_MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.description.length).toBeGreaterThan(20)
      const required = (tool.inputSchema.required ?? []) as string[]
      const properties = Object.keys(tool.inputSchema.properties as Record<string, unknown>)
      for (const key of required) expect(properties).toContain(key)
    }
  })

  it('reports an unknown tool with the available list', async () => {
    expect(errorText(await call('drop_table'))).toContain('list_todos')
  })
})

describe('create and read', () => {
  it('creates a todo scoped to the session workspace and links the session', async () => {
    const created = payload(await call('create_todo', {
      title: '把导出按钮接上后端',
      notes: '前端已完成，缺 /api/export 的联调',
      priority: 'high',
      dueAt: '+2h',
      tags: ['frontend', 'frontend', 'api'],
    }))
    expect(created.title).toBe('把导出按钮接上后端')
    expect(created.priority).toBe('high')
    expect(created.projectRoot).toBe(CONTEXT.projectRoot)
    expect(created.sessionIds).toEqual(['session-abc'])
    expect(Date.parse(created.dueAt)).toBe(clock + 2 * 3_600_000)
    expect(created.tags).toEqual(['frontend', 'api'])
    // 计划时间自动带一条跟随它的提醒
    expect(created.reminders).toHaveLength(1)
    expect(created.reminders[0].followsDueDate).toBe(true)
    expect(store.get(created.id)!.reminders[0].triggerAt).toBe(clock + 2 * 3_600_000)
  })

  it('accepts explicit reminder times', async () => {
    const created = payload(await call('create_todo', {
      title: '站会',
      reminders: ['+15m', '2026-11-13 10:00'],
    }))
    expect(created.reminders).toHaveLength(2)
    expect(Date.parse(created.reminders[0].at)).toBe(clock + 15 * 60_000)
  })

  it('rejects an unreadable time without writing anything', async () => {
    expect(errorText(await call('create_todo', { title: 'x', dueAt: 'next tuesday' }))).toContain('next tuesday')
    expect(store.list()).toHaveLength(0)
    expect(errorText(await call('create_todo', { title: 'x', reminders: ['+1h', 'nope'] }))).toContain('nope')
    expect(store.list()).toHaveLength(0)
  })

  it('rejects an empty title', async () => {
    expect(errorText(await call('create_todo', { title: '   ' }))).toContain('Title must be')
    expect(errorText(await call('create_todo', {}))).toContain('Title must be')
  })

  it('reads a todo back in full and records the read as a session link', async () => {
    const todo = make('半截的活', { notes: '进度：一半', priority: 'low' })
    const read = payload(await call('get_todo', { id: todo.id }))
    expect(read.notes).toBe('进度：一半')
    expect(read.priority).toBe('low')
    expect(read.status).toBe('open')
    expect(read.sessionIds).toEqual(['session-abc'])
  })

  it('explains a missing id', async () => {
    expect(errorText(await call('get_todo', { id: 'ghost' }))).toContain('list_todos')
    expect(errorText(await call('get_todo', {}))).toContain('id is required')
  })
})

describe('list and search', () => {
  beforeEach(() => {
    make('写周报', { tags: ['work'], dueAt: clock + 3_600_000 })
    make('买牛奶', { notes: '低脂' })
    const done = make('交房租')
    store.update({ id: done.id, status: 'completed' })
  })

  it('lists everything with a count', async () => {
    const listed = payload(await call('list_todos'))
    expect(listed.count).toBe(3)
    expect(listed.todos[0].status).toBe('open')
  })

  it('filters by status, search and due time', async () => {
    expect(payload(await call('list_todos', { status: 'completed' })).todos.map((t: any) => t.title)).toEqual(['交房租'])
    expect(payload(await call('list_todos', { search: '低脂' })).todos.map((t: any) => t.title)).toEqual(['买牛奶'])
    expect(payload(await call('list_todos', { dueBefore: '+2h' })).todos.map((t: any) => t.title)).toEqual(['写周报'])
    expect(payload(await call('list_todos', { limit: 1 })).count).toBe(1)
  })

  it('rejects a bad dueBefore', async () => {
    expect(errorText(await call('list_todos', { dueBefore: 'whenever' }))).toContain('whenever')
  })

  it('filters by workspace', async () => {
    store.update({ id: store.list()[0].id, projectRoot: 'D:/other' })
    expect(payload(await call('list_todos', { projectRoot: 'D:/other' })).count).toBe(1)
  })
})

describe('lifecycle and progress', () => {
  it('appends progress by replacing notes and keeps the todo open', async () => {
    const todo = make('重构鉴权', { notes: '第一步完成' })
    const updated = payload(await call('update_todo', { id: todo.id, notes: '第一步完成；第二步待办' }))
    expect(updated.notes).toBe('第一步完成；第二步待办')
    expect(updated.status).toBe('open')
  })

  it('completes and reopens', async () => {
    const todo = make('修 bug', { dueAt: clock + 3_600_000 })
    const completed = payload(await call('complete_todo', { id: todo.id }))
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).toBeTruthy()
    expect(store.get(todo.id)!.reminders[0].status).toBe('completed')

    const reopened = payload(await call('reopen_todo', { id: todo.id }))
    expect(reopened.status).toBe('open')
    expect(reopened.completedAt).toBeUndefined()
    expect(store.get(todo.id)!.reminders[0].status).toBe('pending')
  })

  it('deletes only when asked, and reports what went away', async () => {
    const todo = make('过期的事')
    expect(payload(await call('delete_todo', { id: todo.id }))).toEqual({ deleted: true, id: todo.id, title: '过期的事' })
    expect(store.get(todo.id)).toBeNull()
    expect(errorText(await call('delete_todo', { id: todo.id }))).toContain('list_todos')
  })

  it('clears the due time with an empty string', async () => {
    const todo = make('改时间', { dueAt: clock + 3_600_000 })
    const updated = payload(await call('update_todo', { id: todo.id, dueAt: '' }))
    expect(updated.dueAt).toBeUndefined()
    expect(updated.reminders).toBeUndefined()
  })

  it('reschedules and moves the reminder that follows the due time', async () => {
    const todo = make('改时间', { dueAt: clock + 3_600_000 })
    const updated = payload(await call('update_todo', { id: todo.id, dueAt: '+1d' }))
    expect(Date.parse(updated.dueAt)).toBe(clock + 86_400_000)
    expect(Date.parse(updated.reminders[0].at)).toBe(clock + 86_400_000)
  })

  it('replaces reminders through set_reminders and clears them with an empty list', async () => {
    const todo = make('喝水')
    const armed = payload(await call('set_reminders', { id: todo.id, at: ['+10m', '+20m'] }))
    expect(armed.reminders).toHaveLength(2)
    const cleared = payload(await call('set_reminders', { id: todo.id, at: [] }))
    expect(cleared.reminders).toBeUndefined()
    expect(errorText(await call('set_reminders', { id: todo.id }))).toContain('at is required')
  })
})

describe('groups', () => {
  it('creates a group, lists it and files a todo under it', async () => {
    const group = payload(await call('create_group', { name: '工作', color: 'teal' }))
    expect(group.color).toBe('teal')
    expect(payload(await call('list_groups')).groups).toEqual([{ id: group.id, name: '工作', color: 'teal' }])

    const todo = payload(await call('create_todo', { title: '写方案', groupId: group.id }))
    expect(todo.group).toEqual({ id: group.id, name: '工作' })

    const moved = payload(await call('update_todo', { id: todo.id, groupId: '' }))
    expect(moved.group).toBeUndefined()
  })

  it('explains duplicates and unknown group ids', async () => {
    payload(await call('create_group', { name: '工作' }))
    expect(errorText(await call('create_group', { name: '工作' }))).toContain('already exists')
    expect(errorText(await call('create_todo', { title: 'x', groupId: 'ghost' }))).toContain('list_groups')
    expect(errorText(await call('create_group', { name: '' }))).toContain('name is required')
  })
})

describe('read-only synced todos', () => {
  it('surfaces the read-only flag and refuses edits with a usable explanation', async () => {
    const todo = make('系统提醒事项里的条目')
    store.applySyncPatch({
      upserts: [{
        ...todo,
        nativeOrigin: {
          source: 'macos-reminders',
          listId: 'L1',
          listTitle: 'Reminders',
          externalId: 'x1',
          canWrite: false,
        },
      }],
      removedIds: [],
    })
    const read = payload(await call('get_todo', { id: todo.id }))
    expect(read.readOnly).toBe(true)
    expect(read.syncedWith).toEqual({ source: 'macOS Reminders', list: 'Reminders' })
    expect(errorText(await call('update_todo', { id: todo.id, notes: 'x' }))).toContain('read-only')
  })
})

describe('agent provenance', () => {
  it('routes every write through the agent surface so the UI is notified', async () => {
    const sent: Array<{ channel: string; args: unknown[] }> = []
    const watched = createTodoService({
      store,
      sync: silentSync(),
      send: (channel, ...args) => sent.push({ channel, args }),
      notify: () => {},
    })
    const result = await callTodoTool(
      'create_todo',
      { title: 'Agent 建的' },
      watched.forAgent('s9'),
      { sessionId: 's9', projectRoot: null },
      clock,
    )
    payload(result)
    const change = sent.find(entry => entry.channel === 'todo:changed')
    expect((change?.args[0] as { source: string }).source).toBe('agent')
    const operation = sent.find(entry => entry.channel === 'todo:agent-operation')
    expect(operation?.args[0]).toMatchObject({ sessionId: 's9', action: 'created', title: 'Agent 建的' })
  })

  it('works without a session or workspace', async () => {
    const created = await callTodoTool(
      'create_todo',
      { title: '无会话' },
      service.forAgent(null),
      { sessionId: null, projectRoot: null },
      clock,
    )
    const todo = payload(created)
    expect(todo.sessionIds).toBeUndefined()
    expect(todo.projectRoot).toBeUndefined()
  })

  it('ignores malformed arguments instead of throwing', async () => {
    for (const args of [null, undefined, 42, 'text', []]) {
      expect(payload(await callTodoTool('list_todos', args, service.forAgent(null), CONTEXT, clock)).count).toBe(0)
      expect(errorText(await callTodoTool('get_todo', args, service.forAgent(null), CONTEXT, clock))).toContain('id is required')
    }
  })
})