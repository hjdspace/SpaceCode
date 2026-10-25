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
import { GENUI_SANDBOX_DEV_PORT } from '@/shared/genuiSandbox'
import { channelNames, eventChannels } from '@/shared/channelMap'
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
import { checkCliUpdate, getCliUpdateState, invalidateCliUpdateState } from './engine/cliDetector'
import { initAutoUpdater, registerAutoUpdaterIPC, destroyAutoUpdater, installUpdateOnQuit } from './infra/autoUpdaterService'
import { engineGateway } from './engine/engineGateway'
import { EngineFactory } from './engine/engines/EngineFactory'
import { registerPromptOptimizerIPC } from './skills/promptOptimizerIPC'
import { registerDesignIPCHandlers } from './design/designService'
import { registerNotificationIPCHandlers } from './infra/notificationService'
import {
  initLogger, info, warn, error, debug, isDebugMode,
} from './infra/logger'
import { flushTraceSidecars } from './infra/traceSidecar'
import { proxyManager, buildProxyConfigFromSettings } from './infra/proxyManager'
import { sweepStaleTempArtifacts } from './session/tempArtifacts'
import { rtkManager } from './tools/rtkManager'
import { PetFileService } from './pet/petFileService'
import { PetWindowController } from './pet/petWindowManager'
import { registerPetIpcHandlers } from './pet/petIpcHandlers'
import { setupLinuxPlatform } from './infra/platformSetup'
import { registerPreviewServerIPCHandlers, cleanupPreviewServer } from './infra/previewServer'
import { installProcessErrorGuards, markQuitting, hideDockIcon } from './infra/appLifecycle'
import { registerGenuiSandboxProtocol, registerGenuiSandboxScheme } from './genui/sandboxProtocol'
import { startSandboxStaticServer, type SandboxStaticServer } from './genui/sandboxStaticServer'

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
import { registerVoiceIPCHandlers } from './voice/voiceIpcHandlers'
import { registerVoiceShortcut, unregisterVoiceShortcut } from './voice/voiceShortcut'
import { H5Server } from './h5/h5Server'

// claudeCode handler channel 名从表派生 — main.ts 侧仅 engineSourceChanged 一个 handler
const CLAUDE_CODE_CHANNELS = channelNames(claudeCodeNamespace.channels, 'claude-code:')
const CLAUDE_CODE_EVENTS = eventChannels(claudeCodeNamespace.events, 'claude-code:')

const CLI_UPDATE_CHECK_DELAY_MS = 30_000
let cliUpdateCheckTimer: NodeJS.Timeout | null = null

async function runCliUpdateCheck(): Promise<void> {
  const cached = getCliUpdateState()
  if (cached && !cached.stale) return
  await checkCliUpdate()
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(CLAUDE_CODE_EVENTS.onCliUpdateState, getCliUpdateState())
  }
}

/**
 * 启动后延迟查一次 CLI 更新。装在安装版才查 —— 内置引擎不碰 PATH 上的 claude。
 * 后台检查失败静默：没有网络不是用户需要处理的事情，设置页手动检查时才提示。
 */
function scheduleCliUpdateCheck(delayMs = CLI_UPDATE_CHECK_DELAY_MS, onlyIfInstalled = true): void {
  if (cliUpdateCheckTimer) {
    clearTimeout(cliUpdateCheckTimer)
    cliUpdateCheckTimer = null
  }
  cliUpdateCheckTimer = setTimeout(() => {
    cliUpdateCheckTimer = null
    void (async () => {
      try {
        if (onlyIfInstalled) {
          const settings = await loadGuiSettings()
          if (settings?.engineSource !== 'installed') {
            debug('CliUpdate', 'Startup check skipped: engine source is not installed')
            return
          }
        }
        await runCliUpdateCheck()
        info('CliUpdate', 'Background CLI update check finished')
      } catch (err) {
        warn('CliUpdate', 'Background CLI update check failed', { error: String(err) })
      }
    })()
  }, delayMs)
  cliUpdateCheckTimer.unref?.()
}

// ============================================================
// App Startup
// ============================================================
const startTime = Date.now()

// 必须在任何日志调用之前注册：earlyLog 走 console.log，stdio 已坏时它会抛 write EIO
installProcessErrorGuards()

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

// GenUI 卡片沙箱：scheme 必须在 app ready 之前注册，处理器在 ready 之后挂
registerGenuiSandboxScheme()

/** 沙箱静态产物目录：与主窗口 `dist/index.html` 同级的独立资源目录。 */
const genuiSandboxRoot = resolve(__dirname, '../dist/genui-sandbox')

// ============================================================
// Shared state (lifecycle-scoped)
// ============================================================
let petWindowManager: PetWindowController | null = null
let genuiSandboxDevServer: SandboxStaticServer | null = null
const terminalManager = new TerminalManager()

// ============================================================
// App Lifecycle
// ============================================================
app.whenReady().then(async () => {
  initLogger()
  info('Startup', `App ready | elapsed=${Date.now() - startTime}ms | isDev=${isDev} | isPackaged=${app.isPackaged} | debugMode=${isDebugMode()}`)

  const sweptTempArtifacts = sweepStaleTempArtifacts()
  if (sweptTempArtifacts.removed > 0 || sweptTempArtifacts.failed > 0) {
    info('Startup', `Stale temp artifacts swept | removed=${sweptTempArtifacts.removed} | failed=${sweptTempArtifacts.failed}`)
  }

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

  scheduleCliUpdateCheck()

  registerH5AccessIPCHandlers()
  info('Startup', 'H5 Access IPC handlers registered')

  registerImIPCHandlers()
  info('Startup', 'IM Integration IPC handlers registered')

  registerRtkIPCHandlers()
  info('Startup', 'RTK IPC handlers registered')

  registerVoiceIPCHandlers()
  info('Startup', 'Voice Input IPC handlers registered')

  if (registerVoiceShortcut(() => getMainWindow())) {
    info('Startup', 'Voice Input shortcut registered (Alt+V)')
  } else {
    warn('Startup', 'Voice Input shortcut unavailable (Alt+V already taken)')
  }

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
    if (source === 'installed') {
      // 切回安装版时重新核对一次：CLI 可能在用内置引擎期间被外部升级。
      invalidateCliUpdateState()
      scheduleCliUpdateCheck(0, false)
    }
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

  // ── GenUI 卡片沙箱承载 ────────────────────────────────────────
  registerGenuiSandboxProtocol({ resourceRoot: genuiSandboxRoot })
  info('Startup', 'GenUI sandbox protocol registered')

  if (isDev) {
    // 开发环境换主机名与端口服务同一份产物，确保跨 site 拿到 OOPIF 进程隔离。
    // 端口被占（第二个实例等）只让卡片退化成错误占位，不拖垮应用启动。
    try {
      genuiSandboxDevServer = await startSandboxStaticServer({
        resourceRoot: genuiSandboxRoot,
        // URL 里用 localhost 这个主机名（换主机名才换 site），绑回环即可
        bindHost: '127.0.0.1',
        port: GENUI_SANDBOX_DEV_PORT,
        label: 'dev',
      })
      info('Startup', `GenUI sandbox dev host ready on localhost:${genuiSandboxDevServer.port}`)
    } catch (err) {
      warn('Startup', 'GenUI sandbox dev host unavailable; cards will show an error placeholder:', err)
    }
  }

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

/**
 * 单步清理：任何一步抛错都只记日志并继续。
 * 旧写法是一条直线，第一个异常（一次 write EIO 就够了）就把后面的清理全跳过，
 * 子进程与服务器留在后台 —— 用户看到的正是「点了退出，图标还在转」。
 */
async function runQuitStep(name: string, step: () => unknown): Promise<void> {
  debug('App', `Quit step: ${name}`)
  try {
    await step()
  } catch (err) {
    warn('App', `Quit step failed | ${name}`, err)
  }
}

app.on('before-quit', async () => {
  markQuitting()
  info('App', 'App quitting')
  await runQuitStep('flushTraceSidecars', flushTraceSidecars)
  await runQuitStep('hideDockIcon', hideDockIcon)
  await runQuitStep('installUpdateOnQuit', installUpdateOnQuit)
  await runQuitStep('cleanupPreviewServer', cleanupPreviewServer)
  await runQuitStep('stopGenuiSandboxDevServer', async () => {
    if (!genuiSandboxDevServer) return
    await genuiSandboxDevServer.stop()
    genuiSandboxDevServer = null
  })
  await runQuitStep('cleanupOfficeCli', cleanupOfficeCli)
  await runQuitStep('cleanupCuaDriverMcp', cleanupCuaDriverMcp)
  await runQuitStep('cleanupBrowserUseMcp', cleanupBrowserUseMcp)
  await runQuitStep('stopArtifactsWatch', stopArtifactsWatch)
  await runQuitStep('destroyTray', destroyTray)
  await runQuitStep('destroyAutoUpdater', destroyAutoUpdater)
  await runQuitStep('unregisterVoiceShortcut', () => unregisterVoiceShortcut())
  await runQuitStep('globalShortcut.unregisterAll', () => globalShortcut.unregisterAll())
  await runQuitStep('proxyManager.stop', () => proxyManager.stop())
  await runQuitStep('terminalManager.killAll', () => {
    info('App', 'Killing all terminal processes')
    terminalManager.killAll()
  })
  await runQuitStep('claudeCodePool.killAll', async () => {
    info('App', 'Killing all Claude Code sessions')
    const { getPool } = await import('./engine/claudeCodeIPC')
    getPool()?.killAll()
  })
  await runQuitStep('mobileServer.stop', async () => {
    const ms = getMobileServer()
    if (ms) { await ms.stop(); setMobileServer(null) }
    getMobileUnsubscribe()?.()
    setMobileUnsubscribe(null)
  })
  await runQuitStep('h5Server.stop', () => {
    const h5 = getH5Server()
    if (h5) { h5.stop(); setH5Server(null) }
  })
})
