import { electronAPI } from './_context'
import type {
  RtkStatus,
  RtkGainStats,
  RtkUpdateInfo,
} from '../../../electron/rtkManager'

export const rtk = {
  getStatus: (): Promise<RtkStatus> =>
    electronAPI?.rtk?.getStatus() || Promise.resolve({
      binaryInstalled: false,
      version: null,
      hookInstalled: false,
      platform: typeof process !== 'undefined' ? process.platform : 'win32',
      binaryPath: '',
      isWindows: true,
    }),
  enable: (): Promise<{ success: boolean; error?: string; status: RtkStatus }> =>
    electronAPI?.rtk?.enable() || Promise.reject('RTK API not available'),
  disable: (): Promise<{ success: boolean; error?: string; status: RtkStatus }> =>
    electronAPI?.rtk?.disable() || Promise.resolve({ success: true, status: { binaryInstalled: false, version: null, hookInstalled: false, platform: 'win32', binaryPath: '', isWindows: true } }),
  downloadBinary: (): Promise<{ success: boolean; error?: string; status?: RtkStatus }> =>
    electronAPI?.rtk?.downloadBinary() || Promise.reject('RTK API not available'),
  getStats: (): Promise<RtkGainStats | null> =>
    electronAPI?.rtk?.getStats() || Promise.resolve(null),
  checkUpdate: (): Promise<RtkUpdateInfo | null> =>
    electronAPI?.rtk?.checkUpdate() || Promise.resolve(null),
  getBinaryPath: (): Promise<string> =>
    electronAPI?.rtk?.getBinaryPath() || Promise.resolve(''),
  onDownloadProgress: (callback: (progress: { downloaded: number; total: number; percent: number }) => void) => {
    if (electronAPI?.rtk?.onDownloadProgress) {
      return electronAPI.rtk.onDownloadProgress(callback)
    }
    return () => {}
  },
}
