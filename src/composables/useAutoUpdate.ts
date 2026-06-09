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
    })
  })

  onUnmounted(() => {
    unsubAvailable?.()
    unsubNotAvailable?.()
    unsubProgress?.()
    unsubDownloaded?.()
    unsubError?.()
  })

  async function checkForUpdates() {
    status.value = 'checking'
    errorMessage.value = ''
    try {
      const result = await api.update.check()
      if (!result.success) {
        status.value = 'error'
        errorMessage.value = result.error || 'Unknown error'
      }
    } catch (err: any) {
      status.value = 'error'
      errorMessage.value = err.message
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
