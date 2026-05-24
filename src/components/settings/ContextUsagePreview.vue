<template>
  <div class="context-preview">
    <div class="preview-header">
      <span class="preview-pct">{{ usedPct }}%</span>
      <span class="preview-meta">
        <strong>{{ formatNumber(usedInput) }}</strong>
        / {{ formatNumber(contextWindow) }} {{ t('contextUsage.tokens') }}
      </span>
    </div>

    <div class="threshold-track">
      <div class="threshold-fill" :style="thresholdStyle" />
      <div class="threshold-marker warn" :style="{ left: warnMarkerPct + '%' }" />
      <div class="threshold-marker compact" :style="{ left: compactMarkerPct + '%' }" />
    </div>

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
          v-for="cat in previewCategories"
          :key="cat.name"
          class="category-item"
        >
          <span class="cat-dot" :style="{ background: cat.color }" />
          <span class="cat-name">{{ t(cat.labelKey) }}</span>
          <span class="cat-tokens">
            {{ formatTokens(cat.tokens) }}
            ({{ categoryPct(cat.tokens) }}%)
          </span>
        </div>
      </div>
    </div>

    <div class="preview-controls">
      <label class="slider-label">
        <span>{{ t('contextUsage.previewSlider') }}</span>
        <output>{{ formatNumber(usedInput) }} ({{ usedPct }}%)</output>
      </label>
      <input
        v-model.number="usedInput"
        type="range"
        min="0"
        :max="contextWindow"
        :step="contextWindow >= 1_000_000 ? 5000 : 1000"
        class="usage-slider"
      />
      <div class="preset-btns">
        <button
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          class="preset-btn"
          :class="{ active: activePreset === preset.id }"
          @click="applyPreset(preset)"
        >
          {{ t(preset.labelKey) }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  categoryColorToCss,
  formatNumber,
  formatTokens,
  getAutoCompactThreshold,
  getContextWindowForModel,
  getWarningThreshold,
} from '@/utils/contextUsage'

const props = defineProps<{
  modelId?: string
}>()

const { t } = useI18n()

const DEMO_CATEGORIES = [
  { name: 'System prompt', labelKey: 'contextUsage.categorySystemPrompt', color: categoryColorToCss('promptBorder'), baseRatio: 0.12 },
  { name: 'System tools', labelKey: 'contextUsage.categoryToolDefinitions', color: categoryColorToCss('inactive'), baseRatio: 0.08 },
  { name: 'Memory files', labelKey: 'contextUsage.categoryRules', color: categoryColorToCss('memory'), baseRatio: 0.04 },
  { name: 'Skills', labelKey: 'contextUsage.categorySkills', color: categoryColorToCss('skills'), baseRatio: 0.03 },
  { name: 'Messages', labelKey: 'contextUsage.categoryConversation', color: categoryColorToCss('messages'), baseRatio: 0.38 },
] as const

const AUTOCOMPACT_BUFFER = 13_000

const activePreset = ref('normal')
const usedInput = ref(84_000)

const contextWindow = computed(() => getContextWindowForModel(props.modelId || 'claude-sonnet-4-6'))

const usedPct = computed(() =>
  Math.min(100, Math.max(0, Math.round((usedInput.value / contextWindow.value) * 100))),
)

const warnMarkerPct = computed(() => (getWarningThreshold(props.modelId || '') / contextWindow.value) * 100)
const compactMarkerPct = computed(() => (getAutoCompactThreshold(props.modelId || '') / contextWindow.value) * 100)

const thresholdStyle = computed(() => ({
  width: `${usedPct.value}%`,
  background:
    usedInput.value >= getWarningThreshold(props.modelId || '')
      ? 'var(--warning)'
      : usedPct.value > 75
        ? 'var(--accent-primary)'
        : 'var(--accent-secondary)',
}))

const previewCategories = computed(() => {
  const sum = DEMO_CATEGORIES.reduce((total, category) => total + category.baseRatio, 0)
  return DEMO_CATEGORIES.map(category => ({
    ...category,
    tokens: Math.round(usedInput.value * (category.baseRatio / sum)),
  })).filter(category => category.tokens > 0)
})

type GridCell = { type: string; style?: Record<string, string> }

const gridCells = computed((): GridCell[] => {
  const total = 100
  const ctx = contextWindow.value
  const filled = Math.round((usedInput.value / ctx) * total)
  const buffer = Math.round((AUTOCOMPACT_BUFFER / ctx) * total)
  const cats = previewCategories.value
  const cells: GridCell[] = []

  let catIdx = 0
  const counts = cats.map(category =>
    Math.round((category.tokens / Math.max(usedInput.value, 1)) * filled),
  )

  for (let i = 0; i < total; i++) {
    if (i < filled) {
      while (catIdx < counts.length && (counts[catIdx] ?? 0) <= 0) catIdx++
      const color = cats[catIdx]?.color ?? '#6a9bcc'
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

const presets = computed(() => {
  const ctx = contextWindow.value
  return [
    { id: 'fresh', labelKey: 'contextUsage.previewFresh', value: Math.round(ctx * 0.04) },
    { id: 'normal', labelKey: 'contextUsage.previewNormal', value: Math.round(ctx * 0.42) },
    { id: 'warning', labelKey: 'contextUsage.previewWarning', value: Math.round(ctx * 0.78) },
    { id: 'compact', labelKey: 'contextUsage.previewCompact', value: Math.round(getAutoCompactThreshold(props.modelId || '') - 5000) },
  ]
})

function categoryPct(tokens: number): string {
  return ((tokens / contextWindow.value) * 100).toFixed(1)
}

function applyPreset(preset: { id: string; value: number }) {
  activePreset.value = preset.id
  usedInput.value = Math.max(0, Math.min(contextWindow.value, preset.value))
}

watch(
  () => props.modelId,
  () => {
    activePreset.value = 'normal'
    usedInput.value = Math.round(contextWindow.value * 0.42)
  },
)
</script>

<style lang="scss" scoped>
.context-preview {
  margin-top: 14px;
  padding: 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary);
}

.preview-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}

.preview-pct {
  font-size: 28px;
  font-weight: 700;
  line-height: 1;
}

.preview-meta {
  font-size: 12px;
  color: var(--text-secondary);
  font-family: var(--font-mono, monospace);

  strong {
    color: var(--text-primary);
  }
}

.threshold-track {
  position: relative;
  height: 8px;
  margin-bottom: 16px;
  background: rgba(250, 249, 245, 0.06);
  border-radius: 4px;
}

.threshold-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.35s ease, background 0.3s ease;
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

.viz-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.context-grid {
  display: grid;
  grid-template-columns: repeat(10, 11px);
  grid-template-rows: repeat(10, 11px);
  gap: 2px;
  flex-shrink: 0;
}

.grid-cell {
  width: 11px;
  height: 11px;
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
  padding: 3px 0;
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
  font-size: 11px;
  color: var(--text-muted);
}

.preview-controls {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--surface-border);
}

.slider-label {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  font-size: 12px;
  color: var(--text-muted);

  output {
    font-family: var(--font-mono, monospace);
    color: var(--text-primary);
  }
}

.usage-slider {
  width: 100%;
  accent-color: var(--accent-primary);
}

.preset-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.preset-btn {
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--surface-border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--accent-primary);
    color: var(--text-primary);
  }

  &.active {
    border-color: var(--accent-primary);
    background: rgba(217, 119, 87, 0.12);
    color: var(--accent-primary);
  }
}
</style>
