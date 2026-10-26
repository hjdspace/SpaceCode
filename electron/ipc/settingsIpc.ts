/**
 * GUI Settings, Profiles, and Settings-injection IPC handlers.
 *
 * Handles persistence of gui-settings.json, profiles.json, hooks settings,
 * and syncing API config to Claude's settings.json.
 */
import { ipcMain, app } from 'electron'
import type { EffortLevel } from '@/shared/effort'
import { join, dirname, resolve, isAbsolute } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import { debug, info, warn, error } from '../infra/logger'
import { proxyManager, buildProxyConfigFromSettings, isSameProxyConfig } from '../infra/proxyManager'
import { aggregateLocalTokenStats } from '../session/tokenStatsService'

// ── Path helpers ────────────────────────────────────────────────

export function getGuiSettingsPath(): string {
  return join(app.getPath('home'), '.claude', 'gui-settings.json')
}

function getProfilesPath(): string {
  return join(app.getPath('home'), '.spacecode', 'profiles.json')
}

function getClaudeSettingsPath(): string {
  return join(app.getPath('home'), '.claude', 'settings.json')
}

function ensureClaudeDir(): void {
  const dirPath = join(app.getPath('home'), '.claude')
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true })
  }
}

// ── GUI Settings load/save ──────────────────────────────────────

export async function loadGuiSettings(): Promise<Record<string, any> | null> {
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

/** 保存后代理与配置的对照结果，回给渲染端，"已保存"才等于"代理真的对齐了"。 */
export interface ProxyReconcileResult {
  state: 'not-needed' | 'unchanged' | 'aligned' | 'failed'
  error?: string
}

/**
 * 设置保存后将本地代理与最新 GUI 配置对齐。
 */
async function reconcileProxyWithSettings(guiSettings: Record<string, any>): Promise<ProxyReconcileResult> {
  const authMethod = guiSettings?.authMethod
  const needsProxy = !!authMethod && !['anthropic_compatible', 'claudeai', 'console'].includes(authMethod)

  if (!needsProxy) {
    if (proxyManager.isRunning()) {
      try {
        await proxyManager.stop()
        info('Settings', 'Proxy stopped after settings save (current provider does not need proxy)')
      } catch (err) {
        warn('Settings', 'Failed to stop proxy after settings save', { error: String(err) })
        return { state: 'failed', error: String(err) }
      }
    }
    return { state: 'not-needed' }
  }

  const newConfig = buildProxyConfigFromSettings(guiSettings)
  if (!newConfig) return { state: 'not-needed' }

  if (!proxyManager.isRunning()) {
    try {
      await proxyManager.start(newConfig)
      info('Settings', 'Proxy started after settings save')
      return { state: 'aligned' }
    } catch (err) {
      warn('Settings', 'Failed to start proxy after settings save', { error: String(err) })
      return { state: 'failed', error: String(err) }
    }
  }

  const current = proxyManager.getConfig()
  if (current && isSameProxyConfig(current, newConfig)) return { state: 'unchanged' }

  newConfig.port = current?.port ?? newConfig.port
  try {
    await proxyManager.start(newConfig)
    info('Settings', 'Proxy restarted after settings save (provider config changed)', {
      port: newConfig.port,
      upstreamBaseUrl: newConfig.upstreamBaseUrl,
    })
    return { state: 'aligned' }
  } catch (err) {
    warn('Settings', 'Failed to restart proxy after provider config change', { error: String(err) })
    return { state: 'failed', error: String(err) }
  }
}

// Re-export for use by lifecycle
export { reconcileProxyWithSettings }

// ── Settings injection ──────────────────────────────────────────

function syncApiConfigToSettingsJson(guiSettingsJson: string): void {
  try {
    const guiSettings = JSON.parse(guiSettingsJson)
    if (!guiSettings || typeof guiSettings !== 'object') return

    const authMethod = guiSettings.authMethod
    if (!authMethod) return

    const needsProxy = !['anthropic_compatible', 'claudeai', 'console'].includes(authMethod)

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

    if (needsProxy) {
      debug('Settings', 'Proxy mode detected - skipping provider env sync to avoid polluting global CLI config')
    } else if (authMethod === 'anthropic_compatible' && guiSettings.anthropicConfig) {
      const config = guiSettings.anthropicConfig
      if (config.baseUrl) env.ANTHROPIC_BASE_URL = config.baseUrl.trim()
      if (config.apiKey) env.ANTHROPIC_API_KEY = config.apiKey.trim()
      if (config.haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = config.haikuModel.trim()
      if (config.sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = config.sonnetModel.trim()
      if (config.opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = config.opusModel.trim()
      modelType = undefined
    }

    let changed = false

    if (Object.keys(env).length > 0) {
      existingSettings.env = { ...(existingSettings.env || {}), ...env }
      changed = true
      debug('Settings', `Synced API config to settings.json | envKeys=[${Object.keys(env).join(',')}]`)
    }

    if (modelType) {
      if (existingSettings.modelType !== modelType) {
        existingSettings.modelType = modelType
        changed = true
      }
    } else if (existingSettings.modelType !== undefined) {
      delete existingSettings.modelType
      changed = true
    }

    if (existingSettings.model) {
      delete existingSettings.model
      changed = true
      debug('Settings', `Removed stale "model" field from settings.json to prevent overriding --model CLI arg`)
    }

    if (!changed) return

    ensureClaudeDir()
    writeFileSync(settingsPath, JSON.stringify(existingSettings, null, 2), 'utf-8')
    debug('Settings', `Settings.json updated at ${settingsPath}`)
  } catch (err: any) {
    error('Settings', 'Failed to sync API config to settings.json', err)
  }
}

// ── Hooks settings ──────────────────────────────────────────────

/**
 * project / local 的根必须由渲染进程显式传入：主进程没有"当前项目"的概念，
 * 进程 cwd 是程序启动目录，与用户打开的项目无关（历史上的 `__projectCwd`
 * 兜底从未被赋值，于是保存会写到启动目录并在里面凭空建出 .claude）。
 * 返回 null 表示定位不了，调用方必须明确失败而不是换个地方写。
 */
function resolveHooksScopePath(scope: string, projectRoot: unknown): string | null {
  if (scope === 'user') {
    return getClaudeSettingsPath()
  }
  if (scope !== 'project' && scope !== 'local') return null
  if (typeof projectRoot !== 'string' || !projectRoot || !isAbsolute(projectRoot)) return null
  // 根必须真的存在：否则保存会在一个已失效的路径下凭空 mkdirSync 出 .claude，
  // 用户看到"保存成功"，引擎却永远读不到它。
  if (!existsSync(projectRoot)) return null
  return join(projectRoot, '.claude', scope === 'project' ? 'settings.json' : 'settings.local.json')
}

function scopePathError(scope: string): string {
  return `Cannot resolve project root for hooks scope "${scope}": an existing absolute projectRoot is required`
}

// ── IPC Registration ────────────────────────────────────────────

/**
 * 「写 gui-settings.json → 同步 settings.json → 对齐本地代理」是一个原子单元。
 *
 * 渲染端会连发两次保存（切配置方案时尤其明显）。并发跑时「最后一个写完文件的」和
 * 「最后一个对齐代理的」未必是同一批 —— 文件已经是新上游、代理还挂在旧上游，
 * 而两次保存都回报成功。排成一条队列，后到的保存在前者对齐完之后才开始。
 */
let settingsSaveQueue: Promise<unknown> = Promise.resolve()

function enqueueSettingsSave<T>(task: () => Promise<T>): Promise<T> {
  const run = settingsSaveQueue.then(task)
  // 一次失败不能让队列卡死：后续保存照样要跑。
  settingsSaveQueue = run.then(() => undefined, () => undefined)
  return run
}

async function applyGuiSettingsSave(data: string): Promise<{ success: boolean; error?: string; proxy?: ProxyReconcileResult }> {
  try {
    ensureClaudeDir()
    const settingsPath = getGuiSettingsPath()
    writeFileSync(settingsPath, data, 'utf-8')
    debug('Settings', `GUI settings saved to ${settingsPath}`)

    syncApiConfigToSettingsJson(data)

    let parsedGuiSettings: Record<string, any> | null = null
    try {
      parsedGuiSettings = JSON.parse(data)
    } catch {}
    let proxy: ProxyReconcileResult = { state: 'not-needed' }
    if (parsedGuiSettings && typeof parsedGuiSettings === 'object') {
      proxy = await reconcileProxyWithSettings(parsedGuiSettings)
    }

    return { success: true, proxy }
  } catch (err: any) {
    error('Settings', 'Failed to save GUI settings', err)
    return { success: false, error: String(err) }
  }
}

export function registerSettingsIPCHandlers(): void {
  ipcMain.handle('settings:saveGuiSettings', (_event, data: string) =>
    enqueueSettingsSave(() => applyGuiSettingsSave(data)),
  )

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

  // ── Profiles ──────────────────────────────────────────────────

  ipcMain.handle('profiles:load', async () => {
    try {
      const p = getProfilesPath()
      if (existsSync(p)) {
        const raw = readFileSync(p, 'utf-8')
        return { success: true, data: raw }
      }
      return { success: true, data: null }
    } catch (err: any) {
      error('Profiles', 'Failed to load profiles', err)
      return { success: false, data: null, error: String(err) }
    }
  })

  ipcMain.handle('profiles:save', async (_event, data: string) => {
    try {
      const p = getProfilesPath()
      const dir = dirname(p)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(p, data, 'utf-8')
      chmodSync(p, 0o600)
      debug('Profiles', `Profiles saved to ${p}`)
      return { success: true }
    } catch (err: any) {
      error('Profiles', 'Failed to save profiles', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('profiles:backupCorrupt', async (_event, data: string) => {
    try {
      const p = getProfilesPath()
      const dir = dirname(p)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const backupPath = join(dir, `profiles.json.corrupt-${Date.now()}`)
      writeFileSync(backupPath, data, 'utf-8')
      debug('Profiles', `Corrupt profiles backed up to ${backupPath}`)
      return { success: true, backupPath }
    } catch (err: any) {
      error('Profiles', 'Failed to backup corrupt profiles', err)
      return { success: false, error: String(err) }
    }
  })

  // ── Token Usage Stats ─────────────────────────────────────────

  ipcMain.handle('stats:getTokenUsage', async () => {
    try {
      return { success: true, data: aggregateLocalTokenStats() }
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to load token usage stats' }
    }
  })

  // ── Hooks Settings ────────────────────────────────────────────

  ipcMain.handle('settings:loadHooksSettings', async (_event, scope: string = 'user', projectRoot?: string) => {
    try {
      const settingsPath = resolveHooksScopePath(scope, projectRoot)
      if (!settingsPath) {
        const message = scopePathError(scope)
        warn('Settings', message)
        return { success: false, data: null, error: message }
      }
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

  ipcMain.handle('settings:saveHooksSettings', async (_event, hooksJson: string, scope: string = 'user', projectRoot?: string) => {
    try {
      const settingsPath = resolveHooksScopePath(scope, projectRoot)
      if (!settingsPath) {
        const message = scopePathError(scope)
        warn('Settings', message)
        return { success: false, error: message }
      }
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

  ipcMain.handle('settings:getBuiltinHooksRoot', async () => {
    try {
      const devPath = resolve(join(__dirname, '..', '..', 'resources', 'builtin-hooks'))
      if (existsSync(devPath)) {
        return { success: true, path: devPath }
      }
      const prodPath = join(process.resourcesPath, 'builtin-hooks')
      if (existsSync(prodPath)) {
        return { success: true, path: prodPath }
      }
      return { success: false, error: 'Builtin hooks directory not found' }
    } catch (err: any) {
      error('Settings', 'Failed to resolve builtin hooks root', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('settings:checkNode', async () => {
    try {
      const { spawnSync } = await import('child_process')
      const result = spawnSync('node', ['--version'], {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 5000,
      })
      if (result.error || result.status !== 0) {
        return { success: false, error: 'node command not found in PATH' }
      }
      const version = String(result.stdout || '').trim()
      return { success: true, version }
    } catch (err: any) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('settings:injectGuiModels', async (_event, models: { primaryModel: string; haikuModel?: string; sonnetModel?: string; opusModel?: string; effortLevel?: EffortLevel; permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' }) => {
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

      // 单向导出给 CLI 的偏好副本，UI 不从这儿回读：CLI 读取侧会有意丢掉 max（对外部用户
      // 它是 session-scoped），把它当档位的真相会让界面显示一个从没生效的值。
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
}


