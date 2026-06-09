<template>
  <Transition name="slide-down">
    <div v-if="visible" class="update-notification" :class="[`is-${status}`]">
      <!-- 发现新版本 -->
      <template v-if="status === 'available'">
        <div class="update-notification-icon is-available">
          <RefreshCw :size="18" />
        </div>
        <div class="update-notification-body">
          <div class="update-notification-title">{{ t('update.newVersionAvailable', { version: updateInfo?.version }) }}</div>
          <div class="update-notification-desc">{{ t('update.currentVersion', { version: appVersion }) }}</div>
        </div>
        <div class="update-notification-actions">
          <button class="btn btn-ghost" @click="dismiss">{{ t('update.later') }}</button>
          <button class="btn btn-primary" @click="handleDownload">{{ t('update.downloadNow') }}</button>
        </div>
        <button class="update-notification-close" @click="dismiss">
          <X :size="14" />
        </button>
      </template>

      <!-- 下载中 -->
      <template v-else-if="status === 'downloading'">
        <div class="update-notification-icon is-downloading">
          <Download :size="18" />
        </div>
        <div class="update-notification-body">
          <div class="update-notification-title">{{ t('update.downloading', { version: updateInfo?.version }) }}</div>
          <div class="download-progress">
            <div class="download-progress-bar">
              <div class="download-progress-fill" :style="{ width: `${downloadProgress?.percent ?? 0}%` }"></div>
            </div>
            <span class="download-progress-text">{{ Math.round(downloadProgress?.percent ?? 0) }}%</span>
          </div>
          <div class="update-notification-desc" v-if="downloadProgress">
            {{ formatBytes(downloadProgress.transferred) }} / {{ formatBytes(downloadProgress.total) }} · {{ formatBytes(downloadProgress.bytesPerSecond) }}/s
          </div>
        </div>
        <div class="update-notification-actions">
          <button class="btn btn-ghost" @click="dismiss">{{ t('update.hide') }}</button>
        </div>
      </template>

      <!-- 下载完成 -->
      <template v-else-if="status === 'downloaded'">
        <div class="update-notification-icon is-downloaded">
          <CheckCircle :size="18" />
        </div>
        <div class="update-notification-body">
          <div class="update-notification-title">{{ t('update.readyToInstall', { version: updateInfo?.version }) }}</div>
          <div class="update-notification-desc">{{ t('update.restartToInstall') }}</div>
        </div>
        <div class="update-notification-actions">
          <button class="btn btn-ghost" @click="dismiss">{{ t('update.laterRestart') }}</button>
          <button class="btn btn-success" @click="installAndRestart">{{ t('update.restartInstall') }}</button>
        </div>
      </template>

      <!-- 检查失败 -->
      <template v-else-if="status === 'error'">
        <div class="update-notification-icon is-error">
          <AlertCircle :size="18" />
        </div>
        <div class="update-notification-body">
          <div class="update-notification-title">{{ t('update.checkFailed') }}</div>
          <div class="update-notification-desc">{{ errorMessage || t('update.networkError') }}</div>
        </div>
        <div class="update-notification-actions">
          <button class="btn btn-ghost" @click="dismiss">{{ t('update.close') }}</button>
          <button class="btn btn-primary" @click="checkForUpdates">{{ t('update.retry') }}</button>
        </div>
        <button class="update-notification-close" @click="dismiss">
          <X :size="14" />
        </button>
      </template>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RefreshCw, Download, CheckCircle, AlertCircle, X } from 'lucide-vue-next'
import type { UpdateStatus, UpdateInfo, DownloadProgress } from '@/composables/useAutoUpdate'

const props = defineProps<{
  status: UpdateStatus
  updateInfo: UpdateInfo | null
  downloadProgress: DownloadProgress | null
  errorMessage: string
  appVersion: string
}>()

const emit = defineEmits<{
  (e: 'check'): void
  (e: 'download'): void
  (e: 'install'): void
  (e: 'dismiss'): void
}>()

const { t } = useI18n()

const visible = computed(() => {
  return ['available', 'downloading', 'downloaded', 'error'].includes(props.status)
})

function handleDownload() {
  emit('download')
}

function checkForUpdates() {
  emit('check')
}

function installAndRestart() {
  emit('install')
}

function dismiss() {
  emit('dismiss')
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
</script>

<style lang="scss" scoped>
.update-notification {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  margin: 8px 12px 0;
}

.slide-down-enter-active {
  animation: slideDown 300ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.slide-down-leave-active {
  animation: slideDown 200ms cubic-bezier(0.4, 0, 0.2, 1) reverse;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-12px); }
  to { opacity: 1; transform: translateY(0); }
}

.update-notification-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &.is-available {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }

  &.is-downloading {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }

  &.is-downloaded {
    background: var(--success-glow);
    color: var(--success);
  }

  &.is-error {
    background: var(--error-glow);
    color: var(--error);
  }
}

.update-notification-body {
  flex: 1;
  min-width: 0;
}

.update-notification-title {
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.update-notification-desc {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
  margin-top: 2px;
}

.download-progress {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.download-progress-bar {
  flex: 1;
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-full);
  overflow: hidden;
}

.download-progress-fill {
  height: 100%;
  border-radius: var(--radius-full);
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-primary-hover));
  transition: width 300ms ease;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite;
  }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.download-progress-text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  min-width: 36px;
  text-align: right;
}

.update-notification-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.btn {
  padding: 6px 14px;
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all var(--transition-fast);
  white-space: nowrap;
  line-height: 1.4;

  &.btn-primary {
    background: var(--accent-primary);
    color: #fff;
    &:hover {
      background: var(--accent-primary-hover);
      box-shadow: var(--shadow-glow);
    }
  }

  &.btn-ghost {
    background: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-default);
    &:hover {
      background: var(--surface-hover);
      color: var(--text-primary);
      border-color: var(--border-strong);
    }
  }

  &.btn-success {
    background: var(--success);
    color: #fff;
    &:hover {
      filter: brightness(1.1);
      box-shadow: 0 0 12px var(--success-glow);
    }
  }
}

.update-notification-close {
  width: 24px;
  height: 24px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
}
</style>
