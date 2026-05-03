<template>
  <div class="terminal-tab-bar">
    <div class="tabs-container">
      <div
        v-for="tab in terminalStore.tabs"
        :key="tab.id"
        class="terminal-tab"
        :class="{
          active: tab.id === terminalStore.activeTabId,
          ready: tab.isReady
        }"
        @click="handleTabClick(tab.id)"
        @dblclick="handleTabDoubleClick(tab)"
        @contextmenu.prevent="handleContextMenu($event, tab)"
        :title="tab.label"
      >
        <component :is="tab.icon" :size="14" class="tab-icon" />
        <span v-if="editingTabId !== tab.id" class="tab-label">{{ tab.label }}</span>
        <input
          v-else
          ref="editInput"
          v-model="editingLabel"
          class="tab-edit-input"
          @blur="finishEditing"
          @keydown.enter="finishEditing"
          @keydown.escape="cancelEditing"
          @click.stop
        />
        <span v-if="!tab.isReady" class="tab-loading-indicator"></span>
        <button
          class="tab-close"
          @click.stop="handleClose(tab.id)"
          :title="t('terminal.closeTab')"
        >
          <X :size="12" />
        </button>
      </div>
    </div>
    <button
      class="new-tab-btn"
      @click="handleNewTab"
      :disabled="!terminalStore.canCreateNewTab"
      :title="t('terminal.newTab')"
    >
      <Plus :size="14" />
    </button>
  </div>

  <!-- Context Menu -->
  <div
    v-if="contextMenu.show"
    class="tab-context-menu"
    :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
  >
    <div class="menu-item" @click="handleDuplicate">
      <Copy :size="14" />
      <span>{{ t('terminal.duplicate') }}</span>
    </div>
    <div class="menu-item" @click="startRenaming(contextMenu.tabId)">
      <Edit3 :size="14" />
      <span>{{ t('terminal.rename') }}</span>
    </div>
    <div class="menu-divider"></div>
    <div class="menu-item" @click="handleClose(contextMenu.tabId)">
      <X :size="14" />
      <span>{{ t('terminal.close') }}</span>
    </div>
    <div class="menu-item" @click="handleCloseOthers">
      <X :size="14" />
      <span>{{ t('terminal.closeOthers') }}</span>
    </div>
    <div class="menu-item" @click="handleCloseAll">
      <X :size="14" />
      <span>{{ t('terminal.closeAll') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, Plus, Copy, Edit3 } from 'lucide-vue-next'
import { useTerminalStore, type TerminalTab } from '@/stores/terminal'

const { t } = useI18n()
const terminalStore = useTerminalStore()

const editingTabId = ref<string | null>(null)
const editingLabel = ref('')
const editInput = ref<HTMLInputElement | null>(null)

const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  tabId: ''
})

function handleTabClick(tabId: string) {
  terminalStore.switchToTab(tabId)
}

function handleTabDoubleClick(tab: TerminalTab) {
  startRenaming(tab.id)
}

function handleNewTab() {
  terminalStore.createTab()
}

function handleClose(tabId: string) {
  terminalStore.closeTab(tabId)
  hideContextMenu()
}

function handleCloseOthers() {
  const currentTabId = contextMenu.value.tabId
  const tabsToClose = terminalStore.tabs.filter(t => t.id !== currentTabId)
  tabsToClose.forEach(tab => terminalStore.closeTab(tab.id))
  hideContextMenu()
}

function handleCloseAll() {
  terminalStore.closeAllTabs()
  hideContextMenu()
}

function handleDuplicate() {
  terminalStore.duplicateTab(contextMenu.value.tabId)
  hideContextMenu()
}

function startRenaming(tabId: string) {
  const tab = terminalStore.tabs.find(t => t.id === tabId)
  if (!tab) return

  editingTabId.value = tabId
  editingLabel.value = tab.label
  hideContextMenu()

  nextTick(() => {
    editInput.value?.focus()
    editInput.value?.select()
  })
}

function finishEditing() {
  if (editingTabId.value && editingLabel.value.trim()) {
    terminalStore.renameTab(editingTabId.value, editingLabel.value.trim())
  }
  editingTabId.value = null
  editingLabel.value = ''
}

function cancelEditing() {
  editingTabId.value = null
  editingLabel.value = ''
}

function handleContextMenu(event: MouseEvent, tab: TerminalTab) {
  contextMenu.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    tabId: tab.id
  }
}

function hideContextMenu() {
  contextMenu.value.show = false
}

function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.tab-context-menu')) {
    hideContextMenu()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style lang="scss" scoped>
.terminal-tab-bar {
  display: flex;
  align-items: center;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-default);
  height: 36px;
  min-height: 36px;
  padding: 0 4px;
  gap: 2px;
}

.tabs-container {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;

  &::-webkit-scrollbar {
    height: 0;
  }
}

.terminal-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  max-width: 160px;
  min-width: 80px;
  transition: all 0.15s ease;
  position: relative;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    font-weight: 500;

    &::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent-primary);
    }
  }

  &.ready .tab-icon {
    color: var(--status-success);
  }
}

.tab-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.tab-edit-input {
  flex: 1;
  min-width: 60px;
  padding: 2px 4px;
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.tab-loading-indicator {
  width: 8px;
  height: 8px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  opacity: 0;
  transition: opacity 0.15s ease;

  .terminal-tab:hover & {
    opacity: 1;
  }

  &:hover {
    background: var(--error-bg);
    color: var(--error);
  }
}

.new-tab-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  flex-shrink: 0;

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.tab-context-menu {
  position: fixed;
  background: var(--bg-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  padding: 4px;
  min-width: 160px;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-primary);

  &:hover {
    background: var(--bg-hover);
  }
}

.menu-divider {
  height: 1px;
  background: var(--border-default);
  margin: 4px 0;
}
</style>
