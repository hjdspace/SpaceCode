import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import {
  buildAncestorChain,
  isWorkspaceEntryVisible,
  sortWorkspaceEntries,
  useWorkspaceBrowser,
} from '@/composables/useWorkspaceBrowser'
import { api } from '@/services/electronAPI'

vi.mock('@/services/electronAPI', () => ({
  api: {
    readDir: vi.fn(),
    searchFiles: vi.fn(),
  },
}))

const dir = (name: string, path: string) => ({ name, path, isDirectory: true, isFile: false })
const file = (name: string, path: string) => ({ name, path, isDirectory: false, isFile: true })

function createBrowser(showHiddenFiles = false) {
  return useWorkspaceBrowser({
    rootDir: () => '/proj',
    showHiddenFiles: () => showHiddenFiles,
  })
}

describe('isWorkspaceEntryVisible', () => {
  it('node_modules 始终隐藏', () => {
    expect(isWorkspaceEntryVisible('node_modules', true)).toBe(false)
  })

  it('点开头条目跟随"显示隐藏文件"设置', () => {
    expect(isWorkspaceEntryVisible('.vscode', false)).toBe(false)
    expect(isWorkspaceEntryVisible('.vscode', true)).toBe(true)
  })

  it('普通条目始终可见', () => {
    expect(isWorkspaceEntryVisible('src', false)).toBe(true)
  })
})

describe('sortWorkspaceEntries', () => {
  it('目录在前，同类按名称排序', () => {
    const sorted = sortWorkspaceEntries([
      file('b.ts', '/b.ts'),
      dir('src', '/src'),
      file('a.ts', '/a.ts'),
      dir('docs', '/docs'),
    ])
    expect(sorted.map(e => e.name)).toEqual(['docs', 'src', 'a.ts', 'b.ts'])
  })

  it('不修改入参数组', () => {
    const input = [file('a.ts', '/a.ts'), dir('src', '/src')]
    sortWorkspaceEntries(input)
    expect(input.map(e => e.name)).toEqual(['a.ts', 'src'])
  })
})

describe('buildAncestorChain', () => {
  it('根目录自身只有一级', () => {
    expect(buildAncestorChain('/proj', '/proj')).toEqual(['/proj'])
  })

  it('末级即当前目录，中间层依次列出', () => {
    expect(buildAncestorChain('/proj', '/proj/src/components')).toEqual([
      '/proj',
      '/proj/src',
      '/proj/src/components',
    ])
  })

  it('容忍 root 末尾分隔符并统一 Windows 分隔符', () => {
    expect(buildAncestorChain('D:\\proj\\', 'D:\\proj\\src\\a')).toEqual([
      'D:\\proj',
      'D:\\proj\\src',
      'D:\\proj\\src\\a',
    ])
  })

  it('root 之外的路径与同名前缀路径只返回 root', () => {
    expect(buildAncestorChain('/proj', '/other/src')).toEqual(['/proj'])
    expect(buildAncestorChain('/proj', '/projx/src')).toEqual(['/proj'])
  })
})

describe('useWorkspaceBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('open 读取根目录并过滤隐藏项，条目带相对路径', async () => {
    vi.mocked(api.readDir).mockResolvedValue([
      dir('src', '/proj/src'),
      file('README.md', '/proj/README.md'),
      dir('.vscode', '/proj/.vscode'),
      dir('node_modules', '/proj/node_modules'),
    ])

    const browser = createBrowser()
    browser.open()
    await flushPromises()

    expect(api.readDir).toHaveBeenCalledWith('/proj')
    expect(browser.visibleEntries.value.map(e => e.name)).toEqual(['src', 'README.md'])
    expect(browser.visibleEntries.value[0]).toEqual({
      name: 'src',
      path: '/proj/src',
      relativePath: 'src',
      isDirectory: true,
    })
    expect(browser.canGoUp.value).toBe(false)
  })

  it('点击目录进入下一级，返回上级回到根目录', async () => {
    vi.mocked(api.readDir)
      .mockResolvedValueOnce([dir('src', '/proj/src')])
      .mockResolvedValueOnce([dir('components', '/proj/src/components'), file('main.ts', '/proj/src/main.ts')])
      .mockResolvedValueOnce([dir('src', '/proj/src')])

    const browser = createBrowser()
    browser.open()
    await flushPromises()

    expect(browser.enter(browser.visibleEntries.value[0])).toBe(true)
    await flushPromises()
    expect(api.readDir).toHaveBeenLastCalledWith('/proj/src')
    expect(browser.canGoUp.value).toBe(true)
    expect(browser.visibleEntries.value.map(e => e.relativePath)).toEqual([
      'src/components',
      'src/main.ts',
    ])

    browser.goUp()
    await flushPromises()
    expect(api.readDir).toHaveBeenLastCalledWith('/proj')
    expect(browser.canGoUp.value).toBe(false)
  })

  it('点击文件不导航', async () => {
    const browser = createBrowser()
    expect(browser.enter({ name: 'a.ts', path: '/proj/a.ts', relativePath: 'a.ts', isDirectory: false })).toBe(false)
    expect(api.readDir).not.toHaveBeenCalled()
  })

  it('搜索走 searchFiles 并在清空后退回浏览视图', async () => {
    vi.useFakeTimers()
    vi.mocked(api.readDir).mockResolvedValue([dir('src', '/proj/src')])
    vi.mocked(api.searchFiles).mockResolvedValue([
      { name: 'ChatInput.vue', path: '/proj/src/components/ChatInput.vue', relativePath: 'src/components/ChatInput.vue', isDirectory: false, isFile: true },
      { name: 'chat', path: '/proj/src/chat', relativePath: 'src/chat', isDirectory: true, isFile: false },
      { name: 'node_modules', path: '/proj/node_modules', relativePath: 'node_modules', isDirectory: true, isFile: false },
    ])

    const browser = createBrowser()
    browser.open()
    await vi.advanceTimersByTimeAsync(0)
    expect(browser.visibleEntries.value.map(e => e.name)).toEqual(['src'])

    browser.searchQuery.value = 'chat'
    await vi.advanceTimersByTimeAsync(150)

    expect(api.searchFiles).toHaveBeenCalledWith('/proj', 'chat', { maxResults: 100 })
    expect(browser.isSearching.value).toBe(true)
    expect(browser.visibleEntries.value.map(e => e.name)).toEqual(['chat', 'ChatInput.vue'])

    browser.clearSearch()
    await vi.advanceTimersByTimeAsync(150)
    expect(browser.isSearching.value).toBe(false)
    expect(browser.visibleEntries.value.map(e => e.name)).toEqual(['src'])
  })

  it('未打开项目时不发起搜索', async () => {
    vi.useFakeTimers()
    const browser = useWorkspaceBrowser({ rootDir: () => '', showHiddenFiles: () => false })
    browser.searchQuery.value = 'chat'
    await vi.advanceTimersByTimeAsync(150)
    expect(api.searchFiles).not.toHaveBeenCalled()
  })
})
