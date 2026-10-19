// @vitest-environment node
/**
 * WhatsappAdapter — main-process tests for the event-handling chain.
 *
 * Mocked seams (mirrors telegramAdapter.test.ts):
 * - WsBridge: captured per-instance doubles, handlers map drives handleServerMessage
 * - HttpClient / SessionStore: per-instance vi.fn doubles
 * - config: no fs access; saveConfig calls are asserted
 * - logger / WhatsappMediaHandler: module doubles
 * Real modules: MessageDedup, ChatQueue, SessionRecovery, Pairing, commands, format.
 *
 * Entry point: the adapter registers a private handleIncomingMessage via
 * bot.onMessage in the constructor. Tests capture that callback from the bot
 * double and await it directly — handleIncomingMessage awaits ChatQueue.enqueue,
 * and the queue swallows handler errors, so awaiting is deterministic.
 *
 * Pinned current behavior (documented defects, same ledger as telegram):
 * - media attachments are collected but never forwarded to the engine
 * - parsePermissionCommand is a dead import — there are no plain-text quick
 *   replies; "1"/"allow" reach the engine as chat text
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WhatsappAdapter } from '@electron/im/adapters/whatsapp/whatsappAdapter'
import type { WhatsappBot, WhatsappMessage } from '@electron/im/adapters/whatsapp/whatsappBot'
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

vi.mock('@electron/im/adapters/whatsapp/mediaHandler', () => {
  const imageMedia = {
    path: '/tmp/att/wa_img.png',
    fileName: 'wa_img.png',
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
    WhatsappMediaHandler: class MockMediaHandler {
      downloadImage = vi.fn(async (_url: string, _mimeType: string) => imageMedia)
      downloadDocument = vi.fn(async (_url: string, _fileName: string, _mimeType: string) => fileMedia)
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

interface MediaDouble {
  downloadImage: MockFn
  downloadDocument: MockFn
  toAttachmentRef: MockFn
  uploadImage: MockFn
}

interface BotDouble {
  start: MockFn
  isConnected: MockFn
  onMessage: MockFn
  sendTextMessage: MockFn
  sendPresence: MockFn
}

const CHAT_ID = '8613800138000@s.whatsapp.net'
const OTHER_JID = '8619999999999@s.whatsapp.net'
const SERVER_URL = 'ws://127.0.0.1:5555'

function makeBot(o: { connected?: boolean } = {}): BotDouble {
  return {
    start: vi.fn(async () => {}),
    isConnected: vi.fn((): boolean => o.connected ?? true),
    onMessage: vi.fn((_callback?: unknown) => {}),
    sendTextMessage: vi.fn(async () => ({ key: { id: 'wamid-out', remoteJid: CHAT_ID } })),
    sendPresence: vi.fn(async () => {}),
  }
}

let msgSeq = 0

function makeMsg(
  o: {
    jid?: string
    id?: string
    fromMe?: boolean
    text?: string
    image?: { url: string; mimetype: string; caption?: string }
    document?: { url: string; mimetype: string; fileName: string }
    pushName?: string
  } = {}
): WhatsappMessage {
  const message: WhatsappMessage['message'] = {}
  if (o.text !== undefined) message.conversation = o.text
  if (o.image) message.imageMessage = o.image
  if (o.document) message.documentMessage = o.document
  return {
    key: { remoteJid: o.jid ?? CHAT_ID, fromMe: o.fromMe ?? false, id: o.id ?? `wamid-${(msgSeq += 1)}` },
    message,
    messageTimestamp: 1700000000 + msgSeq,
    ...(o.pushName ? { pushName: o.pushName } : {}),
  }
}

function bridgeOf(adapter: WhatsappAdapter): BridgeDouble {
  return (adapter as unknown as { bridge: BridgeDouble }).bridge
}
function storeOf(adapter: WhatsappAdapter): StoreDouble {
  return (adapter as unknown as { sessionStore: StoreDouble }).sessionStore
}
function httpOf(adapter: WhatsappAdapter): HttpDouble {
  return (adapter as unknown as { httpClient: HttpDouble }).httpClient
}
function mediaOf(adapter: WhatsappAdapter): MediaDouble {
  return (adapter as unknown as { mediaHandler: MediaDouble }).mediaHandler
}
function fullTextsOf(adapter: WhatsappAdapter): Map<string, string> {
  return (adapter as unknown as { fullTexts: Map<string, string> }).fullTexts
}
function pendingOf(
  adapter: WhatsappAdapter
): Map<string, Array<{ requestId: string; toolName: string }>> {
  return (adapter as unknown as { pendingPermissions: Map<string, Array<{ requestId: string; toolName: string }>> })
    .pendingPermissions
}

/** Drive one inbound WhatsApp message through the handler the adapter registered. */
async function sendMsg(adapter: WhatsappAdapter, bot: BotDouble, msg: WhatsappMessage): Promise<void> {
  const handler = bot.onMessage.mock.calls[0]?.[0] as ((m: WhatsappMessage) => Promise<void>) | undefined
  if (!handler) throw new Error('bot.onMessage was not registered by the adapter constructor')
  await handler(msg)
}

function sentText(bot: BotDouble): string[] {
  return bot.sendTextMessage.mock.calls.map((c: unknown[]) => String(c[1]))
}

function lastSent(bot: BotDouble): string {
  const all = sentText(bot)
  return all[all.length - 1] ?? ''
}

const createdAdapters: WhatsappAdapter[] = []

function makeAdapter(bot: BotDouble, config?: AdapterConfig): WhatsappAdapter {
  const adapter = new WhatsappAdapter({
    bot: bot as unknown as WhatsappBot,
    config: config ?? makeConfig(),
    serverUrl: SERVER_URL,
  })
  createdAdapters.push(adapter)
  return adapter
}

function makeConfig(
  o: { pairingCode?: string | null; pairedJids?: string[]; workDir?: string } = {}
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
      allowedUsers: [], pairedUsers: [], defaultWorkDir: '',
      clientId: '', clientSecret: '', endpoint: '', permissionCardTemplateId: '',
    },
    wechat: { allowedUsers: [], pairedUsers: [], defaultWorkDir: '', accountId: '', botToken: '', baseUrl: '', userId: '' },
    whatsapp: {
      allowedUsers: [],
      pairedUsers: (o.pairedJids === undefined ? [CHAT_ID] : o.pairedJids).map((userId) => ({
        userId,
        pairedAt: Date.now(),
      })),
      defaultWorkDir: o.workDir === undefined ? '/tmp/wa-work' : o.workDir,
      accountJid: 'bot@s.whatsapp.net',
      authDir: '',
    },
  }
}

/** Run /new so the server-message handler is registered on the live bridge. */
async function setupSession(
  bot: BotDouble,
  config?: AdapterConfig
): Promise<{ adapter: WhatsappAdapter; bridge: BridgeDouble; handler: MessageHandler }> {
  const adapter = makeAdapter(bot, config)
  await sendMsg(adapter, bot, makeMsg({ text: '/new' }))
  const bridge = bridgeOf(adapter)
  const handler = bridge.handlers.get(CHAT_ID)
  if (!handler) throw new Error('onServerMessage handler was not registered by createSession')
  bridge.sendUserMessage.mockClear()
  bridge.sendPermissionResponse.mockClear()
  bridge.resetSession.mockClear()
  bot.sendTextMessage.mockClear()
  return { adapter, bridge, handler }
}

// Root hooks: fresh mock state + guaranteed adapter teardown (dedup sweep) for every suite.
beforeEach(() => {
  vi.clearAllMocks()
  wsBridgeInstances.length = 0
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

describe('WhatsappAdapter — inbound message routing', () => {
  it('ignores its own outgoing messages (fromMe)', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendMsg(adapter, bot, makeMsg({ fromMe: true, text: '/health' }))

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
  })

  it('dedups a repeated message id and processes it exactly once', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    const msg = makeMsg({ id: 'wamid-fixed', text: '/health' })

    await sendMsg(adapter, bot, msg)
    await sendMsg(adapter, bot, msg)

    expect(sentText(bot)).toEqual(['✅ Healthy'])
  })

  it('forwards an empty text to the engine when the message has no usable body', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendMsg(adapter, bot, makeMsg({}))

    expect(mediaOf(adapter).downloadImage).toHaveBeenCalledTimes(0)
    expect(mediaOf(adapter).downloadDocument).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '')
  })

  it('routes a paired plain-text message to the stored session binding', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendMsg(adapter, bot, makeMsg({ text: '继续写代码' }))

    expect(httpOf(adapter).sessionExists).toHaveBeenCalledWith('sess-stored-1')
    expect(bridgeOf(adapter).connectSession).toHaveBeenCalledWith(CHAT_ID, 'sess-stored-1', '/tmp/stored-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '继续写代码')
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })
})

describe('WhatsappAdapter — command routing', () => {
  it('/help sends the formatted command list', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendMsg(adapter, bot, makeMsg({ text: '/help' }))

    const help = lastSent(bot)
    expect(help).toContain('📋 可用命令')
    expect(help).toContain('/new')
    expect(bot.sendTextMessage).toHaveBeenCalledTimes(1)
  })

  it('unknown slash commands are not intercepted and reach the engine as chat text', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendMsg(adapter, bot, makeMsg({ text: '/foobar arg' }))

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '/foobar arg')
  })

  it('parses commands case-insensitively', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendMsg(adapter, bot, makeMsg({ text: '/HEALTH' }))

    expect(lastSent(bot)).toBe('✅ Healthy')
  })

  it('a bare "/" is not a command and reaches the engine as chat text', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendMsg(adapter, bot, makeMsg({ text: '/' }))

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '/')
  })

  it('/stop signals stop-generation on the bridge and confirms to the user', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendMsg(adapter, bot, makeMsg({ text: '/stop' }))

    expect(bridgeOf(adapter).sendStopGeneration).toHaveBeenCalledWith(CHAT_ID)
    expect(lastSent(bot)).toBe('⏹️ Stopped')
  })

  it('/clear deletes the binding, resets the bridge and clears the accumulators', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    fullTextsOf(adapter).set(CHAT_ID, 'stale answer')
    pendingOf(adapter).set(CHAT_ID, [{ requestId: 'perm-x', toolName: 'Bash' }])
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendMsg(adapter, bot, makeMsg({ text: '/clear' }))

    expect(storeOf(adapter).delete).toHaveBeenCalledWith(CHAT_ID)
    expect(bridgeOf(adapter).resetSession).toHaveBeenCalledWith(CHAT_ID)
    expect(fullTextsOf(adapter).has(CHAT_ID)).toBe(false)
    expect(pendingOf(adapter).has(CHAT_ID)).toBe(false)
    expect(lastSent(bot)).toBe('🧹 Cleared')
  })

  it('answers static informational commands with their fixed copy', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    const expected: Array<[string, string]> = [
      ['/resume', '📋 Use /new to create a session'],
      ['/provider', '🔧 Configure in desktop'],
      ['/model', '🔧 Configure in desktop'],
      ['/skills', '📋 Configure in desktop'],
      ['/cancel', '✅ Cancelled'],
      ['/health', '✅ Healthy'],
    ]
    for (const [command] of expected) {
      await sendMsg(adapter, bot, makeMsg({ text: command }))
    }

    expect(sentText(bot).slice(-expected.length)).toEqual(expected.map(([, copy]) => copy))
  })

  it('/status reports the live bridge session and working directory', async () => {
    const bot = makeBot()
    const { adapter, bridge } = await setupSession(bot)
    bridge.getSessionId.mockReturnValue('sess-new-123456789')
    bridge.isConnected.mockReturnValue(true)

    await sendMsg(adapter, bot, makeMsg({ text: '/status' }))

    expect(lastSent(bot)).toBe('✍️ 会话状态: streaming\n🆔 Session: sess-new...\n📁 目录: /tmp/wa-work')
  })

  it('/status on a fresh adapter reports idle with no session', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendMsg(adapter, bot, makeMsg({ text: '/status' }))

    expect(lastSent(bot)).toBe('💤 会话状态: idle\n🆔 Session: N/A...')
  })
})

describe('WhatsappAdapter — pairing gate & commands', () => {
  it('routes an unpaired plain-text user into pairing and never reaches the engine', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairedJids: [] }))

    await sendMsg(adapter, bot, makeMsg({ text: 'hello there', jid: OTHER_JID }))

    expect(lastSent(bot)).toBe('❌ Wrong code') // mismatch against TESTCODE
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledTimes(0)
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })

  it('replies "no active code" when no pairing code is set', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairingCode: null, pairedJids: [] }))

    await sendMsg(adapter, bot, makeMsg({ text: 'hello there', jid: OTHER_JID }))

    expect(lastSent(bot)).toBe('❌ No active code')
  })

  it('allowedUsers whitelist grants access without pairing', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedJids: [] })
    config.whatsapp.allowedUsers = [OTHER_JID]
    const adapter = makeAdapter(bot, config)
    storeOf(adapter).set(OTHER_JID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendMsg(adapter, bot, makeMsg({ text: '在吗', jid: OTHER_JID }))

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(OTHER_JID, '在吗')
    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
  })

  it('pairs an unpaired user that sends the code as a plain message, recording pushName', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedJids: [] })
    const adapter = makeAdapter(bot, config)

    await sendMsg(adapter, bot, makeMsg({ text: 'TESTCODE', jid: OTHER_JID, pushName: 'Bob' }))

    expect(lastSent(bot)).toBe('✅ Paired! Use /help for commands')
    expect(config.whatsapp.pairedUsers).toEqual([
      expect.objectContaining({ userId: OTHER_JID, displayName: 'Bob' }),
    ])
    expect(config.pairing.code).toBeNull()
    expect(saveConfig).toHaveBeenCalledTimes(1)
  })

  it('/pair without args replies with usage and does not persist config', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ pairedJids: [] }))

    await sendMsg(adapter, bot, makeMsg({ text: '/pair', jid: OTHER_JID }))

    expect(lastSent(bot)).toBe('Usage: /pair <code>')
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/pair with the right code pairs the user, clears the code and persists', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedJids: [] })
    const adapter = makeAdapter(bot, config)

    await sendMsg(adapter, bot, makeMsg({ text: '/pair TESTCODE', jid: OTHER_JID }))

    expect(lastSent(bot)).toBe('✅ Paired! Use /help for commands')
    expect(config.whatsapp.pairedUsers.map((u) => u.userId)).toEqual([OTHER_JID])
    expect(config.pairing.code).toBeNull()
    expect(saveConfig).toHaveBeenCalledTimes(1)

    // now paired: a plain message reaches the engine path (session creation)
    await sendMsg(adapter, bot, makeMsg({ text: '你好', jid: OTHER_JID }))
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/wa-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(OTHER_JID, '你好')
  })

  it('/pair with a wrong code replies mismatch and records an attempt', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedJids: [] })
    const adapter = makeAdapter(bot, config)

    await sendMsg(adapter, bot, makeMsg({ text: '/pair NOPE11', jid: OTHER_JID }))

    expect(lastSent(bot)).toBe('❌ Wrong code')
    expect(config.whatsapp.pairedUsers).toHaveLength(0)
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/pair with an expired code replies "code expired"', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedJids: [] })
    config.pairing.expiresAt = Date.now() - 1000
    const adapter = makeAdapter(bot, config)

    await sendMsg(adapter, bot, makeMsg({ text: '/pair TESTCODE', jid: OTHER_JID }))

    expect(lastSent(bot)).toBe('❌ Code expired')
  })

  it('rate-limits pairing after 5 failed attempts', async () => {
    const bot = makeBot()
    const config = makeConfig({ pairedJids: [] })
    const adapter = makeAdapter(bot, config)

    for (let i = 0; i < 5; i++) {
      await sendMsg(adapter, bot, makeMsg({ text: `/pair WRONG${i}`, jid: OTHER_JID }))
    }
    expect(sentText(bot).filter((t) => t === '❌ Wrong code')).toHaveLength(5)

    await sendMsg(adapter, bot, makeMsg({ text: '/pair TESTCODE', jid: OTHER_JID }))
    expect(lastSent(bot)).toBe('❌ Too many attempts')
    expect(config.whatsapp.pairedUsers).toHaveLength(0)
  })

  it('/pair from an already-paired user short-circuits with "already paired"', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendMsg(adapter, bot, makeMsg({ text: '/pair TESTCODE' }))

    expect(lastSent(bot)).toBe('✅ Already paired')
    expect(saveConfig).toHaveBeenCalledTimes(0)
  })

  it('/unpair removes the paired user and persists', async () => {
    const bot = makeBot()
    const config = makeConfig()
    const adapter = makeAdapter(bot, config)

    await sendMsg(adapter, bot, makeMsg({ text: '/unpair' }))

    expect(lastSent(bot)).toBe('Unpaired')
    expect(config.whatsapp.pairedUsers).toHaveLength(0)
    expect(saveConfig).toHaveBeenCalledTimes(1)
  })
})

describe('WhatsappAdapter — session creation & recovery', () => {
  it('/new creates a session, rebinds the bridge and registers the message handler', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendMsg(adapter, bot, makeMsg({ text: '/new' }))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/wa-work')
    expect(storeOf(adapter).set).toHaveBeenCalledWith(CHAT_ID, {
      sessionId: 'sess-new-123456789',
      workDir: '/tmp/wa-work',
    })

    const first = wsBridgeInstances[0] as BridgeDouble
    const second = wsBridgeInstances[1] as BridgeDouble
    expect(first.resetSession).toHaveBeenCalledWith(CHAT_ID)
    expect(second.serverUrl).toBe(SERVER_URL)
    expect(second.authToken).toBe('tok-new-1')
    expect(second.connectSession).toHaveBeenCalledWith(CHAT_ID, 'sess-new-123456789', '/tmp/wa-work')
    expect(second.handlers.has(CHAT_ID)).toBe(true)
    expect(bridgeOf(adapter)).toBe(second)
    expect(lastSent(bot)).toBe('✅ New session\n📁 /tmp/wa-work\n🆔 sess-new...')
  })

  it('/new falls back to defaultProjectDir when whatsapp.defaultWorkDir is empty', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot, makeConfig({ workDir: '' }))

    await sendMsg(adapter, bot, makeMsg({ text: '/new' }))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/proj-default')
  })

  it('sends the triggering message on the NEW bridge right after auto-creating a session', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendMsg(adapter, bot, makeMsg({ text: '第一条消息' }))

    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/wa-work')
    const first = wsBridgeInstances[0] as BridgeDouble
    const second = wsBridgeInstances[1] as BridgeDouble
    expect(first.sendUserMessage).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter)).toBe(second)
    expect(second.sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '第一条消息')
    expect(lastSent(bot)).toContain('✅ New session')
  })

  it('recovery over a dead server session deletes the binding and creates a fresh session', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-dead-1', workDir: '/tmp/stored-work' })
    httpOf(adapter).sessionExists.mockResolvedValue(false)

    await sendMsg(adapter, bot, makeMsg({ text: 'hi' }))

    expect(httpOf(adapter).sessionExists).toHaveBeenCalledWith('sess-dead-1')
    expect(storeOf(adapter).delete).toHaveBeenCalledWith(CHAT_ID)
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/wa-work')
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, 'hi')
  })

  it('treats a sessionExists network failure as alive and reconnects instead of recreating', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })
    httpOf(adapter).sessionExists.mockRejectedValue(new Error('ECONNREFUSED'))

    await sendMsg(adapter, bot, makeMsg({ text: 'hi' }))

    expect(bridgeOf(adapter).connectSession).toHaveBeenCalledWith(CHAT_ID, 'sess-stored-1', '/tmp/stored-work')
    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, 'hi')
  })

  it('replies "Failed" when the session API rejects', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).createSession.mockRejectedValue(new Error('HTTP 500: gateway down'))

    await sendMsg(adapter, bot, makeMsg({ text: 'hi' }))

    expect(lastSent(bot)).toBe('❌ Failed: Error: HTTP 500: gateway down')
    expect(storeOf(adapter).set).toHaveBeenCalledTimes(0)
    // Pinned current behavior: despite the failure the text is still pushed to the OLD bridge
    expect(wsBridgeInstances[0] as BridgeDouble).toBe(bridgeOf(adapter))
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, 'hi')
  })
})

describe('WhatsappAdapter — projects commands', () => {
  const twoProjects = [
    { name: 'alpha', path: '/tmp/proj/alpha' },
    { name: 'beta', path: '/tmp/other/beta' },
  ]

  it('/projects with an empty list replies "no projects"', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await sendMsg(adapter, bot, makeMsg({ text: '/projects' }))

    expect(lastSent(bot)).toBe('📭 No projects')
  })

  it('/projects without args renders a numbered project list', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockResolvedValue(twoProjects)

    await sendMsg(adapter, bot, makeMsg({ text: '/projects' }))

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(1)
    expect(lastSent(bot)).toBe('📋 Recent projects:\n1. alpha\n2. beta\n\n/projects <number> to switch')
  })

  it('/projects <name> switches by creating a session in the matched project path', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockResolvedValue(twoProjects)
    httpOf(adapter).matchProject.mockImplementation(
      (query: unknown, projects: unknown) =>
        query === 'beta' ? (projects as Array<{ name: string; path: string }>)[1] : null
    )

    await sendMsg(adapter, bot, makeMsg({ text: '/projects beta' }))

    expect(httpOf(adapter).matchProject).toHaveBeenCalledWith('beta', twoProjects)
    expect((wsBridgeInstances[0] as BridgeDouble).resetSession).toHaveBeenCalledWith(CHAT_ID)
    expect(httpOf(adapter).createSession).toHaveBeenCalledWith('/tmp/other/beta')
    expect(storeOf(adapter).set).toHaveBeenCalledWith(CHAT_ID, {
      sessionId: 'sess-new-123456789',
      workDir: '/tmp/other/beta',
    })
    expect(lastSent(bot)).toBe('✅ New session\n📁 /tmp/other/beta\n🆔 sess-new...')
  })

  it('/projects handles no-match and ambiguous matches', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockResolvedValue(twoProjects)

    httpOf(adapter).matchProject.mockReturnValue(null)
    await sendMsg(adapter, bot, makeMsg({ text: '/projects ghost' }))
    expect(lastSent(bot)).toBe('❌ Not found')

    httpOf(adapter).matchProject.mockReturnValue('ambiguous')
    await sendMsg(adapter, bot, makeMsg({ text: '/projects b' }))
    expect(lastSent(bot)).toBe('❌ Ambiguous')

    expect(httpOf(adapter).createSession).toHaveBeenCalledTimes(0)
  })

  it('/projects reports API failures to the user', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    httpOf(adapter).listRecentProjects.mockRejectedValue(new Error('ECONNREFUSED'))

    await sendMsg(adapter, bot, makeMsg({ text: '/projects' }))

    expect(lastSent(bot)).toBe('❌ Error: ECONNREFUSED')
  })
})

describe('WhatsappAdapter — server messages (accumulate & flush)', () => {
  it('connected messages are logged only — no user-visible reply', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'connected', sessionId: 'sess-new-123456789' })

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect((wsBridgeInstances[0] as BridgeDouble).sendUserMessage).toHaveBeenCalledTimes(0)
  })

  it('status streaming/thinking sends composing presence; idle flushes the accumulated text', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'status', state: 'streaming' })
    await handler({ type: 'status', state: 'thinking' })
    expect(bot.sendPresence).toHaveBeenCalledTimes(2)
    expect(bot.sendPresence).toHaveBeenCalledWith(CHAT_ID, 'composing')
    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)

    await handler({ type: 'content_delta', text: '你好' })
    await handler({ type: 'status', state: 'idle' })

    expect(sentText(bot)).toEqual(['你好'])
    expect(fullTextsOf(adapter).has(CHAT_ID)).toBe(false)
  })

  it('content_start(text) resets the accumulator before a new answer', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'content_delta', text: 'stale' })
    await handler({ type: 'content_start', blockType: 'text' })
    await handler({ type: 'content_delta', text: 'fresh' })
    await handler({ type: 'status', state: 'idle' })

    expect(sentText(bot)).toEqual(['fresh'])
  })

  it('content_start for tool_use blocks does NOT reset the accumulator', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'content_delta', text: 'keep' })
    await handler({ type: 'content_start', blockType: 'tool_use', toolName: 'Bash' })
    await handler({ type: 'content_delta', text: 'more' })
    await handler({ type: 'status', state: 'idle' })

    expect(sentText(bot)).toEqual(['keepmore'])
  })

  it('content_delta without text is ignored and idle flushes nothing', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_delta' })
    await handler({ type: 'status', state: 'idle' })

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(fullTextsOf(adapter).has(CHAT_ID)).toBe(false)
  })

  it('whitespace-only accumulated text is not flushed', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_delta', text: '  \n\t ' })
    await handler({ type: 'status', state: 'idle' })

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(fullTextsOf(adapter).has(CHAT_ID)).toBe(false)
  })

  it('tool_use_complete flushes the accumulated text first, then the formatted tool line', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_delta', text: '思考中' })
    await handler({ type: 'tool_use_complete', toolName: 'Bash', toolUseId: 'tu_1', input: { command: 'ls -la' } })

    expect(sentText(bot)).toEqual(['思考中', '🔧 Bash(command: ls -la)'])
    expect(fullTextsOf(adapter).has(CHAT_ID)).toBe(false)
  })

  it('tool_result only surfaces errors and truncates them to 500 chars', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'tool_result', toolUseId: 'tu_1', content: 'fine', isError: false })
    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)

    const long = 'x'.repeat(600)
    await handler({ type: 'tool_result', toolUseId: 'tu_2', content: long, isError: true })
    expect(bot.sendTextMessage).toHaveBeenCalledWith(CHAT_ID, `❌ Error: ${'x'.repeat(500)}`)
  })

  it('permission_request flushes, sends the formatted request and records the pending entry', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_delta', text: 'partial' })
    await handler({
      type: 'permission_request',
      requestId: 'perm-1',
      toolName: 'Write',
      input: { file_path: '/tmp/wa-work/a.txt' },
      description: '写入文件',
    })

    expect(sentText(bot)[0]).toBe('partial')
    const permText = sentText(bot)[1]
    expect(permText).toContain('🔐 权限请求')
    expect(permText).toContain('工具: Write')
    expect(permText).toContain('file_path: /tmp/wa-work/a.txt')
    expect(permText).toContain('1️⃣ 允许')
    expect(pendingOf(adapter).get(CHAT_ID)).toEqual([{ requestId: 'perm-1', toolName: 'Write' }])
  })

  it('message_complete flushes and reports token usage — cache counters are ignored', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'content_delta', text: 'done' })
    await handler({
      type: 'message_complete',
      usage: { inputTokens: 5, outputTokens: 6, cacheReadInputTokens: 7, cacheCreationInputTokens: 8 },
    })

    expect(sentText(bot)).toEqual(['done', '📊 Token: ↓5 ↑6'])
    expect(fullTextsOf(adapter).has(CHAT_ID)).toBe(false)
  })

  it('error and api_retry messages are relayed with their formatted copy', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'error', message: 'rate limit hit', code: 'RATE_LIMIT' })
    expect(lastSent(bot)).toBe('❌ Error: rate limit hit')

    await handler({ type: 'api_retry', attempt: 2, maxRetries: 5, retryDelayMs: 1500 })
    expect(lastSent(bot)).toBe('🔄 API retry (2/5)')
  })

  it('ignores unknown server message types', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'thinking', text: 'hmm' } as never)

    expect(bot.sendTextMessage).toHaveBeenCalledTimes(0)
    expect(fullTextsOf(adapter).size).toBe(0)
  })

  it('flushes text longer than the WhatsApp limit as multiple chunks', async () => {
    const bot = makeBot()
    const { handler } = await setupSession(bot)

    await handler({ type: 'content_delta', text: 'x'.repeat(70000) })
    await handler({ type: 'status', state: 'idle' })

    const chunks = sentText(bot)
    expect(chunks).toHaveLength(2)
    expect(chunks.join('')).toHaveLength(70000)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(65536)
    }
  })
})

describe('WhatsappAdapter — pending permissions (no quick reply)', () => {
  it('DEFECT: quick-reply words are plain chat text — no permission response is ever sent', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-1', toolName: 'Bash', input: { command: 'ls' } })
    bridge.sendUserMessage.mockClear()

    await sendMsg(adapter, bot, makeMsg({ text: '1' }))

    expect(bridge.sendPermissionResponse).toHaveBeenCalledTimes(0)
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '1')
    // the pending entry is never consumed
    expect(pendingOf(adapter).get(CHAT_ID)).toEqual([{ requestId: 'perm-1', toolName: 'Bash' }])
  })

  it('/cancel clears pending permissions', async () => {
    const bot = makeBot()
    const { adapter, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-1', toolName: 'Bash', input: {} })
    expect(pendingOf(adapter).has(CHAT_ID)).toBe(true)

    await sendMsg(adapter, bot, makeMsg({ text: '/cancel' }))

    expect(pendingOf(adapter).has(CHAT_ID)).toBe(false)
    expect(lastSent(bot)).toBe('✅ Cancelled')
  })

  it('/new clears pending permissions', async () => {
    const bot = makeBot()
    const { adapter, bridge, handler } = await setupSession(bot)

    await handler({ type: 'permission_request', requestId: 'perm-1', toolName: 'Bash', input: {} })
    await sendMsg(adapter, bot, makeMsg({ text: '/new' }))

    expect(pendingOf(adapter).has(CHAT_ID)).toBe(false)
    expect(bridge.resetSession).toHaveBeenCalledWith(CHAT_ID)
    expect(pendingOf(adapter).size).toBe(0)
  })
})

describe('WhatsappAdapter — media messages', () => {
  it('DEFECT: image attachments are collected but never forwarded — only the caption reaches the engine', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    const image = { url: 'https://media.wa/img.png', mimetype: 'image/png', caption: '看看这张图' }
    await sendMsg(adapter, bot, makeMsg({ image }))

    expect(mediaOf(adapter).downloadImage).toHaveBeenCalledWith(image.url, image.mimetype)
    expect(mediaOf(adapter).toAttachmentRef).toHaveBeenCalledTimes(1)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '看看这张图')
  })

  it('an image without a caption forwards empty text', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    await sendMsg(
      adapter,
      bot,
      makeMsg({ image: { url: 'https://media.wa/img.png', mimetype: 'image/png' } })
    )

    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '')
  })

  it('skips the attachment ref when the image download fails (returns null)', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })
    mediaOf(adapter).downloadImage.mockResolvedValueOnce(null)

    await sendMsg(
      adapter,
      bot,
      makeMsg({ image: { url: 'https://media.wa/img.png', mimetype: 'image/png' } })
    )

    expect(mediaOf(adapter).toAttachmentRef).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '')
  })

  it('documents download with their declared name; empty text is sent to the engine', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })

    const doc = { url: 'https://media.wa/report.pdf', mimetype: 'application/pdf', fileName: 'report.pdf' }
    await sendMsg(adapter, bot, makeMsg({ document: doc }))

    expect(mediaOf(adapter).downloadDocument).toHaveBeenCalledWith(doc.url, doc.fileName, doc.mimetype)
    expect(mediaOf(adapter).toAttachmentRef).toHaveBeenCalledTimes(1)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '')
  })

  it('skips the attachment ref when the document download fails (returns null)', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    storeOf(adapter).set(CHAT_ID, { sessionId: 'sess-stored-1', workDir: '/tmp/stored-work' })
    mediaOf(adapter).downloadDocument.mockResolvedValueOnce(null)

    await sendMsg(
      adapter,
      bot,
      makeMsg({ document: { url: 'https://media.wa/report.pdf', mimetype: 'application/pdf', fileName: 'report.pdf' } })
    )

    expect(mediaOf(adapter).toAttachmentRef).toHaveBeenCalledTimes(0)
    expect(bridgeOf(adapter).sendUserMessage).toHaveBeenCalledWith(CHAT_ID, '')
  })
})

describe('WhatsappAdapter — start / stop lifecycle', () => {
  it('start starts the bot and is idempotent; stop tears the bridge down', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)

    await adapter.start()
    await adapter.start() // idempotent

    expect(bot.start).toHaveBeenCalledTimes(1)
    expect(bot.isConnected).toHaveBeenCalledTimes(1)

    await adapter.stop()
    expect(bridgeOf(adapter).destroy).toHaveBeenCalledTimes(1)
  })

  it('start proceeds without throwing when the bot is not yet connected (QR pending)', async () => {
    const bot = makeBot({ connected: false })
    const adapter = makeAdapter(bot)

    await expect(adapter.start()).resolves.toBeUndefined()
    expect(bot.start).toHaveBeenCalledTimes(1)

    await adapter.stop()
  })

  it('a second stop is tolerated', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    await adapter.start()

    await expect(adapter.stop()).resolves.toBeUndefined()
    await expect(adapter.stop()).resolves.toBeUndefined()
    expect(bridgeOf(adapter).destroy).toHaveBeenCalledTimes(2)
  })
})

describe('WhatsappAdapter — error containment', () => {
  it('a bot send failure is swallowed by the chat queue and logged, not rethrown', async () => {
    const bot = makeBot()
    const adapter = makeAdapter(bot)
    bot.sendTextMessage.mockRejectedValue(new Error('network down'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(sendMsg(adapter, bot, makeMsg({ text: '/health' }))).resolves.toBeUndefined()

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
