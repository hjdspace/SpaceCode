import { electronAPI } from './_context'
import type { ArtifactEntry } from '../electronAPI'

export const artifacts = {
  list: (workingDir: string): Promise<{ artifacts: ArtifactEntry[] }> =>
    electronAPI?.artifacts?.list(workingDir) || Promise.resolve({ artifacts: [] }),
  open: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    electronAPI?.artifacts?.open(filePath) || Promise.resolve({ success: false }),
  reveal: (filePath: string): Promise<{ success: boolean }> =>
    electronAPI?.artifacts?.reveal(filePath) || Promise.resolve({ success: false }),
  startWatch: (artifactsDir: string): Promise<boolean> =>
    electronAPI?.artifacts?.startWatch(artifactsDir) || Promise.resolve(false),
  stopWatch: (): Promise<boolean> =>
    electronAPI?.artifacts?.stopWatch() || Promise.resolve(false),
  onChanged: (callback: (data: { eventType: string; filename: string }) => void): (() => void) => {
    if (electronAPI?.artifacts?.onChanged) {
      return electronAPI.artifacts.onChanged(callback)
    }
    return () => {}
  },
}
