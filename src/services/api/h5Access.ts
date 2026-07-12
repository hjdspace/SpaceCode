import { electronAPI } from './_context'
import type {
  H5ServerStatus,
  H5AccessSettings,
} from '../../../electron/h5Types'

export const h5Access = {
  enable: (): Promise<{ status: H5ServerStatus; token: string }> =>
    electronAPI?.h5Access?.enable() || Promise.reject('H5 Access API not available'),
  disable: (): Promise<void> =>
    electronAPI?.h5Access?.disable() || Promise.resolve(),
  regenerateToken: (): Promise<{ status: H5ServerStatus; token: string }> =>
    electronAPI?.h5Access?.regenerateToken() || Promise.reject('H5 Access API not available'),
  getStatus: (): Promise<H5ServerStatus> =>
    electronAPI?.h5Access?.getStatus() || Promise.resolve({ running: false, port: 0, ip: '', publicUrl: null, connectedClients: 0 }),
  getSettings: (): Promise<H5AccessSettings> =>
    electronAPI?.h5Access?.getSettings() || Promise.resolve({ enabled: false, token: null, tokenPreview: null, publicBaseUrl: null, fixedPort: null }),
  updateSettings: (input: Partial<Pick<H5AccessSettings, 'publicBaseUrl' | 'fixedPort'>>) =>
    electronAPI?.h5Access?.updateSettings(input) || Promise.resolve({ enabled: false, token: null, tokenPreview: null, publicBaseUrl: null, fixedPort: null }),
  setMirrorSession: (sessionId: string | null, projectPath: string | null) =>
    electronAPI?.h5Access?.setMirrorSession(sessionId, projectPath) || Promise.resolve(),
  checkBuild: (): Promise<{ built: boolean; path: string }> =>
    electronAPI?.h5Access?.checkBuild() || Promise.resolve({ built: false, path: '' }),
}
