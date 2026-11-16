/**
 * TodoNavRail 的导航面：视图切换与徽章、分组入口、新建/重命名/删除分组。
 *
 * 只替掉 IPC（api.todo）。分组的重名/空名判定由主进程负责，所以替身按主进程
 * 那份契约实现（trim + 大小写无关去重），组件自己的空名闸门另测。
 * 分组菜单走真实 PopoverPanel（teleport 到 body），确认弹窗走真实 useDialog。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DOMWrapper, enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { nextTick } from 'vue'
import TodoNavRail from '@/components/todo/TodoNavRail.vue'
import { useTodoStore } from '@/stores/todo'
import { useDialog } from '@/composables/useDialog'
import { TODO_GROUP_COLORS, TODO_GROUP_NAME_MAX_LENGTH } from '@/shared/channels/todo'
import type { Todo, TodoGroup, TodoGroupMutation } from '@/shared/channels/todo'
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
const t = i18n.global.t

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

function makeGroup(id: string, name = id, color = 'teal'): TodoGroup {
  return { id, name, color, orderIndex: 0, createdAt: NOW - DAY }
}

/** 主进程替身自己的分组表：store 的乐观更新不会污染它。 */
let groupBackend: TodoGroup[] = []
let groupSeq = 0

let todoStore: ReturnType<typeof useTodoStore>
const dialog = useDialog()

function seed(todos: Todo[], groups: TodoGroup[] = []): void {
  groupBackend = groups.map(group => ({ ...group }))
  todoStore.todos = todos.map(todo => ({ ...todo }))
  todoStore.groups = groups.map(group => ({ ...group }))
}

function mountRail() {
  return mount(TodoNavRail, { global: { plugins: [i18n] }, attachTo: document.body })
}

type RailWrapper = ReturnType<typeof mountRail>

function viewButtons(wrapper: RailWrapper): DOMWrapper<Element>[] {
  return wrapper.findAll('.nav-section')[0].findAll('.nav-item')
}

function viewButton(wrapper: RailWrapper, label: string): DOMWrapper<Element> {
  const found = viewButtons(wrapper).find(btn => btn.find('.nav-text').text() === label)
  if (!found) throw new Error(`view button not found: ${label}`)
  return found
}

function groupItems(wrapper: RailWrapper): DOMWrapper<Element>[] {
  return wrapper.findAll('.nav-item.is-group')
}

/** 浮层 teleport 到 body；正在离场的那份不算「还开着」。 */
function openGroupMenus(): Element[] {
  return [...document.querySelectorAll('.popover-panel:not(.popover-leave-active) .group-menu')]
}

function groupMenuItem(label: string): DOMWrapper<Element> {
  for (const menu of openGroupMenus()) {
    const found = [...menu.querySelectorAll('.menu-item')].find(item => item.textContent?.trim() === label)
    if (found) return new DOMWrapper(found)
  }
  throw new Error(`group menu item not found: ${label}`)
}

async function openGroupMenu(wrapper: RailWrapper, index = 0): Promise<void> {
  await groupItems(wrapper)[index].find('.group-menu-btn').trigger('click')
  await nextTick()
}

/** 浮层离场动画靠 rAF 收尾，断言「关掉了」之前先放一帧过去。 */
async function settle(): Promise<void> {
  await flushPromises()
  await new Promise<void>(resolve => {
    requestAnimationFrame(() => resolve())
  })
  await nextTick()
}

async function startCreate(wrapper: RailWrapper, name: string): Promise<DOMWrapper<Element>> {
  await wrapper.find('.nav-add').trigger('click')
  await nextTick()
  const input = wrapper.find('.group-editor .group-input')
  await input.setValue(name)
  return input
}

async function answerConfirm(message: string, accept: boolean): Promise<void> {
  await nextTick()
  expect(dialog.confirmDialogState.value.visible).toBe(true)
  expect(dialog.confirmDialogState.value.message).toBe(message)
  expect(dialog.confirmDialogState.value.variant).toBe('danger')
  dialog.closeConfirm(accept)
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  localStorage.clear()
  setActivePinia(createPinia())
  todoStore = useTodoStore()
  groupBackend = []
  groupSeq = 0

  todoApi.createGroup.mockImplementation(async (name: string, color?: string): Promise<TodoGroupMutation> => {
    const trimmed = (name ?? '').trim()
    if (!trimmed || trimmed.length > TODO_GROUP_NAME_MAX_LENGTH) return { ok: false, reason: 'invalid-name' }
    if (groupBackend.some(group => group.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, reason: 'duplicate-name' }
    }
    const group: TodoGroup = {
      id: `new-${++groupSeq}`,
      name: trimmed,
      color: color ?? TODO_GROUP_COLORS[0],
      orderIndex: groupBackend.length,
      createdAt: NOW,
    }
    groupBackend.push(group)
    return { ok: true, group }
  })

  todoApi.renameGroup.mockImplementation(async (id: string, name: string): Promise<TodoGroupMutation> => {
    const trimmed = (name ?? '').trim()
    if (!trimmed || trimmed.length > TODO_GROUP_NAME_MAX_LENGTH) return { ok: false, reason: 'invalid-name' }
    const group = groupBackend.find(item => item.id === id)
    if (!group) return { ok: false, reason: 'not-found' }
    if (groupBackend.some(item => item.id !== id && item.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, reason: 'duplicate-name' }
    }
    group.name = trimmed
    return { ok: true, group: { ...group } }
  })

  todoApi.removeGroup.mockImplementation(async (id: string): Promise<{ ok: boolean }> => {
    const index = groupBackend.findIndex(group => group.id === id)
    if (index < 0) return { ok: false }
    groupBackend.splice(index, 1)
    return { ok: true }
  })
})

afterEach(() => {
  if (dialog.confirmDialogState.value.visible) dialog.closeConfirm(false)
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('TodoNavRail · 视图切换与徽章', () => {
  it('四个视图按钮按固定顺序渲染，默认全部待办高亮', () => {
    const wrapper = mountRail()

    expect(viewButtons(wrapper).map(btn => btn.find('.nav-text').text())).toEqual([
      zhCN.todo.nav.all,
      zhCN.todo.nav.today,
      zhCN.todo.nav.upcoming,
      zhCN.todo.nav.completed,
    ])
    expect(viewButton(wrapper, zhCN.todo.nav.all).classes()).toContain('is-active')
    expect(wrapper.find('nav').attributes('aria-label')).toBe(zhCN.todo.nav.views)
  })

  it('点视图按钮切换 store.view，高亮跟着走', async () => {
    const wrapper = mountRail()

    await viewButton(wrapper, zhCN.todo.nav.today).trigger('click')
    expect(todoStore.view).toBe('today')
    expect(viewButton(wrapper, zhCN.todo.nav.today).classes()).toContain('is-active')
    expect(viewButton(wrapper, zhCN.todo.nav.all).classes()).not.toContain('is-active')

    await viewButton(wrapper, zhCN.todo.nav.upcoming).trigger('click')
    expect(todoStore.view).toBe('upcoming')

    await viewButton(wrapper, zhCN.todo.nav.completed).trigger('click')
    expect(todoStore.view).toBe('completed')
    expect(viewButton(wrapper, zhCN.todo.nav.completed).classes()).toContain('is-active')

    await viewButton(wrapper, zhCN.todo.nav.all).trigger('click')
    expect(todoStore.view).toBe('all')
  })

  it('徽章数字取自 counts（今天含逾期，已完成单独算）', () => {
    seed([
      makeTodo({ id: 'overdue', dueAt: NOW - 2 * HOUR }),
      makeTodo({ id: 'today', dueAt: NOW + 2 * HOUR }),
      makeTodo({ id: 'upcoming', dueAt: NOW + 3 * DAY }),
      makeTodo({ id: 'no-due' }),
      makeTodo({ id: 'done', status: 'completed' }),
    ])
    const wrapper = mountRail()

    expect(todoStore.counts.all).toBe(4)
    expect(viewButtons(wrapper).map(btn => btn.find('.nav-count').text())).toEqual(['4', '2', '1', '1'])
  })

  it('计数为 0 的视图不渲染徽章', () => {
    seed([makeTodo({ id: 'no-due' })])
    const wrapper = mountRail()

    expect(viewButton(wrapper, zhCN.todo.nav.all).find('.nav-count').text()).toBe('1')
    expect(viewButton(wrapper, zhCN.todo.nav.today).find('.nav-count').exists()).toBe(false)
    expect(viewButton(wrapper, zhCN.todo.nav.upcoming).find('.nav-count').exists()).toBe(false)
    expect(viewButton(wrapper, zhCN.todo.nav.completed).find('.nav-count').exists()).toBe(false)
  })

  it('有逾期时今天的徽章标红，逾期清掉后恢复常态', async () => {
    seed([makeTodo({ id: 'overdue', dueAt: NOW - 2 * HOUR })])
    const wrapper = mountRail()

    expect(todoStore.overdueCount).toBe(1)
    expect(viewButton(wrapper, zhCN.todo.nav.today).find('.nav-count').classes()).toContain('is-alert')
    expect(viewButton(wrapper, zhCN.todo.nav.all).find('.nav-count').classes()).not.toContain('is-alert')

    todoStore.todos = [makeTodo({ id: 'overdue', dueAt: NOW + 2 * HOUR })]
    await nextTick()

    expect(viewButton(wrapper, zhCN.todo.nav.today).find('.nav-count').classes()).not.toContain('is-alert')
  })

  it('切视图会清掉已选中的待办', async () => {
    seed([makeTodo({ id: 'a' }), makeTodo({ id: 'b' })])
    const wrapper = mountRail()
    todoStore.selectedIds = ['a', 'b']

    await viewButton(wrapper, zhCN.todo.nav.today).trigger('click')

    expect(todoStore.selectedIds).toEqual([])
  })

  it('从分组切回全部视图会清掉 activeGroupId', async () => {
    seed([makeTodo({ id: 'a', groupId: 'g1' })], [makeGroup('g1', '工作')])
    const wrapper = mountRail()
    await groupItems(wrapper)[0].find('.group-open').trigger('click')
    expect(todoStore.activeGroupId).toBe('g1')

    await viewButton(wrapper, zhCN.todo.nav.all).trigger('click')

    expect(todoStore.view).toBe('all')
    expect(todoStore.activeGroupId).toBeNull()
    expect(groupItems(wrapper)[0].classes()).not.toContain('is-active')
  })
})

describe('TodoNavRail · 分组入口', () => {
  it('点分组名打开分组视图并高亮，色点用色板变量', async () => {
    seed([], [makeGroup('g1', '工作', 'rose'), makeGroup('g2', '生活', 'blue')])
    const wrapper = mountRail()

    expect(groupItems(wrapper).map(item => item.find('.nav-text').text())).toEqual(['工作', '生活'])
    expect(groupItems(wrapper)[0].find('.group-dot').attributes('style')).toContain('--hue: var(--todo-hue-rose)')

    await groupItems(wrapper)[1].find('.group-open').trigger('click')

    expect(todoStore.view).toBe('group')
    expect(todoStore.activeGroupId).toBe('g2')
    expect(groupItems(wrapper)[1].classes()).toContain('is-active')
    expect(groupItems(wrapper)[0].classes()).not.toContain('is-active')
    expect(viewButtons(wrapper).every(btn => !btn.classes().includes('is-active'))).toBe(true)
  })

  it('分组徽章只数组内未完成待办，为 0 时不显示', () => {
    seed(
      [
        makeTodo({ id: 'a', groupId: 'g1' }),
        makeTodo({ id: 'b', groupId: 'g1' }),
        makeTodo({ id: 'c', groupId: 'g1', status: 'completed' }),
        makeTodo({ id: 'd', groupId: 'g2', status: 'completed' }),
      ],
      [makeGroup('g1', '工作'), makeGroup('g2', '生活')],
    )
    const wrapper = mountRail()

    expect(groupItems(wrapper)[0].find('.nav-count').text()).toBe('2')
    expect(groupItems(wrapper)[1].find('.nav-count').exists()).toBe(false)
  })

  it('没有分组时给出空提示，展开新建编辑器时提示让位', async () => {
    seed([])
    const wrapper = mountRail()

    expect(wrapper.find('.nav-empty').text()).toBe(zhCN.todo.nav.emptyGroups)

    await wrapper.find('.nav-add').trigger('click')
    await nextTick()

    expect(wrapper.find('.nav-empty').exists()).toBe(false)
    expect(wrapper.find('.group-editor').exists()).toBe(true)
  })

  /** counts.ungrouped 与 todo.nav.ungrouped 都有归宿：侧栏末尾一项空心点入口，点开只看未分组。 */
  it('侧栏有「未分组」入口，点它按空 groupId 筛出未分组待办', async () => {
    seed([makeTodo({ id: 'a' }), makeTodo({ id: 'b' }), makeTodo({ id: 'c', groupId: 'g1' })], [
      makeGroup('g1', '工作'),
    ])
    const wrapper = mountRail()

    expect(todoStore.counts.ungrouped).toBe(2)
    expect(groupItems(wrapper)).toHaveLength(1)

    const ungrouped = wrapper.find('.nav-item.is-ungrouped')
    expect(ungrouped.find('.nav-text').text()).toBe(zhCN.todo.nav.ungrouped)
    expect(ungrouped.find('.nav-count').text()).toBe('2')
    expect(ungrouped.find('.group-dot').classes()).toContain('is-hollow')
    expect(ungrouped.find('.group-menu-btn').exists()).toBe(false)

    await ungrouped.find('.group-open').trigger('click')

    expect(todoStore.view).toBe('group')
    expect(todoStore.activeGroupId).toBe('')
    expect(todoStore.visibleTodos.map(todo => todo.id)).toEqual(['a', 'b'])
    expect(wrapper.find('.nav-item.is-ungrouped').classes()).toContain('is-active')
    expect(groupItems(wrapper)[0].classes()).not.toContain('is-active')
  })

  it('没有未分组待办时入口仍在，只是不显示计数', () => {
    seed([makeTodo({ id: 'c', groupId: 'g1' })], [makeGroup('g1', '工作')])
    const wrapper = mountRail()

    const ungrouped = wrapper.find('.nav-item.is-ungrouped')
    expect(ungrouped.exists()).toBe(true)
    expect(ungrouped.find('.nav-count').exists()).toBe(false)
  })
})

describe('TodoNavRail · 新建分组', () => {
  it('点加号展开编辑器并聚焦输入框，色板默认轮到下一个颜色', async () => {
    seed([], [makeGroup('g1', '工作')])
    const wrapper = mountRail()

    await wrapper.find('.nav-add').trigger('click')
    await nextTick()

    const input = wrapper.find('.group-editor .group-input')
    expect(input.attributes('placeholder')).toBe(zhCN.todo.nav.groupPlaceholder)
    expect(input.attributes('maxlength')).toBe(String(TODO_GROUP_NAME_MAX_LENGTH))
    expect(document.activeElement).toBe(input.element)
    expect(wrapper.findAll('.hue-dot')).toHaveLength(TODO_GROUP_COLORS.length)
    expect(wrapper.find('.hue-dot.is-active').attributes('aria-label')).toBe(TODO_GROUP_COLORS[1])
    expect(wrapper.find('.hue-dot.is-active').attributes('aria-pressed')).toBe('true')
    expect(todoApi.createGroup).not.toHaveBeenCalled()
  })

  it('回车创建：createGroup 收到名字与颜色，创建后直接打开新分组', async () => {
    seed([], [makeGroup('g1', '工作')])
    const wrapper = mountRail()
    const input = await startCreate(wrapper, '  生活  ')

    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(todoApi.createGroup).toHaveBeenCalledWith('生活', TODO_GROUP_COLORS[1])
    expect(todoStore.groups.map(group => group.name)).toEqual(['工作', '生活'])
    expect(todoStore.view).toBe('group')
    expect(todoStore.activeGroupId).toBe('new-1')
    expect(todoStore.error).toBeNull()
    expect(wrapper.find('.group-editor').exists()).toBe(false)
    expect(groupItems(wrapper)[1].classes()).toContain('is-active')
  })

  it('点创建按钮同样创建，并带上点选的颜色', async () => {
    seed([])
    const wrapper = mountRail()
    await startCreate(wrapper, '生活')

    const rose = wrapper.findAll('.hue-dot').find(dot => dot.attributes('aria-label') === 'rose')
    await rose?.trigger('click')
    expect(wrapper.find('.hue-dot.is-active').attributes('aria-label')).toBe('rose')

    await wrapper.find('.editor-btn.is-primary').trigger('click')
    await flushPromises()

    expect(todoApi.createGroup).toHaveBeenCalledWith('生活', 'rose')
    expect(todoStore.groups[0].color).toBe('rose')
    expect(todoStore.activeGroupId).toBe('new-1')
  })

  it('名字全空白时创建按钮禁用，回车也不发请求', async () => {
    seed([])
    const wrapper = mountRail()
    const input = await startCreate(wrapper, '   ')

    expect(wrapper.find('.editor-btn.is-primary').attributes('disabled')).toBeDefined()
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(todoApi.createGroup).not.toHaveBeenCalled()
    expect(todoStore.groups).toHaveLength(0)
    expect(wrapper.find('.group-editor').exists()).toBe(true)
    expect(todoStore.view).toBe('all')
  })

  it('重名被主进程拒绝：编辑器留在原地，错误记在 store 上', async () => {
    seed([], [makeGroup('g1', '工作')])
    const wrapper = mountRail()
    const input = await startCreate(wrapper, ' 工作 ')

    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(todoApi.createGroup).toHaveBeenCalledWith('工作', TODO_GROUP_COLORS[1])
    expect(todoStore.error).toBe('duplicate-name')
    expect(todoStore.groups).toHaveLength(1)
    expect(todoStore.view).toBe('all')
    expect(wrapper.find('.group-editor').exists()).toBe(true)
    expect((wrapper.find('.group-editor .group-input').element as HTMLInputElement).value).toBe(' 工作 ')
  })

  it('大小写不同也算重名', async () => {
    seed([], [makeGroup('g1', 'Work')])
    const wrapper = mountRail()
    const input = await startCreate(wrapper, 'work')

    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(todoStore.error).toBe('duplicate-name')
    expect(todoStore.groups).toHaveLength(1)
  })

  it('Esc 收起编辑器且不创建', async () => {
    seed([])
    const wrapper = mountRail()
    const input = await startCreate(wrapper, '生活')

    await input.trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(wrapper.find('.group-editor').exists()).toBe(false)
    expect(todoApi.createGroup).not.toHaveBeenCalled()
    expect(wrapper.find('.nav-empty').exists()).toBe(true)
  })

  it('取消按钮收起编辑器且不创建', async () => {
    seed([])
    const wrapper = mountRail()
    await startCreate(wrapper, '生活')

    await wrapper.findAll('.editor-btn')[1].trigger('click')
    await flushPromises()

    expect(wrapper.find('.group-editor').exists()).toBe(false)
    expect(todoApi.createGroup).not.toHaveBeenCalled()
  })

  it('再次点加号会清掉上一次的草稿', async () => {
    seed([])
    const wrapper = mountRail()
    await startCreate(wrapper, '生活')
    await wrapper.findAll('.editor-btn')[1].trigger('click')

    await wrapper.find('.nav-add').trigger('click')
    await nextTick()

    expect((wrapper.find('.group-editor .group-input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('.editor-btn.is-primary').attributes('disabled')).toBeDefined()
  })
})

describe('TodoNavRail · 分组菜单与重命名', () => {
  it('点更多打开菜单，再点一次收起', async () => {
    seed([], [makeGroup('g1', '工作')])
    const wrapper = mountRail()

    await openGroupMenu(wrapper)
    expect(openGroupMenus()).toHaveLength(1)
    expect(groupMenuItem(zhCN.todo.nav.groupRename).exists()).toBe(true)
    expect(groupMenuItem(zhCN.todo.nav.groupDelete).exists()).toBe(true)
    expect(groupItems(wrapper)[0].find('.group-menu-btn').attributes('aria-label')).toBe(zhCN.todo.nav.groupMenu)

    await groupItems(wrapper)[0].find('.group-menu-btn').trigger('click')
    await settle()

    expect(openGroupMenus()).toHaveLength(0)
  })

  it('打开另一个分组的菜单会收起前一个', async () => {
    seed([], [makeGroup('g1', '工作'), makeGroup('g2', '生活')])
    const wrapper = mountRail()

    await openGroupMenu(wrapper, 0)
    await openGroupMenu(wrapper, 1)
    await settle()

    expect(openGroupMenus()).toHaveLength(1)
  })

  it('重命名：菜单进内联输入，回车提交 renameGroup', async () => {
    seed([], [makeGroup('g1', '工作')])
    const wrapper = mountRail()
    await openGroupMenu(wrapper)

    await groupMenuItem(zhCN.todo.nav.groupRename).trigger('click')
    await nextTick()

    const input = wrapper.find('.group-input.is-inline')
    expect((input.element as HTMLInputElement).value).toBe('工作')
    expect(input.attributes('aria-label')).toBe(zhCN.todo.nav.groupRename)

    await input.setValue('  项目  ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(todoApi.renameGroup).toHaveBeenCalledWith('g1', '项目')
    expect(todoStore.groups[0].name).toBe('项目')
    expect(wrapper.find('.group-input.is-inline').exists()).toBe(false)
    expect(groupItems(wrapper)[0].find('.nav-text').text()).toBe('项目')
  })

  it('重命名失焦也提交', async () => {
    seed([], [makeGroup('g1', '工作')])
    const wrapper = mountRail()
    await openGroupMenu(wrapper)
    await groupMenuItem(zhCN.todo.nav.groupRename).trigger('click')
    await nextTick()

    const input = wrapper.find('.group-input.is-inline')
    await input.setValue('项目')
    await input.trigger('blur')
    await flushPromises()

    expect(todoApi.renameGroup).toHaveBeenCalledWith('g1', '项目')
    expect(todoStore.groups[0].name).toBe('项目')
  })

  /** 提交挂在 blur 上，所以重命名必须和新建一样把光标送进输入框，否则只能靠 Enter 提交。 */
  it('点重命名后内联输入框自动聚焦并全选原名', async () => {
    seed([], [makeGroup('g1', '工作')])
    const wrapper = mountRail()

    await wrapper.find('.nav-add').trigger('click')
    await nextTick()
    expect(document.activeElement).toBe(wrapper.find('.group-editor .group-input').element)

    await wrapper.findAll('.editor-btn')[1].trigger('click')
    await nextTick()
    await openGroupMenu(wrapper)
    await groupMenuItem(zhCN.todo.nav.groupRename).trigger('click')
    await nextTick()

    const input = wrapper.find('.group-input.is-inline')
    expect(input.exists()).toBe(true)
    expect(document.activeElement).toBe(input.element)
    const element = input.element as HTMLInputElement
    expect(element.selectionStart).toBe(0)
    expect(element.selectionEnd).toBe('工作'.length)
  })

  it('名字没改或清空时都不发 renameGroup', async () => {
    seed([], [makeGroup('g1', '工作')])
    const wrapper = mountRail()
    await openGroupMenu(wrapper)
    await groupMenuItem(zhCN.todo.nav.groupRename).trigger('click')
    await nextTick()

    const input = wrapper.find('.group-input.is-inline')
    await input.setValue('  工作  ')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(todoApi.renameGroup).not.toHaveBeenCalled()
    expect(todoStore.groups[0].name).toBe('工作')

    await openGroupMenu(wrapper)
    await groupMenuItem(zhCN.todo.nav.groupRename).trigger('click')
    await nextTick()
    const again = wrapper.find('.group-input.is-inline')
    await again.setValue('   ')
    await again.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(todoApi.renameGroup).not.toHaveBeenCalled()
    expect(todoStore.groups[0].name).toBe('工作')
    expect(wrapper.find('.group-input.is-inline').exists()).toBe(false)
  })

  it('Esc 取消重命名，名字不变', async () => {
    seed([], [makeGroup('g1', '工作')])
    const wrapper = mountRail()
    await openGroupMenu(wrapper)
    await groupMenuItem(zhCN.todo.nav.groupRename).trigger('click')
    await nextTick()

    const input = wrapper.find('.group-input.is-inline')
    await input.setValue('项目')
    await input.trigger('keydown', { key: 'Escape' })
    await flushPromises()

    expect(todoApi.renameGroup).not.toHaveBeenCalled()
    expect(todoStore.groups[0].name).toBe('工作')
    expect(wrapper.find('.group-input.is-inline').exists()).toBe(false)
    expect(groupItems(wrapper)[0].find('.nav-text').text()).toBe('工作')
  })

  it('重名重命名被拒绝：名字不变，错误记在 store 上', async () => {
    seed([], [makeGroup('g1', '工作'), makeGroup('g2', '生活')])
    const wrapper = mountRail()
    await openGroupMenu(wrapper, 0)
    await groupMenuItem(zhCN.todo.nav.groupRename).trigger('click')
    await nextTick()

    const input = wrapper.find('.group-input.is-inline')
    await input.setValue('生活')
    await input.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(todoApi.renameGroup).toHaveBeenCalledWith('g1', '生活')
    expect(todoStore.error).toBe('duplicate-name')
    expect(todoStore.groups.map(group => group.name)).toEqual(['工作', '生活'])
  })
})

describe('TodoNavRail · 删除分组', () => {
  it('先确认，确认后 removeGroup 并把组内待办放回未分组', async () => {
    seed([makeTodo({ id: 'a', groupId: 'g1' }), makeTodo({ id: 'b', groupId: 'g1' })], [makeGroup('g1', '工作')])
    const wrapper = mountRail()
    await openGroupMenu(wrapper)

    await groupMenuItem(zhCN.todo.nav.groupDelete).trigger('click')
    await nextTick()
    expect(todoApi.removeGroup).not.toHaveBeenCalled()

    await answerConfirm(t('todo.nav.groupDeleteConfirm', { name: '工作' }), true)

    expect(todoApi.removeGroup).toHaveBeenCalledWith('g1')
    expect(todoStore.groups).toHaveLength(0)
    expect(todoStore.todos.map(todo => todo.groupId)).toEqual([undefined, undefined])
    expect(todoStore.todos).toHaveLength(2)
    expect(wrapper.find('.nav-empty').exists()).toBe(true)
  })

  it('取消删除分组：分组与待办都不动', async () => {
    seed([makeTodo({ id: 'a', groupId: 'g1' })], [makeGroup('g1', '工作')])
    const wrapper = mountRail()
    await openGroupMenu(wrapper)

    await groupMenuItem(zhCN.todo.nav.groupDelete).trigger('click')
    await answerConfirm(t('todo.nav.groupDeleteConfirm', { name: '工作' }), false)

    expect(todoApi.removeGroup).not.toHaveBeenCalled()
    expect(todoStore.groups.map(group => group.id)).toEqual(['g1'])
    expect(todoStore.findTodo('a')?.groupId).toBe('g1')
    expect(groupItems(wrapper)).toHaveLength(1)
  })

  it('删掉正在看的分组会回到全部待办', async () => {
    seed([makeTodo({ id: 'a', groupId: 'g1' })], [makeGroup('g1', '工作'), makeGroup('g2', '生活')])
    const wrapper = mountRail()
    await groupItems(wrapper)[0].find('.group-open').trigger('click')
    expect(todoStore.view).toBe('group')

    await openGroupMenu(wrapper, 0)
    await groupMenuItem(zhCN.todo.nav.groupDelete).trigger('click')
    await answerConfirm(t('todo.nav.groupDeleteConfirm', { name: '工作' }), true)

    expect(todoStore.view).toBe('all')
    expect(todoStore.activeGroupId).toBeNull()
    expect(groupItems(wrapper).map(item => item.find('.nav-text').text())).toEqual(['生活'])
    expect(viewButton(wrapper, zhCN.todo.nav.all).classes()).toContain('is-active')
  })
})