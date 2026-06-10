import { ref, onMounted, onUnmounted } from 'vue'
import { api } from '@/services/electronAPI'

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error' | 'up-to-date'

export interface UpdateInfo {
  version: string
  releaseDate?: string
  releaseNotes?: any
  releaseName?: string
}

export interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export function useAutoUpdate() {
  const status = ref<UpdateStatus>('idle')
  const updateInfo = ref<UpdateInfo | null>(null)
  const downloadProgress = ref<DownloadProgress | null>(null)
  const errorMessage = ref<string>('')
  const appVersion = ref<string>('')

  let unsubAvailable: (() => void) | null = null
  let unsubNotAvailable: (() => void) | null = null
  let unsubProgress: (() => void) | null = null
  let unsubDownloaded: (() => void) | null = null
  let unsubError: (() => void) | null = null
  let transientTimer: ReturnType<typeof setTimeout> | null = null

  function clearTransientTimer() {
    if (transientTimer) {
      clearTimeout(transientTimer)
      transientTimer = null
    }
  }

  /** 将 transient 状态（up-to-date / error）在指定毫秒后自动重置为 idle */
  function scheduleReset(delay = 3000) {
    clearTransientTimer()
    transientTimer = setTimeout(() => {
      if (status.value === 'up-to-date' || status.value === 'error') {
        status.value = 'idle'
        errorMessage.value = ''
      }
      transientTimer = null
    }, delay)
  }

  onMounted(async () => {
    // 获取当前版本
    try {
      appVersion.value = await api.getAppVersion()
    } catch {
      appVersion.value = '0.0.0'
    }

    // 注册事件监听
    unsubAvailable = api.update.onAvailable((info) => {
      status.value = 'available'
      updateInfo.value = info
    })

    unsubNotAvailable = api.update.onNotAvailable(() => {
      status.value = 'up-to-date'
      scheduleReset(3000)
    })

    unsubProgress = api.update.onDownloadProgress((progress) => {
      status.value = 'downloading'
      downloadProgress.value = progress
    })

    unsubDownloaded = api.update.onDownloaded((info) => {
      status.value = 'downloaded'
      updateInfo.value = info
    })

    unsubError = api.update.onError((err) => {
      status.value = 'error'
      errorMessage.value = err
      scheduleReset(5000)
    })
  })

  onUnmounted(() => {
    clearTransientTimer()
    unsubAvailable?.()
    unsubNotAvailable?.()
    unsubProgress?.()
    unsubDownloaded?.()
    unsubError?.()
  })

  async function checkForUpdates() {
    clearTransientTimer()
    status.value = 'checking'
    errorMessage.value = ''
    try {
      const result = await api.update.check()
      if (!result.success) {
        status.value = 'error'
        errorMessage.value = result.error || 'Unknown error'
        scheduleReset(5000)
      }
      // 成功时由 onAvailable / onNotAvailable 回调设置状态
    } catch (err: any) {
      status.value = 'error'
      errorMessage.value = err.message
      scheduleReset(5000)
    }
  }

  async function downloadUpdate() {
    try {
      status.value = 'downloading'
      downloadProgress.value = null
      const result = await api.update.download()
      if (!result.success) {
        status.value = 'error'
        errorMessage.value = result.error || 'Download failed'
      }
    } catch (err: any) {
      status.value = 'error'
      errorMessage.value = err.message
    }
  }

  function installAndRestart() {
    api.update.installAndRestart()
  }

  function dismiss() {
    if (status.value === 'available' || status.value === 'error' || status.value === 'up-to-date') {
      status.value = 'idle'
    }
  }

  return {
    status,
    updateInfo,
    downloadProgress,
    errorMessage,
    appVersion,
    checkForUpdates,
    downloadUpdate,
    installAndRestart,
    dismiss,
  }
}
