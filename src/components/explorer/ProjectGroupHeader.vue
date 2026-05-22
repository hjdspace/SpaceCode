<template>
  <div
    class="project-group-header"
    :class="{
      collapsed: isCollapsed,
      current: isCurrent,
      'is-hovered': isFolderHovered || menuOpen
    }"
    @click="handleToggle"
    @mouseenter="$emit('mouseenter')"
    @mouseleave="$emit('mouseleave')"
  >
    <!-- Expand/Collapse Chevron -->
    <span class="chevron">
      <ChevronRight v-if="isCollapsed" :size="14" />
      <ChevronDown v-else :size="14" />
    </span>

    <!-- Folder Icon -->
    <span class="folder-icon">
      <Folder v-if="isCollapsed" :size="16" />
      <FolderOpen v-else :size="16" />
    </span>

    <!-- Project Name -->
    <span class="folder-name">{{ displayName }}</span>

    <!-- Action Buttons (visible on hover, CodePilot-style) -->
    <div class="action-buttons" :class="{ visible: showActions }">
      <!-- New Chat Button -->
      <button
        v-if="workingDirectory !== ''"
        class="action-btn"
        :title="t('sidebar.newConversation')"
        @click.stop="$emit('create-session', $event)"
      >
        <Plus :size="14" />
      </button>

      <!-- Three-dot Menu -->
      <div class="menu-wrapper">
        <button
          class="action-btn"
          :title="t('common.moreOptions')"
          @click.stop="toggleMenu"
        >
          <MoreVertical :size="14" />
        </button>

        <!-- Dropdown Menu -->
        <Transition name="dropdown">
          <div v-if="menuOpen" class="dropdown-menu" @click.stop>
            <button class="menu-item" @click="handleOpenFolder">
              <ExternalLink :size="14" />
              <span>{{ t('sidebar.openFolder') }}</span>
            </button>
            <button class="menu-item" @click="handleCopyPath">
              <Copy :size="14" />
              <span>{{ t('sidebar.copyPath') }}</span>
            </button>
            <template v-if="showRemoveButton && workingDirectory !== ''">
              <div class="menu-divider" />
              <button class="menu-item destructive" @click="handleRemoveProject">
                <FolderMinus :size="14" />
                <span>{{ t('sidebar.removeFromList') }}</span>
              </button>
            </template>
          </div>
        </Transition>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Plus,
  MoreVertical,
  Copy,
  ExternalLink,
  FolderMinus
} from 'lucide-vue-next'

const { t } = useI18n()

interface Props {
  workingDirectory: string
  displayName: string
  isCollapsed: boolean
  isFolderHovered: boolean
  isCurrent?: boolean
  showRemoveButton?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  isCurrent: false,
  showRemoveButton: false
})

const emit = defineEmits<{
  toggle: []
  mouseenter: []
  mouseleave: []
  'create-session': [e: MouseEvent]
  'remove-project': [workingDirectory: string]
  'open-folder-picker': []
}>()

const menuOpen = ref(false)

const showActions = computed(() => props.isFolderHovered || menuOpen.value)

function handleToggle() {
  emit('toggle')
}

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

async function handleOpenFolder() {
  menuOpen.value = false

  // 如果没有 workingDirectory，触发事件让父组件打开文件夹选择器
  if (!props.workingDirectory) {
    emit('open-folder-picker')
    return
  }

  try {
    const electronAPI = (window as any).electronAPI
    if (electronAPI?.shell?.openPath) {
      await electronAPI.shell.openPath(props.workingDirectory)
    } else {
      // Fallback: try to open using window.open
      window.open('file://' + props.workingDirectory, '_blank')
    }
  } catch (error) {
    console.error('Failed to open folder:', error)
  }
}

async function handleCopyPath() {
  menuOpen.value = false

  if (!props.workingDirectory) {
    console.warn('No working directory available to copy')
    return
  }

  try {
    await navigator.clipboard.writeText(props.workingDirectory)
  } catch (error) {
    console.error('Failed to copy path:', error)
  }
}

function handleRemoveProject() {
  menuOpen.value = false
  emit('remove-project', props.workingDirectory)
}

// Close menu when clicking outside
if (typeof window !== 'undefined') {
  window.addEventListener('click', () => {
    if (menuOpen.value) menuOpen.value = false
  })
}
</script>

<style lang="scss" scoped>
.project-group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  margin: 2px 4px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all var(--transition-fast);
  user-select: none;
  position: relative;

  &:hover {
    background: var(--surface-glass-hover);
  }

  &.current {
    background: var(--surface-glass-active);

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 16px;
      background: var(--accent-primary);
      border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    }
  }

  &.collapsed {
    .chevron {
      transform: rotate(0deg);
    }
  }
}

.chevron {
  flex-shrink: 0;
  color: var(--text-muted);
  transition: transform var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;

  .project-group-header:not(.collapsed) & {
    transform: rotate(90deg);
  }
}

.folder-icon {
  flex-shrink: 0;
  color: var(--accent-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.folder-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-buttons {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity var(--transition-fast);

  &.visible {
    opacity: 1;
  }
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-fast);

  &:hover {
    background: var(--surface-glass);
    color: var(--text-primary);
  }
}

.menu-wrapper {
  position: relative;
}

.dropdown-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  min-width: 160px;
  padding: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  z-index: 100;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }

  &.destructive {
    color: var(--error);

    &:hover {
      background: var(--error-bg);
    }
  }
}

.menu-divider {
  height: 1px;
  margin: 4px 0;
  background: var(--surface-border);
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
</style>
