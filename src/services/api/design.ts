import { electronAPI } from './_context'
import type { DesignSystemSummary } from '../electronAPI'

export const design = {
  listSystems: (): Promise<DesignSystemSummary[]> =>
    electronAPI?.design?.listSystems() || Promise.resolve([]),
  getSystemPreview: (systemId: string, pagePath: string): Promise<string> =>
    electronAPI?.design?.getSystemPreview(systemId, pagePath) || Promise.resolve(''),
  getSystemFile: (systemId: string, filePath: string): Promise<string> =>
    electronAPI?.design?.getSystemFile(systemId, filePath) || Promise.resolve(''),
  getSystemShowcase: (systemId: string): Promise<string> =>
    electronAPI?.design?.getSystemShowcase(systemId) || Promise.resolve(''),
  getSystemTokensHtml: (systemId: string): Promise<string> =>
    electronAPI?.design?.getSystemTokensHtml(systemId) || Promise.resolve(''),
  composePromptStack: (input: {
    designSystemId?: string;
    skillBody?: string;
    skillName?: string;
    locale: string;
  }): Promise<string> =>
    electronAPI?.design?.composePromptStack(input) || Promise.resolve(''),
  startFileWatcher: (sessionId: string, workspacePath: string): Promise<void> =>
    electronAPI?.design?.startFileWatcher(sessionId, workspacePath) || Promise.resolve(),
  stopFileWatcher: (): Promise<void> =>
    electronAPI?.design?.stopFileWatcher() || Promise.resolve(),
  exportArtifact: (options: { filePath: string; format: 'html' | 'zip' | 'pdf' }): Promise<void> =>
    electronAPI?.design?.exportArtifact(options) || Promise.resolve(),
  onFileChanged: (callback: (event: { sessionId: string; filepath: string }) => void): (() => void) => {
    if (electronAPI?.design?.onFileChanged) {
      return electronAPI.design.onFileChanged(callback)
    }
    return () => {}
  },
}
