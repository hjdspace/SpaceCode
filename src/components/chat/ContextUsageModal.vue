<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="show" class="context-modal-overlay" @click.self="close">
        <div class="context-modal" role="dialog" aria-labelledby="context-modal-title">
          <header class="modal-header">
            <div>
              <h2 id="context-modal-title">{{ t('contextUsage.title') }}</h2>
              <p class="modal-subtitle">{{ subtitle }}</p>
            </div>
            <div class="modal-header-actions">
              <button
                type="button"
                class="compact-btn"
                :class="{ compacting: isCompacting }"
                :disabled="isCompacting"
                @click="handleCompact"
              >
                <Loader2 v-if="isCompacting" :size="14" class="spin" />
                <Minimize2 v-else :size="14" />
                <span>{{ isCompacting ? t('contextUsage.compacting') : t('contextUsage.compact') }}</span>
              </button>
              <button type="button" class="close-btn" :aria-label="t('common.close')" @click="close">
                <X :size="18" />
              </button>
            </div>
          </header>

          <div v-if="loading && !snapshot" class="modal-loading">
            <Loader2 :size="20" class="spin" />
            <span>{{ t('common.loading') }}</span>
          </div>

          <div v-if="isCompacting" class="compact-banner">
            <Loader2 :size="14" class="spin" />
            <span>{{ t('contextUsage.compactingHint') }}</span>
          </div>

          <div v-if="snapshot" class="modal-body">
            <div class="overview-row">
              <div class="ring-wrap">
                <svg width="112" height="112" viewBox="0 0 120 120">
                  <circle class="ring-bg" cx="60" cy="60" r="52" fill="none" stroke-width="10" />
                  <circle
                    class="ring-fill"
                    cx="60"
                    cy="60"
                    r="52"
                    fill="none"
                    stroke-width="10"
                    :stroke="ringColor"
                    stroke-linecap="round"
                    :stroke-dasharray="circumference"
                    :stroke-dashoffset="ringOffset"
                  />
                </svg>
                <div class="ring-center">
                  <span class="ring-pct">{{ usedPct }}</span>
                  <span class="ring-label">{{ t('contextUsage.used') }}</span>
                </div>
              </div>

              <div class="overview-meta">
                <div class="model-name">{{ formatModelName(snapshot.data?.model || model) }}</div>
                <div class="token-row">
                  <strong>{{ formatNumber(usedTokens) }}</strong>
                  / {{ formatNumber(rawMax) }} {{ t('contextUsage.tokens') }}
                  · {{ formatNumber(remaining) }} {{ t('contextUsage.remaining') }}
                </div>
                <div class="threshold-track">
                  <div class="threshold-fill" :style="thresholdStyle" />
                  <div class="threshold-marker warn" :style="{ left: warnMarkerPct + '%' }" />
                  <div class="threshold-marker compact" :style="{ left: compactMarkerPct + '%' }" />
                </div>
                <div class="threshold-legend">
                  <span><i class="dot used" />{{ t('contextUsage.legendUsed') }}</span>
                  <span><i class="dot warn" />{{ t('contextUsage.legendWarn') }}</span>
                  <span><i class="dot compact" />{{ t('contextUsage.legendCompact') }}</span>
                </div>
                <div
                  v-if="snapshot.warningMessage && snapshot.warningLevel !== 'ok'"
                  class="inline-warning"
                  :class="snapshot.warningLevel"
                >
                  {{ snapshot.warningMessage }}
                </div>
              </div>
            </div>

            <div class="panel-grid">
              <section class="panel-card">
                <h3>{{ t('contextUsage.byCategory') }}</h3>
                <div class="viz-row">
                  <div class="context-grid">
                    <div
                      v-for="(cell, idx) in gridCells"
                      :key="idx"
                      class="grid-cell"
                      :class="cell.type"
                      :style="cell.style"
                    />
                  </div>
                  <div class="category-list">
                    <div
                      v-for="cat in visibleCategories"
                      :key="cat.name"
                      class="category-item"
                    >
                      <span class="cat-dot" :style="{ background: categoryColorToCss(cat.color) }" />
                      <span class="cat-name">{{ categoryLabel(cat.name) }}</span>
                      <span class="cat-tokens">
                        {{ formatTokens(cat.tokens) }}
                        ({{ categoryPct(cat.tokens) }}%)
                      </span>
                    </div>
                    <p v-if="visibleCategories.length === 0" class="empty-hint">
                      {{ t('contextUsage.noCategories') }}
                    </p>
                  </div>
                </div>
              </section>

              <section class="panel-card stats-card">
                <h3>{{ t('contextUsage.sessionStats') }}</h3>
                <div class="stat-row">
                  <span>{{ t('contextUsage.inputUncached') }}</span>
                  <span>{{ formatNumber(sessionInput) }}</span>
                </div>
                <div class="stat-row">
                  <span>{{ t('contextUsage.cacheRead') }}</span>
                  <span>{{ formatNumber(snapshot.sessionTotals.cacheReadInputTokens) }}</span>
                </div>
                <div class="stat-row">
                  <span>{{ t('contextUsage.cacheWrite') }}</span>
                  <span>{{ formatNumber(snapshot.sessionTotals.cacheCreationInputTokens) }}</span>
                </div>
                <div class="stat-row">
                  <span>{{ t('contextUsage.output') }}</span>
                  <span>{{ formatNumber(snapshot.sessionTotals.outputTokens) }}</span>
                </div>
                <div v-if="cacheHitRate != null" class="stat-row">
                  <span>{{ t('contextUsage.cacheHitRate') }}</span>
                  <span>{{ cacheHitRate }}%</span>
                </div>
                <div v-if="snapshot.data?.isAutoCompactEnabled" class="stat-note">
                  {{ t('contextUsage.autocompactEnabled') }}
                </div>
              </section>
            </div>
          </div>

          <div v-else class="modal-empty">
            <p>{{ t('contextUsage.noData') }}</p>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, X, Minimize2 } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useContextUsageStore } from '@/stores/contextUsage'
import { useSettingsStore } from '@/stores/settings'
import {
  calculateCacheHitRate,
  categoryColorToCss,
  formatNumber,
  formatTokens,
  getAutoCompactThreshold,
  getCategoryI18nKey,
  getContextWindowForModel,
  getVisibleContextCategories,
  getWarningThreshold,
} from '@/utils/contextUsage'

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const { t } = useI18n()
const contextStore = useContextUsageStore()
const settingsStore = useSettingsStore()
const { snapshot, loading, isCompacting } = storeToRefs(contextStore)

function handleCompact() {
  contextStore.startCompact()
}

const model = computed(() => settingsStore.config.model || 'claude-sonnet-4-6')
const userCtxOverride = computed(() => settingsStore.modelContextWindows[model.value])
const circumference = 2 * Math.PI * 52

const rawMax = computed(() => snapshot.value?.data?.rawMaxTokens ?? getContextWindowForModel(model.value, userCtxOverride.value))
const usedTokens = computed(() => snapshot.value?.data?.totalTokens ?? 0)
const usedPct = computed(() => snapshot.value?.usedPercentage ?? snapshot.value?.data?.percentage ?? 0)
const remaining = computed(() => Math.max(0, rawMax.value - usedTokens.value))

const ringOffset = computed(() => circumference * (1 - usedPct.value / 100))
const ringColor = computed(() => {
  const level = snapshot.value?.warningLevel
  if (level === 'error' || level === 'blocking') return 'var(--error)'
  if (level === 'warn' || usedPct.value > 75) return 'var(--warning)'
  return 'var(--accent-secondary)'
})

const thresholdStyle = computed(() => ({
  width: `${usedPct.value}%`,
  background: ringColor.value,
}))

const warnMarkerPct = computed(() => (getWarningThreshold(model.value, userCtxOverride.value) / rawMax.value) * 100)
const compactMarkerPct = computed(() => (getAutoCompactThreshold(model.value, userCtxOverride.value) / rawMax.value) * 100)

const sessionInput = computed(() => {
  const api = snapshot.value?.data?.apiUsage
  if (api) return api.input_tokens
  return snapshot.value?.sessionTotals.inputTokens ?? 0
})

const cacheHitRate = computed(() => {
  const totals = snapshot.value?.sessionTotals
  if (!totals) return null
  return calculateCacheHitRate({
    inputTokens: totals.inputTokens,
    cacheReadInputTokens: totals.cacheReadInputTokens,
    cacheCreationInputTokens: totals.cacheCreationInputTokens,
  })
})

const subtitle = computed(() => {
  const d = snapshot.value?.data
  if (!d) return model.value
  return `${d.model} · ${formatTokens(d.rawMaxTokens)} ${t('contextUsage.window')}`
})

const visibleCategories = computed(() => getVisibleContextCategories(snapshot.value?.data))

function categoryLabel(name: string): string {
  const key = getCategoryI18nKey(name)
  return key ? t(key) : name
}

type GridCell = { type: string; style?: Record<string, string> }

const gridCells = computed((): GridCell[] => {
  const total = 100
  const ctx = rawMax.value
  const filled = Math.round((usedTokens.value / ctx) * total)
  const buffer = Math.round((13_000 / ctx) * total)
  const cats = visibleCategories.value
  const cells: GridCell[] = []

  let catIdx = 0
  const counts = cats.map(c =>
    Math.round((c.tokens / Math.max(usedTokens.value, 1)) * filled),
  )

  for (let i = 0; i < total; i++) {
    if (i < filled) {
      while (catIdx < counts.length && counts[catIdx] <= 0) catIdx++
      const color = categoryColorToCss(cats[catIdx]?.color)
      if (counts[catIdx] !== undefined) counts[catIdx]!--
      cells.push({ type: 'filled', style: { background: color } })
    } else if (i < filled + buffer) {
      cells.push({ type: 'buffer' })
    } else {
      cells.push({ type: 'free' })
    }
  }
  return cells
})

function categoryPct(tokens: number): string {
  return ((tokens / rawMax.value) * 100).toFixed(1)
}

function formatModelName(id: string): string {
  return id
    .replace(/\[1m\]/gi, '')
    .replace(/claude-/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function close() {
  emit('update:show', false)
}

watch(
  () => props.show,
  open => {
    if (open) void contextStore.refresh(undefined, true)
  },
)
</script>

<style lang="scss" scoped>
.context-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
}

.context-modal {
  width: 100%;
  max-width: 720px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
}

.modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px 12px;
  border-bottom: 1px solid var(--surface-border);

  h2 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
  }
}

.modal-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
}

.modal-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compact-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 150ms ease;

  &:hover:not(:disabled) {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
    border-color: var(--surface-border-strong);
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  &.compacting {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
}

.close-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

.compact-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  background: rgba(217, 119, 87, 0.08);
  color: var(--accent-primary);
  font-size: 12px;
  border-bottom: 1px solid var(--surface-border);
}

.modal-loading,
.modal-empty {
  padding: 48px 24px;
  text-align: center;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.modal-body {
  padding: 20px 24px 24px;
  overflow-y: auto;
}

.overview-row {
  display: flex;
  gap: 24px;
  align-items: center;
  margin-bottom: 24px;
}

.ring-wrap {
  position: relative;
  width: 112px;
  height: 112px;
  flex-shrink: 0;
}

.ring-wrap svg {
  transform: rotate(-90deg);
}

.ring-bg {
  stroke: rgba(250, 249, 245, 0.06);
}

.ring-center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.ring-pct {
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
}

.ring-label {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-top: 4px;
}

.overview-meta {
  flex: 1;
  min-width: 0;
}

.model-name {
  font-size: calc(var(--font-size-base) + 1px);
  font-weight: 600;
  margin-bottom: 6px;
}

.token-row {
  font-size: 13px;
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);
  margin-bottom: 12px;

  strong {
    color: var(--text-primary);
  }
}

.threshold-track {
  position: relative;
  height: 8px;
  background: rgba(250, 249, 245, 0.06);
  border-radius: 4px;
  overflow: visible;
}

.threshold-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.35s ease;
}

.threshold-marker {
  position: absolute;
  top: -3px;
  width: 2px;
  height: 14px;
  border-radius: 1px;

  &.warn {
    background: var(--warning);
    opacity: 0.75;
  }
  &.compact {
    background: var(--accent-primary);
    opacity: 0.85;
  }
}

.threshold-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
  font-size: 11px;
  color: var(--text-muted);

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    margin-right: 4px;
    vertical-align: middle;

    &.used {
      background: var(--accent-secondary);
    }
    &.warn {
      background: var(--warning);
    }
    &.compact {
      background: var(--accent-primary);
    }
  }
}

.inline-warning {
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;

  &.warn {
    background: rgba(224, 137, 107, 0.12);
    color: var(--warning);
  }
  &.error,
  &.blocking {
    background: rgba(224, 96, 80, 0.12);
    color: var(--error);
  }
}

.panel-grid {
  display: grid;
  grid-template-columns: 1fr 220px;
  gap: 14px;

  @media (max-width: 640px) {
    grid-template-columns: 1fr;
  }
}

.panel-card {
  background: var(--bg-tertiary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  padding: 16px;

  h3 {
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 14px;
    color: var(--text-secondary);
  }
}

.viz-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.context-grid {
  display: grid;
  grid-template-columns: repeat(10, 12px);
  grid-template-rows: repeat(10, 12px);
  gap: 2px;
  flex-shrink: 0;
}

.grid-cell {
  width: 12px;
  height: 12px;
  border-radius: 2px;

  &.free {
    background: rgba(250, 249, 245, 0.04);
  }
  &.buffer {
    background: rgba(217, 119, 87, 0.35);
  }
}

.category-list {
  flex: 1;
  min-width: 0;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
}

.cat-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.cat-name {
  flex: 1;
}
.cat-tokens {
  font-family: var(--font-mono, monospace);
  color: var(--text-muted);
  font-size: 11px;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.stats-card .stat-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--surface-border);
  font-size: 12px;

  span:first-child {
    color: var(--text-secondary);
  }
  span:last-child {
    font-family: var(--font-mono, monospace);
    font-weight: 500;
  }

  &:last-of-type {
    border-bottom: none;
  }
}

.stat-note {
  margin-top: 12px;
  font-size: 11px;
  color: var(--text-muted);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}
.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
