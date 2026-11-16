/**
 * useContextMenu - @ context menu logic extracted from ChatInput.vue
 *
 * Manages:
 * - @ trigger detection
 * - Context item search and navigation
 * - File/folder/todo selection
 */
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import { useTodoStore } from '@/stores/todo'
import type { TodoStatus } from '@/shared/channels/todo'

export interface ContextItem {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory' | 'todo'
  /** type === 'todo' 时：待办本体信息，供菜单渲染徽标与插入 chip */
  todoId?: string
  todoStatus?: TodoStatus
  todoDueAt?: number
}

/** todo 项的 path 只用于列表 key / 高亮，加前缀避免与真实文件路径撞车。 */
export function todoContextPath(id: string): string {
  return `todo:${id}`
}

// ── Pure logic (exported for testing) ──────────────────────────

/** Check if text before cursor triggers @ context menu */
export function checkContextTrigger(textBeforeCursor: string): { triggered: boolean; query: string; triggerPosition: number } | null {
  const lastAtIndex = textBeforeCursor.lastIndexOf('@')
  if (lastAtIndex === -1) return null

  const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
  const hasInvalidChar = /[\s\n]/.test(textAfterAt)

  if (hasInvalidChar) return null

  return {
    triggered: true,
    query: textAfterAt,
    triggerPosition: lastAtIndex,
  }
}

/** Navigate through context items */
export function navigateContextItems(
  items: ContextItem[],
  currentHighlightedPath: string | null,
  direction: number
): string | null {
  if (items.length === 0) return null

  const currentIndex = items.findIndex(i => i.path === currentHighlightedPath)
  let newIndex = currentIndex + direction

  if (newIndex < 0) newIndex = items.length - 1
  if (newIndex >= items.length) newIndex = 0

  return items[newIndex].path
}

/** Get the first item's path for initial highlight */
export function getInitialHighlight(items: ContextItem[]): string | null {
  return items.length > 0 ? items[0].path : null
}

// ── Composable ─────────────────────────────────────────────────

export function useContextMenu(options?: {
  workingDirectory?: () => string
}) {
  const showContextMenu = ref(false)
  const contextSearchQuery = ref('')
  const highlightedContextItem = ref<string | null>(null)
  const contextTriggerPosition = ref<number>(-1)
  const contextMenuPosition = ref<{ top?: string; bottom?: string; left: string }>({ top: '0px', left: '0px' })
  const contextItems = ref<ContextItem[]>([])
  const isLoadingContext = ref(false)

  // Filtered items (server-side search, client just uses results)
  const filteredContextItems = computed<ContextItem[]>(() => {
    return contextItems.value
  })

  // Load context items: todo 引用排在文件之前，没有工作区时也要能引用待办
  async function loadContextItems() {
    const todoStore = useTodoStore()
    const query = contextSearchQuery.value
    const todoItems: ContextItem[] = todoStore.searchForReference(query, 6).map(todo => ({
      name: todo.title,
      path: todoContextPath(todo.id),
      relativePath: todo.groupId ? (todoStore.groupById.get(todo.groupId)?.name ?? '') : '',
      type: 'todo',
      todoId: todo.id,
      todoStatus: todo.status,
      todoDueAt: todo.dueAt,
    }))

    isLoadingContext.value = true
    try {
      const workingDirectory = options?.workingDirectory?.()
      const entries = workingDirectory
        ? await api.searchFiles(workingDirectory, query, { maxResults: 100 })
        : []

      if (!showContextMenu.value) return

      const items: ContextItem[] = [
        ...todoItems,
        ...entries.map(entry => ({
          name: entry.name,
          path: entry.path,
          relativePath: entry.relativePath,
          type: entry.isDirectory ? 'directory' as const : 'file' as const,
        })),
      ]

      contextItems.value = items
      highlightedContextItem.value = getInitialHighlight(items)
    } catch (error) {
      console.error('Failed to load context items:', error)
      contextItems.value = todoItems
      highlightedContextItem.value = getInitialHighlight(todoItems)
    } finally {
      isLoadingContext.value = false
    }
  }

  function closeContextMenu() {
    showContextMenu.value = false
    contextSearchQuery.value = ''
    contextTriggerPosition.value = -1
    highlightedContextItem.value = null
  }

  function clearContextSearch() {
    const queryLen = contextSearchQuery.value.length
    contextSearchQuery.value = ''
    return { queryLen, triggerPosition: contextTriggerPosition.value }
  }

  return {
    // State
    showContextMenu,
    contextSearchQuery,
    highlightedContextItem,
    contextTriggerPosition,
    contextMenuPosition,
    contextItems,
    isLoadingContext,

    // Computed
    filteredContextItems,

    // Actions
    loadContextItems,
    closeContextMenu,
    clearContextSearch,
  }
}
