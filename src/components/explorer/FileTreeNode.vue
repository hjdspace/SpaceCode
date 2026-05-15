<template>
  <div
    class="tree-node"
    :style="{ paddingLeft: depth * 12 + 'px' }"
  >
    <div
      class="node-content"
      :class="[
        { selected: isSelected, 'is-directory': node.type === 'directory' },
        { 'file-tree-flash': isHighlighted }
      ]"
      :id="isHighlighted ? 'file-tree-highlight' : undefined"
      draggable="true"
      @click="handleClick"
      @dragstart="handleDragStart"
    >
      <!-- Expand/Collapse Button for Directories -->
      <button
        v-if="node.type === 'directory'"
        class="expand-btn"
        @click.stop="handleToggle"
      >
        <ChevronRight
          :size="14"
          :class="{ expanded: isExpanded }"
        />
      </button>
      <span v-else class="spacer" />

      <!-- File/Folder Icon -->
      <component
        :is="getIconComponent()"
        :size="16"
        class="node-icon"
        :class="[getIconClass(), { 'icon-folder': node.type === 'directory' }]"
      />

      <!-- Node Name -->
      <span class="node-name" :class="{ highlighted: isSearchMatch }">
        {{ node.name }}
      </span>
    </div>

    <!-- Children (only show if directory and expanded) -->
    <Transition name="expand">
      <div
        v-if="node.type === 'directory' && isExpanded && node.children"
        class="node-children"
      >
        <FileTreeNode
          v-for="child in node.children"
          :key="child.path"
          :node="child"
          :depth="depth + 1"
          :search-query="searchQuery"
          :highlight-path="highlightPath"
          :expanded-paths="expandedPaths"
          @select="$emit('select', $event)"
          @toggle="$emit('toggle', $event)"
          @expand-path="$emit('expand-path', $event)"
        />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
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

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
  extension?: string
}

interface Props {
  node: TreeNode
  depth: number
  searchQuery?: string
  highlightPath?: string
  expandedPaths?: Set<string>
}

const props = withDefaults(defineProps<Props>(), {
  searchQuery: '',
  highlightPath: '',
  expandedPaths: () => new Set()
})

const emit = defineEmits<{
  select: [node: TreeNode]
  toggle: [node: TreeNode]
  'expand-path': [path: string]
}>()

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

// Methods
function handleClick() {
  if (props.node.type === 'directory') {
    handleToggle()
  } else {
    emit('select', props.node)
  }
}

function handleToggle() {
  emit('toggle', props.node)
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
.tree-node {
  user-select: none;
}

.node-content {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
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
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    transition: height var(--transition-fast);
  }

  &:hover {
    background: var(--surface-glass-hover);

    &::before {
      height: 10px;
    }
  }

  &.selected {
    background: var(--surface-glass-active);

    .node-name {
      color: var(--text-primary);
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
    transition: transform 0.15s ease-out;

    &.expanded {
      transform: rotate(90deg);
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

.node-children {
  overflow: hidden;
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
