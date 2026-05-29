<template>
  <div class="engine-source-settings">
    <div class="form-group">
      <label class="form-label">Engine Source</label>
      <div class="source-options">
        <button
          v-for="source in sources"
          :key="source.id"
          class="source-card"
          :class="{ active: settingsStore.engineSource === source.id }"
          @click="selectSource(source.id)"
        >
          <span class="source-name">{{ source.name }}</span>
          <span class="source-desc">{{ source.desc }}</span>
          <Check v-if="settingsStore.engineSource === source.id" class="source-check" :size="16" />
        </button>
      </div>
      <span class="form-hint">Choose whether to use the bundled engine or an installed Claude Code CLI</span>
    </div>

    <template v-if="settingsStore.engineSource === 'installed'">
      <div class="divider"></div>

      <div class="form-group">
        <label class="form-label">CLI Detection</label>
        <div class="detection-status">
          <template v-if="detecting">
            <Loader2 class="status-icon spinning" :size="16" />
            <span class="status-text">Detecting...</span>
          </template>
          <template v-else-if="cliDetection?.available">
            <CheckCircle2 class="status-icon success" :size="16" />
            <span class="status-text">CLI found: {{ cliDetection.path }}</span>
            <span v-if="cliDetection.version" class="status-badge">v{{ cliDetection.version }}</span>
          </template>
          <template v-else>
            <XCircle class="status-icon error" :size="16" />
            <span class="status-text">Claude Code CLI not found</span>
          </template>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Environment</label>
        <div class="env-checks">
          <div v-for="item in envItems" :key="item.name" class="env-item">
            <CheckCircle2 v-if="item.available" class="status-icon success" :size="14" />
            <XCircle v-else class="status-icon error" :size="14" />
            <span class="env-name">{{ item.name }}</span>
            <span v-if="item.version" class="env-version">{{ item.version }}</span>
          </div>
        </div>
      </div>

      <div v-if="!cliDetection?.available" class="form-group">
        <button class="install-btn" :disabled="installing" @click="handleInstall">
          <Loader2 v-if="installing" class="spinning" :size="16" />
          <Download v-else :size="16" />
          <span>{{ installing ? 'Installing...' : 'Install Claude Code CLI' }}</span>
        </button>
        <div v-if="installProgress" class="install-progress">
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
          </div>
          <span class="progress-text">{{ installProgress.message }}</span>
        </div>
      </div>

      <template v-if="settingsStore.authMethod !== 'anthropic_compatible' && settingsStore.authMethod !== 'claudeai' && settingsStore.authMethod !== 'console'">
        <div class="divider"></div>

        <div class="form-group">
          <label class="form-label">API Adapter</label>
          <div class="adapter-status">
            <template v-if="proxyChecking">
              <Loader2 class="status-icon spinning" :size="16" />
              <span class="status-text">Checking adapter...</span>
            </template>
            <template v-else-if="proxyRunning">
              <CheckCircle2 class="status-icon success" :size="16" />
              <span class="status-text">API adapter running</span>
            </template>
            <template v-else>
              <XCircle class="status-icon warning" :size="16" />
              <span class="status-text">API adapter not running</span>
            </template>
          </div>
          <span class="form-hint">Required for non-Anthropic API providers with the installed CLI</span>
        </div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { Check, CheckCircle2, XCircle, Loader2, Download } from 'lucide-vue-next'
import { useSettingsStore } from '@/stores/settings'
import { api } from '@/services/electronAPI'

const settingsStore = useSettingsStore()

const sources = [
  { id: 'bundled' as const, name: 'Bundled', desc: 'Built-in engine, no setup required' },
  { id: 'installed' as const, name: 'Installed CLI', desc: 'Use official Claude Code CLI' },
]

const detecting = ref(false)
const cliDetection = ref<{ available: boolean; path: string | null; version: string | null } | null>(null)
const envCheck = ref<{ node: { available: boolean; version: string | null }; npm: { available: boolean; version: string | null }; git: { available: boolean; version: string | null } } | null>(null)
const installing = ref(false)
const installProgress = ref<{ stage: string; message: string; percent?: number } | null>(null)
const proxyChecking = ref(false)
const proxyRunning = ref(false)

let uninstallProgress: (() => void) | null = null

const envItems = computed(() => {
  if (!envCheck.value) return []
  return [
    { name: 'Node.js', ...envCheck.value.node },
    { name: 'npm', ...envCheck.value.npm },
    { name: 'Git', ...envCheck.value.git },
  ]
})

const progressPercent = computed(() => {
  if (!installProgress.value) return 0
  switch (installProgress.value.stage) {
    case 'downloading': return 25
    case 'installing': return 60
    case 'verifying': return 90
    case 'done': return 100
    default: return 0
  }
})

function selectSource(sourceId: 'bundled' | 'installed') {
  settingsStore.setEngineSource(sourceId)
  if (sourceId === 'installed') {
    runDetection()
  }
}

async function runDetection() {
  detecting.value = true
  try {
    const result = await api.detectInstalledCli()
    if (result) {
      cliDetection.value = result
      if (result.available && result.path) {
        settingsStore.setInstalledCliPath(result.path)
      }
    }
    const envResult = await api.checkEnvironment()
    if (envResult) {
      envCheck.value = envResult
    }
  } catch {
    cliDetection.value = { available: false, path: null, version: null }
  } finally {
    detecting.value = false
  }
}

async function checkProxyStatus() {
  proxyChecking.value = true
  try {
    proxyRunning.value = await api.isProxyRunning()
  } catch {
    proxyRunning.value = false
  } finally {
    proxyChecking.value = false
  }
}

async function handleInstall() {
  installing.value = true
  installProgress.value = null

  uninstallProgress = api.onInstallProgress?.((progress: any) => {
    installProgress.value = progress
  }) ?? null

  try {
    const result = await api.installCli()
    if (result?.success) {
      await runDetection()
    }
  } catch {
  } finally {
    installing.value = false
    if (uninstallProgress) {
      uninstallProgress()
      uninstallProgress = null
    }
  }
}

onMounted(() => {
  if (settingsStore.engineSource === 'installed') {
    runDetection()
    if (settingsStore.authMethod !== 'anthropic_compatible' && settingsStore.authMethod !== 'claudeai' && settingsStore.authMethod !== 'console') {
      checkProxyStatus()
    }
  }
})

onUnmounted(() => {
  if (uninstallProgress) {
    uninstallProgress()
  }
})
</script>

<style lang="scss" scoped>
.engine-source-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  align-items: flex-start;
  gap: 4px;
  padding: 14px 16px;
  background: var(--surface-card);
  border: 2px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;

  &:hover {
    background: var(--bg-hover);
  }

  &.active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.05);
  }
}

.source-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
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

.detection-status,
.adapter-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--surface-soft);
  border-radius: 8px;
}

.status-icon {
  flex-shrink: 0;

  &.success { color: #22c55e; }
  &.error { color: #ef4444; }
  &.warning { color: #f59e0b; }
  &.spinning { animation: spin 1s linear infinite; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.status-text {
  font-size: 13px;
  color: var(--text-primary);
}

.status-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: rgba(var(--accent-primary-rgb), 0.1);
  color: var(--accent-primary);
  border-radius: 4px;
  font-weight: 500;
}

.env-checks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--surface-soft);
  border-radius: 8px;
}

.env-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.env-name {
  font-size: 13px;
  color: var(--text-primary);
  min-width: 60px;
}

.env-version {
  font-size: 11px;
  color: var(--text-muted);
}

.install-btn {
  @include reset-button;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--accent-primary);
  color: white;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.install-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
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

.progress-text {
  font-size: 12px;
  color: var(--text-muted);
}

.divider {
  height: 1px;
  background: var(--border-default);
  margin: 4px 0;
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
}

.form-hint {
  font-size: 12px;
  color: var(--text-muted);
}
</style>
