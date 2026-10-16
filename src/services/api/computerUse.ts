import { electronAPI } from './_context'
import {
  EMPTY_PERMISSIONS,
  type CuaDriverStatus,
  type CuaDriverUpdateInfo,
  type CuaDriverPermissions,
  type HealthCheck,
  type McpToolResult,
} from '@/types/computerUse'

export const computerUse = {
  getStatus: (): Promise<CuaDriverStatus> =>
    electronAPI?.computerUse?.getStatus() ||
    Promise.resolve({
      platform: '',
      platformSupported: false,
      installed: false,
      binaryPath: null,
      version: null,
      source: null,
      ready: null,
      canGrant: false,
      checks: [],
      error: 'Computer Use API not available',
      permissions: EMPTY_PERMISSIONS,
    }),
  install: (): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.computerUse?.install() ||
    Promise.resolve({ success: false, error: 'Computer Use API not available' }),
  onInstallProgress: (callback: (progress: { stage: string; message: string; percent: number }) => void): (() => void) => {
    if (electronAPI?.computerUse?.onInstallProgress) {
      return electronAPI.computerUse.onInstallProgress(callback)
    }
    return () => {}
  },
  doctor: (fresh?: boolean): Promise<{ ok: boolean; checks: HealthCheck[] }> =>
    electronAPI?.computerUse?.doctor(fresh) ||
    Promise.resolve({ ok: false, checks: [] }),
  getPermissions: (): Promise<CuaDriverPermissions> =>
    electronAPI?.computerUse?.getPermissions() ||
    Promise.resolve(EMPTY_PERMISSIONS),
  grantPermissions: (): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.computerUse?.grantPermissions() ||
    Promise.resolve({ success: false, error: 'Computer Use API not available' }),
  restart: (): Promise<{ success: boolean }> =>
    electronAPI?.computerUse?.restart() ||
    Promise.resolve({ success: false }),
  checkUpdate: (): Promise<CuaDriverUpdateInfo> =>
    electronAPI?.computerUse?.checkUpdate() ||
    Promise.resolve({ updateAvailable: false, latestVersion: null, currentVersion: null }),
  callTool: (name: string, args: Record<string, unknown>): Promise<McpToolResult> =>
    electronAPI?.computerUse?.callTool(name, args) ||
    Promise.resolve({ data: null, images: [], imageMimeTypes: [], structuredContent: null, isError: true }),
}
