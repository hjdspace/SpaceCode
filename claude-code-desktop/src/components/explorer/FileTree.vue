<template>
  <div class="file-tree">
    <div class="tree-content">
      <FileTreeNode
        v-for="node in treeData"
        :key="node.path"
        :node="node"
        :depth="0"
        @select="handleSelect"
        @toggle="handleToggle"
      />
      <div v-if="treeData.length === 0" class="empty-tree">
        <div class="empty-icon">
          <FolderOpen :size="24" />
        </div>
        <span>No project files</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { FolderOpen } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useAppStore } from '@/stores/app'
import FileTreeNode from './FileTreeNode.vue'

interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
  isExpanded?: boolean
  isLoaded?: boolean
}

const emit = defineEmits<{
  select: [node: TreeNode]
}>()

const appStore = useAppStore()
const treeData = ref<TreeNode[]>([])

async function loadDirectory(path: string): Promise<TreeNode[]> {
  const entries = await api.readDir(path)
  return entries
    .filter(entry => !entry.name.startsWith('.') && entry.name !== 'node_modules')
    .sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })
    .map(entry => ({
      name: entry.name,
      path: entry.path,
      type: entry.isDirectory ? 'directory' : 'file',
      children: entry.isDirectory ? [] : undefined,
      isExpanded: false,
      isLoaded: false
    }))
}

async function initTree() {
  try {
    const rootPath = appStore.projectRoot
    if (!rootPath) {
      treeData.value = []
      return
    }
    treeData.value = await loadDirectory(rootPath)
    if (treeData.value.length > 0) {
      treeData.value[0].isExpanded = true
      treeData.value[0].isLoaded = true
      treeData.value[0].children = await loadDirectory(treeData.value[0].path)
    }
  } catch (error) {
    console.error('Failed to initialize file tree:', error)
  }
}

// 监听项目路径变化，重新加载文件树
watch(() => appStore.projectRoot, () => {
  initTree()
})

async function handleToggle(node: TreeNode) {
  node.isExpanded = !node.isExpanded
  
  if (!node.isLoaded && node.type === 'directory') {
    node.children = await loadDirectory(node.path)
    node.isLoaded = true
  }
}

function handleSelect(node: TreeNode) {
  if (node.type === 'file') {
    emit('select', node)
  }
}

onMounted(() => {
  initTree()
})
</script>

<style lang="scss" scoped>
.file-tree {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.tree-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  @include scrollbar-thin;
}

.empty-tree {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
  
  .empty-icon {
    width: 48px;
    height: 48px;
    border-radius: var(--radius-lg);
    background: var(--surface-glass);
    @include flex-center;
    color: var(--text-muted);
    margin-bottom: 12px;
  }
  
  span {
    font-size: 12px;
    color: var(--text-muted);
  }
}
</style>
