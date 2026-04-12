<template>
  <div
    class="tree-node"
    :style="{ paddingLeft: depth * 12 + 'px' }"
  >
    <div
      class="node-content"
      :class="{ selected: isSelected, 'is-directory': node.type === 'directory' }"
      @click="handleClick"
    >
      <button
        v-if="node.type === 'directory'"
        class="expand-btn"
        @click.stop="handleToggle"
      >
        <ChevronRight :size="14" :class="{ expanded: node.isExpanded }" />
      </button>
      <span v-else class="spacer"></span>
      
      <component
        :is="getIcon(node)"
        :size="16"
        class="node-icon"
        :class="getIconClass(node)"
      />
      
      <span class="node-name">{{ node.name }}</span>
    </div>
    
    <div v-if="node.isExpanded && node.children" class="node-children">
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        @select="$emit('select', $event)"
        @toggle="$emit('toggle', $event)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FileCode,
  FileText,
  FileJson,
  Braces
} from 'lucide-vue-next'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
  isExpanded?: boolean
  isLoaded?: boolean
}

const props = defineProps<{
  node: TreeNode
  depth: number
}>()

const emit = defineEmits<{
  select: [node: TreeNode]
  toggle: [node: TreeNode]
}>()

const isSelected = ref(false)

function handleClick() {
  isSelected.value = true
  if (props.node.type === 'directory') {
    emit('toggle', props.node)
  } else {
    emit('select', props.node)
  }
}

function handleToggle() {
  emit('toggle', props.node)
}

function getIcon(node: TreeNode) {
  if (node.type === 'directory') {
    return node.isExpanded ? FolderOpen : Folder
  }
  
  const ext = node.name.split('.').pop()?.toLowerCase()
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'vue', 'svelte']
  const configExts = ['json', 'yaml', 'yml', 'toml']
  const styleExts = ['css', 'scss', 'sass', 'less']
  
  if (ext && configExts.includes(ext)) {
    return FileJson
  }
  if (ext && codeExts.includes(ext)) {
    return FileCode
  }
  if (ext && styleExts.includes(ext)) {
    return Braces
  }
  if (ext && ['md', 'txt', 'rst'].includes(ext)) {
    return FileText
  }
  return File
}

function getIconClass(node: TreeNode) {
  if (node.type === 'directory') {
    return 'icon-folder'
  }
  
  const ext = node.name.split('.').pop()?.toLowerCase()
  const tsExts = ['ts', 'tsx']
  const jsExts = ['js', 'jsx']
  const vueExts = ['vue']
  const pyExts = ['py']
  const jsonExts = ['json']
  const styleExts = ['css', 'scss', 'sass', 'less']
  
  if (ext && tsExts.includes(ext)) return 'icon-typescript'
  if (ext && jsExts.includes(ext)) return 'icon-javascript'
  if (ext && vueExts.includes(ext)) return 'icon-vue'
  if (ext && pyExts.includes(ext)) return 'icon-python'
  if (ext && jsonExts.includes(ext)) return 'icon-json'
  if (ext && styleExts.includes(ext)) return 'icon-style'
  
  return ''
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
  padding: 6px 8px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
  
  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 0;
    background: var(--accent-primary);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    transition: height var(--transition-fast);
  }
  
  &:hover {
    background: var(--surface-glass-hover);
    
    &::before {
      height: 12px;
    }
  }
  
  &.selected {
    background: var(--surface-glass-active);
    
    &::before {
      height: 20px;
      box-shadow: 0 0 8px var(--accent-primary-glow);
    }
    
    .node-name {
      color: var(--text-primary);
      font-weight: 500;
    }
  }
  
  &.is-directory {
    .node-icon {
      color: var(--accent-secondary);
    }
  }
}

.expand-btn {
  width: 18px;
  height: 18px;
  padding: 0;
  background: transparent;
  color: var(--text-muted);
  @include flex-center;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  
  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
  
  svg {
    transition: transform var(--transition-fast);
  }
  
  .expanded {
    transform: rotate(90deg);
  }
}

.spacer {
  width: 18px;
}

.node-icon {
  flex-shrink: 0;
  transition: all var(--transition-fast);
  
  &.icon-folder {
    color: var(--accent-secondary);
  }
  
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
}

.node-name {
  font-size: 13px;
  color: var(--text-secondary);
  @include truncate;
  transition: color var(--transition-fast);
}

.node-children {
  animation: expand var(--transition-fast) ease-out;
}

@keyframes expand {
  from {
    opacity: 0;
    transform: translateY(-4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
