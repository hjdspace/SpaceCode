<template>
  <button
    v-if="visible"
    type="button"
    class="context-chip"
    :class="[`level-${warningLevel}`, { loading }]"
    :title="tooltip"
    @click="$emit('open')"
  >
    <span class="chip-dot" />
    <span class="chip-label">Context</span>
    <span class="chip-value">{{ displayPct }}%</span>
    <span v-if="!compact" class="chip-tokens">{{ tokenPair }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useContextUsageStore } from '@/stores/contextUsage'
import { useSettingsStore } from '@/stores/settings'
import { formatTokens } from '@/utils/contextUsage'

defineProps<{
  compact?: boolean
}>()

defineEmits<{
  open: []
}>()

const { t } = useI18n()
const contextStore = useContextUsageStore()
const settingsStore = useSettingsStore()
const { snapshot, loading } = storeToRefs(contextStore)

const visible = computed(() => settingsStore.appearance?.showContextUsage !== false)

const warningLevel = computed(() => snapshot.value?.warningLevel ?? 'ok')

const displayPct = computed(() => {
  const pct = snapshot.value?.usedPercentage
  return pct != null ? pct : '—'
})

const tokenPair = computed(() => {
  const d = snapshot.value?.data
  if (!d) return ''
  return `(${formatTokens(d.totalTokens)}/${formatTokens(d.rawMaxTokens)})`
})

const tooltip = computed(() => {
  const d = snapshot.value?.data
  if (!d) return t('contextUsage.clickToView')
  return `${d.model} · ${d.totalTokens.toLocaleString()} / ${d.rawMaxTokens.toLocaleString()} tokens · ${t('contextUsage.clickToView')}`
})
</script>

<style lang="scss" scoped>
.context-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-border);
  background: var(--surface-glass);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--surface-border-strong);
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }

  &.loading {
    opacity: 0.6;
  }

  &.level-warn {
    border-color: rgba(224, 137, 107, 0.35);
    .chip-value { color: var(--warning); }
  }

  &.level-error,
  &.level-blocking {
    border-color: rgba(224, 96, 80, 0.4);
    .chip-value { color: var(--error); }
  }
}

.chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-secondary);
}

.level-warn .chip-dot { background: var(--warning); }
.level-error .chip-dot,
.level-blocking .chip-dot { background: var(--error); }

.chip-label {
  color: var(--text-muted);
}

.chip-value {
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.chip-tokens {
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-muted);
}
</style>
