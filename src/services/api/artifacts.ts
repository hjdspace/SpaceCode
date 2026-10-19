import { electronAPI } from './_context'
import type { ArtifactEntry, ArtifactsWatchStatus } from '../electronAPI'

export const artifacts = {
  list: (workingDir: string, options?: { scanWorkspaceRoot?: boolean }): Promise<{ artifacts: ArtifactEntry[] }> =>
    electronAPI?.artifacts?.list(workingDir, options) || Promise.resolve({ artifacts: [] }),
  open: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.artifacts?.open(filePath) || Promise.resolve({ success: false }),
  reveal: (filePath: string): Promise<{ success: boolean }> =>
    electronAPI?.artifacts?.reveal(filePath) || Promise.resolve({ success: false }),
  // 未注册（H5/浏览器预览等场景）与主进程侧零 watcher 都压成 watching=false，
  // 面板据此退回轮询/手动刷新（issue #44）。
  startWatch: (artifactsDir: string): Promise<ArtifactsWatchStatus> =>
    electronAPI?.artifacts?.startWatch(artifactsDir) || Promise.resolve({ watching: false, watchCount: 0 }),
  stopWatch: (): Promise<boolean> =>
    electronAPI?.artifacts?.stopWatch() || Promise.resolve(false),
  onChanged: (callback: (data: { eventType: string; filename: string }) => void): (() => void) => {
    if (electronAPI?.artifacts?.onChanged) {
      return electronAPI.artifacts.onChanged(callback)
    }
    return () => {}
  },
}
