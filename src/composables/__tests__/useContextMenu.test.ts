/**
 * @ 菜单的候选来源：待办与文件合并。
 * 待办不依赖工作区，所以「没有工作区」「文件搜索失败」两条路都必须还能引用待办。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import {
  checkContextTrigger,
  getInitialHighlight,
  navigateContextItems,
  todoContextPath,
  useContextMenu,
  type ContextItem,
} from '@/composables/useContextMenu'
import { useTodoStore } from '@/stores/todo'
import { api } from '@/services/electronAPI'
import type { Todo } from '@/shared/channels/todo'

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 't1',
    title: '收尾登录改造',
    status: 'open',
    priority: 'medium',
    tags: [],
    reminders: [],
    sessionLinks: [],
    orderIndex: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

let todoStore: ReturnType<typeof useTodoStore>
let searchFiles: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  setActivePinia(createPinia())
  todoStore = useTodoStore()
  searchFiles = vi.spyOn(api, 'searchFiles').mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useContextMenu — 纯逻辑', () => {
  it('checkContextTrigger 取最后一个 @ 之后的查询串', () => {
    expect(checkContextTrigger('看 @file 再 @log')).toEqual({
      triggered: true,
      query: 'log',
      triggerPosition: 10,
    })
  })

  it('@ 之后有空格/换行则不触发', () => {
    expect(checkContextTrigger('@a b')).toBeNull()
    expect(checkContextTrigger('@a\nb')).toBeNull()
  })

  it('没有 @ 时返回 null', () => {
    expect(checkContextTrigger('plain')).toBeNull()
  })

  it('navigateContextItems 循环导航，未命中当前项时从头部/尾部起算', () => {
    const items = [
      { path: 'a' }, { path: 'b' }, { path: 'c' },
    ] as ContextItem[]
    expect(navigateContextItems(items, 'a', 1)).toBe('b')
    expect(navigateContextItems(items, 'c', 1)).toBe('a')
    expect(navigateContextItems(items, 'a', -1)).toBe('c')
    expect(navigateContextItems(items, null, 1)).toBe('a')
    expect(navigateContextItems([], 'a', 1)).toBeNull()
  })

  it('getInitialHighlight 取首项，空列表为 null', () => {
    expect(getInitialHighlight([{ path: 'x' } as ContextItem])).toBe('x')
    expect(getInitialHighlight([])).toBeNull()
  })

  it('todoContextPath 加前缀，避免与真实文件路径撞车', () => {
    expect(todoContextPath('t1')).toBe('todo:t1')
  })
})

describe('useContextMenu — 待办候选', () => {
  it('待办排在文件之前，并带上状态/计划时间/分组名', async () => {
    todoStore.todos = [todo({ dueAt: 1234, status: 'completed', groupId: 'g1' })]
    todoStore.groups = [{ id: 'g1', name: 'Work', color: 'blue', orderIndex: 0, createdAt: 1 }]
    searchFiles.mockResolvedValue([
      { name: 'login.ts', path: '/proj/login.ts', relativePath: 'login.ts', isDirectory: false },
      { name: 'src', path: '/proj/src', relativePath: 'src', isDirectory: true },
    ])

    const menu = useContextMenu({ workingDirectory: () => '/proj' })
    menu.showContextMenu.value = true
    menu.contextSearchQuery.value = '登录'
    await menu.loadContextItems()

    expect(menu.contextItems.value).toEqual([
      {
        name: '收尾登录改造',
        path: 'todo:t1',
        relativePath: 'Work',
        type: 'todo',
        todoId: 't1',
        todoStatus: 'completed',
        todoDueAt: 1234,
      },
      { name: 'login.ts', path: '/proj/login.ts', relativePath: 'login.ts', type: 'file' },
      { name: 'src', path: '/proj/src', relativePath: 'src', type: 'directory' },
    ])
    expect(menu.highlightedContextItem.value).toBe('todo:t1')
    expect(menu.isLoadingContext.value).toBe(false)
    expect(searchFiles).toHaveBeenCalledWith('/proj', '登录', { maxResults: 100 })
  })

  it('查询串不命中待办时只剩文件（待办也走搜索，不是恒显）', async () => {
    todoStore.todos = [todo()]
    searchFiles.mockResolvedValue([
      { name: 'login.ts', path: '/proj/login.ts', relativePath: 'login.ts', isDirectory: false },
    ])

    const menu = useContextMenu({ workingDirectory: () => '/proj' })
    menu.showContextMenu.value = true
    menu.contextSearchQuery.value = 'login.ts'
    await menu.loadContextItems()

    expect(menu.contextItems.value.map(item => item.type)).toEqual(['file'])
  })

  it('查询串传给待办搜索，最多 6 条', async () => {
    todoStore.todos = Array.from({ length: 9 }, (_, i) => todo({ id: `t${i}`, title: `登录 ${i}` }))
    const spy = vi.spyOn(todoStore, 'searchForReference')

    const menu = useContextMenu()
    menu.showContextMenu.value = true
    menu.contextSearchQuery.value = '登录'
    await menu.loadContextItems()

    expect(spy).toHaveBeenCalledWith('登录', 6)
    expect(menu.contextItems.value).toHaveLength(6)
  })

  it('没有工作区时不调文件搜索，仍能引用待办', async () => {
    todoStore.todos = [todo()]

    const menu = useContextMenu()
    menu.showContextMenu.value = true
    await menu.loadContextItems()

    expect(searchFiles).not.toHaveBeenCalled()
    expect(menu.contextItems.value.map(item => item.type)).toEqual(['todo'])
  })

  it('工作区回调返回空串时同样跳过文件搜索', async () => {
    todoStore.todos = [todo()]

    const menu = useContextMenu({ workingDirectory: () => '' })
    menu.showContextMenu.value = true
    await menu.loadContextItems()

    expect(searchFiles).not.toHaveBeenCalled()
    expect(menu.contextItems.value).toHaveLength(1)
  })

  it('文件搜索失败时退回只剩待办，loading 收口', async () => {
    todoStore.todos = [todo()]
    searchFiles.mockRejectedValue(new Error('boom'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const menu = useContextMenu({ workingDirectory: () => '/proj' })
    menu.showContextMenu.value = true
    await menu.loadContextItems()

    expect(menu.contextItems.value.map(item => item.todoId)).toEqual(['t1'])
    expect(menu.highlightedContextItem.value).toBe('todo:t1')
    expect(menu.isLoadingContext.value).toBe(false)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('待办没有分组时 relativePath 为空串；分组已删除时也为空串', async () => {
    todoStore.todos = [todo({ id: 'a' }), todo({ id: 'b', groupId: 'ghost' })]

    const menu = useContextMenu()
    menu.showContextMenu.value = true
    await menu.loadContextItems()

    expect(menu.contextItems.value.map(item => item.relativePath)).toEqual(['', ''])
  })

  it('搜索期间菜单被关掉：结果不写回（避免弹层闪现）', async () => {
    todoStore.todos = [todo()]
    let release: (value: []) => void = () => {}
    searchFiles.mockReturnValue(new Promise<[]>(resolve => { release = resolve }))

    const menu = useContextMenu({ workingDirectory: () => '/proj' })
    menu.showContextMenu.value = true
    const pending = menu.loadContextItems()
    menu.closeContextMenu()
    release([])
    await pending
    await flushPromises()

    expect(menu.contextItems.value).toEqual([])
    expect(menu.highlightedContextItem.value).toBeNull()
    expect(menu.isLoadingContext.value).toBe(false)
  })

  it('closeContextMenu / clearContextSearch 复位状态', () => {
    const menu = useContextMenu()
    menu.showContextMenu.value = true
    menu.contextSearchQuery.value = 'abc'
    menu.contextTriggerPosition.value = 5
    menu.highlightedContextItem.value = 'todo:t1'

    expect(menu.clearContextSearch()).toEqual({ queryLen: 3, triggerPosition: 5 })
    expect(menu.contextSearchQuery.value).toBe('')

    menu.contextSearchQuery.value = 'x'
    menu.closeContextMenu()
    expect(menu.showContextMenu.value).toBe(false)
    expect(menu.contextSearchQuery.value).toBe('')
    expect(menu.contextTriggerPosition.value).toBe(-1)
    expect(menu.highlightedContextItem.value).toBeNull()
  })
})