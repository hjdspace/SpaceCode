/**
 * TodoEmptyState 的空状态面：每个视图各自的文案与插画、搜索态的清空入口、
 * 新建抛给宿主、以及「让 Agent 帮我列待办」真的把草稿提示词送进输入框。
 *
 * 只替掉 IPC，store 与 app store 走真实实现。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import { CalendarCheck, CalendarRange, CheckCircle2, Eraser, FolderOpen, Plus, SearchX, Sparkles } from 'lucide-vue-next'
import TodoEmptyState from '@/components/todo/TodoEmptyState.vue'
import { useAppStore } from '@/stores/app'
import { useTodoStore } from '@/stores/todo'
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

/** useAppStore / terminal store 在这条依赖链上会被实例化，给它们读的那几个键一个空实现。 */
const rootApi = vi.hoisted(() => ({
  loadGuiSettings: vi.fn(async () => ({ success: false })),
  saveGuiSettings: vi.fn(async () => ({ success: true })),
  getEnv: vi.fn(async () => null),
  terminal: { onExit: vi.fn(() => () => {}) },
}))

vi.mock('@/services/electronAPI', () => ({ api: { ...rootApi, todo: todoApi } }))

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

let appStore: ReturnType<typeof useAppStore>
let todoStore: ReturnType<typeof useTodoStore>

function mountEmpty() {
  return mount(TodoEmptyState, { global: { plugins: [i18n] }, attachTo: document.body })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())
  appStore = useAppStore()
  todoStore = useTodoStore()
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('TodoEmptyState · 各视图的文案与插画', () => {
  it('全部待办：清爽文案 + 日历插画，两个按钮都在', () => {
    const wrapper = mountEmpty()

    expect(todoStore.view).toBe('all')
    expect(wrapper.find('.empty-orb').classes()).toContain('is-all')
    expect(wrapper.findComponent(CalendarCheck).exists()).toBe(true)
    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.allTitle)
    expect(wrapper.find('.empty-btn.is-primary').text()).toBe(zhCN.todo.empty.cta)
    expect(wrapper.findComponent(Plus).exists()).toBe(true)
    expect(wrapper.findAll('.empty-btn')[1].text()).toBe(zhCN.todo.empty.askAgent)
    expect(wrapper.findComponent(Sparkles).exists()).toBe(true)
  })

  it('今天视图：换成到期文案，orb 带 is-today', async () => {
    todoStore.setView('today')
    const wrapper = mountEmpty()
    await nextTick()

    expect(wrapper.find('.empty-orb').classes()).toContain('is-today')
    expect(wrapper.findComponent(CalendarCheck).exists()).toBe(true)
    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.todayTitle)
    expect(wrapper.find('.empty-body').text()).toBe(zhCN.todo.empty.todayBody)
  })

  it('即将到来视图：7 天文案 + 日历区间插画', () => {
    todoStore.setView('upcoming')
    const wrapper = mountEmpty()

    expect(wrapper.find('.empty-orb').classes()).toContain('is-upcoming')
    expect(wrapper.findComponent(CalendarRange).exists()).toBe(true)
    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.upcomingTitle)
    expect(wrapper.find('.empty-body').text()).toBe(zhCN.todo.empty.upcomingBody)
  })

  it('已完成视图：归档文案 + 勾选插画', () => {
    todoStore.setView('completed')
    const wrapper = mountEmpty()

    expect(wrapper.find('.empty-orb').classes()).toContain('is-completed')
    expect(wrapper.findComponent(CheckCircle2).exists()).toBe(true)
    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.completedTitle)
    expect(wrapper.find('.empty-body').text()).toBe(zhCN.todo.empty.completedBody)
  })

  it('分组视图：空分组文案 + 文件夹插画', () => {
    todoStore.openGroup('g1')
    const wrapper = mountEmpty()

    expect(wrapper.find('.empty-orb').classes()).toContain('is-group')
    expect(wrapper.findComponent(FolderOpen).exists()).toBe(true)
    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.groupTitle)
    expect(wrapper.find('.empty-body').text()).toBe(zhCN.todo.empty.groupBody)
  })

  it('挂载后切换视图，文案与插画跟着换', async () => {
    const wrapper = mountEmpty()
    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.allTitle)

    todoStore.setView('completed')
    await nextTick()

    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.completedTitle)
    expect(wrapper.findComponent(CheckCircle2).exists()).toBe(true)
    expect(wrapper.findComponent(CalendarCheck).exists()).toBe(false)
    expect(wrapper.find('.empty-orb').classes()).toContain('is-completed')
    expect(wrapper.find('.empty-orb').classes()).not.toContain('is-all')
  })

  /**
   * 文案里的 @ 必须写成 {'@'}：裸 @ 会被 vue-i18n 当链接消息语法，
   * 每次渲染都编译失败并刷 console.error，只是靠原文兜底才肉眼看不出来。
   */
  it('全部待办空状态正文渲染出 @，且不触发 vue-i18n 编译错误', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    const wrapper = mountEmpty()
    const compileErrors = error.mock.calls
      .map(args => String(args[0]))
      .filter(text => text.includes('Message compilation error'))

    expect(compileErrors).toEqual([])
    expect(wrapper.find('.empty-body').text()).toBe(zhCN.todo.empty.allBody.replace("{'@'}", '@'))
    expect(wrapper.find('.empty-body').text()).toContain('@')
  })
})

describe('TodoEmptyState · 搜索态', () => {
  it('有搜索词时换成搜索文案与放大镜插画，只留清空搜索按钮', () => {
    todoStore.search = '登录'
    const wrapper = mountEmpty()

    expect(wrapper.findComponent(SearchX).exists()).toBe(true)
    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.searchTitle)
    expect(wrapper.find('.empty-body').text()).toBe(zhCN.todo.empty.searchBody)
    expect(wrapper.findAll('.empty-btn')).toHaveLength(1)
    expect(wrapper.find('.empty-btn').text()).toBe(zhCN.todo.empty.clearSearch)
    expect(wrapper.findComponent(Eraser).exists()).toBe(true)
    expect(wrapper.find('.empty-btn.is-primary').exists()).toBe(false)
  })

  /** orb 跟的是算出文案的 key，搜索态必须换成自己的灰化 orb，不能留着视图的彩色。 */
  it('搜索态的 orb 换成 is-search，不再挂视图类名', () => {
    todoStore.setView('today')
    todoStore.search = '登录'
    const wrapper = mountEmpty()

    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.searchTitle)
    expect(wrapper.findComponent(SearchX).exists()).toBe(true)
    expect(wrapper.find('.empty-orb').classes()).toEqual(['empty-orb', 'is-search'])
  })

  it('清空搜索后 orb 回到视图本身的类名', async () => {
    todoStore.setView('upcoming')
    todoStore.search = '登录'
    const wrapper = mountEmpty()

    await wrapper.find('.empty-btn').trigger('click')

    expect(wrapper.find('.empty-orb').classes()).toContain('is-upcoming')
  })

  it('点清空搜索把 store.search 置空，回到当前视图的文案与新建按钮', async () => {
    todoStore.setView('upcoming')
    todoStore.search = '登录'
    const wrapper = mountEmpty()

    await wrapper.find('.empty-btn').trigger('click')

    expect(todoStore.search).toBe('')
    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.upcomingTitle)
    expect(wrapper.find('.empty-btn.is-primary').text()).toBe(zhCN.todo.empty.cta)
    expect(wrapper.findComponent(CalendarRange).exists()).toBe(true)
  })

  it('只有空格的搜索词不算搜索态', () => {
    todoStore.search = '   '
    const wrapper = mountEmpty()

    expect(wrapper.find('.empty-title').text()).toBe(zhCN.todo.empty.allTitle)
    expect(wrapper.find('.empty-btn.is-primary').exists()).toBe(true)
    expect(wrapper.findComponent(SearchX).exists()).toBe(false)
  })
})

describe('TodoEmptyState · 两个出口', () => {
  it('点新建把 create 抛给宿主，自己不动 store', async () => {
    const wrapper = mountEmpty()

    await wrapper.find('.empty-btn.is-primary').trigger('click')
    await wrapper.find('.empty-btn.is-primary').trigger('click')

    expect(wrapper.emitted('create')).toHaveLength(2)
    expect(todoStore.view).toBe('all')
    expect(appStore.pendingInputInjection).toBeNull()
  })

  it('让 Agent 帮我列待办：关掉面板、回到 chat、替换式注入草稿提示词', async () => {
    appStore.showTodoManager = true
    appStore.activeCenterTab = 'terminal-1'
    appStore.pushToInput({ text: '原来打的字' })
    const wrapper = mountEmpty()

    await wrapper.findAll('.empty-btn')[1].trigger('click')

    expect(appStore.showTodoManager).toBe(false)
    expect(appStore.activeCenterTab).toBe('chat')
    expect(appStore.pendingInputInjection).toEqual({ text: zhCN.todo.agent.draftPrompt, replace: true })
    expect(wrapper.emitted('create')).toBeUndefined()
  })
})