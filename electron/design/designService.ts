import { ipcMain, BrowserWindow, Notification, shell } from 'electron';
import { app } from 'electron';
import * as path from 'path';
import { startDesignFileWatcher, stopDesignFileWatcher } from './fileWatcher';
import { registerPromptStackHandlers } from './promptStack';

let mainWindow: BrowserWindow | null = null;

/**
 * 注册所有 Design 模式相关的 IPC Handler
 */
export function registerDesignIPCHandlers(
  window: BrowserWindow,
  extraResourcesPath: string
): void {
  mainWindow = window;

  // 提示词栈与设计系统扫描
  registerPromptStackHandlers(extraResourcesPath);

  // 文件监听：实时追踪设计工作区产物变化
  ipcMain.handle(
    'design:start-file-watcher',
    async (_event, sessionId: string, workspacePath: string) => {
      if (!mainWindow) return;
      startDesignFileWatcher(mainWindow, sessionId, workspacePath);
    }
  );

  ipcMain.handle('design:stop-file-watcher', async () => {
    stopDesignFileWatcher();
  });

  // 产物导出（当前仅打开外部浏览器/文件夹，后续可扩展为 zip/pdf 生成）
  ipcMain.handle(
    'design:export-artifact',
    async (_event, options: { filePath: string; format: 'html' | 'zip' | 'pdf' }) => {
      if (options.format === 'html') {
        await shell.openPath(path.dirname(options.filePath));
      } else {
        // TODO: 实现 zip / pdf 导出
        await shell.openPath(path.dirname(options.filePath));
      }
    }
  );

  // App 路径
  ipcMain.handle('app:getPath', async (_event, name: string) => {
    return app.getPath(name as any);
  });

  // 系统通知
  ipcMain.on('app:showNotification', (_event, options: { title: string; message: string }) => {
    if (Notification.isSupported()) {
      new Notification({
        title: options.title,
        body: options.message,
      }).show();
    }
  });
}
