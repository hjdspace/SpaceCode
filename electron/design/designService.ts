import { ipcMain, BrowserWindow, shell } from 'electron';
import { app } from 'electron';
import * as path from 'path';
import { startDesignFileWatcher, stopDesignFileWatcher } from './fileWatcher';
import { registerPromptStackHandlers } from './promptStack';
import { exportZip } from './artifactExport';
import { exportPdf } from './pdfExport';
import type { DesignExportRequest, DesignExportResult } from '@/shared/designExport';

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

  // 产物导出：html 打开所在目录，zip/pdf 真实生成文件后定位产物
  ipcMain.handle(
    'design:export-artifact',
    async (
      _event,
      options: DesignExportRequest,
    ): Promise<DesignExportResult> => {
      try {
        if (options.format === 'html') {
          const dir = path.dirname(options.filePath);
          // openPath 用返回的字符串报错：空串才是成功，否则是失败，不能当成功报回去
          const openError = await shell.openPath(dir);
          if (openError) return { ok: false, error: openError };
          return { ok: true, path: dir };
        }
        const output =
          options.format === 'zip'
            ? exportZip(options.filePath, options.workspaceRoot)
            : await exportPdf(options.filePath);
        shell.showItemInFolder(output);
        return { ok: true, path: output };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  // App 路径
  ipcMain.handle('app:getPath', async (_event, name: string) => {
    return app.getPath(name as any);
  });
}
