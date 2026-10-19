// @vitest-environment node
/**
 * FeishuAdapter — main-process tests for the event-handling chain.
 *
 * Mocked seams (mirrors tests/im/wechat/wechatAdapter.integration.test.ts):
 * - WsBridge: captured per-instance doubles, handlers map drives handleServerMessage
 * - HttpClient / SessionStore: per-instance vi.fn doubles
 * - config: no fs access; saveConfig calls are asserted
 * - logger / StreamingCard / FeishuMediaHandler: module doubles
 * Real modules: MessageDedup, ChatQueue, SessionRecovery, Pairing,
 * FeishuPermissionCard (path-safety / card fallback), commands, format, permission.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FeishuAdapter } from '@electron/im/adapters/feishu/feishuAdapter'
import type { FeishuBot, FeishuMessage } from '@electron/im/adapters/feishu/feishuBot'
import { saveConfig } from '@electron/im/adapters/common/config'
import type { AdapterConfig } from '@electron/im/adapters/common/config'
import type { MessageHandler, SessionBinding, ServerMessage } from '@electron/im/adapters/common/types'

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
  mockImplementation(fn: (...args: unknown[]) => unknown): void
  mockReturnValue(value: unknown): void
}

const wsBridgeInstances: unknown[] = []
const streamingCardInstances: unknown[] = []

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

vi.mock('@electron/im/adapters/feishu/streamingCard', () => {
  return {
    StreamingCard: class MockStreamingCard {
      receiveId: string
      receiveIdType: string
      append = vi.fn()
      complete = vi.fn(async () => {})
      reset = vi.fn()
      getCardId = vi.fn((): string | null => null)
      getMessageId = vi.fn((): string | null => null)
      isStreamingDisabled = vi.fn((): boolean => false)

      constructor(_bot: unknown, receiveId: string, receiveIdType: string) {
        this.receiveId = receiveId
        this.receiveIdType = receiveIdType
        streamingCardInstances.push(this)
      }
    },
  }
})

vi.mock('@electron/im/adapters/feishu/mediaHandler', () => {
  const imageMedia = {
    path: '/tmp/att/feishu_img.png',
    fileName: 'feishu_img.png',
    mimeType: 'image/png',
    type: 'image' as const,
  }
  const fileMedia = {
    path: '/tmp/att/report.pdf',
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    type: 'file' as const,
  }
  return {
    FeishuMediaHandler: class MockFeishuMediaHandler {
      downloadImage = vi.fn(async (_messageId: string, _fileKey: string) => imageMedia)
      downloadFile = vi.fn(async (_messageId: string, _fileKey: string, fileName: string) => ({
        ...fileMedia,
        fileName,
      }))
      toAttachmentRef = vi.fn((media: { path: string; fileName: string; mimeType: string; type: 'image' | 'file' }) => ({
        type: media.type,
        name: media.fileName,
        path: media.path,
        mimeType: media.mimeType,
      }))
      uploadImage = vi.fn(async () => {})
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

interface CardDouble {
  receiveId: string
  receiveIdType: string
  append: MockFn
  complete: MockFn
  reset: MockFn
}

interface MediaDouble {
  downloadImage: MockFn
  downloadFile: MockFn
  toAttachmentRef: MockFn
}

interface BotDouble {
  getBotInfo: MockFn
  sendTextMessage: MockFn
  sendCardMessage: MockFn
  patchMessage: MockFn
  updateMessage: MockFn
}

const USER = 'ou_paired'
const SERVER_URL = 'ws://127.0.0.1:5555'

function makeBot(): BotDouble {
  return {
    getBotInfo: vi.fn(async () => ({ app_name: 'TestBot', open_id: 'bot_1' })),
    sendTextMessage: vi.fn(async () => ({ message_id: 'om_sent' })),
    sendCardMessage: vi.fn(async () => ({ message_id: 'om_card' })),
    patchMessage: vi.fn(async () => undefined),
    updateMessage: vi.fn(async () => undefined),
  }
}

function makeConfig(
  o: { pairingCode?: string | null; pairedUserIds?: string[]; feishuWorkDir?: string } = {}
): AdapterConfig {
  const pairingCode = o.pairingCode === undefined ? 'TESTCODE' : o.pairingCode
  return {
    serverUrl: 'ws://127.0.0.1:3456',
    defaultProjectDir: '/tmp/proj-default',
    pairing: { code: pairingCode, expiresAt: Date.now() + 3_600_000, createdAt: Date.now() },
    telegram: { allowedUsers: [], pairedUsers: [], defaultWorkDir: '', botToken: '' },
    feishu: {
      allowedUsers: [],
      pairedUsers: (o.pairedUserIds === undefined ? [USER] : o.pairedUserIds).map((userId) => ({
        userId,
        pairedAt: Date.now(),
      })),
      defaultWorkDir: o.feishuWorkDir === undefined ? '/tmp/feishu-work' : o.feishuWorkDir,
      appId: 'cli_test',
      appSecret: 'secret_test',
      streamingCard: false,
    },
    dingtalk: {
      allowedUsers: [], pairedUsers: [], defaultWorkDir: '',
      clientId: '', clientSecret: '', endpoint: 'https://api.dingtalk.com', permissionCardTemplateId: '',
    },
    wechat: { allowedUsers: [], pairedUsers: [], defaultWorkDir: '', accountId: '', botToken: '', baseUrl: '', userId: '' },
    whatsapp: { allowedUsers: [], pairedUsers: [], defaultWorkDir: '', accountJid: '', authDir: '' },
  }
}

let msgSeq = 0

function textMsg(
  text: string,
  o: { userId?: string; msgId?: string; senderType?: string } = {}
): FeishuMessage {
  return {
    message_id: o.msgId ?? `om_${(msgSeq += 1)}`,
    chat_id: 'oc_group_1',
    sender: {
      sender_id: { open_id: o.userId ?? USER, user_id: 'u_1', union_id: 'un_1' },
      sender_type: o.senderType ?? 'user',
    },
    message_type: 'text',
    content: JSON.stringify({ text }),
    create_time: '1700000000000',
  }
}

function typedMsg(
  messageType: string,
  content: unknown,
  o: { userId?: string; msgId?: string } = {}
): FeishuMessage {
  return {
    message_id: o.msgId ?? `om_${(msgSeq += 1)}`,
    chat_id: 'oc_group_1',
    sender: {
      sender_id: { open_id: o.userId ?? USER, user_id: 'u_1', union_id: 'un_1' },
      sender_type: 'user',
    },
    message_type: messageType,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    create_time: '1700000000000',
  }
}

function ev(message: FeishuMessage | undefined): { event?: { message?: FeishuMessage } } {
  return { event: { message } }
}

function bridgeOf(adapter: FeishuAdapter): BridgeDouble {
  return (adapter as unknown as { bridge: BridgeDouble }).bridge
}
function storeOf(adapter: FeishuAdapter): StoreDouble {
  return (adapter as unknown as { sessionStore: StoreDouble }).sessionStore
}
function httpOf(adapter: FeishuAdapter): HttpDouble {
  return (adapter as unknown as { httpClient: HttpDouble }).httpClient
}
function cardsOf(adapter: FeishuAdapter): Map<string, CardDouble> {
  return (adapter as unknown as { streamingCards: Map<string, CardDouble> }).streamingCards
}
function mediaOf(adapter: FeishuAdapter): MediaDouble {
  return (adapter as unknown as { mediaHandler: MediaDouble }).mediaHandler
}

function sentText(bot: BotDouble): string[] {
  return bot.sendTextMessage.mock.calls.map((c: unknown[]) => String(c[2]))
}

function lastSent(bot: BotDouble): string {
  const all = sentText(bot)
  return all[all.length - 1] ?? ''
}

const createdAdapters: FeishuAdapter[] = []

function makeAdapter(bot: BotDouble, config?: AdapterConfig): FeishuAdapter {
  const adapter = new FeishuAdapter({
    bot: bot as unknown as FeishuBot,
    config: config ?? makeConfig(),
    serverUrl: SERVER_URL,
  })
  createdAdapters.push(adapter)
  return adapter
}

async function sendEvent(adapter: FeishuAdapter, message: FeishuMessage): Promise<void> {
  await adapter.handleEvent(ev(message))
}

/** Run /new so the server-message handler is registered on the live bridge. */
async function setupSession(
  bot: BotDouble,
  config?: AdapterConfig
): Promise<{ adapter: FeishuAdapter; bridge: BridgeDouble; handler: MessageHandler }> {
  const adapter = makeAdapter(bot, config)
  await sendEvent(adapter, textMsg('/new', { msgId: 'om_setup_new' }))
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
  streamingCardInstances.length = 0
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

describe('FeishuAdapter — handleEvent entry filtering', () => {
  it('ignores events without a message payload (no reply is ever sent)', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.handleEvent({})
    await adapter.handleEvent({ event: {} })
    await adapter.handleEvent({ event: { message: undefined } })

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })

  it('dedups repeated message_id and processes it exactly once', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    const message = textMsg('/health', { msgId: 'om_dup' })

    await sendEvent(adapter, message)
    await sendEvent(adapter, message)

    expect(sentText(bot)).toEqual(['✅ 适配器运行正常'])
  })

  it('treats a message from the bot itself as an unpaired sender (no dedicated bot filter)', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairingCode: null }))

    await sendEvent(adapter, textMsg('自动回复内容', { userId: 'bot_self', senderType: 'app' }))

    expect(lastSent(bot)).toBe('❌ 当前没有生效的配对码，请先在桌面端生成')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })

  it('routes an unpaired plain-text user into pairing and never reaches the engine', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig())

    await sendEvent(adapter, textMsg('hello there', { userId: 'ou_new' }))

    expect(lastSent(bot)).toBe('❌ 配对码不正确') // mismatch against TESTCODE
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })

  it('processes a paired plain-text message via the stored session binding', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(USER, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendEvent(adapter, textMsg('继续写代码'))

    expect(httpOf(adapter).sessionExists).toHaveBeenCalledWith('sess-stored-1')
    const bridge = bridgeOf(adapter)
    expect(bridge.connectSession).toHaveBeenCalledWith(USER, 'sess-stored-1', '/tmp/stored-work')
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(USER, '继续写代码')
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })

  it('passes messages without a sender through pairing (userId defaults to empty)', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairingCode: null }))
    const message = { ...textMsg('hi'), sender: undefined as unknown as FeishuMessage['sender'] }

    await sendEvent(adapter, message)

    expect(lastSent(bot)).toBe('❌ 当前没有生效的配对码，请先在桌面端生成')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })
})

describe('FeishuAdapter — command parsing & routing', () => {
  it('/help sends the formatted command list', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendEvent(adapter, textMsg('/help'))

    const help = lastSent(bot)
    expect(help).toContain('📋 可用命令')
    expect(help).toContain('/new')
    expect(bot.sendTextMessage).toHaveBeenCalledTimes(1)
  })

  it('unknown slash commands are not intercepted and reach the engine as chat text', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(USER, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendEvent(adapter, textMsg('/foobar arg'))

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '/foobar arg')
  })

  it('/stop signals stop-generation on the bridge and confirms to the user', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendEvent(adapter, textMsg('/stop'))

    expect(bridgeOf(adapter).sendStopGeneration).toHaveBeenCalledWith(USER)
    expect(lastSent(bot)).toBe('⏹️ 已请求停止生成')
  })

  it('/status formats the idle session state with the stored work dir', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(USER, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendEvent(adapter, textMsg('/status'))

    const status = lastSent(bot)
    expect(status).toContain('💤 会话状态: idle')
    expect(status).toContain('🆔 Session: N/A')
    expect(status).toContain('📁 目录: /tmp/stored-work')
  })

  it('answers static informational commands with their fixed copy', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    const expected: Array<[string, string]> = [
      ['/resume', '📋 恢复会话功能: 使用 /new 创建新会话，或直接发送消息自动恢复上一个会话'],
      ['/provider', '🔧 Provider 切换功能需要桌面端配置'],
      ['/model', '🔧 模型切换功能需要桌面端配置'],
      ['/skills', '📋 技能列表功能需要桌面端配置'],
      ['/cancel', '✅ 已取消当前操作'],
      ['/health', '✅ 适配器运行正常'],
    ]
    for (const [command, copy] of expected) {
      await sendEvent(adapter, textMsg(command))
    }

    expect(sentText(bot).slice(-expected.length)).toEqual(expected.map(([, copy]) => copy))
  })
})

describe('FeishuAdapter — pairing commands', () => {
  it('/pair without args replies with usage and does not persist config', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairedUserIds: [] }))

    await sendEvent(adapter, textMsg('/pair', { userId: 'ou_new' }))

    expect(lastSent(bot)).toBe('用法: /pair <配对码>')
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/pair with the right code pairs the user, clears the code and persists', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    const adapter = makeAdapter(bot, config)

    await sendEvent(adapter, textMsg('/pair TESTCODE', { userId: 'ou_new' }))

    expect(lastSent(bot)).toBe('✅ 配对成功！\n\n使用 /help 查看可用命令')
    expect(config.feishu.pairedUsers.map((u) => u.userId)).toEqual(['ou_new'])
    expect(config.pairing.code).toBeNull()
    expect(saveConfig).toHaveBeenCalledTimes(1)

    // now paired: a plain message reaches the engine path (session creation)
    await sendEvent(adapter, textMsg('你好', { userId: 'ou_new' }))
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/feishu-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith('ou_new', '你好')
  })

  it('/pair with a wrong code replies mismatch', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    const adapter = makeAdapter(bot, config)

    await sendEvent(adapter, textMsg('/pair NOPE11', { userId: 'ou_new' }))

    expect(lastSent(bot)).toBe('❌ 配对码不正确')
    expect(config.feishu.pairedUsers).toHaveLength(0)
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/unpair removes the paired user and persists', async () => {
    const bot = makeBot()
    const config = makeConfig()
    const adapter = makeAdapter(bot, config)

    await sendEvent(adapter, textMsg('/unpair'))

    expect(lastSent(bot)).toBe('已取消配对')
    expect(config.feishu.pairedUsers).toHaveLength(0)
    expect(saveConfig).toHaveBeenCalledTimes(1)
  })

  it('/pair from an already-paired user short-circuits with 您已配对', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendEvent(adapter, textMsg('/pair TESTCODE'))

    expect(lastSent(bot)).toBe('✅ 您已配对，可以直接发送消息')
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/pair with an expired code replies 配对码已过期', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    config.pairing.expiresAt = Date.now() - 1000
    const adapter = makeAdapter(bot, config)

    await sendEvent(adapter, textMsg('/pair TESTCODE', { userId: 'ou_new' }))

    expect(lastSent(bot)).toBe('❌ 配对码已过期，请重新生成')
  })

  it('allowedUsers whitelist grants access without pairing', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    config.feishu.allowedUsers = ['ou_allowed']
    const adapter = makeAdapter(bot, config)
    storeOf(adapter).set('ou_allowed', { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendEvent(adapter, textMsg('在吗', { userId: 'ou_allowed' }))

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith('ou_allowed', '在吗')
    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
  })
})

describe('FeishuAdapter — session creation & recovery', () => {
  it('/new creates a session, rebinds the bridge and registers the message handler', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendEvent(adapter, textMsg('/new'))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/feishu-work')
    expect(storeOf(adapter).set).toHaveBeenCalledWith(USER, {
      sessionId: 'sess-new-123456789',
      workDir: '/tmp/feishu-work',
    })

    const first = wsBridgeInstances[0] as BridgeDouble
    const second = wsBridgeInstances[1] as BridgeDouble
    expect(first.resetSession).toHaveBeenCalledWith(USER)
    expect(second.serverUrl).toBe(SERVER_URL)
    expect(second.authToken).toBe('tok-new-1')
    expect(second.connectSession).toHaveBeenCalledWith(USER, 'sess-new-123456789', '/tmp/feishu-work')
    expect(second.handlers.has(USER)).toBe(true)
    expect(bridgeOf(adapter)).toBe(second)
    expect(lastSent(bot)).toBe('✅ 新会话已创建\n📁 目录: /tmp/feishu-work\n🆔 sess-new...')
  })

  it('DEFECT: 未配对用户也能用 /new 直接建会话（命令分支早于配对门禁）', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairingCode: null, pairedUserIds: [] }))

    await sendEvent(adapter, textMsg('/new', { userId: 'ou_stranger' }))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/feishu-work')
    expect(storeOf(adapter).set).toHaveBeenCalledWith('ou_stranger', {
      sessionId: 'sess-new-123456789',
      workDir: '/tmp/feishu-work',
    })
    expect(lastSent(bot)).toContain('新会话已创建')
  })

  it('/new falls back to defaultProjectDir when feishu.defaultWorkDir is empty', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ feishuWorkDir: '' }))

    await sendEvent(adapter, textMsg('/new'))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/proj-default')
  })

  it('sends the triggering message right after auto-creating a session', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendEvent(adapter, textMsg('第一条消息'))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/feishu-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '第一条消息')
  })

  it('recovery over a dead server session deletes the binding and creates a fresh session', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(USER, { sessionId: 'sess-dead-1', workDir: '/tmp/stored-work' })
    httpOf(adapter).sessionExists.mockResolvedValue(false)

    await sendEvent(adapter, textMsg('hi'))

    expect(httpOf(adapter).sessionExists).toHaveBeenCalledWith('sess-dead-1')
    expect(storeOf(adapter).delete).toHaveBeenCalledWith(USER)
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/feishu-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, 'hi')
  })

  it('replies 创建会话失败 when the session API rejects', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).createSession.mockRejectedValue(new Error('HTTP 500: gateway down'))

    await sendEvent(adapter, textMsg('hi'))

    expect(lastSent(bot)).toContain('❌ 创建会话失败: Error: HTTP 500: gateway down')
    expect(storeOf(adapter).set).toHaveBeenCalledTimes(0)
    // Pinned current behavior: despite the failure the text is still pushed to the OLD bridge
    expect(wsBridgeInstances[0] as BridgeDouble).toBe(bridgeOf(adapter))
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, 'hi')
  })
})

describe('FeishuAdapter — projects commands', () => {
  const twoProjects = [
    { name: 'alpha', path: '/tmp/proj/alpha' },
    { name: 'beta', path: '/tmp/other/beta' },
  ]

  it('/projects with an empty list replies 没有最近的项目', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendEvent(adapter, textMsg('/projects'))

    expect(lastSent(bot)).toBe('📭 没有最近的项目\n使用 /new 创建新会话')
  })

  it('/projects without args renders a numbered project list', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockResolvedValue(twoProjects)

    await sendEvent(adapter, textMsg('/projects'))

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

    await sendEvent(adapter, textMsg('/projects beta'))

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
    await sendEvent(adapter, textMsg('/projects ghost'))
    expect(lastSent(bot)).toBe('❌ 未找到匹配的项目')

    httpOf(adapter).matchProject.mockReturnValue('ambiguous')
    await sendEvent(adapter, textMsg('/projects b'))
    expect(lastSent(bot)).toBe('❌ 匹配到多个项目，请更精确地指定')

    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })

  it('/projects reports API failures to the user', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockRejectedValue(new Error('ECONNREFUSED'))

    await sendEvent(adapter, textMsg('/projects'))

    expect(lastSent(bot)).toContain('❌ 获取项目列表失败')
    expect(lastSent(bot)).toContain('ECONNREFUSED')
  })
})

describe('FeishuAdapter — server message handling (streaming cards)', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingCardInstances.length = 0
    msgSeq = 0
  })

  it('content_start(text) creates a streaming card; tool_use start does not', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'tool_use', toolName: 'Bash' })
    expect(streamingCardInstances).toHaveLength(0)
    expect(cardsOf(adapter).size).toBe(0)

    await handler({ type: 'content_start', blockType: 'text' })
    expect(streamingCardInstances).toHaveLength(1)
    expect(cardsOf(adapter).get(USER)).toBe(streamingCardInstances[0] as CardDouble)
  })

  it('content_delta appends to the active card and lazy-creates one without content_start', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const first = streamingCardInstances[0] as CardDouble

    await handler({ type: 'content_delta', text: '你好' })
    await handler({ type: 'content_delta', toolInput: '{"partial":' })
    expect(first.append).toHaveBeenCalledWith('你好')
    expect(first.append).toHaveBeenCalledTimes(1)

    // no card registered for this user → lazy-create a second one
    cardsOf(adapter).clear()
    await handler({ type: 'content_delta', text: 'late chunk' })
    const second = streamingCardInstances[1] as CardDouble
    expect(second.append).toHaveBeenCalledWith('late chunk')
    expect(cardsOf(adapter).get(USER)).toBe(second)
  })

  it('status idle completes the card once and removes it from the map', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const card = streamingCardInstances[0] as CardDouble

    await handler({ type: 'status', state: 'idle' })
    expect(card.complete).toHaveBeenCalledTimes(1)
    expect(cardsOf(adapter).has(USER)).toBe(false)

    await handler({ type: 'status', state: 'idle' })
    expect(card.complete).toHaveBeenCalledTimes(1)
  })

  it('tool_use_complete closes the card and sends the formatted tool line', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const card = streamingCardInstances[0] as CardDouble

    await handler({ type: 'tool_use_complete', toolName: 'Bash', toolUseId: 'tu_1', input: { command: 'ls -la' } })

    expect(card.complete).toHaveBeenCalledTimes(1)
    expect(cardsOf(adapter).has(USER)).toBe(false)
    expect(lastSent(bot)).toBe('🔧 Bash(command: ls -la)')
  })

  it('tool_result only surfaces errors and truncates them to 500 chars', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'tool_result', toolUseId: 'tu_1', content: 'fine', isError: false })
    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)

    const long = 'x'.repeat(600)
    await handler({ type: 'tool_result', toolUseId: 'tu_2', content: long, isError: true })
    expect(bot.sendTextMessage).toHaveBeenCalledWith('open_id', USER, `❌ 工具错误: ${'x'.repeat(500)}`)
  })

  it('message_complete closes the card and reports token usage', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const card = streamingCardInstances[0] as CardDouble

    await handler({ type: 'message_complete', usage: { inputTokens: 12, outputTokens: 3400 } })

    expect(card.complete).toHaveBeenCalledTimes(1)
    expect(cardsOf(adapter).has(USER)).toBe(false)
    expect(lastSent(bot)).toBe('📊 Token: ↓12 ↑3400')
  })

  it('error and api_retry messages are relayed with their formatted copy', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'error', message: 'rate limit hit', code: 'RATE_LIMIT' })
    expect(lastSent(bot)).toBe('❌ 错误: rate limit hit')

    await handler({ type: 'api_retry', attempt: 2, maxRetries: 5, retryDelayMs: 1500 })
    expect(lastSent(bot)).toBe('🔄 API 重试 (2/5)，1500ms 后重试...')
  })

  it('ignores unknown server message types', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'thinking', text: 'hmm' })

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(cardsOf(adapter).size).toBe(0)
  })

  it('connected messages are logged only — no user-visible reply and no card', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'connected', sessionId: 'sess-new-123456789' })

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(cardsOf(adapter).size).toBe(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })
})

describe('FeishuAdapter — permission cards & quick replies', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingCardInstances.length = 0
    msgSeq = 0
  })

  it('permission_request sends a Schema 2.0 card with three permit callback buttons', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({
      type: 'permission_request',
      requestId: 'perm-1',
      toolName: 'Write',
      input: { file_path: '/tmp/feishu-work/a.txt' },
      description: '写入文件',
    })

    expect(bot.sendCardMessage).toHaveBeenCalledTimes(1)
    const [receiveIdType, receiveId, card] = bot.sendCardMessage.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(receiveIdType).toBe('open_id')
    expect(receiveId).toBe(USER)
    expect(card.schema).toBe('2.0')
    const jsonStr = JSON.stringify(card)
    expect(jsonStr).toContain('permit:perm-1:yes')
    expect(jsonStr).toContain('permit:perm-1:always')
    expect(jsonStr).toContain('permit:perm-1:no')
    expect(jsonStr).not.toContain('工作目录外') // path inside workDir → no warning
  })

  it('permission card outside the session work dir carries the path-safety warning', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({
      type: 'permission_request',
      requestId: 'perm-2',
      toolName: 'Write',
      input: { file_path: '/etc/passwd' },
    })

    expect(JSON.stringify(bot.sendCardMessage.mock.calls[0][2])).toContain('工作目录外的路径')
  })

  it('falls back to a plain text permission when the card API fails', async () => {
    const bot = makeBot()
    bot.sendCardMessage.mockRejectedValueOnce(new Error('cardkit down'))
    const { handler } = await setupSession(bot)

    await handler({
      type: 'permission_request',
      requestId: 'perm-3',
      toolName: 'Bash',
      input: { command: 'ls' },
    })

    expect(lastSent(bot)).toContain('🔐 权限请求')
    expect(lastSent(bot)).toContain('工具: Bash')
  })

  it('consuming a quick reply pops the pending entry — the next word is chat text', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-1', toolName: 'Bash', input: { command: 'ls' } })
    bot.sendTextMessage.mockClear()

    await sendEvent(adapter, textMsg('1'))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(1)
    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'perm-1', true, undefined)
    expect(lastSent(bot)).toBe('✅ 已允许')
    expect(bridge.sendUserMessage).toHaveBeenCalledTimes(0)

    await sendEvent(adapter, textMsg('allow'))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(1)
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(USER, 'allow')
  })

  it('quick reply 拒绝 denies the pending request', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-d', toolName: 'Bash', input: {} })

    await sendEvent(adapter, textMsg('3'))

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'perm-d', false, undefined)
    expect(lastSent(bot)).toBe('✅ 已拒绝')
  })

  it('explicit /always <tool> resolves the requestId from the pending list by tool name', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-a', toolName: 'Bash', input: {} })

    await sendEvent(adapter, textMsg('/always bash')) // case-insensitive match

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'perm-a', true, 'always')
    expect(lastSent(bot)).toBe('✅ 已允许')

    // consumed → a later quick-reply word is chat text
    bridge.sendPermissionResponse.mockClear()
    await sendEvent(adapter, textMsg('1'))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(USER, '1')
  })

  it('explicit command naming an unlisted tool replies with an error and sends nothing to the engine', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-w', toolName: 'Write', input: {} })

    await sendEvent(adapter, textMsg('/always Bash'))

    expect(lastSent(bot)).toBe('❌ 未找到与工具 Bash 匹配的待处理权限请求')
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
  })
})

describe('FeishuAdapter — handleCardAction', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingCardInstances.length = 0
    msgSeq = 0
  })

  async function setupWithPending(): Promise<{ adapter: FeishuAdapter; bridge: BridgeDouble }> {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)
    await handler({ type: 'permission_request', requestId: 'req-1', toolName: 'Bash', input: {} })
    bridge.sendPermissionResponse.mockClear()
    return { adapter, bridge }
  }

  it('permit:xxx:yes maps to allowed=true with no rule', async () => {
    const { adapter, bridge } = await setupWithPending()

    await adapter.handleCardAction(USER, 'permit:req-1:yes')

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'req-1', true, undefined)
  })

  it('permit:xxx:no maps to allowed=false', async () => {
    const { adapter, bridge } = await setupWithPending()

    await adapter.handleCardAction(USER, 'permit:req-1:no')

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'req-1', false, undefined)
  })

  it('permit:xxx:always maps to allowed=true with the always rule', async () => {
    const { adapter, bridge } = await setupWithPending()

    await adapter.handleCardAction(USER, 'permit:req-1:always')

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'req-1', true, 'always')
  })

  it('unparsable actionValue is ignored — nothing is sent to the engine', async () => {
    const { adapter, bridge } = await setupWithPending()

    await adapter.handleCardAction(USER, 'some:other:action')
    await adapter.handleCardAction(USER, 'permit:req-1:maybe')

    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
  })

  it('parses a requestId that is not pending anyway (callback parse is pending-independent)', async () => {
    const { adapter, bridge } = await setupWithPending()

    await adapter.handleCardAction(USER, 'permit:req-99:yes')

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(USER, 'req-99', true, undefined)
  })
})

describe('FeishuAdapter — /new and /clear streaming-card lifecycle', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingCardInstances.length = 0
    msgSeq = 0
  })

  it('/clear deletes the binding, resets the bridge and resets the active card', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const card = streamingCardInstances[0] as CardDouble

    await sendEvent(adapter, textMsg('/clear'))

    expect(storeOf(adapter).delete).toHaveBeenCalledWith(USER)
    expect(bridge.resetSession).toHaveBeenCalledWith(USER)
    expect(card.reset).toHaveBeenCalledTimes(1)
    expect(cardsOf(adapter).has(USER)).toBe(false)
    expect(lastSent(bot)).toBe('🧹 已清空会话')
  })

  it('/new resets any previous streaming card before creating the session', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const card = streamingCardInstances[0] as CardDouble

    await sendEvent(adapter, textMsg('/new', { msgId: 'om_new2' }))

    expect(card.reset).toHaveBeenCalledTimes(1)
    expect(cardsOf(adapter).size).toBe(0)
    expect(lastSent(bot)).toContain('✅ 新会话已创建')
  })
})

describe('FeishuAdapter — message content parsing', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingCardInstances.length = 0
    msgSeq = 0
  })

  async function withBinding(adapter: FeishuAdapter): Promise<FeishuAdapter> {
    storeOf(adapter).set(USER, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })
    return adapter
  }

  it('DEFECT: 图片消息下载后 attachments 无人接收，只把空文本发给引擎', async () => {
    const bot = makeBot()
    const adapter = await withBinding(makeAdapter(bot))

    await sendEvent(adapter, typedMsg('image', { image_key: 'img_key_1' }, { msgId: 'om_img' }))

    expect(mediaOf(adapter).downloadImage).toHaveBeenCalledWith('om_img', 'img_key_1')
    expect(mediaOf(adapter).toAttachmentRef).toHaveBeenCalledTimes(1)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '')
  })

  it('downloads file messages with the original file name', async () => {
    const bot = makeBot()
    const adapter = await withBinding(makeAdapter(bot))

    await sendEvent(adapter, typedMsg('file', { file_key: 'fk_1', file_name: 'report.pdf' }, { msgId: 'om_file' }))

    expect(mediaOf(adapter).downloadFile).toHaveBeenCalledWith('om_file', 'fk_1', 'report.pdf')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(1)
  })

  it('synthesizes a file name when the file message omits it', async () => {
    const bot = makeBot()
    const adapter = await withBinding(makeAdapter(bot))

    await sendEvent(adapter, typedMsg('file', { file_key: 'fk_2' }, { msgId: 'om_file2' }))

    const [, , fileName] = mediaOf(adapter).downloadFile.mock.calls[0] as [string, string, string]
    expect(fileName).toMatch(/^feishu_file_\d+$/)
  })

  it('skips attachment handling when the media download fails (returns null)', async () => {
    const bot = makeBot()
    const adapter = await withBinding(makeAdapter(bot))
    mediaOf(adapter).downloadImage.mockResolvedValueOnce(null)

    await sendEvent(adapter, typedMsg('image', { image_key: 'img_key_x' }, { msgId: 'om_img_fail' }))

    expect(mediaOf(adapter).toAttachmentRef).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '')
  })

  it('extracts text nodes from rich-text posts and ignores non-text tags', async () => {
    const bot = makeBot()
    const adapter = await withBinding(makeAdapter(bot))

    await sendEvent(
      adapter,
      typedMsg(
        'post',
        {
          content: [
            [{ tag: 'text', text: '第一行' }, { tag: 'at', user_id: 'ou_x' }],
            [{ tag: 'text', text: '第二行' }],
            [{ tag: 'hr' }],
          ],
        },
        { msgId: 'om_post' }
      )
    )

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '第一行\n第二行')
  })

  it('rich-text post without text nodes yields empty text', async () => {
    const bot = makeBot()
    const adapter = await withBinding(makeAdapter(bot))

    await sendEvent(adapter, typedMsg('post', { title: '无文字' }, { msgId: 'om_post_empty' }))

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '')
  })

  it('falls back to the raw content string when JSON parsing fails', async () => {
    const bot = makeBot()
    const adapter = await withBinding(makeAdapter(bot))

    await sendEvent(adapter, typedMsg('text', '不是 JSON 的原始文本', { msgId: 'om_raw' }))

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '不是 JSON 的原始文本')
  })

  it('unknown message types arrive as empty text', async () => {
    const bot = makeBot()
    const adapter = await withBinding(makeAdapter(bot))

    await sendEvent(adapter, typedMsg('audio', { duration: 3 }, { msgId: 'om_audio' }))

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(USER, '')
  })
})

describe('FeishuAdapter — start / stop lifecycle', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingCardInstances.length = 0
    msgSeq = 0
  })

  it('start schedules the poll loop once and stop drains every timer', async () => {
    vi.useFakeTimers()
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    // constructor: only the dedup sweep interval is registered
    expect(vi.getTimerCount()).toBe(1)

    await adapter.start()
    expect(bot.getBotInfo).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(2)

    await adapter.start() // idempotent — no second poll loop
    expect(vi.getTimerCount()).toBe(2)

    await adapter.stop()
    await vi.advanceTimersByTimeAsync(2000)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('start rejects with a credential error when getBotInfo fails and never schedules polling', async () => {
    vi.useFakeTimers()
    const bot = makeBot()
    bot.getBotInfo.mockRejectedValue(new Error('invalid app_secret'))
    const adapter = makeAdapter(bot)

    await expect(adapter.start()).rejects.toThrow('Failed to validate Feishu app credentials')
    expect(vi.getTimerCount()).toBe(1) // only the sweep interval, no poll timer

    await adapter.stop()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stop destroys the bridge and clears the dedup sweep', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    await adapter.start()
    const bridge = bridgeOf(adapter)

    await adapter.stop()

    expect(bridge.destroy).toHaveBeenCalledTimes(1)
  })
})

describe('FeishuAdapter — error containment', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingCardInstances.length = 0
    msgSeq = 0
  })

  it('a bot send failure is swallowed by the chat queue and logged, not rethrown', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    bot.sendTextMessage.mockRejectedValue(new Error('network down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendEvent(adapter, textMsg('/health', { msgId: 'om_err' }))).resolves.toBeUndefined()

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
