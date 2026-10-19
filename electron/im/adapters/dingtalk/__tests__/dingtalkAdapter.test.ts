// @vitest-environment node
/**
 * DingtalkAdapter — main-process tests for the event-handling chain.
 *
 * Mocked seams (mirrors electron/im/adapters/feishu/__tests__/feishuAdapter.test.ts):
 * - WsBridge: captured per-instance doubles, handlers map drives handleServerMessage
 * - HttpClient / SessionStore: per-instance vi.fn doubles
 * - config: no fs access; saveConfig calls are asserted
 * - logger / DingtalkStreamState / DingtalkMediaHandler: module doubles
 * Real modules: MessageDedup, ChatQueue, SessionRecovery, Pairing,
 * DingtalkPermissionCard (AI card + text fallback), commands, format, permission.
 *
 * DingTalk specifics covered here:
 * - chatId === senderId (no separate chat/user keys like Telegram)
 * - all replies go through msg.sessionWebhook, stored per handleEvent and
 *   dropped silently once expired (72h detection)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DingtalkAdapter } from '@electron/im/adapters/dingtalk/dingtalkAdapter'
import type { DingtalkBot, DingtalkMessage } from '@electron/im/adapters/dingtalk/dingtalkBot'
import { saveConfig } from '@electron/im/adapters/common/config'
import type { AdapterConfig } from '@electron/im/adapters/common/config'
import type { MessageHandler, SessionBinding } from '@electron/im/adapters/common/types'

// Callable mock surface for the captured test doubles (vitest's Mock union type
// returned by ReturnType<typeof vi.fn> is not directly callable under vue-tsc).
interface MockFn {
  (...args: unknown[]): unknown
  mock: { calls: unknown[][] }
  mockClear(): void
  mockReset(): void
  mockResolvedValue(value: unknown): void
  mockResolvedValueOnce(value: unknown): void
  mockRejectedValue(error: unknown): void
  mockRejectedValueOnce(error: unknown): void
  mockReturnValue(value: unknown): void
  mockImplementation(fn: (...args: unknown[]) => unknown): void
}

const wsBridgeInstances: unknown[] = []
const streamStateInstances: unknown[] = []

vi.mock('@electron/im/adapters/common/ws-bridge', () => {
  return {
    WsBridge: class MockWsBridge {
      serverUrl: string
      authToken?: string
      handlers = new Map<string, MessageHandler>()
      startHeartbeat = vi.fn()
      stopHeartbeat = vi.fn()
      onServerMessage = vi.fn((chatId: string, handler: MessageHandler) => {
        this.handlers.set(chatId, handler)
      })
      sendUserMessage = vi.fn()
      sendPermissionResponse = vi.fn()
      sendStopGeneration = vi.fn()
      getSessionId = vi.fn((): string | null => null)
      isConnected = vi.fn((): boolean => false)
      connectSession = vi.fn(async () => {})
      resetSession = vi.fn()
      destroy = vi.fn()

      constructor(opts: { serverUrl: string; authToken?: string }) {
        this.serverUrl = opts.serverUrl
        this.authToken = opts.authToken
        wsBridgeInstances.push(this)
      }
    },
  }
})

vi.mock('@electron/im/adapters/common/http-client', () => {
  return {
    HttpClient: class MockHttpClient {
      createSession = vi.fn(async (_workDir: string) => ({
        sessionId: 'sess-new-123456789',
        token: 'tok-new-1',
      }))
      sessionExists = vi.fn(async (_sessionId: string) => true)
      listRecentProjects = vi.fn(async (): Promise<Array<{ name: string; path: string }>> => [])
      matchProject = vi.fn((_query: string, _projects: Array<{ name: string; path: string }>) => null)
      constructor(_opts: { baseUrl: string; allowedProjectRoots?: string[] }) {}
    },
    HttpError: class MockHttpError extends Error {},
  }
})

vi.mock('@electron/im/adapters/common/session-store', () => {
  return {
    SessionStore: class MockSessionStore {
      data = new Map<string, SessionBinding>()
      get = vi.fn((chatId: string): SessionBinding | null => this.data.get(chatId) ?? null)
      set = vi.fn((chatId: string, binding: SessionBinding): void => {
        this.data.set(chatId, binding)
      })
      delete = vi.fn((chatId: string): void => {
        this.data.delete(chatId)
      })
      constructor(_opts?: { filePath?: string }) {}
    },
  }
})

vi.mock('@electron/im/adapters/dingtalk/streamState', () => {
  return {
    DingtalkStreamState: class MockStreamState {
      webhook: string
      templateId: string
      append = vi.fn()
      complete = vi.fn(async () => {})
      reset = vi.fn()
      isWebhookExpired = vi.fn((): boolean => false)

      constructor(_bot: unknown, webhook: string, templateId: string) {
        this.webhook = webhook
        this.templateId = templateId
        streamStateInstances.push(this)
      }
    },
  }
})

vi.mock('@electron/im/adapters/dingtalk/mediaHandler', () => {
  return {
    DingtalkMediaHandler: class MockMediaHandler {
      downloadFile = vi.fn(async () => null)
      toAttachmentRef = vi.fn(() => ({}))
      constructor(_bot: unknown, _destDir: string) {}
    },
  }
})

vi.mock('@electron/im/adapters/common/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    setLevel: vi.fn(),
  })),
}))

vi.mock('@electron/im/adapters/common/config', () => ({
  loadConfig: vi.fn((): AdapterConfig => ({
    serverUrl: 'ws://127.0.0.1:3456',
    defaultProjectDir: '/tmp/proj-default',
    pairing: { code: null, expiresAt: null, createdAt: null },
    telegram: { allowedUsers: [], pairedUsers: [], defaultWorkDir: '', botToken: '' },
    feishu: {
      allowedUsers: [],
      pairedUsers: [],
      defaultWorkDir: '',
      appId: '',
      appSecret: '',
      streamingCard: false,
    },
    dingtalk: {
      allowedUsers: [], pairedUsers: [], defaultWorkDir: '',
      clientId: '', clientSecret: '', endpoint: '', permissionCardTemplateId: '',
    },
    wechat: { allowedUsers: [], pairedUsers: [], defaultWorkDir: '', accountId: '', botToken: '', baseUrl: '', userId: '' },
    whatsapp: { allowedUsers: [], pairedUsers: [], defaultWorkDir: '', accountJid: '', authDir: '' },
  })),
  saveConfig: vi.fn(),
  resolveUserDefaultWorkDir: vi.fn((): string => '/tmp/attachments'),
}))

// ────────────────────────────────────────────────────────────────────────
// Test doubles / helpers
// ────────────────────────────────────────────────────────────────────────

interface BridgeDouble {
  serverUrl: string
  authToken?: string
  handlers: Map<string, MessageHandler>
  startHeartbeat: MockFn
  onServerMessage: MockFn
  sendUserMessage: MockFn
  sendPermissionResponse: MockFn
  sendStopGeneration: MockFn
  getSessionId: MockFn
  isConnected: MockFn
  connectSession: MockFn
  resetSession: MockFn
  destroy: MockFn
}

interface StoreDouble {
  get: MockFn
  set: MockFn
  delete: MockFn
}

interface HttpDouble {
  createSession: MockFn
  sessionExists: MockFn
  listRecentProjects: MockFn
  matchProject: MockFn
}

interface StreamStateDouble {
  webhook: string
  templateId: string
  append: MockFn
  complete: MockFn
  reset: MockFn
  isWebhookExpired: MockFn
}

interface BotDouble {
  getAccessToken: MockFn
  sendTextMessage: MockFn
  sendAiCardMessage: MockFn
}

const USER = 'dt_user_1'
const WEBHOOK = 'https://oapi.dingtalk.com/robot/send?session=wh_1'
const SERVER_URL = 'ws://127.0.0.1:5555'
const DEFAULT_TEMPLATE = '02fcf2f4-2e3a-4de0-9b41-1c4de6a8b53e'

function makeBot(): BotDouble {
  return {
    getAccessToken: vi.fn(async () => 'access-token-1'),
    sendTextMessage: vi.fn(async () => ({})),
    sendAiCardMessage: vi.fn(async () => ({})),
  }
}

let msgSeq = 0

function makeMsg(
  o: {
    text?: string
    msgId?: string
    senderId?: string
    senderNick?: string
    webhook?: string
    /** seconds until the sessionWebhook expires; negative → already expired */
    expiresInSec?: number
  } = {}
): DingtalkMessage {
  msgSeq += 1
  return {
    senderId: o.senderId ?? USER,
    senderNick: o.senderNick ?? 'Alice',
    conversationId: 'cid_1',
    chatbotUserId: 'bot_1',
    msgId: o.msgId ?? `msg_${msgSeq}`,
    text: { content: o.text ?? '' },
    msgtype: 'text',
    sessionWebhook: o.webhook ?? WEBHOOK,
    sessionWebhookExpiredTime: Math.floor(Date.now() / 1000) + (o.expiresInSec ?? 3600),
  }
}

function bridgeOf(adapter: DingtalkAdapter): BridgeDouble {
  return (adapter as unknown as { bridge: BridgeDouble }).bridge
}
function storeOf(adapter: DingtalkAdapter): StoreDouble {
  return (adapter as unknown as { sessionStore: StoreDouble }).sessionStore
}
function httpOf(adapter: DingtalkAdapter): HttpDouble {
  return (adapter as unknown as { httpClient: HttpDouble }).httpClient
}
function streamMapOf(adapter: DingtalkAdapter): Map<string, StreamStateDouble> {
  return (adapter as unknown as { streamStates: Map<string, StreamStateDouble> }).streamStates
}
function webhooksOf(adapter: DingtalkAdapter): Map<string, { webhook: string; expiresAt: number }> {
  return (adapter as unknown as { sessionWebhooks: Map<string, { webhook: string; expiresAt: number }> }).sessionWebhooks
}

function sentText(bot: BotDouble): string[] {
  return bot.sendTextMessage.mock.calls.map((c: unknown[]) => String(c[1]))
}

function lastSent(bot: BotDouble): string {
  const all = sentText(bot)
  return all[all.length - 1] ?? ''
}

const createdAdapters: DingtalkAdapter[] = []

function makeAdapter(bot: BotDouble, config?: AdapterConfig): DingtalkAdapter {
  const adapter = new DingtalkAdapter({
    bot: bot as unknown as DingtalkBot,
    config: config ?? makeConfig(),
    serverUrl: SERVER_URL,
  })
  createdAdapters.push(adapter)
  return adapter
}

function makeConfig(
  o: { pairingCode?: string | null; pairedUserIds?: string[]; workDir?: string; templateId?: string } = {}
): AdapterConfig {
  const pairingCode = o.pairingCode === undefined ? 'TESTCODE' : o.pairingCode
  return {
    serverUrl: 'ws://127.0.0.1:3456',
    defaultProjectDir: '/tmp/proj-default',
    pairing: { code: pairingCode, expiresAt: Date.now() + 3_600_000, createdAt: Date.now() },
    telegram: { allowedUsers: [], pairedUsers: [], defaultWorkDir: '', botToken: '' },
    feishu: {
      allowedUsers: [],
      pairedUsers: [],
      defaultWorkDir: '',
      appId: '',
      appSecret: '',
      streamingCard: false,
    },
    dingtalk: {
      allowedUsers: [],
      pairedUsers: (o.pairedUserIds === undefined ? [USER] : o.pairedUserIds).map((userId) => ({
        userId,
        pairedAt: Date.now(),
      })),
      defaultWorkDir: o.workDir === undefined ? '/tmp/dt-work' : o.workDir,
      clientId: 'cli_test',
      clientSecret: 'secret_test',
      endpoint: 'https://api.dingtalk.com',
      permissionCardTemplateId: o.templateId ?? '',
    },
    wechat: { allowedUsers: [], pairedUsers: [], defaultWorkDir: '', accountId: '', botToken: '', baseUrl: '', userId: '' },
    whatsapp: { allowedUsers: [], pairedUsers: [], defaultWorkDir: '', accountJid: '', authDir: '' },
  }
}

/** Run /new so the server-message handler is registered on the live bridge. */
async function setupSession(
  bot: BotDouble,
  config?: AdapterConfig
): Promise<{ adapter: DingtalkAdapter; bridge: BridgeDouble; handler: MessageHandler }> {
  const adapter = makeAdapter(bot, config)
  await adapter.handleEvent(makeMsg({ text: '/new', msgId: 'msg_setup_new' }))
  const bridge = bridgeOf(adapter)
  const handler = bridge.handlers.get(USER)
  if (!handler) throw new Error('onServerMessage handler was not registered by createSession')
  bridge.sendUserMessage.mockClear()
  bridge.sendPermissionResponse.mockClear()
  bridge.resetSession.mockClear()
  bot.sendTextMessage.mockClear()
  return { adapter, bridge, handler }
}

// Root hooks: fresh mock state + guaranteed adapter teardown for every suite.
beforeEach(() => {
  vi.clearAllMocks()
  wsBridgeInstances.length = 0
  streamStateInstances.length = 0
  msgSeq = 0
})

afterEach(async () => {
  for (const adapter of createdAdapters) {
    await adapter.stop()
  }
  createdAdapters.length = 0
  vi.useRealTimers()
})

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('DingtalkAdapter — handleEvent entry', () => {
  it('dedups repeated msgId and processes it exactly once', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    const message = makeMsg({ text: '/health', msgId: 'msg_dup' })

    await adapter.handleEvent(message)
    await adapter.handleEvent(message)

    expect(sentText(bot)).toEqual(['✅ 适配器运行正常'])
  })

  it('stores the sessionWebhook per senderId and replies through it', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    const webhook = 'https://oapi.dingtalk.com/robot/send?session=custom'

    await adapter.handleEvent(makeMsg({ text: '/health', webhook }))

    expect(bot.sendTextMessage).toHaveBeenCalledWith(webhook, '✅ 适配器运行正常')
    expect(webhooksOf(adapter).get(USER)).toMatchObject({ webhook })
  })

  it('silently drops commands once the sessionWebhook is expired (72h detection)', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.handleEvent(makeMsg({ text: '/health', expiresInSec: -100 }))

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })

  it('silently drops plain messages once the sessionWebhook is expired — no session is created', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.handleEvent(makeMsg({ text: '你好', expiresInSec: -100 }))

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })
})

describe('DingtalkAdapter — command parsing & routing', () => {
  it('/help sends the formatted command list', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.handleEvent(makeMsg({ text: '/help' }))

    const help = lastSent(bot)
    expect(help).toContain('📋 可用命令')
    expect(help).toContain('/new')
    expect(bot.sendTextMessage).toHaveBeenCalledTimes(1)
  })

  it('unknown slash commands are not intercepted and reach the engine as chat text', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(USER, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await adapter.handleEvent(makeMsg({ text: '/foobar arg' }))

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '/foobar arg')
  })

  it('/stop signals stop-generation on the bridge and confirms to the user', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.handleEvent(makeMsg({ text: '/stop' }))

    expect(bridgeOf(adapter).sendStopGeneration).toHaveBeenCalledWith(USER)
    expect(lastSent(bot)).toBe('⏹️ 已请求停止生成')
  })

  it('/status formats the idle session state with the stored work dir', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(USER, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await adapter.handleEvent(makeMsg({ text: '/status' }))

    const status = lastSent(bot)
    expect(status).toContain('💤 会话状态: idle')
    expect(status).toContain('🆔 Session: N/A')
    expect(status).toContain('📁 目录: /tmp/stored-work')
  })

  it('answers static informational commands with their fixed copy', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    const expected: Array<[string, string]> = [
      ['/resume', '📋 恢复会话功能: 使用 /new 创建新会话'],
      ['/provider', '🔧 Provider 切换功能需要桌面端配置'],
      ['/model', '🔧 模型切换功能需要桌面端配置'],
      ['/skills', '📋 技能列表功能需要桌面端配置'],
      ['/cancel', '✅ 已取消当前操作'],
      ['/health', '✅ 适配器运行正常'],
    ]
    for (const [command] of expected) {
      await adapter.handleEvent(makeMsg({ text: command }))
    }

    expect(sentText(bot).slice(-expected.length)).toEqual(expected.map(([, copy]) => copy))
  })
})

describe('DingtalkAdapter — pairing gate & commands', () => {
  it('routes an unpaired plain-text user into pairing and never reaches the engine', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairedUserIds: [] }))

    await adapter.handleEvent(makeMsg({ text: 'hello there', senderId: 'dt_stranger' }))

    expect(lastSent(bot)).toBe('❌ 配对码不正确') // mismatch against TESTCODE
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })

  it('allowedUsers whitelist grants access without pairing', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    config.dingtalk.allowedUsers = ['dt_allowed']
    const adapter = makeAdapter(bot, config)
    storeOf(adapter).set('dt_allowed', { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await adapter.handleEvent(makeMsg({ text: '在吗', senderId: 'dt_allowed' }))

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith('dt_allowed', '在吗')
    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
  })

  it('/pair without args replies with usage and does not persist config', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairedUserIds: [] }))

    await adapter.handleEvent(makeMsg({ text: '/pair', senderId: 'dt_new' }))

    expect(lastSent(bot)).toBe('用法: /pair <配对码>')
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/pair with the right code pairs the user, clears the code and persists', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    const adapter = makeAdapter(bot, config)

    await adapter.handleEvent(makeMsg({ text: '/pair TESTCODE', senderId: 'dt_new', senderNick: 'Bob' }))

    expect(lastSent(bot)).toBe('✅ 配对成功！\n\n使用 /help 查看可用命令')
    expect(config.dingtalk.pairedUsers.map((u) => u.userId)).toEqual(['dt_new'])
    expect(config.dingtalk.pairedUsers[0].displayName).toBe('Bob')
    expect(config.pairing.code).toBeNull()
    expect(saveConfig).toHaveBeenCalledTimes(1)

    // now paired: a plain message reaches the engine path (session creation)
    await adapter.handleEvent(makeMsg({ text: '你好', senderId: 'dt_new' }))
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/dt-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith('dt_new', '你好')
  })

  it('/pair with a wrong code replies mismatch and persists nothing', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    const adapter = makeAdapter(bot, config)

    await adapter.handleEvent(makeMsg({ text: '/pair NOPE11', senderId: 'dt_new' }))

    expect(lastSent(bot)).toBe('❌ 配对码不正确')
    expect(config.dingtalk.pairedUsers).toHaveLength(0)
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/pair with an expired code replies 配对码已过期', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    config.pairing.expiresAt = Date.now() - 1000
    const adapter = makeAdapter(bot, config)

    await adapter.handleEvent(makeMsg({ text: '/pair TESTCODE', senderId: 'dt_new' }))

    expect(lastSent(bot)).toBe('❌ 配对码已过期，请重新生成')
  })

  it('rate-limits pairing after 5 failed attempts', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    const adapter = makeAdapter(bot, config)

    for (let i = 0; i < 5; i++) {
      await adapter.handleEvent(makeMsg({ text: `/pair WRONG${i}`, senderId: 'dt_new' }))
    }
    expect(sentText(bot).filter((t) => t === '❌ 配对码不正确')).toHaveLength(5)

    await adapter.handleEvent(makeMsg({ text: '/pair TESTCODE', senderId: 'dt_new' }))
    expect(lastSent(bot)).toBe('❌ 尝试次数过多，请稍后再试')
    expect(config.dingtalk.pairedUsers).toHaveLength(0)
  })

  it('/pair with no active code replies 当前没有生效的配对码', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairingCode: null, pairedUserIds: [] }))

    await adapter.handleEvent(makeMsg({ text: 'TESTCODE', senderId: 'dt_new' }))

    expect(lastSent(bot)).toBe('❌ 当前没有生效的配对码，请先在桌面端生成')
  })

  it('/pair from an already-paired user short-circuits with 您已配对', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.handleEvent(makeMsg({ text: '/pair TESTCODE' }))

    expect(lastSent(bot)).toBe('✅ 您已配对，可以直接发送消息')
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/unpair removes the paired user and persists', async () => {
    const bot = makeBot()
    const config = makeConfig()
    const adapter = makeAdapter(bot, config)

    await adapter.handleEvent(makeMsg({ text: '/unpair' }))

    expect(lastSent(bot)).toBe('已取消配对')
    expect(config.dingtalk.pairedUsers).toHaveLength(0)
    expect(saveConfig).toHaveBeenCalledTimes(1)
  })
})

describe('DingtalkAdapter — session creation & recovery', () => {
  it('/new creates a session, rebinds the bridge and registers the message handler', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.handleEvent(makeMsg({ text: '/new' }))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/dt-work')
    expect(storeOf(adapter).set).toHaveBeenCalledWith(USER, {
      sessionId: 'sess-new-123456789',
      workDir: '/tmp/dt-work',
    })

    const first = wsBridgeInstances[0] as BridgeDouble
    const second = wsBridgeInstances[1] as BridgeDouble
    expect(first.resetSession).toHaveBeenCalledWith(USER)
    expect(second.serverUrl).toBe(SERVER_URL)
    expect(second.authToken).toBe('tok-new-1')
    expect(second.connectSession).toHaveBeenCalledWith(USER, 'sess-new-123456789', '/tmp/dt-work')
    expect(second.handlers.has(USER)).toBe(true)
    expect(bridgeOf(adapter)).toBe(second)
    expect(lastSent(bot)).toBe('✅ 新会话已创建\n📁 目录: /tmp/dt-work\n🆔 sess-new...')
  })

  it('/new falls back to defaultProjectDir when dingtalk.defaultWorkDir is empty', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ workDir: '' }))

    await adapter.handleEvent(makeMsg({ text: '/new' }))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/proj-default')
  })

  it('sends the triggering message right after auto-creating a session', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.handleEvent(makeMsg({ text: '第一条消息' }))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/dt-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '第一条消息')
  })

  it('recovery over a stored binding reconnects without creating a session', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(USER, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await adapter.handleEvent(makeMsg({ text: '继续写代码' }))

    expect(httpOf(adapter).sessionExists).toHaveBeenCalledWith('sess-stored-1')
    expect(bridgeOf(adapter).connectSession).toHaveBeenCalledWith(USER, 'sess-stored-1', '/tmp/stored-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '继续写代码')
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })

  it('recovery over a dead server session deletes the binding and creates a fresh session', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(USER, { sessionId: 'sess-dead-1', workDir: '/tmp/stored-work' })
    httpOf(adapter).sessionExists.mockResolvedValue(false)

    await adapter.handleEvent(makeMsg({ text: 'hi' }))

    expect(httpOf(adapter).sessionExists).toHaveBeenCalledWith('sess-dead-1')
    expect(storeOf(adapter).delete).toHaveBeenCalledWith(USER)
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/dt-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, 'hi')
  })

  it('treats a sessionExists network failure as alive and reconnects instead of recreating', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(USER, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })
    httpOf(adapter).sessionExists.mockRejectedValue(new Error('ECONNREFUSED'))

    await adapter.handleEvent(makeMsg({ text: 'hi' }))

    expect(bridgeOf(adapter).connectSession).toHaveBeenCalledWith(USER, 'sess-stored-1', '/tmp/stored-work')
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, 'hi')
  })

  it('replies 创建会话失败 when the session API rejects', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).createSession.mockRejectedValue(new Error('HTTP 500: gateway down'))

    await adapter.handleEvent(makeMsg({ text: 'hi' }))

    expect(lastSent(bot)).toContain('❌ 创建会话失败: Error: HTTP 500: gateway down')
    expect(storeOf(adapter).set).toHaveBeenCalledTimes(0)
    // Pinned current behavior: despite the failure the text is still pushed to the OLD bridge
    expect(wsBridgeInstances[0] as BridgeDouble).toBe(bridgeOf(adapter))
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, 'hi')
  })

  it('/clear deletes the binding, resets the bridge and resets the active stream state', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const ss = streamStateInstances[0] as StreamStateDouble
    storeOf(adapter).set(USER, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await adapter.handleEvent(makeMsg({ text: '/clear' }))

    expect(storeOf(adapter).delete).toHaveBeenCalledWith(USER)
    expect(bridgeOf(adapter).resetSession).toHaveBeenCalledWith(USER)
    expect(ss.reset).toHaveBeenCalledTimes(1)
    expect(streamMapOf(adapter).size).toBe(0)
    expect(lastSent(bot)).toBe('🧹 已清空会话')
  })
})

describe('DingtalkAdapter — projects commands', () => {
  const twoProjects = [
    { name: 'alpha', path: '/tmp/proj/alpha' },
    { name: 'beta', path: '/tmp/other/beta' },
  ]

  it('/projects with an empty list replies 没有最近的项目', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.handleEvent(makeMsg({ text: '/projects' }))

    expect(lastSent(bot)).toBe('📭 没有最近的项目\n使用 /new 创建新会话')
  })

  it('/projects without args renders a numbered project list', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockResolvedValue(twoProjects)

    await adapter.handleEvent(makeMsg({ text: '/projects' }))

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(1)
    const list = lastSent(bot)
    expect(list).toContain('📋 最近项目')
    expect(list).toContain('1. alpha\n   /tmp/proj/alpha')
    expect(list).toContain('2. beta\n   /tmp/other/beta')
    expect(list).toContain('使用 /projects <编号或名称> 切换项目')
  })

  it('/projects <name> switches by creating a session in the matched project path', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockResolvedValue(twoProjects)
    httpOf(adapter).matchProject.mockImplementation(
      (query: unknown, projects: unknown) =>
        query === 'beta' ? (projects as Array<{ name: string; path: string }>)[1] : null
    )

    await adapter.handleEvent(makeMsg({ text: '/projects beta' }))

    expect(httpOf(adapter).matchProject).toHaveBeenCalledWith('beta', twoProjects)
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/other/beta')
    expect(storeOf(adapter).set).toHaveBeenCalledWith(USER, {
      sessionId: 'sess-new-123456789',
      workDir: '/tmp/other/beta',
    })
    expect(lastSent(bot)).toContain('📁 目录: /tmp/other/beta')
  })

  it('/projects handles no-match and ambiguous matches', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockResolvedValue(twoProjects)

    httpOf(adapter).matchProject.mockReturnValue(null)
    await adapter.handleEvent(makeMsg({ text: '/projects ghost' }))
    expect(lastSent(bot)).toBe('❌ 未找到匹配的项目')

    httpOf(adapter).matchProject.mockReturnValue('ambiguous')
    await adapter.handleEvent(makeMsg({ text: '/projects b' }))
    expect(lastSent(bot)).toBe('❌ 匹配到多个项目，请更精确地指定')

    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })

  it('/projects reports API failures to the user', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockRejectedValue(new Error('ECONNREFUSED'))

    await adapter.handleEvent(makeMsg({ text: '/projects' }))

    expect(lastSent(bot)).toContain('❌ 获取项目列表失败')
    expect(lastSent(bot)).toContain('ECONNREFUSED')
  })
})

describe('DingtalkAdapter — server message handling (AI card streaming)', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamStateInstances.length = 0
    msgSeq = 0
  })

  it('content_start(text) creates a stream state with the default template; tool_use start does not', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'tool_use', toolName: 'Bash' })
    expect(streamStateInstances).toHaveLength(0)
    expect(streamMapOf(adapter).size).toBe(0)

    await handler({ type: 'content_start', blockType: 'text' })
    expect(streamStateInstances).toHaveLength(1)
    expect((streamStateInstances[0] as StreamStateDouble).templateId).toBe(DEFAULT_TEMPLATE)
    expect((streamStateInstances[0] as StreamStateDouble).webhook).toBe(WEBHOOK)
    expect(streamMapOf(adapter).get(USER)).toBe(streamStateInstances[0] as StreamStateDouble)
  })

  it('content_start uses the configured permissionCardTemplateId when set', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot, makeConfig({ templateId: 'custom-tpl-1' }))

    await handler({ type: 'content_start', blockType: 'text' })

    expect((streamStateInstances[0] as StreamStateDouble).templateId).toBe('custom-tpl-1')
  })

  it('content_delta appends to the active stream state and lazy-creates one without content_start', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const first = streamStateInstances[0] as StreamStateDouble

    await handler({ type: 'content_delta', text: '你好' })
    expect(first.append).toHaveBeenCalledWith('你好')
    expect(first.append).toHaveBeenCalledTimes(1)

    // no stream state registered for this chat → lazy-create a second one
    streamMapOf(adapter).clear()
    await handler({ type: 'content_delta', text: 'late chunk' })
    const second = streamStateInstances[1] as StreamStateDouble
    expect(second.append).toHaveBeenCalledWith('late chunk')
    expect(streamMapOf(adapter).get(USER)).toBe(second)
  })

  it('content_delta without text is ignored', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_delta' })

    expect(streamStateInstances).toHaveLength(0)
    expect(streamMapOf(adapter).size).toBe(0)
  })

  it('status idle completes the stream state once and removes it from the map', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const ss = streamStateInstances[0] as StreamStateDouble

    await handler({ type: 'status', state: 'idle' })
    expect(ss.complete).toHaveBeenCalledTimes(1)
    expect(streamMapOf(adapter).has(USER)).toBe(false)

    await handler({ type: 'status', state: 'idle' })
    expect(ss.complete).toHaveBeenCalledTimes(1)
  })

  it('tool_use_complete closes the stream state and sends the formatted tool line', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const ss = streamStateInstances[0] as StreamStateDouble

    await handler({ type: 'tool_use_complete', toolName: 'Bash', toolUseId: 'tu_1', input: { command: 'ls -la' } })

    expect(ss.complete).toHaveBeenCalledTimes(1)
    expect(streamMapOf(adapter).has(USER)).toBe(false)
    expect(lastSent(bot)).toBe('🔧 Bash(command: ls -la)')
  })

  it('tool_result only surfaces errors and truncates them to 500 chars', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'tool_result', toolUseId: 'tu_1', content: 'fine', isError: false })
    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)

    const long = 'x'.repeat(600)
    await handler({ type: 'tool_result', toolUseId: 'tu_2', content: long, isError: true })
    expect(bot.sendTextMessage).toHaveBeenCalledWith(WEBHOOK, `❌ 工具错误: ${'x'.repeat(500)}`)
  })

  it('message_complete completes the stream state and always reports token usage', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const ss = streamStateInstances[0] as StreamStateDouble

    await handler({ type: 'message_complete', usage: { inputTokens: 12, outputTokens: 3400 } })

    expect(ss.complete).toHaveBeenCalledTimes(1)
    expect(streamMapOf(adapter).has(USER)).toBe(false)
    expect(lastSent(bot)).toBe('📊 Token: ↓12 ↑3400')
  })

  it('DEFECT-adjacent: message_complete warns instead of completing when the webhook expired', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const ss = streamStateInstances[0] as StreamStateDouble
    ss.isWebhookExpired.mockReturnValue(true)

    await handler({ type: 'message_complete', usage: { inputTokens: 1, outputTokens: 2 } })

    expect(ss.complete).toHaveBeenCalledTimes(0)
    expect(sentText(bot)).toContain('⚠️ 会话通道已过期，请重新发一条消息以刷新通道')
    expect(lastSent(bot)).toBe('📊 Token: ↓1 ↑2') // usage line is still sent unconditionally
    expect(streamMapOf(adapter).has(USER)).toBe(false)
  })

  it('error and api_retry messages are relayed with their formatted copy', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'error', message: 'rate limit hit', code: 'RATE_LIMIT' })
    expect(lastSent(bot)).toBe('❌ 错误: rate limit hit')

    await handler({ type: 'api_retry', attempt: 2, maxRetries: 5, retryDelayMs: 1500 })
    expect(lastSent(bot)).toBe('🔄 API 重试 (2/5)')
  })

  it('ignores unknown server message types', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'thinking', text: 'hmm' })

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(streamMapOf(adapter).size).toBe(0)
  })

  it('drops server messages when the webhook entry is gone (unknown chat)', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    webhooksOf(adapter).clear()
    await handler({ type: 'error', message: 'boom', code: 'X' })

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(streamMapOf(adapter).size).toBe(0)
  })

  it('connected messages are logged only — no user-visible reply and no stream state', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'connected', sessionId: 'sess-new-123456789' })

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(streamMapOf(adapter).size).toBe(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })
})

describe('DingtalkAdapter — permission cards & quick replies', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamStateInstances.length = 0
    msgSeq = 0
  })

  it('permission_request sends an AI card with three permit callback payloads', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({
      type: 'permission_request',
      requestId: 'perm-1',
      toolName: 'Write',
      input: { file_path: '/tmp/dt-work/a.txt' },
      description: '写入文件',
    })

    expect(bot.sendAiCardMessage).toHaveBeenCalledTimes(1)
    const [webhook, templateId, card] = bot.sendAiCardMessage.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(webhook).toBe(WEBHOOK)
    expect(templateId).toBe(DEFAULT_TEMPLATE)
    expect(card.title).toBe('🔐 权限请求')
    expect(card.action_allow).toBe('permit:perm-1:yes')
    expect(card.action_always).toBe('permit:perm-1:always')
    expect(card.action_deny).toBe('permit:perm-1:no')
    expect(card.content).toContain('工具: Write')
  })

  it('falls back to a plain text permission when the AI card API fails', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)
    bot.sendAiCardMessage.mockRejectedValueOnce(new Error('cardkit down'))

    await handler({
      type: 'permission_request',
      requestId: 'perm-3',
      toolName: 'Bash',
      input: { command: 'ls' },
    })

    expect(lastSent(bot)).toContain('🔐 权限请求')
    expect(lastSent(bot)).toContain('工具: Bash')
  })

  it('quick reply 1 allows the single pending request', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-1', toolName: 'Bash', input: { command: 'ls' } })
    bridge.sendPermissionResponse.mockClear()
    bot.sendTextMessage.mockClear()

    await adapter.handleEvent(makeMsg({ text: '1' }))

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'perm-1', true, undefined)
    expect(lastSent(bot)).toBe('✅ 已允许')
    expect(bridge.sendUserMessage).toHaveBeenCalledTimes(0)
  })

  it('quick reply 3 denies the pending request', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-d', toolName: 'Bash', input: {} })

    await adapter.handleEvent(makeMsg({ text: '3' }))

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'perm-d', false, undefined)
    expect(lastSent(bot)).toBe('✅ 已拒绝')
  })

  it('without a pending permission a quick-reply word is chat text and reaches the engine', async () => {
    const bot = makeBot()
    const { adapter, bridge } = await setupSession(bot)

    await adapter.handleEvent(makeMsg({ text: '1' }))

    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(USER, '1')
  })

  it('consuming a quick reply pops the pending entry — the next word is chat text', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-1', toolName: 'Bash', input: { command: 'ls' } })
    bridge.sendPermissionResponse.mockClear()

    await adapter.handleEvent(makeMsg({ text: '1' }))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(1)
    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'perm-1', true, undefined)
    expect(bridge.sendUserMessage).toHaveBeenCalledTimes(0)

    await adapter.handleEvent(makeMsg({ text: 'allow' }))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(1)
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(USER, 'allow')
  })

  it('explicit /always <tool> resolves the requestId from the pending list by tool name', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-a', toolName: 'Bash', input: {} })

    await adapter.handleEvent(makeMsg({ text: '/always bash' })) // case-insensitive match

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'perm-a', true, 'always')
    expect(lastSent(bot)).toBe('✅ 已允许')

    // consumed → a later quick-reply word is chat text
    bridge.sendPermissionResponse.mockClear()
    await adapter.handleEvent(makeMsg({ text: '1' }))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(USER, '1')
  })

  it('explicit command naming an unlisted tool replies with an error and sends nothing to the engine', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-w', toolName: 'Write', input: {} })

    await adapter.handleEvent(makeMsg({ text: '/always Bash' }))

    expect(lastSent(bot)).toBe('❌ 未找到与工具 Bash 匹配的待处理权限请求')
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
  })
})

describe('DingtalkAdapter — handleCardAction', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamStateInstances.length = 0
    msgSeq = 0
  })

  async function setupWithPending(): Promise<{ adapter: DingtalkAdapter; bridge: BridgeDouble }> {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)
    await handler({ type: 'permission_request', requestId: 'req-1', toolName: 'Bash', input: {} })
    bridge.sendPermissionResponse.mockClear()
    return { adapter, bridge }
  }

  it('permit:xxx:yes maps to allowed=true with no rule', async () => {
    const { adapter, bridge } = await setupWithPending()

    await adapter.handleCardAction(WEBHOOK, 'permit:req-1:yes')

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'req-1', true, undefined)
  })

  it('permit:xxx:no maps to allowed=false', async () => {
    const { adapter, bridge } = await setupWithPending()

    await adapter.handleCardAction(WEBHOOK, 'permit:req-1:no')

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'req-1', false, undefined)
  })

  it('permit:xxx:always maps to allowed=true with the always rule', async () => {
    const { adapter, bridge } = await setupWithPending()

    await adapter.handleCardAction(WEBHOOK, 'permit:req-1:always')

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'req-1', true, 'always')
  })

  it('pops the pending entry so a later quick reply is chat text again', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)
    await handler({ type: 'permission_request', requestId: 'req-1', toolName: 'Bash', input: {} })
    bridge.sendPermissionResponse.mockClear()

    await adapter.handleCardAction(WEBHOOK, 'permit:req-1:yes')
    bridge.sendPermissionResponse.mockClear()

    await adapter.handleEvent(makeMsg({ text: '1' }))

    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(USER, '1')
  })

  it('unparsable actionValue is ignored — nothing is sent to the engine', async () => {
    const { adapter, bridge } = await setupWithPending()

    await adapter.handleCardAction(WEBHOOK, 'some:other:action')
    await adapter.handleCardAction(WEBHOOK, 'permit:req-1:maybe')

    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
  })

  it('a card action on an unknown webhook finds no chatId and sends nothing to the engine', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'req-2', toolName: 'Bash', input: {} })

    await adapter.handleCardAction('https://oapi.dingtalk.com/robot/send?session=other', 'permit:req-2:yes')

    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
  })
})

describe('DingtalkAdapter — start / stop lifecycle', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamStateInstances.length = 0
    msgSeq = 0
  })

  it('start validates the access token; second start is a no-op', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.start()
    expect(bot.getAccessToken).toHaveBeenCalledTimes(1)

    await adapter.start() // idempotent
    expect(bot.getAccessToken).toHaveBeenCalledTimes(1)

    await adapter.stop()
  })

  it('start rejects with a credential error when getAccessToken fails', async () => {
    const bot = makeBot()
    bot.getAccessToken.mockRejectedValue(new Error('invalid client_secret'))
    const adapter = makeAdapter(bot)

    await expect(adapter.start()).rejects.toThrow('Failed to validate DingTalk credentials')

    await adapter.stop()
  })

  it('start rejects when getAccessToken resolves empty', async () => {
    const bot = makeBot()
    bot.getAccessToken.mockResolvedValue('')
    const adapter = makeAdapter(bot)

    await expect(adapter.start()).rejects.toThrow('Failed to validate DingTalk credentials')

    await adapter.stop()
  })

  it('stop destroys the bridge and clears the dedup sweep timer', async () => {
    vi.useFakeTimers()
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    await adapter.start()
    expect(vi.getTimerCount()).toBe(1) // dedup sweep interval

    await adapter.stop()

    expect(bridgeOf(adapter).destroy).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('DingtalkAdapter — error containment', () => {
  it('a bot send failure is swallowed by the chat queue and logged, not rethrown', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    bot.sendTextMessage.mockRejectedValue(new Error('network down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(adapter.handleEvent(makeMsg({ text: '/health' }))).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  for (const adapter of createdAdapters) {
    await adapter.stop()
  }
  createdAdapters.length = 0
  vi.useRealTimers()
})
