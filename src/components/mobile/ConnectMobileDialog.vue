<template>
  <div v-if="visible" class="mobile-dialog-overlay" @click.self="close">
    <div class="mobile-dialog">
      <div class="mobile-dialog-header">
        <h2>{{ t('mobile.connectTitle') || '连接手机' }}</h2>
        <button class="close-btn" @click="close">
          <X :size="18" />
        </button>
      </div>

      <div class="mobile-dialog-body">
        <template v-if="!status.connected">
          <p class="hint">{{ t('mobile.scanHint') || '请使用 SpaceCode 手机端扫描以下二维码' }}</p>
          <div class="qr-container">
            <canvas ref="qrCanvas" class="qr-canvas"></canvas>
          </div>
          <div class="address-info">
            <span class="label">{{ t('mobile.lanAddress') || '局域网地址' }}</span>
            <code class="address">{{ qrData?.url || '...' }}</code>
          </div>
          <div class="status-line">
            <span class="status-dot waiting"></span>
            <span>{{ t('mobile.waitingConnection') || '等待连接...' }}</span>
          </div>
        </template>

        <template v-else>
          <div class="connected-state">
            <div class="status-line">
              <span class="status-dot connected"></span>
              <span>{{ t('mobile.connected') || '已连接' }}: {{ status.clientInfo }}</span>
            </div>
          </div>
        </template>
      </div>

      <div class="mobile-dialog-footer">
        <button class="btn-cancel" @click="stopAndClose">
          {{ status.connected ? (t('mobile.disconnect') || '断开连接') : (t('mobile.cancel') || '取消') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import QRCode from 'qrcode'

const { t } = useI18n()

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const qrCanvas = ref<HTMLCanvasElement | null>(null)
const qrData = ref<{ url: string; token: string; port: number; ip: string } | null>(null)
const status = ref<{ running: boolean; connected: boolean; clientInfo?: string }>({
  running: false,
  connected: false,
})

let statusInterval: ReturnType<typeof setInterval> | null = null
let unsubConnected: (() => void) | null = null
let unsubDisconnected: (() => void) | null = null

watch(() => props.visible, async (visible) => {
  if (visible) {
    await startServer()
    startStatusPolling()
  } else {
    stopStatusPolling()
  }
})

async function startServer() {
  try {
    qrData.value = await api.mobile.startServer()
    if (qrCanvas.value && qrData.value) {
      await QRCode.toCanvas(qrCanvas.value, qrData.value.url, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
    }
  } catch (err) {
    console.error('Failed to start mobile server:', err)
  }
}

function startStatusPolling() {
  unsubConnected = api.mobile.onConnected((clientInfo) => {
    status.value = { running: true, connected: true, clientInfo }
  })
  unsubDisconnected = api.mobile.onDisconnected(() => {
    status.value = { running: true, connected: false }
  })
  statusInterval = setInterval(async () => {
    try {
      status.value = await api.mobile.getStatus()
    } catch {}
  }, 2000)
}

function stopStatusPolling() {
  if (statusInterval) clearInterval(statusInterval)
  if (unsubConnected) unsubConnected()
  if (unsubDisconnected) unsubDisconnected()
}

async function stopAndClose() {
  await api.mobile.stopServer()
  status.value = { running: false, connected: false }
  close()
}

function close() {
  emit('update:visible', false)
}

onUnmounted(() => {
  stopStatusPolling()
  if (props.visible) api.mobile.stopServer()
})
</script>

<style lang="scss" scoped>
.mobile-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.mobile-dialog {
  background: var(--bg-elevated);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-xl);
  width: 380px;
  max-width: 90vw;
}

.mobile-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 12px;

  h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    &:hover { background: var(--bg-hover); }
  }
}

.mobile-dialog-body {
  padding: 12px 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.hint {
  font-size: 14px;
  color: var(--text-secondary);
  text-align: center;
  margin: 0;
}

.qr-container {
  padding: 16px;
  background: white;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
}

.qr-canvas {
  display: block;
}

.address-info {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;

  .label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .address {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    background: var(--bg-secondary);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    word-break: break-all;
  }
}

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;

  &.waiting {
    background: var(--warning);
    animation: pulse 2s infinite;
  }

  &.connected {
    background: var(--success);
  }
}

.connected-state {
  width: 100%;
  padding: 20px 0;
}

.mobile-dialog-footer {
  padding: 12px 24px 20px;
  display: flex;
  justify-content: center;

  .btn-cancel {
    padding: 8px 24px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-default);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 14px;
    cursor: pointer;

    &:hover {
      background: var(--bg-hover);
    }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
