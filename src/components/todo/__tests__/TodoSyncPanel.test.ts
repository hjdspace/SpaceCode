/**
 * macOS 提醒事项同步弹窗：可见性契约、不支持的平台、权限/列表/开关三处写入、
 * 立即同步与冲突裁决。
 *
 * 只 fake todo 命名空间的 IPC；store 的 applySyncResult / refresh 全走真实实现。
 * 弹窗默认 Teleport 到 body，交互用例把 teleport stub 掉就地渲染，另有一条用例
 * 专门钉住真实的 teleport 落点。
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

import TodoSyncPanel from '../TodoSyncPanel.vue'
import { useTodoStore } from '@/stores/todo'
import { formatRelativeFromNow } from '@/utils/todoTime'
import zhCN from '@/i18n/locales/zh-CN'
import type {
  TodoSyncActionResult,
  TodoSyncConflict,
  TodoSyncErrorCode,
  TodoSyncState,
} from '@/shared/channels/todo'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })
const S = zhCN.todo.sync

const NOW = new Date(2026, 10, 14, 10, 0, 0, 0).getTime()
const MINUTE = 60_000

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

function makeConflict(overrides: Partial<TodoSyncConflict> & { id: string }): TodoSyncConflict {
  return {
    todoId: `todo-${overrides.id}`,
    todoTitle: `本地 ${overrides.id}`,
    nativeTitle: `系统 ${overrides.id}`,
    kind: 'changed',
    localUpdatedAt: NOW - 10 * MINUTE,
    detectedAt: NOW - 2 * MINUTE,
    ...overrides,
  }
}

function ok(state: TodoSyncState): TodoSyncActionResult {
  return { ok: true, state }
}

function fail(error: TodoSyncErrorCode, state: TodoSyncState): TodoSyncActionResult {
  return { ok: false, error, state: { ...state, lastError: error } }
}

/** 手动放行的 IPC：用来看清「申请中 / 同步中」这段中间态。 */
function deferred<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle: (value: T) => void = () => {}
  const promise = new Promise<T>(resolve => { settle = resolve })
  return { promise, settle }
}

let todoStore: ReturnType<typeof useTodoStore>

function mountPanel(visible = true) {
  return mount(TodoSyncPanel, {
    props: { visible },
    global: { plugins: [i18n], stubs: { teleport: true } },
    attachTo: document.body,
  })
}

type Panel = ReturnType<typeof mountPanel>
type Scope = { findAll: (selector: string) => DOMWrapper<Element>[] }

function buttonByText(scope: Scope, text: string): DOMWrapper<Element> {
  const found = scope.findAll('button').find(button => button.text() === text)
  if (!found) throw new Error(`找不到文案为「${text}」的按钮`)
  return found
}

function requestButton(wrapper: Panel): DOMWrapper<Element> {
  const text = wrapper.findAll('.sync-btn').map(button => button.text())
  const label = text.includes(S.requesting) ? S.requesting : S.requestAccess
  return buttonByText(wrapper, label)
}

function syncNowButton(wrapper: Panel): DOMWrapper<Element> {
  const text = wrapper.findAll('.sync-btn').map(button => button.text())
  const label = text.includes(S.syncing) ? S.syncing : S.syncNow
  return buttonByText(wrapper, label)
}

beforeEach(() => {
  vi.clearAllMocks()
  // 只假 Date：相对时间文案确定，Transition 用的 rAF 保持真实。
  vi.setSystemTime(NOW)
  localStorage.clear()
  setActivePinia(createPinia())

  todoApi.list.mockResolvedValue([])
  todoApi.listGroups.mockResolvedValue([])
  todoApi.requestSyncAccess.mockResolvedValue(ok(makeSyncState()))
  todoApi.setSyncConfig.mockResolvedValue(ok(makeSyncState()))
  todoApi.syncNow.mockResolvedValue(ok(makeSyncState()))
  todoApi.resolveSyncConflict.mockResolvedValue(ok(makeSyncState()))

  todoStore = useTodoStore()
  todoStore.syncState = makeSyncState()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('TodoSyncPanel · 可见性契约', () => {
  it('visible=false 时整个弹窗不渲染', () => {
    const wrapper = mountPanel(false)

    expect(wrapper.find('.sync-overlay').exists()).toBe(false)
    expect(document.querySelector('.sync-modal')).toBeNull()
  })

  it('visible=true 时弹窗 Teleport 到 body，标题与副标题就位', () => {
    const wrapper = mount(TodoSyncPanel, {
      props: { visible: true },
      // 默认的 transition/teleport stub 会多包一层元素，这条用例要真实落点
      global: { plugins: [i18n], stubs: { transition: false, teleport: false } },
      attachTo: document.body,
    })

    const overlay = document.querySelector<HTMLElement>('.sync-overlay')
    expect(overlay).not.toBeNull()
    expect(overlay!.parentElement).toBe(document.body)
    const modal = overlay!.querySelector<HTMLElement>('.sync-modal')!
    expect(modal.getAttribute('role')).toBe('dialog')
    expect(modal.getAttribute('aria-label')).toBe(S.title)
    expect(modal.querySelector('.sync-title')!.textContent).toBe(S.title)
    expect(modal.querySelector('.sync-subtitle')!.textContent).toBe(S.subtitle)
    expect(wrapper.find('.sync-modal').exists()).toBe(false)
  })

  it('点关闭按钮抛出 update:visible=false', async () => {
    const wrapper = mountPanel()

    await wrapper.find('.sync-close').trigger('click')

    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('点遮罩空白处关闭，点弹窗内部不关闭', async () => {
    const wrapper = mountPanel()

    await wrapper.find('.sync-modal').trigger('click')
    expect(wrapper.emitted('update:visible')).toBeUndefined()

    await wrapper.find('.sync-overlay').trigger('click')
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('上层把 visible 改回 false 后弹窗消失', async () => {
    const wrapper = mountPanel()
    expect(wrapper.find('.sync-modal').exists()).toBe(true)

    await wrapper.setProps({ visible: false })

    await vi.waitFor(() => expect(wrapper.find('.sync-modal').exists()).toBe(false))
  })

  it('按 Escape 关闭同步弹窗，与 ConfirmDialog 等弹窗一致', async () => {
    const wrapper = mountPanel()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('弹窗关掉后 Escape 不再触发 update:visible', async () => {
    const wrapper = mountPanel()
    await wrapper.setProps({ visible: false })
    await flushPromises()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('update:visible')).toBeUndefined()
  })

  it('除 Escape 之外的按键不关弹窗', async () => {
    const wrapper = mountPanel()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()

    expect(wrapper.emitted('update:visible')).toBeUndefined()
    expect(wrapper.find('.sync-modal').exists()).toBe(true)
  })
})

describe('TodoSyncPanel · 不支持的平台', () => {
  it('supported=false（Windows）只给不支持说明，不给任何开启同步的入口', () => {
    todoStore.syncState = makeSyncState({
      supported: false,
      permission: 'unsupported',
      config: { enabled: false, listId: null },
      lists: [],
    })
    const wrapper = mountPanel()

    expect(wrapper.find('.unsupported-title').text()).toBe(S.unsupported)
    expect(wrapper.find('.unsupported-hint').text()).toBe(S.unsupportedHint)
    expect(wrapper.find('.sync-btn').exists()).toBe(false)
    expect(wrapper.find('.sync-select').exists()).toBe(false)
    expect(wrapper.find('.toggle-input').exists()).toBe(false)
    expect(wrapper.find('.perm-badge').exists()).toBe(false)
    // 关闭入口还在，用户不会被卡在弹窗里
    expect(wrapper.find('.sync-close').exists()).toBe(true)
  })
})

describe('TodoSyncPanel · 自动化权限', () => {
  it('permission=unknown 时给「申请访问权限」，点了调 requestSyncAccess 并刷新徽标', async () => {
    todoStore.syncState = makeSyncState({ permission: 'unknown' })
    todoApi.requestSyncAccess.mockResolvedValue(ok(makeSyncState({ permission: 'granted' })))
    const wrapper = mountPanel()

    expect(wrapper.find('.perm-badge').text()).toBe(S.permissionUnknown)
    expect(wrapper.find('.perm-badge').classes()).toContain('is-unknown')
    const button = requestButton(wrapper)
    expect((button.element as HTMLButtonElement).disabled).toBe(false)

    await button.trigger('click')
    await flushPromises()

    expect(todoApi.requestSyncAccess).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.perm-badge').text()).toBe(S.permissionGranted)
    expect(todoStore.error).toBeNull()
  })

  it('permission=denied 时徽标标红且仍可再次申请', async () => {
    todoStore.syncState = makeSyncState({ permission: 'denied' })
    const wrapper = mountPanel()

    expect(wrapper.find('.perm-badge').text()).toBe(S.permissionDenied)
    expect(wrapper.find('.perm-badge').classes()).toContain('is-denied')

    await requestButton(wrapper).trigger('click')
    await flushPromises()

    expect(todoApi.requestSyncAccess).toHaveBeenCalledTimes(1)
  })

  it('permission=granted 时申请按钮禁用，不重复申请', async () => {
    const wrapper = mountPanel()
    const button = requestButton(wrapper)

    expect((button.element as HTMLButtonElement).disabled).toBe(true)
    await button.trigger('click')
    await flushPromises()

    expect(todoApi.requestSyncAccess).not.toHaveBeenCalled()
  })

  it('申请过程中按钮切成「申请中…」并禁用，落地后复原', async () => {
    todoStore.syncState = makeSyncState({ permission: 'unknown' })
    const gate = deferred<TodoSyncActionResult>()
    todoApi.requestSyncAccess.mockReturnValue(gate.promise)
    const wrapper = mountPanel()

    await requestButton(wrapper).trigger('click')
    await flushPromises()

    const pending = requestButton(wrapper)
    expect(pending.text()).toBe(S.requesting)
    expect((pending.element as HTMLButtonElement).disabled).toBe(true)

    gate.settle(ok(makeSyncState({ permission: 'granted' })))
    await flushPromises()

    expect(requestButton(wrapper).text()).toBe(S.requestAccess)
  })

  it('申请失败时 store.error=sync-failed，面板同时给出具体错误文案', async () => {
    todoStore.syncState = makeSyncState({ permission: 'unknown' })
    todoApi.requestSyncAccess.mockResolvedValue(
      fail('permission-denied', makeSyncState({ permission: 'denied' })),
    )
    const wrapper = mountPanel()

    await requestButton(wrapper).trigger('click')
    await flushPromises()

    expect(todoStore.error).toBe('sync-failed')
    expect(wrapper.find('.sync-error').text()).toBe(S.errors['permission-denied'])
    expect(wrapper.find('.perm-badge').text()).toBe(S.permissionDenied)
  })
})

describe('TodoSyncPanel · 同步列表与自动同步开关', () => {
  it('下拉换列表写入 setSyncConfig({ listId })', async () => {
    todoStore.syncState = makeSyncState({
      lists: [
        { id: 'list-1', title: 'Reminders', writable: true },
        { id: 'list-2', title: '工作', writable: true },
      ],
    })
    todoApi.setSyncConfig.mockResolvedValue(
      ok(makeSyncState({ config: { enabled: true, listId: 'list-2' } })),
    )
    const wrapper = mountPanel()

    expect((wrapper.find('.sync-select').element as HTMLSelectElement).value).toBe('list-1')
    await wrapper.find('.sync-select').setValue('list-2')
    await flushPromises()

    expect(todoApi.setSyncConfig).toHaveBeenCalledWith({ listId: 'list-2' })
    expect(todoStore.syncState.config.listId).toBe('list-2')
  })

  it('只读列表在选项里明确标注「只读」', () => {
    todoStore.syncState = makeSyncState({
      config: { enabled: false, listId: 'ro' },
      lists: [
        { id: 'ro', title: '家庭共享', writable: false },
        { id: 'list-1', title: 'Reminders', writable: true },
      ],
    })
    const wrapper = mountPanel()

    const options = wrapper.findAll('.sync-select option')
    expect(options[1].text()).toBe(`家庭共享 · ${S.readOnlyList}`)
    expect(options[2].text()).toBe('Reminders')
  })

  it('没读到列表时下拉禁用并提示先申请权限', () => {
    todoStore.syncState = makeSyncState({ lists: [], config: { enabled: false, listId: null } })
    const wrapper = mountPanel()

    expect((wrapper.find('.sync-select').element as HTMLSelectElement).disabled).toBe(true)
    expect(wrapper.findAll('.field-hint').map(node => node.text())).toContain(S.noLists)
  })

  it('还没选列表时自动同步与立即同步都禁用', () => {
    todoStore.syncState = makeSyncState({ config: { enabled: false, listId: null } })
    const wrapper = mountPanel()

    expect((wrapper.find('.toggle-input').element as HTMLInputElement).disabled).toBe(true)
    expect((syncNowButton(wrapper).element as HTMLButtonElement).disabled).toBe(true)
  })

  it('勾选自动同步写入 setSyncConfig({ enabled: true })', async () => {
    todoStore.syncState = makeSyncState({ config: { enabled: false, listId: 'list-1' } })
    const wrapper = mountPanel()

    await wrapper.find('.toggle-input').setValue(true)
    await flushPromises()

    expect(todoApi.setSyncConfig).toHaveBeenCalledWith({ enabled: true })
  })

  it('取消勾选写入 setSyncConfig({ enabled: false })', async () => {
    const wrapper = mountPanel()

    expect((wrapper.find('.toggle-input').element as HTMLInputElement).checked).toBe(true)
    await wrapper.find('.toggle-input').setValue(false)
    await flushPromises()

    expect(todoApi.setSyncConfig).toHaveBeenCalledWith({ enabled: false })
  })

  it('换列表失败后下拉回到 store 里的真实列表，并给出错误提示', async () => {
    todoStore.syncState = makeSyncState({
      lists: [
        { id: 'list-1', title: 'Reminders', writable: true },
        { id: 'list-2', title: '工作', writable: true },
      ],
    })
    // 主进程拒绝了这次写入，回来的快照里 listId 还是 list-1
    todoApi.setSyncConfig.mockResolvedValue(fail('script-failed', makeSyncState()))
    const wrapper = mountPanel()

    await wrapper.find('.sync-select').setValue('list-2')
    await flushPromises()

    expect(todoStore.error).toBe('sync-failed')
    expect(todoStore.syncState.config.listId).toBe('list-1')
    expect((wrapper.find('.sync-select').element as HTMLSelectElement).value).toBe('list-1')
    expect(wrapper.find('.sync-error').text()).toBe(S.errors['script-failed'])
  })

  it('开关写入失败后回到未勾选，不给「已开启同步」的假象', async () => {
    todoStore.syncState = makeSyncState({ config: { enabled: false, listId: 'list-1' } })
    todoApi.setSyncConfig.mockResolvedValue(
      fail('script-failed', makeSyncState({ config: { enabled: false, listId: 'list-1' } })),
    )
    const wrapper = mountPanel()

    await wrapper.find('.toggle-input').setValue(true)
    await flushPromises()

    expect(todoStore.syncState.config.enabled).toBe(false)
    expect((wrapper.find('.toggle-input').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.find('.sync-error').text()).toBe(S.errors['script-failed'])
  })

  it('开关写入成功后保持勾选', async () => {
    todoStore.syncState = makeSyncState({ config: { enabled: false, listId: 'list-1' } })
    todoApi.setSyncConfig.mockResolvedValue(
      ok(makeSyncState({ config: { enabled: true, listId: 'list-1' } })),
    )
    const wrapper = mountPanel()

    await wrapper.find('.toggle-input').setValue(true)
    await flushPromises()

    expect(todoStore.syncState.config.enabled).toBe(true)
    expect((wrapper.find('.toggle-input').element as HTMLInputElement).checked).toBe(true)
  })
})

describe('TodoSyncPanel · 立即同步', () => {
  it('点「立即同步」调 syncNow，进行中显示「同步中…」并禁用按钮', async () => {
    const gate = deferred<TodoSyncActionResult>()
    todoApi.syncNow.mockReturnValue(gate.promise)
    const wrapper = mountPanel()

    await syncNowButton(wrapper).trigger('click')
    await flushPromises()

    expect(todoApi.syncNow).toHaveBeenCalledTimes(1)
    const pending = syncNowButton(wrapper)
    expect(pending.text()).toBe(S.syncing)
    expect((pending.element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.find('.sync-icon svg').classes()).toContain('spin')

    gate.settle(ok(makeSyncState({ lastSyncAt: NOW })))
    await flushPromises()

    expect(syncNowButton(wrapper).text()).toBe(S.syncNow)
    expect(wrapper.find('.sync-icon svg').classes()).not.toContain('spin')
    expect(todoStore.syncState.syncing).toBe(false)
  })

  it('同步完成后刷新待办与分组（双向合并的结果要落到列表里）', async () => {
    todoApi.list.mockResolvedValue([{ id: 't1', title: '从系统合并回来的' }])
    todoApi.listGroups.mockResolvedValue([])
    const wrapper = mountPanel()

    await syncNowButton(wrapper).trigger('click')
    await flushPromises()

    expect(todoApi.list).toHaveBeenCalled()
    expect(todoApi.listGroups).toHaveBeenCalled()
    expect(todoStore.todos.map(todo => todo.title)).toEqual(['从系统合并回来的'])
  })

  it('上次同步时间按相对时间显示', () => {
    todoStore.syncState = makeSyncState({ lastSyncAt: NOW - 5 * MINUTE })
    const wrapper = mountPanel()

    expect(wrapper.find('.last-sync').text()).toBe(
      i18n.global.t('todo.sync.lastSync', { time: formatRelativeFromNow(NOW - 5 * MINUTE, NOW, 'zh-CN') }),
    )
  })

  it('从未同步过时显示「还没有同步过」', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('.last-sync').text()).toBe(S.never)
  })

  it('同步失败时 store.error=sync-failed 并给出错误文案', async () => {
    todoApi.syncNow.mockResolvedValue(fail('timeout', makeSyncState()))
    const wrapper = mountPanel()

    await syncNowButton(wrapper).trigger('click')
    await flushPromises()

    expect(todoStore.error).toBe('sync-failed')
    expect(wrapper.find('.sync-error').text()).toBe(S.errors.timeout)
    expect(wrapper.find('.sync-icon svg').classes()).not.toContain('spin')
  })
})

describe('TodoSyncPanel · 冲突裁决', () => {
  it('没有冲突时不渲染冲突区', () => {
    const wrapper = mountPanel()

    expect(wrapper.find('.conflict-list').exists()).toBe(false)
    expect(todoStore.conflictCount).toBe(0)
  })

  it('冲突卡片给出条数、类型与两侧标题', () => {
    todoStore.syncState = makeSyncState({
      conflicts: [
        makeConflict({ id: 'c1', todoTitle: '本地改过的标题', nativeTitle: '系统改过的标题' }),
        makeConflict({ id: 'c2', kind: 'deleted', todoTitle: '系统已删掉的', nativeTitle: '系统已删掉的' }),
      ],
    })
    const wrapper = mountPanel()

    expect(wrapper.find('.conflict-count').text()).toBe('2')
    expect(todoStore.conflictCount).toBe(2)
    const cards = wrapper.findAll('.conflict-card')
    expect(cards).toHaveLength(2)
    expect(cards[0].find('.conflict-kind').text()).toBe(S.conflictChanged)
    expect(cards[0].find('.conflict-kind').classes()).toContain('is-changed')
    expect(cards[0].find('.version.is-local').text()).toBe(
      i18n.global.t('todo.sync.localVersion', { title: '本地改过的标题' }),
    )
    expect(cards[0].find('.version.is-native').text()).toBe(
      i18n.global.t('todo.sync.nativeVersion', { title: '系统改过的标题' }),
    )
    expect(cards[0].find('.conflict-time').text()).toBe(
      i18n.global.t('todo.sync.detectedAt', { time: formatRelativeFromNow(NOW - 2 * MINUTE, NOW, 'zh-CN') }),
    )
    expect(cards[1].find('.conflict-kind').text()).toBe(S.conflictDeleted)
    expect(cards[1].find('.conflict-kind').classes()).toContain('is-deleted')
  })

  it('点「保留本地」调 resolveSyncConflict(id, local)，卡片随之消失', async () => {
    todoStore.syncState = makeSyncState({ conflicts: [makeConflict({ id: 'c1' })] })
    todoApi.resolveSyncConflict.mockResolvedValue(ok(makeSyncState({ conflicts: [] })))
    const wrapper = mountPanel()

    await buttonByText(wrapper.find('.conflict-actions'), S.keepLocal).trigger('click')
    await flushPromises()

    expect(todoApi.resolveSyncConflict).toHaveBeenCalledWith('c1', 'local')
    expect(wrapper.find('.conflict-card').exists()).toBe(false)
    expect(todoStore.conflictCount).toBe(0)
    expect(todoStore.error).toBeNull()
  })

  it('点「保留系统」调 resolveSyncConflict(id, native)', async () => {
    todoStore.syncState = makeSyncState({
      conflicts: [makeConflict({ id: 'c1' }), makeConflict({ id: 'c2', kind: 'deleted' })],
    })
    todoApi.resolveSyncConflict.mockResolvedValue(
      ok(makeSyncState({ conflicts: [makeConflict({ id: 'c1' })] })),
    )
    const wrapper = mountPanel()

    await buttonByText(wrapper.findAll('.conflict-actions')[1], S.keepNative).trigger('click')
    await flushPromises()

    expect(todoApi.resolveSyncConflict).toHaveBeenCalledWith('c2', 'native')
    expect(wrapper.findAll('.conflict-card')).toHaveLength(1)
    expect(todoStore.conflictCount).toBe(1)
  })

  it('裁决失败时 store.error=sync-failed，冲突留在原地等重试', async () => {
    const conflict = makeConflict({ id: 'c1' })
    todoStore.syncState = makeSyncState({ conflicts: [conflict] })
    todoApi.resolveSyncConflict.mockResolvedValue(
      fail('script-failed', makeSyncState({ conflicts: [conflict] })),
    )
    const wrapper = mountPanel()

    await buttonByText(wrapper.find('.conflict-actions'), S.keepLocal).trigger('click')
    await flushPromises()

    expect(todoStore.error).toBe('sync-failed')
    expect(wrapper.find('.sync-error').text()).toBe(S.errors['script-failed'])
    expect(wrapper.findAll('.conflict-card')).toHaveLength(1)
  })
})