<template>
  <div class="rtk-settings">
    <!-- 标题区 -->
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">Settings</div>
      <h1 class="s-masthead-title">{{ $t('rtk.title') }}</h1>
      <p class="s-masthead-desc">{{ $t('rtk.description') }}</p>
    </div>

    <!-- 状态卡 -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon engine"><Zap :size="14" /></div>
          <span class="s-panel-title">{{ $t('rtk.engineStatus') }}</span>
        </div>
        <div class="s-panel-header-right">
          <button class="s-btn s-btn-secondary" @click="checkUpdate" :disabled="busy">
            <RefreshCw :size="14" :class="{ spinning: busy }" />
            <span>{{ $t('rtk.checkUpdate') }}</span>
          </button>
          <button class="s-btn s-btn-secondary" @click="reinstall" :disabled="busy">
            <Download :size="14" />
            <span>{{ status.binaryInstalled ? $t('rtk.reinstall') : $t('rtk.install') }}</span>
          </button>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="status-grid">
          <div class="status-item">
            <span class="status-label">{{ $t('rtk.binaryStatus') }}</span>
            <div class="status-value">
              <span class="status-dot" :class="status.binaryInstalled ? 'ok' : 'err'"></span>
              <span>{{ status.binaryInstalled ? $t('rtk.binaryInstalled') : $t('rtk.binaryNotInstalled') }}</span>
            </div>
          </div>
          <div class="status-item">
            <span class="status-label">{{ $t('rtk.hookStatus') }}</span>
            <div class="status-value">
              <span class="status-dot" :class="status.hookInstalled ? 'ok' : 'err'"></span>
              <span>{{ status.hookInstalled ? $t('rtk.hookInstalled') : $t('rtk.hookNotInstalled') }}</span>
            </div>
          </div>
          <div class="status-item">
            <span class="status-label">{{ $t('rtk.version') }}</span>
            <div class="status-value">
              <code class="version-code">{{ status.version || '—' }}</code>
            </div>
          </div>
        </div>

        <!-- 更新提示 -->
        <div v-if="updateInfo" class="update-notice">
          <CheckCircle v-if="!updateInfo.hasUpdate" :size="16" class="notice-icon ok" />
          <ArrowUpCircle v-else :size="16" class="notice-icon warn" />
          <span>{{ updateInfo.hasUpdate ? $t('rtk.updateAvailable') + ': ' + updateInfo.latest : $t('rtk.latestVersion') }}</span>
          <button v-if="updateInfo.hasUpdate" class="s-btn s-btn-primary" @click="reinstall" :disabled="busy">
            {{ $t('rtk.updateNow') }}
          </button>
        </div>

        <!-- 下载进度条 -->
        <div v-if="downloading" class="download-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: downloadPercent + '%' }"></div>
          </div>
          <span class="progress-text">{{ downloadPercent }}%</span>
        </div>
      </div>
    </div>

    <!-- 启用开关 -->
    <div class="s-panel">
      <div class="s-panel-body">
        <div class="setting-row">
          <div class="setting-info">
            <span class="setting-label">{{ $t('rtk.enable') }}</span>
            <span class="setting-hint">{{ $t('rtk.enableHint') }}</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" v-model="enabled" @change="onToggleEnable(enabled)" :disabled="busy" />
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>

    <!-- Token 节省统计 -->
    <div v-if="enabled" class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon stats"><BarChart3 :size="14" /></div>
          <span class="s-panel-title">{{ $t('rtk.statsTitle') }}</span>
        </div>
        <div class="s-panel-header-right">
          <button class="s-btn s-btn-secondary" @click="loadStats" :disabled="statsLoading">
            <RefreshCw :size="14" :class="{ spinning: statsLoading }" />
            <span>{{ $t('rtk.refresh') }}</span>
          </button>
        </div>
      </div>
      <div class="s-panel-body">
        <div v-if="!stats || !stats.totalCommands" class="empty-state">
          {{ $t('rtk.noData') }}
        </div>
        <template v-else>
          <div class="stats-grid">
            <div class="stat-card">
              <span class="stat-label">{{ $t('rtk.totalSaved') }}</span>
              <strong class="stat-value">{{ formatTokens(stats.totalSavedTokens) }}</strong>
            </div>
            <div class="stat-card">
              <span class="stat-label">{{ $t('rtk.commandCount') }}</span>
              <strong class="stat-value">{{ formatNumber(stats.totalCommands) }}</strong>
            </div>
            <div class="stat-card">
              <span class="stat-label">{{ $t('rtk.saveRate') }}</span>
              <strong class="stat-value">{{ formatPercent(stats.saveRate) }}</strong>
            </div>
            <div class="stat-card">
              <span class="stat-label">{{ $t('rtk.estimatedSavings') }}</span>
              <strong class="stat-value">${{ formatNumber(stats.totalSavedUsd || 0) }}</strong>
            </div>
          </div>

          <!-- 近7天趋势 -->
          <div v-if="dailyChartData.length > 0" class="chart-section">
            <h4 class="chart-title">{{ $t('rtk.recentTrend') }}</h4>
            <div class="bar-chart">
              <div v-for="(d, i) in dailyChartData" :key="i" class="bar-col">
                <div class="bar-wrap">
                  <div class="bar" :style="{ height: d.height + '%' }" :title="`${d.date}: ${formatTokens(d.savedTokens)}`"></div>
                </div>
                <span class="bar-label">{{ d.label }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Zap, RefreshCw, Download, BarChart3, CheckCircle, ArrowUpCircle } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useSettingsStore } from '@/stores/settings'
import { useRtkDownloadState } from '@/composables/useRtkDownloadState'
import type { RtkStatus, RtkGainStats, RtkUpdateInfo } from '@/types/electron.d'

const { t } = useI18n()
const settingsStore = useSettingsStore()

// 使用模块级共享状态（跨组件挂载/卸载周期持久存在）
const { downloading, downloadPercent, busy } = useRtkDownloadState()

const enabled = ref(false)
const statsLoading = ref(false)

const status = ref<RtkStatus>({
  binaryInstalled: false,
  version: null,
  hookInstalled: false,
  platform: 'win32',
  binaryPath: '',
  isWindows: true,
})

const stats = ref<RtkGainStats | null>(null)
const updateInfo = ref<RtkUpdateInfo | null>(null)

const dailyChartData = computed(() => {
  if (!stats.value?.daily || stats.value.daily.length === 0) return []
  const daily = stats.value.daily.slice(-7)
  const maxTokens = Math.max(1, ...daily.map(d => d.savedTokens))
  const weekdayLabels = [t('rtk.mon'), t('rtk.tue'), t('rtk.wed'), t('rtk.thu'), t('rtk.fri'), t('rtk.sat'), t('rtk.sun')]
  return daily.map((d, i) => {
    const date = new Date(d.date)
    const dayIdx = (date.getDay() + 6) % 7 // 周一=0
    return {
      date: d.date,
      savedTokens: d.savedTokens,
      height: Math.max(3, Math.round((d.savedTokens / maxTokens) * 100)),
      label: weekdayLabels[dayIdx] || '',
    }
  })
})

onMounted(async () => {
  enabled.value = settingsStore.rtkEnabled
  await refreshStatus()
  if (enabled.value) {
    loadStats()
  }
})

async function refreshStatus() {
  try {
    status.value = await api.rtk.getStatus()
  } catch (err) {
    console.error('Failed to get RTK status:', err)
  }
}

async function onToggleEnable(value: boolean) {
  if (busy.value) return
  busy.value = true
  try {
    if (value) {
      downloading.value = true
      downloadPercent.value = 0
      const result = await api.rtk.enable()
      downloading.value = false
      if (!result.success) {
        enabled.value = false
        console.error('Failed to enable RTK:', result.error)
      } else {
        status.value = result.status
      }
    } else {
      const result = await api.rtk.disable()
      if (result.status) status.value = result.status
    }
    settingsStore.rtkEnabled = enabled.value
    settingsStore.saveSettings()
  } catch (err) {
    console.error('RTK toggle failed:', err)
    enabled.value = !value
  } finally {
    busy.value = false
    downloading.value = false
  }
}

async function reinstall() {
  if (busy.value) return
  busy.value = true
  downloading.value = true
  downloadPercent.value = 0
  try {
    const result = await api.rtk.downloadBinary()
    if (result.success && result.status) {
      status.value = result.status
    }
    await refreshStatus()
  } catch (err) {
    console.error('Failed to reinstall RTK:', err)
  } finally {
    busy.value = false
    downloading.value = false
  }
}

async function checkUpdate() {
  if (busy.value) return
  busy.value = true
  try {
    updateInfo.value = await api.rtk.checkUpdate()
  } catch (err) {
    console.error('Failed to check RTK update:', err)
  } finally {
    busy.value = false
  }
}

async function loadStats() {
  statsLoading.value = true
  try {
    stats.value = await api.rtk.getStats()
  } catch (err) {
    console.error('Failed to load RTK stats:', err)
  } finally {
    statsLoading.value = false
  }
}

function formatNumber(value: number): string {
  if (!value) return '0'
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K'
  return Math.round(value).toLocaleString()
}

function formatTokens(value?: number): string {
  if (!value) return '0'
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'K'
  return Math.round(value).toLocaleString()
}

function formatPercent(value?: number): string {
  if (value === undefined || value === null) return '—'
  return (value * 100).toFixed(1) + '%'
}
</script>

<style lang="scss" scoped>
.rtk-settings {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 680px;

  // 补充全局 s-panel 样式中缺少的变体
  :deep(.s-panel-header-right) {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  :deep(.s-panel-icon.stats) {
    background: var(--accent-secondary-glow);
    color: var(--accent-secondary);
  }
}

.s-masthead {
  margin-bottom: 4px;
}

.s-masthead-eyebrow {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.s-masthead-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.s-masthead-desc {
  font-size: 14px;
  color: var(--text-muted);
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}

.status-value {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.ok {
    background: #22c55e;
    box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
  }

  &.err {
    background: var(--text-muted);
  }
}

.version-code {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-secondary);
  padding: 2px 6px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
}

.update-notice {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding: 10px 12px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--text-secondary);

  .notice-icon {
    flex-shrink: 0;

    &.ok { color: #22c55e; }
    &.warn { color: #f59e0b; }
  }

  .s-btn {
    margin-left: auto;
  }
}

.download-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 3px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 40px;
  text-align: right;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .setting-label {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
  }

  .setting-hint {
    font-size: 12px;
    color: var(--text-muted);
  }
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;

  input {
    opacity: 0;
    width: 0;
    height: 0;

    &:disabled + .toggle-slider {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  .toggle-slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-tertiary);
    border-radius: 24px;
    transition: 0.3s;

    &::before {
      content: "";
      position: absolute;
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background: var(--text-secondary);
      border-radius: 50%;
      transition: 0.3s;
    }
  }

  input:checked + .toggle-slider {
    background: var(--accent-primary);

    &::before {
      transform: translateX(20px);
      background: white;
    }
  }
}

.empty-state {
  text-align: center;
  padding: 32px 16px;
  color: var(--text-muted);
  font-size: 14px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

.stat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
}

.stat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
  font-weight: 600;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.chart-section {
  margin-top: 8px;
}

.chart-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 12px;
}

.bar-chart {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  height: 80px;
}

.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.bar-wrap {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.bar {
  width: 70%;
  min-height: 3px;
  background: var(--accent-primary);
  border-radius: 3px 3px 0 0;
  transition: height 0.3s ease;
  cursor: pointer;

  &:hover {
    background: var(--accent-primary-hover);
  }
}

.bar-label {
  font-size: 10px;
  color: var(--text-muted);
}

.spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 640px) {
  .status-grid {
    grid-template-columns: 1fr;
  }

  .stats-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
