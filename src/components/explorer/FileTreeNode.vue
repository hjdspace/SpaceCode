<template>
  <div
    class="tree-node"
    :style="{ '--tree-indent': depth }"
    role="treeitem"
    :aria-expanded="node.type === 'directory' ? isExpanded : undefined"
    :aria-selected="isSelected"
  >
    <div
      class="node-content"
      :class="[
        { 'is-directory': node.type === 'directory' },
        { 'file-tree-flash': isHighlighted }
      ]"
      :id="isHighlighted ? 'file-tree-highlight' : undefined"
      :data-selected="isSelected ? '' : undefined"
      :data-expanded="isExpanded ? '' : undefined"
      draggable="true"
      @click="handleClick"
      @dragstart="handleDragStart"
      @contextmenu.prevent="handleContextMenu"
    >
      <!-- Expand/Collapse Button for Directories -->
      <button
        v-if="node.type === 'directory'"
        class="expand-btn"
        @click.stop="handleToggle"
      >
        <ChevronRight
          :size="12"
          :class="{ expanded: isExpanded }"
        />
      </button>
      <span v-else class="spacer" />

      <!-- File/Folder Icon -->
      <component
        :is="getIconComponent()"
        :size="14"
        class="node-icon"
        :class="[getIconClass(), { 'icon-folder': node.type === 'directory' }]"
      />

      <!-- Node Name (or inline rename input) -->
      <input
        v-if="isRenaming"
        ref="renameInputRef"
        class="rename-input"
        :value="renameValue"
        @blur="confirmRename"
        @keydown.enter="confirmRename"
        @keydown.escape="cancelRename"
        @click.stop
        @mousedown.stop
      />
      <span
        v-else
        class="node-name"
        :class="[{ highlighted: isSearchMatch }, markClass]"
      >
        {{ node.name }}
      </span>

      <!-- Git decorations: letter for files, dot for folders -->
      <span
        v-if="fileMark"
        class="git-mark"
        :class="markClass"
        :title="t(FILE_MARK_TOOLTIP_KEY[fileMark.kind])"
      >{{ fileMark.letter }}</span>
      <span
        v-else-if="dirMark"
        class="dir-mark"
        :class="markClass"
        :title="t(DIR_MARK_TOOLTIP_KEY[dirMark])"
      />
    </div>

    <!-- Children (only show if directory and expanded) -->
    <Transition name="expand">
      <div
        v-if="node.type === 'directory' && isExpanded && node.children"
        class="node-children"
        role="group"
      >
        <FileTreeNode
          v-for="child in node.children"
          :key="child.path"
          :node="child"
          :depth="depth + 1"
          :search-query="searchQuery"
          :highlight-path="highlightPath"
          :expanded-paths="expandedPaths"
          :git-marks="gitMarks"
          @select="$emit('select', $event)"
          @toggle="$emit('toggle', $event)"
          @expand-path="$emit('expand-path', $event)"
          @contextmenu="$emit('contextmenu', $event, child)"
        />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  Braces,
  FileType
} from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useDialog } from '@/composables/useDialog'
import { normalizeTreePath } from '@/composables/useGitTreeMarks'
import type { GitFileMark, GitFileMarkKind, GitDirMarkKind, GitTreeMarks } from '@/composables/useGitTreeMarks'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
  extension?: string
  isRoot?: boolean
}

interface Props {
  node: TreeNode
  depth: number
  searchQuery?: string
  highlightPath?: string
  expandedPaths?: Set<string>
  gitMarks?: GitTreeMarks
}

const props = withDefaults(defineProps<Props>(), {
  searchQuery: '',
  highlightPath: '',
  expandedPaths: () => new Set(),
  gitMarks: () => ({ files: new Map(), dirs: new Map() })
})

const emit = defineEmits<{
  select: [node: TreeNode]
  toggle: [node: TreeNode]
  'expand-path': [path: string]
  'add-to-chat': [node: TreeNode]
  refresh: []
  contextmenu: [event: MouseEvent, node: TreeNode]
}>()

const { showAlert } = useDialog()
const { t } = useI18n()

const FILE_MARK_TOOLTIP_KEY: Record<GitFileMarkKind, string> = {
  modified: 'fileTree.gitMarkModified',
  added: 'fileTree.gitMarkAdded',
  untracked: 'fileTree.gitMarkUntracked',
  deleted: 'fileTree.gitMarkDeleted',
  renamed: 'fileTree.gitMarkRenamed',
  copied: 'fileTree.gitMarkCopied',
  conflict: 'fileTree.gitMarkConflict'
}

const DIR_MARK_TOOLTIP_KEY: Record<GitDirMarkKind, string> = {
  modified: 'fileTree.gitMarkDirModified',
  added: 'fileTree.gitMarkDirAdded'
}

// Rename State
const isRenaming = ref(false)
const renameValue = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)

// Computed
const isExpanded = computed(() => {
  return props.expandedPaths.has(props.node.path)
})

const isHighlighted = computed(() => {
  return props.node.path === props.highlightPath
})

const isSearchMatch = computed(() => {
  if (!props.searchQuery) return false
  return props.node.name.toLowerCase().includes(props.searchQuery.toLowerCase())
})

const isSelected = ref(false) // Could be controlled by parent in future

const normalizedPath = computed(() => normalizeTreePath(props.node.path))

const fileMark = computed<GitFileMark | null>(() => {
  if (props.node.type !== 'file') return null
  return props.gitMarks.files.get(normalizedPath.value) ?? null
})

const dirMark = computed<GitDirMarkKind | null>(() => {
  if (props.node.type !== 'directory') return null
  return props.gitMarks.dirs.get(normalizedPath.value) ?? null
})

const markClass = computed(() => {
  const kind = fileMark.value?.kind ?? dirMark.value
  return kind ? `git-${kind}` : ''
})

// Methods
function handleClick() {
  if (isRenaming.value) return
  if (props.node.type === 'directory') {
    handleToggle()
  } else {
    emit('select', props.node)
  }
}

function handleToggle() {
  if (isRenaming.value) return
  emit('toggle', props.node)
}

function handleContextMenu(e: MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  
  // Emit event to parent (FileTree) to show global context menu
  emit('contextmenu', e, props.node)
}

function startRename() {
  isRenaming.value = true
  renameValue.value = props.node.name
  nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

async function confirmRename() {
  if (!isRenaming.value) return
  
  const newName = renameValue.value.trim()
  if (!newName || newName === props.node.name) {
    cancelRename()
    return
  }
  
  try {
    const result = await api.renameFile(props.node.path, newName)
    if (result.success) {
      console.log('[FileTreeNode] Renamed to:', newName)
      emit('refresh')
    } else {
      await showAlert(`重命名失败：${result.error}`)
      cancelRename()
    }
  } catch (err) {
    console.error('[FileTreeNode] Rename error:', err)
    await showAlert('重命名失败，请重试。')
    cancelRename()
  }
  
  isRenaming.value = false
}

function cancelRename() {
  isRenaming.value = false
  renameValue.value = ''
}

function handleDragStart(e: DragEvent) {
  if (!e.dataTransfer) return
  
  e.dataTransfer.effectAllowed = 'copy'
  e.dataTransfer.setData('application/x-claude-path', props.node.path)
  e.dataTransfer.setData('application/x-claude-type', props.node.type)
  e.dataTransfer.setData('text/plain', props.node.path)
  
  console.log('[FileTreeNode] Drag start:', props.node.path, props.node.type)
}

function getIconComponent() {
  if (props.node.type === 'directory') {
    return isExpanded.value ? FolderOpen : Folder
  }

  const ext = props.node.extension?.toLowerCase()

  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'vue', 'svelte', 'c', 'cpp', 'h', 'hpp', 'cs', 'swift', 'kt', 'dart', 'lua', 'php', 'zig']
  const configExts = ['json', 'yaml', 'yml', 'toml']
  const styleExts = ['css', 'scss', 'sass', 'less']
  const textExts = ['md', 'mdx', 'txt', 'csv', 'rst']

  if (ext && codeExts.includes(ext)) return FileCode
  if (ext && configExts.includes(ext)) return FileType
  if (ext && styleExts.includes(ext)) return Braces
  if (ext && textExts.includes(ext)) return FileText

  return File
}

function getIconClass(): string {
  if (props.node.type === 'directory') return ''

  const ext = props.node.extension?.toLowerCase()
  
  const iconMap: Record<string, string> = {
    'ts': 'icon-typescript',
    'tsx': 'icon-typescript',
    'js': 'icon-javascript',
    'jsx': 'icon-javascript',
    'vue': 'icon-vue',
    'py': 'icon-python',
    'json': 'icon-json',
    'css': 'icon-style',
    'scss': 'icon-style',
    'sass': 'icon-style',
    'less': 'icon-style'
  }

  return iconMap[ext || ''] || ''
}
</script>

<style lang="scss" scoped>
/* Git 语义色: 徽标字母、文件名、目录圆点共用一套 tint, 保证标记与文字联动.
   放在最后声明, 让标记色稳定压过 .node-name 的默认前景色. */
@mixin git-tint {
  &.git-modified { color: var(--warning); }
  &.git-added,
  &.git-untracked { color: var(--success); }
  &.git-deleted,
  &.git-conflict { color: var(--error); }
  &.git-renamed,
  &.git-copied { color: var(--info); }
}

.tree-node {
  user-select: none;
}

.node-content {
  display: flex;
  align-items: center;
  gap: 6px;
  /* reka-ui tree: 缩进落在行内 padding 上 (基准 0.5rem + 每级 1rem),
     这样 hover / selected 底色能铺满整行而不是随层级缩短 */
  padding: 4px 8px 4px calc(0.5rem + var(--tree-indent, 0) * 1rem);
  margin: 2px 0;
  min-height: 20px;
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: background var(--transition-fast);
  position: relative;

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 2px;
    height: 0;
    background: var(--accent-primary);
    border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
    transition: height var(--transition-fast);
  }

  &:hover {
    background: var(--surface-glass-hover);

    &::before {
      height: 10px;
    }
  }

  &[data-selected] {
    background: var(--surface-glass-active);

    .node-name {
      font-weight: 500;
    }

    &::before {
      height: 18px;
      box-shadow: 0 0 6px rgba(var(--accent-primary-rgb), 0.4);
    }
  }

  &.is-directory {
    .node-icon {
      color: var(--accent-secondary);
    }

    .node-name {
      font-weight: 500;
    }
  }
}

.expand-btn {
  width: 16px;
  height: 16px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }

  svg {
    opacity: 0.6;
    transition: transform 0.15s ease-out, opacity var(--transition-fast);

    &.expanded {
      transform: rotate(90deg);
      opacity: 1;
    }
  }
}

.spacer {
  width: 16px;
  display: inline-block;
}

.node-icon {
  flex-shrink: 0;
  transition: color var(--transition-fast);

  &.icon-typescript {
    color: #3178c6;
  }

  &.icon-javascript {
    color: #f7df1e;
  }

  &.icon-vue {
    color: #42b883;
  }

  &.icon-python {
    color: #3776ab;
  }

  &.icon-json {
    color: #cbcb41;
  }

  &.icon-style {
    color: var(--accent-tertiary);
  }

  &.icon-folder {
    color: var(--accent-secondary);
  }
}

.node-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--transition-fast);

  &.highlighted {
    font-weight: 500;
    
    // Highlight matched text (could use a more sophisticated approach)
    background: linear-gradient(
      to bottom,
      transparent 50%,
      rgba(var(--accent-primary-rgb), 0.15) 50%,
      rgba(var(--accent-primary-rgb), 0.15) 100%
    );
  }
}

.git-mark {
  flex-shrink: 0;
  padding-left: 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.dir-mark {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: var(--radius-full);
  background: currentColor;
}

.rename-input {
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--accent-primary);
  border-radius: 3px;
  padding: 1px 4px;
  outline: none;
  min-width: 100px;
  flex: 1;
}

.node-children {
  overflow: hidden;
}

.node-name,
.git-mark,
.dir-mark {
  @include git-tint;
}

// Expand/Collapse Animation
.expand-enter-active,
.expand-leave-active {
  transition: all 0.15s ease-out;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
