import chokidar from 'chokidar';
import { BrowserWindow } from 'electron';

let watcher: chokidar.FSWatcher | null = null;

/**
 * 启动设计工作目录的 Chokidar 文件监听服务
 * 
 * 当 Claude Code CLI 写入 index.html 或关联 css/js 时，
 * 触发事件推送给渲染进程，从而使沙箱 iframe 进行无刷新的 srcdoc 局部更新。
 */
export function startDesignFileWatcher(
  mainWindow: BrowserWindow,
  sessionId: string,
  workspaceDir: string
) {
  // 如果已有监听，先关闭
  if (watcher) {
    watcher.close();
  }

  watcher = chokidar.watch(workspaceDir, {
    ignored: /(^|[/\])\..|node_modules|\.git/, // 忽略隐藏文件、git 及 node_modules
    persistent: true,
    ignoreInitial: true,
    depth: 3,
  });

  watcher.on('change', (filepath) => {
    const ext = filepath.split('.').pop()?.toLowerCase();
    if (ext === 'html' || ext === 'css' || ext === 'js') {
      mainWindow.webContents.send('design:file-changed', {
        sessionId,
        filepath,
      });
    }
  });

  watcher.on('add', (filepath) => {
    const ext = filepath.split('.').pop()?.toLowerCase();
    if (ext === 'html' || ext === 'css' || ext === 'js') {
      mainWindow.webContents.send('design:file-changed', {
        sessionId,
        filepath,
      });
    }
  });

  return watcher;
}

/**
 * 关闭监听服务
 */
export function stopDesignFileWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
