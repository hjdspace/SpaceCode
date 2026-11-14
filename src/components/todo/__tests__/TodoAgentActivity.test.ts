/**
 * Agent 动态浮层：开合契约与锚点定位、空态、最新在前的条目、点回待办 / 交给 Agent、
 * 清空记录。
 *
 * 真 store（顺序靠真实的 onAgentOperation 广播）、真 PopoverPanel（teleport 到 body，
 * 从 body 上捞）、真 useTodoActions；只有 IPC 是假的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { defineComponent } from 'vue'
import type { Todo, TodoAgentOperation } from '@/shared/channels/todo'

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

/** useTodoActions → app store → settings / terminal store 在 setup 里就要这几个桥。 */
const appBridges = vi.hoisted(() => ({
  loadGuiSettings: vi.fn(),
  getEnv: vi.fn(),
  terminal: { onExit: vi.fn() },
}))

vi.mock('@/services/electronAPI', () => ({ api: { todo: todoApi, ...appBridges } }))

import TodoAgentActivity from '@/components/todo/TodoAgentActivity.vue'
import { openPopoverStack } from '@/components/common/popoverStack'
import { useTodoStore } from '@/stores/todo'
import { useAppStore } from '@/stores/app'
import { useTodoActions } from '@/composables/useTodoActions'
import { buildTodoAgentPrompt } from '@/shared/todoReference'
import zhCN from '@/i18n/locales/zh-CN'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })
const A = zhCN.todo.agent

const NOW = new Date(2026, 10, 14, 10, 0, 0, 0).getTime()
const HOUR = 3600_000

const agentListeners: Array<(operation: TodoAgentOperation) => void> = []

function makeTodo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    title: `待办 ${overrides.id}`,
    status: 'open',
    priority: 'medium',
    tags: [],
    reminders: [],
    sessionLinks: [],
    orderIndex: 0,
    createdAt: NOW - 24 * HOUR,
    updatedAt: NOW - HOUR,
    ...overrides,
  }
}

function makeOperation(overrides: Partial<TodoAgentOperation> = {}): TodoAgentOperation {
  return {
    sessionId: null,
    action: 'created',
    todoId: 't1',
    title: '收尾登录改造',
    ...overrides,
  }
}

/** useTodoActions 的 notice 是模块级 ref，useI18n 只能在 setup 里调用，用探针取。 */
const NoticeProbe = defineComponent({
  setup() {
    const { notice, dismissNotice } = useTodoActions()
    return { notice, dismissNotice }
  },
  render: () => null,
})

let todoStore: ReturnType<typeof useTodoStore>
let appStore: ReturnType<typeof useAppStore>
let noticeProbe: ReturnType<typeof mountProbe>

function mountProbe() {
  return mount(NoticeProbe, { global: { plugins: [i18n] } })
}

function mountActivity(props: { open?: boolean; anchor?: HTMLElement | null } = {}) {
  return mount(TodoAgentActivity, {
    props: { open: false, anchor: null, ...props },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

/** 打开走真实的 open 变化：PopoverPanel 的定位与监听都挂在 open 的 watch 上。 */
async function openActivity(props: { open?: boolean; anchor?: HTMLElement | null } = {}) {
  const wrapper = mountActivity(props)
  await wrapper.setProps({ open: true })
  await flushPromises()
  return wrapper
}

function panel(): HTMLElement {
  const found = document.querySelector<HTMLElement>('.popover-panel')
  if (!found) throw new Error('浮层没有渲染到 body 上')
  return found
}

function items(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.activity-item'))
}

function makeAnchor(rect: { top: number; left: number; bottom: number }): HTMLElement {
  const anchor = document.createElement('button')
  document.body.appendChild(anchor)
  vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({
    top: rect.top,
    left: rect.left,
    bottom: rect.bottom,
    right: rect.left + 100,
    width: 100,
    height: rect.bottom - rect.top,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect)
  return anchor
}

beforeEach(() => {
  vi.clearAllMocks()
  // 只假 Date：store 的高亮计时与 Transition 的 rAF 都保持真实。
  vi.setSystemTime(NOW)
  localStorage.clear()
  setActivePinia(createPinia())
  openPopoverStack.length = 0
  agentListeners.length = 0

  todoApi.list.mockResolvedValue([])
  todoApi.listGroups.mockResolvedValue([])
  appBridges.loadGuiSettings.mockResolvedValue({ success: false })
  appBridges.getEnv.mockResolvedValue(undefined)
  todoApi.onChanged.mockReturnValue(() => {})
  todoApi.onReminderDue.mockReturnValue(() => {})
  todoApi.onSyncStateChanged.mockReturnValue(() => {})
  todoApi.onAgentOperation.mockImplementation((listener: (operation: TodoAgentOperation) => void) => {
    agentListeners.push(listener)
    return () => {}
  })

  todoStore = useTodoStore()
  appStore = useAppStore()
  noticeProbe = mountProbe()
  noticeProbe.vm.dismissNotice()
})

afterEach(() => {
  noticeProbe.vm.dismissNotice()
  vi.useRealTimers()
  document.body.innerHTML = ''
  openPopoverStack.length = 0
})

describe('TodoAgentActivity · 开合与锚点', () => {
  it('open=false 时浮层不渲染', () => {
    mountActivity()

    expect(document.querySelector('[data-testid="todo-agent-activity"]')).toBeNull()
    expect(document.querySelector('.popover-panel')).toBeNull()
  })

  it('open=true 后浮层 Teleport 到 body，标题与副标题就位', async () => {
    const wrapper = mount(TodoAgentActivity, {
      props: { open: false, anchor: null },
      // 这条要真实落点，去掉默认的 transition / teleport stub
      global: { plugins: [i18n], stubs: { transition: false, teleport: false } },
      attachTo: document.body,
    })

    await wrapper.setProps({ open: true })
    await flushPromises()

    const activity = document.querySelector<HTMLElement>('[data-testid="todo-agent-activity"]')!
    expect(activity).not.toBeNull()
    expect(panel().parentElement).toBe(document.body)
    expect(wrapper.find('[data-testid="todo-agent-activity"]').exists()).toBe(false)
    expect(activity.querySelector('.activity-title')!.textContent).toBe(A.title)
    expect(activity.querySelector('.activity-subtitle')!.textContent).toBe(A.subtitle)
  })

  it('anchor 为 null 也能打开，不抛错且内容照常渲染', async () => {
    await openActivity({ anchor: null })

    expect(panel().style.position).toBe('fixed')
    expect(document.querySelector('.activity-empty')).not.toBeNull()
  })

  it('anchor 存在时贴着锚点下方定位', async () => {
    const anchor = makeAnchor({ top: 100, left: 40, bottom: 120 })

    await openActivity({ anchor })

    // 锚点下沿 120 + 6 间距；左沿对齐锚点
    expect(panel().style.top).toBe('126px')
    expect(panel().style.left).toBe('40px')
    expect(panel().classList.contains('is-anchored')).toBe(true)
  })

  it('点浮层外部抛出 close', async () => {
    const wrapper = await openActivity()

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('点浮层内部不抛出 close', async () => {
    const wrapper = await openActivity()

    panel().dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('按 Escape 抛出 close', async () => {
    const wrapper = await openActivity()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('close')).toEqual([[]])
  })

  it('上层把 open 改回 false 后浮层消失，监听一并摘掉', async () => {
    const wrapper = await openActivity()
    expect(openPopoverStack).toHaveLength(1)

    await wrapper.setProps({ open: false })
    await flushPromises()

    expect(document.querySelector('[data-testid="todo-agent-activity"]')).toBeNull()
    expect(openPopoverStack).toHaveLength(0)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})

describe('TodoAgentActivity · 空态', () => {
  it('agentActivity 为空时给空态文案，且不显示清空按钮', async () => {
    await openActivity()

    expect(document.querySelector('.empty-title')!.textContent).toBe(A.empty)
    expect(document.querySelector('.empty-hint')!.textContent).toBe(A.hint)
    expect(document.querySelector('.activity-list')).toBeNull()
    expect(document.querySelector('.activity-clear')).toBeNull()
  })
})

describe('TodoAgentActivity · 条目渲染', () => {
  it('最新的一条排在最前（走 onAgentOperation 广播的真实顺序）', async () => {
    todoStore.subscribe()
    const wrapper = mountActivity()
    agentListeners[0](makeOperation({ todoId: 't1', title: '先建的那条' }))
    agentListeners[0](makeOperation({ todoId: 't2', title: '后建的那条', action: 'completed' }))
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(items().map(item => item.querySelector('.item-title')!.textContent)).toEqual([
      '后建的那条',
      '先建的那条',
    ])
    expect(items()[0].querySelector('.item-action')!.textContent).toBe(A.completed)
  })

  it.each([
    { action: 'created', label: A.created },
    { action: 'updated', label: A.updated },
    { action: 'completed', label: A.completed },
    { action: 'reopened', label: A.reopened },
    { action: 'deleted', label: A.deleted },
  ] as const)('$action 渲染成「$label」并带上对应的图标底色', async ({ action, label }) => {
    todoStore.agentActivity = [makeOperation({ action })]

    await openActivity()

    expect(items()).toHaveLength(1)
    expect(items()[0].querySelector('.item-action')!.textContent).toBe(label)
    expect(items()[0].querySelector('.item-icon')!.classList.contains(`is-${action}`)).toBe(true)
    expect(items()[0].querySelector('.item-icon svg')).not.toBeNull()
  })

  it('带会话来源的条目显示会话号前 8 位，没有会话时不显示这一行', async () => {
    todoStore.agentActivity = [
      makeOperation({ todoId: 't1', title: '有会话的', sessionId: 'session-abcdefgh-1234' }),
      makeOperation({ todoId: 't2', title: '没会话的', sessionId: null }),
    ]

    await openActivity()

    expect(items()[0].querySelector('.item-session')!.textContent!.trim()).toBe(
      i18n.global.t('todo.agent.session', { id: 'session-' }),
    )
    expect(items()[1].querySelector('.item-session')).toBeNull()
  })

  it('同一条待办的多次改动各占一行，不会互相覆盖', async () => {
    todoStore.agentActivity = [
      makeOperation({ todoId: 't1', title: '收尾登录改造', action: 'completed' }),
      makeOperation({ todoId: 't1', title: '收尾登录改造', action: 'created' }),
    ]

    await openActivity()

    expect(items()).toHaveLength(2)
    expect(items().map(item => item.querySelector('.item-action')!.textContent)).toEqual([
      A.completed,
      A.created,
    ])
  })
})

describe('TodoAgentActivity · 点回待办与交给 Agent', () => {
  it('点标题抛出 close 并打开这条待办的详情', async () => {
    todoStore.todos = [makeTodo({ id: 't1', title: '收尾登录改造' })]
    todoStore.agentActivity = [makeOperation({ todoId: 't1', title: '收尾登录改造' })]
    const wrapper = await openActivity()

    document.querySelector<HTMLButtonElement>('.item-title')!.click()
    await flushPromises()

    expect(wrapper.emitted('close')).toEqual([[]])
    expect(todoStore.detailId).toBe('t1')
  })

  it('待办已被删掉时标题不可点，也不给「让 Agent 处理」', async () => {
    todoStore.agentActivity = [makeOperation({ todoId: 'gone', title: '已经被删掉的', action: 'deleted' })]
    const wrapper = await openActivity()

    const title = items()[0].querySelector('.item-title')!
    expect(title.tagName).toBe('SPAN')
    expect(title.classList.contains('is-gone')).toBe(true)
    expect(title.textContent).toBe('已经被删掉的')
    expect(document.querySelector('.item-agent')).toBeNull()

    title.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await flushPromises()

    expect(todoStore.detailId).toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('点「让 Agent 处理」关掉浮层与待办面板，把待办和提示词推给输入框', async () => {
    const todo = makeTodo({ id: 't1', title: '收尾登录改造' })
    todoStore.todos = [todo]
    todoStore.agentActivity = [makeOperation({ todoId: 't1', title: todo.title })]
    appStore.showTodoManager = true
    const wrapper = await openActivity()

    document.querySelector<HTMLButtonElement>('.item-agent')!.click()
    await flushPromises()

    expect(wrapper.emitted('close')).toEqual([[]])
    expect(appStore.showTodoManager).toBe(false)
    expect(appStore.activeCenterTab).toBe('chat')
    expect(appStore.pendingInputInjection).toEqual({
      todo: { id: 't1', title: '收尾登录改造' },
      text: buildTodoAgentPrompt(todo),
    })
    expect(noticeProbe.vm.notice).toBe(
      i18n.global.t('todo.composer.agentPromptReady', { title: '收尾登录改造' }),
    )
  })
})

describe('TodoAgentActivity · 清空记录', () => {
  it('点清空按钮清掉 store 里的动态，列表回到空态且按钮消失', async () => {
    todoStore.agentActivity = [makeOperation(), makeOperation({ todoId: 't2', title: '另一条' })]
    const wrapper = await openActivity()
    expect(items()).toHaveLength(2)

    document.querySelector<HTMLButtonElement>('.activity-clear')!.click()
    await flushPromises()

    expect(todoStore.agentActivity).toEqual([])
    expect(document.querySelector('.activity-list')).toBeNull()
    expect(document.querySelector('.empty-title')!.textContent).toBe(A.empty)
    expect(document.querySelector('.activity-clear')).toBeNull()
    // 清空只动记录，不该顺手关掉浮层
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})