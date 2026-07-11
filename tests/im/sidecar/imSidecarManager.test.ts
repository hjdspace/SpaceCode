import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getImSidecarManager, ImSidecarManager } from '@electron/imSidecarManager'

// Mock ImServer to avoid starting a real server
vi.mock('@electron/imServer/imServer', () => ({
  ImServer: vi.fn().mockImplementation(function () {
    return {
      start: vi.fn().mockResolvedValue({ port: 12345, host: '127.0.0.1' }),
      stop: vi.fn(),
      getPort: vi.fn().mockReturnValue(12345),
    }
  }),
}))

// Mock config to avoid file system access
vi.mock('@electron/im/adapters/common/config', () => ({
  loadConfig: vi.fn().mockReturnValue({
    serverUrl: 'ws://127.0.0.1:3456',
    defaultProjectDir: '/tmp/test',
    pairing: { code: null, expiresAt: null, createdAt: null },
    telegram: { botToken: 'test-token', allowedUsers: [], pairedUsers: [], defaultWorkDir: '' },
    feishu: { appId: '', appSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', streamingCard: false },
    dingtalk: { clientId: '', clientSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', endpoint: '', permissionCardTemplateId: '' },
    wechat: { accountId: '', botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', baseUrl: '', userId: '' },
    whatsapp: { accountJid: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', authDir: '' },
  }),
  saveConfig: vi.fn(),
}))

// Mock logger
vi.mock('@electron/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// Mock child_process.spawn — use importOriginal to preserve named exports
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    spawn: vi.fn().mockReturnValue({
      pid: 12345,
      killed: false,
      exitCode: null,
      on: vi.fn(),
      kill: vi.fn(),
    }),
  }
})

describe('ImSidecarManager', () => {
  let manager: ImSidecarManager

  beforeEach(() => {
    manager = new ImSidecarManager()
  })

  afterEach(() => {
    manager.destroy()
  })

  describe('Server management', () => {
    it('should start the IM server', async () => {
      const result = await manager.startServer()

      expect(result.port).toBeGreaterThan(0)
      expect(result.host).toBe('127.0.0.1')
    })

    it('should report server as running after start', async () => {
      await manager.startServer()

      const status = manager.getServerStatus()
      expect(status.running).toBe(true)
      expect(status.port).toBeGreaterThan(0)
    })

    it('should report server as not running before start', () => {
      const status = manager.getServerStatus()
      expect(status.running).toBe(false)
    })

    it('should stop the server', async () => {
      await manager.startServer()
      manager.stopServer()

      const status = manager.getServerStatus()
      expect(status.running).toBe(false)
    })
  })

  describe('Adapter management', () => {
    it('should reject starting adapter when server is not running', async () => {
      await expect(manager.startAdapter('telegram')).rejects.toThrow('IM Server must be started')
    })

    it('should start adapter after server is running', async () => {
      await manager.startServer()
      await manager.startAdapter('telegram')

      const status = manager.getAdapterStatus('telegram')
      expect(status.running).toBe(true)
      expect(status.pid).toBeDefined()
    })

    it('should stop an adapter', async () => {
      await manager.startServer()
      await manager.startAdapter('telegram')
      manager.stopAdapter('telegram')

      const status = manager.getAdapterStatus('telegram')
      expect(status.running).toBe(false)
    })

    it('should get all adapter statuses', async () => {
      const statuses = manager.getAllAdapterStatuses()
      expect(statuses.telegram).toBeDefined()
      expect(statuses.feishu).toBeDefined()
      expect(statuses.dingtalk).toBeDefined()
      expect(statuses.wechat).toBeDefined()
      expect(statuses.whatsapp).toBeDefined()
    })
  })

  describe('Pairing management', () => {
    it('should generate a 6-character pairing code', () => {
      const { code } = manager.generatePairingCode()

      expect(code).toHaveLength(6)
      expect(code).toMatch(/^[A-Z2-9]+$/)
    })

    it('should generate different codes each time', () => {
      const { code: code1 } = manager.generatePairingCode()
      const { code: code2 } = manager.generatePairingCode()
      expect(code1).not.toBe(code2)
    })

    it('should set expiry time 60 minutes from now', () => {
      const before = Date.now()
      const { expiresAt } = manager.generatePairingCode()
      const after = Date.now()

      const minExpiry = before + 59 * 60 * 1000
      const maxExpiry = after + 61 * 60 * 1000
      expect(expiresAt).toBeGreaterThan(minExpiry)
      expect(expiresAt).toBeLessThan(maxExpiry)
    })
  })

  describe('createServerPlan', () => {
    it('should create a plan with an available port', async () => {
      const plan = await manager.createServerPlan()

      expect(plan.port).toBeGreaterThan(0)
      expect(plan.host).toBe('127.0.0.1')
    })
  })

  describe('createAdapterPlan', () => {
    it('should create a plan with correct environment variables', async () => {
      await manager.startServer()
      const config = manager.getAdapterConfig()
      const plan = await manager.createAdapterPlan('telegram', config)

      expect(plan.platform).toBe('telegram')
      expect(plan.port).toBeGreaterThan(0)
      expect(plan.env.ADAPTER_SERVER_URL).toContain('ws://127.0.0.1:')
      expect(plan.env.TELEGRAM_BOT_TOKEN).toBe('test-token')
    })
  })
})
