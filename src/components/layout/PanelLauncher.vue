<template>
  <div class="panel-launcher">
    <div class="launcher-list">
      <button
        v-for="item in items"
        :key="item.id"
        class="launcher-item"
        @click="item.action"
      >
        <span class="item-icon">
          <component :is="item.icon" :size="18" />
        </span>
        <span class="item-label">{{ item.label }}</span>
        <span class="item-shortcut">{{ item.shortcut }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitCompare, Terminal, Globe, FileSearch } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chat'

const { t } = useI18n()
const appStore = useAppStore()
const sessionStore = useChatSessionStore()

const items = computed(() => [
  {
    id: 'review',
    icon: GitCompare,
    label: t('panel.review'),
    shortcut: 'Ctrl+Shift+G',
    action: () => sessionStore.triggerDiffPanel(),
  },
  {
    id: 'terminal',
    icon: Terminal,
    label: t('panel.terminal'),
    shortcut: 'Ctrl+`',
    action: () => appStore.openTerminalInPanel(),
  },
  {
    id: 'browser',
    icon: Globe,
    label: t('panel.browser'),
    shortcut: 'Ctrl+T',
    action: () => appStore.openBlankWebview(),
  },
  {
    id: 'files',
    icon: FileSearch,
    label: t('panel.files'),
    shortcut: 'Ctrl+P',
    action: () => { appStore.showFileQuickOpen = true },
  },
])
</script>

<style lang="scss" scoped>
.panel-launcher {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 16px;
  overflow-y: auto;
}

.launcher-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.launcher-item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px 18px;
  border: none;
  border-radius: var(--radius-lg, 12px);
  background: var(--surface-hover, rgba(0, 0, 0, 0.04));
  color: var(--text-secondary);
  cursor: pointer;
  text-align: left;
  transition: background-color var(--transition-fast), color var(--transition-fast);

  &:hover {
    background: var(--surface-active, rgba(0, 0, 0, 0.07));
    color: var(--text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }
}

.item-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.item-label {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.item-shortcut {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  background: var(--surface-border, rgba(0, 0, 0, 0.06));
  padding: 2px 8px;
  border-radius: var(--radius-full, 999px);
  flex-shrink: 0;
}
</style>
