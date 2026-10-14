// 设计面板必须用 can_use_tool 的 control_response 通道应答 AskUserQuestion。
// 走 submitToolAnswer 只是往 stdin 写一条 tool_result，引擎此刻还挂着等 control_response，
// 于是"点了提交没有任何反应"。这里钉住两条通道的选择。
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { permissionService } from '@/services/permissionService'

const MessageListStub = defineComponent({
  name: 'MessageList',
  props: {
    messages: { type: Array, default: () => [] },
    loading: { type: Boolean, default: false },
    mode: { type: String, default: undefined },
  },
  template: '<div />',
})

const componentStub = { template: '<div />' }

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: { value: 'en-US' }, t: (key: string) => key } }),
  useI18n: () => ({ t: (key: string) => key, locale: { value: 'en-US' }, tm: () => undefined }),
}))

vi.mock('@/components/chat/MessageList.vue', () => ({ default: MessageListStub }))
vi.mock('@/components/chat/ChatInput.vue', () => ({ default: componentStub }))
vi.mock('@/components/design/TemplatePicker.vue', () => ({ default: componentStub }))
vi.mock('@/components/design/DesignSystemPicker.vue', () => ({ default: componentStub }))

vi.mock('@/composables/useDesignSession', () => ({
  useDesignSession: () => ({
    createDesignSession: vi.fn(),
    submitQuestionForm: vi.fn(),
    stopDesignGeneration: vi.fn(),
    switchDesignSystem: vi.fn(),
    buildDesignMessage: (content: string) => content,
  }),
}))

vi.mock('@/stores/mcp', () => ({
  useMcpStore: () => ({ fetchServers: vi.fn() }),
}))

function makeFakeApi() {
  const noop = () => () => {}
  return {
    claudeCode: {
      onStreamEvent: noop, onAssistant: noop, onToolUse: noop, onToolResult: noop,
      onUser: noop, onSystem: noop, onResult: noop, onExit: noop, onError: noop,
      onPermissionRequest: noop, onPermissionRequestCancelled: noop,
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      allowPermission: vi.fn().mockResolvedValue(undefined),
      denyPermission: vi.fn().mockResolvedValue(undefined),
      submitToolAnswer: vi.fn().mockResolvedValue(undefined),
      skipToolAnswer: vi.fn().mockResolvedValue(undefined),
    },
    design: { listSystems: vi.fn().mockResolvedValue([]) },
    terminal: { onExit: () => () => {} },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    getCwd: vi.fn().mockResolvedValue('D:/repo'),
    getEnv: vi.fn().mockResolvedValue(''),
    loadGuiSettings: vi.fn().mockResolvedValue({ success: true, data: null }),
    saveGuiSettings: vi.fn().mockResolvedValue({ success: true }),
  }
}

const fake = makeFakeApi()
vi.mock('@/services/electronAPI', () => ({ api: fake }))

const UPDATED_INPUT = {
  questions: [{ question: '考勤表要哪些列？', header: '字段', options: [{ label: '姓名/日期/工时' }] }],
  answers: { '考勤表要哪些列？': '姓名/日期/工时' },
}

async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  permissionService.clear()

  const { useChatSessionStore } = await import('@/stores/chatSession')
  const { useTurnStore } = await import('@/stores/turn')
  const { useDesignStore } = await import('@/stores/design')

  const sessionStore = useChatSessionStore()
  const session = sessionStore.createSession('Design', 'D:/repo', 'sess-design')
  session.mode = 'design'
  sessionStore.selectSession('sess-design')
  const message = sessionStore.addMessage({
    role: 'assistant',
    content: '',
    toolCalls: [{ id: 'ask-1', name: 'AskUserQuestion', input: UPDATED_INPUT, status: 'running', startTime: 0, endTime: 0 }],
  }, 'sess-design')

  useTurnStore()
  const designStore = useDesignStore()
  designStore.activeSessionId = 'sess-design'

  const { default: DesignChatPane } = await import('../DesignChatPane.vue')
  const wrapper = mount(DesignChatPane, { global: { plugins: [pinia] } })
  await nextTick()

  return { wrapper, message, designStore }
}

describe('DesignChatPane 提问工具答复通道', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('有 pending can_use_tool 时走 allowPermission，并把完整 updatedInput 交给引擎', async () => {
    const { wrapper, message } = await setup()
    permissionService.addPermissionRequest('sess-design', {
      sessionId: 'sess-design',
      requestId: 'req-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'ask-1',
      input: UPDATED_INPUT,
    })

    wrapper.findComponent(MessageListStub).vm.$emit('toolSubmit', message.id, 'ask-1', UPDATED_INPUT)
    await nextTick()

    expect(fake.claudeCode.allowPermission).toHaveBeenCalledWith(
      'sess-design', 'req-ask-1', UPDATED_INPUT, undefined,
    )
    expect(fake.claudeCode.submitToolAnswer).not.toHaveBeenCalled()
  })

  it('跳过时走 denyPermission', async () => {
    const { wrapper, message } = await setup()
    permissionService.addPermissionRequest('sess-design', {
      sessionId: 'sess-design',
      requestId: 'req-ask-1',
      toolName: 'AskUserQuestion',
      toolUseId: 'ask-1',
      input: UPDATED_INPUT,
    })

    wrapper.findComponent(MessageListStub).vm.$emit('toolSkip', message.id, 'ask-1')
    await nextTick()

    expect(fake.claudeCode.denyPermission).toHaveBeenCalledWith(
      'sess-design', 'req-ask-1', 'chatPanel.userSkippedQuestions', {},
    )
    expect(fake.claudeCode.skipToolAnswer).not.toHaveBeenCalled()
  })

  it('无 pending permission 时回退到 tool_result 通道，且只送 answers', async () => {
    const { wrapper, message } = await setup()

    wrapper.findComponent(MessageListStub).vm.$emit('toolSubmit', message.id, 'ask-1', UPDATED_INPUT)
    await nextTick()

    expect(fake.claudeCode.allowPermission).not.toHaveBeenCalled()
    expect(fake.claudeCode.submitToolAnswer).toHaveBeenCalledWith(
      'sess-design', 'ask-1', UPDATED_INPUT.answers,
    )
  })
})
