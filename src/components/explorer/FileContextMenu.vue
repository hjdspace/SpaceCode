<template>
  <Teleport to="body">
    <Transition name="context-menu">
      <div
        v-if="visible"
        ref="menuRef"
        class="file-context-menu"
        :style="menuStyle"
        @click.stop
        @contextmenu.prevent
      >
        <!-- 剪切 -->
        <button class="menu-item" :class="{ disabled: !canCut }" @click="handleCut">
          <span class="menu-icon">✂️</span>
          <span class="menu-label">{{ t('fileTree.cut') }}</span>
          <span class="menu-shortcut">Ctrl+X</span>
        </button>

        <!-- 复制 -->
        <button class="menu-item" @click="handleCopy">
          <span class="menu-icon">📋</span>
          <span class="menu-label">{{ t('fileTree.copy') }}</span>
          <span class="menu-shortcut">Ctrl+C</span>
        </button>

        <div class="menu-separator"></div>

        <button v-if="node?.type === 'file'" class="menu-item" @click="handleOpenInEditor('vscode')">
          <span class="menu-icon">🧩</span>
          <span class="menu-label">{{ t('fileTree.openWithVSCode') }}</span>
        </button>

        <button v-if="node?.type === 'file'" class="menu-item" @click="handleOpenInEditor('cursor')">
          <span class="menu-icon">📝</span>
          <span class="menu-label">{{ t('fileTree.openWithCursor') }}</span>
        </button>

        <button v-if="node?.isRoot" class="menu-item" @click="handleOpenInEditor('vscode')">
          <span class="menu-icon">🧩</span>
          <span class="menu-label">{{ t('fileTree.openProjectWithVSCode') }}</span>
        </button>

        <div v-if="node?.type === 'file' || node?.isRoot" class="menu-separator"></div>

        <!-- 复制路径 -->
        <button class="menu-item" @click="handleCopyPath">
          <span class="menu-icon">🔗</span>
          <span class="menu-label">{{ t('fileTree.copyPath') }}</span>
          <span class="menu-shortcut">Shift+Alt+C</span>
        </button>

        <!-- 复制相对路径 -->
        <button class="menu-item" @click="handleCopyRelativePath">
          <span class="menu-icon">📝</span>
          <span class="menu-label">{{ t('fileTree.copyRelativePath') }}</span>
          <span class="menu-shortcut">Ctrl+Shift+C</span>
        </button>

        <div class="menu-separator"></div>

        <!-- 添加到对话 -->
        <button class="menu-item highlight" @click="handleAddToChat">
          <span class="menu-icon">📎</span>
          <span class="menu-label">{{ t('fileTree.addToChat') }}</span>
        </button>

        <div class="menu-separator"></div>

        <!-- 重命名 -->
        <button class="menu-item" :class="{ disabled: !canRename }" @click="handleRename">
          <span class="menu-icon">✏️</span>
          <span class="menu-label">{{ t('fileTree.rename') }}...</span>
          <span class="menu-shortcut">F2</span>
        </button>

        <!-- 删除 -->
        <button class="menu-item danger" :class="{ disabled: !canDelete }" @click="handleDelete">
          <span class="menu-icon">🗑️</span>
          <span class="menu-label">{{ t('fileTree.delete') }}</span>
          <span class="menu-shortcut">Delete</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import { useAppStore } from '@/stores/app'

const { t } = useI18n()
interface TreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  isRoot?: boolean
}

const props = defineProps<{
  visible: boolean
  node: TreeNode | null
  x: number
  y: number
}>()

const emit = defineEmits<{
  close: []
  cut: [node: TreeNode]
  copy: [node: TreeNode]
  'add-to-chat': [node: TreeNode]
  rename: [node: TreeNode]
  delete: [node: TreeNode]
}>()

const menuRef = ref<HTMLElement>()
const appStore = useAppStore()

const menuStyle = computed(() => ({
  left: `${props.x}px`,
  top: `${props.y}px`
}))

const canCut = computed(() => props.node !== null)
const canRename = computed(() => props.node !== null)
const canDelete = computed(() => props.node !== null)

type ExternalEditor = 'vscode' | 'visualstudio' | 'cursor' | 'fileExplorer' | 'terminal' | 'gitBash' | 'wsl' | 'androidStudio'

function handleCut() {
  if (!props.node) return
  emit('cut', props.node)
  emit('close')
}

function handleCopy() {
  if (!props.node) return
  emit('copy', props.node)
  emit('close')
}

async function handleCopyPath() {
  if (!props.node) return
  try {
    await navigator.clipboard.writeText(props.node.path)
    console.log('[FileContextMenu] Copied path:', props.node.path)
  } catch (err) {
    console.error('[FileContextMenu] Failed to copy path:', err)
  }
  emit('close')
}

async function handleCopyRelativePath() {
  if (!props.node) return
  try {
    const relativePath = getRelativePath(props.node.path)
    await navigator.clipboard.writeText(relativePath)
    console.log('[FileContextMenu] Copied relative path:', relativePath)
  } catch (err) {
    console.error('[FileContextMenu] Failed to copy relative path:', err)
  }
  emit('close')
}

function handleAddToChat() {
  if (!props.node) return
  emit('add-to-chat', props.node)
  emit('close')
}

async function handleOpenInEditor(editor: ExternalEditor) {
  if (!props.node) return
  try {
    const result = await api.openInEditor(editor, props.node.path)
    if (!result.success) {
      alert(`打开失败：${result.error || editor}`)
    }
  } catch (err) {
    console.error('[FileContextMenu] Open in editor error:', err)
    alert('打开失败，请确认编辑器命令已加入 PATH。')
  }
  emit('close')
}

function handleRename() {
  if (!props.node) return
  emit('rename', props.node)
  emit('close')
}

async function handleDelete() {
  if (!props.node) return
  
  const confirmed = confirm(`确定要删除 "${props.node.name}" 吗？\n\n此操作将把文件移至回收站。`)
  if (!confirmed) return
  
  try {
    const result = await api.deleteFile(props.node.path)
    if (result.success) {
      console.log('[FileContextMenu] Deleted:', props.node.path)
      emit('delete', props.node)
    } else {
      alert(`删除失败：${result.error}`)
    }
  } catch (err) {
    console.error('[FileContextMenu] Delete error:', err)
    alert('删除失败，请重试。')
  }
  emit('close')
}

function getRelativePath(absolutePath: string): string {
  const rootPath = appStore.projectRoot || ''
  if (!rootPath) return absolutePath
  
  // Normalize path separators
  const normalizedRoot = rootPath.replace(/\\/g, '/')
  const normalizedPath = absolutePath.replace(/\\/g, '/')
  
  if (normalizedPath.startsWith(normalizedRoot)) {
    return normalizedPath.slice(normalizedRoot.length).replace(/^\//, '') || absolutePath
  }
  
  return absolutePath
}

function handleClickOutside(e: MouseEvent) {
  if (props.visible && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    emit('close')
  }
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.visible) {
    emit('close')
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleClickOutside)
  document.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
  document.removeEventListener('keydown', handleEscape)
})
</script>

<style lang="scss" scoped>
.file-context-menu {
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  background: var(--bg-secondary, #1e1e1e);
  border: 1px solid var(--border-color, #333);
  border-radius: 8px;
  padding: 4px 0;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  user-select: none;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--text-primary, #fff);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover:not(.disabled) {
    background: var(--hover-bg, rgba(0, 0, 0, 0.06));
  }

  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.highlight {
    color: var(--accent-color, #4fc3f7);
    
    &:hover {
      background: rgba(79, 195, 247, 0.1);
    }
  }

  &.danger {
    color: #f44336;
    
    &:hover:not(.disabled) {
      background: rgba(244, 67, 54, 0.1);
    }
  }
}

.menu-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
  flex-shrink: 0;
}

.menu-label {
  flex: 1;
  text-align: left;
}

.menu-shortcut {
  font-size: 11px;
  color: var(--text-secondary, #888);
  margin-left: auto;
}

.menu-separator {
  height: 1px;
  background: var(--border-color, #333);
  margin: 4px 0;
}

// 动画
.context-menu-enter-active,
.context-menu-leave-active {
  transition: all 0.15s ease;
}

.context-menu-enter-from,
.context-menu-leave-to {
  opacity: 0;
  transform: scale(0.95);
}
</style>
