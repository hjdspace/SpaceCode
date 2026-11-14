/**
 * TodoRow 组件测试 — 一行待办的全部对外契约：渲染、勾选、打开、拖拽、行菜单。
 * 真 store（分组名靠 groupById 查）、真 PopoverPanel（teleport 到 body，从 body 上捞），
 * 只有 IPC 是假的。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import type { Todo, TodoGroup, TodoReminder, TodoSessionLink } from '@/shared/channels/todo'

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

import TodoRow from '@/components/todo/TodoRow.vue'
import { useTodoStore } from '@/stores/todo'
import zhCN from '@/i18n/locales/zh-CN'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

/** 本地 2026-11-14 10:00：当天 18:00 是「今天」，09:00 已逾期。 */
const NOW = new Date(2026, 10, 14, 10, 0, 0, 0).getTime()
const HOUR = 3600_000
const TODAY_1800 = new Date(2026, 10, 14, 18, 0, 0, 0).getTime()

function makeTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: '收尾登录改造',
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

function makeReminder(id: string, status: TodoReminder['status']): TodoReminder {
  return { id, triggerAt: TODAY_1800, status, origin: 'manual' }
}

function makeSession(sessionId: string): TodoSessionLink {
  return { sessionId, firstTouchedAt: NOW - HOUR, lastTouchedAt: NOW - HOUR }
}

const GROUP: TodoGroup = { id: 'g1', name: '工作', color: 'teal', orderIndex: 0, createdAt: NOW - 24 * HOUR }

let todoStore: ReturnType<typeof useTodoStore>
const mounted: { unmount: () => void }[] = []

type RowProps = InstanceType<typeof TodoRow>['$props']

function mountRow(todo: Todo = makeTodo(), props: Partial<RowProps> = {}) {
  const wrapper = mount(TodoRow, {
    props: {
      todo,
      selected: false,
      selectionActive: false,
      active: false,
      pending: false,
      agentTouched: false,
      dragging: false,
      dropTarget: false,
      ...props,
    },
    global: { plugins: [i18n] },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

type RowWrapper = ReturnType<typeof mountRow>

function makeDataTransfer() {
  return { setData: vi.fn(), effectAllowed: 'none' }
}

/** jsdom 没有 DragEvent，自己拼一个带 dataTransfer 的可取消事件。 */
function dragEvent(type: string, dataTransfer?: ReturnType<typeof makeDataTransfer>): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  if (dataTransfer) Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}

/** Transition 的离场要跨两帧才真正摘掉 DOM。 */
function nextFrames(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
}

async function openMenu(wrapper: RowWrapper): Promise<HTMLElement> {
  await wrapper.find('.row-menu-btn').trigger('click')
  await flushPromises()
  const menu = document.body.querySelector('.row-menu')
  if (!menu) throw new Error('行菜单没有出现在 body 上')
  return menu as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  setActivePinia(createPinia())
  todoStore = useTodoStore()
  todoStore.groups = [GROUP]
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('TodoRow · 行内信息', () => {
  it('标题、分组、计划时间、提醒数、会话数、标签与备注预览都渲染出来', () => {
    const wrapper = mountRow(
      makeTodo({
        groupId: 'g1',
        dueAt: TODAY_1800,
        reminders: [makeReminder('r1', 'pending'), makeReminder('r2', 'pending'), makeReminder('r3', 'acknowledged')],
        sessionLinks: [makeSession('s1'), makeSession('s2')],
        tags: ['登录', '改造', '前端', '联调', '回归'],
        notes: '接口已改完\n下一步补测试',
      }),
    )

    expect(wrapper.find('.row-title').text()).toBe('收尾登录改造')
    expect(wrapper.find('.meta-group').text()).toBe('工作')
    expect(wrapper.find('.meta-due').text()).toBe('18:00')
    expect(wrapper.find('.meta-due').classes()).toContain('is-today')

    const items = wrapper.findAll('.meta-item')
    expect(items.map(item => item.text())).toEqual(['2', '2'])
    expect(items[0].attributes('title')).toBe('2 个提醒')
    expect(items[1].attributes('title')).toBe('2 个会话')

    expect(wrapper.findAll('.meta-tag').map(tag => tag.text())).toEqual(['#登录', '#改造', '#前端', '+2'])
    expect(wrapper.find('.meta-tag.is-more').text()).toBe('+2')
    expect(wrapper.find('.meta-notes').text()).toBe('接口已改完')
  })

  it('分组色块用 store 里那个分组的颜色 token', () => {
    todoStore.groups = [{ ...GROUP, color: 'violet' }]
    const wrapper = mountRow(makeTodo({ groupId: 'g1' }))

    expect(wrapper.find('.meta-group').attributes('style')).toContain('--hue')
    expect(wrapper.find('.group-dot').exists()).toBe(true)
  })

  it('store 里查不到分组时不渲染分组块', () => {
    const wrapper = mountRow(makeTodo({ groupId: 'gone' }))

    expect(wrapper.find('.meta-group').exists()).toBe(false)
  })

  it('已逾期的计划时间标成 overdue', () => {
    const wrapper = mountRow(makeTodo({ dueAt: NOW - HOUR }))

    expect(wrapper.find('.meta-due').classes()).toContain('is-overdue')
    expect(wrapper.find('.meta-due').text()).toBe('09:00')
  })

  it('跨年的计划时间带上年份', () => {
    const wrapper = mountRow(makeTodo({ dueAt: new Date(2027, 0, 5, 18, 0, 0, 0).getTime() }))

    expect(wrapper.find('.meta-due').classes()).toContain('is-later')
    expect(wrapper.find('.meta-due').text()).toContain('2027')
    expect(wrapper.find('.meta-due').text()).toContain('18:00')
  })

  it('提醒都确认过了就不再显示提醒数', () => {
    const wrapper = mountRow(
      makeTodo({ reminders: [makeReminder('r1', 'acknowledged'), makeReminder('r2', 'completed')] }),
    )

    expect(wrapper.find('.meta-item').exists()).toBe(false)
  })

  it('备注预览只取第一行，超过 60 字截断并补省略号', () => {
    const wrapper = mountRow(makeTodo({ notes: `${'很'.repeat(70)}\n第二行不该出现` }))

    expect(wrapper.find('.meta-notes').text()).toBe(`${'很'.repeat(60)}…`)
  })

  it('空白备注不算备注', () => {
    const wrapper = mountRow(makeTodo({ notes: '   \n  ' }))

    expect(wrapper.find('.meta-notes').exists()).toBe(false)
  })

  it('光秃秃一条待办时所有可选块都不渲染', () => {
    const wrapper = mountRow()

    expect(wrapper.find('.meta-group').exists()).toBe(false)
    expect(wrapper.find('.meta-due').exists()).toBe(false)
    expect(wrapper.find('.meta-item').exists()).toBe(false)
    expect(wrapper.find('.meta-tag').exists()).toBe(false)
    expect(wrapper.find('.meta-notes').exists()).toBe(false)
    expect(wrapper.find('.row-agent').exists()).toBe(false)
  })

  it('标签不超过 3 个时不出现 +N', () => {
    const wrapper = mountRow(makeTodo({ tags: ['甲', '乙'] }))

    expect(wrapper.findAll('.meta-tag').map(tag => tag.text())).toEqual(['#甲', '#乙'])
    expect(wrapper.find('.meta-tag.is-more').exists()).toBe(false)
  })

  it('优先级圆点带上按优先级的 class 与文案', () => {
    const wrapper = mountRow(makeTodo({ priority: 'high' }))

    expect(wrapper.find('.row-priority').classes()).toContain('is-high')
    expect(wrapper.find('.row-priority').attributes('title')).toBe(zhCN.todo.priority.high)
  })
})

describe('TodoRow · 完成与勾选', () => {
  it('未完成时勾选按钮 aria-pressed=false，点它把整条 todo 交出去', async () => {
    const todo = makeTodo()
    const wrapper = mountRow(todo)
    const check = wrapper.find('.row-check')

    expect(check.attributes('aria-pressed')).toBe('false')
    expect(check.attributes('aria-label')).toBe(zhCN.todo.row.complete)
    expect(check.classes()).not.toContain('is-done')

    await check.trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([[todo]])
  })

  it('已完成时行加 is-completed，按钮换成重新打开', async () => {
    const todo = makeTodo({ status: 'completed' })
    const wrapper = mountRow(todo)
    const check = wrapper.find('.row-check')

    expect(wrapper.find('.todo-row').classes()).toContain('is-completed')
    expect(check.classes()).toContain('is-done')
    expect(check.attributes('aria-pressed')).toBe('true')
    expect(check.attributes('aria-label')).toBe(zhCN.todo.row.reopen)

    await check.trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([[todo]])
  })
})

describe('TodoRow · 打开与选择', () => {
  it('点行主体 emit open(id)', async () => {
    const wrapper = mountRow()

    await wrapper.find('.row-body').trigger('click')

    expect(wrapper.emitted('open')).toEqual([['t1']])
  })

  it('双击行 emit open(id)', async () => {
    const wrapper = mountRow()

    await wrapper.find('.todo-row').trigger('dblclick')

    expect(wrapper.emitted('open')).toEqual([['t1']])
  })

  it('勾选选择框 emit select(id)', async () => {
    const wrapper = mountRow()

    await wrapper.find('.row-select input').trigger('change')

    expect(wrapper.emitted('select')).toEqual([['t1']])
  })

  it('选择框平时藏着，进入多选态或本行已选才露出来', async () => {
    const wrapper = mountRow()
    expect(wrapper.find('.row-select').classes()).not.toContain('is-visible')

    await wrapper.setProps({ selectionActive: true })
    expect(wrapper.find('.row-select').classes()).toContain('is-visible')

    await wrapper.setProps({ selectionActive: false, selected: true })
    expect(wrapper.find('.row-select').classes()).toContain('is-visible')
    expect((wrapper.find('.row-select input').element as HTMLInputElement).checked).toBe(true)
  })

  it('点更多按钮不会顺手打开详情', async () => {
    const wrapper = mountRow()

    await wrapper.find('.row-menu-btn').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('open')).toBeUndefined()
  })
})

describe('TodoRow · 拖拽排序', () => {
  it('没按住把手就 dragstart：拦掉默认行为，也不 emit drag-start', async () => {
    const wrapper = mountRow()
    const dataTransfer = makeDataTransfer()

    expect(wrapper.find('.todo-row').attributes('draggable')).toBe('false')
    const event = dragEvent('dragstart', dataTransfer)
    wrapper.find('.todo-row').element.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(dataTransfer.setData).not.toHaveBeenCalled()
    expect(wrapper.emitted('drag-start')).toBeUndefined()
  })

  it('按住把手后才可拖，dragstart 写入 dataTransfer 并 emit drag-start', async () => {
    const wrapper = mountRow()

    await wrapper.find('.row-grip').trigger('mousedown')
    expect(wrapper.find('.todo-row').attributes('draggable')).toBe('true')

    const dataTransfer = makeDataTransfer()
    const event = dragEvent('dragstart', dataTransfer)
    wrapper.find('.todo-row').element.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(false)
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', 't1')
    expect(dataTransfer.effectAllowed).toBe('move')
    expect(wrapper.emitted('drag-start')).toEqual([['t1']])
  })

  it('在把手上按下又松开，行回到不可拖', async () => {
    const wrapper = mountRow()
    const grip = wrapper.find('.row-grip')

    await grip.trigger('mousedown')
    await grip.trigger('mouseup')

    expect(wrapper.find('.todo-row').attributes('draggable')).toBe('false')
  })

  /**
   * 按住把手又改主意、松手落在别处是很常见的手势：武装必须跟着 window 的 mouseup 解除，
   * 否则行会一直 draggable=true，之后在标题上划选文字都变成拖动整行。
   */
  it('在把手之外松开鼠标即解除武装，后续 dragstart 被拦掉', async () => {
    const wrapper = mountRow()

    await wrapper.find('.row-grip').trigger('mousedown')
    expect(wrapper.find('.todo-row').attributes('draggable')).toBe('true')

    document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    await flushPromises()

    expect(wrapper.find('.todo-row').attributes('draggable')).toBe('false')

    const dataTransfer = makeDataTransfer()
    const event = dragEvent('dragstart', dataTransfer)
    wrapper.find('.row-body').element.dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(dataTransfer.setData).not.toHaveBeenCalled()
    expect(wrapper.emitted('drag-start')).toBeUndefined()
  })

  it('卸载后不再残留 window 上的 mouseup 监听', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const wrapper = mountRow()

    await wrapper.find('.row-grip').trigger('mousedown')
    wrapper.unmount()

    expect(remove.mock.calls.some(([type]) => type === 'mouseup')).toBe(true)
    remove.mockRestore()
  })

  it('dragover 与 drop 各自 emit 目标 id，并拦掉浏览器默认行为', async () => {
    const wrapper = mountRow()
    const row = wrapper.find('.todo-row')

    const over = dragEvent('dragover', makeDataTransfer())
    row.element.dispatchEvent(over)
    const drop = dragEvent('drop', makeDataTransfer())
    row.element.dispatchEvent(drop)
    await flushPromises()

    expect(over.defaultPrevented).toBe(true)
    expect(drop.defaultPrevented).toBe(true)
    expect(wrapper.emitted('drag-over')).toEqual([['t1']])
    expect(wrapper.emitted('drop-on')).toEqual([['t1']])
  })

  it('dragend emit drag-end 并解除拖动武装', async () => {
    const wrapper = mountRow()
    await wrapper.find('.row-grip').trigger('mousedown')
    wrapper.find('.todo-row').element.dispatchEvent(dragEvent('dragstart', makeDataTransfer()))

    wrapper.find('.todo-row').element.dispatchEvent(dragEvent('dragend'))
    await flushPromises()

    expect(wrapper.emitted('drag-end')).toEqual([[]])
    expect(wrapper.find('.todo-row').attributes('draggable')).toBe('false')
  })

  it('拖动中的行由 dragging prop 压暗，本地武装不改这个 class', async () => {
    const wrapper = mountRow()
    await wrapper.find('.row-grip').trigger('mousedown')
    expect(wrapper.find('.todo-row').classes()).not.toContain('is-dragging')

    await wrapper.setProps({ dragging: true })
    expect(wrapper.find('.todo-row').classes()).toContain('is-dragging')
  })
})

describe('TodoRow · 行菜单', () => {
  it('点更多按钮把菜单 teleport 到 body，五个动作按顺序列出', async () => {
    const wrapper = mountRow()
    expect(wrapper.find('.row-menu-btn').attributes('aria-expanded')).toBe('false')
    expect(document.body.querySelector('.row-menu')).toBeNull()

    const menu = await openMenu(wrapper)

    expect(wrapper.find('.row-menu-btn').attributes('aria-expanded')).toBe('true')
    expect(menu.getAttribute('role')).toBe('menu')
    expect([...menu.querySelectorAll('.menu-item')].map(item => item.textContent?.trim())).toEqual([
      zhCN.todo.row.reference,
      zhCN.todo.row.askAgent,
      zhCN.todo.row.edit,
      zhCN.todo.row.copyTitle,
      zhCN.todo.row.delete,
    ])
    expect(menu.querySelector('.menu-item.is-danger')?.textContent?.trim()).toBe(zhCN.todo.row.delete)
  })

  const actions = [
    { index: 0, action: 'reference', label: zhCN.todo.row.reference },
    { index: 1, action: 'agent', label: zhCN.todo.row.askAgent },
    { index: 2, action: 'edit', label: zhCN.todo.row.edit },
    { index: 3, action: 'copy', label: zhCN.todo.row.copyTitle },
    { index: 4, action: 'delete', label: zhCN.todo.row.delete },
  ] as const

  for (const { index, action, label } of actions) {
    it(`点「${label}」emit action=${action} 带整条 todo，并关掉菜单`, async () => {
      const todo = makeTodo()
      const wrapper = mountRow(todo)
      const menu = await openMenu(wrapper)

      ;(menu.querySelectorAll('.menu-item')[index] as HTMLElement).click()
      await flushPromises()
      await nextFrames()

      expect(wrapper.emitted('action')).toEqual([[action, todo]])
      expect(wrapper.find('.row-menu-btn').attributes('aria-expanded')).toBe('false')
      expect(document.body.querySelector('.row-menu')).toBeNull()
    })
  }

  it('再点一次更多按钮收起菜单', async () => {
    const wrapper = mountRow()
    await openMenu(wrapper)

    await wrapper.find('.row-menu-btn').trigger('click')
    await flushPromises()
    await nextFrames()

    expect(wrapper.find('.row-menu-btn').attributes('aria-expanded')).toBe('false')
    expect(document.body.querySelector('.row-menu')).toBeNull()
  })

  it('点浮层外面关掉菜单，但不 emit 任何动作', async () => {
    const wrapper = mountRow()
    await openMenu(wrapper)

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()

    expect(wrapper.find('.row-menu-btn').attributes('aria-expanded')).toBe('false')
    expect(wrapper.emitted('action')).toBeUndefined()
  })

  it('Escape 关掉菜单', async () => {
    const wrapper = mountRow()
    await openMenu(wrapper)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()

    expect(wrapper.find('.row-menu-btn').attributes('aria-expanded')).toBe('false')
  })
})

describe('TodoRow · 系统来源与状态', () => {
  it('只读来源显示锁与「只读」，并标出来自哪个提醒事项列表', () => {
    const wrapper = mountRow(
      makeTodo({
        nativeOrigin: {
          source: 'macos-reminders',
          listId: 'l1',
          listTitle: '工作清单',
          externalId: 'x1',
          canWrite: false,
        },
      }),
    )
    const sync = wrapper.find('.meta-item.is-sync')

    expect(sync.text()).toBe(zhCN.todo.row.readOnly)
    expect(sync.attributes('title')).toBe('提醒事项列表：工作清单')
    expect(sync.find('.lucide-lock').exists()).toBe(true)
  })

  it('可写来源显示同步图标与「来自提醒事项」', () => {
    const wrapper = mountRow(
      makeTodo({
        nativeOrigin: {
          source: 'macos-reminders',
          listId: 'l1',
          listTitle: '工作清单',
          externalId: 'x1',
          canWrite: true,
        },
      }),
    )
    const sync = wrapper.find('.meta-item.is-sync')

    expect(sync.text()).toBe(zhCN.todo.row.synced)
    expect(sync.find('.lucide-refresh-cw').exists()).toBe(true)
    expect(sync.find('.lucide-lock').exists()).toBe(false)
  })

  it('pending / selected / active / dropTarget 各自映射到行 class', async () => {
    const wrapper = mountRow()
    const row = wrapper.find('.todo-row')
    expect(row.classes()).not.toContain('is-pending')

    await wrapper.setProps({ pending: true })
    expect(wrapper.find('.todo-row').classes()).toContain('is-pending')

    await wrapper.setProps({ selected: true })
    expect(wrapper.find('.todo-row').classes()).toContain('is-selected')

    await wrapper.setProps({ active: true })
    expect(wrapper.find('.todo-row').classes()).toContain('is-active')

    await wrapper.setProps({ dropTarget: true })
    expect(wrapper.find('.todo-row').classes()).toContain('is-drop-target')
  })

  it('agentTouched 的行加 is-agent 并挂上 Agent 标记', async () => {
    const wrapper = mountRow()
    expect(wrapper.find('.row-agent').exists()).toBe(false)

    await wrapper.setProps({ agentTouched: true })

    expect(wrapper.find('.todo-row').classes()).toContain('is-agent')
    expect(wrapper.find('.row-agent').attributes('title')).toBe(zhCN.todo.row.agentTouched)
  })

  it('行上带 data-todo-id，宿主据此定位落位目标', () => {
    const wrapper = mountRow(makeTodo({ id: 't9' }))

    expect(wrapper.find('.todo-row').attributes('data-todo-id')).toBe('t9')
  })
})