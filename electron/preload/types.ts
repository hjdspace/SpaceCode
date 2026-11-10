// electron/preload/types.ts
// Preload 分域后共享的字面量类型与 ipcRenderer 形态。

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

export interface FileStat {
  size: number
  isDirectory: boolean
  isFile: boolean
  mtime: number
}

export interface DesignSystemSummaryShape {
  id: string
  name: string
  category: string
  description?: string
  previewPages: Array<{ path: string; role: string; title: string }>
  swatches?: Array<{ name: string; value: string }>
  officialUrl?: string
  source?: 'built-in' | 'user'
}

/** preload 只用到 invoke / send / on / removeListener 四项能力。 */
export interface PreloadIpc {
  invoke: (channel: string, ...args: any[]) => Promise<any>
  send: (channel: string, ...args: any[]) => void
  on: (channel: string, listener: (...args: any[]) => void) => unknown
  removeListener: (channel: string, listener: (...args: any[]) => void) => unknown
}
