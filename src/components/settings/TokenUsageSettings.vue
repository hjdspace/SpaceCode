<template>
  <div class="token-usage-settings">
    <div class="s-masthead" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;">
      <div>
        <div class="s-masthead-eyebrow">Settings</div>
        <h1 class="s-masthead-title">Token 用量</h1>
        <p class="s-masthead-desc">{{ dateRangeText }} · 基于本机 Claude Code CLI 会话记录统计</p>
      </div>
      <button class="s-btn s-btn-secondary" :disabled="loading" @click="loadStats" style="margin-top: 24px;">
        <RefreshCw :size="14" :class="{ spinning: loading }" />
        <span>刷新</span>
      </button>
    </div>

    <div v-if="error" class="s-status-badge error">{{ error }}</div>
    <div v-else-if="loading && !stats" class="s-card loading-state">正在读取本机会话记录...</div>
    <div v-else-if="stats" class="usage-content">
      <div class="s-panel">
        <div class="s-panel-header">
          <div class="s-panel-header-left">
            <div class="s-panel-icon engine"><Activity :size="14" /></div>
            <span class="s-panel-title">Token 用量概览</span>
          </div>
        </div>
        <div class="s-panel-body">
          <div class="summary-grid">
            <div class="summary-item">
              <span class="summary-label">今天</span>
              <strong>{{ formatTokens(stats.today.totalTokens) }}</strong>
              <span>{{ stats.today.sessionCount }} 次会话</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">昨天</span>
              <strong>{{ formatTokens(stats.yesterday.totalTokens) }}</strong>
              <span>{{ stats.yesterday.sessionCount }} 次会话</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">30 天</span>
              <strong>{{ formatTokens(stats.last30Days.totalTokens) }}</strong>
              <span>{{ stats.last30Days.sessionCount }} 次会话</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">全部</span>
              <strong>{{ formatTokens(stats.allTime.totalTokens) }}</strong>
              <span>{{ stats.allTime.sessionCount }} 次会话</span>
            </div>
          </div>
        </div>
      </div>

      <div class="s-panel">
        <div class="s-panel-body">
          <div class="heatmap-section">
            <div class="heatmap-scroll">
              <div class="month-row">
                <span v-for="month in monthLabels" :key="month.key" :style="{ gridColumnStart: month.column }">{{ month.label }}</span>
              </div>
              <div class="heatmap-wrap">
                <div class="weekday-labels">
                  <span>周一</span>
                  <span>周三</span>
                  <span>周五</span>
                </div>
                <div class="heatmap-grid">
                  <div
                    v-for="day in heatmapDays"
                    :key="day.date"
                    class="heatmap-cell"
                    :class="[`level-${day.level}`, { active: hoveredDay?.date === day.date }]"
                    @mouseenter="showTooltip(day, $event)"
                    @mousemove="moveTooltip"
                    @mouseleave="hideTooltip"
                  ></div>
                </div>
              </div>
            </div>
            <div class="heatmap-legend">
              <span>少</span>
              <i class="level-0"></i>
              <i class="level-1"></i>
              <i class="level-2"></i>
              <i class="level-3"></i>
              <i class="level-4"></i>
              <span>多</span>
            </div>
            <div
              v-if="hoveredDay"
              class="heatmap-tooltip"
              :style="{ left: `${tooltipPosition.x}px`, top: `${tooltipPosition.y}px` }"
            >
              <strong>{{ formatChineseDate(hoveredDay.date) }}</strong>
              <span>{{ hoveredDay.sessions }} 次会话 · {{ formatTokens(hoveredDay.tokens) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="detail-grid">
        <div class="s-panel">
          <div class="s-panel-body">
            <div class="detail-section">
              <h3>Token 构成</h3>
              <div class="stat-row"><span>输入</span><strong>{{ formatNumber(stats.allTime.inputTokens) }}</strong></div>
              <div class="stat-row"><span>输出</span><strong>{{ formatNumber(stats.allTime.outputTokens) }}</strong></div>
              <div class="stat-row"><span>缓存创建</span><strong>{{ formatNumber(stats.allTime.cacheCreationInputTokens) }}</strong></div>
              <div class="stat-row"><span>缓存读取</span><strong>{{ formatNumber(stats.allTime.cacheReadInputTokens) }}</strong></div>
            </div>
          </div>
        </div>
        <div class="s-panel">
          <div class="s-panel-body">
            <div class="detail-section">
              <h3>模型用量</h3>
              <div v-if="modelRows.length === 0" class="empty-text">暂无模型数据</div>
              <div v-for="row in modelRows" :key="row.model" class="model-row">
                <span :title="row.model">{{ row.model }}</span>
                <strong>{{ formatTokens(row.totalTokens) }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RefreshCw, Activity } from 'lucide-vue-next'
import { api, type TokenStatsDailyEntry, type TokenStatsResult } from '@/services/electronAPI'

const stats = ref<TokenStatsResult | null>(null)
const loading = ref(false)
const error = ref('')
const hoveredDay = ref<{ date: string; tokens: number; sessions: number; level: number } | null>(null)
const tooltipPosition = ref({ x: 0, y: 0 })

const dailyMap = computed(() => {
  const map = new Map<string, TokenStatsDailyEntry>()
  for (const day of stats.value?.daily || []) map.set(day.date, day)
  return map
})

const dateRangeText = computed(() => {
  if (!stats.value?.firstDate || !stats.value?.lastDate) return '暂无统计数据'
  return `${stats.value.firstDate} - ${stats.value.lastDate}`
})

const modelRows = computed(() => Object.entries(stats.value?.modelUsage || {})
  .map(([model, usage]) => ({ model, totalTokens: usage.totalTokens }))
  .sort((a, b) => b.totalTokens - a.totalTokens)
  .slice(0, 8))

const heatmapDays = computed(() => {
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const maxTokens = Math.max(1, ...Array.from(dailyMap.value.values()).map(day => day.totalTokens))
  const days: Array<{ date: string; tokens: number; sessions: number; level: number }> = []
  for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10)
    const day = dailyMap.value.get(date)
    const tokens = day?.totalTokens || 0
    const level = tokens === 0 ? 0 : Math.max(1, Math.ceil((tokens / maxTokens) * 4))
    days.push({ date, tokens, sessions: day?.sessionCount || 0, level })
  }
  return days
})

const monthLabels = computed(() => {
  const labels: Array<{ key: string; label: string; column: number }> = []
  let previous = ''
  heatmapDays.value.forEach((day, index) => {
    const month = day.date.slice(5, 7)
    if (month !== previous) {
      labels.push({ key: day.date, label: `${Number(month)}月`, column: Math.floor(index / 7) + 1 })
      previous = month
    }
  })
  return labels
})

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString()
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M tokens`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K tokens`
  return `${formatNumber(value)} tokens`
}

function formatChineseDate(date: string): string {
  const [year, month, day] = date.split('-')
  return `${year}年${Number(month)}月${Number(day)}日`
}

function showTooltip(day: { date: string; tokens: number; sessions: number; level: number }, event: MouseEvent) {
  hoveredDay.value = day
  moveTooltip(event)
}

function moveTooltip(event: MouseEvent) {
  const tooltipWidth = 220
  const tooltipHeight = 76
  const gap = 14
  const padding = 12
  const showLeft = event.clientX + tooltipWidth + gap + padding > window.innerWidth
  const left = showLeft ? event.clientX - tooltipWidth - gap : event.clientX + gap
  const top = Math.min(
    Math.max(event.clientY - tooltipHeight - 10, padding),
    window.innerHeight - tooltipHeight - padding,
  )
  tooltipPosition.value = {
    x: Math.max(padding, left),
    y: top,
  }
}

function hideTooltip() {
  hoveredDay.value = null
}

async function loadStats() {
  loading.value = true
  error.value = ''
  try {
    const result = await api.getTokenUsageStats()
    if (!result.success || !result.data) {
      throw new Error(result.error || '读取 Token 统计失败')
    }
    stats.value = result.data
  } catch (err: any) {
    error.value = err?.message || '读取 Token 统计失败'
  } finally {
    loading.value = false
  }
}

onMounted(loadStats)
</script>

<style lang="scss" scoped>

.token-usage-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 780px;
}

.s-page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-state {
  color: var(--text-muted);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}

.summary-item {
  padding: 14px;
  margin-bottom: 0;

  .summary-label,
  span:last-child {
    display: block;
    color: var(--text-muted);
    font-size: 12px;
  }

  strong {
    display: block;
    margin: 6px 0 2px;
    color: var(--text-primary);
    font-size: 22px;
    line-height: 1.15;
  }
}

.heatmap-section {
  position: relative;
  overflow: visible;
}

.heatmap-scroll {
  overflow-x: auto;
  overflow-y: visible;
  padding: 0 2px 8px;
  @include scrollbar;
}

.month-row {
  display: grid;
  grid-template-columns: repeat(53, 16px);
  gap: 3px;
  margin-left: 44px;
  margin-bottom: 10px;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 500;
  min-width: max-content;

  span {
    white-space: nowrap;
    line-height: 1;
  }
}

.heatmap-wrap {
  display: flex;
  gap: 10px;
}

.weekday-labels {
  width: 34px;
  display: grid;
  grid-template-rows: repeat(7, 16px);
  gap: 3px;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 16px;

  span:nth-child(1) { grid-row: 2; }
  span:nth-child(2) { grid-row: 4; }
  span:nth-child(3) { grid-row: 6; }
}

.heatmap-grid {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(7, 16px);
  grid-auto-columns: 16px;
  gap: 3px;
  min-width: max-content;
}

.heatmap-cell,
.heatmap-legend i {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--border-subtle);
}

.heatmap-cell {
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.12s ease, box-shadow 0.12s ease;

  &:hover,
  &.active {
    transform: scale(1.08);
    border-color: var(--text-primary);
    box-shadow: 0 0 0 1px var(--border-default);
  }
}

.level-0 { background: var(--bg-tertiary); }
.level-1 { background: var(--accent-primary-glow); }
.level-2 { background: color-mix(in srgb, var(--accent-primary-glow), var(--accent-primary)); }
.level-3 { background: var(--accent-primary); }
.level-4 { background: var(--accent-primary-hover); }

.heatmap-legend {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  margin-top: 14px;
  color: var(--text-muted);
  font-size: 12px;

  i {
    display: inline-block;
  }
}

.heatmap-tooltip {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 174px;
  padding: 13px 16px;
  border-radius: 10px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-xl);
  pointer-events: none;

  strong {
    font-size: 18px;
    line-height: 1.1;
    font-weight: 700;
  }

  span {
    font-size: 16px;
    line-height: 1.1;
    color: var(--text-secondary);
  }
}

.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

.detail-section {
  padding: 0;

  h3 {
    margin: 0 0 12px;
    color: var(--text-primary);
    font-size: calc(var(--font-size-base) + 1px);
  }
}

.stat-row,
.model-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--border-default);
  color: var(--text-secondary);
  font-size: 13px;

  strong {
    color: var(--text-primary);
  }
}

.model-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-text {
  color: var(--text-muted);
  font-size: 13px;
}

@media (max-width: 900px) {
  .summary-grid,
  .detail-grid {
    grid-template-columns: 1fr 1fr;
  }
}

@media (max-width: 640px) {
  .summary-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
