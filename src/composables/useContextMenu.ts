/**
 * useContextMenu - @ context menu logic extracted from ChatInput.vue
 *
 * Manages:
 * - @ trigger detection
 * - Context item search and navigation
 * - File/folder selection
 */
import { ref, computed, nextTick } from 'vue'
import { api } from '@/services/electronAPI'

export interface ContextItem {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
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
  const contextSearchInput = ref<HTMLInputElement | null>(null)
  const contextListRef = ref<HTMLElement | null>(null)
  const highlightedContextItem = ref<string | null>(null)
  const contextTriggerPosition = ref<number>(-1)
  const contextMenuPosition = ref<{ top?: string; bottom?: string; left: string }>({ top: '0px', left: '0px' })
  const contextItems = ref<ContextItem[]>([])
  const isLoadingContext = ref(false)

  // Filtered items (server-side search, client just uses results)
  const filteredContextItems = computed<ContextItem[]>(() => {
    return contextItems.value
  })

  // Load context items from file search
  async function loadContextItems() {
    const workingDirectory = options?.workingDirectory?.()
    if (!workingDirectory) return

    isLoadingContext.value = true
    try {
      const query = contextSearchQuery.value
      const entries = await api.searchFiles(workingDirectory, query, { maxResults: 100 })

      if (!showContextMenu.value) return

      const items: ContextItem[] = entries.map(entry => ({
        name: entry.name,
        path: entry.path,
        relativePath: entry.relativePath,
        type: entry.isDirectory ? 'directory' : 'file'
      }))

      contextItems.value = items
      highlightedContextItem.value = getInitialHighlight(items)
    } catch (error) {
      console.error('Failed to load context items:', error)
      contextItems.value = []
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
    contextSearchInput,
    contextListRef,
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
