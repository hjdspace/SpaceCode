<template>
  <div class="file-tree">
    <!-- Search Bar + Refresh Button -->
    <div class="tree-toolbar">
      <div class="search-container">
        <Search :size="12" class="search-icon" />
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="Filter files..."
          @input="handleSearch"
        />
      </div>
      <button
        class="refresh-btn"
        :class="{ loading }"
        :title="'Refresh file tree'"
        @click="refreshTree"
        :disabled="loading"
      >
        <RefreshCw :size="12" :class="{ 'animate-spin': loading }" />
      </button>
    </div>

    <!-- Tree Content -->
    <div class="tree-content" ref="treeContentRef">
      <!-- Loading State -->
      <div v-if="loading && treeData.length === 0" class="loading-state">
        <RefreshCw :size="16" class="animate-spin" />
      </div>

      <!-- Empty State -->
      <div v-else-if="treeData.length === 0" class="empty-state">
        <span>{{ error || (workingDirectory ? 'No files' : 'Select a folder') }}</span>
      </div>

      <!-- Tree Nodes -->
      <div v-else class="nodes-container">
        <FileTreeNode
          v-for="node in filteredTreeData"
          :key="node.path"
          :node="node"
          :depth="0"
          :search-query="searchQuery"
          :highlight-path="highlightPath"
          :expanded-paths="expandedPaths"
          @select="handleSelect"
          @toggle="handleToggle"
          @expand-path="handleExpandPath"
          @add-to-chat="handleAddToChat"
          @refresh="refreshTree"
          @contextmenu="handleContextMenu"
        />
      </div>
    </div>

    <!-- Global Context Menu (singleton) -->
    <FileContextMenu
      :visible="contextMenuState.visible"
      :node="contextMenuState.node"
      :x="contextMenuState.x"
      :y="contextMenuState.y"
      @close="closeContextMenu"
      @cut="handleCut"
      @copy="handleCopy"
      @add-to-chat="handleAddToChatFromMenu"
      @rename="handleRename"
      @delete="handleDelete"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, reactive } from 'vue'
import { Search, RefreshCw, FolderOpen } from 'lucide-vue-next'
import FileTreeNode from './FileTreeNode.vue'
import FileContextMenu from './FileContextMenu.vue'
import { api } from '@/services/electronAPI'
import { useAppStore } from '@/stores/app'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
  extension?: string
}

interface Props {
  workingDirectory?: string
  highlightPath?: string
  highlightSeek?: string
}

const props = withDefaults(defineProps<Props>(), {
  workingDirectory: '',
  highlightPath: '',
  highlightSeek: ''
})

const emit = defineEmits<{
  select: [node: TreeNode]
  'add-to-chat': [node: TreeNode]
}>()

const appStore = useAppStore()
const treeContentRef = ref<HTMLElement>()

// State
const treeData = ref<TreeNode[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const searchQuery = ref('')
const expandedPaths = ref<Set<string>>(new Set())
const abortController = ref<AbortController | null>(null)
const seekKeyRef = ref<string | null>(null)

// Global Context Menu State (singleton)
const contextMenuState = reactive({
  visible: false,
  node: null as TreeNode | null,
  x: 0,
  y: 0
})

// Computed
const filteredTreeData = computed(() => {
  if (!searchQuery.value) return treeData.value
  return filterTree(treeData.value, searchQuery.value.toLowerCase())
})

// Methods
function getFileIcon(extension?: string) {
  // This is handled by FileTreeNode component now
  return null
}

function containsMatch(node: TreeNode, query: string): boolean {
  if (node.name.toLowerCase().includes(query)) return true
  if (node.children) {
    return node.children.some(child => containsMatch(child, query))
  }
  return false
}

function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes
  
  return nodes
    .filter(node => containsMatch(node, query))
    .map(node => ({
      ...node,
      children: node.children ? filterTree(node.children, query) : undefined
    }))
}

async function loadDirectory(path: string, depth: number = 0): Promise<TreeNode[]> {
  try {
    const entries = await api.readDir(path)
    
    // Filter out hidden files and node_modules
    const filteredEntries = entries.filter(entry => 
      !entry.name.startsWith('.') && entry.name !== 'node_modules'
    )
    
    // Sort: directories first, then by name
    filteredEntries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })
    
    return await Promise.all(filteredEntries.map(async (entry) => {
      const node: TreeNode = {
        name: entry.name,
        path: entry.path,
        type: entry.isDirectory ? 'directory' : 'file',
        extension: !entry.isDirectory ? entry.name.split('.').pop() : undefined
      }
      
      // Load children for directories (with depth limit to avoid performance issues)
      if (entry.isDirectory && depth < 3) {
        try {
          node.children = await loadDirectory(entry.path, depth + 1)
        } catch {
          // If we can't read a directory, just leave it as collapsed
          node.children = []
        }
      } else if (entry.isDirectory) {
        node.children = []
      }
      
      return node
    }))
  } catch (err) {
    console.error(`Failed to load directory ${path}:`, err)
    throw err
  }
}

async function fetchTree() {
  // Cancel any in-flight request
  if (abortController.value) {
    abortController.value.abort()
  }

  const rootPath = props.workingDirectory || appStore.projectRoot

  if (!rootPath) {
    treeData.value = []
    error.value = null
    loading.value = false
    abortController.value = null
    return
  }

  const controller = new AbortController()
  abortController.value = controller

  loading.value = true
  error.value = null

  try {
    treeData.value = await loadDirectory(rootPath)
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      error.value = 'Failed to load file tree'
      console.error('Error loading file tree:', err)
      treeData.value = []
    }
  } finally {
    if (!controller.signal.aborted) {
      loading.value = false
    }
  }
}

function refreshTree() {
  fetchTree()
}

function handleSearch() {
  // Search is reactive via computed property
  // Could add debounce here if needed
}

function handleToggle(node: TreeNode) {
  const path = node.path
  const next = new Set(expandedPaths.value)
  
  if (next.has(path)) {
    next.delete(path)
  } else {
    next.add(path)
  }
  
  expandedPaths.value = next
}

function handleExpandPath(path: string) {
  const next = new Set(expandedPaths.value)
  next.add(path)
  expandedPaths.value = next
}

function handleSelect(node: TreeNode) {
  if (node.type === 'file') {
    emit('select', node)
  }
}

function handleAddToChat(node: TreeNode) {
  emit('add-to-chat', node)
}

// Context Menu Handlers
function handleContextMenu(e: MouseEvent, node: TreeNode) {
  e.preventDefault()
  e.stopPropagation()
  
  // Calculate menu position (prevent overflow)
  const menuWidth = 200
  const menuHeight = 280
  const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10)
  const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10)
  
  // Update global state (this will automatically close any previous menu)
  contextMenuState.visible = true
  contextMenuState.node = node
  contextMenuState.x = x
  contextMenuState.y = y
}

function closeContextMenu() {
  contextMenuState.visible = false
  contextMenuState.node = null
}

async function handleCut(node: TreeNode) {
  try {
    await navigator.clipboard.writeText(node.path)
    localStorage.setItem('clipboard_operation', JSON.stringify({
      type: 'cut',
      path: node.path,
      name: node.name,
      nodeType: node.type
    }))
    console.log('[FileTree] Cut:', node.path)
  } catch (err) {
    console.error('[FileTree] Cut failed:', err)
  }
}

async function handleCopy(node: TreeNode) {
  try {
    await navigator.clipboard.writeText(node.path)
    localStorage.setItem('clipboard_operation', JSON.stringify({
      type: 'copy',
      path: node.path,
      name: node.name,
      nodeType: node.type
    }))
    console.log('[FileTree] Copied:', node.path)
  } catch (err) {
    console.error('[FileTree] Copy failed:', err)
  }
}

function handleAddToChatFromMenu(node: TreeNode) {
  emit('add-to-chat', node)
}

function handleRename(node: TreeNode) {
  // For now, just refresh the tree after rename
  // TODO: Implement inline rename at FileTree level if needed
  console.log('[FileTree] Rename requested for:', node.path)
  refreshTree()
}

function handleDelete(node: TreeNode) {
  // Refresh tree after deletion
  refreshTree()
}

// Get parent paths for auto-expansion
function getParentPaths(filePath: string): string[] {
  const parents: string[] = []
  let current = filePath
  
  while (true) {
    const parent = current.substring(0, current.lastIndexOf('/'))
    if (!parent || parent === current) break
    parents.push(parent)
    current = parent
  }
  
  return parents
}

// Auto-expand to highlighted file and scroll to it
async function scrollToHighlight() {
  if (!props.highlightPath || treeData.value.length === 0) return
  
  const targetKey = `${props.workingDirectory}::${props.highlightPath}::${props.highlightSeek || ''}`
  
  // Avoid re-triggering on same target
  if (seekKeyRef.value === targetKey) return
  
  // Expand all parent paths
  const parentPaths = getParentPaths(props.highlightPath)
  const nextExpanded = new Set(expandedPaths.value)
  
  for (const parent of parentPaths) {
    nextExpanded.add(parent)
  }
  nextExpanded.add(props.highlightPath)
  
  expandedPaths.value = nextExpanded
  
  // Wait for DOM update then scroll
  await nextTick()
  
  let attempts = 0
  const maxAttempts = 15
  
  const interval = setInterval(() => {
    attempts++
    const el = document.getElementById('file-tree-highlight')
    
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      seekKeyRef.value = targetKey
      clearInterval(interval)
    } else if (attempts >= maxAttempts) {
      clearInterval(interval)
    }
  }, 100)
}

// Watchers
watch([() => props.workingDirectory, () => appStore.projectRoot], () => {
  treeData.value = []
  error.value = null
  seekKeyRef.value = null
  fetchTree()
}, { immediate: true })

watch([() => props.highlightPath, () => props.highlightSeek], () => {
  scrollToHighlight()
})

// Listen for refresh events
onMounted(() => {
  window.addEventListener('refresh-file-tree', refreshTree)
})

onUnmounted(() => {
  window.removeEventListener('refresh-file-tree', refreshTree)
  if (abortController.value) {
    abortController.value.abort()
  }
})
</script>

<style lang="scss" scoped>
.file-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: transparent;
}

.tree-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.search-container {
  position: relative;
  flex: 1;
  min-width: 0;

  .search-icon {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
  }
}

.search-input {
  width: 100%;
  height: 28px;
  padding: 0 8px 0 28px;
  font-size: 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: var(--surface-glass);
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--transition-fast);

  &::placeholder {
    color: var(--text-muted);
    opacity: 0.6;
  }

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px rgba(var(--accent-primary-rgb), 0.1);
  }
}

.refresh-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);

  &:hover:not(:disabled) {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.tree-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;

  @include scrollbar-thin;
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px;
  color: var(--text-muted);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  text-align: center;

  span {
    font-size: 12px;
    color: var(--text-muted);
  }
}

.nodes-container {
  padding: 4px 0;
}

// Highlight flash animation for selected file
@keyframes file-tree-flash {
  0%, 100% {
    background-color: transparent;
  }
  50% {
    background-color: rgba(var(--accent-primary-rgb), 0.15);
  }
}

.file-tree-flash {
  animation: file-tree-flash 0.6s ease-in-out 2;
}
</style>
