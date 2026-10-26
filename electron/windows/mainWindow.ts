/**
 * Main BrowserWindow creation and lifecycle.
 *
 * Deep module: callers only need `createWindow()` and `getMainWindow()`;
 * all window configuration, splash screen, dev-server polling, and
 * web-contents event wiring live behind that interface.
 */
import { BrowserWindow, app, net } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { info, warn, error, debug, isDebugMode } from '../infra/logger'
import { isQuitting, shouldHideOnWindowClose } from '../infra/appLifecycle'
import { getWindowIconPath, loadIconImage } from './iconUtils'
import { setMainWindow } from '../engine/claudeCodeIPC'
import { TerminalManager } from '../infra/terminalManager'
import { getPool } from '../engine/claudeCodeIPC'
import { attachGenuiFrameGuard } from '../genui/sandboxFrameGuard'

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null

const startTime = Date.now()

// ── Vite dev-server polling ─────────────────────────────────────

/**
 * Navigate only once the Vite server answers *and* the preload script is on
 * disk. A sandboxed renderer swallows a missing preload as a console error, so
 * loading early yields a visible window with no contextBridge — and dev shares
 * `dist-electron/` with `npm run build`, which can remove that file mid-boot.
 */
export function waitForViteAndLoad(
  window: BrowserWindow,
  url: string,
  preloadFile: string,
  interval = 200,
): void {
  let attempts = 0
  const tryLoad = () => {
    attempts++
    const req = net.request(url)
    req.on('response', () => {
      if (!existsSync(preloadFile)) {
        if (attempts === 1 || attempts % 25 === 0) {
          warn('Startup', `preload script not ready after ${attempts} attempt(s), deferring load: ${preloadFile}`)
        }
        setTimeout(tryLoad, interval)
        return
      }
      info('Startup', `Vite dev server ready after ${attempts} attempt(s)`)
      window.loadURL(url).catch((err: Error) => {
        error('Startup', `Failed to load URL: ${err.message}`)
      })
    })
    req.on('error', () => {
      if (attempts === 1 || attempts % 25 === 0) {
        warn('Startup', `Vite dev server not ready after ${attempts} attempt(s), retrying`)
      }
      setTimeout(tryLoad, interval)
    })
    req.end()
  }
  tryLoad()
}

// ── Splash Screen ────────────────────────────────────────────────

function createSplashScreen(): void {
  if (!isDev) return

  splashWindow = new BrowserWindow({
    width: 360,
    height: 240,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: true,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const splashHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    background: transparent;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    user-select: none; -webkit-user-select: none;
  }
  .container {
    background: rgba(12, 12, 29, 0.95);
    border-radius: 12px;
    padding: 32px 40px;
    display: flex; flex-direction: column;
    align-items: center; gap: 16px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  }
  .logo {
    font-size: 24px; font-weight: 600;
    color: #e0e0e0;
    letter-spacing: 1px;
  }
  .spinner {
    width: 28px; height: 28px;
    border: 3px solid rgba(255, 255, 255, 0.15);
    border-top-color: #6c8aff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .text {
    font-size: 12px; color: #888;
    letter-spacing: 0.5px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="container">
    <div class="logo">SpaceCode</div>
    <div class="spinner"></div>
    <div class="text">Loading...</div>
  </div>
</body>
</html>`

  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml))
  splashWindow.on('closed', () => { splashWindow = null })
}

function closeSplashScreen(): void {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close()
    splashWindow = null
  }
}

// ── Main Window ──────────────────────────────────────────────────

export function createWindow(
  terminalManager: TerminalManager,
  createMenu: () => void,
): void {
  const debugMode = isDebugMode()
  const preloadPath = join(__dirname, 'preload.js')

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'SpaceCode',
    icon: getWindowIconPath(),
    backgroundColor: '#0c0c1d',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:claude-code-desktop',
      devTools: isDev || debugMode,
      spellcheck: false,
      webviewTag: true
    }
  }

  if (process.platform === 'darwin') {
    windowOptions.titleBarStyle = 'hiddenInset'
    windowOptions.vibrancy = 'sidebar'
  } else if (process.platform === 'win32') {
    windowOptions.titleBarStyle = 'hidden'
    windowOptions.titleBarOverlay = {
      color: '#00000000',
      symbolColor: '#888888',
      height: 44,
    }
  } else if (process.platform === 'linux') {
    windowOptions.frame = false
  }

  mainWindow = new BrowserWindow(windowOptions)

  const windowIcon = loadIconImage()
  if (!windowIcon.isEmpty()) {
    mainWindow.setIcon(windowIcon)
    info('Icon', `Window icon set via setIcon() (${windowIcon.getSize().width}x${windowIcon.getSize().height})`)
  } else {
    warn('Icon', 'Window icon is empty — taskbar will show default icon')
  }

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizeChanged', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizeChanged', false)
  })

  mainWindow.once('ready-to-show', () => {
    info('Startup', `Window ready-to-show | elapsed=${Date.now() - startTime}ms`)
    mainWindow?.show()
    mainWindow?.focus()
    closeSplashScreen()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    info('Startup', `Page did-finish-load | elapsed=${Date.now() - startTime}ms`)
    if (mainWindow && !mainWindow.isVisible()) {
      info('Startup', 'ready-to-show did not fire, showing window as fallback')
      mainWindow.show()
      mainWindow.focus()
      closeSplashScreen()
    }
    if (isDev) {
      mainWindow?.webContents.openDevTools()
    }
  })

  if (isDev) {
    waitForViteAndLoad(mainWindow, 'http://127.0.0.1:5173', preloadPath)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }
  info('Startup', `Loading ${isDev ? 'dev URL' : 'production index.html'}`)

  if (debugMode && !isDev) {
    mainWindow.webContents.on('did-finish-load', () => {
      info('Debug', 'Auto-opening DevTools (--debug mode)')
      mainWindow?.webContents.openDevTools()
    })
  }

  mainWindow.on('closed', async () => {
    info('Window', 'Main window closed')
    try {
      info('App', 'Killing all terminal processes on window close')
      terminalManager.killAll()
    } catch (err) {
      warn('App', 'Error killing terminal processes on window close', err)
    }
    try {
      info('App', 'Killing all Claude Code sessions on window close')
      const pool = getPool()
      if (pool) {
        pool.killAll()
      }
    } catch (err) {
      warn('App', 'Error killing Claude Code sessions on window close', err)
    }
    mainWindow = null
  })

  mainWindow.on('close', (event) => {
    if (shouldHideOnWindowClose(process.platform, isQuitting())) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.on('console-message', (event) => {
    const level = event.level
    const message = event.message
    const line = event.lineNumber
    const sourceId = event.sourceId
    if (level === 'warning' || level === 'error') {
      warn('Renderer', `console.${level}: ${message} | source=${sourceId}:${line}`)
    }
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    error('Renderer', `Render process gone! reason=${details.reason} exitCode=${details.exitCode}`)
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL) => {
    error('Renderer', `Page load failed: ${errorCode} ${errorDesc} | url=${validatedURL}`)
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  setMainWindow(mainWindow)

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      const allowedPermissions = [
        'media',
        'geolocation',
        'notifications',
        'clipboard-sanitized-write'
      ]
      if (allowedPermissions.includes(permission)) {
        callback(true)
      } else {
        console.warn(`[Security] Permission denied: ${permission}`)
        callback(false)
      }
    }
  )

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    if (parsedUrl.protocol === 'file:' || parsedUrl.origin === 'http://localhost:5173') {
      return
    }
    console.log('[Navigation] External navigation intercepted:', navigationUrl)
  })

  // 卡片沙箱的 frame 闸门：文档落地后该 frame 不再允许任何导航（自跳转外泄的堵法）。
  const detachGenuiFrameGuard = attachGenuiFrameGuard(mainWindow.webContents)

  mainWindow.on('closed', () => {
    detachGenuiFrameGuard()
  })

  createMenu()
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function showMainWindow(): void {
  mainWindow?.show()
  mainWindow?.focus()
}

export { createSplashScreen, closeSplashScreen }
