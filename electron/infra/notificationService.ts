// electron/infra/notificationService.ts
// 系统通知服务 — Windows / Linux 桌面系统级通知。
// Windows: 经 AppUserModelId 归属应用后由系统在右下角弹出 toast，
//          左侧显示应用图标（icons/icon.ico 多分辨率），右侧标题+正文。
// Linux:   优先通过 notify-send/gdbus 调用桌面通知服务（GNOME/KDE 等），
//          避免 Electron 对系统 libnotify 动态库的依赖，强制走 PNG 图标。
// 点击通知会聚焦（并还原）主窗口。
// 回退：系统通知不可用时（如 Linux SSH 远程会话无通知守护进程），由主进程
// 直接弹出一个置顶的无边框提醒窗口（showNotificationPopup），应用在后台
// 也能在桌面右下角看到提醒，点击弹窗聚焦（并还原）主窗口。

import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, Notification, screen } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { info, warn } from './logger'

export interface SystemNotificationOptions {
  title: string
  message: string
  /** 点击通知时聚焦的目标窗口（通常为主窗口） */
  window?: BrowserWindow | null
  /** 系统通知不可用时回调（如 SSH 远程会话无通知守护进程），用于回退到应用内弹窗 */
  onFailed?: () => void
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

  const iconUri = iconPath ? `file://${iconPath}` : ''
  const commands: Array<{ command: string; args: string[] }> = [
    {
      command: 'notify-send',
      args: [
        '--app-name=SpaceCode',
        ...(iconPath ? [`--icon=${iconPath}`] : []),
        options.title,
        options.message,
      ],
    },
    {
      command: 'gdbus',
      // gdbus is part of GLib and is available on standard Rocky/GNOME
      // installations even when libnotify/notify-send is not installed.
      args: [
        'call',
        '--session',
        '--dest',
        'org.freedesktop.Notifications',
        '--object-path',
        '/org/freedesktop/Notifications',
        '--method',
        'org.freedesktop.Notifications.Notify',
        'SpaceCode',
        '0',
        iconUri,
        options.title,
        options.message,
        '[]',
        '{}',
        '5000',
      ],
    },
  ]

  let commandIndex = 0
  let started = false
  let commandNotFound = true

  const tryNext = (): void => {
    const entry = commands[commandIndex++]
    if (!entry) {
      if (commandNotFound) {
        warn('Notification', 'No Linux notification command found (tried notify-send and gdbus)')
      } else {
        warn('Notification', 'Linux notification commands failed; no desktop notification daemon may be running')
      }
      options.onFailed?.()
      return
    }

    try {
      const child = spawn(entry.command, entry.args, { stdio: 'ignore', env: process.env })
      started = true
      let settled = false
      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill()
        warn('Notification', `${entry.command} notification timed out`)
        tryNext()
      }, 3000)
      child.once('error', (err) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') commandNotFound = false
        warn('Notification', `${entry.command} notification failed`, { error: String(err) })
        tryNext()
      })
      child.once('exit', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (code === 0) {
          info('Notification', `Linux ${entry.command} notification shown | title=${options.title}`)
          return
        }
        commandNotFound = false
        warn('Notification', `${entry.command} notification exited unsuccessfully`, { code: String(code) })
        tryNext()
      })
    } catch (err) {
      warn('Notification', `${entry.command} notification threw`, { error: String(err) })
      tryNext()
    }
  }

  tryNext()
  // The child process reports D-Bus/command errors asynchronously. Returning
  // true here means the request was dispatched without blocking Electron's UI.
  return started
}

/**
 * 弹出系统通知。支持 Windows（右下角 toast）与 Linux（libnotify）。
 * @returns 是否成功弹出
 */
export function showSystemNotification(options: SystemNotificationOptions): boolean {
  if (process.platform === 'linux') {
    return showLinuxNotification(options, resolveNotificationIconPath())
  }

  if (!Notification.isSupported()) {
    warn('Notification', 'System notifications are not supported on this platform')
    options.onFailed?.()
    return false
  }

  const iconPath = resolveNotificationIconPath()
  try {
    // 副作用：Windows 的 toast 后端会为当前 AUMID 写出一个 IconLocation 为空的开始菜单快捷方式，
    // 任务栏组图标随即回退到进程 exe 图标（不是只影响下次启动，同一存活窗口当场就翻）。dev 态靠
    // scripts/patch-dev-electron-icon.cjs 把应用图标做进 exe 来兜住这条回退链，完整机制见
    // electron/main.ts 的 setAppUserModelId 注释。
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
    // showLinuxNotification 在非 Linux 平台恒返回 false（未派发任何命令），此时触发回退；
    // Linux 平台自身在命令链全部失败时回调 onFailed，不会重复触发。
    const dispatched = showLinuxNotification(options, iconPath)
    if (!dispatched) options.onFailed?.()
    return dispatched
  }
}

/**
 * 注册 app:showNotification IPC 通道（渲染进程 → 主进程，单向）。
 * 渲染进程只关心文案；图标由主进程按平台解析（统一使用应用桌面图标）。
 * 系统通知不可用时（如 Linux SSH 远程会话无通知守护进程），回退为
 * showNotificationPopup 弹出的置顶提醒窗口。
 */
export function registerNotificationIPCHandlers(getWindow: () => BrowserWindow | null): void {
  ipcMain.on('app:showNotification', (_event, options: { title: string; message: string }) => {
    if (!options || typeof options.title !== 'string' || typeof options.message !== 'string') return
    showSystemNotification({
      title: options.title,
      message: options.message,
      window: getWindow(),
      onFailed: () => {
        showNotificationPopup({ title: options.title, message: options.message, window: getWindow() })
      },
    })
  })
  info('Notification', 'Notification IPC handlers registered')
}

// ── 系统通知失败回退：主进程置顶提醒弹窗 ──

const POPUP_WIDTH = 360
const POPUP_HEIGHT = 120
const POPUP_AUTO_CLOSE_MS = 8000
const POPUP_MARGIN = 24

let notificationPopup: BrowserWindow | null = null

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildPopupHtml(title: string, message: string): string {
  const dark = nativeTheme.shouldUseDarkColors
  const bg = dark ? '#1f2023' : '#ffffff'
  const fg = dark ? '#ececec' : '#1f1f1f'
  const sub = dark ? '#9a9a9a' : '#666666'
  const border = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)'
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%}
    body{box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;gap:6px;
      padding:16px 18px;background:${bg};color:${fg};border:1px solid ${border};border-radius:10px;
      font-family:system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;
      -webkit-user-select:none;user-select:none;cursor:default;overflow:hidden}
    .title{font-size:13px;font-weight:600;line-height:1.4;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .message{font-size:12px;color:${sub};line-height:1.5}
  </style></head><body>
    <div class="title">${escapeHtml(title)}</div>
    <div class="message">${escapeHtml(message)}</div>
  </body></html>`
}

/**
 * 弹出主进程自绘的置顶提醒窗口（系统通知不可用时的回退）。
 - 无边框、跳过任务栏、始终置顶，显示在主显示器右下角（类似系统 toast）；
 - 应用在后台/最小化时依然可见；
 - 点击弹窗聚焦（并还原）主窗口，与系统通知的点击行为一致；
 - POPUP_AUTO_CLOSE_MS 后自动关闭；新弹窗会替换旧弹窗，避免堆积。
 */
export function showNotificationPopup(options: SystemNotificationOptions): void {
  try {
    if (notificationPopup && !notificationPopup.isDestroyed()) {
      notificationPopup.close()
    }

    const workArea = screen.getPrimaryDisplay().workArea
    const popup = new BrowserWindow({
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      x: workArea.x + workArea.width - POPUP_WIDTH - POPUP_MARGIN,
      y: workArea.y + workArea.height - POPUP_HEIGHT - POPUP_MARGIN,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1f2023' : '#ffffff',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    })
    notificationPopup = popup
    popup.setAlwaysOnTop(true, 'screen-saver')

    // 点击弹窗（窗口获得焦点）→ 聚焦主窗口并关闭弹窗。
    popup.on('focus', () => {
      const win = options.window && !options.window.isDestroyed() ? options.window : null
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
      if (!popup.isDestroyed()) popup.close()
    })

    const autoCloseTimer = setTimeout(() => {
      if (!popup.isDestroyed()) popup.close()
    }, POPUP_AUTO_CLOSE_MS)

    popup.on('closed', () => {
      clearTimeout(autoCloseTimer)
      if (notificationPopup === popup) notificationPopup = null
    })

    void popup.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildPopupHtml(options.title, options.message)))
    popup.once('ready-to-show', () => {
      // showInactive：弹出提醒但不抢焦点，不打断用户当前操作
      if (!popup.isDestroyed()) popup.showInactive()
    })
    info('Notification', `Notification popup shown | title=${options.title}`)
  } catch (err) {
    warn('Notification', 'Failed to show notification popup', { error: String(err) })
  }
}
