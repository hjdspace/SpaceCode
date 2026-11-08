// electron/preload/fs.ts
// 文件系统域：读写、搜索、文件操作、对话框、工作区目录、图片落盘。

import type { FileEntry, FileStat, PreloadIpc } from './types'

export function createFsApi(ipcRenderer: PreloadIpc) {
  return {
    readDir: (dirPath: string): Promise<FileEntry[]> =>
      ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('fs:readFile', filePath),
    readFileAsBase64: (filePath: string): Promise<string | null> =>
      ipcRenderer.invoke('fs:readFileAsBase64', filePath),
    writeFile: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('fs:writeFile', filePath, content),
    stat: (filePath: string): Promise<FileStat | null> =>
      ipcRenderer.invoke('fs:stat', filePath),

    paste: {
      saveText: (text: string): Promise<{ success: boolean; path?: string; size?: number; error?: string }> =>
        ipcRenderer.invoke('paste:saveText', text),
    },

    searchFiles: (dirPath: string, query: string, options?: { maxResults?: number }): Promise<Array<{ name: string; path: string; relativePath: string; isDirectory: boolean; isFile: boolean }>> =>
      ipcRenderer.invoke('fs:searchFiles', dirPath, query, options),

    // File operations for context menu
    copyFile: (srcPath: string, destPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('fs:copy', srcPath, destPath),
    moveFile: (srcPath: string, destPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('fs:move', srcPath, destPath),
    renameFile: (filePath: string, newName: string): Promise<{ success: boolean; error?: string; newPath?: string }> =>
      ipcRenderer.invoke('fs:rename', filePath, newName),
    deleteFile: (filePath: string, permanent?: boolean): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('fs:delete', filePath, permanent),

    // Folder / file selection dialog
    selectFolder: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
      ipcRenderer.invoke('dialog:selectFolder'),
    selectFiles: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
      ipcRenderer.invoke('dialog:selectFiles'),

    // Work workspace helpers
    ensureDefaultWorkspace: (): Promise<string> =>
      ipcRenderer.invoke('workspace:ensureDefaultWork'),
    ensureDir: (dirPath: string): Promise<boolean> =>
      ipcRenderer.invoke('workspace:ensureDir', dirPath),

    // Image persistence — 聊天图片落盘到 userData，避免 localStorage 配额溢出
    image: {
      save: (id: string, dataUrl: string) =>
        ipcRenderer.invoke('image:save', id, dataUrl) as Promise<{ success: boolean; error?: string }>,
      load: (id: string) =>
        ipcRenderer.invoke('image:load', id) as Promise<string | null>,
    },
  }
}
