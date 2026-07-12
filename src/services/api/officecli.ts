import { electronAPI } from './_context'

export const officecli = {
  version: (): Promise<string> =>
    electronAPI?.officecli?.version() || Promise.reject('OfficeCLI not available'),
  checkInstalled: (): Promise<boolean> =>
    electronAPI?.officecli?.checkInstalled() || Promise.resolve(false),
  exec: (options: { args: string[]; cwd?: string; timeout?: number; env?: Record<string, string> }) =>
    electronAPI?.officecli?.exec(options) || Promise.reject('OfficeCLI not available'),
  viewHtml: (filePath: string, outputDir?: string): Promise<string> =>
    electronAPI?.officecli?.viewHtml(filePath, outputDir) || Promise.reject('OfficeCLI not available'),
  viewScreenshot: (filePath: string, outputDir: string, page?: number): Promise<string[]> =>
    electronAPI?.officecli?.viewScreenshot(filePath, outputDir, page) || Promise.reject('OfficeCLI not available'),
  watchStart: (filePath: string, port?: number): Promise<{ id: string; filePath: string; port: number; url: string }> =>
    electronAPI?.officecli?.watchStart(filePath, port) || Promise.reject('OfficeCLI not available'),
  watchStop: (watchId: string): Promise<boolean> =>
    electronAPI?.officecli?.watchStop(watchId) || Promise.resolve(false),
  watchStopAll: (): Promise<number> =>
    electronAPI?.officecli?.watchStopAll() || Promise.resolve(0),
  watchList: (): Promise<Array<{ id: string; filePath: string; url: string }>> =>
    electronAPI?.officecli?.watchList() || Promise.resolve([]),
  readImageAsDataURL: (filePath: string): Promise<string> =>
    electronAPI?.officecli?.readImageAsDataURL(filePath) || Promise.reject('OfficeCLI not available'),
}
