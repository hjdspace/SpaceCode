<template>
  <div class="terminal-panel" ref="panelRef">
    <div class="terminal-content">
      <div
        v-for="tab in terminalStore.tabs"
        :key="tab.id"
        v-show="tab.id === terminalStore.activeTabId"
        class="terminal-instance"
      >
        <TerminalContainer
          :tab-id="tab.id"
          @ready="handleTerminalReady(tab.id)"
          @error="handleTerminalError(tab.id, $event)"
          @exit="handleTerminalExit(tab.id, $event)"
        />
      </div>
      <div v-if="terminalStore.tabs.length === 0" class="terminal-empty">
        <TerminalIcon :size="48" class="empty-icon" />
        <p class="empty-text">{{ t('terminal.noTabs') }}</p>
        <button class="empty-btn" @click="handleCreateTab">
          {{ t('terminal.createFirstTab') }}
        </button>
      </div>
    </div>
    <div v-if="copyToast.show" class="copy-toast" :class="{ show: copyToast.show }">
      <Check :size="14" />
      <span>{{ copyToast.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Terminal as TerminalIcon } from 'lucide-vue-next'
import { useTerminalStore } from '@/stores/terminal'
import TerminalContainer from './TerminalContainer.vue'

const { t } = useI18n()
const terminalStore = useTerminalStore()
const panelRef = ref<HTMLElement | null>(null)

const copyToast = ref({
  show: false,
  message: '已复制到剪贴板'
})
let copyToastTimer: ReturnType<typeof setTimeout> | null = null

function showCopyToast(message: string = '已复制到剪贴板') {
  if (copyToastTimer) {
    clearTimeout(copyToastTimer)
  }
  copyToast.value = { show: true, message }
  copyToastTimer = setTimeout(() => {
    copyToast.value.show = false
  }, 2000)
}

function handleCreateTab() {
  terminalStore.createTab()
}

function handleTerminalReady(tabId: string) {
  console.log('[TerminalPanel] Terminal ready:', tabId)
}

function handleTerminalError(tabId: string, message: string) {
  console.error('[TerminalPanel] Terminal error:', tabId, message)
}

function handleTerminalExit(tabId: string, code: number) {
  console.log('[TerminalPanel] Terminal exited:', tabId, code)
}

onMounted(() => {
  if (terminalStore.tabs.length === 0) {
    terminalStore.createTab()
  }
})

onUnmounted(() => {
  if (copyToastTimer) {
    clearTimeout(copyToastTimer)
  }
})
</script>

<style lang="scss" scoped>
.terminal-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--bg-primary);
}

.terminal-content {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.terminal-instance {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.terminal-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: var(--text-muted);

  .empty-icon {
    opacity: 0.3;
  }

  .empty-text {
    font-size: 14px;
    margin: 0;
  }

  .empty-btn {
    padding: 8px 16px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;

    &:hover {
      background: var(--bg-hover);
      border-color: var(--accent-primary);
    }
  }
}

.copy-toast {
  position: absolute;
  top: 48px;
  left: 50%;
  transform: translateX(-50%) translateY(-10px);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  z-index: 100;
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.2s ease;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

  &.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}
</style>
