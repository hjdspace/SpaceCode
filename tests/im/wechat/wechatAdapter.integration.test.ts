/**
 * Integration test: WechatAdapter full message flow
 *
 * Verifies the golden path:
 * 1. Adapter receives a message from WeChat (via mocked getMessages)
 * 2. User is paired
 * 3. Session recovery fails (no stored session)
 * 4. createSession is called
 * 5. WsBridge is created with the CORRECT serverUrl (not config default)
 * 6. User's message is sent to the engine via WsBridge
 *
 * This test goes RED if createSession uses this.config.serverUrl
 * instead of the serverUrl passed to the constructor.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WechatAdapter } from '@electron/im/adapters/wechat/wechatAdapter'
import { WechatBot, type WechatMessage } from '@electron/im/adapters/wechat/wechatBot'
import type { AdapterConfig } from '@electron/im/adapters/common/config'
import type { MessageHandler, SessionBinding } from '@electron/im/adapters/common/types'

let storedBinding: SessionBinding | null = null

function gatewayResponse(data: Record<string, unknown>, ok = true): Response {
  const text = JSON.stringify(data)
  return {
    ok,
    status: ok ? 200 : 404,
    statusText: ok ? 'OK' : 'Not Found',
    text: async () => text,
    json: async () => data,
  } as Response
}

// Mock WsBridge to capture the serverUrl it's created with
const wsBridgeInstances: Array<{
  serverUrl: string
  authToken?: string
  sendUserMessage: ReturnType<typeof vi.fn>
  connectSession: ReturnType<typeof vi.fn>
  onServerMessage: ReturnType<typeof vi.fn>
  startHeartbeat: ReturnType<typeof vi.fn>
  handlers: Map<string, MessageHandler>
}> = []

vi.mock('@electron/im/adapters/common/ws-bridge', () => {
  return {
    WsBridge: class MockWsBridge {
      serverUrl: string
      authToken?: string
      handlers = new Map<string, MessageHandler>()
      startHeartbeat = vi.fn()
      onServerMessage = vi.fn((chatId: string, handler: MessageHandler) => {
        this.handlers.set(chatId, handler)
      })
      sendUserMessage = vi.fn()
      sendPermissionResponse = vi.fn()
      sendStopGeneration = vi.fn()
      getSessionId = vi.fn().mockReturnValue(null)
      isConnected = vi.fn().mockReturnValue(false)
      connectSession = vi.fn().mockResolvedValue(undefined)
      resetSession = vi.fn()
      destroy = vi.fn()
      stopHeartbeat = vi.fn()

      constructor(opts: { serverUrl: string; authToken?: string }) {
        this.serverUrl = opts.serverUrl
        this.authToken = opts.authToken
        wsBridgeInstances.push(this)
      }
    },
  }
})

// Mock HttpClient
vi.mock('@electron/im/adapters/common/http-client', () => {
  return {
    HttpClient: class MockHttpClient {
      createSession = vi.fn().mockResolvedValue({
        sessionId: 'test-session-id',
        token: 'test-token',
      })
      sessionExists = vi.fn().mockImplementation(async () => storedBinding !== null)
      listRecentProjects = vi.fn().mockResolvedValue([])
      matchProject = vi.fn().mockReturnValue(null)
    },
    HttpError: class HttpError extends Error {
      constructor(public status: number, public body: string) {
        super(`HTTP ${status}`)
      }
    },
  }
})

// Mock SessionStore
vi.mock('@electron/im/adapters/common/session-store', () => {
  return {
    SessionStore: class MockSessionStore {
      get = vi.fn().mockImplementation(() => storedBinding)
      set = vi.fn()
      delete = vi.fn()
    },
  }
})

// Mock ChatQueue
vi.mock('@electron/im/adapters/common/chat-queue', () => {
  return {
    ChatQueue: class MockChatQueue {
      enqueue = vi.fn().mockImplementation(async (_chatId: string, fn: () => Promise<void>) => {
        await fn()
      })
    },
  }
})

// Mock MessageDedup
vi.mock('@electron/im/adapters/common/message-dedup', () => {
  return {
    MessageDedup: class MockMessageDedup {
      tryRecord = vi.fn().mockReturnValue(true)
      has = vi.fn().mockReturnValue(false)
      startSweep = vi.fn()
      stopSweep = vi.fn()
      clear = vi.fn()
    },
  }
})

// Mock logger
vi.mock('@electron/im/adapters/common/logger', () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

// Mock config
vi.mock('@electron/im/adapters/common/config', () => ({
  loadConfig: vi.fn().mockReturnValue({
    serverUrl: 'ws://127.0.0.1:3456', // ← The DEFAULT, wrong port
    defaultProjectDir: '/tmp/test',
    pairing: { code: 'TESTCODE', expiresAt: Date.now() + 3600000, createdAt: Date.now() },
    wechat: {
      accountId: 'wx_test',
      botToken: 'token_test',
      userId: 'user_test',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      allowedUsers: [],
      pairedUsers: [{ userId: 'user_from_wechat', displayName: 'TestUser', pairedAt: Date.now() }],
      defaultWorkDir: '/tmp/test',
    },
  } as unknown as AdapterConfig),
  saveConfig: vi.fn(),
  resolveUserDefaultWorkDir: vi.fn().mockReturnValue('/tmp/test'),
}))

// Mock TypingIndicator
vi.mock('@electron/im/adapters/wechat/typing', () => ({
  TypingIndicator: class MockTypingIndicator {
    start = vi.fn()
    stop = vi.fn()
    stopAll = vi.fn()
  },
}))

// Mock WechatMediaHandler
vi.mock('@electron/im/adapters/wechat/mediaHandler', () => ({
  WechatMediaHandler: class MockWechatMediaHandler {},
}))

describe('WechatAdapter integration', () => {
  let mockBot: Partial<WechatBot>

  beforeEach(() => {
    vi.clearAllMocks()
    wsBridgeInstances.length = 0
    storedBinding = null

    mockBot = {
      getMessages: vi.fn(),
      sendTextMessage: vi.fn().mockResolvedValue({ msgId: 'msg_1' }),
      sendTyping: vi.fn().mockResolvedValue(undefined),
      setContextToken: vi.fn(),
      getContextToken: vi.fn().mockReturnValue(''),
    }
  })

  it('should create WsBridge with the actual serverUrl, not config.serverUrl', async () => {
    const ACTUAL_SERVER_URL = 'ws://127.0.0.1:52483' // Dynamic port

    const adapter = new WechatAdapter({
      bot: mockBot as WechatBot,
      serverUrl: ACTUAL_SERVER_URL,
    })

    // Simulate receiving a message from a paired user
    const msg: WechatMessage = {
      fromUserId: 'user_from_wechat',
      toUserId: 'wx_test',
      msgId: 'msg_001',
      msgType: 'text',
      content: 'Hello, bot!',
      createTime: Date.now(),
    }

    // Access private method via any cast
    const adapterAny = adapter as unknown as {
      handlePolledMessage: (msg: WechatMessage) => Promise<void>
    }

    await adapterAny.handlePolledMessage(msg)

    // createSession should have been called, which creates a new WsBridge
    // The new WsBridge should use the ACTUAL server URL, not the config default
    expect(wsBridgeInstances.length).toBeGreaterThanOrEqual(2) // Initial + createSession

    const createSessionBridge = wsBridgeInstances[wsBridgeInstances.length - 1]
    expect(createSessionBridge.serverUrl).toBe(ACTUAL_SERVER_URL)
    expect(createSessionBridge.serverUrl).not.toBe('ws://127.0.0.1:3456')
  })

  it('should send user message after session creation', async () => {
    const ACTUAL_SERVER_URL = 'ws://127.0.0.1:52483'

    const adapter = new WechatAdapter({
      bot: mockBot as WechatBot,
      serverUrl: ACTUAL_SERVER_URL,
    })

    const msg: WechatMessage = {
      fromUserId: 'user_from_wechat',
      toUserId: 'wx_test',
      msgId: 'msg_002',
      msgType: 'text',
      content: 'Hello after creation',
      createTime: Date.now(),
    }

    const adapterAny = adapter as unknown as {
      handlePolledMessage: (msg: WechatMessage) => Promise<void>
    }

    await adapterAny.handlePolledMessage(msg)

    // After createSession, the user's message should be sent via the new bridge
    const lastBridge = wsBridgeInstances[wsBridgeInstances.length - 1]
    expect(lastBridge.sendUserMessage).toHaveBeenCalledWith('user_from_wechat', 'Hello after creation')
  })

  it('should forward the LLM response to WeChat after recovering a stored session', async () => {
    storedBinding = {
      sessionId: 'existing-session-id',
      workDir: '/tmp/test',
    }

    const adapter = new WechatAdapter({
      bot: mockBot as WechatBot,
      serverUrl: 'ws://127.0.0.1:52483',
    })

    const msg: WechatMessage = {
      fromUserId: 'user_from_wechat',
      toUserId: 'wx_test',
      msgId: 'msg_003',
      msgType: 'text',
      content: 'Use my existing session',
      createTime: Date.now(),
    }

    const adapterForTest = adapter as unknown as {
      handlePolledMessage: (message: WechatMessage) => Promise<void>
    }
    await adapterForTest.handlePolledMessage(msg)

    const bridge = wsBridgeInstances[0]
    expect(bridge.connectSession).toHaveBeenCalledWith(
      'user_from_wechat',
      'existing-session-id',
      '/tmp/test'
    )
    expect(bridge.sendUserMessage).toHaveBeenCalledWith(
      'user_from_wechat',
      'Use my existing session'
    )

    const handler = bridge.handlers.get('user_from_wechat')
    expect(handler).toBeDefined()
    if (!handler) return

    await handler({ type: 'content_start', blockType: 'text' })
    await handler({ type: 'content_delta', text: 'Recovered session response' })
    await handler({ type: 'status', state: 'idle' })

    expect(mockBot.sendTextMessage).toHaveBeenCalledWith(
      'user_from_wechat',
      'Recovered session response'
    )
  })

  it('should complete the real iLink inbound-to-LLM-to-WeChat flow', async () => {
    const originalFetch = globalThis.fetch
    const outboundBodies: Record<string, unknown>[] = []
    const requestedUrls: string[] = []
    let pollCount = 0
    let adapter: WechatAdapter | undefined
    const gatewayFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrls.push(String(input))
      const headers = (init?.headers ?? {}) as Record<string, string>
      if (
        init?.method !== 'POST' ||
        headers.Authorization !== 'Bearer token_test' ||
        headers.AuthorizationType !== 'ilink_bot_token'
      ) {
        return gatewayResponse({ message: 'Not Found' }, false)
      }

      if (String(input) === 'https://gateway.example.com/ilink/bot/getupdates') {
        pollCount += 1
        if (pollCount > 1) {
          return new Promise<Response>(() => {})
        }
        return gatewayResponse({
          ret: 0,
          get_updates_buf: 'cursor_1',
          msgs: [
            {
              from_user_id: 'user_from_wechat',
              to_user_id: 'wx_test',
              message_id: 1001,
              message_type: 1,
              context_token: 'ctx_real',
              create_time_ms: 1700000000000,
              item_list: [{ type: 1, text_item: { text: 'Real gateway message' } }],
            },
          ],
        })
      }

      if (String(input) === 'https://gateway.example.com/ilink/bot/sendmessage') {
        outboundBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>)
        return gatewayResponse({ ret: 0 })
      }

      return gatewayResponse({ message: 'Not Found' }, false)
    })
    vi.stubGlobal('fetch', gatewayFetch)

    try {
      const realBot = new WechatBot('wx_test', 'token_test', 'user_test', {
        baseUrl: 'https://gateway.example.com',
      })
      adapter = new WechatAdapter({
        bot: realBot,
        serverUrl: 'ws://127.0.0.1:52483',
      })
      await adapter.start()

      await vi.waitFor(() => {
        const activeBridge = wsBridgeInstances[wsBridgeInstances.length - 1]
        expect(activeBridge.sendUserMessage).toHaveBeenCalledWith(
          'user_from_wechat',
          'Real gateway message'
        )
      })

      const bridge = wsBridgeInstances[wsBridgeInstances.length - 1]
      const handler = bridge.handlers.get('user_from_wechat')
      expect(handler).toBeDefined()
      if (!handler) return

      await handler({ type: 'content_start', blockType: 'text' })
      await handler({ type: 'content_delta', text: 'Real LLM response' })
      await handler({ type: 'status', state: 'idle' })

      expect(outboundBodies[outboundBodies.length - 1]).toMatchObject({
        msg: {
          to_user_id: 'user_from_wechat',
          context_token: 'ctx_real',
          item_list: [{ type: 1, text_item: { text: 'Real LLM response' } }],
        },
      })
      expect(requestedUrls.some((url) => url.includes('get_bot_info'))).toBe(false)
    } finally {
      await adapter?.stop()
      vi.stubGlobal('fetch', originalFetch)
    }
  })
})
