import { electronAPI } from './_context'

export const update = {
  check: (): Promise<{ success: boolean; error?: string }> => {
    if (electronAPI?.update?.check) {
      return electronAPI.update.check()
    }
    return Promise.resolve({ success: false, error: 'Update API not available' })
  },
  download: (): Promise<{ success: boolean; error?: string }> => {
    if (electronAPI?.update?.download) {
      return electronAPI.update.download()
    }
    return Promise.resolve({ success: false, error: 'Update API not available' })
  },
  installAndRestart: () => {
    if (electronAPI?.update?.installAndRestart) {
      electronAPI.update.installAndRestart()
    }
  },
  onAvailable: (callback: (info: { version: string; releaseDate: string; releaseNotes: string; releaseName?: string }) => void): (() => void) => {
    if (electronAPI?.update?.onAvailable) {
      return electronAPI.update.onAvailable(callback)
    }
    return () => {}
  },
  onNotAvailable: (callback: () => void): (() => void) => {
    if (electronAPI?.update?.onNotAvailable) {
      return electronAPI.update.onNotAvailable(callback)
    }
    return () => {}
  },
  onDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): (() => void) => {
    if (electronAPI?.update?.onDownloadProgress) {
      return electronAPI.update.onDownloadProgress(callback)
    }
    return () => {}
  },
  onDownloaded: (callback: (info: { version: string }) => void): (() => void) => {
    if (electronAPI?.update?.onDownloaded) {
      return electronAPI.update.onDownloaded(callback)
    }
    return () => {}
  },
  onError: (callback: (error: string) => void): (() => void) => {
    if (electronAPI?.update?.onError) {
      return electronAPI.update.onError(callback)
    }
    return () => {}
  },
}
