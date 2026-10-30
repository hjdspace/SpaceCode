// @vitest-environment jsdom
/**
 * 提问卡在嵌入式面板里的可点性（issue 09）。
 *
 * Seam: AskUserQuestionToolCard 的公共 props。看板接管面板显示的会话不是
 * currentSessionId；卡片用「当前会话」判 pending 就会认为请求不存在，
 * 于是按钮全程禁用，用户在面板里答不了引擎的追问。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AskUserQuestionToolCard from '@/components/chat/tools/AskUserQuestionToolCard.vue'
import { useChatSessionStore } from '@/stores/chatSession'
import { permissionService } from '@/services/permissionService'
import type { ToolCall } from '@/types'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'

const handlers: Record<string, any> = {}

vi.mock('@/services/electronAPI', () => ({
  api: {
    claudeCode: {
      onStreamEvent: (cb: any) => { handlers.onStreamEvent = cb; return () => {} },
      onAssistant: (cb: any) => { handlers.onAssistant = cb; return () => {} },
      onToolUse: (cb: any) => { handlers.onToolUse = cb; return () => {} },
      onToolResult: (cb: any) => { handlers.onToolResult = cb; return () => {} },
      onUser: (cb: any) => { handlers.onUser = cb; return () => {} },
      onSystem: (cb: any) => { handlers.onSystem = cb; return () => {} },
      onResult: (cb: any) => { handlers.onResult = cb; return () => {} },
      onExit: (cb: any) => { handlers.onExit = cb; return () => {} },
      onError: (cb: any) => { handlers.onError = cb; return () => {} },
      allowPermission: vi.fn().mockResolvedValue(undefined),
      denyPermission: vi.fn().mockResolvedValue(undefined),
    },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    loadGuiSettings: vi.fn(async () => ({ success: false })),
    getEnv: vi.fn(async () => undefined),
    terminal: { onExit: vi.fn() },
    showNotification: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS, 'zh-CN': zhCN } })

const PANEL_SESSION = 'fac-run-1-bl-1-takeover'

function askToolCall(): ToolCall {
  return {
    id: 'tu-ask',
    name: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: '先改恢复顺序还是先补测试？',
          header: '顺序',
          options: [{ label: '先改顺序' }, { label: '先补测试' }],
        },
      ],
    },
    status: 'running',
    startTime: 0,
    endTime: 0,
  } as unknown as ToolCall
}

/** 面板会话挂着待答的追问，而用户当前查看的是另一条会话。 */
function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const sessionStore = useChatSessionStore()
  sessionStore.createSession('接管 · 登录态在刷新后丢失', 'D:/repo', PANEL_SESSION, { activate: false })
  const main = sessionStore.createSession('用户正在看的会话')
  sessionStore.selectSession(main.id)

  permissionService.addPermissionRequest(PANEL_SESSION, {
    sessionId: PANEL_SESSION,
    requestId: 'req-ask',
    toolName: 'AskUserQuestion',
    toolUseId: 'tu-ask',
    input: {},
  })

  const wrapper = mount(AskUserQuestionToolCard, {
    props: { toolCall: askToolCall(), sessionId: PANEL_SESSION },
    global: { plugins: [i18n, pinia] },
  })
  return { wrapper, main, sessionStore }
}

describe('AskUserQuestionToolCard 面板会话', () => {
  beforeEach(() => {
    permissionService.clear()
  })

  it('按自己的会话判定待答，卡片可以交互', () => {
    const { wrapper, main, sessionStore } = setup()

    expect(wrapper.find('.ask-user-question-card').exists()).toBe(true)
    expect(wrapper.find('.footer-btn.secondary').attributes('disabled')).toBeUndefined()
    // 判定不改动用户正在看的会话。
    expect(sessionStore.currentSessionId).toBe(main.id)
  })
})
