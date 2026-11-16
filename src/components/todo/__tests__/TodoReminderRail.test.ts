/**
 * 到点提醒条：空态 / 折叠、卡片时间与排序、「完成 / 知道了 / 稍后」三条收口。
 *
 * 只把 todo 命名空间的 IPC 换成假实现，store、PopoverPanel、时间格式化全走真实代码：
 * 排序用真实的 onReminderDue 广播驱动，失败回滚靠真实的 refreshReminders。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { DOMWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'

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

vi.mock('@/services/electronAPI', () => ({ api: { todo: todoApi } }))

import TodoReminderRail from '../TodoReminderRail.vue'
import { openPopoverStack } from '@/components/common/popoverStack'
import { useTodoStore } from '@/stores/todo'
import { formatDueShort } from '@/utils/todoTime'
import zhCN from '@/i18n/locales/zh-CN'
import type { ActiveTodoReminder, Todo } from '@/shared/channels/todo'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })
const L = zhCN.todo.reminder

/** 与 store 单测同一时间锚点：本地 10:00，「当天只给时刻」这条缝才稳定。 */
const NOW = new Date(2026, 10, 14, 10, 0, 0, 0).getTime()
const MINUTE = 60_000
const HOUR = 60 * MINUTE

const reminderListeners: Array<(reminders: ActiveTodoReminder[]) => void> = []

function makeReminder(overrides: Partial<ActiveTodoReminder> & { id: string }): ActiveTodoReminder {
  return {
    todoId: `todo-${overrides.id}`,
    todoTitle: `待办 ${overrides.id}`,
    priority: 'medium',
    triggerAt: NOW,
    ...overrides,
  }
}

function makeTodo(overrides: Partial<Todo> & { id: string }): Todo {
  return {
    title: `todo ${overrides.id}`,
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

function dueLabel(time: string): string {
  return i18n.global.t('todo.reminder.dueAt', { time })
}

let todoStore: ReturnType<typeof useTodoStore>

function mountRail() {
  return mount(TodoReminderRail, {
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
}

type Scope = { findAll: (selector: string) => DOMWrapper<Element>[] }

/** 卡片按钮没有 testid，按可见文案定位，避免绑死按钮顺序。 */
function buttonByText(scope: Scope, text: string): DOMWrapper<Element> {
  const found = scope.findAll('button').find(button => button.text() === text)
  if (!found) throw new Error(`找不到文案为「${text}」的按钮`)
  return found
}

function ghostButton(wrapper: ReturnType<typeof mountRail>, cardIndex: number, label: string) {
  const card = wrapper.findAll('.reminder-card')[cardIndex]
  const found = card.findAll(`button[aria-label="${label}"]`)
  if (found.length !== 1) throw new Error(`卡片 ${cardIndex} 上 aria-label=「${label}」的按钮不唯一`)
  return found[0]
}

function snoozeItems(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.snooze-menu .snooze-item'))
}

beforeEach(() => {
  vi.clearAllMocks()
  // 只假 Date：相对/绝对时间文案确定，setTimeout 与 rAF 留给真实的 Transition。
  vi.setSystemTime(NOW)
  localStorage.clear()
  setActivePinia(createPinia())
  openPopoverStack.length = 0
  reminderListeners.length = 0

  todoApi.list.mockResolvedValue([])
  todoApi.listGroups.mockResolvedValue([])
  todoApi.listActiveReminders.mockResolvedValue([])
  todoApi.get.mockResolvedValue(null)
  todoApi.acknowledgeReminder.mockResolvedValue({ ok: true })
  todoApi.snoozeReminder.mockResolvedValue({ ok: true })
  todoApi.onChanged.mockReturnValue(() => {})
  todoApi.onAgentOperation.mockReturnValue(() => {})
  todoApi.onSyncStateChanged.mockReturnValue(() => {})
  todoApi.onReminderDue.mockImplementation((listener: (reminders: ActiveTodoReminder[]) => void) => {
    reminderListeners.push(listener)
    return () => {}
  })

  todoStore = useTodoStore()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
  openPopoverStack.length = 0
})

describe('TodoReminderRail · 空态与折叠', () => {
  it('没有到点提醒时整条提醒条都不渲染', () => {
    const wrapper = mountRail()

    expect(wrapper.find('[data-testid="todo-reminder-rail"]').exists()).toBe(false)
    expect(wrapper.find('.reminder-card').exists()).toBe(false)
  })

  it('最后一条提醒被消掉后提醒条跟着消失', async () => {
    todoStore.activeReminders = [makeReminder({ id: 'r1' })]
    const wrapper = mountRail()
    expect(wrapper.find('[data-testid="todo-reminder-rail"]').exists()).toBe(true)

    todoStore.activeReminders = []
    await flushPromises()

    expect(wrapper.find('[data-testid="todo-reminder-rail"]').exists()).toBe(false)
  })

  it('折叠按钮收起卡片只留标题栏，再点一次展开', async () => {
    todoStore.activeReminders = [makeReminder({ id: 'r1' })]
    const wrapper = mountRail()
    const cards = () => wrapper.find('.rail-cards').element as HTMLElement

    expect(cards().style.display).toBe('')

    await wrapper.find('.rail-toggle').trigger('click')
    expect(cards().style.display).toBe('none')
    expect(wrapper.find('.rail-toggle svg').classes()).toContain('is-collapsed')
    expect(wrapper.find('.rail-title').text()).toBe(L.title)

    await wrapper.find('.rail-toggle').trigger('click')
    expect(cards().style.display).toBe('')
    expect(wrapper.find('.rail-toggle svg').classes()).not.toContain('is-collapsed')
  })
})

describe('TodoReminderRail · 卡片内容', () => {
  it('按触发时刻升序排列（走 onReminderDue 广播的真实排序）', async () => {
    todoStore.subscribe()
    const later = makeReminder({ id: 'r2', todoTitle: '晚一点的那条', triggerAt: NOW + 20 * MINUTE })
    const earlier = makeReminder({ id: 'r1', todoTitle: '先到点的那条', triggerAt: NOW - 5 * MINUTE })

    reminderListeners[0]([later, earlier])
    const wrapper = mountRail()
    await flushPromises()

    expect(wrapper.findAll('.card-title').map(node => node.text())).toEqual(['先到点的那条', '晚一点的那条'])
  })

  it('卡片给出待办标题与当天的计划时刻', () => {
    todoStore.activeReminders = [makeReminder({ id: 'r1', todoTitle: '收尾登录改造', triggerAt: NOW + 30 * MINUTE })]
    const wrapper = mountRail()

    expect(wrapper.find('.card-title').text()).toBe('收尾登录改造')
    expect(wrapper.find('.card-time').text()).toBe(dueLabel('10:30'))
  })

  it('已推迟的提醒显示推迟后的时刻，而不是原触发时刻', () => {
    todoStore.activeReminders = [
      makeReminder({ id: 'r1', triggerAt: NOW - 2 * HOUR, snoozedUntil: NOW + 15 * MINUTE }),
    ]
    const wrapper = mountRail()

    expect(wrapper.find('.card-time').text()).toBe(dueLabel('10:15'))
  })

  it('跨天的提醒带上日期', () => {
    const triggerAt = NOW + 26 * HOUR
    todoStore.activeReminders = [makeReminder({ id: 'r1', triggerAt })]
    const wrapper = mountRail()

    expect(wrapper.find('.card-time').text()).toBe(dueLabel(formatDueShort(triggerAt, NOW, 'zh-CN')))
  })

  it('标题栏计数等于到点条数', () => {
    todoStore.activeReminders = [makeReminder({ id: 'r1' }), makeReminder({ id: 'r2', triggerAt: NOW + MINUTE })]
    const wrapper = mountRail()

    expect(wrapper.find('.rail-count').text()).toBe(i18n.global.t('todo.reminder.count', { n: 2 }))
    expect(wrapper.findAll('.reminder-card')).toHaveLength(2)
  })

  it('优先级落到卡片样式上（高/低各自一条边色）', () => {
    todoStore.activeReminders = [
      makeReminder({ id: 'r1', priority: 'high' }),
      makeReminder({ id: 'r2', priority: 'low', triggerAt: NOW + MINUTE }),
    ]
    const wrapper = mountRail()

    expect(wrapper.findAll('.reminder-card')[0].classes()).toContain('priority-high')
    expect(wrapper.findAll('.reminder-card')[1].classes()).toContain('priority-low')
  })
})

describe('TodoReminderRail · 知道了 / 查看待办', () => {
  it('点「知道了」调 acknowledgeReminder，只移除这一行', async () => {
    todoStore.activeReminders = [
      makeReminder({ id: 'r1', todoId: 't1', todoTitle: '第一条' }),
      makeReminder({ id: 'r2', todoId: 't2', todoTitle: '第二条', triggerAt: NOW + MINUTE }),
    ]
    const wrapper = mountRail()

    await ghostButton(wrapper, 0, L.acknowledge).trigger('click')
    await flushPromises()

    expect(todoApi.acknowledgeReminder).toHaveBeenCalledWith('t1', 'r1')
    expect(wrapper.findAll('.card-title').map(node => node.text())).toEqual(['第二条'])
    expect(todoStore.activeReminders.map(reminder => reminder.id)).toEqual(['r2'])
  })

  it('acknowledgeReminder 失败时重新拉活跃提醒，这一行回到视图里', async () => {
    const reminder = makeReminder({ id: 'r1', todoId: 't1', todoTitle: '消不掉的那条' })
    todoStore.activeReminders = [reminder]
    let settle: (result: { ok: boolean }) => void = () => {}
    todoApi.acknowledgeReminder.mockImplementation(
      () => new Promise<{ ok: boolean }>(resolve => { settle = resolve }),
    )
    todoApi.listActiveReminders.mockResolvedValue([reminder])
    const wrapper = mountRail()

    await ghostButton(wrapper, 0, L.acknowledge).trigger('click')
    // 乐观移除：IPC 还没回来时行先没了
    expect(wrapper.find('.reminder-card').exists()).toBe(false)

    settle({ ok: false })
    await flushPromises()

    expect(todoApi.listActiveReminders).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('.card-title').map(node => node.text())).toEqual(['消不掉的那条'])
  })

  it('点标题打开这条待办的详情', async () => {
    todoStore.activeReminders = [makeReminder({ id: 'r1', todoId: 't1' })]
    const wrapper = mountRail()

    await wrapper.find('.card-title').trigger('click')

    expect(todoStore.detailId).toBe('t1')
  })

  it('点「查看待办」图标同样打开详情', async () => {
    todoStore.activeReminders = [makeReminder({ id: 'r1', todoId: 't9' })]
    const wrapper = mountRail()

    await ghostButton(wrapper, 0, L.open).trigger('click')

    expect(todoStore.detailId).toBe('t9')
    expect(todoApi.acknowledgeReminder).not.toHaveBeenCalled()
  })
})

describe('TodoReminderRail · 稍后', () => {
  it('点「稍后」贴着这张卡片弹出三档菜单', async () => {
    todoStore.activeReminders = [makeReminder({ id: 'r1' })]
    const wrapper = mountRail()

    await buttonByText(wrapper, L.snooze).trigger('click')
    await flushPromises()

    expect(snoozeItems().map(item => item.textContent?.trim())).toEqual([L.snooze10m, L.snooze1h, L.snoozeTomorrow])
    const panel = document.querySelector<HTMLElement>('.popover-panel')
    expect(panel).not.toBeNull()
    // 锚点是这张卡片的「稍后」按钮，定位完成后才显形
    expect(panel!.classList.contains('is-anchored')).toBe(true)
    expect(panel!.style.position).toBe('fixed')
  })

  it.each([
    { index: 0, minutes: 10, label: '10 分钟后' },
    { index: 1, minutes: 60, label: '1 小时后' },
    { index: 2, minutes: 1440, label: '明天此时' },
  ])('选「$label」按 $minutes 分钟推迟', async ({ index, minutes }) => {
    todoStore.activeReminders = [makeReminder({ id: 'r1', todoId: 't1' })]
    const wrapper = mountRail()

    await buttonByText(wrapper, L.snooze).trigger('click')
    await flushPromises()
    snoozeItems()[index].click()
    await flushPromises()

    expect(todoApi.snoozeReminder).toHaveBeenCalledWith('t1', 'r1', minutes)
    expect(todoStore.activeReminders).toHaveLength(0)
  })

  it('再点一次「稍后」收起菜单，不发任何 IPC', async () => {
    todoStore.activeReminders = [makeReminder({ id: 'r1' })]
    const wrapper = mountRail()
    const snooze = buttonByText(wrapper, L.snooze)

    await snooze.trigger('click')
    await flushPromises()
    expect(snoozeItems()).toHaveLength(3)

    await snooze.trigger('click')
    await vi.waitFor(() => expect(document.querySelector('.snooze-menu')).toBeNull())

    expect(todoApi.snoozeReminder).not.toHaveBeenCalled()
    expect(wrapper.findAll('.reminder-card')).toHaveLength(1)
  })

  it('推迟成功后菜单收起、行消失，并回填主进程的最新待办快照', async () => {
    const todo = makeTodo({ id: 't1', title: '收尾登录改造' })
    const snoozedUntil = NOW + 10 * MINUTE
    todoStore.todos = [todo]
    todoStore.activeReminders = [makeReminder({ id: 'r1', todoId: 't1' })]
    todoApi.get.mockResolvedValue({
      ...todo,
      reminders: [{ id: 'r1', triggerAt: NOW, snoozedUntil, status: 'pending', origin: 'due' }],
    })
    const wrapper = mountRail()

    await buttonByText(wrapper, L.snooze).trigger('click')
    await flushPromises()
    snoozeItems()[0].click()
    await flushPromises()

    expect(todoApi.get).toHaveBeenCalledWith('t1')
    expect(todoStore.todos[0].reminders[0].snoozedUntil).toBe(snoozedUntil)
    expect(wrapper.find('[data-testid="todo-reminder-rail"]').exists()).toBe(false)
    await vi.waitFor(() => expect(document.querySelector('.snooze-menu')).toBeNull())
  })

  it('推迟失败时重新拉活跃提醒，行回到视图且不去读待办', async () => {
    const reminder = makeReminder({ id: 'r1', todoId: 't1', todoTitle: '推不动的那条' })
    todoStore.activeReminders = [reminder]
    todoApi.snoozeReminder.mockResolvedValue({ ok: false })
    todoApi.listActiveReminders.mockResolvedValue([reminder])
    const wrapper = mountRail()

    await buttonByText(wrapper, L.snooze).trigger('click')
    await flushPromises()
    snoozeItems()[1].click()
    await flushPromises()

    expect(todoApi.snoozeReminder).toHaveBeenCalledWith('t1', 'r1', 60)
    expect(todoApi.listActiveReminders).toHaveBeenCalledTimes(1)
    expect(todoApi.get).not.toHaveBeenCalled()
    expect(wrapper.findAll('.card-title').map(node => node.text())).toEqual(['推不动的那条'])
  })
})

describe('TodoReminderRail · 完成', () => {
  it('点「完成」先把待办改成已完成，再消掉这条提醒', async () => {
    const todo = makeTodo({ id: 't1', title: '收尾登录改造' })
    todoStore.todos = [todo]
    todoStore.activeReminders = [makeReminder({ id: 'r1', todoId: 't1' })]
    todoApi.update.mockResolvedValue({ ok: true, todo: { ...todo, status: 'completed', completedAt: NOW } })
    const wrapper = mountRail()

    await buttonByText(wrapper, L.complete).trigger('click')
    await flushPromises()

    expect(todoApi.update).toHaveBeenCalledWith({
      id: 't1',
      status: 'completed',
      expectedUpdatedAt: todo.updatedAt,
    })
    expect(todoApi.acknowledgeReminder).toHaveBeenCalledWith('t1', 'r1')
    expect(todoStore.todos[0].status).toBe('completed')
    expect(wrapper.find('[data-testid="todo-reminder-rail"]').exists()).toBe(false)
  })

  it('待办已不在本地时「完成」只消提醒，不发更新', async () => {
    todoStore.activeReminders = [makeReminder({ id: 'r1', todoId: 'gone' })]
    const wrapper = mountRail()

    await buttonByText(wrapper, L.complete).trigger('click')
    await flushPromises()

    expect(todoApi.update).not.toHaveBeenCalled()
    expect(todoApi.acknowledgeReminder).toHaveBeenCalledWith('gone', 'r1')
    expect(wrapper.find('[data-testid="todo-reminder-rail"]').exists()).toBe(false)
  })
})