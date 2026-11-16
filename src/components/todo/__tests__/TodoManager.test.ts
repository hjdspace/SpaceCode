/**
 * 待办工作台外壳：头部统计、搜索/排序、快速新建 → 详情、错误条、撤销条、
 * 同步与 Agent 浮层、窄栏浮层布局。
 *
 * 挂真实组件树（导航栏 / 提醒栏 / 列表 / 行 / 详情抽屉 / 同步面板 / Agent 浮层都是真的），
 * 走真实 store，只把 IPC 与 jsdom 缺失的 ResizeObserver 替掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, nextTick } from 'vue'
import type {
  ActiveTodoReminder,
  Todo,
  TodoAgentOperation,
  TodoChangePayload,
  TodoGroup,
  TodoSyncConflict,
  TodoSyncState,
} from '@/shared/channels/todo'

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
 * 详情抽屉会拉起 chatSession → settings，settings 建 store 时立刻读一次配置。
 * 这几个扁平方法不给就会变成 unhandled rejection，与待办逻辑无关。
 */
const hostApi = vi.hoisted(() => ({
  loadGuiSettings: vi.fn(),
  saveGuiSettings: vi.fn(),
  getEnv: vi.fn(),
  terminal: { onExit: vi.fn() },
}))

vi.mock('@/services/electronAPI', () => ({ api: { ...hostApi, todo: todoApi } }))

import TodoManager from '../TodoManager.vue'
import { useAppStore } from '@/stores/app'
import { useTodoStore } from '@/stores/todo'
import { useTodoActions } from '@/composables/useTodoActions'
import { TODO_LIST_LIMIT_MAX } from '@/shared/channels/todo'
import zhCN from '@/i18n/locales/zh-CN'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

/** 本地时间 10:00，今天/逾期/明天的边界都以此为锚。 */
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

function makeSyncState(overrides: Partial<TodoSyncState> = {}): TodoSyncState {
  return {
    supported: true,
    permission: 'granted',
    config: { enabled: true, listId: 'list-1' },
    lists: [{ id: 'list-1', title: 'Reminders', writable: true }],
    conflicts: [],
    syncing: false,
    ...overrides,
  }
}

function makeConflict(id: string): TodoSyncConflict {
  return {
    id,
    todoId: `t-${id}`,
    todoTitle: `本地 ${id}`,
    nativeTitle: `系统 ${id}`,
    kind: 'changed',
    localUpdatedAt: NOW - HOUR,
    detectedAt: NOW - HOUR,
  }
}

function makeOperation(todoId: string, title: string): TodoAgentOperation {
  return { sessionId: 'session-abcdefgh', action: 'updated', todoId, title }
}

type Listener<T> = (payload: T) => void

/** jsdom 没有 ResizeObserver；记下回调，测试自己喂宽度。 */
type ResizeCallback = (entries: ResizeObserverEntry[]) => void
const resizeCallbacks: ResizeCallback[] = []
const observerInstances: Array<{ disconnect: ReturnType<typeof vi.fn> }> = []

class ResizeObserverStub {
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  constructor(callback: ResizeCallback) {
    resizeCallbacks.push(callback)
    observerInstances.push(this)
  }
}

/** useTodoActions 的 notice 是模块作用域，useI18n 只能在 setup 里调用。 */
const NoticeProbe = defineComponent({
  setup() {
    return useTodoActions()
  },
  render: () => null,
})

let appStore: ReturnType<typeof useAppStore>
let todoStore: ReturnType<typeof useTodoStore>
let actions: ReturnType<typeof mountNoticeProbe>['vm']

function mountNoticeProbe() {
  return mount(NoticeProbe, { global: { plugins: [i18n] } })
}

function mountManager() {
  return mount(TodoManager, { global: { plugins: [i18n] }, attachTo: document.body })
}

/** 挂载即 load()，所以种子数据从 api.todo.list 走真实读取路径。 */
async function mountWith(todos: Todo[], groups: TodoGroup[] = []) {
  todoApi.list.mockResolvedValue(todos)
  todoApi.listGroups.mockResolvedValue(groups)
  const wrapper = mountManager()
  await flushPromises()
  return wrapper
}

function rowIds(wrapper: { findAll: (selector: string) => Array<{ attributes: (name: string) => string | undefined }> }) {
  return wrapper.findAll('.todo-row').map(row => row.attributes('data-todo-id'))
}

async function resizeTo(width: number): Promise<void> {
  for (const callback of resizeCallbacks) {
    callback([{ contentRect: { width } }] as unknown as ResizeObserverEntry[])
  }
  await nextTick()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  localStorage.clear()
  resizeCallbacks.length = 0
  observerInstances.length = 0
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  setActivePinia(createPinia())

  todoApi.list.mockResolvedValue([])
  todoApi.listGroups.mockResolvedValue([])
  todoApi.listActiveReminders.mockResolvedValue([])
  todoApi.getSyncState.mockResolvedValue(makeSyncState({ supported: false, permission: 'unsupported', config: { enabled: false, listId: null }, lists: [] }))
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
  todoApi.onChanged.mockImplementation((_cb: Listener<TodoChangePayload>) => vi.fn())
  todoApi.onAgentOperation.mockImplementation((_cb: Listener<TodoAgentOperation>) => vi.fn())
  todoApi.onReminderDue.mockImplementation((_cb: Listener<ActiveTodoReminder[]>) => vi.fn())
  todoApi.onSyncStateChanged.mockImplementation((_cb: Listener<TodoSyncState>) => vi.fn())
  hostApi.loadGuiSettings.mockResolvedValue({ success: false })
  hostApi.saveGuiSettings.mockResolvedValue({ success: true })
  hostApi.getEnv.mockResolvedValue('')
  hostApi.terminal.onExit.mockReturnValue(vi.fn())

  appStore = useAppStore()
  todoStore = useTodoStore()
  actions = mountNoticeProbe().vm
  actions.dismissNotice()
})

afterEach(() => {
  todoStore.unsubscribe()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('TodoManager · 挂载与头部统计', () => {
  it('挂载即读一次待办，并把读到的行渲染出来', async () => {
    const wrapper = await mountWith([
      makeTodo({ id: 't1', title: '收尾登录改造' }),
      makeTodo({ id: 't2', title: '整理发布清单' }),
    ])

    expect(todoApi.list).toHaveBeenCalledWith({ limit: TODO_LIST_LIMIT_MAX })
    expect(todoApi.listGroups).toHaveBeenCalledTimes(1)
    expect(todoApi.listActiveReminders).toHaveBeenCalledTimes(1)
    expect(todoApi.getSyncState).toHaveBeenCalledTimes(1)
    expect(todoStore.loaded).toBe(true)
    expect(wrapper.findAll('.todo-row')).toHaveLength(2)
    expect(wrapper.find('.todo-row[data-todo-id="t1"] .row-title').text()).toBe('收尾登录改造')
  })

  it('四个广播订阅只接一次，重复 load 不叠加监听', async () => {
    await mountWith([makeTodo({ id: 't1' })])
    await todoStore.load()
    await flushPromises()

    expect(todoApi.onChanged).toHaveBeenCalledTimes(1)
    expect(todoApi.onAgentOperation).toHaveBeenCalledTimes(1)
    expect(todoApi.onReminderDue).toHaveBeenCalledTimes(1)
    expect(todoApi.onSyncStateChanged).toHaveBeenCalledTimes(1)
  })

  it('头部三个统计 chip 跟着 counts 走，有逾期才多一个红色 chip', async () => {
    const wrapper = await mountWith([
      makeTodo({ id: 't1', dueAt: NOW - 2 * HOUR }),
      makeTodo({ id: 't2', dueAt: NOW + 2 * HOUR }),
      makeTodo({ id: 't3' }),
      makeTodo({ id: 't4', status: 'completed', completedAt: NOW - HOUR }),
    ])

    expect(todoStore.counts.all).toBe(3)
    const chips = wrapper.findAll('.heading-stats .stat-chip')
    expect(chips.map(chip => chip.text())).toEqual([
      zhCN.todo.stats.open.replace('{n}', '3'),
      zhCN.todo.stats.today.replace('{n}', '2'),
      zhCN.todo.stats.overdue.replace('{n}', '1'),
      zhCN.todo.stats.completed.replace('{n}', '1'),
    ])
    expect(wrapper.find('.heading-stats .stat-chip.is-alert').exists()).toBe(true)
  })

  it('没有逾期时不渲染逾期 chip', async () => {
    const wrapper = await mountWith([
      makeTodo({ id: 't1', dueAt: NOW + 2 * HOUR }),
      makeTodo({ id: 't2', status: 'completed' }),
    ])

    expect(todoStore.overdueCount).toBe(0)
    expect(wrapper.find('.heading-stats .stat-chip.is-alert').exists()).toBe(false)
    expect(wrapper.findAll('.heading-stats .stat-chip')).toHaveLength(3)
  })

  it('点返回按钮关掉待办工作台', async () => {
    const wrapper = await mountWith([])
    appStore.showTodoManager = true

    await wrapper.find('.back-btn').trigger('click')

    expect(appStore.showTodoManager).toBe(false)
  })
})

describe('TodoManager · 搜索与排序', () => {
  const seeds = [
    makeTodo({ id: 't1', title: '收尾登录改造', orderIndex: 0 }),
    makeTodo({ id: 't2', title: '整理发布清单', notes: '把 changelog 补齐', tags: ['release'], orderIndex: 1 }),
  ]

  it('搜索框写进 store.search，并按标题过滤可见行', async () => {
    const wrapper = await mountWith(seeds)

    await wrapper.find('.search-input').setValue('登录')

    expect(todoStore.search).toBe('登录')
    expect(rowIds(wrapper)).toEqual(['t1'])
  })

  it('搜索也命中备注与标签', async () => {
    const wrapper = await mountWith(seeds)

    await wrapper.find('.search-input').setValue('changelog')
    expect(rowIds(wrapper)).toEqual(['t2'])

    await wrapper.find('.search-input').setValue('RELEASE')
    expect(rowIds(wrapper)).toEqual(['t2'])
  })

  it('清空按钮把搜索复位，行全部回来', async () => {
    const wrapper = await mountWith(seeds)
    await wrapper.find('.search-input').setValue('登录')
    expect(wrapper.find('.search-clear').exists()).toBe(true)

    await wrapper.find('.search-clear').trigger('click')

    expect(todoStore.search).toBe('')
    expect(wrapper.find('.search-clear').exists()).toBe(false)
    expect(rowIds(wrapper)).toEqual(['t1', 't2'])
  })

  it('搜索无命中时列表给出搜索空态，空态里的清空按钮同样复位', async () => {
    const wrapper = await mountWith(seeds)

    await wrapper.find('.search-input').setValue('不存在的关键词')

    expect(wrapper.findAll('.todo-row')).toHaveLength(0)
    expect(wrapper.find('.todo-empty .empty-title').text()).toBe(zhCN.todo.empty.searchTitle)

    await wrapper.find('.todo-empty .empty-btn').trigger('click')

    expect(todoStore.search).toBe('')
    expect(rowIds(wrapper)).toEqual(['t1', 't2'])
  })

  it('排序下拉写进 store.sortMode 并重排行序', async () => {
    const wrapper = await mountWith([
      makeTodo({ id: 'z', title: 'Zebra 收尾' }),
      makeTodo({ id: 'a', title: 'Alpha 登录' }),
    ])
    expect(rowIds(wrapper)).toEqual(['z', 'a'])

    await wrapper.find('.sort-select').setValue('title')

    expect(todoStore.sortMode).toBe('title')
    expect(rowIds(wrapper)).toEqual(['a', 'z'])
  })

  it('切到手动排序时列表提示可拖动', async () => {
    const wrapper = await mountWith(seeds)
    expect(wrapper.find('.toolbar-hint').exists()).toBe(false)

    await wrapper.find('.sort-select').setValue('manual')

    expect(todoStore.sortMode).toBe('manual')
    expect(wrapper.find('.toolbar-hint').text()).toContain(zhCN.todo.row.drag)
  })

  it('下拉选项覆盖六种排序口径', async () => {
    const wrapper = await mountWith(seeds)

    const options = wrapper.findAll('.sort-select option')
    expect(options.map(option => option.attributes('value'))).toEqual([
      'smart', 'manual', 'due', 'priority', 'created', 'title',
    ])
    expect(options[0].text()).toBe(zhCN.todo.sort.smart)
  })
})

describe('TodoManager · 快速新建与详情抽屉', () => {
  it('空态正文里的 @ 走转义写法，渲染出 @ 且不报 vue-i18n 编译错误', async () => {
    const warned: string[] = []
    const collect = (...args: unknown[]) => { warned.push(args.map(String).join(' ')) }
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(collect)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(collect)

    const wrapper = await mountWith([])

    expect(wrapper.find('.todo-empty .empty-body').text()).toBe(zhCN.todo.empty.allBody.replace("{'@'}", '@'))
    expect(warned.filter(line => line.includes('Message compilation error'))).toEqual([])

    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('点「新建待办」把焦点送进快速新建输入框', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    const input = wrapper.find('.quick-add-input').element as HTMLInputElement

    await wrapper.find('.create-btn').trigger('click')
    await nextTick()

    expect(document.activeElement).toBe(input)
  })

  it('空态的主按钮同样聚焦快速新建', async () => {
    const wrapper = await mountWith([])
    const input = wrapper.find('.quick-add-input').element as HTMLInputElement

    await wrapper.find('.todo-empty .empty-btn.is-primary').trigger('click')
    await nextTick()

    expect(document.activeElement).toBe(input)
  })

  it('回车新建后自动打开这条的详情抽屉，关掉抽屉即卸载', async () => {
    const created = makeTodo({ id: 'new-1', title: '写回归用例' })
    todoApi.create.mockResolvedValue({ ok: true, todo: created })
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    expect(wrapper.find('[data-testid="todo-detail"]').exists()).toBe(false)

    await wrapper.find('.quick-add-input').setValue('写回归用例')
    await wrapper.find('.quick-add-input').trigger('keydown.enter')
    await flushPromises()

    expect(todoApi.create).toHaveBeenCalledWith(expect.objectContaining({ title: '写回归用例' }))
    expect(todoStore.detailId).toBe('new-1')
    const drawer = wrapper.find('[data-testid="todo-detail"]')
    expect(drawer.exists()).toBe(true)
    expect(drawer.find('.title-input').element).toHaveProperty('value', '写回归用例')
    expect(wrapper.find('.quick-add-input').element).toHaveProperty('value', '')

    await drawer.find('.detail-head .icon-btn').trigger('click')

    expect(todoStore.detailId).toBeNull()
    expect(wrapper.find('[data-testid="todo-detail"]').exists()).toBe(false)
  })

  it('点行正文打开对应详情，切换待办时抽屉跟着换内容', async () => {
    const wrapper = await mountWith([
      makeTodo({ id: 't1', title: '收尾登录改造' }),
      makeTodo({ id: 't2', title: '整理发布清单' }),
    ])

    await wrapper.find('.todo-row[data-todo-id="t1"] .row-body').trigger('click')
    expect(wrapper.find('[data-testid="todo-detail"] .title-input').element).toHaveProperty('value', '收尾登录改造')

    await wrapper.find('.todo-row[data-todo-id="t2"] .row-body').trigger('click')
    expect(todoStore.detailId).toBe('t2')
    expect(wrapper.find('[data-testid="todo-detail"] .title-input').element).toHaveProperty('value', '整理发布清单')
  })
})

describe('TodoManager · 错误条', () => {
  it('读取失败渲染错误条，重试按钮再拉一次并恢复列表', async () => {
    todoApi.list.mockRejectedValueOnce(new Error('ipc down'))
    const wrapper = mountManager()
    await flushPromises()

    expect(todoStore.error).toBe('load-failed')
    const banner = wrapper.find('.error-banner')
    expect(banner.attributes('role')).toBe('alert')
    expect(banner.find('.error-text').text()).toBe(zhCN.todo.error['load-failed'])
    expect(banner.find('.error-retry').exists()).toBe(true)

    todoApi.list.mockResolvedValue([makeTodo({ id: 't1', title: '收尾登录改造' })])
    await banner.find('.error-retry').trigger('click')
    await flushPromises()

    expect(todoApi.list).toHaveBeenCalledTimes(2)
    expect(todoStore.error).toBeNull()
    expect(wrapper.find('.error-banner').exists()).toBe(false)
    expect(rowIds(wrapper)).toEqual(['t1'])
  })

  it('非读取类错误只给关闭按钮，不给重试', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])

    todoStore.error = 'read-only'
    await nextTick()

    expect(wrapper.find('.error-banner .error-text').text()).toBe(zhCN.todo.error['read-only'])
    expect(wrapper.find('.error-retry').exists()).toBe(false)
  })

  it('关闭按钮清掉 store.error 与错误条', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    todoStore.error = 'conflict'
    await nextTick()

    await wrapper.find('.error-close').trigger('click')

    expect(todoStore.error).toBeNull()
    expect(wrapper.find('.error-banner').exists()).toBe(false)
  })
})

describe('TodoManager · 撤销条与成功提示', () => {
  it('删除后出现撤销条，点撤销走 restore 并把行放回来', async () => {
    const removed = makeTodo({ id: 't1', title: '收尾登录改造' })
    const wrapper = await mountWith([removed, makeTodo({ id: 't2' })])
    todoApi.remove.mockResolvedValue({ ok: true, removed })
    todoApi.restore.mockResolvedValue({ ok: true, todo: removed })

    await todoStore.removeTodo('t1')
    await nextTick()

    const bar = wrapper.find('.notice-bar.is-undo')
    expect(bar.exists()).toBe(true)
    expect(bar.find('.notice-text').text()).toBe(zhCN.todo.undo.removed.replace('{n}', '1'))
    expect(rowIds(wrapper)).toEqual(['t2'])

    await bar.find('.notice-action').trigger('click')
    await flushPromises()

    expect(todoApi.restore).toHaveBeenCalledWith(removed)
    expect(todoStore.undoBatch).toBeNull()
    expect(wrapper.find('.notice-bar.is-undo').exists()).toBe(false)
    expect(rowIds(wrapper)).toContain('t1')
  })

  it('撤销条的关闭按钮只丢批次，不把行放回来', async () => {
    const removed = makeTodo({ id: 't1' })
    const wrapper = await mountWith([removed, makeTodo({ id: 't2' })])
    todoApi.remove.mockResolvedValue({ ok: true, removed })

    await todoStore.removeTodo('t1')
    await nextTick()
    await wrapper.find('.notice-bar.is-undo .notice-close').trigger('click')

    expect(todoStore.undoBatch).toBeNull()
    expect(wrapper.find('.notice-bar.is-undo').exists()).toBe(false)
    expect(rowIds(wrapper)).toEqual(['t2'])
    expect(todoApi.restore).not.toHaveBeenCalled()
  })

  it('撤销窗口到点后撤销条自己消失', async () => {
    const removed = makeTodo({ id: 't1' })
    const wrapper = await mountWith([removed])
    todoApi.remove.mockResolvedValue({ ok: true, removed })

    await todoStore.removeTodo('t1')
    await nextTick()
    expect(wrapper.find('.notice-bar.is-undo').exists()).toBe(true)

    vi.advanceTimersByTime(10_000)
    await nextTick()

    expect(todoStore.undoBatch).toBeNull()
    expect(wrapper.find('.notice-bar.is-undo').exists()).toBe(false)
  })

  it('共享成功提示渲染在提示区，点关闭即消失', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])

    actions.notify('已同步到提醒事项')
    await nextTick()

    const bar = wrapper.find('.notice-bar.is-success')
    expect(bar.exists()).toBe(true)
    expect(bar.find('.notice-text').text()).toBe('已同步到提醒事项')

    await bar.find('.notice-close').trigger('click')

    expect(actions.notice).toBeNull()
    expect(wrapper.find('.notice-bar.is-success').exists()).toBe(false)
  })

  it('快速新建成功后弹出的是成功提示，不是错误条', async () => {
    todoApi.create.mockResolvedValue({ ok: true, todo: makeTodo({ id: 'new-1', title: '写回归用例' }) })
    const wrapper = await mountWith([])

    await wrapper.find('.quick-add-input').setValue('写回归用例')
    await wrapper.find('.quick-add-input').trigger('keydown.enter')
    await flushPromises()

    expect(wrapper.find('.notice-bar.is-success .notice-text').text()).toBe(
      zhCN.todo.quickAdd.created.replace('{title}', '写回归用例'),
    )
    expect(wrapper.find('.error-banner').exists()).toBe(false)
  })
})

describe('TodoManager · 同步入口', () => {
  const syncLabel = zhCN.todo.sync.title

  it('有冲突时同步按钮带红色角标与冲突标题', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])

    todoStore.syncState = makeSyncState({ conflicts: [makeConflict('c1'), makeConflict('c2')] })
    await nextTick()

    const button = wrapper.find(`.manager-tools .tool-btn[aria-label="${syncLabel}"]`)
    expect(button.classes()).toContain('has-conflict')
    expect(button.find('.tool-badge.is-alert').text()).toBe('2')
    expect(button.attributes('title')).toBe(zhCN.todo.sync.badgeConflict.replace('{n}', '2'))
    expect(button.find('.tool-dot').exists()).toBe(false)
  })

  it('无冲突但已开启同步时只给绿点', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    todoStore.syncState = makeSyncState()
    await nextTick()

    const button = wrapper.find(`.manager-tools .tool-btn[aria-label="${syncLabel}"]`)
    expect(button.find('.tool-badge').exists()).toBe(false)
    expect(button.find('.tool-dot').exists()).toBe(true)
    expect(button.attributes('title')).toBe(zhCN.todo.sync.badgeOn)
  })

  it('未开启同步时既没有角标也没有绿点', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])

    const button = wrapper.find(`.manager-tools .tool-btn[aria-label="${syncLabel}"]`)
    expect(button.find('.tool-badge').exists()).toBe(false)
    expect(button.find('.tool-dot').exists()).toBe(false)
    expect(button.attributes('title')).toBe(zhCN.todo.sync.badgeOff)
  })

  it('点同步按钮打开同步面板并列出冲突，关闭按钮收回面板', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    todoStore.syncState = makeSyncState({ conflicts: [makeConflict('c1')] })
    await nextTick()
    expect(document.querySelector('.sync-overlay')).toBeNull()

    await wrapper.find(`.manager-tools .tool-btn[aria-label="${syncLabel}"]`).trigger('click')
    await flushPromises()

    const overlay = document.querySelector('.sync-overlay')
    expect(overlay).not.toBeNull()
    expect(document.querySelectorAll('.conflict-card')).toHaveLength(1)
    expect(document.querySelector('.conflict-count')?.textContent).toBe('1')

    ;(document.querySelector('.sync-close') as HTMLButtonElement).click()
    await flushPromises()

    expect(document.querySelector('.sync-overlay')).toBeNull()
  })

  it('同步中时同步图标转起来', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    todoStore.syncState = makeSyncState({ syncing: true })
    await nextTick()

    const button = wrapper.find(`.manager-tools .tool-btn[aria-label="${syncLabel}"]`)
    expect(button.find('svg').classes()).toContain('spin')
  })
})

describe('TodoManager · Agent 动态入口', () => {
  const agentLabel = zhCN.todo.agent.title

  it('Agent 按钮角标等于动态条数', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1', title: '收尾登录改造' })])
    const button = wrapper.find(`.manager-tools .tool-btn[aria-label="${agentLabel}"]`)
    expect(button.find('.tool-badge').exists()).toBe(false)

    todoStore.agentActivity = [makeOperation('t1', '收尾登录改造'), makeOperation('gone', '已删掉的事')]
    await nextTick()

    expect(button.find('.tool-badge').text()).toBe('2')
  })

  it('点 Agent 按钮打开动态浮层，存在的待办可点回详情', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1', title: '收尾登录改造' })])
    todoStore.agentActivity = [makeOperation('t1', '收尾登录改造'), makeOperation('gone', '已删掉的事')]
    await nextTick()

    await wrapper.find(`.manager-tools .tool-btn[aria-label="${agentLabel}"]`).trigger('click')
    await flushPromises()

    const panel = document.querySelector('[data-testid="todo-agent-activity"]')
    expect(panel).not.toBeNull()
    expect(panel?.querySelectorAll('.activity-item')).toHaveLength(2)
    expect(panel?.querySelector('.item-title.is-gone')?.textContent).toBe('已删掉的事')

    ;(panel?.querySelector('.item-title:not(.is-gone)') as HTMLButtonElement).click()
    await flushPromises()

    expect(todoStore.detailId).toBe('t1')
    expect(document.querySelector('[data-testid="todo-agent-activity"]')).toBeNull()
    expect(wrapper.find(`.manager-tools .tool-btn[aria-label="${agentLabel}"]`).classes()).not.toContain('is-active')
  })

  it('没有动态时浮层给空态文案', async () => {
    const wrapper = await mountWith([])

    await wrapper.find(`.manager-tools .tool-btn[aria-label="${agentLabel}"]`).trigger('click')
    await flushPromises()

    expect(document.querySelector('.activity-empty .empty-title')?.textContent).toBe(zhCN.todo.agent.empty)
  })
})

describe('TodoManager · 到点提醒栏', () => {
  it('有到点提醒时渲染提醒栏，点标题打开那条待办', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1', title: '收尾登录改造' })])
    expect(wrapper.find('[data-testid="todo-reminder-rail"]').exists()).toBe(false)

    todoStore.activeReminders = [
      { id: 'r1', todoId: 't1', todoTitle: '收尾登录改造', priority: 'high', triggerAt: NOW - 60_000 },
    ]
    await nextTick()

    const rail = wrapper.find('[data-testid="todo-reminder-rail"]')
    expect(rail.exists()).toBe(true)
    expect(rail.find('.rail-count').text()).toBe(zhCN.todo.reminder.count.replace('{n}', '1'))

    await rail.find('.card-title').trigger('click')

    expect(todoStore.detailId).toBe('t1')
  })
})

describe('TodoManager · 窄栏浮层布局', () => {
  it('宽度低于 900 时切窄栏：导航收起成浮层，遮罩可点开点关', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    expect(wrapper.classes()).not.toContain('is-narrow')
    expect(wrapper.find('.manager-rail').isVisible()).toBe(true)

    await resizeTo(880)

    expect(wrapper.classes()).toContain('is-narrow')
    expect(wrapper.find('.manager-rail').isVisible()).toBe(false)
    expect(wrapper.find('.rail-scrim').exists()).toBe(false)

    await wrapper.find('.nav-toggle').trigger('click')

    expect(wrapper.find('.manager-rail').isVisible()).toBe(true)
    expect(wrapper.find('.manager-rail').classes()).toContain('is-overlay')
    expect(wrapper.find('.rail-scrim').exists()).toBe(true)

    await wrapper.find('.rail-scrim').trigger('click')

    expect(wrapper.find('.manager-rail').isVisible()).toBe(false)
    expect(wrapper.find('.rail-scrim').exists()).toBe(false)
  })

  it('窄栏下详情抽屉也变成浮层', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    await resizeTo(700)

    todoStore.openDetail('t1')
    await nextTick()

    expect(wrapper.find('.manager-detail').classes()).toContain('is-overlay')
  })

  it('宽度回到 900 以上时恢复宽栏，导航常驻且没有遮罩', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    await resizeTo(700)
    expect(wrapper.classes()).toContain('is-narrow')

    await resizeTo(1200)

    expect(wrapper.classes()).not.toContain('is-narrow')
    expect(wrapper.find('.manager-rail').isVisible()).toBe(true)
    expect(wrapper.find('.manager-rail').classes()).not.toContain('is-overlay')
    expect(wrapper.find('.rail-scrim').exists()).toBe(false)
  })

  it('同一宽度重复回调不反复翻转导航开合', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    await resizeTo(700)
    await wrapper.find('.nav-toggle').trigger('click')
    expect(wrapper.find('.manager-rail').isVisible()).toBe(true)

    await resizeTo(720)

    expect(wrapper.find('.manager-rail').isVisible()).toBe(true)
    expect(wrapper.find('.rail-scrim').exists()).toBe(true)
  })

  it('卸载时断开 ResizeObserver', async () => {
    const wrapper = await mountWith([makeTodo({ id: 't1' })])
    expect(observerInstances).toHaveLength(1)
    expect(observerInstances[0].disconnect).not.toHaveBeenCalled()

    wrapper.unmount()

    expect(observerInstances[0].disconnect).toHaveBeenCalledTimes(1)
  })
})