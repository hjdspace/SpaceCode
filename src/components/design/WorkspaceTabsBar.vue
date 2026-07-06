<template>
  <div class="tabs-bar">
    <div v-for="tab in tabs" :key="tab.path" class="tab"
      :class="{ active: tab.path === activePath }"
      @click="$emit('select', tab.path)">
      <span class="tab-name">{{ tab.name }}</span>
      <button class="tab-close" @click.stop="$emit('close', tab.path)">×</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ArtifactFile } from '@/stores/design'
defineProps<{ tabs: ArtifactFile[]; activePath: string | null }>()
defineEmits<{ (e: 'select', path: string): void; (e: 'close', path: string): void }>()
</script>

<style scoped lang="scss">
.tabs-bar { display: flex; height: var(--design-tab-height); border-bottom: 1px solid var(--surface-border); background: var(--bg-secondary); overflow-x: auto; }
.tab { display: flex; align-items: center; gap: 6px; padding: 0 12px; border-right: 1px solid var(--surface-border); cursor: pointer; font-size: 12px; &:hover { background: var(--surface-hover); } &.active { background: var(--bg-primary); border-bottom: 2px solid var(--accent-primary); } }
.tab-close { background: none; border: none; cursor: pointer; color: var(--text-muted); &:hover { color: var(--text-primary); } }
</style>
