/**
 * TodoList 的列表面：排序渲染、全选与批量条、拖拽落位、行菜单动作。
 *
 * 只替掉 IPC（api.todo）——store、TodoRow、TodoEmptyState、useDialog、useTodoActions
 * 全走真实实现，交互一律从真实 DOM 事件进入。主进程替身自己存一份快照，
 * 这样「乐观更新被服务端确认」与「乐观更新被回滚」是两条真的能分辨的路径。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, nextTick } from 'vue'
import TodoList from '@/components/todo/TodoList.vue'
import { useAppStore } from '@/stores/app'
import { useTodoStore } from '@/stores/todo'
import { useTodoActions } from '@/composables/useTodoActions'
import { useDialog } from '@/composables/useDialog'
import { buildTodoAgentPrompt } from '@/shared/todoReference'
import type { Todo, TodoGroup, TodoMutation, TodoStatus, UpdateTodoInput } from '@/shared/channels/todo'
import zhCN from '@/i18n/locales/zh-CN'

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

/**
 * useAppStore 的依赖链会实例化 settings store，它在 setup 里就读配置。
 * 给这几个根级方法一个空实现，免得冒出被测范围之外的 unhandled rejection。
 */
const rootApi = vi.hoisted(() => ({
  loadGuiSettings: vi.fn(async () => ({ success: false })),
  saveGuiSettings: vi.fn(async () => ({ success: true })),
  getEnv: vi.fn(async () => null),
  terminal: { onExit: vi.fn(() => () => {}) },
}))

vi.mock('@/services/electronAPI', () => ({ api: { ...rootApi, todo: todoApi } }))

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })
const t = i18n.global.t

/** 本地时间 10:00：今天/即将到来/逾期三个桶都以此为锚。只假 Date，定时器与 rAF 保持真实。 */
const NOW = new Date(2026, 10, 14, 10, 0, 0, 0).getTime()
const HOUR = 3600_000
const DAY = 24 * HOUR

function makeTodo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    title: `待办 ${overrides.id}`,
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

/** 主进程替身的独立快照：store 的乐观更新不会污染它。 */
const backend = new Map<string, Todo>()

/** 落盘语义：patch 里 undefined 表示不动，null 表示清除。 */
function persisted(todo: Todo, input: UpdateTodoInput): Todo {
  const next: Todo = { ...todo, updatedAt: todo.updatedAt + 1 }
  if (input.title !== undefined) next.title = input.title
  if (input.notes !== undefined) next.notes = input.notes
  if (input.status !== undefined) next.status = input.status
  if (input.priority !== undefined) next.priority = input.priority
  if (input.tags !== undefined) next.tags = input.tags
  if (input.dueAt !== undefined) next.dueAt = input.dueAt ?? undefined
  if (input.groupId !== undefined) next.groupId = input.groupId ?? undefined
  return next
}

let appStore: ReturnType<typeof useAppStore>
let todoStore: ReturnType<typeof useTodoStore>
const dialog = useDialog()

/** useTodoActions 的 notice 在模块作用域，useI18n 只能在 setup 里调用，用探针组件读它。 */
const NoticeProbe = defineComponent({
  setup() {
    const { notice, dismissNotice } = useTodoActions()
    return { notice, dismissNotice }
  },
  render: () => null,
})

let notice: ReturnType<typeof mountProbe>['vm']

function mountProbe() {
  return mount(NoticeProbe, { global: { plugins: [i18n] } })
}

function seed(todos: Todo[], groups: TodoGroup[] = []): void {
  backend.clear()
  for (const todo of todos) backend.set(todo.id, { ...todo })
  todoStore.todos = todos.map(todo => ({ ...todo }))
  todoStore.groups = groups
}

function mountList() {
  return mount(TodoList, { global: { plugins: [i18n] }, attachTo: document.body })
}

type ListWrapper = ReturnType<typeof mountList>

function rowOf(wrapper: ListWrapper, id: string): DOMWrapper<Element> {
  return wrapper.find(`.todo-row[data-todo-id="${id}"]`)
}

function renderedIds(wrapper: ListWrapper): string[] {
  return wrapper.findAll('.todo-row').map(row => row.attributes('data-todo-id') as string)
}

function bulkButton(wrapper: ListWrapper, label: string): DOMWrapper<Element> {
  const found = wrapper.findAll('.bulk-btn').find(btn => btn.text() === label)
  if (!found) throw new Error(`bulk button not found: ${label}`)
  return found
}

async function selectRow(wrapper: ListWrapper, id: string): Promise<void> {
  await rowOf(wrapper, id).find('.row-select input').trigger('change')
}

async function openRowMenu(wrapper: ListWrapper, id: string): Promise<void> {
  await rowOf(wrapper, id).find('.row-menu-btn').trigger('click')
  await nextTick()
}

/** 行菜单 teleport 到 body，只能从 document 里捞。 */
function rowMenuItem(label: string): DOMWrapper<Element> {
  const found = [...document.querySelectorAll('.row-menu .menu-item')].find(
    item => item.textContent?.trim() === label,
  )
  if (!found) throw new Error(`row menu item not found: ${label}`)
  return new DOMWrapper(found)
}

async function runRowAction(wrapper: ListWrapper, id: string, label: string): Promise<void> {
  await openRowMenu(wrapper, id)
  await rowMenuItem(label).trigger('click')
  await flushPromises()
}

/** 确认弹窗由 DialogProvider 渲染，这里直接读 useDialog 的单例状态并作出选择。 */
async function answerConfirm(message: string, accept: boolean): Promise<void> {
  await nextTick()
  expect(dialog.confirmDialogState.value.visible).toBe(true)
  expect(dialog.confirmDialogState.value.message).toBe(message)
  expect(dialog.confirmDialogState.value.variant).toBe('danger')
  dialog.closeConfirm(accept)
  await flushPromises()
}

interface FakeDataTransfer {
  setData: ReturnType<typeof vi.fn>
  effectAllowed: string
}

async function startDrag(wrapper: ListWrapper, id: string): Promise<FakeDataTransfer> {
  const row = rowOf(wrapper, id)
  await row.find('.row-grip').trigger('mousedown')
  const dataTransfer: FakeDataTransfer = { setData: vi.fn(), effectAllowed: '' }
  await row.trigger('dragstart', { dataTransfer })
  return dataTransfer
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  setActivePinia(createPinia())
  appStore = useAppStore()
  todoStore = useTodoStore()
  notice = mountProbe().vm
  notice.dismissNotice()

  todoApi.update.mockImplementation(async (input: UpdateTodoInput): Promise<TodoMutation> => {
    const current = backend.get(input.id)
    if (!current) return { ok: false, reason: 'not-found' }
    const next = persisted(current, input)
    backend.set(next.id, next)
    return { ok: true, todo: next }
  })
  todoApi.bulkStatus.mockImplementation(async (ids: string[], status: TodoStatus): Promise<Todo[]> => {
    const out: Todo[] = []
    for (const id of ids) {
      const current = backend.get(id)
      if (!current) continue
      const next: Todo = { ...current, status, updatedAt: current.updatedAt + 1 }
      backend.set(id, next)
      out.push(next)
    }
    return out
  })
  todoApi.bulkRemove.mockImplementation(async (ids: string[]): Promise<Todo[]> => {
    const out: Todo[] = []
    for (const id of ids) {
      const current = backend.get(id)
      if (!current) continue
      backend.delete(id)
      out.push(current)
    }
    return out
  })
  todoApi.remove.mockImplementation(async (id: string) => {
    const current = backend.get(id)
    if (!current) return { ok: false, reason: 'not-found' }
    backend.delete(id)
    return { ok: true, removed: current }
  })
  todoApi.restore.mockImplementation(async (todo: Todo) => {
    backend.set(todo.id, todo)
    return { ok: true, todo }
  })
  todoApi.reorder.mockImplementation(async (ids: string[]): Promise<Todo[]> => {
    const out: Todo[] = []
    ids.forEach((id, index) => {
      const current = backend.get(id)
      if (!current) return
      const next: Todo = { ...current, orderIndex: index }
      backend.set(id, next)
      out.push(next)
    })
    return out
  })
})

afterEach(() => {
  notice.dismissNotice()
  todoStore.dismissUndo()
  if (dialog.confirmDialogState.value.visible) dialog.closeConfirm(false)
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('TodoList · 列表渲染', () => {
  it('按 sortedTodos 的顺序渲染：计划时间升序、无时间垫底，已完成不进全部视图', async () => {
    seed([
      makeTodo({ id: 'done', status: 'completed', dueAt: NOW - 5 * DAY }),
      makeTodo({ id: 'no-due' }),
      makeTodo({ id: 'later', dueAt: NOW + 2 * DAY }),
      makeTodo({ id: 'soon', dueAt: NOW + HOUR }),
    ])
    const wrapper = mountList()

    expect(renderedIds(wrapper)).toEqual(['soon', 'later', 'no-due'])
    expect(wrapper.findAll('.todo-row .row-title').map(node => node.text())).toEqual([
      '待办 soon',
      '待办 later',
      '待办 no-due',
    ])

    todoStore.setView('completed')
    await nextTick()

    expect(renderedIds(wrapper)).toEqual(['done'])
    expect(wrapper.find('.todo-row').classes()).toContain('is-completed')
  })

  it('同一计划时间里高优先级排在前面', () => {
    seed([
      makeTodo({ id: 'low', priority: 'low', dueAt: NOW + HOUR }),
      makeTodo({ id: 'high', priority: 'high', dueAt: NOW + HOUR }),
      makeTodo({ id: 'medium', priority: 'medium', dueAt: NOW + HOUR }),
    ])
    const wrapper = mountList()

    expect(renderedIds(wrapper)).toEqual(['high', 'medium', 'low'])
  })

  it('手动排序按 orderIndex 渲染，并给出拖动提示', async () => {
    seed([
      makeTodo({ id: 'a', orderIndex: 2 }),
      makeTodo({ id: 'b', orderIndex: 0 }),
      makeTodo({ id: 'c', orderIndex: 1 }),
    ])
    const wrapper = mountList()
    expect(wrapper.find('.toolbar-hint').exists()).toBe(false)

    todoStore.sortMode = 'manual'
    await nextTick()

    expect(renderedIds(wrapper)).toEqual(['b', 'c', 'a'])
    expect(wrapper.find('.toolbar-hint').text()).toBe(zhCN.todo.row.drag)
  })

  it('只渲染当前视图命中的行，工具栏报出条数', async () => {
    seed([
      makeTodo({ id: 'today', dueAt: NOW + HOUR }),
      makeTodo({ id: 'next-week', dueAt: NOW + 3 * DAY }),
      makeTodo({ id: 'no-due' }),
    ])
    const wrapper = mountList()
    expect(wrapper.find('.toolbar-count').text()).toBe(t('todo.stats.open', { n: 3 }))

    todoStore.setView('today')
    await nextTick()

    expect(renderedIds(wrapper)).toEqual(['today'])
    expect(wrapper.find('.toolbar-count').text()).toBe(t('todo.stats.open', { n: 1 }))
  })

  it('搜索命中为空时只剩空状态', async () => {
    seed([makeTodo({ id: 'a', title: '收尾登录改造' })])
    const wrapper = mountList()

    todoStore.search = '不存在的关键词'
    await nextTick()

    expect(wrapper.findAll('.todo-row')).toHaveLength(0)
    expect(wrapper.find('.todo-empty .empty-title').text()).toBe(zhCN.todo.empty.searchTitle)
  })

  it('空列表渲染空状态，点新建把 create 抛给宿主', async () => {
    seed([])
    const wrapper = mountList()

    expect(wrapper.find('.todo-empty').exists()).toBe(true)
    await wrapper.find('.todo-empty .empty-btn.is-primary').trigger('click')

    expect(wrapper.emitted('create')).toHaveLength(1)
  })

  it('加载中不闪空状态，加载完才出现', async () => {
    seed([])
    todoStore.loading = true
    const wrapper = mountList()

    expect(wrapper.find('.todo-empty').exists()).toBe(false)
    expect(wrapper.findAll('.todo-row')).toHaveLength(0)

    todoStore.loading = false
    await nextTick()

    expect(wrapper.find('.todo-empty').exists()).toBe(true)
  })
})

describe('TodoList · 全选与批量条', () => {
  it('列表为空时全选框禁用', () => {
    seed([])
    const wrapper = mountList()

    const checkbox = wrapper.find('.select-all input')
    expect(checkbox.attributes('disabled')).toBeDefined()
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
    expect(checkbox.attributes('aria-label')).toBe(zhCN.todo.bulk.selectAll)
  })

  it('全选勾上后选中所有可见行，工具栏换成带条数的批量条', async () => {
    seed([makeTodo({ id: 'a' }), makeTodo({ id: 'b' }), makeTodo({ id: 'c' })])
    const wrapper = mountList()

    await wrapper.find('.select-all input').trigger('change')

    expect(todoStore.selectedIds).toEqual(['a', 'b', 'c'])
    expect(todoStore.allVisibleSelected).toBe(true)
    expect(wrapper.find('.list-toolbar').exists()).toBe(false)
    expect(wrapper.find('.bulk-count').text()).toBe(t('todo.bulk.selected', { n: 3 }))
    expect(wrapper.findAll('.todo-row.is-selected')).toHaveLength(3)
  })

  it('全选只覆盖当前视图可见的行', async () => {
    seed([
      makeTodo({ id: 'today', dueAt: NOW + HOUR }),
      makeTodo({ id: 'later', dueAt: NOW + 3 * DAY }),
    ])
    todoStore.setView('today')
    const wrapper = mountList()

    await wrapper.find('.select-all input').trigger('change')

    expect(todoStore.selectedIds).toEqual(['today'])
    expect(wrapper.find('.bulk-count').text()).toBe(t('todo.bulk.selected', { n: 1 }))
  })

  it('勾一行就换出批量条，取消选择按钮把它换回工具栏', async () => {
    seed([makeTodo({ id: 'a' }), makeTodo({ id: 'b' })])
    const wrapper = mountList()

    await selectRow(wrapper, 'a')

    expect(wrapper.find('.bulk-bar').exists()).toBe(true)
    expect(wrapper.find('.bulk-count').text()).toBe(t('todo.bulk.selected', { n: 1 }))
    expect(rowOf(wrapper, 'a').classes()).toContain('is-selected')

    await wrapper.find('.bulk-btn.is-ghost').trigger('click')

    expect(todoStore.selectedIds).toEqual([])
    expect(wrapper.find('.bulk-bar').exists()).toBe(false)
    expect(wrapper.find('.list-toolbar').exists()).toBe(true)
    expect(wrapper.findAll('.todo-row.is-selected')).toHaveLength(0)
  })

  it('逐行勾选与取消勾选，批量条的条数跟着变，清空后换回工具栏', async () => {
    seed([makeTodo({ id: 'a' }), makeTodo({ id: 'b' })])
    const wrapper = mountList()

    await selectRow(wrapper, 'a')
    await selectRow(wrapper, 'b')
    expect(todoStore.selectedIds).toEqual(['a', 'b'])
    expect(wrapper.find('.bulk-count').text()).toBe(t('todo.bulk.selected', { n: 2 }))

    await selectRow(wrapper, 'a')
    expect(todoStore.selectedIds).toEqual(['b'])
    expect(rowOf(wrapper, 'a').classes()).not.toContain('is-selected')
    expect(wrapper.find('.bulk-count').text()).toBe(t('todo.bulk.selected', { n: 1 }))

    await selectRow(wrapper, 'b')
    expect(todoStore.selectedIds).toEqual([])
    expect(wrapper.find('.bulk-bar').exists()).toBe(false)
    expect(wrapper.find('.select-all input').exists()).toBe(true)
  })

  it('批量标记完成：bulkStatus 收到选中 id，选择清空且状态落库', async () => {
    seed([makeTodo({ id: 'a' }), makeTodo({ id: 'b' }), makeTodo({ id: 'c' })])
    const wrapper = mountList()
    await selectRow(wrapper, 'a')
    await selectRow(wrapper, 'c')

    await bulkButton(wrapper, zhCN.todo.bulk.complete).trigger('click')
    await flushPromises()

    expect(todoApi.bulkStatus).toHaveBeenCalledWith(['a', 'c'], 'completed')
    expect(todoStore.selectedIds).toEqual([])
    expect(todoStore.todos.filter(todo => todo.status === 'completed').map(todo => todo.id)).toEqual(['a', 'c'])
    expect(todoStore.findTodo('b')?.status).toBe('open')
    expect(wrapper.find('.bulk-bar').exists()).toBe(false)
  })

  it('批量重新打开：已完成视图里把选中行改回未完成', async () => {
    seed([
      makeTodo({ id: 'a', status: 'completed' }),
      makeTodo({ id: 'b', status: 'completed' }),
    ])
    todoStore.setView('completed')
    const wrapper = mountList()
    await wrapper.find('.select-all input').trigger('change')

    await bulkButton(wrapper, zhCN.todo.bulk.reopen).trigger('click')
    await flushPromises()

    expect(todoApi.bulkStatus).toHaveBeenCalledWith(['a', 'b'], 'open')
    expect(todoStore.todos.every(todo => todo.status === 'open')).toBe(true)
    expect(todoStore.selectedIds).toEqual([])
    expect(todoStore.sortedTodos).toHaveLength(0)
  })

  it('批量移到分组：每条选中待办各发一次 update，选择清空且下拉复位', async () => {
    seed([makeTodo({ id: 'a' }), makeTodo({ id: 'b' }), makeTodo({ id: 'c' })], [makeGroup('g1', '工作')])
    const wrapper = mountList()
    await selectRow(wrapper, 'a')
    await selectRow(wrapper, 'b')

    const select = wrapper.find('.bulk-select')
    expect(select.attributes('aria-label')).toBe(zhCN.todo.bulk.move)
    expect(select.findAll('option').map(option => option.attributes('value'))).toEqual(['', '__none__', 'g1'])
    expect(select.findAll('option')[2].text()).toBe('工作')

    await select.setValue('g1')
    await flushPromises()

    expect(todoApi.update.mock.calls).toEqual([
      [{ id: 'a', groupId: 'g1', expectedUpdatedAt: NOW - HOUR }],
      [{ id: 'b', groupId: 'g1', expectedUpdatedAt: NOW - HOUR }],
    ])
    expect(todoStore.findTodo('a')?.groupId).toBe('g1')
    expect(todoStore.findTodo('b')?.groupId).toBe('g1')
    expect(todoStore.findTodo('c')?.groupId).toBeUndefined()
    expect(todoStore.selectedIds).toEqual([])
    expect((select.element as HTMLSelectElement).value).toBe('')
    expect(wrapper.find('.list-toolbar').exists()).toBe(true)
  })

  it('批量移到未分组：__none__ 传成 groupId: null', async () => {
    seed(
      [makeTodo({ id: 'a', groupId: 'g1' }), makeTodo({ id: 'b', groupId: 'g1' })],
      [makeGroup('g1', '工作')],
    )
    const wrapper = mountList()
    await wrapper.find('.select-all input').trigger('change')

    const select = wrapper.find('.bulk-select')
    expect(select.findAll('option')[1].text()).toBe(zhCN.todo.nav.ungrouped)
    await select.setValue('__none__')
    await flushPromises()

    expect(todoApi.update.mock.calls).toEqual([
      [{ id: 'a', groupId: null, expectedUpdatedAt: NOW - HOUR }],
      [{ id: 'b', groupId: null, expectedUpdatedAt: NOW - HOUR }],
    ])
    expect(todoStore.todos.every(todo => todo.groupId === undefined)).toBe(true)
    expect(todoStore.selectedIds).toEqual([])
    expect((select.element as HTMLSelectElement).value).toBe('')
  })

  it('批量删除先确认，确认后 bulkRemove 并留下撤销批次', async () => {
    seed([makeTodo({ id: 'a' }), makeTodo({ id: 'b' }), makeTodo({ id: 'c' })])
    const wrapper = mountList()
    await selectRow(wrapper, 'a')
    await selectRow(wrapper, 'b')

    await bulkButton(wrapper, zhCN.todo.bulk.remove).trigger('click')
    await nextTick()
    expect(todoApi.bulkRemove).not.toHaveBeenCalled()

    await answerConfirm(t('todo.bulk.removeConfirm', { n: 2 }), true)

    expect(todoApi.bulkRemove).toHaveBeenCalledWith(['a', 'b'])
    expect(todoStore.todos.map(todo => todo.id)).toEqual(['c'])
    expect(todoStore.selectedIds).toEqual([])
    expect(todoStore.hasUndo).toBe(true)
    expect(todoStore.undoBatch?.todos.map(todo => todo.id)).toEqual(['a', 'b'])
  })

  it('批量删除取消后待办与选择都不动', async () => {
    seed([makeTodo({ id: 'a' }), makeTodo({ id: 'b' })])
    const wrapper = mountList()
    await selectRow(wrapper, 'a')
    await selectRow(wrapper, 'b')

    await bulkButton(wrapper, zhCN.todo.bulk.remove).trigger('click')
    await answerConfirm(t('todo.bulk.removeConfirm', { n: 2 }), false)

    expect(todoApi.bulkRemove).not.toHaveBeenCalled()
    expect(todoStore.todos.map(todo => todo.id)).toEqual(['a', 'b'])
    expect(todoStore.selectedIds).toEqual(['a', 'b'])
    expect(todoStore.hasUndo).toBe(false)
    expect(wrapper.find('.bulk-count').text()).toBe(t('todo.bulk.selected', { n: 2 }))
  })
})

describe('TodoList · 拖拽排序', () => {
  it('往下拖：reorder 收到拼接后的顺序，排序切到手动', async () => {
    seed([
      makeTodo({ id: 'a', dueAt: NOW + HOUR }),
      makeTodo({ id: 'b', dueAt: NOW + 2 * HOUR }),
      makeTodo({ id: 'c', dueAt: NOW + 3 * HOUR }),
    ])
    const wrapper = mountList()

    const dataTransfer = await startDrag(wrapper, 'a')
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 'a')
    expect(dataTransfer.effectAllowed).toBe('move')

    await rowOf(wrapper, 'c').trigger('dragover')
    await rowOf(wrapper, 'c').trigger('drop')
    await flushPromises()

    expect(todoApi.reorder).toHaveBeenCalledWith(['b', 'c', 'a'])
    expect(todoStore.sortMode).toBe('manual')
    expect(renderedIds(wrapper)).toEqual(['b', 'c', 'a'])
    expect(todoStore.todos.map(todo => `${todo.id}:${todo.orderIndex}`).sort()).toEqual(['a:2', 'b:0', 'c:1'])
  })

  it('往上拖：源行插到目标行原来的位置', async () => {
    seed([
      makeTodo({ id: 'a', orderIndex: 0 }),
      makeTodo({ id: 'b', orderIndex: 1 }),
      makeTodo({ id: 'c', orderIndex: 2 }),
    ])
    todoStore.sortMode = 'manual'
    const wrapper = mountList()

    await startDrag(wrapper, 'c')
    await rowOf(wrapper, 'a').trigger('dragover')
    await rowOf(wrapper, 'a').trigger('drop')
    await flushPromises()

    expect(todoApi.reorder).toHaveBeenCalledWith(['c', 'a', 'b'])
    expect(renderedIds(wrapper)).toEqual(['c', 'a', 'b'])
  })

  it('拖到自己身上是空操作', async () => {
    seed([makeTodo({ id: 'a', dueAt: NOW + HOUR }), makeTodo({ id: 'b', dueAt: NOW + 2 * HOUR })])
    const wrapper = mountList()

    await startDrag(wrapper, 'a')
    await rowOf(wrapper, 'a').trigger('dragover')
    expect(rowOf(wrapper, 'a').classes()).not.toContain('is-drop-target')

    await rowOf(wrapper, 'a').trigger('drop')
    await flushPromises()

    expect(todoApi.reorder).not.toHaveBeenCalled()
    expect(todoStore.sortMode).toBe('smart')
    expect(renderedIds(wrapper)).toEqual(['a', 'b'])
    expect(rowOf(wrapper, 'a').classes()).not.toContain('is-dragging')
  })

  it('拖动中源行与落点行各有标记，dragend 把两个标记都清掉', async () => {
    seed([makeTodo({ id: 'a', dueAt: NOW + HOUR }), makeTodo({ id: 'b', dueAt: NOW + 2 * HOUR })])
    const wrapper = mountList()

    await startDrag(wrapper, 'a')
    expect(rowOf(wrapper, 'a').classes()).toContain('is-dragging')

    await rowOf(wrapper, 'b').trigger('dragover')
    expect(rowOf(wrapper, 'b').classes()).toContain('is-drop-target')
    expect(rowOf(wrapper, 'a').classes()).not.toContain('is-drop-target')

    await rowOf(wrapper, 'a').trigger('dragend')

    expect(wrapper.find('.todo-row.is-dragging').exists()).toBe(false)
    expect(wrapper.find('.todo-row.is-drop-target').exists()).toBe(false)
    expect(todoApi.reorder).not.toHaveBeenCalled()
  })

  it('没按住手柄时整行不可拖动，dragstart 被拦下', async () => {
    seed([makeTodo({ id: 'a', dueAt: NOW + HOUR }), makeTodo({ id: 'b', dueAt: NOW + 2 * HOUR })])
    const wrapper = mountList()

    expect(rowOf(wrapper, 'a').attributes('draggable')).toBe('false')
    await rowOf(wrapper, 'a').trigger('dragstart')
    await rowOf(wrapper, 'b').trigger('drop')
    await flushPromises()

    expect(todoApi.reorder).not.toHaveBeenCalled()
    expect(rowOf(wrapper, 'a').classes()).not.toContain('is-dragging')

    await rowOf(wrapper, 'a').find('.row-grip').trigger('mousedown')
    expect(rowOf(wrapper, 'a').attributes('draggable')).toBe('true')
  })
})

describe('TodoList · 行内动作', () => {
  it('点行首圆圈标记完成，走真实 update 并带上版本戳', async () => {
    seed([makeTodo({ id: 'a' })])
    const wrapper = mountList()

    await rowOf(wrapper, 'a').find('.row-check').trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 'a', status: 'completed', expectedUpdatedAt: NOW - HOUR })
    expect(todoStore.findTodo('a')?.status).toBe('completed')
  })

  it('点标题与双击行都打开详情，并高亮当前行', async () => {
    seed([makeTodo({ id: 'a' })])
    const wrapper = mountList()

    await rowOf(wrapper, 'a').find('.row-body').trigger('click')
    expect(todoStore.detailId).toBe('a')
    expect(rowOf(wrapper, 'a').classes()).toContain('is-active')

    todoStore.openDetail(null)
    await nextTick()
    await rowOf(wrapper, 'a').trigger('dblclick')
    expect(todoStore.detailId).toBe('a')
  })

  it('引用到输入框：关掉待办面板、回到 chat，并推入 todo 载荷', async () => {
    seed([makeTodo({ id: 'a', title: '收尾登录改造' })])
    appStore.showTodoManager = true
    appStore.activeCenterTab = 'terminal-1'
    const wrapper = mountList()

    await runRowAction(wrapper, 'a', zhCN.todo.row.reference)

    expect(appStore.showTodoManager).toBe(false)
    expect(appStore.activeCenterTab).toBe('chat')
    expect(appStore.pendingInputInjection).toEqual({ todo: { id: 'a', title: '收尾登录改造' } })
    expect(notice.notice).toBe(t('todo.composer.referenced', { title: '收尾登录改造' }))
    expect(document.querySelector('.row-menu')).toBeNull()
  })

  it('让 Agent 处理：chip 与提示词正文一起推给输入框', async () => {
    const todo = makeTodo({ id: 'a', title: '收尾登录改造', notes: '接口联调还没做' })
    seed([todo])
    appStore.showTodoManager = true
    const wrapper = mountList()

    await runRowAction(wrapper, 'a', zhCN.todo.row.askAgent)

    expect(appStore.showTodoManager).toBe(false)
    expect(appStore.activeCenterTab).toBe('chat')
    expect(appStore.pendingInputInjection).toEqual({
      todo: { id: 'a', title: '收尾登录改造' },
      text: buildTodoAgentPrompt(todo),
    })
    expect(notice.notice).toBe(t('todo.composer.agentPromptReady', { title: '收尾登录改造' }))
  })

  it('编辑详情只开抽屉，不关待办面板', async () => {
    seed([makeTodo({ id: 'a' })])
    appStore.showTodoManager = true
    const wrapper = mountList()

    await runRowAction(wrapper, 'a', zhCN.todo.row.edit)

    expect(todoStore.detailId).toBe('a')
    expect(appStore.showTodoManager).toBe(true)
    expect(appStore.pendingInputInjection).toBeNull()
  })

  it('复制标题写进剪贴板并给出提示', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    seed([makeTodo({ id: 'a', title: '收尾登录改造' })])
    const wrapper = mountList()

    await runRowAction(wrapper, 'a', zhCN.todo.row.copyTitle)

    expect(writeText).toHaveBeenCalledWith('收尾登录改造')
    expect(notice.notice).toBe(zhCN.todo.composer.copied)
    expect(todoStore.detailId).toBeNull()
  })

  it('剪贴板被系统拒绝时不弹错误也不冒异常', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('denied')
    })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    seed([makeTodo({ id: 'a' })])
    const wrapper = mountList()

    await runRowAction(wrapper, 'a', zhCN.todo.row.copyTitle)

    expect(writeText).toHaveBeenCalled()
    expect(notice.notice).toBeNull()
    expect(todoStore.todos).toHaveLength(1)
  })

  it('删除先确认，确认后移除并留下可撤销的快照', async () => {
    seed([makeTodo({ id: 'a', title: '收尾登录改造' }), makeTodo({ id: 'b' })])
    const wrapper = mountList()

    await openRowMenu(wrapper, 'a')
    await rowMenuItem(zhCN.todo.row.delete).trigger('click')
    await nextTick()
    expect(todoApi.remove).not.toHaveBeenCalled()

    await answerConfirm(t('todo.row.deleteConfirm', { title: '收尾登录改造' }), true)

    expect(todoApi.remove).toHaveBeenCalledWith('a')
    expect(todoStore.todos.map(todo => todo.id)).toEqual(['b'])
    expect(todoStore.undoBatch?.todos.map(todo => todo.id)).toEqual(['a'])
  })

  it('撤销删除把待办原样放回列表', async () => {
    seed([makeTodo({ id: 'a', title: '收尾登录改造' })])
    const wrapper = mountList()
    await openRowMenu(wrapper, 'a')
    await rowMenuItem(zhCN.todo.row.delete).trigger('click')
    await answerConfirm(t('todo.row.deleteConfirm', { title: '收尾登录改造' }), true)

    await todoStore.undoRemove()
    await flushPromises()

    expect(todoApi.restore).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', title: '收尾登录改造' }))
    expect(todoStore.todos.map(todo => todo.id)).toEqual(['a'])
    expect(todoStore.hasUndo).toBe(false)
  })

  it('删除取消后待办还在，也不发 remove', async () => {
    seed([makeTodo({ id: 'a', title: '收尾登录改造' })])
    const wrapper = mountList()

    await openRowMenu(wrapper, 'a')
    await rowMenuItem(zhCN.todo.row.delete).trigger('click')
    await answerConfirm(t('todo.row.deleteConfirm', { title: '收尾登录改造' }), false)

    expect(todoApi.remove).not.toHaveBeenCalled()
    expect(todoStore.todos.map(todo => todo.id)).toEqual(['a'])
    expect(todoStore.hasUndo).toBe(false)
    expect(wrapper.findAll('.todo-row')).toHaveLength(1)
  })

  it('删除已打开详情的那条会顺手关掉抽屉', async () => {
    seed([makeTodo({ id: 'a', title: '收尾登录改造' })])
    todoStore.openDetail('a')
    const wrapper = mountList()

    await openRowMenu(wrapper, 'a')
    await rowMenuItem(zhCN.todo.row.delete).trigger('click')
    await answerConfirm(t('todo.row.deleteConfirm', { title: '收尾登录改造' }), true)

    expect(todoStore.detailId).toBeNull()
  })
})