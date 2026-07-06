<template>
  <div class="od-card" :class="`od-card-${payload.type}`">
    <div v-if="payload.title" class="od-card-title">{{ payload.title }}</div>

    <div v-if="payload.type === 'brand-preview'" class="brand-preview">
      <div class="swatch-strip">
        <span v-for="(c, i) in payload.data.colors || []" :key="i" class="swatch" :style="{ backgroundColor: c }" />
      </div>
      <div v-if="payload.data.font" class="brand-font">{{ payload.data.font }}</div>
    </div>

    <div v-else-if="payload.type === 'direction-swatches'" class="direction-grid">
      <div v-for="(dir, key) in directions" :key="key" class="direction-item">
        <span class="dir-name">{{ dir.name }}</span>
        <span class="swatch" :style="{ backgroundColor: dir.palette.primary }" />
        <span class="swatch" :style="{ backgroundColor: dir.palette.secondary }" />
        <span class="swatch" :style="{ backgroundColor: dir.palette.background }" />
      </div>
    </div>

    <div v-else-if="payload.type === 'artifact-thumbnail'" class="artifact-thumb">
      <FileText :size="16" />
      <span class="thumb-name">{{ payload.data.path }}</span>
      <button class="open-in-preview" @click="$emit('open', payload.data.path)">
        <ExternalLink :size="12" /> {{ t('design.odCard.openInPreview') }}
      </button>
    </div>

    <div v-else class="generic-card">
      <div v-for="(v, k) in payload.data" :key="k" class="kv">
        <span class="k">{{ k }}</span>
        <span class="v">{{ formatValue(v) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { FileText, ExternalLink } from 'lucide-vue-next'
import { DESIGN_DIRECTIONS } from '@/lib/design/directions'
import type { OdCardPayload } from '@/utils/chat/buildBlocks'

const props = defineProps<{ payload: OdCardPayload }>()
defineEmits<{ (e: 'open', path: string): void }>()
const { t } = useI18n()
// direction-swatches 卡片固定展示 5 大设计方向，无需从 payload.data 读取
const directions = DESIGN_DIRECTIONS

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
</script>

<style scoped lang="scss">
.od-card {
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  padding: 12px;
  background: var(--bg-secondary);
  margin: 8px 0;
}
.od-card-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; }
.swatch-strip { display: flex; gap: 4px; }
.swatch { width: 20px; height: 20px; border-radius: var(--radius-xs); border: 1px solid var(--surface-border); }
.direction-grid { display: flex; flex-direction: column; gap: 6px; }
.direction-item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
.artifact-thumb { display: flex; align-items: center; gap: 8px; }
.open-in-preview { margin-left: auto; background: none; border: 1px solid var(--surface-border); border-radius: var(--radius-sm); padding: 2px 8px; font-size: 11px; cursor: pointer; }
.generic-card .kv { display: flex; gap: 8px; font-size: 12px; }
.generic-card .k { color: var(--text-muted); }
</style>
