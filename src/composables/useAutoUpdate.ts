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
  let downloadTimeoutTimer: ReturnType<typeof setTimeout> | null = null

  function clearTransientTimer() {
    if (transientTimer) {
      clearTimeout(transientTimer)
      transientTimer = null
    }
  }

  function clearDownloadTimeout() {
    if (downloadTimeoutTimer) {
      clearTimeout(downloadTimeoutTimer)
      downloadTimeoutTimer = null
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
      // 收到第一个进度事件后清除超时计时器
      clearDownloadTimeout()
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
    clearDownloadTimeout()
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
      clearTransientTimer()
      clearDownloadTimeout()

      // 超时检测：如果 60 秒内没有收到任何下载进度，提示网络问题
      downloadTimeoutTimer = setTimeout(() => {
        if (status.value === 'downloading' && !downloadProgress.value) {
          status.value = 'error'
          errorMessage.value = 'downloadTimeout'
          scheduleReset(8000)
        }
      }, 60_000)

      const result = await api.update.download()
      clearDownloadTimeout()
      if (!result.success) {
        status.value = 'error'
        errorMessage.value = result.error || 'Download failed'
        scheduleReset(5000)
      }
      // 下载成功时由 onDownloaded 回调设置状态
    } catch (err: any) {
      clearDownloadTimeout()
      status.value = 'error'
      errorMessage.value = err.message
      scheduleReset(5000)
    }
  }

  function installAndRestart() {
    api.update.installAndRestart()
  }

  function dismiss() {
    // 所有可见状态（available / downloading / downloaded / error）都可以被隐藏
    // downloading 状态隐藏后，下载仍在后台继续，完成后通知会再次出现
    // downloaded 状态隐藏后，下次退出应用时会自动安装（autoInstallOnAppQuit）
    if (status.value !== 'idle' && status.value !== 'checking') {
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
