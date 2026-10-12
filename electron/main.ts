/**
 * SpaceCode — Electron main entry point.
 *
 * After refactoring, this file is pure startup orchestration:
 *   1. Early environment + logging setup
 *   2. App.whenReady → create window, tray, register all IPC handlers,
 *      auto-start servers, init auto-updater
 *   3. App lifecycle hooks (window-all-closed, before-quit)
 *
 * All window creation, tray, menu, and IPC handler logic lives in
 * dedicated modules under electron/windows/ and electron/ipc/.
 */
import { app, globalShortcut, BrowserWindow, ipcMain } from 'electron'
import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'
import { config } from 'dotenv'
import { TerminalManager } from './infra/terminalManager'
import { claudeCodeNamespace } from '@/shared/channels/claudeCode'
import { channelNames } from '@/shared/channelMap'
import { registerGitIPCHandlers } from './git/gitService'
import { registerMemoryIPCHandlers } from './memory/memoryService'
import { registerSkillsIPCHandlers, registerLocalLibraryIPCHandlers } from './skills/skillsService'
import { registerSkillManagerV2IPCHandlers } from './skillManagerV2'
import { registerAgentsIPCHandlers } from './skills/agentsService'
import { registerArtifactsIPCHandlers, stopArtifactsWatch } from './skills/artifactsService'
import { registerCronIPCHandlers } from './cron/cronService'
import { registerOfficeCliIPCHandlers, cleanupOfficeCli, ensureOfficeCliInstalled } from './tools/officeCliService'
import { registerCuaDriverIPCHandlers, cleanupCuaDriverMcp } from './tools/cuaDriverService'
import { registerBrowserUseIPCHandlers, cleanupBrowserUseMcp } from './tools/browserUseService'
import { registerClaudeCodeIPC } from './engine/claudeCodeIPC'
import { initAutoUpdater, registerAutoUpdaterIPC, destroyAutoUpdater, installUpdateOnQuit } from './infra/autoUpdaterService'
import { engineGateway } from './engine/engineGateway'
import { EngineFactory } from './engine/engines/EngineFactory'
import { registerPromptOptimizerIPC } from './skills/promptOptimizerIPC'
import { registerDesignIPCHandlers } from './design/designService'
import { registerNotificationIPCHandlers } from './infra/notificationService'
import {
  initLogger, info, warn, error, debug, isDebugMode,
} from './infra/logger'
import { proxyManager, buildProxyConfigFromSettings } from './infra/proxyManager'
import { rtkManager } from './tools/rtkManager'
import { PetFileService } from './pet/petFileService'
import { PetWindowController } from './pet/petWindowManager'
import { registerPetIpcHandlers } from './pet/petIpcHandlers'
import { setupLinuxPlatform } from './infra/platformSetup'
import { registerPreviewServerIPCHandlers, cleanupPreviewServer } from './infra/previewServer'

// ── Split modules ───────────────────────────────────────────────
import { createWindow, createSplashScreen, closeSplashScreen, getMainWindow } from './windows/mainWindow'
import { createTray, destroyTray } from './windows/tray'
import { registerCoreIPCHandlers } from './ipc/coreIpcHandlers'
import { registerH5AccessIPCHandlers, getH5Server, setH5Server, getH5AuthService } from './ipc/h5IpcHandlers'
import { registerImIPCHandlers } from './ipc/imIpcHandlers'
import { registerRtkIPCHandlers } from './ipc/rtkIpcHandlers'
import { registerMobileIPCHandlers, getMobileServer, setMobileServer, getMobileUnsubscribe, setMobileUnsubscribe } from './ipc/mobileIpcHandlers'
import { registerSettingsIPCHandlers, loadGuiSettings, reconcileProxyWithSettings } from './ipc/settingsIpc'
import { registerTraceIPCHandlers } from './ipc/traceIpc'
import { H5Server } from './h5/h5Server'

// claudeCode handler channel 名从表派生 — main.ts 侧仅 engineSourceChanged 一个 handler
const CLAUDE_CODE_CHANNELS = channelNames(claudeCodeNamespace.channels, 'claude-code:')

// ============================================================
// App Startup
// ============================================================
const startTime = Date.now()

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

setupLinuxPlatform()

// Windows: set AppUserModelId (see original comment in git history for details)
if (process.platform === 'win32') {
  app.setAppUserModelId(app.isPackaged ? 'com.spacecode.desktop' : 'com.spacecode.desktop.dev')
}

app.commandLine.appendSwitch('no-sandbox')

// ============================================================
// Shared state (lifecycle-scoped)
// ============================================================
let petWindowManager: PetWindowController | null = null
const terminalManager = new TerminalManager()

// ============================================================
// App Lifecycle
// ============================================================
app.whenReady().then(async () => {
  initLogger()
  info('Startup', `App ready | elapsed=${Date.now() - startTime}ms | isDev=${isDev} | isPackaged=${app.isPackaged} | debugMode=${isDebugMode()}`)

  // 回放早期日志
  for (const earlyMsg of earlyLogs) {
    debug('Startup', earlyMsg)
  }

  // Splash + main window
  createSplashScreen()
  const { createMenu } = await import('./windows/menu')
  createWindow(terminalManager, createMenu)
  info('Startup', `Window created | elapsed=${Date.now() - startTime}ms`)

  // ── Register domain IPC handlers ──────────────────────────────
  registerGitIPCHandlers()
  info('Startup', 'Git IPC handlers registered')

  registerMemoryIPCHandlers()
  info('Startup', 'Memory IPC handlers registered')

  registerSkillsIPCHandlers()
  info('Startup', 'Skills IPC handlers registered')

  registerLocalLibraryIPCHandlers()
  info('Startup', 'Local Library IPC handlers registered')

  registerSkillManagerV2IPCHandlers()
  info('Startup', 'Skill Manager V2 IPC handlers registered')

  registerAgentsIPCHandlers()
  info('Startup', 'Agents IPC handlers registered')

  registerArtifactsIPCHandlers()
  info('Startup', 'Artifacts IPC handlers registered')

  registerCronIPCHandlers()
  info('Startup', 'Cron IPC handlers registered')

  registerOfficeCliIPCHandlers()
  info('Startup', 'OfficeCLI IPC handlers registered')

  void ensureOfficeCliInstalled()

  registerCuaDriverIPCHandlers()
  info('Startup', 'CuaDriver IPC handlers registered')

  registerBrowserUseIPCHandlers()
  info('Startup', 'BrowserUse IPC handlers registered')

  registerClaudeCodeIPC()
  info('Startup', 'Claude Code IPC handlers registered')

  registerH5AccessIPCHandlers()
  info('Startup', 'H5 Access IPC handlers registered')

  registerImIPCHandlers()
  info('Startup', 'IM Integration IPC handlers registered')

  registerRtkIPCHandlers()
  info('Startup', 'RTK IPC handlers registered')

  // ── Core IPC (window, fs, shell, terminal, settings, trace, etc.) ──
  registerCoreIPCHandlers(terminalManager)
  info('Startup', 'Core IPC handlers registered')

  registerTraceIPCHandlers()
  info('Startup', 'Trace IPC handlers registered')

  // ── Pet system ────────────────────────────────────────────────
  ;(async () => {
    try {
      const petFileService = new PetFileService()
      await petFileService.init()
      petWindowManager = new PetWindowController({
        preloadPath: resolve(__dirname, 'petPreload.js'),
        isDev,
      })

      registerPetIpcHandlers({
        petFileService,
        petWindowManager,
        getMainWindow: () => getMainWindow(),
        getLocale: (): 'zh-CN' | 'en-US' => {
          try {
            const settingsPath = resolve(app.getPath('home'), '.claude', 'gui-settings.json')
            if (!existsSync(settingsPath)) return 'zh-CN'
            const raw = readFileSync(settingsPath, 'utf-8')
            if (!raw.trim()) return 'zh-CN'
            const settings = JSON.parse(raw)
            return settings?.language === 'en-US' ? 'en-US' : 'zh-CN'
          } catch {
            return 'zh-CN'
          }
        }
      })
      info('Startup', 'Pet IPC handlers registered')
    } catch (err) {
      error('Startup', 'Failed to initialize pet module', err)
    }
  })()

  // ── Auto-start H5 server ──────────────────────────────────────
  ;(async () => {
    try {
      const h5Settings = getH5AuthService().getSettings()
      if (h5Settings.enabled && h5Settings.token) {
        if (!getH5Server()) {
          setH5Server(new H5Server(getH5AuthService()))
        }
        await getH5Server()!.start(h5Settings.fixedPort ?? undefined)
        const st = getH5Server()!.getStatus()
        info('H5Access', `H5 server auto-started on app launch | port=${st.port} | ip=${st.ip} | url=${st.publicUrl}`)
      }
    } catch (err) {
      error('H5Access', 'Failed to auto-start H5 server on app launch:', err)
    }
  })()

  // ── Design IPC ────────────────────────────────────────────────
  const designResourcesPath = app.isPackaged
    ? process.resourcesPath
    : resolve(__dirname, '..', 'resources')
  registerDesignIPCHandlers(getMainWindow()!, designResourcesPath)
  info('Startup', 'Design IPC handlers registered')

  // ── Notifications ─────────────────────────────────────────────
  registerNotificationIPCHandlers(() => getMainWindow())

  // ── Mobile server ─────────────────────────────────────────────
  registerMobileIPCHandlers()

  // ── Engine source change handler ──────────────────────────────
  ipcMain.handle(CLAUDE_CODE_CHANNELS.notifyEngineSourceChanged, async (_, source: string) => {
    info('EngineSource', `Engine source changed to: ${source}`)
    const guiSettings = await loadGuiSettings()
    const authMethod = guiSettings?.authMethod
    if (authMethod && !['anthropic_compatible', 'claudeai', 'console'].includes(authMethod)) {
      const proxyConfig = buildProxyConfigFromSettings(guiSettings)
      if (proxyConfig) {
        try {
          await proxyManager.ensureRunning(proxyConfig)
          info('EngineSource', 'Proxy ensured running after engine source change')
        } catch (err) {
          warn('EngineSource', 'Failed to ensure proxy running after engine source change:', err)
        }
      }
    } else {
      if (proxyManager.isRunning()) {
        try {
          await proxyManager.stop()
          info('EngineSource', 'Proxy stopped (Anthropic provider does not need proxy)')
        } catch (err) {
          warn('EngineSource', 'Failed to stop proxy after engine source change:', err)
        }
      }
    }
  })

  // ── Prompt Optimizer ──────────────────────────────────────────
  registerPromptOptimizerIPC()
  info('Startup', 'Prompt Optimizer IPC handlers registered')

  // ── Preview Server ────────────────────────────────────────────
  registerPreviewServerIPCHandlers()
  info('Startup', 'Preview Server IPC handlers registered')

  // ── Auto Updater ──────────────────────────────────────────────
  registerAutoUpdaterIPC()
  if (!isDev) {
    const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || null
    initAutoUpdater(getMainWindow()!, ghToken)
    info('Startup', 'Auto updater initialized')
  } else {
    info('Startup', 'Auto updater skipped (dev mode)')
  }

  // ── Tray ──────────────────────────────────────────────────────
  createTray()
  info('Startup', `System tray created | total elapsed=${Date.now() - startTime}ms`)

  // ── Global DevTools shortcut (production) ─────────────────────
  if (!isDev) {
    try {
      globalShortcut.register('CommandOrControl+Shift+I', () => {
        const win = getMainWindow()
        if (!win || win.isDestroyed()) return
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools()
          info('Debug', 'DevTools closed via shortcut')
        } else {
          win.webContents.openDevTools()
          info('Debug', 'DevTools opened via Ctrl+Shift+I shortcut')
        }
      })
      debug('Debug', 'Global shortcut Ctrl+Shift+I registered for DevTools toggle')
    } catch (err) {
      warn('Debug', 'Failed to register DevTools shortcut', err)
    }
  }

  // ── macOS activate ────────────────────────────────────────────
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      import('./windows/menu').then(({ createMenu }) => {
        createWindow(terminalManager, createMenu)
      })
    } else {
      getMainWindow()?.show()
    }
  })

  // ── Auto-start proxy for non-Anthropic providers ──────────────
  ;(async () => {
    const guiSettings = await loadGuiSettings()
    if (guiSettings && !['anthropic_compatible', 'claudeai', 'console'].includes(guiSettings.authMethod)) {
      const proxyConfig = buildProxyConfigFromSettings(guiSettings)
      if (proxyConfig) {
        try {
          await proxyManager.start(proxyConfig)
          info('Startup', 'Auto-started proxy for non-Anthropic provider')
        } catch (err) {
          warn('Startup', 'Auto-start proxy failed:', err)
        }
      }
    }
  })()

  // ── Auto-restore RTK hook ─────────────────────────────────────
  ;(async () => {
    const guiSettings = await loadGuiSettings()
    if (guiSettings?.rtkEnabled) {
      try {
        await rtkManager.ensureBinary()
        await rtkManager.install()
        info('Startup', 'RTK hook auto-restored')
      } catch (err) {
        error('Startup', 'Failed to restore RTK on startup', { error: String(err) })
      }
    }
  })()
})

// Settings/profiles IPC handlers — registered at top-level so they
// are available even before app.whenReady() resolves (matches the
// original main.ts layout where these were top-level calls).
registerSettingsIPCHandlers()

// ============================================================
// App Quit Handlers
// ============================================================
app.on('window-all-closed', () => {
  info('App', 'All windows closed')
  closeSplashScreen()
  if (petWindowManager) {
    petWindowManager.destroy()
  }
  destroyTray()
  app.quit()
})

app.on('before-quit', async () => {
  info('App', 'App quitting')
  installUpdateOnQuit()
  cleanupPreviewServer()
  cleanupOfficeCli()
  await cleanupCuaDriverMcp()
  await cleanupBrowserUseMcp()
  stopArtifactsWatch()
  destroyTray()
  destroyAutoUpdater()
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
  try {
    info('App', 'Killing all Claude Code sessions')
    const { getPool } = await import('./engine/claudeCodeIPC')
    const pool = getPool()
    if (pool) {
      pool.killAll()
    }
  } catch (err) {
    warn('App', 'Error killing Claude Code sessions', err)
  }
  const ms = getMobileServer()
  if (ms) { await ms.stop(); setMobileServer(null) }
  getMobileUnsubscribe()?.()
  setMobileUnsubscribe(null)
  const h5 = getH5Server()
  if (h5) { h5.stop(); setH5Server(null) }
})
