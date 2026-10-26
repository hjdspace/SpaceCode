// @vitest-environment jsdom
/**
 * 从卡片提交动作到用户消息落库的集成用例（票 04）。
 *
 * 这里用真实的 chatSession（落库 + metadata 写回）与 Turn store（用户消息发送）跑通，
 * 只把引擎 API 换成假的：断言用户消息正文、metadata、只读状态与「下一轮请求里带完整 payload」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { messages as localeMessages } from '@/i18n'
import { useChatSessionStore } from '@/stores/chatSession'
import { GENUI_SANDBOX_PROTOCOL_VERSION } from '@/shared/genuiSandbox'
import type { GenuiCardRecord } from '@/types/genui'
import { createGenuiCardSubmissionHost } from '../cardSubmission'

const SESSION = 'sess-card-submit'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: localeMessages,
})

function makeFakeApi() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  const subscribe = (key: string) => (cb: any) => {
    handlers[key] = cb
    return () => {}
  }
  return {
    claudeCode: {
      onStreamEvent: subscribe('onStreamEvent'),
      onAssistant: subscribe('onAssistant'),
      onToolUse: subscribe('onToolUse'),
      onToolResult: subscribe('onToolResult'),
      onUser: subscribe('onUser'),
      onSystem: subscribe('onSystem'),
      onResult: subscribe('onResult'),
      onExit: subscribe('onExit'),
      onError: subscribe('onError'),
      onPermissionRequest: subscribe('onPermissionRequest'),
      onPermissionRequestCancelled: subscribe('onPermissionRequestCancelled'),
      // 形参写全：断言「下一轮上下文里带完整 payload」时要能读 calls[0][1]
      sendMessage: vi.fn(async (
        _sessionId?: unknown,
        _content?: unknown,
        _images?: unknown,
        _options?: unknown,
      ) => undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      allowPermission: vi.fn().mockResolvedValue(undefined),
      denyPermission: vi.fn().mockResolvedValue(undefined),
      submitToolAnswer: vi.fn().mockResolvedValue(undefined),
      skipToolAnswer: vi.fn().mockResolvedValue(undefined),
    },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
  }
}

type Fake = ReturnType<typeof makeFakeApi>

function seedSession(overrides: Partial<GenuiCardRecord> = {}): GenuiCardRecord {
  const base: GenuiCardRecord = {
    id: 'a1:card:0',
    protocolVersion: GENUI_SANDBOX_PROTOCOL_VERSION,
    schema: { componentName: 'TinyForm', props: { title: '报名表' } },
  }
  const card: GenuiCardRecord = { ...base, ...overrides }
  const sessionStore = useChatSessionStore()
  sessionStore.createSession('Card submit', 'D:\\ws', SESSION)
  sessionStore.currentSessionId = SESSION
  sessionStore.addMessage({ role: 'user', content: '填个表' }, SESSION)
  sessionStore.addMessage(
    { id: 'a1', role: 'assistant', content: '这是表单', metadata: { genUiCards: [card] } },
    SESSION,
  )
  return card
}

async function makeHost(fake: Fake, card: GenuiCardRecord) {
  const { useTurnStore } = await import('@/stores/turn')
  const turn = useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  return createGenuiCardSubmissionHost({
    sessionId: () => SESSION,
    messages: () => sessionStore.getSessionMessages(SESSION),
    translate: (key, params) =>
      (i18n.global.t as unknown as (k: string, p?: Record<string, unknown>) => string)(key, params ?? {}),
    updateMessage: (messageId, patch, sessionId) => sessionStore.updateMessage(messageId, patch, sessionId),
    turn,
    now: () => 1700000000000,
  })
}

function storedCard(): GenuiCardRecord {
  const sessionStore = useChatSessionStore()
  return sessionStore
    .getSessionMessages(SESSION)
    .find(message => message.id === 'a1')!
    .metadata!.genUiCards![0]
}

function userMessages() {
  return useChatSessionStore().getSessionMessages(SESSION).filter(message => message.role === 'user')
}

beforeEach(() => {
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('提交动作 → 用户消息落库', () => {
  it('用户消息正文含摘要与完整 payload，metadata 记录提交细节，卡片转为只读', async () => {
    const fake = makeFakeApi()
    const card = seedSession()
    const host = await makeHost(fake, card)
    const payload = { name: '张三', seat: 'A1' }

    const result = await host.submit(card, payload)

    expect(result).toEqual({ status: 'submitted', summary: '已提交卡片「报名表」，共 2 个字段' })

    const messages = userMessages()
    const submissionMessage = messages[messages.length - 1]!
    expect(submissionMessage.content).toContain('已提交卡片「报名表」，共 2 个字段')
    expect(submissionMessage.content).toContain('```json')
    expect(submissionMessage.content).toContain(JSON.stringify(payload, null, 2))
    expect(submissionMessage.metadata?.genUiSubmission).toEqual({
      cardId: 'a1:card:0',
      summary: '已提交卡片「报名表」，共 2 个字段',
      payload,
      collapsed: true,
    })

    expect(storedCard().submitted).toEqual({
      summary: '已提交卡片「报名表」，共 2 个字段',
      submittedAt: 1700000000000,
    })
  })

  it('下一轮请求的上下文里是完整 payload，而不只是摘要', async () => {
    const fake = makeFakeApi()
    const card = seedSession()
    const host = await makeHost(fake, card)
    const payload = { name: '张三', seat: 'A1' }

    await host.submit(card, payload)

    const sentContent = fake.claudeCode.sendMessage.mock.calls[0][1] as string
    expect(sentContent).toContain('```json')
    expect(sentContent).toContain('"seat": "A1"')
  })

  it('同一张卡再次提交被忽略，不产生第二条用户消息', async () => {
    const fake = makeFakeApi()
    const card = seedSession()
    const host = await makeHost(fake, card)

    await host.submit(card, { a: 1 })
    const countAfterFirst = userMessages().length
    expect(await host.submit(card, { a: 2 })).toEqual({ status: 'ignored' })
    expect(userMessages()).toHaveLength(countAfterFirst)
    expect(fake.claudeCode.sendMessage).toHaveBeenCalledTimes(1)
  })

  it('发送失败时卡片保持可编辑，不写只读状态', async () => {
    const fake = makeFakeApi()
    fake.claudeCode.sendMessage = vi.fn(async () => {
      throw new Error('engine unavailable')
    })
    const card = seedSession()
    const host = await makeHost(fake, card)

    expect(await host.submit(card, { a: 1 })).toEqual({ status: 'failed', reason: 'send-failed' })
    expect(storedCard().submitted).toBeUndefined()
  })
})
