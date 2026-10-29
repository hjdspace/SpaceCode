<template>
  <div class="run-tabs" data-run-tabs>
    <div class="tab-list" role="tablist">
      <div
        v-for="tab in runs"
        :key="tab.id"
        class="run-tab"
        :class="{ active: tab.id === activeId }"
        :data-run-tab="tab.id"
        :data-run-tab-active="tab.id === activeId ? 'true' : undefined"
      >
        <button
          type="button"
          class="tab-main"
          role="tab"
          :aria-selected="tab.id === activeId"
          @click="emit('select', tab.id)"
        >
          <Layers :size="12" />
          <span class="tab-label">{{ t('factory.runTabs.label', { id: tab.id }) }}</span>
        </button>
        <button
          v-if="tab.id === activeId"
          type="button"
          class="tab-close"
          :data-run-tab-close="tab.id"
          :title="t('factory.runTabs.close')"
          @click.stop="emit('close', tab.id)"
        >
          <X :size="12" />
        </button>
      </div>
    </div>
    <button
      type="button"
      class="tab-add"
      data-run-tab-add
      :title="t('factory.runTabs.new')"
      @click="emit('new-run')"
    >
      <Plus :size="13" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Layers, Plus, X } from 'lucide-vue-next'
import type { FactoryRun } from '@/shared/factory'

defineProps<{
  runs: FactoryRun[]
  activeId: string | null
}>()

const emit = defineEmits<{
  select: [id: string]
  close: [id: string]
  'new-run': []
}>()

const { t } = useI18n()
</script>

<style lang="scss" scoped>
.run-tabs {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  min-height: 30px;
  border-bottom: 1px solid var(--surface-border);
}

.tab-list {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  @include scrollbar-overlay;
}

.run-tab {
  display: flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 7px 7px 0 0;
  color: var(--text-muted);
  font-size: var(--text-sm, 12px);

  &:hover {
    color: var(--text-secondary);
    background: var(--surface-glass);
  }

  &.active {
    border-color: var(--surface-border);
    background: var(--bg-elevated);
    color: var(--text-primary);
  }
}

.tab-main {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 5px 8px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-close {
  display: grid;
  place-items: center;
  margin: 0 4px 0 -2px;
  padding: 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--surface-glass-hover, var(--bg-tertiary));
    color: var(--text-primary);
  }
}

.tab-add {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  margin-bottom: 3px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--surface-glass);
    color: var(--text-primary);
  }
}
</style>
