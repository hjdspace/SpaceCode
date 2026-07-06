<template>
  <div class="mode-tabs" role="tablist" aria-label="工作模式切换">
    <button
      class="mode-tab"
      :class="{ active: appStore.mode === 'work' }"
      role="tab"
      :aria-selected="appStore.mode === 'work'"
      @click="handleSelect('work')"
    >
      <Briefcase :size="14" />
      <span>{{ t('mode.work') }}</span>
    </button>
    <button
      class="mode-tab"
      :class="{ active: appStore.mode === 'code' }"
      role="tab"
      :aria-selected="appStore.mode === 'code'"
      @click="handleSelect('code')"
    >
      <Code2 :size="14" />
      <span>{{ t('mode.code') }}</span>
    </button>
    <button
      class="mode-tab"
      :class="{ active: appStore.mode === 'design' }"
      role="tab"
      :aria-selected="appStore.mode === 'design'"
      @click="handleSelect('design')"
    >
      <Palette :size="14" />
      <span>{{ t('mode.design') }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Briefcase, Code2, Palette } from 'lucide-vue-next'
import { useAppStore, type AppMode } from '@/stores/app'

const { t } = useI18n()
const appStore = useAppStore()

const emit = defineEmits<{
  (e: 'select', mode: AppMode): void
}>()

function handleSelect(mode: AppMode) {
  if (appStore.mode === mode) return
  appStore.setMode(mode)
  emit('select', mode)
}
</script>

<style lang="scss" scoped>
.mode-tabs {
  display: flex;
  gap: 4px;
  padding: 8px 12px 4px;
  flex-shrink: 0;
}

.mode-tab {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-family: inherit;
  transition: all var(--transition-fast);

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }

  &.active {
    color: var(--accent-primary);
    background: var(--surface-glass-active);
    border-color: var(--accent-primary);
  }
}
</style>
