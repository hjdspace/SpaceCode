<template>
  <div
    class="session-item-wrapper"
    @mouseenter="$emit('mouseenter')"
    @mouseleave="$emit('mouseleave')"
  >
    <div
      class="session-item"
      :class="{ active: isActive }"
      @click="$emit('select')"
    >
      <!-- Left Icon Area - Status Indicators (CodePilot-style) -->
      <div class="status-indicator">
        <!-- Loading: Switching session -->
        <span v-if="isLoading" class="loading-indicator" aria-hidden="true" title="切换中...">
          <span class="spinner-small"></span>
        </span>
        <!-- Active/Starting: Spinning circle -->
        <span v-else-if="processStatus === 'active' || processStatus === 'starting'" class="spinning-indicator" aria-hidden="true">
          <span class="spinner"></span>
        </span>
        <!-- Idle: Green dot -->
        <span v-else-if="processStatus === 'idle'" class="idle-indicator" aria-hidden="true">
          <span class="dot"></span>
        </span>
        <!-- Suspended: Yellow dot -->
        <span v-else-if="processStatus === 'suspended'" class="suspended-indicator" aria-hidden="true">
          <span class="dot"></span>
        </span>
        <!-- Streaming Indicator with ping animation (legacy) -->
        <span v-else-if="isStreaming" class="streaming-indicator" aria-hidden="true">
          <span class="ping" />
          <span class="dot" />
        </span>
        <!-- Approval Indicator -->
        <span v-else-if="needsApproval" class="approval-badge" aria-hidden="true">
          <Bell :size="10" />
        </span>
      </div>

      <!-- Title -->
      <span class="session-title">{{ session.title }}</span>

      <!-- Right Area - Time (hidden on hover) -->
      <div class="right-area">
        <span
          v-show="!showActions"
          class="time-display"
        >
          {{ formatRelativeTime(new Date(session.updatedAt || session.createdAt).toISOString()) }}
        </span>
      </div>
    </div>

    <!-- Three-Dot Menu (appears on hover, CodePilot-style) -->
    <Transition name="fade">
      <div
        v-if="showActions || isDeleting"
        class="action-menu"
      >
        <button
          ref="menuTriggerRef"
          class="menu-trigger"
          aria-label="会话菜单"
          @click.stop="toggleMenu"
        >
          <MoreVertical :size="16" />
        </button>
      </div>
    </Transition>

    <!-- Dropdown Menu - Teleported to body to avoid overflow clipping -->
    <Teleport to="body">
      <Transition name="dropdown">
        <div
          v-if="menuOpen"
          class="dropdown-menu"
          :style="menuStyle"
          @click.stop
        >
          <!-- Split Screen (分屏) -->
          <button
            class="menu-item"
            :disabled="isActive"
            :class="{ disabled: isActive }"
            @click="handleSplitScreen"
          >
            <Columns :size="14" />
            <span>分屏</span>
          </button>
          <!-- Rename Conversation (重命名对话) -->
          <button class="menu-item" @click="handleRename">
            <Pencil :size="14" />
            <span>重命名对话</span>
          </button>
          <!-- Copy Session ID (复制对话 ID) -->
          <button class="menu-item" @click="handleCopyId">
            <Copy :size="14" />
            <span>复制对话 ID</span>
          </button>
          <div class="menu-divider" />
          <!-- Delete Conversation (删除对话) -->
          <button class="menu-item destructive" @click="handleDelete">
            <Trash2 :size="14" />
            <span>删除对话</span>
          </button>
        </div>
      </Transition>
    </Teleport>

    <!-- Rename Dialog -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="renameDialogOpen" class="dialog-overlay" @click="renameDialogOpen = false">
          <div class="dialog-content" @click.stop>
            <h3 class="dialog-title">{{ t('common.rename') }}</h3>
            <input
              ref="renameInput"
              v-model="renameValue"
              type="text"
              class="dialog-input"
              :placeholder="t('sessionTab.newSession')"
              @keyup.enter="confirmRename"
              @keyup.escape="renameDialogOpen = false"
            />
            <div class="dialog-actions">
              <button class="btn btn-secondary" @click="renameDialogOpen = false">{{ t('common.cancel') }}</button>
              <button class="btn btn-primary" @click="confirmRename">{{ t('common.confirm') }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Session } from '@/types'
import {
  Bell,
  Trash2,
  Copy,
  Pencil,
  MoreVertical,
  Columns
} from 'lucide-vue-next'

const { t } = useI18n()
interface Props {
  session: Session
  isActive: boolean
  isHovered: boolean
  isDeleting: boolean
  isStreaming: boolean
  needsApproval: boolean
  processStatus: 'none' | 'starting' | 'active' | 'idle' | 'suspended' | 'exited'
  formatRelativeTime: (dateStr: string) => string
  isLoading?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  mouseenter: []
  mouseleave: []
  select: []
  delete: [e: MouseEvent]
  rename: [newTitle: string]
  'copy-id': [sessionId: string]
  'split-screen': [sessionId: string]
}>()

const menuOpen = ref(false)
const renameDialogOpen = ref(false)
const renameValue = ref('')
const renameInput = ref<HTMLInputElement>()
const menuTriggerRef = ref<HTMLButtonElement>()
const menuPosition = ref({ top: 0, left: 0 })

const showActions = computed(() => props.isHovered || menuOpen.value || props.isDeleting)

// 计算菜单样式
const menuStyle = computed(() => ({
  position: 'fixed' as const,
  top: `${menuPosition.value.top}px`,
  left: `${menuPosition.value.left}px`,
  zIndex: 9999
}))

function updateMenuPosition() {
  const rect = menuTriggerRef.value?.getBoundingClientRect()
  if (rect) {
    menuPosition.value = {
      top: rect.bottom + 4,
      left: rect.left
    }
  }
}

function toggleMenu() {
  if (!menuOpen.value) {
    updateMenuPosition()
    menuOpen.value = true
  } else {
    menuOpen.value = false
  }
}

function handleCopyId() {
  menuOpen.value = false
  emit('copy-id', props.session.id)
}

function handleRename() {
  menuOpen.value = false
  renameValue.value = props.session.title
  renameDialogOpen.value = true
  nextTick(() => {
    renameInput.value?.focus()
    renameInput.value?.select()
  })
}

function confirmRename() {
  if (renameValue.value.trim() && renameValue.value.trim() !== props.session.title) {
    emit('rename', renameValue.value.trim())
  }
  renameDialogOpen.value = false
}

function handleDelete(e: MouseEvent) {
  menuOpen.value = false
  emit('delete', e)
}

function handleSplitScreen() {
  menuOpen.value = false
  // 如果当前会话是激活状态，不执行分屏
  if (props.isActive) return
  emit('split-screen', props.session.id)
}

// 点击外部关闭菜单
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  // 如果点击的是菜单触发按钮，不处理（由按钮自己的点击事件处理）
  if (menuTriggerRef.value?.contains(target)) {
    return
  }
  // 如果点击的是菜单内部，不处理
  const menuEl = document.querySelector('.dropdown-menu')
  if (menuEl?.contains(target)) {
    return
  }
  menuOpen.value = false
}

// 滚动时更新菜单位置或关闭菜单
function handleScroll() {
  if (menuOpen.value) {
    updateMenuPosition()
  }
}

onMounted(() => {
  window.addEventListener('click', handleClickOutside)
  window.addEventListener('scroll', handleScroll, true)
})

onUnmounted(() => {
  window.removeEventListener('click', handleClickOutside)
  window.removeEventListener('scroll', handleScroll, true)
})
</script>

<style lang="scss" scoped>
.session-item-wrapper {
  position: relative;
}

.session-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;

  // Left accent bar (CodePilot-style)
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

  &.active {
    background: var(--surface-glass-active);
    color: var(--text-primary);

    &::before {
      height: 20px;
      box-shadow: 0 0 8px rgba(var(--accent-primary-rgb), 0.4);
    }

    .session-title {
      font-weight: 500;
    }
  }

  // Color states
  &:not(.active) {
    color: var(--text-secondary);
  }
}

.status-indicator {
  position: relative;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinning-indicator {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid var(--accent-primary, #3b82f6);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-indicator {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;

  .spinner-small {
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--accent-primary, #3b82f6);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
}

.idle-indicator {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-success, #22c55e);
  }
}

.suspended-indicator {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-warning, #eab308);
  }
}

// Streaming indicator with ping animation (CodePilot-style)
.streaming-indicator {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;

  .ping {
    position: absolute;
    inset: 0;
    display: inline-flex;
    border-radius: 50%;
    background: var(--status-success, #22c55e);
    opacity: 0.75;
    animation: ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
  }

  .dot {
    position: relative;
    display: inline-flex;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--status-success, #22c55e);
  }
}

@keyframes ping {
  75%, 100% {
    transform: scale(2.2);
    opacity: 0;
  }
}

// Approval badge (CodePilot-style)
.approval-badge {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--status-warning-muted, rgba(234, 179, 8, 0.15));
  color: var(--status-warning-foreground, #ca8a04);
}

.session-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  word-break: break-all;
}

.right-area {
  flex-shrink: 0;
  width: 38px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.time-display {
  font-size: 11px;
  color: var(--text-muted);
  opacity: 0.5;
  transition: opacity var(--transition-fast);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// Action menu (CodePilot-style)
.action-menu {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
}

.menu-trigger {
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--text-muted);
  opacity: 0.6;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }
}

// Dropdown menu styles - 这些样式需要应用到 teleport 到 body 的元素
// 使用深度选择器确保样式应用到全局
.dropdown-menu {
  min-width: 160px;
  background: var(--bg-elevated, #ffffff);
  border: 1px solid var(--surface-border, #e5e7eb);
  border-radius: var(--radius-md, 6px);
  box-shadow: var(--shadow-xl, 0 20px 25px -5px rgba(0, 0, 0, 0.1));
  padding: 4px;
}

.menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--text-primary, #111827);
  background: transparent;
  border: none;
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  transition: background 0.15s ease;

  &:hover {
    background: var(--surface-glass-hover, rgba(0, 0, 0, 0.05));
  }

  &.destructive {
    color: var(--error, #ef4444);

    &:hover {
      background: var(--error-bg, rgba(239, 68, 68, 0.1));
    }
  }

  &.disabled {
    opacity: 0.5;
    cursor: not-allowed;

    &:hover {
      background: transparent;
    }
  }
}

.menu-divider {
  height: 1px;
  background: var(--surface-border, #e5e7eb);
  margin: 4px 0;
}

// Fade animation for action menu
.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--transition-fast);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

// Dropdown animation
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.15s ease-out;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

// Modal styles
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.dialog-content {
  background: var(--bg-elevated, #ffffff);
  border: 1px solid var(--surface-border, #e5e7eb);
  border-radius: var(--radius-lg, 8px);
  padding: 20px;
  min-width: 320px;
  box-shadow: var(--shadow-xl, 0 20px 25px -5px rgba(0, 0, 0, 0.1));
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary, #111827);
  margin-bottom: 16px;
}

.dialog-input {
  width: 100%;
  padding: 10px 12px;
  font-size: var(--font-size-base);
  border: 1px solid var(--surface-border, #e5e7eb);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-elevated, #ffffff);
  color: var(--text-primary, #111827);
  outline: none;
  transition: border-color 0.15s ease;

  &:focus {
    border-color: var(--accent-primary, #3b82f6);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.btn {
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-md, 6px);
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;

  &.btn-secondary {
    background: var(--surface-glass, rgba(0, 0, 0, 0.05));
    color: var(--text-secondary, #6b7280);
    border: 1px solid var(--surface-border, #e5e7eb);

    &:hover {
      background: var(--surface-glass-hover, rgba(0, 0, 0, 0.1));
    }
  }

  &.btn-primary {
    background: var(--accent-primary, #3b82f6);
    color: white;

    &:hover {
      background: var(--accent-primary-hover, #2563eb);
    }
  }
}

// Modal animation
.modal-enter-active,
.modal-leave-active {
  transition: all 0.15s ease-out;
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}

.modal-enter-from .dialog-content,
.modal-leave-to .dialog-content {
  transform: scale(0.95);
}
</style>
