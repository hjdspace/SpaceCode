import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getImSidecarManager, ImSidecarManager } from '@electron/imSidecarManager'
import { loadConfig, saveConfig } from '@electron/im/adapters/common/config'

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
  // Pass-through desensitize for tests — real desensitization is tested in imServer tests
  desensitizeConfig: vi.fn((config: unknown) => config),
}))

// Mock logger
vi.mock('@electron/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

// ── Mock all adapter & bot classes (in-process) ──────────────────────────
// Each mock returns a class with start()/stop() that resolve immediately.

const mockAdapterInstance = () => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
})

vi.mock('@electron/im/adapters/telegram/telegramBot', () => ({
  TelegramBot: vi.fn().mockImplementation(function () { return { mockBot: true } }),
}))
vi.mock('@electron/im/adapters/telegram/telegramAdapter', () => ({
  TelegramAdapter: vi.fn().mockImplementation(function () { return mockAdapterInstance() }),
}))
vi.mock('@electron/im/adapters/feishu/feishuBot', () => ({
  FeishuBot: vi.fn().mockImplementation(function () { return { mockBot: true } }),
}))
vi.mock('@electron/im/adapters/feishu/feishuAdapter', () => ({
  FeishuAdapter: vi.fn().mockImplementation(function () { return mockAdapterInstance() }),
}))
vi.mock('@electron/im/adapters/dingtalk/dingtalkBot', () => ({
  DingtalkBot: vi.fn().mockImplementation(function () { return { mockBot: true } }),
}))
vi.mock('@electron/im/adapters/dingtalk/dingtalkAdapter', () => ({
  DingtalkAdapter: vi.fn().mockImplementation(function () { return mockAdapterInstance() }),
}))
vi.mock('@electron/im/adapters/wechat/wechatBot', () => ({
  WechatBot: vi.fn().mockImplementation(function () { return { mockBot: true } }),
}))
vi.mock('@electron/im/adapters/wechat/wechatAdapter', () => ({
  WechatAdapter: vi.fn().mockImplementation(function () { return mockAdapterInstance() }),
}))
vi.mock('@electron/im/adapters/whatsapp/whatsappBot', () => ({
  WhatsappBot: vi.fn().mockImplementation(function () { return { mockBot: true } }),
}))
vi.mock('@electron/im/adapters/whatsapp/whatsappAdapter', () => ({
  WhatsappAdapter: vi.fn().mockImplementation(function () { return mockAdapterInstance() }),
}))

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
      expect(status.startedAt).toBeDefined()
    })

    it('should reject starting adapter when platform is not configured', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        serverUrl: 'ws://127.0.0.1:3456',
        defaultProjectDir: '/tmp/test',
        pairing: { code: null, expiresAt: null, createdAt: null },
        telegram: { botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '' },
        feishu: { appId: '', appSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', streamingCard: false },
        dingtalk: { clientId: '', clientSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', endpoint: '', permissionCardTemplateId: '' },
        wechat: { accountId: '', botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', baseUrl: '', userId: '' },
        whatsapp: { accountJid: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', authDir: '' },
      })

      await manager.startServer()
      await expect(manager.startAdapter('telegram')).rejects.toThrow('not configured')
    })

    it('should stop an adapter', async () => {
      await manager.startServer()
      await manager.startAdapter('telegram')
      manager.stopAdapter('telegram')

      const status = manager.getAdapterStatus('telegram')
      expect(status.running).toBe(false)
    })

    it('should warn when starting an already-running adapter', async () => {
      await manager.startServer()
      await manager.startAdapter('telegram')

      // Second start should be a no-op (just warns)
      await manager.startAdapter('telegram')

      const status = manager.getAdapterStatus('telegram')
      expect(status.running).toBe(true)
    })

    it('should get all adapter statuses', async () => {
      const statuses = manager.getAllAdapterStatuses()
      expect(statuses.telegram).toBeDefined()
      expect(statuses.feishu).toBeDefined()
      expect(statuses.dingtalk).toBeDefined()
      expect(statuses.wechat).toBeDefined()
      expect(statuses.whatsapp).toBeDefined()
    })

    it('should start wechat adapter after QR login binding', async () => {
      vi.mocked(loadConfig).mockReturnValueOnce({
        serverUrl: 'ws://127.0.0.1:3456',
        defaultProjectDir: '/tmp/test',
        pairing: { code: null, expiresAt: null, createdAt: null },
        telegram: { botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '' },
        feishu: { appId: '', appSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', streamingCard: false },
        dingtalk: { clientId: '', clientSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', endpoint: '', permissionCardTemplateId: '' },
        wechat: { accountId: 'acc-1', botToken: 'tok-1', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', baseUrl: 'https://test.com', userId: 'user-1' },
        whatsapp: { accountJid: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', authDir: '' },
      })

      await manager.startServer()
      await manager.startAdapter('wechat')

      const status = manager.getAdapterStatus('wechat')
      expect(status.running).toBe(true)
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

  describe('WeChat QR Login', () => {
    const mockFetch = vi.fn()

    beforeEach(() => {
      // Reset fetch mock
      mockFetch.mockReset()
      global.fetch = mockFetch as unknown as typeof fetch

      // Reset config mock to default (unbound state)
      vi.mocked(loadConfig).mockReturnValue({
        serverUrl: 'ws://127.0.0.1:3456',
        defaultProjectDir: '/tmp/test',
        pairing: { code: null, expiresAt: null, createdAt: null },
        telegram: { botToken: 'test-token', allowedUsers: [], pairedUsers: [], defaultWorkDir: '' },
        feishu: { appId: '', appSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', streamingCard: false },
        dingtalk: { clientId: '', clientSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', endpoint: '', permissionCardTemplateId: '' },
        wechat: { accountId: '', botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', baseUrl: 'https://ilinkai.weixin.qq.com', userId: '' },
        whatsapp: { accountJid: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', authDir: '' },
      })
    })

    it('should start QR login and return qrcodeUrl and qrcodeId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          qrcode: 'test-qrcode-id',
          qrcode_img_content: 'https://example.com/qr',
        }),
      })

      const result = await manager.startWechatQrLogin()

      expect(result.qrcodeId).toBe('test-qrcode-id')
      expect(result.qrcodeUrl).toBe('https://example.com/qr')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/ilink/bot/get_bot_qrcode?bot_type=3'),
      )
    })

    it('should throw when QR login API returns HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      })

      await expect(manager.startWechatQrLogin()).rejects.toThrow('HTTP 500')
    })

    it('should throw when QR code is missing from response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ qrcode_img_content: 'https://example.com/qr' }),
      })

      await expect(manager.startWechatQrLogin()).rejects.toThrow('No qrcode')
    })

    it('should return waiting status for wait response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'wait' }),
      })

      const result = await manager.checkWechatQrStatus('test-id')

      expect(result.status).toBe('waiting')
    })

    it('should return scanned status for scaned response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'scaned' }),
      })

      const result = await manager.checkWechatQrStatus('test-id')

      expect(result.status).toBe('scanned')
    })

    it('should return expired status for expired response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'expired' }),
      })

      const result = await manager.checkWechatQrStatus('test-id')

      expect(result.status).toBe('expired')
    })

    it('should return confirmed status and save credentials on confirmed', async () => {
      const mockConfig = {
        serverUrl: 'ws://127.0.0.1:3456',
        defaultProjectDir: '/tmp/test',
        pairing: { code: null, expiresAt: null, createdAt: null },
        telegram: { botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '' },
        feishu: { appId: '', appSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', streamingCard: false },
        dingtalk: { clientId: '', clientSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', endpoint: '', permissionCardTemplateId: '' },
        wechat: { accountId: '', botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', baseUrl: 'https://ilinkai.weixin.qq.com', userId: '' },
        whatsapp: { accountJid: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', authDir: '' },
      }
      vi.mocked(loadConfig).mockReturnValue(mockConfig)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'confirmed',
          bot_token: 'bot-token-123',
          ilink_bot_id: 'account-123',
          baseurl: 'https://gw.weixin.qq.com',
          ilink_user_id: 'user-123',
        }),
      })

      const result = await manager.checkWechatQrStatus('test-id')

      expect(result.status).toBe('confirmed')
      expect(result.accountId).toBe('account-123')
      expect(result.botToken).toBe('bot-token-123')
      expect(result.baseUrl).toBe('https://gw.weixin.qq.com')
      expect(result.userId).toBe('user-123')

      // Verify credentials were saved
      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          wechat: expect.objectContaining({
            accountId: 'account-123',
            botToken: 'bot-token-123',
            baseUrl: 'https://gw.weixin.qq.com',
            userId: 'user-123',
          }),
        }),
      )
    })

    it('should clear wechat credentials on unbind', () => {
      const mockConfig = {
        serverUrl: 'ws://127.0.0.1:3456',
        defaultProjectDir: '/tmp/test',
        pairing: { code: null, expiresAt: null, createdAt: null },
        telegram: { botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '' },
        feishu: { appId: '', appSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', streamingCard: false },
        dingtalk: { clientId: '', clientSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', endpoint: '', permissionCardTemplateId: '' },
        wechat: {
          accountId: 'account-123',
          botToken: 'bot-token-123',
          allowedUsers: ['user1'],
          pairedUsers: [{ userId: 'user1', pairedAt: 123 }],
          defaultWorkDir: '/tmp',
          baseUrl: 'https://ilinkai.weixin.qq.com',
          userId: 'user-123',
        },
        whatsapp: { accountJid: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', authDir: '' },
      }
      vi.mocked(loadConfig).mockReturnValue(mockConfig)

      manager.unbindWechat()

      expect(saveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          wechat: expect.objectContaining({
            accountId: '',
            botToken: '',
            userId: '',
            allowedUsers: [],
            pairedUsers: [],
            baseUrl: 'https://ilinkai.weixin.qq.com',
            defaultWorkDir: '/tmp',
          }),
        }),
      )
    })

    it('should report as not bound when accountId is empty', () => {
      vi.mocked(loadConfig).mockReturnValue({
        serverUrl: 'ws://127.0.0.1:3456',
        defaultProjectDir: '/tmp/test',
        pairing: { code: null, expiresAt: null, createdAt: null },
        telegram: { botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '' },
        feishu: { appId: '', appSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', streamingCard: false },
        dingtalk: { clientId: '', clientSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', endpoint: '', permissionCardTemplateId: '' },
        wechat: { accountId: '', botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', baseUrl: '', userId: '' },
        whatsapp: { accountJid: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', authDir: '' },
      })

      expect(manager.isWechatBound()).toBe(false)
    })

    it('should report as bound when accountId and botToken are set', () => {
      vi.mocked(loadConfig).mockReturnValue({
        serverUrl: 'ws://127.0.0.1:3456',
        defaultProjectDir: '/tmp/test',
        pairing: { code: null, expiresAt: null, createdAt: null },
        telegram: { botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '' },
        feishu: { appId: '', appSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', streamingCard: false },
        dingtalk: { clientId: '', clientSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', endpoint: '', permissionCardTemplateId: '' },
        wechat: { accountId: 'acc-123', botToken: 'tok-123', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', baseUrl: '', userId: '' },
        whatsapp: { accountJid: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', authDir: '' },
      })

      expect(manager.isWechatBound()).toBe(true)
    })

    it('should use default base URL when config has empty baseUrl', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        serverUrl: 'ws://127.0.0.1:3456',
        defaultProjectDir: '/tmp/test',
        pairing: { code: null, expiresAt: null, createdAt: null },
        telegram: { botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '' },
        feishu: { appId: '', appSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', streamingCard: false },
        dingtalk: { clientId: '', clientSecret: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', endpoint: '', permissionCardTemplateId: '' },
        wechat: { accountId: '', botToken: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', baseUrl: '', userId: '' },
        whatsapp: { accountJid: '', allowedUsers: [], pairedUsers: [], defaultWorkDir: '', authDir: '' },
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ qrcode: 'id', qrcode_img_content: 'url' }),
      })

      await manager.startWechatQrLogin()

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://ilinkai.weixin.qq.com'),
      )
    })
  })

  describe('Singleton', () => {
    it('should return the same instance', () => {
      const a = getImSidecarManager()
      const b = getImSidecarManager()
      expect(a).toBe(b)
    })
  })
})
