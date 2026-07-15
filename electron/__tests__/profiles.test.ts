import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

// Mock electron 模块（main.ts 依赖 app.getPath / app.isPackaged / app.whenReady 等）
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => os.tmpdir()),
    isPackaged: false,
    setAppUserModelId: vi.fn(),
    commandLine: { appendSwitch: vi.fn() },
    whenReady: vi.fn(() => new Promise(() => {})), // 永不 resolve，避免 whenReady 回调副作用
    on: vi.fn(),
    quit: vi.fn(),
    getAppPath: vi.fn(() => os.tmpdir()),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: {},
  Menu: {},
  Tray: {},
  nativeImage: {},
  shell: {},
  dialog: {},
  net: {},
  globalShortcut: {},
}))

// Mock 其他 main.ts 启动依赖，避免副作用
vi.mock('../terminalManager', () => ({ TerminalManager: class {} }))
vi.mock('../logger', () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
  initLogger: vi.fn(), isDebugMode: vi.fn(() => false),
  ipc: {}, traceEvent: vi.fn(), listDebugFiles: vi.fn(() => []),
  readDebugFile: vi.fn(), listTraceSessions: vi.fn(() => []),
  readTraceEvents: vi.fn(() => []), getTraceDir: vi.fn(),
}))
vi.mock('dotenv', () => ({ config: vi.fn() }))
vi.mock('../gitService', () => ({ registerGitIPCHandlers: vi.fn() }))
vi.mock('../skillsService', () => ({
  registerSkillsIPCHandlers: vi.fn(),
  registerLocalLibraryIPCHandlers: vi.fn(),
}))
vi.mock('../agentsService', () => ({ registerAgentsIPCHandlers: vi.fn() }))
vi.mock('../artifactsService', () => ({
  registerArtifactsIPCHandlers: vi.fn(),
  stopArtifactsWatch: vi.fn(),
}))
vi.mock('../cronService', () => ({ registerCronIPCHandlers: vi.fn() }))
vi.mock('../officeCliService', () => ({
  registerOfficeCliIPCHandlers: vi.fn(),
  cleanupOfficeCli: vi.fn(),
  ensureOfficeCliInstalled: vi.fn(),
}))
vi.mock('../cuaDriverService', () => ({
  registerCuaDriverIPCHandlers: vi.fn(),
  cleanupCuaDriverMcp: vi.fn(),
}))
vi.mock('../browserUseService', () => ({
  registerBrowserUseIPCHandlers: vi.fn(),
  cleanupBrowserUseMcp: vi.fn(),
}))
vi.mock('../claudeCodeIPC', () => ({
  registerClaudeCodeIPC: vi.fn(),
  setMainWindow: vi.fn(),
  getPool: vi.fn(() => null),
}))
vi.mock('../autoUpdaterService', () => ({
  initAutoUpdater: vi.fn(),
  registerAutoUpdaterIPC: vi.fn(),
  destroyAutoUpdater: vi.fn(),
  installUpdateOnQuit: vi.fn(),
}))
vi.mock('../mobileServer', () => ({ MobileServer: class {} }))
vi.mock('../h5Server', () => ({ H5Server: class {} }))
vi.mock('../h5AuthService', () => ({ H5AuthService: class {} }))
vi.mock('../themeSyncBuilder', () => ({ buildThemeSyncData: vi.fn() }))
vi.mock('../promptOptimizerIPC', () => ({ registerPromptOptimizerIPC: vi.fn() }))
vi.mock('../design/designService', () => ({ registerDesignIPCHandlers: vi.fn() }))
vi.mock('../tokenStatsService', () => ({ aggregateLocalTokenStats: vi.fn() }))
vi.mock('../proxyManager', () => ({ proxyManager: { stop: vi.fn() } }))
vi.mock('../rtkManager', () => ({ rtkManager: {} }))
vi.mock('../imSidecarManager', () => ({ getImSidecarManager: vi.fn() }))
vi.mock('../petFileService', () => ({ PetFileService: class {} }))
vi.mock('../petLLMProxy', () => ({ PetLLMProxy: class {} }))
vi.mock('../petWindowManager', () => ({ PetWindowManager: class {} }))
vi.mock('../petIpcHandlers', () => ({ registerPetIpcHandlers: vi.fn() }))

import { app, ipcMain } from 'electron'

// 捕获 ipcMain.handle 注册的回调
const ipcHandlers: Record<string, (...args: any[]) => any> = {}

beforeAll(async () => {
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: any) => {
    ipcHandlers[channel] = handler
  })
  // 动态导入 main.ts，触发顶层 ipcMain.handle 注册
  await import('../main')
})

// 每个测试用独立的临时 .spacecode 目录
let tmpHome: string
beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-test-'))
  vi.mocked(app.getPath).mockReturnValue(tmpHome)
})
afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

describe('profiles IPC handlers', () => {
  describe('profiles:load', () => {
    it('文件不存在时返回 data: null', async () => {
      const result = await ipcHandlers['profiles:load']()
      expect(result).toEqual({ success: true, data: null })
    })

    it('文件存在时返回内容', async () => {
      const dir = path.join(tmpHome, '.spacecode')
      fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, 'profiles.json')
      const content = JSON.stringify({ version: 1, activeProfileId: 'x', profiles: [] })
      fs.writeFileSync(filePath, content, 'utf-8')

      const result = await ipcHandlers['profiles:load']()
      expect(result.success).toBe(true)
      expect(result.data).toBe(content)
    })

    it('读取异常时返回 success: false', async () => {
      // 在 profiles.json 路径创建目录，使 readFileSync 抛出 EISDIR
      const dir = path.join(tmpHome, '.spacecode')
      fs.mkdirSync(dir, { recursive: true })
      fs.mkdirSync(path.join(dir, 'profiles.json'), { recursive: true })

      const result = await ipcHandlers['profiles:load']()
      expect(result.success).toBe(false)
      expect(result.data).toBeNull()
      expect(result.error).toBeTruthy()
    })
  })

  describe('profiles:save', () => {
    it('写入文件并设置权限 0600', async () => {
      const data = JSON.stringify({ version: 1, activeProfileId: 'x', profiles: [] })
      const result = await ipcHandlers['profiles:save']({}, data)

      expect(result.success).toBe(true)
      const filePath = path.join(tmpHome, '.spacecode', 'profiles.json')
      expect(fs.existsSync(filePath)).toBe(true)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe(data)

      // 验证权限 0600（Windows 上 chmod 行为有限，仅验证调用不抛错）
      if (process.platform !== 'win32') {
        const stat = fs.statSync(filePath)
        const mode = stat.mode & 0o777
        expect(mode).toBe(0o600)
      }
    })

    it('目录不存在时自动创建', async () => {
      const data = '{}'
      const result = await ipcHandlers['profiles:save']({}, data)
      expect(result.success).toBe(true)
      expect(fs.existsSync(path.join(tmpHome, '.spacecode', 'profiles.json'))).toBe(true)
    })

    it('写入异常时返回 success: false', async () => {
      // 在 profiles.json 路径创建目录，使 writeFileSync 抛出 EISDIR
      const dir = path.join(tmpHome, '.spacecode')
      fs.mkdirSync(dir, { recursive: true })
      fs.mkdirSync(path.join(dir, 'profiles.json'), { recursive: true })

      const result = await ipcHandlers['profiles:save']({}, '{}')
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  describe('profiles:backupCorrupt', () => {
    it('备份损坏文件到 .corrupt-{timestamp} 路径', async () => {
      const result = await ipcHandlers['profiles:backupCorrupt']({}, 'corrupt-data')

      expect(result.success).toBe(true)
      expect(result.backupPath).toBeTruthy()
      expect(fs.existsSync(result.backupPath)).toBe(true)
      expect(fs.readFileSync(result.backupPath, 'utf-8')).toBe('corrupt-data')
    })
  })
})
