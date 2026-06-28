<template>
  <div class="computer-use-settings">
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">Settings</div>
      <h1 class="s-masthead-title">{{ t('computerUse.title') }}</h1>
      <p class="s-masthead-desc">{{ t('computerUse.description') }}</p>
    </div>

    <!-- 安装状态 -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon" :class="store.isInstalled ? 'success' : 'warning'">
            <Monitor :size="14" />
          </div>
          <span class="s-panel-title">{{ t('computerUse.installStatus') }}</span>
          <span v-if="store.status?.version" class="s-panel-badge">v{{ store.status.version }}</span>
        </div>
        <button class="s-btn s-btn-secondary" :disabled="store.loading" @click="store.refreshStatus()">
          <RefreshCw :size="14" :class="{ spinning: store.loading }" />
          {{ t('computerUse.refresh') }}
        </button>
      </div>
      <div class="s-panel-body">
        <div v-if="!store.isPlatformSupported" class="cu-warning">
          <AlertCircle :size="16" />
          <span>{{ t('computerUse.platformNotSupported') }}</span>
        </div>

        <template v-else>
          <div class="cu-status-row">
            <div class="cu-status-label">{{ t('computerUse.installStatus') }}</div>
            <div class="cu-status-value">
              <span v-if="store.isInstalled" class="cu-badge cu-badge-success">
                <CheckCircle :size="14" />
                {{ t('computerUse.installed') }}
              </span>
              <span v-else class="cu-badge cu-badge-danger">
                <XCircle :size="14" />
                {{ t('computerUse.notInstalled') }}
              </span>
            </div>
          </div>

          <div v-if="store.status?.version" class="cu-status-row">
            <div class="cu-status-label">{{ t('computerUse.version') }}</div>
            <div class="cu-status-value">v{{ store.status.version }}</div>
          </div>

          <div v-if="store.status?.binaryPath" class="cu-status-row">
            <div class="cu-status-label">{{ t('computerUse.binaryPath') }}</div>
            <div class="cu-status-value cu-mono">{{ store.status.binaryPath }}</div>
          </div>

          <div v-if="store.status?.source" class="cu-status-row">
            <div class="cu-status-label">{{ t('computerUse.source') }}</div>
            <div class="cu-status-value">
              <span class="cu-badge cu-badge-info">
                {{ store.status.source === 'bundled' ? t('computerUse.bundled') : t('computerUse.system') }}
              </span>
            </div>
          </div>

          <div class="cu-actions">
            <button
              v-if="!store.isInstalled || store.hasUpdate"
              class="s-btn s-btn-primary"
              :disabled="store.installing"
              @click="handleInstall"
            >
              <Download :size="14" />
              {{ store.installing ? t('computerUse.installing') : (store.hasUpdate ? t('computerUse.upgrade') : t('computerUse.install')) }}
            </button>
            <button
              class="s-btn s-btn-secondary"
              :disabled="store.checkingUpdate"
              @click="store.checkUpdate()"
            >
              <RefreshCw :size="14" :class="{ spinning: store.checkingUpdate }" />
              {{ store.checkingUpdate ? t('computerUse.checkingUpdate') : t('computerUse.checkUpdate') }}
            </button>
          </div>

          <!-- 安装进度 -->
          <div v-if="store.installing && store.installProgress" class="cu-install-progress">
            <div class="cu-progress-bar">
              <div
                class="cu-progress-fill"
                :class="{ error: store.installProgress.stage === 'error' }"
                :style="{ width: `${store.installProgress.percent}%` }"
              />
            </div>
            <span class="cu-progress-msg">{{ store.installProgress.message }}</span>
          </div>

          <div v-if="store.hasUpdate" class="cu-update-notice">
            <ArrowUpCircle :size="16" />
            <span>{{ t('computerUse.updateAvailable') }}: v{{ store.updateInfo?.latestVersion }}</span>
          </div>
          <div v-else-if="store.updateInfo && !store.updateInfo.updateAvailable && store.updateInfo.currentVersion" class="cu-update-notice cu-success">
            <CheckCircle :size="16" />
            <span>{{ t('computerUse.upToDate') }}</span>
          </div>
        </template>
      </div>
    </div>

    <!-- 权限状态（仅 macOS）-->
    <div v-if="store.isMacOS" class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon shield">
            <Shield :size="14" />
          </div>
          <span class="s-panel-title">{{ t('computerUse.permissionStatus') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <p class="cu-hint">{{ t('computerUse.permissionHint') }}</p>

        <div class="cu-permission-row">
          <div class="cu-permission-info">
            <span class="cu-permission-name">{{ t('computerUse.accessibility') }}</span>
            <span class="cu-permission-desc">{{ t('computerUse.accessibilityDesc') }}</span>
          </div>
          <span class="cu-badge" :class="permissionBadgeClass(store.status?.accessibility)">
            <CheckCircle v-if="store.status?.accessibility === true" :size="14" />
            <XCircle v-else-if="store.status?.accessibility === false" :size="14" />
            {{ permissionLabel(store.status?.accessibility) }}
          </span>
        </div>

        <div class="cu-permission-row">
          <div class="cu-permission-info">
            <span class="cu-permission-name">{{ t('computerUse.screenRecording') }}</span>
            <span class="cu-permission-desc">{{ t('computerUse.screenRecordingDesc') }}</span>
          </div>
          <span class="cu-badge" :class="permissionBadgeClass(store.status?.screenRecording)">
            <CheckCircle v-if="store.status?.screenRecording === true" :size="14" />
            <XCircle v-else-if="store.status?.screenRecording === false" :size="14" />
            {{ permissionLabel(store.status?.screenRecording) }}
          </span>
        </div>

        <div class="cu-actions">
          <button
            class="s-btn s-btn-primary"
            :disabled="store.granting"
            @click="store.grantPermissions()"
          >
            <ShieldCheck :size="14" />
            {{ store.granting ? t('computerUse.granting') : t('computerUse.grantPermissions') }}
          </button>
        </div>
        <p class="cu-hint">{{ t('computerUse.grantHint') }}</p>
      </div>
    </div>

    <!-- 健康检查 -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon" :class="healthIconClass">
            <Activity :size="14" />
          </div>
          <span class="s-panel-title">{{ t('computerUse.healthCheck') }}</span>
        </div>
        <button
          class="s-btn s-btn-secondary"
          :disabled="store.runningDoctor"
          @click="store.runDoctor()"
        >
          <Stethoscope :size="14" />
          {{ store.runningDoctor ? t('computerUse.running') : t('computerUse.runDoctor') }}
        </button>
      </div>
      <div class="s-panel-body">
        <div v-if="store.doctorResult && store.doctorResult.checks.length > 0" class="cu-checks">
          <div
            v-for="check in store.doctorResult.checks"
            :key="check.label"
            class="cu-check-item"
          >
            <div class="cu-check-icon" :class="`cu-check-${check.status}`">
              <CheckCircle v-if="check.status === 'pass'" :size="16" />
              <XCircle v-else-if="check.status === 'fail'" :size="16" />
              <MinusCircle v-else :size="16" />
            </div>
            <div class="cu-check-info">
              <span class="cu-check-label">{{ check.label }}</span>
              <span class="cu-check-message">{{ check.message }}</span>
              <span v-if="check.hint" class="cu-check-hint">{{ check.hint }}</span>
            </div>
          </div>
        </div>
        <div v-else-if="store.doctorResult" class="cu-empty">
          {{ t('computerUse.noChecks') }}
        </div>
        <div v-else class="cu-empty">
          {{ t('computerUse.healthCheckHint') }}
        </div>
      </div>
    </div>

    <!-- 就绪状态 -->
    <div class="s-panel" v-if="store.status">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon" :class="store.isReady ? 'success' : 'danger'">
            <component :is="store.isReady ? CheckCircle : AlertCircle" :size="14" />
          </div>
          <span class="s-panel-title">{{ t('computerUse.readyStatus') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="cu-ready-banner" :class="store.isReady ? 'cu-ready' : 'cu-not-ready'">
          <component :is="store.isReady ? CheckCircle : AlertCircle" :size="20" />
          <span>{{ store.isReady ? t('computerUse.ready') : t('computerUse.notReady') }}</span>
        </div>
      </div>
    </div>

    <!-- 使用说明 -->
    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon info">
            <Info :size="14" />
          </div>
          <span class="s-panel-title">{{ t('computerUse.usageGuide') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <ul class="cu-usage-list">
          <li>{{ t('computerUse.usage1') }}</li>
          <li>{{ t('computerUse.usage2') }}</li>
          <li>{{ t('computerUse.usage3') }}</li>
          <li>{{ t('computerUse.usage4') }}</li>
        </ul>
        <div v-if="store.status?.platform === 'win32'" class="cu-note">
          <Info :size="14" />
          <span>{{ t('computerUse.windowsNote') }}</span>
        </div>
        <div v-else-if="store.status?.platform === 'linux'" class="cu-note">
          <Info :size="14" />
          <span>{{ t('computerUse.linuxNote') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Monitor, RefreshCw, Download, CheckCircle, XCircle, AlertCircle,
  ArrowUpCircle, Shield, ShieldCheck, Activity, Stethoscope,
  Info, MinusCircle,
} from 'lucide-vue-next'
import { useComputerUseStore } from '@/stores/computerUse'

const { t } = useI18n()
const store = useComputerUseStore()

onMounted(() => {
  store.refreshStatus()
})

function permissionBadgeClass(granted: boolean | null | undefined): string {
  if (granted === true) return 'cu-badge-success'
  if (granted === false) return 'cu-badge-danger'
  return 'cu-badge-muted'
}

function permissionLabel(granted: boolean | null | undefined): string {
  if (granted === true) return t('computerUse.granted')
  if (granted === false) return t('computerUse.notGranted')
  return t('computerUse.unknown')
}

const healthIconClass = computed(() => {
  if (!store.doctorResult) return ''
  return store.doctorResult.ok ? 'success' : 'danger'
})

async function handleInstall() {
  await store.install()
}

</script>

<style lang="scss" scoped>
.computer-use-settings {
  max-width: 720px;
}

.cu-status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-subtle);

  &:last-of-type {
    border-bottom: none;
  }
}

.cu-status-label {
  font-size: 13.5px;
  color: var(--text-muted);
  font-weight: 500;
}

.cu-status-value {
  font-size: 13.5px;
  color: var(--text-primary);
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 6px;
}

.cu-mono {
  font-family: var(--font-mono, 'SF Mono', 'Fira Code', monospace);
  font-size: 12px;
  word-break: break-all;
  max-width: 400px;
  text-align: right;
}

.cu-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
}

.cu-badge-success {
  background: rgba(34, 197, 94, 0.12);
  color: rgb(34, 197, 94);
}

.cu-badge-danger {
  background: rgba(239, 68, 68, 0.12);
  color: rgb(239, 68, 68);
}

.cu-badge-info {
  background: rgba(59, 130, 246, 0.12);
  color: rgb(59, 130, 246);
}

.cu-badge-muted {
  background: var(--bg-secondary);
  color: var(--text-muted);
}

.cu-actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.cu-install-progress {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cu-progress-bar {
  height: 4px;
  background: var(--bg-secondary);
  border-radius: 2px;
  overflow: hidden;
}

.cu-progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 2px;
  transition: width 0.3s ease;

  &.error {
    background: var(--error);
  }
}

.cu-progress-msg {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.cu-hint {
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.6;
  margin-top: 10px;
}

.cu-update-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 14px;
  background: rgba(59, 130, 246, 0.08);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: rgb(59, 130, 246);

  &.cu-success {
    background: rgba(34, 197, 94, 0.08);
    color: rgb(34, 197, 94);
  }
}

.cu-permission-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--border-subtle);

  &:last-of-type {
    border-bottom: none;
  }
}

.cu-permission-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.cu-permission-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.cu-permission-desc {
  font-size: 12px;
  color: var(--text-muted);
}

.cu-checks {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.cu-check-item {
  display: flex;
  gap: 12px;
  padding: 10px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
}

.cu-check-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
}

.cu-check-pass {
  color: rgb(34, 197, 94);
  background: rgba(34, 197, 94, 0.1);
}

.cu-check-fail {
  color: rgb(239, 68, 68);
  background: rgba(239, 68, 68, 0.1);
}

.cu-check-skip {
  color: var(--text-muted);
  background: var(--bg-tertiary);
}

.cu-check-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.cu-check-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.cu-check-message {
  font-size: 12.5px;
  color: var(--text-secondary);
}

.cu-check-hint {
  font-size: 12px;
  color: var(--text-muted);
  font-style: italic;
}

.cu-empty {
  text-align: center;
  padding: 24px;
  color: var(--text-muted);
  font-size: 13px;
}

.cu-ready-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 600;

  &.cu-ready {
    background: rgba(34, 197, 94, 0.08);
    color: rgb(34, 197, 94);
  }

  &.cu-not-ready {
    background: rgba(239, 68, 68, 0.08);
    color: rgb(239, 68, 68);
  }
}

.cu-usage-list {
  list-style: none;
  padding: 0;
  margin: 0;

  li {
    position: relative;
    padding-left: 20px;
    padding-bottom: 10px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 9px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--accent-primary);
    }
  }
}

.cu-note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 14px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.5;
}

.cu-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(245, 158, 11, 0.08);
  border-radius: var(--radius-sm);
  color: rgb(245, 158, 11);
  font-size: 13.5px;
  font-weight: 500;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.s-panel-icon {
  &.success { background: rgba(34, 197, 94, 0.12); color: rgb(34, 197, 94); }
  &.warning { background: rgba(245, 158, 11, 0.12); color: rgb(245, 158, 11); }
  &.danger { background: rgba(239, 68, 68, 0.12); color: rgb(239, 68, 68); }
  &.shield { background: rgba(99, 102, 241, 0.12); color: rgb(99, 102, 241); }
  &.info { background: rgba(59, 130, 246, 0.12); color: rgb(59, 130, 246); }
}
</style>
