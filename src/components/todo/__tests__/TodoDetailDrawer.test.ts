/**
 * 待办详情抽屉：标题/备注自动保存（含 expectedUpdatedAt 与防抖）、生命周期、
 * 删除确认、引用/交给 Agent、提醒整表提交、关联会话、只读来源。
 *
 * 抽屉挂真实组件（TodoDueField / CalendarField / TimeWheelField 都是真的），
 * 宿主只做 TodoManager 那一行绑定：`:todo="store.detailTodo"` + `:key="id"`，
 * 这样 store 的乐观更新与广播回填能真的流回 props。只替 IPC。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, h, nextTick } from 'vue'
import type {
  ActiveTodoReminder,
  Todo,
  TodoAgentOperation,
  TodoChangePayload,
  TodoGroup,
  TodoMutation,
  TodoReminder,
  TodoSyncState,
} from '@/shared/channels/todo'
import type { Session } from '@/types'

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
 * 抽屉拉起 chatSession → settings/terminal：settings 建 store 就读配置，
 * selectSession 会读一次 turn checkpoints。缺这几个键会变成 unhandled rejection。
 */
const hostApi = vi.hoisted(() => ({
  loadGuiSettings: vi.fn(),
  saveGuiSettings: vi.fn(),
  getEnv: vi.fn(),
  terminal: { onExit: vi.fn() },
  session: { getTurnCheckpoints: vi.fn() },
}))

vi.mock('@/services/electronAPI', () => ({ api: { ...hostApi, todo: todoApi } }))

import TodoDetailDrawer from '../TodoDetailDrawer.vue'
import { useAppStore } from '@/stores/app'
import { useTodoStore } from '@/stores/todo'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTodoActions } from '@/composables/useTodoActions'
import { useDialog } from '@/composables/useDialog'
import { buildTodoAgentPrompt } from '@/shared/todoReference'
import { TODO_TAG_MAX_COUNT, TODO_TITLE_MAX_LENGTH } from '@/shared/channels/todo'
import { combineDateAndTime, formatDueShort, splitDueAt } from '@/utils/todoTime'
import zhCN from '@/i18n/locales/zh-CN'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

const NOW = new Date(2026, 10, 14, 10, 0, 0, 0).getTime()
const HOUR = 3600_000
const DAY = 24 * HOUR
/** 抽屉防抖窗口，与组件里的 AUTOSAVE_MS 对齐。 */
const AUTOSAVE_MS = 700

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: '收尾登录改造',
    notes: '表单校验改完了，剩下接口联调',
    status: 'open',
    priority: 'medium',
    tags: ['login'],
    reminders: [],
    sessionLinks: [],
    orderIndex: 0,
    createdAt: NOW - DAY,
    updatedAt: NOW - HOUR,
    ...overrides,
  }
}

function makeReminder(overrides: Partial<TodoReminder> & { id: string }): TodoReminder {
  return { triggerAt: NOW + HOUR, status: 'pending', origin: 'manual', ...overrides }
}

function makeGroup(id: string, name = id): TodoGroup {
  return { id, name, color: 'teal', orderIndex: 0, createdAt: NOW - DAY }
}

function makeSession(id: string): Session {
  return {
    id,
    title: `会话 ${id}`,
    messages: [],
    createdAt: NOW - DAY,
    updatedAt: NOW - HOUR,
    processStatus: 'none',
    isTabOpen: false,
    lastActivityAt: NOW - HOUR,
  }
}

function makeSyncState(): TodoSyncState {
  return {
    supported: false,
    permission: 'unsupported',
    config: { enabled: false, listId: null },
    lists: [],
    conflicts: [],
    syncing: false,
  }
}

/** 与 TodoManager 里那一行等价：详情跟着 store 走，切换待办即重建。 */
const DrawerHost = defineComponent({
  name: 'DrawerHost',
  setup() {
    const store = useTodoStore()
    return () => {
      const todo = store.detailTodo
      return todo ? h(TodoDetailDrawer, { key: todo.id, todo }) : null
    }
  },
})

const NoticeProbe = defineComponent({
  setup() {
    return useTodoActions()
  },
  render: () => null,
})

type Listener<T> = (payload: T) => void
const listeners: {
  changed: Listener<TodoChangePayload>[]
  agent: Listener<TodoAgentOperation>[]
  reminder: Listener<ActiveTodoReminder[]>[]
  sync: Listener<TodoSyncState>[]
} = { changed: [], agent: [], reminder: [], sync: [] }

let appStore: ReturnType<typeof useAppStore>
let todoStore: ReturnType<typeof useTodoStore>
let chatStore: ReturnType<typeof useChatSessionStore>
let actions: ReturnType<typeof mountNoticeProbe>['vm']
let dialog: ReturnType<typeof useDialog>

function mountNoticeProbe() {
  return mount(NoticeProbe, { global: { plugins: [i18n] } })
}

function mountDrawer(todo: Todo, groups: TodoGroup[] = []) {
  todoStore.todos = [todo]
  todoStore.groups = groups
  todoStore.openDetail(todo.id)
  return mount(DrawerHost, { global: { plugins: [i18n] }, attachTo: document.body })
}

type Wrapper = ReturnType<typeof mountDrawer>

function inputValue(wrapper: Wrapper, selector: string): string {
  return (wrapper.find(selector).element as HTMLInputElement | HTMLTextAreaElement).value
}

function okUpdate(todo: Todo): void {
  todoApi.update.mockResolvedValue({ ok: true, todo })
}

function emitChange(payload: TodoChangePayload): void {
  for (const listener of listeners.changed) listener(payload)
}

/** 日历弹层 teleport 到 body，只能从 document 上点日期格子。 */
async function pickDate(wrapper: Wrapper, triggerSelector: string, date: string): Promise<void> {
  await wrapper.find(triggerSelector).trigger('click')
  await flushPromises()
  const cell = document.querySelector(`.calendar-day[data-date="${date}"]`) as HTMLButtonElement | null
  expect(cell).not.toBeNull()
  cell?.click()
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.clear()
  listeners.changed = []
  listeners.agent = []
  listeners.reminder = []
  listeners.sync = []
  setActivePinia(createPinia())

  todoApi.list.mockResolvedValue([])
  todoApi.listGroups.mockResolvedValue([])
  todoApi.listActiveReminders.mockResolvedValue([])
  todoApi.getSyncState.mockResolvedValue(makeSyncState())
  todoApi.get.mockResolvedValue(null)
  todoApi.create.mockResolvedValue({ ok: false, reason: 'not-found' })
  todoApi.update.mockResolvedValue({ ok: false, reason: 'not-found' })
  todoApi.remove.mockResolvedValue({ ok: false, reason: 'not-found' })
  todoApi.restore.mockResolvedValue({ ok: false, reason: 'not-found' })
  todoApi.bulkStatus.mockResolvedValue([])
  todoApi.bulkRemove.mockResolvedValue([])
  todoApi.reorder.mockResolvedValue([])
  todoApi.touchSession.mockResolvedValue(null)
  todoApi.createGroup.mockResolvedValue({ ok: false, reason: 'invalid-name' })
  todoApi.renameGroup.mockResolvedValue({ ok: false, reason: 'not-found' })
  todoApi.removeGroup.mockResolvedValue({ ok: false })
  todoApi.acknowledgeReminder.mockResolvedValue({ ok: true })
  todoApi.snoozeReminder.mockResolvedValue({ ok: true })
  todoApi.requestSyncAccess.mockResolvedValue({ ok: true, state: makeSyncState() })
  todoApi.setSyncConfig.mockResolvedValue({ ok: true, state: makeSyncState() })
  todoApi.syncNow.mockResolvedValue({ ok: true, state: makeSyncState() })
  todoApi.resolveSyncConflict.mockResolvedValue({ ok: true, state: makeSyncState() })
  todoApi.onChanged.mockImplementation((cb: Listener<TodoChangePayload>) => {
    listeners.changed.push(cb)
    return vi.fn()
  })
  todoApi.onAgentOperation.mockImplementation((cb: Listener<TodoAgentOperation>) => {
    listeners.agent.push(cb)
    return vi.fn()
  })
  todoApi.onReminderDue.mockImplementation((cb: Listener<ActiveTodoReminder[]>) => {
    listeners.reminder.push(cb)
    return vi.fn()
  })
  todoApi.onSyncStateChanged.mockImplementation((cb: Listener<TodoSyncState>) => {
    listeners.sync.push(cb)
    return vi.fn()
  })
  hostApi.loadGuiSettings.mockResolvedValue({ success: false })
  hostApi.saveGuiSettings.mockResolvedValue({ success: true })
  hostApi.getEnv.mockResolvedValue('')
  hostApi.terminal.onExit.mockReturnValue(vi.fn())
  hostApi.session.getTurnCheckpoints.mockResolvedValue({ ok: true, checkpoints: [] })

  appStore = useAppStore()
  appStore.showTodoManager = true
  todoStore = useTodoStore()
  chatStore = useChatSessionStore()
  todoStore.subscribe()
  actions = mountNoticeProbe().vm
  actions.dismissNotice()
  dialog = useDialog()
})

afterEach(() => {
  todoStore.unsubscribe()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('TodoDetailDrawer · 渲染与关闭', () => {
  it('把待办的标题、备注、优先级、分组、标签都摊开', () => {
    const wrapper = mountDrawer(
      makeTodo({ priority: 'high', groupId: 'g1', tags: ['login', 'ui'] }),
      [makeGroup('g1', '登录改造'), makeGroup('g2', '发布')],
    )

    expect(inputValue(wrapper, '.title-input')).toBe('收尾登录改造')
    expect(inputValue(wrapper, '.notes-input')).toBe('表单校验改完了，剩下接口联调')
    expect(wrapper.find('.seg-btn.is-active').text()).toBe(zhCN.todo.priority.high)
    expect((wrapper.find('.field-select').element as HTMLSelectElement).value).toBe('g1')
    expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['login', 'ui'])
    expect(wrapper.find('.title-input').attributes('maxlength')).toBe(String(TODO_TITLE_MAX_LENGTH))
  })

  it('记录信息里给出创建与更新时间', () => {
    const wrapper = mountDrawer(makeTodo())

    const meta = wrapper.findAll('.meta-line').map(line => line.text())
    expect(meta).toHaveLength(2)
    expect(meta[0]).toContain(zhCN.todo.detail.created.split('{')[0].trim())
    expect(meta[1]).toContain(zhCN.todo.detail.updated.split('{')[0].trim())
  })

  it('已完成的待办额外给出完成时间，标题划掉', () => {
    const wrapper = mountDrawer(makeTodo({ status: 'completed', completedAt: NOW - HOUR }))

    expect(wrapper.find('.meta-line.is-success').exists()).toBe(true)
    expect(wrapper.find('.title-input').classes()).toContain('is-done')
    expect(wrapper.find('.status-toggle').classes()).toContain('is-done')
  })

  it('关闭按钮清空 detailId，抽屉随之卸载', async () => {
    const wrapper = mountDrawer(makeTodo())

    await wrapper.find('.detail-head .icon-btn').trigger('click')

    expect(todoStore.detailId).toBeNull()
    expect(wrapper.find('[data-testid="todo-detail"]').exists()).toBe(false)
  })
})

describe('TodoDetailDrawer · 标题与备注保存', () => {
  it('改标题失焦即保存，带上当前快照的 expectedUpdatedAt', async () => {
    const seed = makeTodo()
    const wrapper = mountDrawer(seed)
    okUpdate(makeTodo({ title: '收尾登录改造 v2', updatedAt: NOW }))

    await wrapper.find('.title-input').setValue('  收尾登录改造 v2  ')
    await wrapper.find('.title-input').trigger('blur')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({
      id: 't1',
      title: '收尾登录改造 v2',
      expectedUpdatedAt: seed.updatedAt,
    })
    expect(todoStore.todos[0].title).toBe('收尾登录改造 v2')
    expect(wrapper.find('.save-state.is-saved').text()).toBe(zhCN.todo.detail.saved)
  })

  it('提交用的是抽屉当前 props 的时间戳，而不是挂载时那一份', async () => {
    const stale = makeTodo({ updatedAt: NOW - 5 * HOUR })
    todoStore.todos = [makeTodo({ updatedAt: NOW - HOUR })]
    const wrapper = mount(TodoDetailDrawer, {
      props: { todo: stale },
      global: { plugins: [i18n] },
      attachTo: document.body,
    })
    okUpdate(makeTodo({ title: '改过的标题', updatedAt: NOW }))

    await wrapper.find('.title-input').setValue('改过的标题')
    await wrapper.find('.title-input').trigger('blur')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({
      id: 't1',
      title: '改过的标题',
      expectedUpdatedAt: stale.updatedAt,
    })
  })

  it('连续打字只在停顿 700ms 后提交一次', async () => {
    const wrapper = mountDrawer(makeTodo())
    okUpdate(makeTodo({ title: '收尾登录改造 v2', updatedAt: NOW }))

    await wrapper.find('.title-input').setValue('收尾登录改造 v')
    vi.advanceTimersByTime(AUTOSAVE_MS - 100)
    await wrapper.find('.title-input').setValue('收尾登录改造 v2')
    vi.advanceTimersByTime(AUTOSAVE_MS - 1)
    await flushPromises()
    expect(todoApi.update).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledTimes(1)
    expect(todoApi.update).toHaveBeenCalledWith(expect.objectContaining({ title: '收尾登录改造 v2' }))
  })

  it('标题里回车立刻落盘，不等防抖也不再重复提交', async () => {
    const wrapper = mountDrawer(makeTodo())
    okUpdate(makeTodo({ title: '回车保存', updatedAt: NOW }))

    await wrapper.find('.title-input').setValue('回车保存')
    await wrapper.find('.title-input').trigger('keydown.enter')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(AUTOSAVE_MS * 2)
    await flushPromises()
    expect(todoApi.update).toHaveBeenCalledTimes(1)
  })

  it('标题被清空时回滚成原标题，不发请求', async () => {
    const wrapper = mountDrawer(makeTodo())

    await wrapper.find('.title-input').setValue('   ')
    await wrapper.find('.title-input').trigger('blur')
    await flushPromises()

    expect(todoApi.update).not.toHaveBeenCalled()
    expect(inputValue(wrapper, '.title-input')).toBe('收尾登录改造')
  })

  it('内容没变就不发请求', async () => {
    const wrapper = mountDrawer(makeTodo())

    await wrapper.find('.title-input').trigger('focus')
    await wrapper.find('.title-input').trigger('blur')
    await wrapper.find('.notes-input').trigger('focus')
    await wrapper.find('.notes-input').trigger('blur')
    await flushPromises()

    expect(todoApi.update).not.toHaveBeenCalled()
    expect(wrapper.find('.save-state').exists()).toBe(false)
  })

  it('备注原样保存（不 trim），并回填服务端结果', async () => {
    const wrapper = mountDrawer(makeTodo())
    okUpdate(makeTodo({ notes: '  下一步：接口联调  ', updatedAt: NOW }))

    await wrapper.find('.notes-input').setValue('  下一步：接口联调  ')
    await wrapper.find('.notes-input').trigger('blur')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({
      id: 't1',
      notes: '  下一步：接口联调  ',
      expectedUpdatedAt: NOW - HOUR,
    })
    expect(inputValue(wrapper, '.notes-input')).toBe('  下一步：接口联调  ')
  })

  it('保存中显示保存态，成功后转已保存并在 1.6s 后淡出', async () => {
    const wrapper = mountDrawer(makeTodo())
    let settle: (value: TodoMutation) => void = () => {}
    todoApi.update.mockImplementation(() => new Promise<TodoMutation>(resolve => { settle = resolve }))

    await wrapper.find('.title-input').setValue('慢慢保存')
    await wrapper.find('.title-input').trigger('blur')
    await nextTick()

    expect(wrapper.find('.save-state.is-saving').text()).toBe(zhCN.todo.detail.saving)

    settle({ ok: true, todo: makeTodo({ title: '慢慢保存', updatedAt: NOW }) })
    await flushPromises()

    expect(wrapper.find('.save-state.is-saved').exists()).toBe(true)

    vi.advanceTimersByTime(1600)
    await nextTick()

    expect(wrapper.find('.save-state').exists()).toBe(false)
  })

  it('乐观冲突时回到服务端标题，保存态复位并记下 conflict', async () => {
    const wrapper = mountDrawer(makeTodo())
    const server = makeTodo({ title: 'Agent 改过的标题', updatedAt: NOW })
    todoApi.update.mockResolvedValue({ ok: false, reason: 'conflict', todo: server })
    todoApi.get.mockResolvedValue(server)

    await wrapper.find('.title-input').setValue('我的标题')
    await wrapper.find('.title-input').trigger('blur')
    await flushPromises()

    expect(todoApi.get).toHaveBeenCalledWith('t1')
    expect(todoStore.error).toBe('conflict')
    expect(inputValue(wrapper, '.title-input')).toBe('Agent 改过的标题')
    expect(wrapper.find('.save-state').exists()).toBe(false)
  })

  it('正在编辑的字段不被 Agent 广播覆盖，没在编辑的字段照常回填', async () => {
    const wrapper = mountDrawer(makeTodo())

    await wrapper.find('.title-input').trigger('focus')
    await wrapper.find('.title-input').setValue('我还没写完的标题')

    emitChange({
      source: 'agent',
      todos: [makeTodo({ title: 'Agent 的标题', notes: 'Agent 记的进度', updatedAt: NOW })],
    })
    await nextTick()

    expect(inputValue(wrapper, '.title-input')).toBe('我还没写完的标题')
    expect(inputValue(wrapper, '.notes-input')).toBe('Agent 记的进度')
    expect(todoStore.agentHighlights['t1']).toBeDefined()
  })

  it('切到另一条待办时草稿重建，不串标题', async () => {
    const wrapper = mountDrawer(makeTodo())
    await wrapper.find('.title-input').setValue('没保存的草稿')

    todoStore.todos = [...todoStore.todos, makeTodo({ id: 't2', title: '另一件事', notes: '另一条备注' })]
    todoStore.openDetail('t2')
    await nextTick()

    expect(inputValue(wrapper, '.title-input')).toBe('另一件事')
    expect(inputValue(wrapper, '.notes-input')).toBe('另一条备注')
  })
})

describe('TodoDetailDrawer · 生命周期与删除', () => {
  it('点状态圈完成待办，按钮语义翻成重新打开', async () => {
    const wrapper = mountDrawer(makeTodo())
    okUpdate(makeTodo({ status: 'completed', completedAt: NOW, updatedAt: NOW }))

    await wrapper.find('.status-toggle').trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', status: 'completed', expectedUpdatedAt: NOW - HOUR })
    expect(todoStore.todos[0].status).toBe('completed')
    expect(wrapper.find('.status-toggle').attributes('title')).toBe(zhCN.todo.row.reopen)
  })

  it('已完成的待办点一下重新打开', async () => {
    const wrapper = mountDrawer(makeTodo({ status: 'completed', completedAt: NOW - HOUR }))
    okUpdate(makeTodo({ status: 'open', updatedAt: NOW }))

    expect(wrapper.find('.status-toggle').attributes('title')).toBe(zhCN.todo.row.reopen)
    await wrapper.find('.status-toggle').trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'open' }))
    expect(wrapper.find('.status-toggle').attributes('title')).toBe(zhCN.todo.row.complete)
  })

  it('删除先弹危险确认，取消就什么都不做', async () => {
    const wrapper = mountDrawer(makeTodo())

    await wrapper.find('.foot-btn.is-danger').trigger('click')

    expect(dialog.confirmDialogState.value.visible).toBe(true)
    expect(dialog.confirmDialogState.value.variant).toBe('danger')
    expect(dialog.confirmDialogState.value.message).toBe(
      zhCN.todo.row.deleteConfirm.replace('{title}', '收尾登录改造'),
    )

    dialog.closeConfirm(false)
    await flushPromises()

    expect(todoApi.remove).not.toHaveBeenCalled()
    expect(todoStore.todos).toHaveLength(1)
    expect(wrapper.find('[data-testid="todo-detail"]').exists()).toBe(true)
  })

  it('确认删除后行被移除、抽屉关闭，并留下可撤销批次', async () => {
    const seed = makeTodo()
    const wrapper = mountDrawer(seed)
    todoApi.remove.mockResolvedValue({ ok: true, removed: seed })

    await wrapper.find('.foot-btn.is-danger').trigger('click')
    dialog.closeConfirm(true)
    await flushPromises()

    expect(todoApi.remove).toHaveBeenCalledWith('t1')
    expect(todoStore.todos).toHaveLength(0)
    expect(todoStore.detailId).toBeNull()
    expect(todoStore.undoBatch?.todos).toEqual([seed])
    expect(wrapper.find('[data-testid="todo-detail"]').exists()).toBe(false)
  })
})

describe('TodoDetailDrawer · 引用与交给 Agent', () => {
  it('「引用到输入框」关掉面板并把 todo 载荷推给输入框', async () => {
    const wrapper = mountDrawer(makeTodo())
    appStore.activeCenterTab = 'terminal-1'

    await wrapper.find('.foot-btn.is-primary').trigger('click')

    expect(appStore.showTodoManager).toBe(false)
    expect(appStore.activeCenterTab).toBe('chat')
    expect(appStore.pendingInputInjection).toEqual({ todo: { id: 't1', title: '收尾登录改造' } })
    expect(actions.notice).toBe(zhCN.todo.composer.referenced.replace('{title}', '收尾登录改造'))
  })

  it('「让 Agent 处理」同时推 chip 与提示词正文', async () => {
    const seed = makeTodo()
    const wrapper = mountDrawer(seed)

    await wrapper.findAll('.foot-btn')[1].trigger('click')

    expect(appStore.showTodoManager).toBe(false)
    expect(appStore.pendingInputInjection).toEqual({
      todo: { id: 't1', title: '收尾登录改造' },
      text: buildTodoAgentPrompt(seed),
    })
    expect(actions.notice).toBe(zhCN.todo.composer.agentPromptReady.replace('{title}', '收尾登录改造'))
  })

  it('引用推的是最新标题，不是挂载时那一份', async () => {
    const wrapper = mountDrawer(makeTodo())
    emitChange({ source: 'agent', todos: [makeTodo({ title: 'Agent 改过的标题', updatedAt: NOW })] })
    await nextTick()

    await wrapper.find('.foot-btn.is-primary').trigger('click')

    expect(appStore.pendingInputInjection).toEqual({ todo: { id: 't1', title: 'Agent 改过的标题' } })
  })
})

describe('TodoDetailDrawer · 优先级、分组与标签', () => {
  it('点优先级分段直接改写', async () => {
    const wrapper = mountDrawer(makeTodo())
    okUpdate(makeTodo({ priority: 'low', updatedAt: NOW }))

    await wrapper.findAll('.seg-btn')[0].trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', priority: 'low', expectedUpdatedAt: NOW - HOUR })
    expect(wrapper.find('.seg-btn.is-active').text()).toBe(zhCN.todo.priority.low)
  })

  it('分组下拉切到别的分组', async () => {
    const wrapper = mountDrawer(makeTodo(), [makeGroup('g1', '登录改造'), makeGroup('g2', '发布')])
    okUpdate(makeTodo({ groupId: 'g2', updatedAt: NOW }))

    await wrapper.find('.field-select').setValue('g2')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', groupId: 'g2', expectedUpdatedAt: NOW - HOUR })
  })

  it('分组下拉选「未分组」传 null', async () => {
    const wrapper = mountDrawer(makeTodo({ groupId: 'g1' }), [makeGroup('g1', '登录改造')])
    okUpdate(makeTodo({ groupId: undefined, updatedAt: NOW }))

    await wrapper.find('.field-select').setValue('')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', groupId: null, expectedUpdatedAt: NOW - HOUR })
    expect(todoStore.todos[0].groupId).toBeUndefined()
  })

  it('标签输入回车追加，并清掉草稿', async () => {
    const wrapper = mountDrawer(makeTodo({ tags: ['login'] }))
    okUpdate(makeTodo({ tags: ['login', 'ui'], updatedAt: NOW }))

    await wrapper.find('.tag-input').setValue('  ui  ')
    await wrapper.find('.tag-input').trigger('keydown.enter')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', tags: ['login', 'ui'], expectedUpdatedAt: NOW - HOUR })
    expect(inputValue(wrapper, '.tag-input')).toBe('')
    expect(wrapper.findAll('.tag-chip').map(chip => chip.text())).toEqual(['login', 'ui'])
  })

  it('重复标签与空标签都不提交', async () => {
    const wrapper = mountDrawer(makeTodo({ tags: ['login'] }))

    await wrapper.find('.tag-input').setValue('login')
    await wrapper.find('.tag-input').trigger('keydown.enter')
    await wrapper.find('.tag-input').setValue('   ')
    await wrapper.find('.tag-input').trigger('keydown.enter')
    await flushPromises()

    expect(todoApi.update).not.toHaveBeenCalled()
  })

  it('标签数在上限里显示计数，到顶后不再给输入框', () => {
    const tags = Array.from({ length: TODO_TAG_MAX_COUNT }, (_, i) => `tag${i}`)
    const wrapper = mountDrawer(makeTodo({ tags }))

    expect(wrapper.find('.label-count').text()).toBe(`${TODO_TAG_MAX_COUNT}/${TODO_TAG_MAX_COUNT}`)
    expect(wrapper.find('.tag-input').exists()).toBe(false)
  })

  it('点标签上的叉移除它', async () => {
    const wrapper = mountDrawer(makeTodo({ tags: ['login', 'ui'] }))
    okUpdate(makeTodo({ tags: ['ui'], updatedAt: NOW }))

    await wrapper.findAll('.tag-remove')[0].trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', tags: ['ui'], expectedUpdatedAt: NOW - HOUR })
  })
})

describe('TodoDetailDrawer · 计划完成时间', () => {
  it('点「今天」预设落到今天 18:00', async () => {
    const wrapper = mountDrawer(makeTodo())
    const expected = combineDateAndTime(splitDueAt(NOW).date, '18:00')
    okUpdate(makeTodo({ dueAt: expected ?? undefined, updatedAt: NOW }))

    await wrapper.findAll('.preset-chip')[0].trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', dueAt: expected, expectedUpdatedAt: NOW - HOUR })
    expect(wrapper.findAll('.preset-chip')[0].classes()).toContain('is-active')
  })

  it('再点一次已生效的预设即清除计划时间', async () => {
    const today = combineDateAndTime(splitDueAt(NOW).date, '18:00') ?? NOW
    const wrapper = mountDrawer(makeTodo({ dueAt: today }))
    okUpdate(makeTodo({ dueAt: undefined, updatedAt: NOW }))

    expect(wrapper.findAll('.preset-chip')[0].classes()).toContain('is-active')
    await wrapper.findAll('.preset-chip')[0].trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', dueAt: null, expectedUpdatedAt: NOW - HOUR })
    expect(todoStore.todos[0].dueAt).toBeUndefined()
  })

  it('「明天」预设落到明天 18:00', async () => {
    const wrapper = mountDrawer(makeTodo())
    const expected = combineDateAndTime(splitDueAt(NOW + DAY).date, '18:00')
    okUpdate(makeTodo({ dueAt: expected ?? undefined, updatedAt: NOW }))

    await wrapper.findAll('.preset-chip')[1].trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', dueAt: expected, expectedUpdatedAt: NOW - HOUR })
  })

  it('日历里挑日期后按 09:00 落地', async () => {
    const wrapper = mountDrawer(makeTodo())
    const expected = combineDateAndTime('2026-11-20', '09:00')
    okUpdate(makeTodo({ dueAt: expected ?? undefined, updatedAt: NOW }))

    await pickDate(wrapper, '.field .todo-due-field .field-trigger', '2026-11-20')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', dueAt: expected, expectedUpdatedAt: NOW - HOUR })
  })

  it('已有时间时给清除按钮，点一下清空', async () => {
    const wrapper = mountDrawer(makeTodo({ dueAt: NOW + 2 * HOUR }))
    okUpdate(makeTodo({ dueAt: undefined, updatedAt: NOW }))

    await wrapper.find('.field .due-clear').trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', dueAt: null, expectedUpdatedAt: NOW - HOUR })
  })

  it('没设时间时不给清除按钮', () => {
    const wrapper = mountDrawer(makeTodo())

    expect(wrapper.find('.field .due-clear').exists()).toBe(false)
  })
})

describe('TodoDetailDrawer · 提醒', () => {
  it('没选时刻时「添加提醒」是禁用的', () => {
    const wrapper = mountDrawer(makeTodo())

    const button = wrapper.find('.reminder-add .mini-btn')
    expect(button.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.reminder-list').exists()).toBe(false)
  })

  it('挑完时刻再加提醒，整表提交 manual 时刻', async () => {
    const wrapper = mountDrawer(makeTodo())
    const at = combineDateAndTime('2026-11-20', '09:00') ?? NOW
    okUpdate(makeTodo({ reminders: [makeReminder({ id: 'r-new', triggerAt: at })], updatedAt: NOW }))

    await pickDate(wrapper, '.reminder-add .field-trigger', '2026-11-20')
    const button = wrapper.find('.reminder-add .mini-btn')
    expect(button.attributes('disabled')).toBeUndefined()

    await button.trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', reminders: [at], expectedUpdatedAt: NOW - HOUR })
    expect(wrapper.findAll('.reminder-item')).toHaveLength(1)
  })

  it('已有手动提醒时追加，保留原来那条的时刻', async () => {
    const existing = NOW + 3 * HOUR
    const wrapper = mountDrawer(makeTodo({ reminders: [makeReminder({ id: 'r1', triggerAt: existing })] }))
    const at = combineDateAndTime('2026-11-20', '09:00') ?? NOW
    okUpdate(makeTodo({ updatedAt: NOW }))

    await pickDate(wrapper, '.reminder-add .field-trigger', '2026-11-20')
    await wrapper.find('.reminder-add .mini-btn').trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({
      id: 't1',
      reminders: [existing, at],
      expectedUpdatedAt: NOW - HOUR,
    })
  })

  it('跟随计划时间的提醒不给删除按钮，也不参与整表提交', async () => {
    const dueAt = NOW + 2 * HOUR
    const wrapper = mountDrawer(makeTodo({
      dueAt,
      reminders: [
        makeReminder({ id: 'r-due', triggerAt: dueAt, origin: 'due' }),
        makeReminder({ id: 'r-manual', triggerAt: NOW + 5 * HOUR }),
      ],
    }))
    okUpdate(makeTodo({ updatedAt: NOW }))

    const items = wrapper.findAll('.reminder-item')
    expect(items).toHaveLength(2)
    expect(items[0].find('.reminder-origin').text()).toBe(zhCN.todo.detail.reminderFollowsDue)
    expect(items[0].find('.reminder-remove').exists()).toBe(false)
    expect(items[1].find('.reminder-remove').exists()).toBe(true)

    await items[1].find('.reminder-remove').trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', reminders: [], expectedUpdatedAt: NOW - HOUR })
  })

  it('延后过的提醒按延后后的时刻提交与展示', async () => {
    const snoozed = NOW + 6 * HOUR
    const wrapper = mountDrawer(makeTodo({
      reminders: [makeReminder({ id: 'r1', triggerAt: NOW - HOUR, snoozedUntil: snoozed })],
    }))
    okUpdate(makeTodo({ updatedAt: NOW }))

    expect(wrapper.find('.reminder-time').text()).toBe(formatDueShort(snoozed, NOW, 'zh-CN'))

    await wrapper.find('.reminder-remove').trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', reminders: [], expectedUpdatedAt: NOW - HOUR })
  })

  it('追加时保留延后后的时刻，而不是原始触发时刻', async () => {
    const snoozed = NOW + 6 * HOUR
    const wrapper = mountDrawer(makeTodo({
      reminders: [makeReminder({ id: 'r1', triggerAt: NOW - HOUR, snoozedUntil: snoozed })],
    }))
    const at = combineDateAndTime('2026-11-20', '09:00') ?? NOW
    okUpdate(makeTodo({ updatedAt: NOW }))

    await pickDate(wrapper, '.reminder-add .field-trigger', '2026-11-20')
    await wrapper.find('.reminder-add .mini-btn').trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({ id: 't1', reminders: [snoozed, at], expectedUpdatedAt: NOW - HOUR })
  })

  it('提醒按有效时刻升序展示，已确认的标注状态', () => {
    const wrapper = mountDrawer(makeTodo({
      reminders: [
        makeReminder({ id: 'late', triggerAt: NOW + 5 * HOUR }),
        makeReminder({ id: 'early', triggerAt: NOW + HOUR, status: 'acknowledged' }),
      ],
    }))

    const items = wrapper.findAll('.reminder-item')
    expect(items[0].find('.reminder-status').text()).toBe(zhCN.todo.detail.reminderAcknowledged)
    expect(items[0].find('.reminder-icon').classes()).toContain('is-muted')
    expect(items[1].find('.reminder-status').exists()).toBe(false)
  })
})

describe('TodoDetailDrawer · 关联会话', () => {
  it('没有会话时给空态文案', () => {
    const wrapper = mountDrawer(makeTodo())

    expect(wrapper.find('.session-list').exists()).toBe(false)
    expect(wrapper.text()).toContain(zhCN.todo.detail.sessionsEmpty)
  })

  it('会话按最近触达倒序渲染，标题带 id 前缀', () => {
    const wrapper = mountDrawer(makeTodo({
      sessionLinks: [
        { sessionId: 'older-1234567890', firstTouchedAt: NOW - DAY, lastTouchedAt: NOW - 5 * HOUR },
        { sessionId: 'newer-0987654321', firstTouchedAt: NOW - DAY, lastTouchedAt: NOW - HOUR },
      ],
    }))

    const names = wrapper.findAll('.session-name').map(node => node.text())
    expect(names).toEqual([
      zhCN.todo.agent.session.replace('{id}', 'newer-09'),
      zhCN.todo.agent.session.replace('{id}', 'older-12'),
    ])
  })

  it('点还在的会话：关抽屉、切会话、把待办引用推回输入框', async () => {
    chatStore.sessions = [makeSession('sess-1234567890')]
    const wrapper = mountDrawer(makeTodo({
      sessionLinks: [{ sessionId: 'sess-1234567890', firstTouchedAt: NOW - DAY, lastTouchedAt: NOW - HOUR }],
    }))

    await wrapper.find('.session-item').trigger('click')
    await flushPromises()

    expect(todoStore.detailId).toBeNull()
    expect(chatStore.currentSessionId).toBe('sess-1234567890')
    expect(appStore.showTodoManager).toBe(false)
    expect(appStore.pendingInputInjection).toEqual({ todo: { id: 't1', title: '收尾登录改造' } })
  })

  it('会话已不在当前工作区时只提示，不关抽屉也不切会话', async () => {
    const wrapper = mountDrawer(makeTodo({
      sessionLinks: [{ sessionId: 'gone-1234567890', firstTouchedAt: NOW - DAY, lastTouchedAt: NOW - HOUR }],
    }))

    await wrapper.find('.session-item').trigger('click')
    await flushPromises()

    expect(actions.notice).toBe(zhCN.todo.detail.sessionMissing)
    expect(todoStore.detailId).toBe('t1')
    expect(chatStore.currentSessionId).toBeNull()
    expect(appStore.pendingInputInjection).toBeNull()
    expect(wrapper.find('[data-testid="todo-detail"]').exists()).toBe(true)
  })
})

describe('TodoDetailDrawer · 只读来源', () => {
  const readOnlyOrigin = {
    source: 'macos-reminders' as const,
    listId: 'list-ro',
    listTitle: '工作清单',
    externalId: 'ext-1',
    canWrite: false,
  }

  it('只读列表来的待办给出解释横幅与来源锁标', () => {
    const wrapper = mountDrawer(makeTodo({ nativeOrigin: readOnlyOrigin, dueAt: NOW + HOUR }))

    expect(wrapper.find('.readonly-banner').text()).toBe(zhCN.todo.detail.readOnlyHint)
    expect(wrapper.find('.origin-box').text()).toContain(
      zhCN.todo.detail.originList.replace('{name}', '工作清单'),
    )
    expect(wrapper.find('.origin-lock').text()).toBe(zhCN.todo.row.readOnly)
  })

  it('只读时所有写入控件都禁用，编辑入口整体收掉', () => {
    const wrapper = mountDrawer(makeTodo({ nativeOrigin: readOnlyOrigin, dueAt: NOW + HOUR }))

    expect(wrapper.find('.title-input').attributes('readonly')).toBeDefined()
    expect(wrapper.find('.notes-input').attributes('readonly')).toBeDefined()
    expect(wrapper.find('.status-toggle').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('.seg-btn')).toHaveLength(3)
    expect(wrapper.findAll('.seg-btn').every(btn => btn.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.findAll('.preset-chip')).toHaveLength(3)
    expect(wrapper.findAll('.preset-chip').every(btn => btn.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.find('.field-select').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.tag-input').exists()).toBe(false)
    expect(wrapper.find('.tag-remove').exists()).toBe(false)
    expect(wrapper.find('.reminder-add').exists()).toBe(false)
    expect(wrapper.find('.foot-btn.is-danger').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.due-static').exists()).toBe(true)
    expect(wrapper.find('.field .todo-due-field .field-trigger').exists()).toBe(false)
  })

  it('只读待办被强行改标题也不会发请求', async () => {
    const wrapper = mountDrawer(makeTodo({ nativeOrigin: readOnlyOrigin }))

    await wrapper.find('.title-input').setValue('偷偷改一下')
    await wrapper.find('.title-input').trigger('blur')
    vi.advanceTimersByTime(AUTOSAVE_MS * 2)
    await flushPromises()

    expect(todoApi.update).not.toHaveBeenCalled()
    expect(wrapper.find('.save-state').exists()).toBe(false)
  })

  it('只读待办仍然可以引用到输入框', async () => {
    const wrapper = mountDrawer(makeTodo({ nativeOrigin: readOnlyOrigin }))

    await wrapper.find('.foot-btn.is-primary').trigger('click')

    expect(appStore.pendingInputInjection).toEqual({ todo: { id: 't1', title: '收尾登录改造' } })
  })

  it('可写的同步来源不算只读，照常给编辑入口', () => {
    const wrapper = mountDrawer(makeTodo({ nativeOrigin: { ...readOnlyOrigin, canWrite: true } }))

    expect(wrapper.find('.readonly-banner').exists()).toBe(false)
    expect(wrapper.find('.origin-lock').exists()).toBe(false)
    expect(wrapper.find('.title-input').attributes('readonly')).toBeUndefined()
    expect(wrapper.find('.reminder-add').exists()).toBe(true)
    expect(wrapper.find('.foot-btn.is-danger').attributes('disabled')).toBeUndefined()
  })

  it('只读且没设时间时，计划时间显示未设置的静态文本', () => {
    const wrapper = mountDrawer(makeTodo({ nativeOrigin: readOnlyOrigin }))

    expect(wrapper.find('.due-static').text()).toBe(zhCN.todo.detail.noDue)
  })
})