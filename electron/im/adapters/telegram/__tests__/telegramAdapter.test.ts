// @vitest-environment node
/**
 * TelegramAdapter — main-process tests for the event-handling chain.
 *
 * Mocked seams (mirrors electron/im/adapters/feishu/__tests__/feishuAdapter.test.ts):
 * - WsBridge: captured per-instance doubles, handlers map drives handleServerMessage
 * - HttpClient / SessionStore: per-instance vi.fn doubles
 * - config: no fs access; saveConfig calls are asserted
 * - logger / StreamingMessage / MediaHandler: module doubles
 * Real modules: MessageDedup, ChatQueue, SessionRecovery, Pairing,
 * PermissionCard (inline keyboard / callback), commands, format, permission.
 *
 * Entry point: TelegramAdapter only exposes start/stop publicly; per-update
 * handling is a private handleUpdate driven by pollLoop. Tests call
 * handleUpdate directly (deterministic) and drive the real pollLoop once
 * through start() to cover the wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TelegramAdapter } from '@electron/im/adapters/telegram/telegramAdapter'
import type {
  TelegramDocument,
  TelegramPhotoSize,
  TelegramUpdate,
  TelegramUser,
} from '@electron/im/adapters/telegram/telegramBot'
import { TELEGRAM_COMMANDS } from '@electron/im/adapters/telegram/commands'
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
const streamingMessageInstances: unknown[] = []

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

vi.mock('@electron/im/adapters/telegram/streamingMessage', () => {
  return {
    StreamingMessage: class MockStreamingMessage {
      chatId: number
      append = vi.fn()
      complete = vi.fn(async () => {})
      reset = vi.fn()

      constructor(_bot: unknown, chatId: number) {
        this.chatId = chatId
        streamingMessageInstances.push(this)
      }
    },
  }
})

vi.mock('@electron/im/adapters/telegram/mediaHandler', () => {
  const imageMedia = {
    path: '/tmp/att/tg_img.png',
    fileName: 'tg_img.png',
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
    MediaHandler: class MockMediaHandler {
      downloadPhoto = vi.fn(async (_photos: TelegramPhotoSize[]) => imageMedia)
      downloadDocument = vi.fn(async (_doc: TelegramDocument) => fileMedia)
      toAttachmentRef = vi.fn(
        (media: { path: string; fileName: string; mimeType: string; type: 'image' | 'file' }) => ({
          type: media.type,
          name: media.fileName,
          path: media.path,
          mimeType: media.mimeType,
        })
      )
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

interface StreamingDouble {
  chatId: number
  append: MockFn
  complete: MockFn
  reset: MockFn
}

interface MediaDouble {
  downloadPhoto: MockFn
  downloadDocument: MockFn
  toAttachmentRef: MockFn
}

interface BotDouble {
  getMe: MockFn
  setMyCommands: MockFn
  sendMessage: MockFn
  editMessageText: MockFn
  answerCallbackQuery: MockFn
  getUpdates: MockFn
}

const CHAT_ID = 200
const CHAT_KEY = String(CHAT_ID)
const USER = '100'
const SERVER_URL = 'ws://127.0.0.1:5555'

function makeBot(): BotDouble {
  return {
    getMe: vi.fn(async () => ({ id: 42, is_bot: true, first_name: 'TestBot', username: 'test_bot' })),
    setMyCommands: vi.fn(async () => true),
    sendMessage: vi.fn(async () => ({ message_id: 5000 })),
    editMessageText: vi.fn(async () => undefined),
    answerCallbackQuery: vi.fn(async () => undefined),
    getUpdates: vi.fn(async () => []),
  }
}

function makeFrom(o: { id?: number; firstName?: string; lastName?: string } = {}): TelegramUser {
  return {
    id: o.id ?? Number(USER),
    is_bot: false,
    first_name: o.firstName ?? 'Alice',
    ...(o.lastName ? { last_name: o.lastName } : {}),
  }
}

let updateSeq = 0

function makeUpdate(
  o: {
    text?: string
    updateId?: number
    from?: TelegramUser
    photo?: TelegramPhotoSize[]
    document?: TelegramDocument
  } = {}
): TelegramUpdate {
  const updateId = o.updateId ?? (updateSeq += 1)
  return {
    update_id: updateId,
    message: {
      message_id: 1000 + updateId,
      chat: { id: CHAT_ID, type: 'private' },
      ...(o.text !== undefined ? { text: o.text } : {}),
      ...(o.photo ? { photo: o.photo } : {}),
      ...(o.document ? { document: o.document } : {}),
      from: o.from ?? makeFrom(),
    },
  }
}

function callbackUpdate(
  data: string,
  o: { chatId?: number; callbackId?: string; withMessage?: boolean } = {}
): TelegramUpdate {
  return {
    update_id: (updateSeq += 1),
    callback_query: {
      id: o.callbackId ?? 'cbq_1',
      from: makeFrom(),
      ...(o.withMessage === false
        ? {}
        : { message: { message_id: 2000, chat: { id: o.chatId ?? CHAT_ID, type: 'private' } } }),
      data,
    },
  }
}

function bridgeOf(adapter: TelegramAdapter): BridgeDouble {
  return (adapter as unknown as { bridge: BridgeDouble }).bridge
}
function storeOf(adapter: TelegramAdapter): StoreDouble {
  return (adapter as unknown as { sessionStore: StoreDouble }).sessionStore
}
function httpOf(adapter: TelegramAdapter): HttpDouble {
  return (adapter as unknown as { httpClient: HttpDouble }).httpClient
}
function streamingMapOf(adapter: TelegramAdapter): Map<number, StreamingDouble> {
  return (adapter as unknown as { streamingMessages: Map<number, StreamingDouble> }).streamingMessages
}
function mediaOf(adapter: TelegramAdapter): MediaDouble {
  return (adapter as unknown as { mediaHandler: MediaDouble }).mediaHandler
}

/** Drive one inbound update through the private handleUpdate (pollLoop body). */
async function sendUpdate(adapter: TelegramAdapter, update: TelegramUpdate): Promise<void> {
  await (adapter as unknown as { handleUpdate: (u: TelegramUpdate) => Promise<void> }).handleUpdate(update)
}

function sentText(bot: BotDouble): string[] {
  return bot.sendMessage.mock.calls.map((c: unknown[]) => String(c[1]))
}

function lastSent(bot: BotDouble): string {
  const all = sentText(bot)
  return all[all.length - 1] ?? ''
}

const createdAdapters: TelegramAdapter[] = []

function makeAdapter(bot: BotDouble, config?: AdapterConfig): TelegramAdapter {
  const adapter = new TelegramAdapter({
    bot: bot as unknown as import('@electron/im/adapters/telegram/telegramBot').TelegramBot,
    config: config ?? makeConfig(),
    serverUrl: SERVER_URL,
  })
  createdAdapters.push(adapter)
  return adapter
}

function makeConfig(
  o: { pairingCode?: string | null; pairedUserIds?: string[]; workDir?: string } = {}
): AdapterConfig {
  const pairingCode = o.pairingCode === undefined ? 'TESTCODE' : o.pairingCode
  return {
    serverUrl: 'ws://127.0.0.1:3456',
    defaultProjectDir: '/tmp/proj-default',
    pairing: { code: pairingCode, expiresAt: Date.now() + 3_600_000, createdAt: Date.now() },
    telegram: {
      allowedUsers: [],
      pairedUsers: (o.pairedUserIds === undefined ? [USER] : o.pairedUserIds).map((userId) => ({
        userId,
        pairedAt: Date.now(),
      })),
      defaultWorkDir: o.workDir === undefined ? '/tmp/tg-work' : o.workDir,
      botToken: 'test-token',
    },
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
  }
}

/** Run /new so the server-message handler is registered on the live bridge. */
async function setupSession(
  bot: BotDouble,
  config?: AdapterConfig
): Promise<{ adapter: TelegramAdapter; bridge: BridgeDouble; handler: MessageHandler }> {
  const adapter = makeAdapter(bot, config)
  await sendUpdate(adapter, makeUpdate({ text: '/new' }))
  const bridge = bridgeOf(adapter)
  const handler = bridge.handlers.get(CHAT_KEY)
  if (!handler) throw new Error('onServerMessage handler was not registered by createSession')
  bridge.sendUserMessage.mockClear()
  bridge.sendPermissionResponse.mockClear()
  bridge.resetSession.mockClear()
  bot.sendMessage.mockClear()
  return { adapter, bridge, handler }
}

// Root hooks: fresh mock state + guaranteed adapter teardown for every suite.
beforeEach(() => {
  vi.clearAllMocks()
  wsBridgeInstances.length = 0
  streamingMessageInstances.length = 0
  updateSeq = 0
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

describe('TelegramAdapter — handleUpdate entry routing', () => {
  it('ignores updates without message and without callback_query', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendUpdate(adapter, { update_id: 1 } as TelegramUpdate)
    await sendUpdate(adapter, { update_id: 2, callback_query: { id: 'cbq_x', from: makeFrom() } })

    expect(bot.sendMessage).toHaveBeenCalledTimes(0)
    expect(bot.answerCallbackQuery).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })

  it('dedups repeated update_id and processes it exactly once', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    const update = makeUpdate({ text: '/health', updateId: 777 })

    await sendUpdate(adapter, update)
    await sendUpdate(adapter, update)

    expect(sentText(bot)).toEqual(['✅ 适配器运行正常'])
  })

  it('routes a paired plain-text message to the stored session binding', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_KEY, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendUpdate(adapter, makeUpdate({ text: '继续写代码' }))

    expect(httpOf(adapter).sessionExists).toHaveBeenCalledWith('sess-stored-1')
    expect(bridgeOf(adapter).connectSession).toHaveBeenCalledWith(CHAT_KEY, 'sess-stored-1', '/tmp/stored-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '继续写代码')
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })
})

describe('TelegramAdapter — command parsing & routing', () => {
  it('/help sends the formatted command list', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendUpdate(adapter, makeUpdate({ text: '/help' }))

    const help = lastSent(bot)
    expect(help).toContain('📋 可用命令')
    expect(help).toContain('/new')
    expect(bot.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('unknown slash commands are not intercepted and reach the engine as chat text', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_KEY, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendUpdate(adapter, makeUpdate({ text: '/foobar arg' }))

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '/foobar arg')
  })

  it('parses commands case-insensitively with an @bot suffix and args', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendUpdate(adapter, makeUpdate({ text: '/HEALTH@test_bot' }))

    expect(lastSent(bot)).toBe('✅ 适配器运行正常')
  })

  it('/stop signals stop-generation on the bridge and confirms to the user', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendUpdate(adapter, makeUpdate({ text: '/stop' }))

    expect(bridgeOf(adapter).sendStopGeneration).toHaveBeenCalledWith(CHAT_KEY)
    expect(lastSent(bot)).toBe('⏹️ 已请求停止生成')
  })

  it('/clear deletes the binding, resets the bridge and resets the active streaming message', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const sm = streamingMessageInstances[0] as StreamingDouble
    storeOf(adapter).set(CHAT_KEY, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendUpdate(adapter, makeUpdate({ text: '/clear' }))

    expect(storeOf(adapter).delete).toHaveBeenCalledWith(CHAT_KEY)
    expect(bridgeOf(adapter).resetSession).toHaveBeenCalledWith(CHAT_KEY)
    expect(sm.reset).toHaveBeenCalledTimes(1)
    expect(streamingMapOf(adapter).size).toBe(0)
    expect(lastSent(bot)).toBe('🧹 已清空会话')
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
    for (const [command] of expected) {
      await sendUpdate(adapter, makeUpdate({ text: command }))
    }

    expect(sentText(bot).slice(-expected.length)).toEqual(expected.map(([, copy]) => copy))
  })
})

describe('TelegramAdapter — pairing gate & commands', () => {
  it('routes an unpaired plain-text user into pairing and never reaches the engine', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairedUserIds: [] }))

    await sendUpdate(adapter, makeUpdate({ text: 'hello there', from: makeFrom({ id: 999 }) }))

    expect(lastSent(bot)).toBe('❌ 配对码不正确') // mismatch against TESTCODE
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })

  it('a message without a sender is treated as unpaired (userId defaults to empty)', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairedUserIds: [] }))
    const update = makeUpdate({ text: 'hi' })
    delete (update.message as { from?: TelegramUser }).from

    await sendUpdate(adapter, update)

    expect(lastSent(bot)).toBe('❌ 配对码不正确')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })

  it('allowedUsers whitelist grants access without pairing', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    config.telegram.allowedUsers = ['555']
    const adapter = makeAdapter(bot, config)
    storeOf(adapter).set(CHAT_KEY, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendUpdate(adapter, makeUpdate({ text: '在吗', from: makeFrom({ id: 555 }) }))

    // NOTE: pairing keys on the user id, but sessions key on the chat id
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '在吗')
    expect(bot.sendMessage).toHaveBeenCalledTimes(0)
  })

  it('/pair without args replies with usage and does not persist config', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairedUserIds: [] }))

    await sendUpdate(adapter, makeUpdate({ text: '/pair', from: makeFrom({ id: 999 }) }))

    expect(lastSent(bot)).toBe('用法: /pair <配对码>')
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/pair with the right code pairs the user, clears the code and persists', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    const adapter = makeAdapter(bot, config)

    await sendUpdate(
      adapter,
      makeUpdate({ text: '/pair TESTCODE', from: makeFrom({ id: 999, firstName: 'Bob', lastName: 'Chen' }) })
    )

    expect(lastSent(bot)).toBe('✅ 配对成功！欢迎，Bob Chen\n\n使用 /help 查看可用命令')
    expect(config.telegram.pairedUsers.map((u) => u.userId)).toEqual(['999'])
    expect(config.pairing.code).toBeNull()
    expect(saveConfig).toHaveBeenCalledTimes(1)

    // now paired: a plain message reaches the engine path (session creation)
    await sendUpdate(adapter, makeUpdate({ text: '你好', from: makeFrom({ id: 999 }) }))
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/tg-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '你好')
  })

  it('/pair with a wrong code replies mismatch and records an attempt', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    const adapter = makeAdapter(bot, config)

    await sendUpdate(adapter, makeUpdate({ text: '/pair NOPE11', from: makeFrom({ id: 999 }) }))

    expect(lastSent(bot)).toBe('❌ 配对码不正确')
    expect(config.telegram.pairedUsers).toHaveLength(0)
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/pair with an expired code replies 配对码已过期', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    config.pairing.expiresAt = Date.now() - 1000
    const adapter = makeAdapter(bot, config)

    await sendUpdate(adapter, makeUpdate({ text: '/pair TESTCODE', from: makeFrom({ id: 999 }) }))

    expect(lastSent(bot)).toBe('❌ 配对码已过期，请重新生成')
  })

  it('rate-limits pairing after 5 failed attempts', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedUserIds: [] })
    const adapter = makeAdapter(bot, config)

    for (let i = 0; i < 5; i++) {
      await sendUpdate(adapter, makeUpdate({ text: `/pair WRONG${i}`, from: makeFrom({ id: 999 }) }))
    }
    expect(sentText(bot).filter((t) => t === '❌ 配对码不正确')).toHaveLength(5)

    await sendUpdate(adapter, makeUpdate({ text: '/pair TESTCODE', from: makeFrom({ id: 999 }) }))
    expect(lastSent(bot)).toBe('❌ 尝试次数过多，请稍后再试')
    expect(config.telegram.pairedUsers).toHaveLength(0)
  })

  it('/pair from an already-paired user short-circuits with 您已配对', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendUpdate(adapter, makeUpdate({ text: '/pair TESTCODE' }))

    expect(lastSent(bot)).toBe('✅ 您已配对，可以直接发送消息')
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/unpair removes the paired user and persists', async () => {
    const bot = makeBot()
    const config = makeConfig()
    const adapter = makeAdapter(bot, config)

    await sendUpdate(adapter, makeUpdate({ text: '/unpair' }))

    expect(lastSent(bot)).toBe('已取消配对')
    expect(config.telegram.pairedUsers).toHaveLength(0)
    expect(saveConfig).toHaveBeenCalledTimes(1)
  })
})

describe('TelegramAdapter — session creation & recovery', () => {
  it('/new creates a session, rebinds the bridge and registers the message handler', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendUpdate(adapter, makeUpdate({ text: '/new' }))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/tg-work')
    expect(storeOf(adapter).set).toHaveBeenCalledWith(CHAT_KEY, {
      sessionId: 'sess-new-123456789',
      workDir: '/tmp/tg-work',
    })

    const first = wsBridgeInstances[0] as BridgeDouble
    const second = wsBridgeInstances[1] as BridgeDouble
    expect(first.resetSession).toHaveBeenCalledWith(CHAT_KEY)
    expect(second.serverUrl).toBe(SERVER_URL)
    expect(second.authToken).toBe('tok-new-1')
    expect(second.connectSession).toHaveBeenCalledWith(CHAT_KEY, 'sess-new-123456789', '/tmp/tg-work')
    expect(second.handlers.has(CHAT_KEY)).toBe(true)
    expect(bridgeOf(adapter)).toBe(second)
    expect(lastSent(bot)).toBe('✅ 新会话已创建\n📁 目录: /tmp/tg-work\n🆔 sess-new...')
  })

  it('/new falls back to defaultProjectDir when telegram.defaultWorkDir is empty', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ workDir: '' }))

    await sendUpdate(adapter, makeUpdate({ text: '/new' }))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/proj-default')
  })

  it('sends the triggering message right after auto-creating a session', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendUpdate(adapter, makeUpdate({ text: '第一条消息' }))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/tg-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '第一条消息')
  })

  it('recovery over a dead server session deletes the binding and creates a fresh session', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_KEY, { sessionId: 'sess-dead-1', workDir: '/tmp/stored-work' })
    httpOf(adapter).sessionExists.mockResolvedValue(false)

    await sendUpdate(adapter, makeUpdate({ text: 'hi' }))

    expect(httpOf(adapter).sessionExists).toHaveBeenCalledWith('sess-dead-1')
    expect(storeOf(adapter).delete).toHaveBeenCalledWith(CHAT_KEY)
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/tg-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, 'hi')
  })

  it('treats a sessionExists network failure as alive and reconnects instead of recreating', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_KEY, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })
    httpOf(adapter).sessionExists.mockRejectedValue(new Error('ECONNREFUSED'))

    await sendUpdate(adapter, makeUpdate({ text: 'hi' }))

    expect(bridgeOf(adapter).connectSession).toHaveBeenCalledWith(CHAT_KEY, 'sess-stored-1', '/tmp/stored-work')
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, 'hi')
  })

  it('replies 创建会话失败 when the session API rejects', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).createSession.mockRejectedValue(new Error('HTTP 500: gateway down'))

    await sendUpdate(adapter, makeUpdate({ text: 'hi' }))

    expect(lastSent(bot)).toContain('❌ 创建会话失败: Error: HTTP 500: gateway down')
    expect(storeOf(adapter).set).toHaveBeenCalledTimes(0)
    // Pinned current behavior: despite the failure the text is still pushed to the OLD bridge
    expect(wsBridgeInstances[0] as BridgeDouble).toBe(bridgeOf(adapter))
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, 'hi')
  })
})

describe('TelegramAdapter — projects commands', () => {
  const twoProjects = [
    { name: 'alpha', path: '/tmp/proj/alpha' },
    { name: 'beta', path: '/tmp/other/beta' },
  ]

  it('/projects with an empty list replies 没有最近的项目', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendUpdate(adapter, makeUpdate({ text: '/projects' }))

    expect(lastSent(bot)).toBe('📭 没有最近的项目\n使用 /new 创建新会话')
  })

  it('/projects without args renders a numbered project list', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockResolvedValue(twoProjects)

    await sendUpdate(adapter, makeUpdate({ text: '/projects' }))

    expect(bot.sendMessage).toHaveBeenCalledTimes(1)
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

    await sendUpdate(adapter, makeUpdate({ text: '/projects beta' }))

    expect(httpOf(adapter).matchProject).toHaveBeenCalledWith('beta', twoProjects)
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/other/beta')
    expect(storeOf(adapter).set).toHaveBeenCalledWith(CHAT_KEY, {
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
    await sendUpdate(adapter, makeUpdate({ text: '/projects ghost' }))
    expect(lastSent(bot)).toBe('❌ 未找到匹配的项目')

    httpOf(adapter).matchProject.mockReturnValue('ambiguous')
    await sendUpdate(adapter, makeUpdate({ text: '/projects b' }))
    expect(lastSent(bot)).toBe('❌ 匹配到多个项目，请更精确地指定')

    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })

  it('/projects reports API failures to the user', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockRejectedValue(new Error('ECONNREFUSED'))

    await sendUpdate(adapter, makeUpdate({ text: '/projects' }))

    expect(lastSent(bot)).toContain('❌ 获取项目列表失败')
    expect(lastSent(bot)).toContain('ECONNREFUSED')
  })
})

describe('TelegramAdapter — server message handling (streaming)', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingMessageInstances.length = 0
    updateSeq = 0
  })

  it('content_start(text) creates a streaming message; tool_use start does not', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'tool_use', toolName: 'Bash' })
    expect(streamingMessageInstances).toHaveLength(0)
    expect(streamingMapOf(adapter).size).toBe(0)

    await handler({ type: 'content_start', blockType: 'text' })
    expect(streamingMessageInstances).toHaveLength(1)
    expect((streamingMessageInstances[0] as StreamingDouble).chatId).toBe(CHAT_ID)
    expect(streamingMapOf(adapter).get(CHAT_ID)).toBe(streamingMessageInstances[0] as StreamingDouble)
  })

  it('content_delta appends to the active streaming message and lazy-creates one without content_start', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const first = streamingMessageInstances[0] as StreamingDouble

    await handler({ type: 'content_delta', text: '你好' })
    expect(first.append).toHaveBeenCalledWith('你好')
    expect(first.append).toHaveBeenCalledTimes(1)

    // no streaming message registered for this chat → lazy-create a second one
    streamingMapOf(adapter).clear()
    await handler({ type: 'content_delta', text: 'late chunk' })
    const second = streamingMessageInstances[1] as StreamingDouble
    expect(second.append).toHaveBeenCalledWith('late chunk')
    expect(streamingMapOf(adapter).get(CHAT_ID)).toBe(second)
  })

  it('content_delta without text is ignored', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_delta' })

    expect(streamingMessageInstances).toHaveLength(0)
    expect(streamingMapOf(adapter).size).toBe(0)
  })

  it('status idle completes the streaming message once and removes it from the map', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const sm = streamingMessageInstances[0] as StreamingDouble

    await handler({ type: 'status', state: 'idle' })
    expect(sm.complete).toHaveBeenCalledTimes(1)
    expect(streamingMapOf(adapter).has(CHAT_ID)).toBe(false)

    await handler({ type: 'status', state: 'idle' })
    expect(sm.complete).toHaveBeenCalledTimes(1)
  })

  it('tool_use_complete closes the streaming message and sends the formatted tool line', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const sm = streamingMessageInstances[0] as StreamingDouble

    await handler({ type: 'tool_use_complete', toolName: 'Bash', toolUseId: 'tu_1', input: { command: 'ls -la' } })

    expect(sm.complete).toHaveBeenCalledTimes(1)
    expect(streamingMapOf(adapter).has(CHAT_ID)).toBe(false)
    expect(lastSent(bot)).toBe('🔧 Bash(command: ls -la)')
  })

  it('tool_result only surfaces errors and truncates them to 500 chars', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'tool_result', toolUseId: 'tu_1', content: 'fine', isError: false })
    expect(bot.sendMessage).toHaveBeenCalledTimes(0)

    const long = 'x'.repeat(600)
    await handler({ type: 'tool_result', toolUseId: 'tu_2', content: long, isError: true })
    expect(bot.sendMessage).toHaveBeenCalledWith(CHAT_ID, `❌ 工具错误: ${'x'.repeat(500)}`)
  })

  it('message_complete always reports token usage even without cache counters', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_start', blockType: 'text' })
    const sm = streamingMessageInstances[0] as StreamingDouble

    await handler({ type: 'message_complete', usage: { inputTokens: 12, outputTokens: 3400 } })

    expect(sm.complete).toHaveBeenCalledTimes(1)
    expect(streamingMapOf(adapter).has(CHAT_ID)).toBe(false)
    expect(lastSent(bot)).toBe('📊 Token: ↓12 ↑3400')
  })

  it('message_complete adds a cache line only when cache counters are present', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({
      type: 'message_complete',
      usage: { inputTokens: 5, outputTokens: 6, cacheReadInputTokens: 7, cacheCreationInputTokens: 8 },
    })

    expect(lastSent(bot)).toBe('📊 Token: ↓5 ↑6\n💾 Cache: 7/8')
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

    expect(bot.sendMessage).toHaveBeenCalledTimes(0)
    expect(streamingMapOf(adapter).size).toBe(0)
  })

  it('connected messages are logged only — no user-visible reply and no streaming message', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'connected', sessionId: 'sess-new-123456789' })

    expect(bot.sendMessage).toHaveBeenCalledTimes(0)
    expect(streamingMapOf(adapter).size).toBe(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })
})

describe('TelegramAdapter — permission cards & quick replies', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingMessageInstances.length = 0
    updateSeq = 0
  })

  it('permission_request sends the request text with a 3-button inline keyboard', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({
      type: 'permission_request',
      requestId: 'perm-1',
      toolName: 'Write',
      input: { file_path: '/tmp/tg-work/a.txt' },
      description: '写入文件',
    })

    expect(bot.sendMessage).toHaveBeenCalledTimes(1)
    const [chatId, text, opts] = bot.sendMessage.mock.calls[0] as [number, string, { reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } }]
    expect(chatId).toBe(CHAT_ID)
    expect(text).toContain('🔐 权限请求')
    expect(text).toContain('工具: Write')
    const buttons = opts.reply_markup?.inline_keyboard[0] ?? []
    expect(buttons.map((b) => b.callback_data)).toEqual(['permit:perm-1:yes', 'permit:perm-1:always', 'permit:perm-1:no'])
    expect(buttons.map((b) => b.text)).toEqual(['✅ 允许', '♾️ 永久允许', '❌ 拒绝'])
  })

  it('quick reply 1 allows the single pending request', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-1', toolName: 'Bash', input: { command: 'ls' } })
    bot.sendMessage.mockClear()

    await sendUpdate(adapter, makeUpdate({ text: '1' }))

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(CHAT_KEY, 'perm-1', true, undefined)
    expect(lastSent(bot)).toBe('✅ 已允许')
    expect(bridge.sendUserMessage).toHaveBeenCalledTimes(0)
  })

  it('quick reply 3 denies the pending request', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-d', toolName: 'Bash', input: {} })

    await sendUpdate(adapter, makeUpdate({ text: '3' }))

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(CHAT_KEY, 'perm-d', false, undefined)
    expect(lastSent(bot)).toBe('✅ 已拒绝')
  })

  it('without a pending permission a quick-reply word is chat text and reaches the engine', async () => {
    const bot = makeBot()
    const { adapter, bridge } = await setupSession(bot)

    await sendUpdate(adapter, makeUpdate({ text: '1' }))

    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '1')
  })

  it('consuming a quick reply pops the pending entry — the next word is chat text', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-1', toolName: 'Bash', input: { command: 'ls' } })
    bridge.sendPermissionResponse.mockClear()

    await sendUpdate(adapter, makeUpdate({ text: '1' }))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(1)
    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(CHAT_KEY, 'perm-1', true, undefined)
    expect(bridge.sendUserMessage).toHaveBeenCalledTimes(0)

    await sendUpdate(adapter, makeUpdate({ text: 'allow' }))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(1)
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, 'allow')
  })

  it('explicit /always <tool> resolves the requestId from the pending list by tool name', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-a', toolName: 'Bash', input: {} })

    await sendUpdate(adapter, makeUpdate({ text: '/always bash' })) // case-insensitive match

    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(CHAT_KEY, 'perm-a', true, 'always')
    expect(lastSent(bot)).toBe('✅ 已允许')

    // consumed → a later quick-reply word is chat text
    bridge.sendPermissionResponse.mockClear()
    await sendUpdate(adapter, makeUpdate({ text: '1' }))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '1')
  })

  it('explicit command naming an unlisted tool replies with an error and sends nothing to the engine', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-w', toolName: 'Write', input: {} })

    await sendUpdate(adapter, makeUpdate({ text: '/always Bash' }))

    expect(lastSent(bot)).toBe('❌ 未找到与工具 Bash 匹配的待处理权限请求')
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
  })
})

describe('TelegramAdapter — callback query handling', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingMessageInstances.length = 0
    updateSeq = 0
  })

  it('permit:xxx:yes answers the callback and allows with no rule', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'req-1', toolName: 'Bash', input: {} })
    bridge.sendPermissionResponse.mockClear()

    await sendUpdate(adapter, callbackUpdate('permit:req-1:yes', { callbackId: 'cbq_yes' }))

    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cbq_yes')
    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(CHAT_KEY, 'req-1', true, undefined)
   })

  it('permit:xxx:no denies and permit:xxx:always allows with the always rule', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'req-1', toolName: 'Bash', input: {} })
    bridge.sendPermissionResponse.mockClear()

    await sendUpdate(adapter, callbackUpdate('permit:req-1:no', { callbackId: 'cbq_no' }))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(CHAT_KEY, 'req-1', false, undefined)

    await handler({ type: 'permission_request', requestId: 'req-2', toolName: 'Bash', input: {} })
    bridge.sendPermissionResponse.mockClear()

    await sendUpdate(adapter, callbackUpdate('permit:req-2:always', { callbackId: 'cbq_always' }))
    expect(bridge.sendPermissionResponse).toHaveBeenCalledWith(CHAT_KEY, 'req-2', true, 'always')
  })

  it('edits the card message to show the decision after a button press', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'req-1', toolName: 'Bash', input: {} })
    bot.sendMessage.mockClear()
    bot.editMessageText.mockClear()

    await sendUpdate(adapter, callbackUpdate('permit:req-1:yes'))

    expect(bot.editMessageText).toHaveBeenCalledWith(
      CHAT_ID,
      5000,
      expect.stringContaining('✅ 已允许')
    )
    expect(bot.editMessageText).toHaveBeenCalledWith(
      CHAT_ID,
      5000,
      expect.stringContaining('req-1')
    )
  })

  it('unparsable callback data is ignored — nothing is sent to the engine', async () => {
    const bot = makeBot()
    const { adapter, bridge } = await setupSession(bot)

    await sendUpdate(adapter, callbackUpdate('some:other:action'))
    await sendUpdate(adapter, callbackUpdate('permit:req-1:maybe'))

    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
  })

  it('a callback_query without an attached message is dropped entirely', async () => {
    const bot = makeBot()
    const { adapter, bridge } = await setupSession(bot)

    await sendUpdate(adapter, callbackUpdate('permit:req-1:yes', { withMessage: false }))

    expect(bot.answerCallbackQuery).toHaveBeenCalledTimes(0)
    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
  })
})

describe('TelegramAdapter — media messages', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingMessageInstances.length = 0
    updateSeq = 0
  })

  it('DEFECT: 图片下载后 attachments 无人接收，只把空文本发给引擎', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_KEY, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    const photo: TelegramPhotoSize[] = [
      { file_id: 'fid_small', file_unique_id: 'u1', width: 90, height: 90 },
      { file_id: 'fid_big', file_unique_id: 'u2', width: 800, height: 600 },
    ]
    await sendUpdate(adapter, makeUpdate({ photo }))

    expect(mediaOf(adapter).downloadPhoto).toHaveBeenCalledWith(photo)
    expect(mediaOf(adapter).toAttachmentRef).toHaveBeenCalledTimes(1)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '')
  })

  it('skips the attachment ref when the photo download fails (returns null)', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_KEY, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })
    mediaOf(adapter).downloadPhoto.mockResolvedValueOnce(null)

    await sendUpdate(adapter, makeUpdate({ photo: [{ file_id: 'f', file_unique_id: 'u', width: 1, height: 1 }] }))

    expect(mediaOf(adapter).toAttachmentRef).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '')
  })

  it('downloads documents and still sends only the text/caption to the engine', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_KEY, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    const document: TelegramDocument = {
      file_id: 'fid_doc',
      file_unique_id: 'ud',
      file_name: 'report.pdf',
      mime_type: 'application/pdf',
    }
    await sendUpdate(adapter, makeUpdate({ text: '看下这个文件', document }))

    expect(mediaOf(adapter).downloadDocument).toHaveBeenCalledWith(document)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '看下这个文件')
  })

  it('uses the caption as message text for media messages', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_KEY, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    const update = makeUpdate({ photo: [{ file_id: 'f', file_unique_id: 'u', width: 1, height: 1 }] })
    update.message!.caption = '图片说明'
    await sendUpdate(adapter, update)

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_KEY, '图片说明')
  })
})

describe('TelegramAdapter — start / stop lifecycle', () => {
  beforeEach(() => {
    wsBridgeInstances.length = 0
    streamingMessageInstances.length = 0
    updateSeq = 0
  })

  it('start validates the bot, syncs the command menu and begins polling; second start is a no-op', async () => {
    const bot = makeBot()
    bot.getUpdates = vi.fn(() => new Promise(() => {})) // park the poll loop
    const adapter = makeAdapter(bot)

    await adapter.start()
    expect(bot.getMe).toHaveBeenCalledTimes(1)
    expect(bot.setMyCommands).toHaveBeenCalledTimes(1)
    expect(bot.setMyCommands).toHaveBeenCalledWith(TELEGRAM_COMMANDS)
    expect(bot.getUpdates).toHaveBeenCalledTimes(1)

    await adapter.start() // idempotent — no second poll loop, no re-validation
    expect(bot.getMe).toHaveBeenCalledTimes(1)
    expect(bot.getUpdates).toHaveBeenCalledTimes(1)

    await adapter.stop()
  })

  it('start rejects with a credential error when getMe fails and never polls', async () => {
    const bot = makeBot()
    bot.getMe.mockRejectedValue(new Error('401 Unauthorized'))
    const adapter = makeAdapter(bot)

    await expect(adapter.start()).rejects.toThrow('Failed to validate bot token')
    expect(bot.getUpdates).toHaveBeenCalledTimes(0)

    await adapter.stop()
  })

  it('start tolerates a setMyCommands failure (warn path) and still polls', async () => {
    const bot = makeBot()
    bot.setMyCommands.mockRejectedValue(new Error('network down'))
    bot.getUpdates = vi.fn(() => new Promise(() => {}))
    const adapter = makeAdapter(bot)

    await adapter.start()

    expect(bot.getUpdates).toHaveBeenCalledTimes(1)
    await adapter.stop()
  })

  it('drives inbound updates from the real poll loop', async () => {
    const bot = makeBot()
    bot.getUpdates = vi
      .fn()
      .mockResolvedValueOnce([makeUpdate({ text: '/health' })])
      .mockImplementation(() => new Promise(() => {}))
    const adapter = makeAdapter(bot)

    await adapter.start()
    await vi.waitFor(() => {
      expect(sentText(bot)).toContain('✅ 适配器运行正常')
    })

    await adapter.stop()
  })

  it('retries polling 3s after a getUpdates failure', async () => {
    vi.useFakeTimers()
    const bot = makeBot()
    bot.getUpdates = vi
      .fn()
      .mockRejectedValueOnce(new Error('poll timeout'))
      .mockImplementation(() => new Promise(() => {}))
    const adapter = makeAdapter(bot)

    await adapter.start()
    expect(bot.getUpdates).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(0) // flush the rejection handling
    await vi.advanceTimersByTimeAsync(3000)
    expect(bot.getUpdates).toHaveBeenCalledTimes(2)

    await adapter.stop()
    expect(vi.getTimerCount()).toBe(0) // dedup sweep cleared, poll loop parked
  })

  it('stop destroys the bridge and clears the dedup sweep', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    await adapter.start()

    await adapter.stop()

    expect(bridgeOf(adapter).destroy).toHaveBeenCalledTimes(1)
  })
})

describe('TelegramAdapter — error containment', () => {
  it('a bot send failure is swallowed by the chat queue and logged, not rethrown', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    bot.sendMessage.mockRejectedValue(new Error('network down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendUpdate(adapter, makeUpdate({ text: '/health' }))).resolves.toBeUndefined()

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
