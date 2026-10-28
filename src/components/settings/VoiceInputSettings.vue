<template>
  <div class="voice-settings s-page-shell">
    <div class="s-masthead">
      <div class="s-masthead-eyebrow">Settings</div>
      <h1 class="s-masthead-title">{{ $t('voiceInput.title') }}</h1>
      <p class="s-masthead-desc">{{ $t('voiceInput.description') }}</p>
    </div>

    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon voice"><Mic :size="14" /></div>
          <span class="s-panel-title">{{ $t('voiceInput.modelTitle') }}</span>
        </div>
        <div class="s-panel-header-right">
          <button class="s-btn s-btn-secondary" :disabled="loading || isActive" @click="refreshAll">
            <RefreshCw :size="14" :class="{ spinning: loading }" />
            <span>{{ $t('voiceInput.refresh') }}</span>
          </button>
        </div>
      </div>

      <div class="s-panel-body">
        <div class="status-grid">
          <div class="status-item model-item">
            <span class="status-label">{{ $t('voiceInput.modelLabel') }}</span>
            <div class="model-identity">
              <div class="model-identity-line">
                <span class="model-name">{{ modelIdentity?.name || notAvailable }}</span>
                <span v-if="modelIdentity?.license" class="model-badge">{{ modelIdentity.license }}</span>
              </div>
              <div v-if="modelIdentity?.spec" class="model-spec">{{ modelIdentity.spec }}</div>
              <button v-if="modelIdentity?.upstreamUrl" type="button" class="model-link" @click="openUpstream">
                <ExternalLink :size="12" />
                <span>{{ $t('voiceInput.modelUpstream') }}</span>
              </button>
            </div>
          </div>
          <div class="status-item">
            <span class="status-label">{{ $t('voiceInput.stateLabel') }}</span>
            <div class="status-value">
              <span class="status-dot" :class="stateDotClass"></span>
              <span>{{ stateLabel }}</span>
            </div>
          </div>
          <div class="status-item">
            <span class="status-label">{{ $t('voiceInput.version') }}</span>
            <div class="status-value">
              <code class="version-code">{{ status?.version || notAvailable }}</code>
            </div>
          </div>
          <div class="status-item">
            <span class="status-label">{{ $t('voiceInput.diskUsage') }}</span>
            <div class="status-value">{{ formatSize(status?.diskUsageBytes ?? 0) }}</div>
          </div>
          <div v-if="status?.state === 'installed'" class="status-item">
            <span class="status-label">{{ $t('voiceInput.installedAt') }}</span>
            <div class="status-value">{{ formatInstalledAt(status?.installedAt ?? null) }}</div>
          </div>
        </div>

        <p v-if="installInfo" class="model-info">
          {{
            $t('voiceInput.modelInfo', {
              archiveSize: formatSize(installInfo.archiveBytes),
              installedSize: formatSize(installInfo.installedBytes),
            })
          }}
        </p>

        <div v-if="isActive" class="progress-block" aria-live="polite">
          <div class="progress-head">
            <span class="progress-phase">{{ progressPhaseLabel }}</span>
            <span class="progress-percent">{{ progressPercent }}%</span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" :style="{ width: progressPercent + '%' }"></div>
          </div>
          <div v-if="progressPhase !== 'extracting'" class="progress-meta">
            {{ progressMeta }}
          </div>
        </div>

        <div v-if="hints.length" class="hint-list">
          <div v-for="hint in hints" :key="hint" class="hint-item">
            <HardDrive :size="14" class="hint-icon" />
            <span>{{ hint }}</span>
          </div>
        </div>

        <div v-if="visibleError" class="error-box">
          <AlertTriangle :size="16" class="error-icon" />
          <span>{{ visibleError }}</span>
        </div>

        <div class="actions">
          <button
            v-if="isActive"
            class="s-btn s-btn-secondary"
            :disabled="canceling"
            @click="cancelInstall"
          >
            <X :size="14" />
            <span>{{ $t('voiceInput.cancel') }}</span>
          </button>
          <button
            v-else
            class="s-btn s-btn-primary"
            :disabled="loading || removing"
            @click="openInstallConfirm"
          >
            <Download :size="14" />
            <span>{{ status?.state === 'installed' ? $t('voiceInput.reinstall') : $t('voiceInput.install') }}</span>
          </button>
          <button
            v-if="!isActive && (status?.diskUsageBytes ?? 0) > 0"
            class="s-btn s-btn-danger"
            :disabled="removing"
            @click="showRemoveConfirm = true"
          >
            <Trash2 :size="14" />
            <span>{{ $t('voiceInput.remove') }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="s-panel">
      <div class="s-panel-header">
        <div class="s-panel-header-left">
          <div class="s-panel-icon link"><LinkIcon :size="14" /></div>
          <span class="s-panel-title">{{ $t('voiceInput.sourcesTitle') }}</span>
        </div>
      </div>
      <div class="s-panel-body">
        <div class="source-chain">
          <template v-for="(source, index) in installInfo?.sources ?? []" :key="source.url">
            <span v-if="index > 0" class="chain-arrow">→</span>
            <span class="source-chip" :title="source.url">{{ sourceHost(source) }}</span>
          </template>
        </div>
        <p class="s-form-hint">{{ $t('voiceInput.sourceChainHint') }}</p>

        <button
          type="button"
          class="advanced-toggle"
          :aria-expanded="showAdvanced"
          @click="showAdvanced = !showAdvanced"
        >
          <component :is="showAdvanced ? ChevronDown : ChevronRight" :size="13" />
          <span>{{ $t('voiceInput.customUrlAdvanced') }}</span>
        </button>

        <div v-if="showAdvanced" class="advanced-body">
          <div class="s-input-with-action">
            <input
              v-model="customUrl"
              class="s-form-input"
              type="url"
              spellcheck="false"
              :placeholder="$t('voiceInput.customUrlPlaceholder')"
              :aria-label="$t('voiceInput.customUrl')"
              @input="onCustomUrlInput"
            />
            <button
              class="s-btn s-btn-secondary"
              :disabled="!customUrlDirty || savingCustomUrl"
              @click="saveCustomUrl"
            >
              <Check v-if="savedJustNow" :size="14" />
              <span>{{ savedJustNow ? $t('voiceInput.customUrlSaved') : $t('common.save') }}</span>
            </button>
          </div>
          <p v-if="customUrlError" class="field-error">{{ customUrlError }}</p>
          <p v-else-if="saveState === 'failed'" class="field-error">{{ $t('voiceInput.customUrlSaveFailed') }}</p>
          <p class="s-form-hint">{{ $t('voiceInput.customUrlHint') }}</p>
        </div>
      </div>
    </div>

    <VoiceModelInstallDialog
      :visible="showInstallConfirm"
      :info="installInfo"
      @confirm="startInstall"
      @cancel="showInstallConfirm = false"
    />

    <ConfirmDialog
      :visible="showRemoveConfirm"
      :title="$t('voiceInput.removeTitle')"
      :message="$t('voiceInput.removeMessage')"
      :confirm-text="$t('voiceInput.confirmRemove')"
      variant="danger"
      @confirm="removeModel"
      @cancel="showRemoveConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  HardDrive,
  Link as LinkIcon,
  Mic,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useSettingsStore } from '@/stores/settings'
import { formatSize } from '@/utils/artifactFormat'
import ConfirmDialog from '@/components/common/ConfirmDialog.vue'
import VoiceModelInstallDialog from '@/components/common/VoiceModelInstallDialog.vue'
import type {
  VoiceModelErrorCode,
  VoiceModelInstallInfo,
  VoiceModelPhase,
  VoiceModelProgress,
  VoiceModelSource,
  VoiceModelState,
  VoiceModelStatus,
} from '@/shared/channels/voice'

const { t, locale } = useI18n()
const settingsStore = useSettingsStore()

const ACTIVE_STATES: VoiceModelState[] = ['downloading', 'verifying', 'extracting']

const status = ref<VoiceModelStatus | null>(null)
const installInfo = ref<VoiceModelInstallInfo | null>(null)
const liveProgress = ref<VoiceModelProgress | null>(null)
const loading = ref(true)
const installing = ref(false)
const removing = ref(false)
const canceling = ref(false)
const actionError = ref('')
const showInstallConfirm = ref(false)
const showRemoveConfirm = ref(false)

const customUrl = ref(settingsStore.voiceInputCustomUrl ?? '')
const customUrlError = ref('')
const savingCustomUrl = ref(false)
const saveState = ref<'idle' | 'saved' | 'failed'>('idle')
const savedJustNow = computed(() => saveState.value === 'saved')
const showAdvanced = ref(false)

const modelIdentity = computed(() => installInfo.value?.model ?? null)

const notAvailable = computed(() => t('voiceInput.notAvailable'))
const isActive = computed(
  () => installing.value || ACTIVE_STATES.includes(status.value?.state ?? 'missing'),
)
const customUrlDirty = computed(
  () => customUrl.value.trim() !== (settingsStore.voiceInputCustomUrl ?? '').trim(),
)

const stateLabel = computed(() => {
  const key: Record<VoiceModelState, string> = {
    missing: 'voiceInput.stateMissing',
    downloading: 'voiceInput.stateDownloading',
    verifying: 'voiceInput.stateVerifying',
    extracting: 'voiceInput.stateExtracting',
    installed: 'voiceInput.stateInstalled',
    corrupted: 'voiceInput.stateCorrupted',
  }
  return t(key[status.value?.state ?? 'missing'])
})

const stateDotClass = computed(() => {
  switch (status.value?.state) {
    case 'installed':
      return 'ok'
    case 'corrupted':
      return 'err'
    case 'downloading':
    case 'verifying':
    case 'extracting':
      return 'busy'
    default:
      return 'idle'
  }
})

const progressPhase = computed<VoiceModelPhase | null>(() => {
  if (!isActive.value) return null
  return liveProgress.value?.phase ?? status.value?.progress?.phase ?? 'downloading'
})

const progressPercent = computed(() => {
  if (!isActive.value) return 0
  return liveProgress.value?.percent ?? status.value?.progress?.percent ?? 0
})

const progressPhaseLabel = computed(() => {
  const key: Record<VoiceModelPhase, string> = {
    downloading: 'voiceInput.phaseDownloading',
    verifying: 'voiceInput.phaseVerifying',
    extracting: 'voiceInput.phaseExtracting',
  }
  return t(key[progressPhase.value ?? 'downloading'])
})

const progressMeta = computed(() => {
  const progress = liveProgress.value ?? status.value?.progress
  if (!progress) return ''
  return t('voiceInput.transferredOfTotal', {
    transferred: formatSize(progress.transferred),
    total: formatSize(progress.total),
  })
})

const hints = computed(() => {
  const current = status.value
  if (!current || isActive.value) return []
  const result: string[] = []
  if (current.state === 'corrupted') result.push(t('voiceInput.corruptedHint'))
  if (current.partialBytes > 0) {
    result.push(t('voiceInput.partialHint', { size: formatSize(current.partialBytes) }))
  }
  if (current.archiveReady && current.state !== 'installed') {
    result.push(t('voiceInput.archiveReadyHint'))
  }
  return result
})

const visibleError = computed(() => {
  if (actionError.value) return actionError.value
  if (isActive.value) return ''
  const current = status.value
  if (!current || (!current.errorCode && !current.error)) return ''
  return errorText(current.errorCode, current.error)
})

let unsubscribe: (() => void) | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  unsubscribe = api.voice.onModelProgress(handleProgress)
  void refreshAll()
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
  stopPolling()
})

watch(
  () => settingsStore.voiceInputCustomUrl,
  (next) => {
    if (!customUrlDirty.value && customUrl.value !== (next ?? '')) {
      customUrl.value = next ?? ''
    }
  },
)

function handleProgress(progress: VoiceModelProgress) {
  liveProgress.value = progress
  if (status.value) {
    status.value = {
      ...status.value,
      state: progress.phase,
      progress,
      error: undefined,
      errorCode: undefined,
    }
  }
  startPolling()
}

function startPolling() {
  if (pollTimer) return
  pollTimer = setInterval(() => {
    void refreshStatus()
  }, 1000)
}

function stopPolling() {
  if (!pollTimer) return
  clearInterval(pollTimer)
  pollTimer = null
}

async function refreshStatus() {
  try {
    const next = await api.voice.getModelStatus()
    status.value = next
    if (ACTIVE_STATES.includes(next.state) || installing.value) startPolling()
    else stopPolling()
  } catch (err) {
    console.error('[VoiceInput] Failed to read model status:', err)
  }
}

async function refreshAll() {
  loading.value = true
  try {
    const [nextStatus, nextInfo] = await Promise.all([
      api.voice.getModelStatus(),
      api.voice.getInstallInfo(),
    ])
    status.value = nextStatus
    installInfo.value = nextInfo
    if (ACTIVE_STATES.includes(nextStatus.state)) startPolling()
    else stopPolling()
  } catch (err) {
    console.error('[VoiceInput] Failed to load model settings:', err)
  } finally {
    loading.value = false
  }
}

async function openInstallConfirm() {
  actionError.value = ''
  if (!installInfo.value) {
    try {
      installInfo.value = await api.voice.getInstallInfo()
    } catch (err) {
      console.error('[VoiceInput] Failed to read install info:', err)
      return
    }
  }
  if (customUrlDirty.value && !(await persistCustomUrl())) return
  showInstallConfirm.value = true
}

async function startInstall() {
  if (installing.value) return
  if (!(await persistCustomUrl())) return
  showInstallConfirm.value = false
  actionError.value = ''
  liveProgress.value = null
  installing.value = true
  startPolling()
  try {
    const result = await api.voice.installModel()
    status.value = result.status
  } catch (err) {
    actionError.value = errorText(undefined, errorMessage(err))
  } finally {
    installing.value = false
    canceling.value = false
    liveProgress.value = null
    await refreshStatus()
  }
}

async function cancelInstall() {
  if (canceling.value) return
  canceling.value = true
  try {
    const result = await api.voice.cancelInstall()
    if (!result.success) {
      actionError.value = t('voiceInput.cancelFailed', { message: result.error ?? '' })
      canceling.value = false
    }
  } catch (err) {
    actionError.value = t('voiceInput.cancelFailed', { message: errorMessage(err) })
    canceling.value = false
  }
}

async function removeModel() {
  showRemoveConfirm.value = false
  if (removing.value) return
  removing.value = true
  actionError.value = ''
  try {
    const result = await api.voice.removeModel()
    status.value = result.status
    if (!result.success) {
      actionError.value = errorText(result.errorCode, result.error, 'voiceInput.removeFailed')
    }
  } catch (err) {
    actionError.value = t('voiceInput.removeFailed', { message: errorMessage(err) })
  } finally {
    removing.value = false
    await refreshStatus()
  }
}

function onCustomUrlInput() {
  customUrlError.value = ''
  saveState.value = 'idle'
}

function sourceHost(source: VoiceModelSource): string {
  try {
    return new URL(source.url).hostname
  } catch {
    return source.url
  }
}

function openUpstream() {
  const url = modelIdentity.value?.upstreamUrl
  if (url) void api.shell.openExternal(url)
}

async function saveCustomUrl() {
  if (await persistCustomUrl()) {
    saveState.value = 'saved'
    window.setTimeout(() => {
      if (saveState.value === 'saved') saveState.value = 'idle'
    }, 2000)
  }
}

async function persistCustomUrl(): Promise<boolean> {
  const value = customUrl.value.trim()
  if (!isValidUrl(value)) {
    customUrlError.value = value ? t('voiceInput.customUrlInvalid') : ''
    return !value
  }
  customUrlError.value = ''
  if (!customUrlDirty.value) return true
  savingCustomUrl.value = true
  try {
    const result = await settingsStore.setVoiceInputCustomUrl(value)
    if (!result.success) {
      saveState.value = 'failed'
      return false
    }
    saveState.value = 'saved'
    return true
  } finally {
    savingCustomUrl.value = false
  }
}

function isValidUrl(value: string): boolean {
  return !value || /^https?:\/\/\S+$/i.test(value)
}

function formatInstalledAt(value: string | null): string {
  if (!value) return notAvailable.value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale.value)
}

function errorText(
  code?: VoiceModelErrorCode,
  raw?: string,
  fallbackKey: 'voiceInput.removeFailed' | 'voiceInput.errorGeneric' = 'voiceInput.errorGeneric',
): string {
  switch (code) {
    case 'busy':
      return t('voiceInput.errorBusy')
    case 'network':
      return t('voiceInput.errorNetwork')
    case 'hash-mismatch':
      return t('voiceInput.errorHashMismatch')
    case 'tar-unavailable':
      return t('voiceInput.errorTarUnavailable')
    case 'extract-failed':
      return t('voiceInput.errorExtractFailed')
    case 'file-system':
      return t('voiceInput.errorFileSystem')
    case 'recording':
      return t('voiceInput.errorRecording')
    case 'canceled':
      return ''
    default:
      return raw ? t(fallbackKey, { message: raw }) : ''
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
</script>

<style lang="scss" scoped>
.voice-settings {
  display: flex;
  flex-direction: column;
}

.s-masthead {
  margin-bottom: 20px;
}

:deep(.s-panel-header-right) {
  display: flex;
  align-items: center;
  gap: 8px;
}

.s-panel-icon.voice,
.s-panel-icon.link {
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
}

.status-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}

.status-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 120px;
}

.model-item {
  flex-basis: 100%;
}

.model-identity {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.model-identity-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.model-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.model-badge {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-tertiary);
  color: var(--text-muted);
}

.model-spec {
  font-size: 12px;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.model-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  font-size: 12px;
  color: var(--accent-primary);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
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
    background: var(--success);
    box-shadow: 0 0 6px var(--success-glow);
  }

  &.err {
    background: var(--error);
  }

  &.busy {
    background: var(--accent-primary);
    animation: pulse 1.2s ease-in-out infinite;
  }

  &.idle {
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

.model-info {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--text-muted);
}

.progress-block {
  margin-top: 16px;
  padding: 12px 14px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
}

.progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.progress-phase {
  font-weight: 600;
}

.progress-percent {
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.progress-bar {
  height: 6px;
  background: var(--border-subtle);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent-primary);
  border-radius: 3px;
  transition: width 0.25s ease;
}

.progress-meta {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.hint-list {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hint-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.5;
}

.hint-icon {
  flex-shrink: 0;
  margin-top: 1px;
}

.error-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  background: var(--error-glow);
  border: 1px solid var(--error);
  border-radius: var(--radius-sm);
  font-size: 12.5px;
  color: var(--text-primary);
  line-height: 1.5;
}

.error-icon {
  flex-shrink: 0;
  color: var(--error);
  margin-top: 1px;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 18px;
}

.s-btn-danger {
  background: var(--error);
  color: #fff;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
}

.field-error {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--error);
}

.source-chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.source-chip {
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
}

.chain-arrow {
  font-size: 12px;
  color: var(--text-muted);
}

.advanced-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 14px;
  padding: 0;
  border: none;
  background: none;
  font-size: 12.5px;
  color: var(--text-secondary);
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
  }
}

.advanced-body {
  margin-top: 12px;
}

.spinning {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

@media (max-width: 640px) {
  .status-grid {
    gap: 16px;
  }

  .actions {
    flex-wrap: wrap;
  }
}
</style>
