// electron/infra/notificationService.ts
// 系统通知服务 — Windows / Linux 桌面系统级通知。
// Windows: 经 AppUserModelId 归属应用后由系统在右下角弹出 toast，
//          左侧显示应用图标（icons/icon.ico 多分辨率），右侧标题+正文。
// Linux:   经 libnotify 由桌面环境渲染（GNOME/KDE 等），强制走 PNG 图标
//          （部分通知守护进程不支持 .ico）。
// 点击通知会聚焦（并还原）主窗口。

import { app, BrowserWindow, ipcMain, nativeImage, Notification } from 'electron'
import { spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { info, warn } from './logger'

export interface SystemNotificationOptions {
  title: string
  message: string
  /** 点击通知时聚焦的目标窗口（通常为主窗口） */
  window?: BrowserWindow | null
}

/**
 * 解析通知图标基路径（与 main.ts getIconPath() 的解析规则一致）：
 * - 打包后: process.resourcesPath/icons/icon.ico
 * - 开发态: 项目根 icons/icon.ico
 */
export function getNotificationIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icons', 'icon.ico')
  }
  return join(__dirname, '../icons/icon.ico')
}

/**
 * 依据平台解析通知图标。Linux 强制优先 PNG；其余平台 .ico → .png 回退。
 * 找不到可用图标时返回 undefined，由系统使用默认图标兜底。
 */
export function resolveNotificationIconPath(): string | undefined {
  try {
    const iconBasePath = getNotificationIconPath()
    const iconDir = join(iconBasePath, '..')
    const pngPath = join(iconDir, 'icon.png')
    // Linux 通知守护进程 (libnotify) 通常不识别 .ico，PNG 排在前位。
    const candidates = process.platform === 'linux' ? [pngPath, iconBasePath] : [iconBasePath, pngPath]
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue
      const image = nativeImage.createFromPath(candidate)
      if (!image.isEmpty()) return candidate
    }
    warn('Notification', `No valid notification icon found | tried=${candidates.join(', ')}`)
  } catch (err) {
    warn('Notification', 'Failed to resolve notification icon, falling back to default', { error: String(err) })
  }
  return undefined
}

/**
 * Electron's Linux notification backend can be unavailable in minimal
 * desktop environments (or when an AppImage is launched without the usual
 * desktop integration).  libnotify's CLI uses the same D-Bus session and is
 * a useful fallback when it is installed.
 */
function showLinuxNotification(options: SystemNotificationOptions, iconPath?: string): boolean {
  if (process.platform !== 'linux') return false

  const args = ['--app-name=SpaceCode']
  if (iconPath) args.push(`--icon=${iconPath}`)
  args.push(options.title, options.message)

  try {
    const result = spawnSync('notify-send', args, {
      stdio: 'ignore',
      timeout: 3000,
    })
    if (result.error || result.status !== 0) {
      warn('Notification', 'Linux notify-send fallback failed', {
        error: result.error ? String(result.error) : `exit=${result.status}`,
      })
      return false
    }
    info('Notification', `Linux notify-send fallback shown | title=${options.title}`)
    return true
  } catch (err) {
    warn('Notification', 'Linux notify-send fallback threw', { error: String(err) })
    return false
  }
}

/**
 * 弹出系统通知。支持 Windows（右下角 toast）与 Linux（libnotify）。
 * @returns 是否成功弹出
 */
export function showSystemNotification(options: SystemNotificationOptions): boolean {
  if (!Notification.isSupported()) {
    warn('Notification', 'System notifications are not supported on this platform')
    return showLinuxNotification(options, resolveNotificationIconPath())
  }

  const iconPath = resolveNotificationIconPath()
  try {
    const notification = new Notification({
      title: options.title,
      body: options.message,
      ...(iconPath ? { icon: nativeImage.createFromPath(iconPath) } : {}),
    })

    notification.on('click', () => {
      const win = options.window && !options.window.isDestroyed() ? options.window : null
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    })

    notification.show()
    info('Notification', `System notification shown | title=${options.title} | icon=${iconPath ?? 'default'}`)
    return true
  } catch (err) {
    warn('Notification', 'Electron system notification failed', { error: String(err) })
    return showLinuxNotification(options, iconPath)
  }
}

/**
 * 注册 app:showNotification IPC 通道（渲染进程 → 主进程，单向）。
 * 渲染进程只关心文案；图标由主进程按平台解析（统一使用应用桌面图标）。
 */
export function registerNotificationIPCHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.on('app:showNotification', (_event, options: { title: string; message: string }) => {
    if (!options || typeof options.title !== 'string' || typeof options.message !== 'string') return
    showSystemNotification({ title: options.title, message: options.message, window: getWindow() })
  })
  info('Notification', 'Notification IPC handlers registered')
}
