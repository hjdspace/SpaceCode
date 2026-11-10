import { electronAPI } from './_context'
import type { DesignSystemSummary } from '../electronAPI'
import type { DesignExportRequest, DesignExportResult } from '@/shared/designExport'

/** 没有 preload（H5 浏览器端）时的失败哨兵，渲染层据此显示「未支持」而不是假装成功 */
const API_UNAVAILABLE = 'unsupported:electron-api-unavailable'

export interface CreateDesignSystemInput {
  title: string
  category?: string
  summary?: string
  accentColor?: string
}

export const design = {
  listSystems: (): Promise<DesignSystemSummary[]> =>
    electronAPI?.design?.listSystems() || Promise.resolve([]),
  createSystem: async (input: CreateDesignSystemInput): Promise<DesignSystemSummary> => {
    if (!electronAPI?.design?.createSystem) throw new Error(API_UNAVAILABLE)
    return electronAPI.design.createSystem(input)
  },
  deleteSystem: async (systemId: string): Promise<void> => {
    if (!electronAPI?.design?.deleteSystem) throw new Error(API_UNAVAILABLE)
    await electronAPI.design.deleteSystem(systemId)
  },
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
  exportArtifact: (options: DesignExportRequest): Promise<DesignExportResult> =>
    electronAPI?.design?.exportArtifact(options) ||
    Promise.resolve({ ok: false, error: API_UNAVAILABLE }),
  onFileChanged: (callback: (event: { sessionId: string; filepath: string }) => void): (() => void) => {
    if (electronAPI?.design?.onFileChanged) {
      return electronAPI.design.onFileChanged(callback)
    }
    return () => {}
  },
}
