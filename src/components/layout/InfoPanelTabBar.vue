<template>
  <div class="info-panel-tab-bar" v-if="tabs.length > 0">
    <button class="home-btn" :class="{ active: appStore.panelHome }" @click="handleGoHome" :title="t('panel.home')">
      <LayoutGrid :size="14" />
    </button>
    <div class="tabs-scroll-container" ref="scrollContainer">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="info-tab"
        :class="{ active: tab.id === activeTabId }"
        @click="handleTabClick(tab)"
        :title="tab.title"
      >
        <component :is="tab.icon" :size="12" class="tab-icon" />
        <span class="tab-label">{{ tab.title }}</span>
        <button
          v-if="tab.closeable"
          class="tab-close"
          @click.stop="handleClose(tab.id)"
          :title="t('infoPanel.closeTab')"
        >
          <X :size="12" />
        </button>
      </div>
    </div>
    <button class="close-panel-btn" @click="handleClosePanel" :title="t('infoPanel.closePanel')">
      <X :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAppStore, type InfoPanelTab } from '@/stores/app'
import { useI18n } from 'vue-i18n'
import { X, LayoutGrid } from 'lucide-vue-next'

const appStore = useAppStore()
const { t } = useI18n()
const scrollContainer = ref<HTMLElement | null>(null)

const tabs = computed<InfoPanelTab[]>(() => appStore.infoPanelTabs)
const activeTabId = computed(() => appStore.activeInfoTabId)

function handleTabClick(tab: InfoPanelTab) {
  appStore.panelHome = false
  appStore.activeInfoTabId = tab.id
}

function handleGoHome() {
  appStore.goPanelHome()
}

function handleClose(tabId: string) {
  appStore.closeInfoTab(tabId)
}

function handleClosePanel() {
  appStore.closeAllInfoTabs()
}
</script>

<style lang="scss" scoped>
.info-panel-tab-bar {
  display: flex;
  align-items: center;
  background: var(--surface-glass, rgba(0,0,0,0.03));
  border-bottom: 1px solid var(--surface-border, #e5e7eb);
  padding: 0;
  height: 36px;
  min-height: 36px;
  gap: 0;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg,
      transparent 0%,
      var(--surface-border-strong, rgba(0,0,0,0.12)) 50%,
      transparent 100%
    );
  }
}

.tabs-scroll-container {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 0 4px;

  &::-webkit-scrollbar {
    height: 0;
  }
}

.info-tab {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: var(--radius-sm, 4px) var(--radius-sm, 4px) 0 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
  max-width: 160px;
  min-width: 60px;
  transition: all 0.15s ease;
  position: relative;
  flex-shrink: 0;

  &:hover {
    background: var(--surface-glass-hover, rgba(0,0,0,0.05));
    color: var(--text-primary, #111827);
  }

  &.active {
    background: var(--surface-glass-active, rgba(0,0,0,0.08));
    color: var(--text-primary, #111827);
    font-weight: 500;

    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent-primary, #3b82f6);
    }
  }
}

.tab-icon {
  flex-shrink: 0;
  opacity: 0.7;
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  font-size: 11px;
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
  color: var(--text-muted, #9ca3af);
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
  flex-shrink: 0;

  &:hover {
    background: var(--surface-glass-hover, rgba(0,0,0,0.1));
    color: var(--text-primary, #111827);
  }

  .info-tab:hover &,
  .info-tab.active & {
    opacity: 1;
  }
}

.home-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted, #9ca3af);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  border-right: 1px solid var(--surface-border, #e5e7eb);

  &:hover {
    background: var(--surface-glass-hover, rgba(0,0,0,0.05));
    color: var(--text-primary, #111827);
  }

  &.active {
    color: var(--accent-primary);
  }
}

.close-panel-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted, #9ca3af);
  border-radius: 0;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;
  border-left: 1px solid var(--surface-border, #e5e7eb);

  &:hover {
    background: var(--surface-glass-hover, rgba(0,0,0,0.05));
    color: var(--error, #ef4444);
  }
}
</style>
