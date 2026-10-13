/**
 * useWorkspaceBrowser - 工作区文件选择器的 drill-in 浏览逻辑
 *
 * 目录过滤/排序规则与 explorer/FileTree.vue 保持一致。
 */
import { computed, ref, watch } from 'vue'
import { api } from '@/services/electronAPI'
import { buildRelativePath } from '@/composables/useFileAttachments'

export interface WorkspaceEntry {
  name: string
  path: string
  relativePath: string
  isDirectory: boolean
}

const ALWAYS_HIDDEN = 'node_modules'

/** node_modules 始终隐藏；点开头条目跟随"显示隐藏文件"设置 */
export function isWorkspaceEntryVisible(name: string, showHiddenFiles: boolean): boolean {
  if (name === ALWAYS_HIDDEN) return false
  if (!showHiddenFiles && name.startsWith('.')) return false
  return true
}

/** 目录在前，同类按名称排序 */
export function sortWorkspaceEntries<T extends { name: string; isDirectory: boolean }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** rootDir → dirPath 的完整层级（含两端），最后一项即 dirPath，用于"返回上级目录" */
export function buildAncestorChain(rootDir: string, dirPath: string): string[] {
  const root = rootDir.replace(/[\\/]+$/, '')
  const target = dirPath.replace(/[\\/]+$/, '')
  const chain = [root]
  if (!target.toLowerCase().startsWith(root.toLowerCase())) return chain
  if (target.length > root.length && !/[\\/]/.test(target[root.length])) return chain

  const separator = root.includes('\\') ? '\\' : '/'
  const parts = target.slice(root.length).split(/[\\/]/).filter(Boolean)
  let cursor = root
  for (const part of parts) {
    cursor = `${cursor}${separator}${part}`
    chain.push(cursor)
  }
  return chain
}

export function useWorkspaceBrowser(options: {
  rootDir: () => string
  showHiddenFiles: () => boolean
}) {
  const currentDir = ref('')
  const ancestors = ref<string[]>([])
  const entries = ref<WorkspaceEntry[]>([])
  const searchResults = ref<WorkspaceEntry[]>([])
  const searchQuery = ref('')
  const isLoading = ref(false)

  const isSearching = computed(() => searchQuery.value.trim().length > 0)
  const visibleEntries = computed(() => (isSearching.value ? searchResults.value : entries.value))
  const canGoUp = computed(() => ancestors.value.length > 1)

  let dirToken = 0
  let searchToken = 0
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  async function loadDir(dir: string) {
    const token = ++dirToken
    currentDir.value = dir
    ancestors.value = buildAncestorChain(options.rootDir(), dir)
    entries.value = []
    isLoading.value = true
    try {
      const raw = await api.readDir(dir)
      if (token !== dirToken) return
      entries.value = sortWorkspaceEntries(
        raw.filter(entry => isWorkspaceEntryVisible(entry.name, options.showHiddenFiles())),
      ).map(entry => ({
        name: entry.name,
        path: entry.path,
        relativePath: buildRelativePath(options.rootDir(), entry.path),
        isDirectory: entry.isDirectory,
      }))
    } catch (error) {
      console.error('Failed to read workspace directory:', error)
      if (token === dirToken) entries.value = []
    } finally {
      if (token === dirToken) isLoading.value = false
    }
  }

  async function runSearch(term: string) {
    const root = options.rootDir()
    if (!root) return
    const token = ++searchToken
    isLoading.value = true
    try {
      const found = await api.searchFiles(root, term, { maxResults: 100 })
      if (token !== searchToken) return
      searchResults.value = sortWorkspaceEntries(
        found.filter(entry => isWorkspaceEntryVisible(entry.name, options.showHiddenFiles())),
      ).map(entry => ({
        name: entry.name,
        path: entry.path,
        relativePath: entry.relativePath || buildRelativePath(root, entry.path),
        isDirectory: entry.isDirectory,
      }))
    } catch (error) {
      console.error('Failed to search workspace files:', error)
      if (token === searchToken) searchResults.value = []
    } finally {
      if (token === searchToken) isLoading.value = false
    }
  }

  watch(searchQuery, query => {
    if (searchTimer) clearTimeout(searchTimer)
    const term = query.trim()
    if (!term) {
      searchResults.value = []
      return
    }
    searchTimer = setTimeout(() => runSearch(term), 150)
  })

  function open() {
    searchQuery.value = ''
    searchResults.value = []
    loadDir(options.rootDir())
  }

  function clearSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    searchQuery.value = ''
    searchResults.value = []
  }

  /** 进入目录；搜索结果中的目录会先退回浏览视图 */
  function enter(entry: WorkspaceEntry): boolean {
    if (!entry.isDirectory) return false
    if (isSearching.value) clearSearch()
    loadDir(entry.path)
    return true
  }

  function goUp() {
    if (!canGoUp.value) return
    loadDir(ancestors.value[ancestors.value.length - 2])
  }

  return {
    currentDir,
    ancestors,
    visibleEntries,
    searchQuery,
    isLoading,
    isSearching,
    canGoUp,
    open,
    enter,
    goUp,
    clearSearch,
  }
}
