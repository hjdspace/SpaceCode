import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, dialog, net, globalShortcut } from 'electron'
import { join, resolve, extname, dirname, basename } from 'path'
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync, copyFileSync, renameSync, unlinkSync, rmSync } from 'fs'
import { spawn } from 'child_process'
import { config } from 'dotenv'
import { TerminalManager } from './terminalManager'
import { registerGitIPCHandlers } from './gitService'
import { registerSkillsIPCHandlers, registerLocalLibraryIPCHandlers } from './skillsService'
import { registerClaudeCodeIPC, setMainWindow, getPool } from './claudeCodeIPC'
import { registerPromptOptimizerIPC } from './promptOptimizerIPC'
import { aggregateLocalTokenStats } from './tokenStatsService'
import { initLogger, info, warn, error, debug, isDebugMode, ipc as logIpc, traceEvent, listDebugFiles, readDebugFile, listTraceSessions, readTraceEvents } from './logger'
import { proxyManager } from './proxyManager'
import type { ProxyConfig } from './proxy/types'

// ============================================================
// App Startup
// ============================================================
const startTime = Date.now()

// Initialize logger first (needs app.getPath, so after app is available)
// For very early logging before app.ready, we use a temporary buffer
const earlyLogs: string[] = []
function earlyLog(msg: string) {
  const elapsed = Date.now() - startTime
  const line = `[EARLY] ${elapsed}ms | ${msg}`
  earlyLogs.push(line)
  console.log(line)
}

earlyLog('Process started')

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged

// ============================================================
// Environment
// ============================================================
let envPath: string
if (isDev) {
  envPath = resolve(__dirname, '../.env')
} else {
  envPath = resolve(process.resourcesPath, '.env')
}

if (existsSync(envPath)) {
  config({ path: envPath })
  earlyLog(`Loaded .env from: ${envPath}`)
} else {
  earlyLog(`No .env found at: ${envPath}`)
}

// Windows: set AppUserModelId so taskbar shows the correct icon instead of Electron default
if (process.platform === 'win32') {
  app.setAppUserModelId('com.spacecode.desktop')
}

app.commandLine.appendSwitch('no-sandbox')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

type ExternalEditor = 'vscode' | 'gvim'

function openPathInEditor(editor: ExternalEditor, targetPath: string): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    if (!targetPath || !existsSync(targetPath)) {
      resolve({ success: false, error: 'Path does not exist' })
      return
    }

    const command = editor === 'vscode' ? 'code' : 'gvim'
    const args = editor === 'vscode' ? ['-r', targetPath] : [targetPath]
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32'
    })

    let settled = false
    child.once('error', (err) => {
      settled = true
      error('IPC', 'app:openInEditor failed', { editor, targetPath, err })
      resolve({ success: false, error: err.message })
    })
    child.once('spawn', () => {
      child.unref()
      setTimeout(() => {
        if (!settled) {
          settled = true
          resolve({ success: true })
        }
      }, 100)
    })
  })
}

function destroyTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

// Resolve icon path: dev mode uses project root icons/, production uses extraResources
// On Windows, prefer .ico (multi-resolution, required for .exe embedding).
// Falls back to .png if .ico is unavailable.
function getIconPath(): string {
  if (app.isPackaged) {
    // Production: extraResources copies icons/ → resources/icons/
    const icoPath = join(process.resourcesPath, 'icons', 'icon.ico')
    const pngPath = join(process.resourcesPath, 'icons', 'icon.png')
    if (existsSync(icoPath)) return icoPath
    if (existsSync(pngPath)) return pngPath
    warn('Icon', `No icon found in resources: tried ${icoPath} and ${pngPath}`)
    return icoPath // return .ico path even if missing (caller handles missing)
  }
  // Development: icon files are in project root icons/
  const devIcoPath = join(__dirname, '../icons/icon.ico')
  const devPngPath = join(__dirname, '../icons/icon.png')
  if (existsSync(devIcoPath)) return devIcoPath
  if (existsSync(devPngPath)) return devPngPath
  warn('Icon', `No icon found in dev: tried ${devIcoPath} and ${devPngPath}`)
  return devIcoPath // return .ico path even if missing
}

// Load a NativeImage for tray/window icon, with .ico → .png fallback
function loadIconImage(): Electron.NativeImage {
  const iconPath = getIconPath()
  info('Icon', `Loading icon from: ${iconPath} | exists=${existsSync(iconPath)}`)

  try {
    if (existsSync(iconPath)) {
      const img = nativeImage.createFromPath(iconPath)
      if (!img.isEmpty()) {
        debug('Icon', `Icon loaded successfully: ${iconPath} (${img.getSize().width}x${img.getSize().height})`)
        return img
      }
      warn('Icon', `Icon at ${iconPath} loaded but is EMPTY — trying PNG fallback`)
    }

    // Try PNG fallback
    const fallbackExt = extname(iconPath) === '.ico' ? '.png' : '.ico'
    const fallbackPath = iconPath.replace(/\.(ico|png)$/, fallbackExt)
    if (fallbackPath !== iconPath && existsSync(fallbackPath)) {
      const fallbackImg = nativeImage.createFromPath(fallbackPath)
      if (!fallbackImg.isEmpty()) {
        info('Icon', `Using fallback icon: ${fallbackPath}`)
        return fallbackImg
      }
      warn('Icon', `Fallback icon at ${fallbackPath} also empty`)
    }

    warn('Icon', 'No valid icon found — using empty image (will show default)')
    return nativeImage.createEmpty()
  } catch (err) {
    error('Icon', 'Error loading icon image', err)
    return nativeImage.createEmpty()
  }
}

// Helper: resolve icon path for BrowserWindow (Electron constructor needs a file path)
function getWindowIconPath(): string {
  const iconPath = getIconPath()
  if (existsSync(iconPath)) return iconPath
  // Fallback to PNG
  const pngPath = iconPath.replace(/\.ico$/, '.png')
  if (existsSync(pngPath)) return pngPath
  return iconPath
}

function waitForViteAndLoad(window: BrowserWindow, url: string, maxRetries = 50, interval = 200): void {
  let attempts = 0
  const tryLoad = () => {
    attempts++
    const req = net.request(url)
    req.on('response', () => {
      info('Startup', `Vite dev server ready after ${attempts} attempt(s)`)
      window.loadURL(url).catch((err: Error) => {
        error('Startup', `Failed to load URL: ${err.message}`)
      })
    })
    req.on('error', () => {
      if (attempts < maxRetries) {
        setTimeout(tryLoad, interval)
      } else {
        error('Startup', `Vite dev server not ready after ${maxRetries} attempts, loading anyway`)
        window.loadURL(url).catch((err: Error) => {
          error('Startup', `Failed to load URL: ${err.message}`)
        })
      }
    })
    req.end()
  }
  tryLoad()
}

function createWindow() {
  const debugMode = isDebugMode()

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
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:claude-code-desktop',
      // 允许在 --debug 模式或开发模式下使用 DevTools
      devTools: isDev || debugMode,
      spellcheck: false,
      webviewTag: true
    }
  }

  // Platform-specific titlebar configuration
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
    // Linux window managers don't consistently support titleBarOverlay,
    // so drop the native frame entirely and render window controls
    // inside our custom TitleBar component instead.
    windowOptions.frame = false
  }

  mainWindow = new BrowserWindow(windowOptions)

  // Notify renderer when window maximize state changes (for custom controls)
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximizeChanged', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximizeChanged', false)
  })

  mainWindow.once('ready-to-show', () => {
    info('Startup', 'Window ready-to-show')
    mainWindow?.show()
    mainWindow?.focus()
    info('Startup', 'Window shown')
  })

  mainWindow.webContents.on('did-finish-load', () => {
    info('Startup', 'Page did-finish-load')
    if (mainWindow && !mainWindow.isVisible()) {
      info('Startup', 'ready-to-show did not fire, showing window as fallback')
      mainWindow.show()
      mainWindow.focus()
    }
    if (isDev) {
      mainWindow?.webContents.openDevTools()
    }
  })

  if (isDev) {
    // vite-plugin-electron starts Electron and Vite in parallel; the dev server
    // typically isn't bound to :5173 until ~1–2 s after Electron's `ready` event,
    // so a naive `loadURL` races and produces a black screen with
    // ERR_CONNECTION_REFUSED. Poll until the server answers, then load.
    waitForViteAndLoad(mainWindow, 'http://localhost:5173')
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
    // 清理所有终端进程
    try {
      info('App', 'Killing all terminal processes on window close')
      terminalManager.killAll()
    } catch (err) {
      warn('App', 'Error killing terminal processes on window close', err)
    }
    // 清理所有 Claude Code 会话进程
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
    if (process.platform === 'darwin') {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // 记录渲染进程的 console 错误
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const levelName = ['verbose', 'info', 'warning', 'error'][level] || 'unknown'
    if (level >= 2) { // warning and error
      warn('Renderer', `console.${levelName}: ${message} | source=${sourceId}:${line}`)
    }
  })

  // 记录渲染进程崩溃
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    error('Renderer', `Render process gone! reason=${details.reason} exitCode=${details.exitCode}`)
  })

  // 记录页面加载失败
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDesc, validatedURL) => {
    error('Renderer', `Page load failed: ${errorCode} ${errorDesc} | url=${validatedURL}`)
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  setMainWindow(mainWindow)
  
  // Webview 安全配置
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
  
  // 处理主窗口导航（防止外部链接覆盖 GUI）
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsedUrl = new URL(navigationUrl)
    
    if (parsedUrl.protocol === 'file:' || parsedUrl.origin === 'http://localhost:5173') {
      return
    }
    
    console.log('[Navigation] External navigation intercepted:', navigationUrl)
  })
  
  createMenu()
}

function createMenu() {
  const debugMode = isDebugMode()

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:newChat') },
        { type: 'separator' },
        {
          label: 'Open Folder...',
          accelerator: 'Ctrl+K Ctrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow!, {
              properties: ['openDirectory'],
              title: 'Open Folder'
            })
            if (!result.canceled && result.filePaths.length > 0) {
              mainWindow?.webContents.send('menu:openFolder', result.filePaths[0])
            }
          }
        },
        { type: 'separator' },
        { label: 'Close Folder', click: () => mainWindow?.webContents.send('menu:closeFolder') },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        // 方案四：debug 模式下在菜单中提供 Toggle DevTools
        ...(isDev || debugMode ? [
          { type: 'separator' as const },
          { role: 'toggleDevTools' as const }
        ] : [])
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createTray() {
  const iconPath = getIconPath()

  debug('Tray', `Loading icon from: ${iconPath} | exists: ${existsSync(iconPath)}`)

  let icon: Electron.NativeImage

  try {
    icon = loadIconImage()
    
    // Resize for tray (Windows: 16x16, macOS: 18x18)
    if (!icon.isEmpty()) {
      const trayIconSize = process.platform === 'darwin' ? 18 : 16
      icon = icon.resize({ width: trayIconSize, height: trayIconSize })
      debug('Tray', `Icon loaded and resized to ${trayIconSize}x${trayIconSize}`)
    } else {
      warn('Tray', 'Icon is empty after loadIconImage() — tray will show default icon')
    }
  } catch (err) {
    error('Tray', 'Error loading icon', err)
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show SpaceCode', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setToolTip('SpaceCode')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
}

// ============================================================
// App Lifecycle
// ============================================================
app.whenReady().then(() => {
  // 初始化日志系统
  initLogger()
  info('Startup', `App ready | elapsed=${Date.now() - startTime}ms | isDev=${isDev} | isPackaged=${app.isPackaged} | debugMode=${isDebugMode()}`)

  // 回放早期日志
  for (const earlyMsg of earlyLogs) {
    debug('Startup', earlyMsg)
  }

  createWindow()
  info('Startup', `Window created | elapsed=${Date.now() - startTime}ms`)

  // Register Git IPC handlers
  registerGitIPCHandlers()
  info('Startup', 'Git IPC handlers registered')

  // Register Skills IPC handlers
  registerSkillsIPCHandlers()
  info('Startup', 'Skills IPC handlers registered')

  // Register Local Library IPC handlers
  registerLocalLibraryIPCHandlers()
  info('Startup', 'Local Library IPC handlers registered')

  // Register Claude Code IPC handlers
  registerClaudeCodeIPC()
  info('Startup', 'Claude Code IPC handlers registered')

  ipcMain.handle('claude-code:engineSourceChanged', async (_, source: string) => {
    info('EngineSource', `Engine source changed to: ${source}`)
    const needsProxy = source === 'installed'
    if (needsProxy) {
      info('EngineSource', 'Installed CLI with non-Anthropic provider — Shadow Home will handle provider config per session')
    } else {
      if (proxyManager.isRunning()) {
        try {
          await proxyManager.stop()
          info('EngineSource', 'Proxy stopped after engine source change to bundled')
        } catch (err) {
          warn('EngineSource', 'Failed to stop proxy after engine source change:', err)
        }
      }
    }
  })

  // Register Prompt Optimizer IPC handlers
  registerPromptOptimizerIPC()
  info('Startup', 'Prompt Optimizer IPC handlers registered')

  // Create system tray for all platforms
  createTray()
  info('Startup', `System tray created | total elapsed=${Date.now() - startTime}ms`)

  // 方案四：注册全局快捷键 Ctrl+Shift+I 打开 DevTools（生产环境调试用）
  if (!isDev) {
    try {
      globalShortcut.register('CommandOrControl+Shift+I', () => {
        const win = mainWindow
        if (!win || win.isDestroyed()) return
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools()
          info('Debug', 'DevTools closed via shortcut')
        } else {
          // 临时启用 devTools
          win.webContents.openDevTools()
          info('Debug', 'DevTools opened via Ctrl+Shift+I shortcut')
        }
      })
      debug('Debug', 'Global shortcut Ctrl+Shift+I registered for DevTools toggle')
    } catch (err) {
      warn('Debug', 'Failed to register DevTools shortcut', err)
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })

  ;(async () => {
    const guiSettings = await loadGuiSettings()
    if (guiSettings?.engineSource === 'installed' && !['anthropic_compatible', 'claudeai', 'console'].includes(guiSettings?.authMethod)) {
      info('Startup', 'Installed CLI with non-Anthropic provider detected — Shadow Home will handle provider config per session')
    }
  })()
})

app.on('window-all-closed', () => {
  info('App', 'All windows closed')
  destroyTray()
  app.quit()
})

app.on('before-quit', async () => {
  info('App', 'App quitting')
  destroyTray()
  try { globalShortcut.unregisterAll() } catch {}
  try {
    await proxyManager.stop()
  } catch {}
  try {
    info('App', 'Killing all terminal processes')
    terminalManager.killAll()
  } catch (err) {
    warn('App', 'Error killing terminal processes', err)
  }
  // 清理所有 Claude Code 会话进程
  try {
    info('App', 'Killing all Claude Code sessions')
    const pool = getPool()
    if (pool) {
      pool.killAll()
    }
  } catch (err) {
    warn('App', 'Error killing Claude Code sessions', err)
  }
})

// ============================================================
// IPC Handlers — with logging
// ============================================================

ipcMain.handle('cli:sendMessage', async (_event, text: string) => {
  debug('IPC', 'cli:sendMessage', { textLen: text.length })
  return { success: true, message: text }
})

ipcMain.handle('cli:getAppState', async () => {
  debug('IPC', 'cli:getAppState')
  return {
    sessions: [],
    currentSessionId: null,
    theme: 'dark'
  }
})

// Window controls (primarily for Linux where we use frame: false)
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('window:toggleMaximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.on('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false
})

ipcMain.handle('fs:readDir', async (_event, dirPath: string) => {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    return entries.map(entry => ({
      name: entry.name,
      path: join(dirPath, entry.name),
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile()
    }))
  } catch (err) {
    error('IPC', 'fs:readDir failed', { dirPath, err })
    return []
  }
})

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  debug('IPC', 'fs:readFile', { filePath })
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
})

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  debug('IPC', 'fs:writeFile', { filePath })
  try {
    writeFileSync(filePath, content, 'utf-8')
    return { success: true }
  } catch (err: any) {
    error('IPC', 'fs:writeFile failed', { filePath, err })
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:stat', async (_event, filePath: string) => {
  debug('IPC', 'fs:stat', { filePath })
  try {
    const stat = statSync(filePath)
    return {
      size: stat.size,
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      mtime: stat.mtime.getTime()
    }
  } catch {
    return null
  }
})

// Recursive file search
ipcMain.handle('fs:searchFiles', async (_event, dirPath: string, query: string, options?: { maxResults?: number }) => {
  try {
    const maxResults = options?.maxResults || 100
    const results: Array<{ name: string; path: string; relativePath: string; isDirectory: boolean; isFile: boolean }> = []
    const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'dist-electron', '.next', '.nuxt', '.cache', '__pycache__', '.venv', 'vendor', 'build', 'out', '.tox', 'target'])

    if (!query) {
      const entries = readdirSync(dirPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.claude') continue
        if (ignoreDirs.has(entry.name)) continue
        results.push({
          name: entry.name,
          path: join(dirPath, entry.name),
          relativePath: entry.name,
          isDirectory: entry.isDirectory(),
          isFile: entry.isFile()
        })
      }
      results.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      return results.slice(0, maxResults)
    }

    const q = query.toLowerCase()
    const visited = new Set<string>()

    async function walkDir(currentPath: string, depth: number): Promise<void> {
      if (results.length >= maxResults) return
      if (depth > 8) return

      let entries
      try {
        entries = readdirSync(currentPath, { withFileTypes: true })
      } catch {
        return
      }

      const sorted = entries
        .filter(e => !e.name.startsWith('.') && !ignoreDirs.has(e.name))
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
          return a.name.localeCompare(b.name)
        })

      for (const entry of sorted) {
        if (results.length >= maxResults) return

        const fullPath = join(currentPath, entry.name)
        const relativePath = fullPath.slice(dirPath.length + 1).replace(/\\/g, '/')
        const nameLower = entry.name.toLowerCase()
        const relativeLower = relativePath.toLowerCase()

        if (nameLower.includes(q) || relativeLower.includes(q)) {
          if (!visited.has(fullPath)) {
            visited.add(fullPath)
            results.push({
              name: entry.name,
              path: fullPath,
              relativePath,
              isDirectory: entry.isDirectory(),
              isFile: entry.isFile()
            })
          }
        }

        if (entry.isDirectory()) {
          await walkDir(fullPath, depth + 1)
        }
      }
    }

    await walkDir(dirPath, 0)

    results.sort((a, b) => {
      const aNameMatch = a.name.toLowerCase() === q ? 0 : a.name.toLowerCase().startsWith(q) ? 1 : 2
      const bNameMatch = b.name.toLowerCase() === q ? 0 : b.name.toLowerCase().startsWith(q) ? 1 : 2
      if (aNameMatch !== bNameMatch) return aNameMatch - bNameMatch
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.relativePath.localeCompare(b.relativePath)
    })

    return results
  } catch (err) {
    error('IPC', 'fs:searchFiles failed', { dirPath, query, err })
    return []
  }
})

ipcMain.handle('env:get', async (_event, key: string) => {
  debug('IPC', 'env:get', { key })
  return process.env[key]
})

ipcMain.on('ui:showDiff', (_event, diffInfo) => {
  debug('IPC', 'ui:showDiff')
  mainWindow?.webContents.send('ui:showDiff', diffInfo)
})

ipcMain.on('ui:showInfoPanel', (_event, mode) => {
  debug('IPC', 'ui:showInfoPanel', { mode })
  mainWindow?.webContents.send('ui:showInfoPanel', mode)
})

ipcMain.on('ui:hideInfoPanel', () => {
  debug('IPC', 'ui:hideInfoPanel')
  mainWindow?.webContents.send('ui:hideInfoPanel')
})

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  info('IPC', 'shell:openExternal', { url })
  await shell.openExternal(url)
})

ipcMain.handle('app:openInEditor', async (_event, editor: ExternalEditor, targetPath: string) => {
  info('IPC', 'app:openInEditor', { editor, targetPath })
  if (editor !== 'vscode' && editor !== 'gvim') {
    return { success: false, error: 'Unsupported editor' }
  }
  return openPathInEditor(editor, targetPath)
})

// File operations for context menu
ipcMain.handle('fs:copy', async (_event, srcPath: string, destPath: string) => {
  debug('IPC', 'fs:copy', { srcPath, destPath })
  try {
    const stat = statSync(srcPath)
    if (stat.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
    return { success: true }
  } catch (err: any) {
    error('IPC', 'fs:copy failed', { srcPath, destPath, err })
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:move', async (_event, srcPath: string, destPath: string) => {
  debug('IPC', 'fs:move', { srcPath, destPath })
  try {
    renameSync(srcPath, destPath)
    return { success: true }
  } catch (err: any) {
    error('IPC', 'fs:move failed', { srcPath, destPath, err })
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:rename', async (_event, filePath: string, newName: string) => {
  debug('IPC', 'fs:rename', { filePath, newName })
  try {
    const dir = dirname(filePath)
    const newPath = join(dir, newName)
    renameSync(filePath, newPath)
    return { success: true, newPath }
  } catch (err: any) {
    error('IPC', 'fs:rename failed', { filePath, newName, err })
    return { success: false, error: err.message }
  }
})

ipcMain.handle('fs:delete', async (_event, filePath: string, permanent: boolean = false) => {
  debug('IPC', 'fs:delete', { filePath, permanent })
  try {
    if (permanent) {
      rmSync(filePath, { recursive: true, force: true })
    } else {
      await shell.trashItem(filePath)
    }
    return { success: true }
  } catch (err: any) {
    error('IPC', 'fs:delete failed', { filePath, err })
    return { success: false, error: err.message }
  }
})

function copyDirRecursive(src: string, dest: string) {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

// Proxy HTTP requests from renderer to bypass CORS
ipcMain.handle('http:fetch', async (_event, url: string, options?: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) => {
  const fetchStart = Date.now()
  const timeoutMs = options?.timeoutMs ?? 30000
  debug('IPC', 'http:fetch', { url, method: options?.method, timeoutMs })
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    const response = await net.fetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers || {},
      body: options?.body || undefined,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const text = await response.text()
    const elapsed = Date.now() - fetchStart
    debug('IPC', `http:fetch response | status=${response.status} elapsed=${elapsed}ms bodyLen=${text.length}`)
    return { ok: response.ok, status: response.status, data: text }
  } catch (err: any) {
    const elapsed = Date.now() - fetchStart
    const errorMsg = err?.name === 'AbortError'
      ? `Request timed out (${Math.round(timeoutMs / 1000)}s)`
      : (err instanceof Error ? err.message : String(err))
    error('IPC', `http:fetch failed | elapsed=${elapsed}ms`, { url, error: errorMsg })
    return { ok: false, status: 0, error: errorMsg }
  }
})

ipcMain.handle('system:getCwd', async () => {
  debug('IPC', 'system:getCwd')
  return process.cwd()
})

// Folder selection dialog handler
ipcMain.handle('dialog:selectFolder', async () => {
  debug('IPC', 'dialog:selectFolder')
  if (!mainWindow) return { canceled: true, filePaths: [] }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Project Folder'
  })
  debug('IPC', 'dialog:selectFolder result', { canceled: result.canceled, count: result.filePaths.length })
  return result
})

// File selection dialog handler
ipcMain.handle('dialog:selectFiles', async () => {
  debug('IPC', 'dialog:selectFiles')
  if (!mainWindow) return { canceled: true, filePaths: [] }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    title: 'Select Files'
  })
  return result
})

// ============================================================================
// Terminal IPC Handlers
// ============================================================================
const terminalManager = new TerminalManager()

ipcMain.handle('terminal:create', async (_event, options?: { cwd?: string; command?: string; env?: Record<string, string> }) => {
  try {
    const cwd = options?.cwd || process.cwd()
    const id = terminalManager.create(cwd, options?.command, options?.env)
    const shellName = options?.command || (process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/sh'))
    info('Terminal', `Created terminal: ${id} | cwd=${cwd} | shell=${shellName} | customEnvKeys=${options?.env ? Object.keys(options.env).join(',') : '(none)'}`)
    return { id, shell: shellName }
  } catch (err) {
    error('Terminal', 'Failed to create terminal', err)
    return { id: null, error: String(err) }
  }
})

ipcMain.on('terminal:write', (_event, id: string, data: string) => {
  terminalManager.write(id, data)
})

ipcMain.on('terminal:resize', (_event, id: string, cols: number, rows: number) => {
  terminalManager.resize(id, cols, rows)
})

ipcMain.on('terminal:kill', (_event, id: string) => {
  debug('Terminal', `Kill terminal: ${id}`)
  terminalManager.kill(id)
})

ipcMain.on('terminal:runCommand', (_event, id: string, command: string) => {
  debug('Terminal', `Run command in ${id}: ${command.slice(0, 100)}`)
  terminalManager.write(id, command + '\r')
})

// Get the command to launch claude-code CLI in terminal
ipcMain.handle('app:getClaudeCliPath', async () => {
  const cliProjectRoot = app.isPackaged
    ? resolve(process.resourcesPath, 'engine')
    : resolve(__dirname, '../engine')

  debug('CLI', `Resolving CLI path | cliRoot=${cliProjectRoot} | isPackaged=${app.isPackaged}`)

  // 0. Check for desktop single-bundle (dist-desktop/cli.js) — preferred for packaged builds
  const desktopCliPath = resolve(cliProjectRoot, 'dist-desktop/cli.js')
  if (existsSync(desktopCliPath)) {
    const { execSync } = await import('child_process')
    try {
      execSync('bun --version', { stdio: 'ignore' })
      info('CLI', `Using desktop bundle: bun "${desktopCliPath}"`)
      return `bun "${desktopCliPath}"`
    } catch {
      // Try bundled bun.exe
      const bunExe = resolve(cliProjectRoot, 'bin', process.platform === 'win32' ? 'bun.exe' : 'bun')
      if (existsSync(bunExe)) {
        info('CLI', `Using desktop bundle with bundled bun: "${bunExe}" "${desktopCliPath}"`)
        return `"${bunExe}" "${desktopCliPath}"`
      }
      debug('CLI', 'bun not available for desktop bundle')
    }
  }

  // 1. Check for built CLI (dist/cli.js)
  const distCliPath = resolve(cliProjectRoot, 'dist/cli.js')
  if (existsSync(distCliPath)) {
    const { execSync } = await import('child_process')
    try {
      execSync('bun --version', { stdio: 'ignore' })
      info('CLI', `Using built CLI: bun "${distCliPath}"`)
      return `bun "${distCliPath}"`
    } catch {
      debug('CLI', 'bun not available for dist/cli.js')
    }
  }

  // 2. Check for source CLI
  const srcCliPath = resolve(cliProjectRoot, 'src/entrypoints/cli.tsx')
  if (existsSync(srcCliPath)) {
    const { execSync } = await import('child_process')
    try {
      execSync('bun --version', { stdio: 'ignore' })
      const devScript = resolve(cliProjectRoot, 'scripts/dev.ts')
      info('CLI', `Using source CLI: bun "${devScript}"`)
      return `bun "${devScript}"`
    } catch {
      debug('CLI', 'bun not available for source CLI')
    }
  }

  // 3. Check global ccb
  try {
    const { execSync } = await import('child_process')
    const cmd = process.platform === 'win32' ? 'where ccb' : 'which ccb'
    execSync(cmd, { stdio: 'ignore' })
    info('CLI', 'Using globally installed ccb')
    return 'ccb'
  } catch {}

  // 4. No CLI found
  warn('CLI', 'No CLI found! All options exhausted')
  return null
})

// Get the command to launch Pi CLI in terminal
ipcMain.handle('app:getPiCliPath', async () => {
  // Try to find the Pi CLI - first check if @mariozechner/pi-coding-agent has a bin entry
  try {
    const { execSync } = await import('child_process')
    // Check if `pi` or `pi-coding` is available globally
    const cmd = process.platform === 'win32' ? 'where pi' : 'which pi'
    try {
      execSync(cmd, { stdio: 'ignore' })
      info('PI', 'Using globally installed pi')
      return 'pi'
    } catch {}
  } catch {}

  // Try to run it via bun npx
  try {
    const { execSync } = await import('child_process')
    execSync('bun --version', { stdio: 'ignore' })
    info('PI', 'Using bun to run pi via npx')
    return 'bunx @mariozechner/pi-coding-agent'
  } catch {}

  // Try npx directly
  try {
    const { execSync } = await import('child_process')
    execSync('npx --version', { stdio: 'ignore' })
    info('PI', 'Using npx to run pi')
    return 'npx @mariozechner/pi-coding-agent'
  } catch {}

  warn('PI', 'No Pi CLI found!')
  return null
})

// ============================================================================
// GUI Settings Persistence (file-based, survives localStorage loss)
// ============================================================================
function getGuiSettingsPath(): string {
  return join(app.getPath('home'), '.claude', 'gui-settings.json')
}

async function loadGuiSettings(): Promise<Record<string, any> | null> {
  try {
    const settingsPath = getGuiSettingsPath()
    if (!existsSync(settingsPath)) return null
    const raw = readFileSync(settingsPath, 'utf-8')
    if (!raw.trim()) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function buildProxyConfigFromSettings(guiSettings: Record<string, any>): ProxyConfig | null {
  const authMethod = guiSettings.authMethod
  if (!authMethod) return null

  let upstreamProvider: ProxyConfig['upstreamProvider']
  let upstreamBaseUrl = ''
  let upstreamApiKey = ''
  const modelMapping: ProxyConfig['modelMapping'] = {}

  if (authMethod === 'openai_compatible' && guiSettings.openaiConfig) {
    const cfg = guiSettings.openaiConfig
    upstreamProvider = 'openai_compatible'
    upstreamBaseUrl = (cfg.baseUrl || '').trim()
    upstreamApiKey = (cfg.apiKey || '').trim()
    if (cfg.haikuModel) modelMapping.haikuModel = cfg.haikuModel.trim()
    if (cfg.sonnetModel) modelMapping.sonnetModel = cfg.sonnetModel.trim()
    if (cfg.opusModel) modelMapping.opusModel = cfg.opusModel.trim()
    if (cfg.sonnetModel) modelMapping.defaultModel = cfg.sonnetModel.trim()
  } else if (authMethod === 'gemini_api' && guiSettings.geminiConfig) {
    const cfg = guiSettings.geminiConfig
    upstreamProvider = 'openai_compatible'
    upstreamBaseUrl = (cfg.baseUrl || '').trim()
    upstreamApiKey = (cfg.apiKey || '').trim()
    if (cfg.haikuModel) modelMapping.haikuModel = cfg.haikuModel.trim()
    if (cfg.sonnetModel) modelMapping.sonnetModel = cfg.sonnetModel.trim()
    if (cfg.opusModel) modelMapping.opusModel = cfg.opusModel.trim()
    if (cfg.sonnetModel) modelMapping.defaultModel = cfg.sonnetModel.trim()
  } else if ((authMethod === 'anthropic_compatible' || authMethod === 'claudeai' || authMethod === 'console') && guiSettings.anthropicConfig) {
    const cfg = guiSettings.anthropicConfig
    upstreamProvider = 'anthropic'
    upstreamBaseUrl = (cfg.baseUrl || '').trim()
    upstreamApiKey = (cfg.apiKey || '').trim()
    if (cfg.haikuModel) modelMapping.haikuModel = cfg.haikuModel.trim()
    if (cfg.sonnetModel) modelMapping.sonnetModel = cfg.sonnetModel.trim()
    if (cfg.opusModel) modelMapping.opusModel = cfg.opusModel.trim()
    if (cfg.sonnetModel) modelMapping.defaultModel = cfg.sonnetModel.trim()
  } else {
    return null
  }

  if (!upstreamBaseUrl || !upstreamApiKey) return null

  return {
    host: '127.0.0.1',
    port: 34567,
    upstreamProvider,
    upstreamBaseUrl,
    upstreamApiKey,
    modelMapping,
  }
}

function ensureClaudeDir(): void {
  const dirPath = join(app.getPath('home'), '.claude')
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

ipcMain.handle('settings:saveGuiSettings', async (_event, data: string) => {
  try {
    ensureClaudeDir()
    const settingsPath = getGuiSettingsPath()
    writeFileSync(settingsPath, data, 'utf-8')
    debug('Settings', `GUI settings saved to ${settingsPath}`)

    syncApiConfigToSettingsJson(data)

    return { success: true }
  } catch (err: any) {
    error('Settings', 'Failed to save GUI settings', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('settings:loadGuiSettings', async () => {
  try {
    const settingsPath = getGuiSettingsPath()
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, 'utf-8')
      debug('Settings', `GUI settings loaded from ${settingsPath}`)
      return { success: true, data: raw }
    }
    debug('Settings', `No GUI settings file at ${settingsPath}`)
    return { success: true, data: null }
  } catch (err: any) {
    error('Settings', 'Failed to load GUI settings', err)
    return { success: false, data: null, error: String(err) }
  }
})

ipcMain.handle('stats:getTokenUsage', async () => {
  try {
    return { success: true, data: aggregateLocalTokenStats() }
  } catch (err: any) {
    return { success: false, error: err?.message || 'Failed to load token usage stats' }
  }
})

// ============================================================================
// Settings Injection
// ============================================================================
function getClaudeSettingsPath(): string {
  return join(app.getPath('home'), '.claude', 'settings.json')
}

function syncApiConfigToSettingsJson(guiSettingsJson: string): void {
  try {
    const guiSettings = JSON.parse(guiSettingsJson)
    if (!guiSettings || typeof guiSettings !== 'object') return

    const authMethod = guiSettings.authMethod
    if (!authMethod) return

    const engineSource = guiSettings.engineSource
    const useShadowHome = engineSource === 'installed' && authMethod !== 'anthropic' && authMethod !== 'oauth'

    if (useShadowHome) {
      debug('Settings', `Skipping settings.json sync — Shadow Home will handle provider config for installed CLI with non-Anthropic provider`)
      return
    }

    const settingsPath = getClaudeSettingsPath()
    let existingSettings: Record<string, any> = {}

    if (existsSync(settingsPath)) {
      try {
        const raw = readFileSync(settingsPath, 'utf-8')
        if (raw.trim()) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            existingSettings = { ...parsed }
          }
        }
      } catch {
        existingSettings = {}
      }
    }

    const env: Record<string, string> = {}
    let modelType: string | undefined

    if (authMethod === 'openai_compatible' && guiSettings.openaiConfig) {
      const config = guiSettings.openaiConfig
      if (config.baseUrl) env.OPENAI_BASE_URL = config.baseUrl.trim()
      if (config.apiKey) env.OPENAI_API_KEY = config.apiKey.trim()
      if (config.haikuModel) env.OPENAI_DEFAULT_HAIKU_MODEL = config.haikuModel.trim()
      if (config.sonnetModel) env.OPENAI_DEFAULT_SONNET_MODEL = config.sonnetModel.trim()
      if (config.opusModel) env.OPENAI_DEFAULT_OPUS_MODEL = config.opusModel.trim()
      modelType = 'openai'
    } else if (authMethod === 'gemini' && guiSettings.geminiConfig) {
      const config = guiSettings.geminiConfig
      if (config.baseUrl) env.GEMINI_BASE_URL = config.baseUrl.trim()
      if (config.apiKey) env.GEMINI_API_KEY = config.apiKey.trim()
      if (config.haikuModel) env.GEMINI_DEFAULT_HAIKU_MODEL = config.haikuModel.trim()
      if (config.sonnetModel) env.GEMINI_DEFAULT_SONNET_MODEL = config.sonnetModel.trim()
      if (config.opusModel) env.GEMINI_DEFAULT_OPUS_MODEL = config.opusModel.trim()
      modelType = 'gemini'
    } else if ((authMethod === 'anthropic' || authMethod === 'oauth') && guiSettings.anthropicConfig) {
      const config = guiSettings.anthropicConfig
      if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl.trim()
      if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey.trim()
      if (config.haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.haikuModel.trim()
      if (config.sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.sonnetModel.trim()
      if (config.opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = config.opusModel.trim()
      modelType = undefined
    }

    if (Object.keys(env).length > 0) {
      existingSettings.env = { ...(existingSettings.env || {}), ...env }
      debug('Settings', `Synced API config to settings.json | envKeys=[${Object.keys(env).join(',')}]`)
    }

    if (modelType) {
      existingSettings.modelType = modelType
      debug('Settings', `Synced modelType to settings.json | modelType=${modelType}`)
    } else {
      delete existingSettings.modelType
    }

    ensureClaudeDir()
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2), 'utf-8')
    debug('Settings', `Settings.json updated at ${settingsPath}`)
  } catch (err: any) {
    error('Settings', 'Failed to sync API config to settings.json', err)
  }
}

function getHooksSettingsPath(scope: string): string {
  if (scope === 'user') {
    return getClaudeSettingsPath()
  }
  const cwd = getProjectCwd()
  if (scope === 'project') {
    return join(cwd, '.claude', 'settings.json')
  }
  return join(cwd, '.claude', 'settings.local.json')
}

function getProjectCwd(): string {
  return (global as any).__projectCwd ?? process.cwd()
}

ipcMain.handle('settings:loadHooksSettings', async (_event, scope: string = 'user') => {
  try {
    const settingsPath = getHooksSettingsPath(scope)
    if (!existsSync(settingsPath)) {
      return { success: true, data: '{}' }
    }
    const raw = readFileSync(settingsPath, 'utf-8')
    const parsed = raw.trim() ? JSON.parse(raw) : {}
    const hooksData = parsed.hooks ?? {}
    return { success: true, data: JSON.stringify(hooksData) }
  } catch (err: any) {
    error('Settings', 'Failed to load hooks settings', err)
    return { success: false, data: null, error: String(err) }
  }
})

ipcMain.handle('settings:saveHooksSettings', async (_event, hooksJson: string, scope: string = 'user') => {
  try {
    const settingsPath = getHooksSettingsPath(scope)
    let existingSettings: Record<string, unknown> = {}

    if (existsSync(settingsPath)) {
      try {
        const raw = readFileSync(settingsPath, 'utf-8')
        if (raw.trim()) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            existingSettings = { ...parsed }
          }
        }
      } catch {
        existingSettings = {}
      }
    }

    const newHooks = JSON.parse(hooksJson)
    existingSettings.hooks = newHooks

    const dirPath = dirname(settingsPath)
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2), 'utf-8')

    info('Settings', `Hooks settings saved to ${settingsPath}`)
    return { success: true }
  } catch (err: any) {
    error('Settings', 'Failed to save hooks settings', err)
    return { success: false, error: String(err) }
  }
})

ipcMain.handle('settings:injectGuiModels', async (_event, models: { primaryModel: string; haikuModel?: string; sonnetModel?: string; opusModel?: string; effortLevel?: 'low' | 'medium' | 'high' | 'max'; permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' }) => {
  debug('Settings', 'injectGuiModels', models)
  try {
    const settingsPath = getClaudeSettingsPath()
    let existingSettings: Record<string, unknown> = {}

    if (existsSync(settingsPath)) {
      try {
        const raw = readFileSync(settingsPath, 'utf-8')
        if (raw.trim()) {
          const parsed = JSON.parse(raw)
          if (parsed && typeof parsed === 'object') {
            existingSettings = { ...parsed }
          }
        }
      } catch {
        existingSettings = {}
      }
    }

    const modelSettings: Record<string, Record<string, unknown>> = {}

    if (models.haikuModel) {
      modelSettings[models.haikuModel] = {}
    }
    if (models.sonnetModel) {
      modelSettings[models.sonnetModel] = {}
    }
    if (models.opusModel) {
      modelSettings[models.opusModel] = {}
    }

    const mergedSettings: Record<string, unknown> = { ...existingSettings }

    if (Object.keys(modelSettings).length > 0) {
      const existingModelSettings = (typeof mergedSettings.modelSettings === 'object' && mergedSettings.modelSettings !== null)
        ? { ...(mergedSettings.modelSettings as Record<string, Record<string, unknown>>) }
        : {}
      mergedSettings.modelSettings = { ...existingModelSettings, ...modelSettings }
    }

    if (models.effortLevel) {
      mergedSettings.effortLevel = models.effortLevel
    }

    if (models.permissionMode) {
      const existingPermissions = (typeof mergedSettings.permissions === 'object' && mergedSettings.permissions !== null)
        ? { ...(mergedSettings.permissions as Record<string, unknown>) }
        : {}
      existingPermissions.defaultMode = models.permissionMode
      mergedSettings.permissions = existingPermissions
    }

    const dirPath = join(app.getPath('home'), '.claude')
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }
    writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2), 'utf-8')

    info('Settings', `Injected GUI models to ${settingsPath}`, {
      modelSettingsKeys: Object.keys(modelSettings),
      effortLevel: models.effortLevel,
      permissionMode: models.permissionMode,
      preservedFields: Object.keys(existingSettings).filter(k => !['modelSettings', 'effortLevel', 'permissions'].includes(k))
    })

    return { success: true }
  } catch (err: any) {
    error('Settings', 'Failed to inject GUI models', err)
    return { success: false, error: String(err) }
  }
})

// ============================================================
// Renderer Log Bridge — 接收前端日志并写入主进程日志文件
// ============================================================
ipcMain.on('log:debug', (_event, scope: string, message: string, data?: any) => {
  debug(`RENDERER:${scope}`, message, data)
})
ipcMain.on('log:info', (_event, scope: string, message: string, data?: any) => {
  info(`RENDERER:${scope}`, message, data)
})
ipcMain.on('log:warn', (_event, scope: string, message: string, data?: any) => {
  warn(`RENDERER:${scope}`, message, data)
})
ipcMain.on('log:error', (_event, scope: string, message: string, data?: any) => {
  error(`RENDERER:${scope}`, message, data)
})

ipcMain.on('trace:event', (_event, event: any) => {
  traceEvent({ ...event, source: event?.source || 'renderer' })
})

ipcMain.handle('debug:listFiles', async () => {
  return listDebugFiles()
})

ipcMain.handle('debug:readFile', async (_event, filePath: string, maxBytes?: number) => {
  return readDebugFile(filePath, maxBytes)
})

ipcMain.handle('debug:listTraceSessions', async () => {
  return listTraceSessions()
})

ipcMain.handle('debug:readTraceEvents', async (_event, sessionId: string, maxEvents?: number) => {
  return readTraceEvents(sessionId, maxEvents)
})

// ─── Turn Checkpoint API - 轮次变更追踪 ──────────────────────────

ipcMain.handle('session:getTurnCheckpoints', async (_event, sessionId: string, projectPath?: string) => {
  try {
    const { listSessionTurnCheckpoints } = await import('./turnCheckpointService')
    const resolvedProjectPath = projectPath || _event.sender?.getURL?.() || ''
    
    if (!resolvedProjectPath && !projectPath) {
      const chatStoreData = await _event.sender.executeJavaScript(
        `window.__chatStore_projectRoot || ''`
      ).catch(() => '')
      
      if (!chatStoreData) {
        return { ok: false, checkpoints: [], error: 'Project path not available' }
      }
    }

    const checkpoints = await listSessionTurnCheckpoints(sessionId, projectPath || '')
    return { ok: true, checkpoints, error: null }
  } catch (err) {
    return { 
      ok: false, 
      checkpoints: [], 
      error: err instanceof Error ? err.message : String(err) 
    }
  }
})

ipcMain.handle('session:getTurnRewindPreviewFiles', async (
  _event,
  sessionId: string,
  targetUserMessageId: string,
  userMessageIndex: number | undefined,
  projectPath?: string
) => {
  try {
    const { getTurnRewindPreviewFiles } = await import('./turnCheckpointService')
    return await getTurnRewindPreviewFiles(
      sessionId,
      projectPath || '',
      targetUserMessageId,
      userMessageIndex
    )
  } catch (err) {
    return {
      ok: false,
      files: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
})

ipcMain.handle('session:getTurnCheckpointDiff', async (
  _event,
  sessionId: string,
  targetUserMessageId: string,
  filePath: string,
  userMessageIndex?: number,
  projectPath?: string
) => {
  try {
    const { getTurnCheckpointDiff } = await import('./turnCheckpointService')
    return await getTurnCheckpointDiff(
      sessionId,
      projectPath || '',
      targetUserMessageId,
      filePath,
      userMessageIndex
    )
  } catch (err) {
    return { 
      state: 'error' as const, 
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
      diff: undefined
    }
  }
})

ipcMain.handle('session:rewindTurn', async (
  _event,
  sessionId: string,
  options: { targetUserMessageId: string; userMessageIndex?: number },
  projectPath?: string
) => {
  try {
    const { rewindTurn } = await import('./turnCheckpointService')
    return await rewindTurn(
      sessionId,
      projectPath || '',
      options.targetUserMessageId,
      options.userMessageIndex
    )
  } catch (err) {
    return { 
      ok: false, 
      error: err instanceof Error ? err.message : String(err) 
    }
  }
})
