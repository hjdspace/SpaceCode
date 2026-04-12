import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell, dialog, net } from 'electron'
import { join, dirname, resolve } from 'path'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { config } from 'dotenv'
import { initQueryEngineIntegration, attemptFullIntegration } from './queryEngineIntegration'
import { TerminalManager } from './terminalManager'

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged

let envPath: string
if (isDev) {
  envPath = resolve(__dirname, '../../.env')
} else {
  envPath = resolve(__dirname, '../.env')
}

if (existsSync(envPath)) {
  config({ path: envPath })
  console.log('[Main] Loaded env from:', envPath)
} else {
  console.log('[Main] .env not found at:', envPath)
}

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('no-sandbox')

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Claude Code Desktop',
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin') {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  createMenu()
}

function createMenu() {
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
        { role: 'togglefullscreen' }
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

  if (isDev) {
    template[2].submenu = [
      ...(template[2].submenu as Electron.MenuItemConstructorOptions[]),
      { type: 'separator' },
      { role: 'toggleDevTools' }
    ]
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createTray() {
  const iconPath = join(__dirname, '../dist/icon.png')
  let icon: Electron.NativeImage
  
  try {
    icon = nativeImage.createFromPath(iconPath)
    if (icon.isEmpty()) {
      icon = nativeImage.createEmpty()
    }
  } catch {
    icon = nativeImage.createEmpty()
  }
  
  tray = new Tray(icon)
  
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])
  
  tray.setToolTip('Claude Code Desktop')
  tray.setContextMenu(contextMenu)
  
  tray.on('click', () => {
    mainWindow?.show()
  })
}

app.whenReady().then(() => {
  createWindow()
  
  // Initialize QueryEngine integration
  try {
    initQueryEngineIntegration()
    // Attempt full integration with claude-code modules
    attemptFullIntegration().then(success => {
      if (success) {
        console.log('[Main] QueryEngine full integration ready')
      }
    })
  } catch (error) {
    console.error('[Main] Failed to initialize QueryEngine integration:', error)
  }
  
  if (process.platform === 'darwin') {
    createTray()
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
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('cli:sendMessage', async (_event, text: string) => {
  return { success: true, message: text }
})

ipcMain.handle('cli:getAppState', async () => {
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
  } catch (error) {
    return []
  }
})

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    return null
  }
})

ipcMain.handle('fs:stat', async (_event, filePath: string) => {
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

ipcMain.handle('env:get', async (_event, key: string) => {
  return process.env[key]
})

ipcMain.on('ui:showDiff', (_event, diffInfo) => {
  mainWindow?.webContents.send('ui:showDiff', diffInfo)
})

ipcMain.on('ui:showInfoPanel', (_event, mode) => {
  mainWindow?.webContents.send('ui:showInfoPanel', mode)
})

ipcMain.on('ui:hideInfoPanel', () => {
  mainWindow?.webContents.send('ui:hideInfoPanel')
})

ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  await shell.openExternal(url)
})

// Proxy HTTP requests from renderer to bypass CORS
ipcMain.handle('http:fetch', async (_event, url: string, options?: { method?: string; headers?: Record<string, string>; body?: string }) => {
  try {
    // Use Electron's net.fetch (Chromium-based, better proxy/SSL support)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000) // 30s timeout

    const response = await net.fetch(url, {
      method: options?.method || 'GET',
      headers: options?.headers || {},
      body: options?.body || undefined,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    const text = await response.text()
    return { ok: response.ok, status: response.status, data: text }
  } catch (error: any) {
    const errorMsg = error?.name === 'AbortError'
      ? 'Request timed out (30s)'
      : (error instanceof Error ? error.message : String(error))
    return { ok: false, status: 0, error: errorMsg }
  }
})

ipcMain.handle('system:getCwd', async () => {
  return process.cwd()
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
    console.log('[Terminal] Created terminal:', id, 'cwd:', cwd, 'shell:', shellName, 'custom env keys:', options?.env ? Object.keys(options.env) : [])
    return { id, shell: shellName }
  } catch (error) {
    console.error('[Terminal] Failed to create terminal:', error)
    return { id: null, error: String(error) }
  }
})

ipcMain.on('terminal:write', (_event, id: string, data: string) => {
  terminalManager.write(id, data)
})

ipcMain.on('terminal:resize', (_event, id: string, cols: number, rows: number) => {
  terminalManager.resize(id, cols, rows)
})

ipcMain.on('terminal:kill', (_event, id: string) => {
  terminalManager.kill(id)
})

ipcMain.on('terminal:runCommand', (_event, id: string, command: string) => {
  terminalManager.write(id, command + '\r')
})

// Get the path to claude-code CLI for launching it in terminal
ipcMain.handle('app:getClaudeCliPath', async () => {
  // Use openai-launcher.js which wraps cli.js with fetch interception
  // to support OpenAI-compatible APIs (OpenRouter, etc.)
  // Structure: claude-code-desktop/dist-electron/main.js -> ../../claude-code/openai-launcher.js
  const launcherPath = resolve(__dirname, '../../claude-code/openai-launcher.js')
  return launcherPath
})