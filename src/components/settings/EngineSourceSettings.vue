<template>
  <div class="engine-source-settings">
    <div class="form-group">
      <label class="form-label">{{ $t('engineSource.title') }}</label>
      <div class="source-options">
        <button
          class="source-card"
          :class="{ active: engineSource === 'bundled' }"
          @click="selectSource('bundled')"
        >
          <div class="source-card-header">
            <Package :size="18" class="source-icon" />
            <span class="source-name">{{ $t('engineSource.bundled') }}</span>
            <span class="source-badge recommended">{{ $t('engineSource.recommended') }}</span>
          </div>
          <span class="source-desc">{{ $t('engineSource.bundledDesc') }}</span>
          <Check v-if="engineSource === 'bundled'" class="source-check" :size="16" />
        </button>
        <button
          class="source-card"
          :class="{ active: engineSource === 'installed' }"
          @click="selectSource('installed')"
        >
          <div class="source-card-header">
            <Terminal :size="18" class="source-icon" />
            <span class="source-name">{{ $t('engineSource.installed') }}</span>
          </div>
          <span class="source-desc">{{ $t('engineSource.installedDesc') }}</span>
          <Check v-if="engineSource === 'installed'" class="source-check" :size="16" />
        </button>
      </div>
    </div>

    <template v-if="engineSource === 'installed'">
      <div class="divider"></div>

      <div class="form-group">
        <label class="form-label">{{ $t('engineSource.cliStatus') }}</label>

        <div v-if="isDetecting" class="cli-status detecting">
          <Loader2 :size="16" class="spin" />
          <span>{{ $t('engineSource.detecting') }}</span>
        </div>

        <div v-else-if="detectionResult?.available" class="cli-status installed">
          <CheckCircle :size="16" />
          <span class="cli-version">{{ detectionResult.version || 'unknown' }}</span>
          <span class="cli-path">{{ detectionResult.path }}</span>
        </div>

        <div v-else class="cli-status not-found">
          <AlertTriangle :size="16" />
          <span>{{ $t('engineSource.cliNotFound') }}</span>
        </div>

        <div v-if="!isDetecting && !detectionResult?.available && envCheck" class="env-check">
          <div class="env-item" :class="{ ok: envCheck.node.available }">
            <CheckCircle2 v-if="envCheck.node.available" :size="14" />
            <XCircle v-else :size="14" />
            <span class="env-name">Node.js</span>
            <span class="env-value">{{ envCheck.node.available ? envCheck.node.version : $t('engineSource.notInstalled') }}</span>
          </div>
          <div class="env-item" :class="{ ok: envCheck.npm.available }">
            <CheckCircle2 v-if="envCheck.npm.available" :size="14" />
            <XCircle v-else :size="14" />
            <span class="env-name">npm</span>
            <span class="env-value">{{ envCheck.npm.available ? envCheck.npm.version : $t('engineSource.notInstalled') }}</span>
          </div>
          <div class="env-item" :class="{ ok: envCheck.git.available }">
            <CheckCircle2 v-if="envCheck.git.available" :size="14" />
            <XCircle v-else :size="14" />
            <span class="env-name">Git</span>
            <span class="env-value">{{ envCheck.git.available ? envCheck.git.version : $t('engineSource.notInstalled') }}</span>
          </div>
        </div>
      </div>

      <div v-if="!detectionResult?.available && !isDetecting" class="form-group">
        <div v-if="installProgress" class="install-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: `${installProgress.percent || 0}%` }"></div>
          </div>
          <div class="progress-info">
            <span class="progress-stage">{{ stageLabel }}</span>
            <span class="progress-percent">{{ installProgress.percent || 0 }}%</span>
          </div>
        </div>

        <div v-if="installError" class="install-error">
          <AlertCircle :size="14" />
          <span>{{ installError }}</span>
        </div>

        <div class="install-actions">
          <button
            v-if="canInstall"
            class="btn btn-primary"
            :disabled="isInstalling"
            @click="installCli"
          >
            <Download v-if="!isInstalling" :size="14" />
            <Loader2 v-else :size="14" class="spin" />
            {{ isInstalling ? $t('engineSource.installing') : $t('engineSource.installCli') }}
          </button>

          <button
            v-else-if="missingDeps.length > 0"
            class="btn btn-secondary"
            :disabled="isInstalling"
            @click="installCli"
          >
            <Download v-if="!isInstalling" :size="14" />
            <Loader2 v-else :size="14" class="spin" />
            {{ isInstalling ? $t('engineSource.installing') : $t('engineSource.installWithDeps', { deps: missingDeps.join(', ') }) }}
          </button>
        </div>
      </div>

      <template v-if="showAdapterStatus">
        <div class="divider"></div>

        <div class="form-group">
          <label class="form-label">{{ $t('engineSource.apiAdapter') }}</label>
          <div class="adapter-status" :class="{ running: adapterRunning }">
            <span class="adapter-dot" :class="{ running: adapterRunning }"></span>
            <span class="adapter-label">
              {{ adapterRunning ? $t('engineSource.adapterRunning') : $t('engineSource.adapterStopped') }}
            </span>
            <span v-if="adapterStatus?.port" class="adapter-port">
              :{{ adapterStatus.port }}
            </span>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import {
  Check, Package, Terminal, CheckCircle, CheckCircle2, XCircle,
  AlertTriangle, AlertCircle, Download, Loader2
} from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { api } from '@/services/electronAPI'
import { useSettingsStore } from '@/stores/settings'
import type { EngineSource } from '@/stores/settings'

interface CliDetectionResult {
  available: boolean
  path: string | null
  version: string | null
}

interface EnvItemStatus {
  available: boolean
  version: string | null
  path: string | null
}

interface EnvironmentCheck {
  node: EnvItemStatus
  npm: EnvItemStatus
  git: EnvItemStatus
}

interface InstallProgressData {
  stage: 'downloading' | 'installing' | 'verifying' | 'done' | 'error'
  message: string
  percent?: number
}

interface AdapterStatusData {
  running: boolean
  port: number
  requestsProcessed: number
  errorsCount: number
  lastError?: string
}

const settingsStore = useSettingsStore()
const { t } = useI18n()

const engineSource = computed(() => settingsStore.engineSource)

const isDetecting = ref(false)
const detectionResult = ref<CliDetectionResult | null>(null)
const envCheck = ref<EnvironmentCheck | null>(null)
const isInstalling = ref(false)
const installError = ref<string | null>(null)
const installProgress = ref<InstallProgressData | null>(null)
const adapterStatus = ref<AdapterStatusData | null>(null)

let uninstallProgress: (() => void) | null = null

const canInstall = computed(() => {
  if (!envCheck.value) return false
  return envCheck.value.node.available &&
    envCheck.value.npm.available &&
    envCheck.value.git.available
})

const missingDeps = computed(() => {
  if (!envCheck.value) return []
  const deps: string[] = []
  if (!envCheck.value.node.available) deps.push('Node.js')
  if (!envCheck.value.npm.available) deps.push('npm')
  if (!envCheck.value.git.available) deps.push('Git')
  return deps
})

const adapterRunning = computed(() => adapterStatus.value?.running ?? false)

const showAdapterStatus = computed(() => {
  if (engineSource.value !== 'installed') return false
  const method = settingsStore.authMethod
  return method !== 'anthropic_compatible' && method !== 'claudeai' && method !== 'console'
})

const stageLabel = computed(() => {
  if (!installProgress.value) return ''
  const stage = installProgress.value.stage
  const map: Record<string, string> = {
    downloading: t('engineSource.stageDownloading'),
    installing: t('engineSource.stageInstalling'),
    verifying: t('engineSource.stageVerifying'),
    done: t('engineSource.stageDone'),
    error: t('engineSource.stageError'),
  }
  return map[stage] || installProgress.value.message
})

function selectSource(source: EngineSource) {
  settingsStore.setEngineSource(source)
  if (source === 'installed') {
    detectInstalled()
  } else {
    detectionResult.value = null
    envCheck.value = null
    installError.value = null
    installProgress.value = null
  }
}

async function detectInstalled() {
  isDetecting.value = true
  try {
    const [detection, env] = await Promise.all([
      api.detectInstalledCli(),
      api.checkEnvironment(),
    ])
    detectionResult.value = detection
    envCheck.value = env

    if (detection?.available && detection.path) {
      settingsStore.setInstalledCliPath(detection.path)
    }
  } catch {
    detectionResult.value = null
    envCheck.value = null
  } finally {
    isDetecting.value = false
  }
}

async function installCli() {
  isInstalling.value = true
  installError.value = null
  installProgress.value = null

  uninstallProgress = api.onInstallProgress((progress: InstallProgressData) => {
    installProgress.value = progress
  })

  try {
    const result = await api.installCli()
    if (result?.success) {
      await detectInstalled()
    } else {
      installError.value = result?.error || t('engineSource.installFailed')
    }
  } catch (err) {
    installError.value = err instanceof Error ? err.message : t('engineSource.installFailed')
  } finally {
    isInstalling.value = false
    if (uninstallProgress) {
      uninstallProgress()
      uninstallProgress = null
    }
  }
}

async function refreshAdapterStatus() {
  try {
    adapterStatus.value = await api.getProxyStatus()
  } catch {
    adapterStatus.value = null
  }
}

watch(showAdapterStatus, (show) => {
  if (show) {
    refreshAdapterStatus()
  }
})

onMounted(() => {
  if (engineSource.value === 'installed') {
    detectInstalled()
  }
  if (showAdapterStatus.value) {
    refreshAdapterStatus()
  }
})

onUnmounted(() => {
  if (uninstallProgress) {
    uninstallProgress()
    uninstallProgress = null
  }
})
</script>

<style lang="scss" scoped>
.engine-source-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
}

.source-options {
  display: flex;
  gap: 12px;
}

.source-card {
  @include reset-button;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  background: var(--surface-card);
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  text-align: left;

  &:hover {
    background: var(--bg-hover);
  }

  &.active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.05);
  }
}

.source-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.source-icon {
  color: var(--text-muted);

  .source-card.active & {
    color: var(--accent-primary);
  }
}

.source-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.source-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;

  &.recommended {
    background: rgba(var(--accent-primary-rgb), 0.1);
    color: var(--accent-primary);
  }
}

.source-desc {
  font-size: 11px;
  color: var(--text-muted);
}

.source-check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--accent-primary);
}

.divider {
  height: 1px;
  background: var(--border-default);
  margin: 4px 0;
}

.cli-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;

  &.detecting {
    background: var(--surface-soft);
    color: var(--text-secondary);
  }

  &.installed {
    background: var(--success-glow);
    color: var(--success);
  }

  &.not-found {
    background: var(--warning-glow);
    color: var(--warning);
  }
}

.cli-version {
  font-weight: 600;
}

.cli-path {
  font-size: 11px;
  color: var(--text-muted);
  margin-left: auto;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.env-check {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  background: var(--surface-soft);
  border-radius: 8px;
}

.env-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);

  &.ok {
    color: var(--success);
  }

  &:not(.ok) {
    color: var(--error);
  }
}

.env-name {
  font-weight: 500;
  min-width: 56px;
}

.env-value {
  color: var(--text-secondary);
}

.install-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-bar {
  height: 4px;
  background: var(--surface-soft);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.progress-stage {
  color: var(--text-secondary);
}

.progress-percent {
  color: var(--text-muted);
}

.install-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--error-glow);
  color: var(--error);
  font-size: 12px;
}

.install-actions {
  display: flex;
  gap: 12px;
}

.adapter-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 8px;
  background: var(--surface-soft);
  font-size: 13px;

  &.running {
    background: var(--success-glow);
  }
}

.adapter-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-muted);

  &.running {
    background: var(--success);
    box-shadow: 0 0 6px var(--success);
  }
}

.adapter-label {
  color: var(--text-primary);
  font-weight: 500;
}

.adapter-port {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono, monospace);
}

.btn {
  @include reset-button;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
    }
  }

  &.btn-secondary {
    background: var(--surface-soft);
    border: 1px solid var(--border-default);
    color: var(--text-primary);

    &:hover:not(:disabled) {
      background: var(--bg-hover);
      border-color: var(--accent-primary);
    }
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
