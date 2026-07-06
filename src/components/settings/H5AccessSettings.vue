<template>
  <div class="h5-access-settings">
    <h2 class="settings-title">{{ $t('h5Access.title') }}</h2>
    <p class="settings-desc">{{ $t('h5Access.description') }}</p>

    <!-- 开发模式构建检查 -->
    <div v-if="!buildStatus.built" class="build-warning">
      <AlertTriangle :size="18" />
      <div>
        <p class="warning-title">{{ $t('h5Access.buildRequired') }}</p>
        <p class="warning-desc">{{ $t('h5Access.buildRequiredDesc') }}</p>
        <code class="build-cmd">npm run build</code>
      </div>
    </div>

    <!-- 开关 -->
    <div class="setting-row">
      <div class="setting-info">
        <span class="setting-label">{{ $t('h5Access.enable') }}</span>
        <span class="setting-hint">{{ $t('h5Access.enableHint') }}</span>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" v-model="enabled" @change="onToggleEnable(enabled)" />
        <span class="toggle-slider"></span>
      </label>
    </div>

    <!-- 服务器状态 -->
    <div v-if="status.running" class="status-card">
      <div class="status-header">
        <div class="status-indicator">
          <span class="status-dot running"></span>
          <span>{{ $t('h5Access.serverRunning') }}</span>
        </div>
        <span class="status-url">{{ status.publicUrl }}</span>
      </div>
      <div class="status-details">
        <div class="detail-item">
          <span class="detail-label">IP</span>
          <span class="detail-value">{{ status.ip }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">{{ $t('h5Access.port') }}</span>
          <span class="detail-value">{{ status.port }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">{{ $t('h5Access.connectedClients') }}</span>
          <span class="detail-value">{{ status.connectedClients }}</span>
        </div>
      </div>

      <!-- QR 码 -->
      <div v-if="qrCodeDataUrl" class="qr-section">
        <img :src="qrCodeDataUrl" alt="QR Code" class="qr-image" />
        <p class="qr-hint">{{ $t('h5Access.qrHint') }}</p>
      </div>

      <!-- Token 管理 -->
      <div class="token-section">
        <div class="token-row">
          <span class="token-label">{{ $t('h5Access.token') }}</span>
          <code class="token-value">{{ tokenPreview || '—' }}</code>
          <button class="btn btn-secondary" @click="onRegenerateToken" :disabled="regenerating">
            <RefreshCw :size="14" />
            {{ $t('h5Access.regenerateToken') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 高级设置 -->
    <div v-if="status.running || enabled" class="advanced-settings">
      <h3 class="section-title">{{ $t('h5Access.advanced') }}</h3>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('h5Access.fixedPort') }}</span>
          <span class="setting-hint">{{ $t('h5Access.fixedPortHint') }}</span>
        </div>
        <input
          v-model.number="portInput"
          type="number"
          class="port-input"
          :placeholder="$t('h5Access.portPlaceholder')"
          min="0"
          max="65535"
          @change="onUpdatePort"
        />
      </div>

      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">{{ $t('h5Access.publicBaseUrl') }}</span>
          <span class="setting-hint">{{ $t('h5Access.publicBaseUrlHint') }}</span>
        </div>
        <input
          v-model="baseUrlInput"
          type="text"
          class="url-input"
          placeholder="http://192.168.1.100:34567"
          @change="onUpdateBaseUrl"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, RefreshCw } from 'lucide-vue-next'
import QRCode from 'qrcode'
import { api } from '@/services/electronAPI'
import type { H5ServerStatus } from '../../../electron/h5Types'

const { t } = useI18n()

const enabled = ref(false)
const status = ref<H5ServerStatus>({
  running: false,
  port: 0,
  ip: '',
  publicUrl: null,
  connectedClients: 0,
})
const tokenPreview = ref<string | null>(null)
const fullToken = ref<string | null>(null)
const qrCodeDataUrl = ref<string | null>(null)
const regenerating = ref(false)
const portInput = ref<number | null>(null)
const baseUrlInput = ref<string>('')
const buildStatus = ref<{ built: boolean; path: string }>({ built: false, path: '' })

let pollTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryCount = 0
const MAX_RETRIES = 5

/** 服务器启动竞态处理：enabled 为 true 但服务器尚未就绪时，短时间内快速重试 */
function scheduleStartupRetry() {
  if (retryTimer) clearTimeout(retryTimer)
  if (retryCount >= MAX_RETRIES) return
  retryCount++
  retryTimer = setTimeout(async () => {
    retryTimer = null
    if (!enabled.value || status.value.running) return
    const st = await api.h5Access.getStatus()
    status.value = st
    if (!st.running && retryCount < MAX_RETRIES) {
      scheduleStartupRetry()
    }
  }, 1000)
}

onMounted(async () => {
  const settings = await api.h5Access.getSettings()
  enabled.value = settings.enabled
  tokenPreview.value = settings.tokenPreview
  fullToken.value = settings.token
  portInput.value = settings.fixedPort
  baseUrlInput.value = settings.publicBaseUrl || ''

  const currentStatus = await api.h5Access.getStatus()
  status.value = currentStatus

  if (currentStatus.running && currentStatus.publicUrl) {
    await generateQRCode(currentStatus.publicUrl)
  } else if (settings.enabled) {
    // 服务器可能正在启动中（应用刚重启），短时间内快速重试
    retryCount = 0
    scheduleStartupRetry()
  }

  buildStatus.value = await api.h5Access.checkBuild()

  // 轮询状态
  pollTimer = setInterval(async () => {
    if (enabled.value) {
      status.value = await api.h5Access.getStatus()
    }
  }, 3000)
})

watch(() => status.value.publicUrl, async (url) => {
  if (url) {
    await generateQRCode(url)
  } else {
    qrCodeDataUrl.value = null
  }
})

async function generateQRCode(url: string) {
  // 将 token 拼接到 URL 中，手机端通过 token 参数识别 H5 模式
  const token = fullToken.value
  const connectUrl = token ? `${url}?token=${encodeURIComponent(token)}` : url
  try {
    qrCodeDataUrl.value = await QRCode.toDataURL(connectUrl, {
      width: 256,
      margin: 2,
      color: { dark: '#0c0c1d', light: '#ffffff' },
    })
  } catch (err) {
    console.error('Failed to generate QR code:', err)
  }
}

async function onToggleEnable(value: boolean) {
  if (value) {
    const result = await api.h5Access.enable()
    status.value = result.status
    fullToken.value = result.token
    tokenPreview.value = result.token.slice(0, 8) + '...' + result.token.slice(-4)
    // 生成包含 token 的 QR 码
    if (status.value.publicUrl) {
      await generateQRCode(status.value.publicUrl)
    }
  } else {
    await api.h5Access.disable()
    status.value = {
      running: false,
      port: 0,
      ip: '',
      publicUrl: null,
      connectedClients: 0,
    }
    qrCodeDataUrl.value = null
  }
}

async function onRegenerateToken() {
  regenerating.value = true
  try {
    const result = await api.h5Access.regenerateToken()
    status.value = result.status
    fullToken.value = result.token
    tokenPreview.value = result.token.slice(0, 8) + '...' + result.token.slice(-4)
    // 重新生成 QR 码（包含新 token）
    if (status.value.publicUrl) {
      await generateQRCode(status.value.publicUrl)
    }
  } catch (err) {
    console.error('Failed to regenerate token:', err)
  } finally {
    regenerating.value = false
  }
}

async function onUpdatePort() {
  await api.h5Access.updateSettings({ fixedPort: portInput.value || null })
}

async function onUpdateBaseUrl() {
  await api.h5Access.updateSettings({ publicBaseUrl: baseUrlInput.value || null })
  // 更新状态以反映新的 URL
  status.value = await api.h5Access.getStatus()
}

// 清理轮询
import { onUnmounted } from 'vue'
onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
})
</script>

<style lang="scss" scoped>
.h5-access-settings {
  max-width: 640px;
}

.settings-title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.settings-desc {
  font-size: 14px;
  color: var(--text-muted);
  margin-bottom: 24px;
}

.build-warning {
  display: flex;
  gap: 12px;
  padding: 16px;
  background: var(--bg-warning, rgba(255, 193, 7, 0.1));
  border: 1px solid var(--border-warning, rgba(255, 193, 7, 0.3));
  border-radius: var(--radius-md);
  margin-bottom: 20px;

  svg {
    color: var(--text-warning, #ffc107);
    flex-shrink: 0;
  }

  .warning-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
  }

  .warning-desc {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .build-cmd {
    display: inline-block;
    padding: 4px 8px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-primary);
  }
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--border-subtle);

  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
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

  input {
    opacity: 0;
    width: 0;
    height: 0;
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

.status-card {
  margin-top: 20px;
  padding: 20px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;

  &.running {
    background: #22c55e;
    box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  }
}

.status-url {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
}

.status-details {
  display: flex;
  gap: 24px;
  margin-bottom: 16px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.detail-value {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.qr-section {
  text-align: center;
  padding: 20px;
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  margin-bottom: 16px;
}

.qr-image {
  width: 200px;
  height: 200px;
  border-radius: var(--radius-sm);
}

.qr-hint {
  font-size: 13px;
  color: var(--text-muted);
  margin-top: 12px;
}

.token-section {
  padding-top: 16px;
  border-top: 1px solid var(--border-subtle);
}

.token-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.token-label {
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.token-value {
  flex: 1;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  padding: 4px 8px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;

  &.btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-secondary);

    &:hover {
      background: var(--bg-elevated);
      color: var(--text-primary);
    }

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }
}

.advanced-settings {
  margin-top: 24px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.port-input,
.url-input {
  padding: 6px 10px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 13px;
  width: 200px;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
}

.url-input {
  width: 280px;
}
</style>
