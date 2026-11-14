/**
 * TodoQuickAdd 组件测试 — 快速新建的整条链路：闸门 → payload → 成功/失败收尾。
 * 真 store、真 i18n、真 TodoDueField，只有 IPC 是假的。
 * useTodoActions 的 notice 在模块作用域，用探针组件读（它的 useI18n 只能在 setup 里调）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent, nextTick } from 'vue'
import type { CreateTodoInput, Todo, TodoGroup, TodoMutation } from '@/shared/channels/todo'

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
 * useTodoActions → app store 会把 settings / terminal store 一起拉起来：前者构造时
 * 就读写 gui-settings.json 与几个环境变量，后者构造时挂 pty 退出监听。这几个 api
 * 也得给替身，否则每次挂载都甩 unhandled rejection 与一屏 warn。
 */
const hostApi = vi.hoisted(() => ({
  loadGuiSettings: vi.fn(),
  saveGuiSettings: vi.fn(),
  getEnv: vi.fn(),
  terminal: { onExit: vi.fn() },
}))

vi.mock('@/services/electronAPI', () => ({ api: { todo: todoApi, ...hostApi } }))

import TodoQuickAdd from '@/components/todo/TodoQuickAdd.vue'
import TodoDueField from '@/components/todo/TodoDueField.vue'
import { useTodoStore } from '@/stores/todo'
import { useTodoActions } from '@/composables/useTodoActions'
import zhCN from '@/i18n/locales/zh-CN'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

/** 本地 2026-11-14（周六）10:00 —— 三个预设分别是 14/15/21 日的 18:00。 */
const NOW = new Date(2026, 10, 14, 10, 0, 0, 0).getTime()
const HOUR = 3600_000
const TODAY_1800 = new Date(2026, 10, 14, 18, 0, 0, 0).getTime()
const TOMORROW_1800 = new Date(2026, 10, 15, 18, 0, 0, 0).getTime()
const NEXT_WEEK_1800 = new Date(2026, 10, 21, 18, 0, 0, 0).getTime()

const GROUPS: TodoGroup[] = [
  { id: 'g1', name: '工作', color: 'teal', orderIndex: 0, createdAt: NOW - 24 * HOUR },
  { id: 'g2', name: '生活', color: 'amber', orderIndex: 1, createdAt: NOW - 24 * HOUR },
]

function serverTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'server-1',
    title: '收尾登录改造',
    status: 'open',
    priority: 'medium',
    tags: [],
    reminders: [],
    sessionLinks: [],
    orderIndex: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

const NoticeProbe = defineComponent({
  setup() {
    const { notice, dismissNotice } = useTodoActions()
    return { notice, dismissNotice }
  },
  render: () => null,
})

let todoStore: ReturnType<typeof useTodoStore>
/** useTodoActions 的 notice 在模块作用域，探针组件是唯一能在 setup 里拿到它的入口。 */
let notice: ReturnType<typeof mountProbe>['vm']
const mounted: { unmount: () => void }[] = []

function mountProbe() {
  return mount(NoticeProbe, { global: { plugins: [i18n] } })
}

function mountQuickAdd() {
  const wrapper = mount(TodoQuickAdd, {
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

type QuickAddWrapper = ReturnType<typeof mountQuickAdd>

function input(wrapper: QuickAddWrapper) {
  return wrapper.find('.quick-add-input')
}

function submitButton(wrapper: QuickAddWrapper) {
  return wrapper.find('.quick-add-submit')
}

function dueValue(wrapper: QuickAddWrapper): number | null {
  return wrapper.findComponent(TodoDueField).props('modelValue') as number | null
}

function lastCreateInput(): CreateTodoInput {
  return todoApi.create.mock.calls[todoApi.create.mock.calls.length - 1][0] as CreateTodoInput
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  setActivePinia(createPinia())
  todoStore = useTodoStore()
  todoStore.groups = [...GROUPS]
  hostApi.loadGuiSettings.mockResolvedValue({ success: false })
  hostApi.saveGuiSettings.mockResolvedValue({ success: true })
  hostApi.getEnv.mockResolvedValue(null)
  hostApi.terminal.onExit.mockReturnValue(() => {})
  todoApi.create.mockResolvedValue({ ok: true, todo: serverTodo() } satisfies TodoMutation)
  notice = mountProbe().vm
  notice.dismissNotice()
})

afterEach(() => {
  notice.dismissNotice()
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TodoQuickAdd · 提交闸门', () => {
  it('标题为空时添加按钮禁用，回车也不打 IPC', async () => {
    const wrapper = mountQuickAdd()

    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(todoApi.create).not.toHaveBeenCalled()
    expect(wrapper.emitted('created')).toBeUndefined()
  })

  it('只有空白字符也算没填，按钮禁用到输入正文为止', async () => {
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue(' \t  ')
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()

    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(todoApi.create).not.toHaveBeenCalled()

    await input(wrapper).setValue('收尾登录改造')
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('聚焦时整块高亮，失焦后回落', async () => {
    const wrapper = mountQuickAdd()

    await input(wrapper).trigger('focus')
    expect(wrapper.find('.todo-quick-add').classes()).toContain('is-focused')

    await input(wrapper).trigger('blur')
    expect(wrapper.find('.todo-quick-add').classes()).not.toContain('is-focused')
  })
})

describe('TodoQuickAdd · 创建载荷', () => {
  it('回车提交：标题去掉首尾空白，没设的字段一律不带值', async () => {
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue('  收尾登录改造  ')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(todoApi.create).toHaveBeenCalledTimes(1)
    expect(lastCreateInput()).toEqual({
      title: '收尾登录改造',
      notes: undefined,
      priority: 'medium',
      dueAt: undefined,
      groupId: undefined,
    })
  })

  it('点添加按钮走的是同一条创建路径', async () => {
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue('买牛奶')
    await submitButton(wrapper).trigger('click')
    await flushPromises()

    expect(todoApi.create).toHaveBeenCalledTimes(1)
    expect(lastCreateInput().title).toBe('买牛奶')
  })

  it('备注、优先级、计划时间、分组都设好时全量进 payload（备注也去空白）', async () => {
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue('收尾登录改造')
    await wrapper.find('.expand-btn').trigger('click')
    await wrapper.find('.quick-add-notes').setValue('  接口已改完，下一步补测试  ')
    await wrapper.findAll('.priority-dot')[2].trigger('click')
    await wrapper.findAll('.due-chip')[1].trigger('click')
    await wrapper.find('.group-select').setValue('g2')
    await submitButton(wrapper).trigger('click')
    await flushPromises()

    expect(lastCreateInput()).toEqual({
      title: '收尾登录改造',
      notes: '接口已改完，下一步补测试',
      priority: 'high',
      dueAt: TOMORROW_1800,
      groupId: 'g2',
    })
  })

  it('提交在途时按钮禁用，连按回车也只打一次 IPC', async () => {
    let settle: (result: TodoMutation) => void = () => {}
    todoApi.create.mockImplementation(
      () =>
        new Promise<TodoMutation>(resolve => {
          settle = resolve
        }),
    )
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue('收尾登录改造')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await nextTick()

    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await submitButton(wrapper).trigger('click')
    expect(todoApi.create).toHaveBeenCalledTimes(1)

    settle({ ok: true, todo: serverTodo() })
    await flushPromises()

    expect(wrapper.emitted('created')).toHaveLength(1)
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
  })
})

describe('TodoQuickAdd · 创建成功与失败', () => {
  it('成功后清空标题与备注、收起备注框，emit created 并弹成功提示', async () => {
    const created = serverTodo({ id: 'server-9', title: '收尾登录改造' })
    todoApi.create.mockResolvedValue({ ok: true, todo: created } satisfies TodoMutation)
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue('收尾登录改造')
    await wrapper.find('.expand-btn').trigger('click')
    await wrapper.find('.quick-add-notes').setValue('接口已改完')
    await submitButton(wrapper).trigger('click')
    await flushPromises()

    expect((input(wrapper).element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.quick-add-notes').exists()).toBe(false)
    expect(wrapper.find('.expand-btn').attributes('aria-expanded')).toBe('false')
    expect(wrapper.emitted('created')).toEqual([[created]])
    expect(notice.notice).toBe('已记录「收尾登录改造」')

    await wrapper.find('.expand-btn').trigger('click')
    expect((wrapper.find('.quick-add-notes').element as HTMLTextAreaElement).value).toBe('')
  })

  it('成功后乐观行换成服务端那条，pending 标记清干净，焦点回到输入框', async () => {
    const created = serverTodo({ id: 'server-9' })
    todoApi.create.mockResolvedValue({ ok: true, todo: created } satisfies TodoMutation)
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue('收尾登录改造')
    await submitButton(wrapper).trigger('click')
    await flushPromises()

    expect(todoStore.todos.map(todo => todo.id)).toEqual(['server-9'])
    expect(todoStore.pendingIds).toEqual([])
    expect(todoStore.error).toBeNull()
    expect(document.activeElement).toBe(input(wrapper).element)
  })

  it('创建失败时保留已输入的标题与备注，失败原因写进 store.error，不 emit created', async () => {
    todoApi.create.mockResolvedValue({ ok: false, reason: 'invalid-title' } satisfies TodoMutation)
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue('收尾登录改造')
    await wrapper.find('.expand-btn').trigger('click')
    await wrapper.find('.quick-add-notes').setValue('接口已改完')
    await submitButton(wrapper).trigger('click')
    await flushPromises()

    expect((input(wrapper).element as HTMLInputElement).value).toBe('收尾登录改造')
    expect((wrapper.find('.quick-add-notes').element as HTMLTextAreaElement).value).toBe('接口已改完')
    expect(todoStore.error).toBe('invalid-title')
    expect(wrapper.emitted('created')).toBeUndefined()
    expect(notice.notice).toBeNull()
    expect(todoStore.todos).toEqual([])
    expect(todoStore.pendingIds).toEqual([])
    expect(submitButton(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('只读来源被拒绝时同样保留输入，并把 read-only 记进 store.error', async () => {
    todoApi.create.mockResolvedValue({ ok: false, reason: 'read-only' } satisfies TodoMutation)
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue('改系统提醒事项里的事')
    await input(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect((input(wrapper).element as HTMLInputElement).value).toBe('改系统提醒事项里的事')
    expect(todoStore.error).toBe('read-only')
  })
})

describe('TodoQuickAdd · 计划时间预设', () => {
  const presets = [
    { index: 0, label: zhCN.todo.quickAdd.today, date: '2026-11-14', dueAt: TODAY_1800 },
    { index: 1, label: zhCN.todo.quickAdd.tomorrow, date: '2026-11-15', dueAt: TOMORROW_1800 },
    { index: 2, label: zhCN.todo.quickAdd.nextWeek, date: '2026-11-21', dueAt: NEXT_WEEK_1800 },
  ] as const

  for (const { index, label, date, dueAt } of presets) {
    it(`点「${label}」落在本地 ${date} 18:00，并原样进 payload`, async () => {
      const wrapper = mountQuickAdd()
      const chip = wrapper.findAll('.due-chip')[index]

      expect(chip.text()).toBe(label)
      await chip.trigger('click')

      expect(chip.classes()).toContain('is-active')
      expect(dueValue(wrapper)).toBe(dueAt)
      expect(wrapper.find('.calendar-field .field-value').text()).toBe(date)
      expect(wrapper.find('.time-wheel-field .field-value').text()).toBe('18:00')

      await input(wrapper).setValue('收尾登录改造')
      await submitButton(wrapper).trigger('click')
      await flushPromises()

      expect(lastCreateInput().dueAt).toBe(dueAt)
    })
  }

  it('再点一次已选中的预设清掉计划时间', async () => {
    const wrapper = mountQuickAdd()
    const chip = wrapper.findAll('.due-chip')[1]

    await chip.trigger('click')
    expect(dueValue(wrapper)).toBe(TOMORROW_1800)

    await chip.trigger('click')

    expect(dueValue(wrapper)).toBeNull()
    expect(wrapper.findAll('.due-chip').some(item => item.classes().includes('is-active'))).toBe(false)
    expect(wrapper.find('.time-wheel-field').exists()).toBe(false)
  })

  it('换一个预设时高亮跟着换，不会两个同时亮', async () => {
    const wrapper = mountQuickAdd()

    await wrapper.findAll('.due-chip')[0].trigger('click')
    await wrapper.findAll('.due-chip')[2].trigger('click')

    expect(wrapper.findAll('.due-chip').map(chip => chip.classes().includes('is-active'))).toEqual([false, false, true])
    expect(dueValue(wrapper)).toBe(NEXT_WEEK_1800)
  })

  it('今天视图挂载即预填今天 18:00', () => {
    todoStore.setView('today')
    const wrapper = mountQuickAdd()

    expect(dueValue(wrapper)).toBe(TODAY_1800)
    expect(wrapper.findAll('.due-chip')[0].classes()).toContain('is-active')
  })

  it('今天视图里清掉预设后不会再自动填回来', async () => {
    todoStore.setView('today')
    const wrapper = mountQuickAdd()

    await wrapper.findAll('.due-chip')[0].trigger('click')
    expect(dueValue(wrapper)).toBeNull()

    await input(wrapper).setValue('收尾登录改造')
    await submitButton(wrapper).trigger('click')
    await flushPromises()

    expect(lastCreateInput().dueAt).toBeUndefined()
    expect(dueValue(wrapper)).toBeNull()
  })
})

describe('TodoQuickAdd · 优先级与分组', () => {
  it('优先级默认选中「中」，点「高」后 aria-pressed 跟着切换', async () => {
    const wrapper = mountQuickAdd()
    const dots = wrapper.findAll('.priority-dot')

    expect(dots.map(dot => dot.attributes('aria-label'))).toEqual([
      zhCN.todo.priority.low,
      zhCN.todo.priority.medium,
      zhCN.todo.priority.high,
    ])
    expect(dots.map(dot => dot.attributes('aria-pressed'))).toEqual(['false', 'true', 'false'])

    await dots[2].trigger('click')

    expect(wrapper.findAll('.priority-dot').map(dot => dot.attributes('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
    ])
    expect(wrapper.findAll('.priority-dot')[2].classes()).toContain('is-active')

    await input(wrapper).setValue('收尾登录改造')
    await submitButton(wrapper).trigger('click')
    await flushPromises()
    expect(lastCreateInput().priority).toBe('high')
  })

  it('分组下拉列出未分组与 store 里的分组', () => {
    const wrapper = mountQuickAdd()

    expect(wrapper.findAll('.group-select option').map(option => option.text())).toEqual([
      zhCN.todo.quickAdd.noGroup,
      '工作',
      '生活',
    ])
  })

  it('分组视图下新建默认落在当前分组', async () => {
    todoStore.openGroup('g2')
    const wrapper = mountQuickAdd()

    expect((wrapper.find('.group-select').element as HTMLSelectElement).value).toBe('g2')

    await input(wrapper).setValue('收尾登录改造')
    await submitButton(wrapper).trigger('click')
    await flushPromises()

    expect(lastCreateInput().groupId).toBe('g2')
  })

  it('在分组视图里选回未分组后 payload 不带 groupId', async () => {
    todoStore.openGroup('g1')
    const wrapper = mountQuickAdd()

    await wrapper.find('.group-select').setValue('')
    await input(wrapper).setValue('收尾登录改造')
    await submitButton(wrapper).trigger('click')
    await flushPromises()

    expect(lastCreateInput().groupId).toBeUndefined()
  })

  it('切到分组视图再切回全部，默认分组跟着回到未分组', async () => {
    const wrapper = mountQuickAdd()
    expect((wrapper.find('.group-select').element as HTMLSelectElement).value).toBe('')

    todoStore.openGroup('g1')
    await nextTick()
    expect((wrapper.find('.group-select').element as HTMLSelectElement).value).toBe('g1')

    todoStore.setView('all')
    await nextTick()
    expect((wrapper.find('.group-select').element as HTMLSelectElement).value).toBe('')
  })

  it('分组还没读回来就先挂载，分组到达后下拉自己对上当前分组', async () => {
    todoStore.groups = []
    todoStore.openGroup('g1')
    const wrapper = mountQuickAdd()

    todoStore.groups = [...GROUPS]
    await nextTick()

    expect((wrapper.find('.group-select').element as HTMLSelectElement).value).toBe('g1')

    await input(wrapper).setValue('收尾登录改造')
    await submitButton(wrapper).trigger('click')
    await flushPromises()

    expect(lastCreateInput().groupId).toBe('g1')
  })

  it('只填了空白的备注等于没填备注', async () => {
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue('收尾登录改造')
    await wrapper.find('.expand-btn').trigger('click')
    await wrapper.find('.quick-add-notes').setValue('   \n  ')
    await submitButton(wrapper).trigger('click')
    await flushPromises()

    expect(lastCreateInput().notes).toBeUndefined()
  })
})

describe('TodoQuickAdd · 展开备注与快捷键', () => {
  it('展开按钮露出备注框，收起后再展开内容还在', async () => {
    const wrapper = mountQuickAdd()
    const expand = wrapper.find('.expand-btn')

    expect(expand.attributes('aria-expanded')).toBe('false')
    expect(expand.attributes('title')).toBe(zhCN.todo.quickAdd.expand)
    expect(wrapper.find('.quick-add-notes').exists()).toBe(false)

    await expand.trigger('click')

    expect(wrapper.find('.expand-btn').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('.expand-btn').attributes('title')).toBe(zhCN.todo.quickAdd.collapse)
    expect(wrapper.find('.todo-quick-add').classes()).toContain('is-expanded')
    const notes = wrapper.find('.quick-add-notes')
    expect(notes.attributes('placeholder')).toBe(zhCN.todo.quickAdd.notesPlaceholder)

    await notes.setValue('接口已改完')
    await wrapper.find('.expand-btn').trigger('click')
    expect(wrapper.find('.quick-add-notes').exists()).toBe(false)

    await wrapper.find('.expand-btn').trigger('click')
    expect((wrapper.find('.quick-add-notes').element as HTMLTextAreaElement).value).toBe('接口已改完')
  })

  it('Escape 清空标题与备注并收起备注框，不打 IPC', async () => {
    const wrapper = mountQuickAdd()

    await input(wrapper).setValue('写错了的事')
    await wrapper.find('.expand-btn').trigger('click')
    await wrapper.find('.quick-add-notes').setValue('写错了的备注')
    await input(wrapper).trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect((input(wrapper).element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.quick-add-notes').exists()).toBe(false)
    expect(wrapper.find('.expand-btn').attributes('aria-expanded')).toBe('false')
    expect(todoApi.create).not.toHaveBeenCalled()
    expect(submitButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('Escape 之后重新展开，备注也是空的', async () => {
    const wrapper = mountQuickAdd()

    await wrapper.find('.expand-btn').trigger('click')
    await wrapper.find('.quick-add-notes').setValue('写错了的备注')
    await input(wrapper).trigger('keydown', { key: 'Escape' })
    await wrapper.find('.expand-btn').trigger('click')

    expect((wrapper.find('.quick-add-notes').element as HTMLTextAreaElement).value).toBe('')
  })

  it('defineExpose 的 focus() 真的把焦点放到输入框上', async () => {
    const wrapper = mountQuickAdd()
    expect(document.activeElement).not.toBe(input(wrapper).element)

    wrapper.vm.focus()
    await nextTick()

    expect(document.activeElement).toBe(input(wrapper).element)
    expect(wrapper.find('.todo-quick-add').classes()).toContain('is-focused')
  })
})