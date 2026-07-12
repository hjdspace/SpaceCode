import { electronAPI } from './_context'
import type {
  BrowserUseStatus,
  BrowserUseUpdateInfo,
  BrowserUseHealthCheck,
  BrowserUseInstallProgress,
  BrowserUseInstallOptions,
  BrowserUseToolResult,
  BrowserUseLiveSnapshot,
  BrowserUseAgentConfig,
} from '@/types/browserUse'

export const browserUse = {
  getStatus: (): Promise<BrowserUseStatus> =>
    electronAPI?.browserUse?.getStatus() ||
    Promise.reject(new Error('electronAPI not available')),
  install: (options?: BrowserUseInstallOptions): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.browserUse?.install(options) ||
    Promise.reject(new Error('electronAPI not available')),
  onInstallProgress: (callback: (progress: BrowserUseInstallProgress) => void): (() => void) => {
    if (electronAPI?.browserUse?.onInstallProgress) {
      return electronAPI.browserUse.onInstallProgress(callback)
    }
    return () => {}
  },
  doctor: (): Promise<{ ok: boolean; checks: BrowserUseHealthCheck[] }> =>
    electronAPI?.browserUse?.doctor() ||
    Promise.resolve({ ok: false, checks: [] }),
  checkUpdate: (): Promise<BrowserUseUpdateInfo> =>
    electronAPI?.browserUse?.checkUpdate() ||
    Promise.resolve({ updateAvailable: false, latestVersion: null, currentVersion: null }),
  callTool: (name: string, args: Record<string, unknown>): Promise<BrowserUseToolResult> =>
    electronAPI?.browserUse?.callTool(name, args) ||
    Promise.resolve({ data: null, screenshots: [], currentUrl: null, pageTitle: null, isError: true, stepsUsed: 0 }),
  config: (config?: Record<string, unknown>): Promise<BrowserUseAgentConfig | null> =>
    electronAPI?.browserUse?.config(config) ||
    Promise.resolve(null),
  navigate: (url: string): Promise<BrowserUseToolResult> =>
    electronAPI?.browserUse?.navigate(url) ||
    Promise.resolve({ data: null, screenshots: [], currentUrl: null, pageTitle: null, isError: true, stepsUsed: 0 }),
  getLiveSnapshot: (): Promise<BrowserUseLiveSnapshot | null> =>
    electronAPI?.browserUse?.getLiveSnapshot() ||
    Promise.resolve(null),
  onLiveSnapshot: (callback: (snapshot: BrowserUseLiveSnapshot) => void): (() => void) => {
    if (electronAPI?.browserUse?.onLiveSnapshot) {
      return electronAPI.browserUse.onLiveSnapshot(callback)
    }
    return () => {}
  },
}
