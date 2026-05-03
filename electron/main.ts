import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, dialog, net, globalShortcut } from 'electron'
import { join, resolve } from 'path'
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { config } from 'dotenv'
import { TerminalManager } from './terminalManager'
import { registerGitIPCHandlers } from './gitService'
import { registerSkillsIPCHandlers } from './skillsService'
import { registerClaudeCodeIPC, setMainWindow } from './claudeCodeIPC'
import { initLogger, info, warn, error, debug, isDebugMode, ipc as logIpc } from './logger'

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

// Resolve icon path: dev mode uses project root icons/, production uses extraResources
function getIconPath(): string {
  const iconExt = process.platform === 'win32' ? 'ico' : 'png'
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icons', `icon.${iconExt}`)
  }
  return join(__dirname, `../icons/icon.${iconExt}`)
}

function createWindow() {
  const debugMode = isDebugMode()

  const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'SpaceCode',
    icon: getIconPath(),
    backgroundColor: '#0c0c1d',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: 'persist:claude-code-desktop',
      // 允许在 --debug 模式或开发模式下使用 DevTools
      devTools: isDev || debugMode,
      spellcheck: false
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
  }

  mainWindow = new BrowserWindow(windowOptions)

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
    mainWindow.loadURL('http://localhost:5173')
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

  mainWindow.on('closed', () => {
    info('Window', 'Main window closed')
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
  let icon: Electron.NativeImage

  debug('Tray', `Loading icon from: ${iconPath} | exists: ${existsSync(iconPath)}`)

  try {
    if (existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath)
      if (icon.isEmpty()) {
        warn('Tray', 'Icon loaded but is empty, using fallback')
        icon = nativeImage.createEmpty()
      } else {
        const trayIconSize = process.platform === 'darwin' ? 18 : 16
        icon = icon.resize({ width: trayIconSize, height: trayIconSize })
        debug('Tray', `Icon loaded and resized to ${trayIconSize}x${trayIconSize}`)
      }
    } else {
      warn('Tray', `Icon file not found at: ${iconPath}`)
      icon = nativeImage.createEmpty()
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

  // Register Claude Code IPC handlers
  registerClaudeCodeIPC()
  info('Startup', 'Claude Code IPC handlers registered')

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
})

app.on('window-all-closed', () => {
  info('App', 'All windows closed')
  if (!tray) {
    app.quit()
  }
})

app.on('before-quit', () => {
  info('App', 'App quitting')
  // 注销全局快捷键
  try { globalShortcut.unregisterAll() } catch {}
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
  debug('IPC', 'fs:searchFiles', { dirPath, query, maxResults: options?.maxResults })
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

// Proxy HTTP requests from renderer to bypass CORS
ipcMain.handle('http:fetch', async (_event, url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => {
  const fetchStart = Date.now()
  debug('IPC', 'http:fetch', { url, method: options?.method })
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

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
      ? 'Request timed out (30s)'
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

// ============================================================================
// Settings Injection
// ============================================================================
function getClaudeSettingsPath(): string {
  return join(app.getPath('home'), '.claude', 'settings.json')
}

ipcMain.handle('settings:injectGuiModels', async (_event, models: { primaryModel: string; haikuModel?: string; sonnetModel?: string; opusModel?: string; effortLevel?: 'low' | 'medium' | 'high' | 'max' }) => {
  debug('Settings', 'injectGuiModels', models)
  try {
    const settingsPath = getClaudeSettingsPath()
    let settings: any = {}

    if (existsSync(settingsPath)) {
      try {
        const raw = readFileSync(settingsPath, 'utf-8')
        settings = JSON.parse(raw)
      } catch {
        settings = {}
      }
    }

    const modelSettings: Record<string, any> = {}

    if (models.haikuModel) {
      modelSettings[models.haikuModel] = {}
    }
    if (models.sonnetModel) {
      modelSettings[models.sonnetModel] = {}
    }
    if (models.opusModel) {
      modelSettings[models.opusModel] = {}
    }

    if (Object.keys(modelSettings).length > 0) {
      settings.modelSettings = { ...(settings.modelSettings || {}), ...modelSettings }
    }

    delete settings.model

    if (models.effortLevel) {
      settings.effortLevel = models.effortLevel
    } else {
      delete settings.effortLevel
    }

    const dirPath = join(app.getPath('home'), '.claude')
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')

    info('Settings', `Injected GUI models to ${settingsPath}`, { modelSettingsKeys: Object.keys(modelSettings), modelCleared: true })

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
