// @vitest-environment jsdom
/**
 * pi plan_mode_question 问卷卡（方案 A · 卡片同构）。
 *
 * 钉住六件事：
 *   1. 结构化渲染：questions 数组变成 header 图标 + 带描述选项 + Other 行；
 *   2. 配对应答：select 帧 title = "{header}: {question}" 时点选项 = 直接应答那一帧，
 *      值是 pi-tui-kit formatRpcOption 的原文行；
 *   3. 降级：没有配对帧时不发 IPC，只更新本地选择；
 *   4. Other 流程：先应答 select 帧为 "N. Other (free-form)"，editor 帧到达后补答文本；
 *   5. 坑 6：textarea 输入不重渲染选项区（光标 / 中文输入法保护）；
 *      坑 7：键盘快捷键焦点在输入框里时不劫持。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PlanModeQuestionToolCard from '@/components/chat/tools/PlanModeQuestionToolCard.vue'
import { useTurnStore } from '@/stores/turn'
import { useChatSessionStore } from '@/stores/chatSession'
import { extensionDialogService } from '@/services/extensionDialogService'
import { questionDialogTitle } from '@/lib/planModeDialogMatcher'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'
import type { ToolCall } from '@/types'

vi.mock('@/services/electronAPI', () => ({
  api: {
    readFile: vi.fn(async () => 'content'),
    readFileAsBase64: vi.fn(async () => null),
    loadGuiSettings: vi.fn(async () => ({ success: false })),
    getEnv: vi.fn(async () => undefined),
    terminal: { onExit: vi.fn() },
    trace: { event: vi.fn() },
    showNotification: vi.fn(),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'en-US': enUS, 'zh-CN': zhCN } })

const QUESTIONS = [
  {
    header: '预览范围',
    question: '主题预览应该覆盖哪些界面？',
    options: [
      { label: '仅设置页', description: '实现最简单' },
      { label: '设置页 + 侧栏', description: '覆盖最高频区域' },
    ],
  },
  {
    header: '切换方式',
    question: '预览时如何应用主题？',
    options: [
      { label: '即时预览', description: '悬停即切换' },
      { label: '点击生效', description: '行为可预期' },
    ],
  },
]

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc-plan-q',
    name: 'plan_mode_question',
    input: { questions: QUESTIONS },
    status: 'running',
    ...overrides,
  }
}

function makeFakeApi() {
  const handlers: Record<string, any> = {}
  const ipcCalls: unknown[][] = []
  const api = {
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
      onPermissionRequest: (cb: any) => { handlers.onPermissionRequest = cb; return () => {} },
      onPermissionRequestCancelled: (cb: any) => { handlers.onPermissionRequestCancelled = cb; return () => {} },
      onExtensionDialogRequest: (cb: any) => { handlers.onExtensionDialogRequest = cb; return () => {} },
      onExtensionDialogClosed: (cb: any) => { handlers.onExtensionDialogClosed = cb; return () => {} },
      sendMessage: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      allowPermission: vi.fn().mockResolvedValue(undefined),
      denyPermission: vi.fn().mockResolvedValue(undefined),
      submitToolAnswer: vi.fn().mockResolvedValue(undefined),
      skipToolAnswer: vi.fn().mockResolvedValue(undefined),
      respondExtensionDialog: vi.fn(async (...args: unknown[]) => {
        ipcCalls.push(args)
        structuredClone(args[2])
      }),
    },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
    _ipcCalls: ipcCalls,
  }
  return api
}

function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

interface SetupOptions {
  toolCall?: ToolCall
  /** 预先放进账本的 select 对话框帧（默认给第 0 题配一帧） */
  openFirstQuestionDialog?: boolean
}

async function setup({ toolCall = makeToolCall(), openFirstQuestionDialog = false }: SetupOptions = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const fake = makeFakeApi()
  useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [] })
  const sid = sessionStore.currentSessionId!

  if (openFirstQuestionDialog) {
    fake._handlers.onExtensionDialogRequest({
      sessionId: sid,
      data: {
        dialogId: 'uuid-q1',
        method: 'select',
        title: questionDialogTitle(QUESTIONS[0]),
        options: ['1. 仅设置页 — 实现最简单', '2. 设置页 + 侧栏 — 覆盖最高频区域', '3. Other (free-form)'],
      },
    })
  }

  const wrapper = mount(PlanModeQuestionToolCard, {
    props: { toolCall },
    global: { plugins: [i18n, pinia] },
  })

  return { wrapper, fake, sid }
}

beforeEach(() => {
  extensionDialogService.clear()
  document.body.innerHTML = ''
})

describe('结构化渲染', () => {
  it('questions 渲染成 header 图标 + 带描述选项 + Other 行', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('.card-header .header-icon').exists()).toBe(true)
    expect(wrapper.find('.progress-text').text()).toBe('1 / 2')

    const options = wrapper.findAll('.option-btn')
    // 每题 2 个选项 + 1 行 Other
    expect(options).toHaveLength(3)
    expect(options[0].text()).toContain('仅设置页')
    expect(options[0].text()).toContain('实现最简单')
    expect(options[options.length - 1].text()).toContain('其他（自由填写）')
  })

  it('questions 为空或 toolCall 出错时不渲染', async () => {
    const empty = await setup({ toolCall: makeToolCall({ input: {} }) })
    expect(empty.wrapper.find('.plan-question-card').exists()).toBe(false)

    const errored = await setup({ toolCall: makeToolCall({ status: 'error' }) })
    expect(errored.wrapper.find('.plan-question-card').exists()).toBe(false)
  })
})

describe('配对应答', () => {
  it('点选项 = 应答配对的 select 帧，值是 formatRpcOption 原文行', async () => {
    const { wrapper, fake, sid } = await setup({ openFirstQuestionDialog: true })

    await wrapper.findAll('.option-btn')[1].trigger('click')
    await flush()

    expect(fake._ipcCalls).toHaveLength(1)
    expect(fake._ipcCalls[0].slice(0, 2)).toEqual([sid, 'uuid-q1'])
    expect(fake._ipcCalls[0][2]).toEqual({
      kind: 'value',
      value: '2. 设置页 + 侧栏 \u2014 覆盖最高频区域',
    })
    // 选项选中态 + 该题锁定
    expect(wrapper.findAll('.option-btn')[1].classes()).toContain('selected')
    expect(wrapper.findAll('.option-btn')[0].attributes('disabled')).toBeDefined()
  })

  it('没有配对帧时不发 IPC，只更新本地选择', async () => {
    const { wrapper, fake } = await setup()

    await wrapper.findAll('.option-btn')[0].trigger('click')
    await flush()

    expect(fake._ipcCalls).toHaveLength(0)
    expect(wrapper.findAll('.option-btn')[0].classes()).toContain('selected')
    // 降级路径没有锁定：仍可改选
    expect(wrapper.findAll('.option-btn')[0].attributes('disabled')).toBeUndefined()
  })

  it('跳过 = 对配对帧回 cancelled', async () => {
    const { wrapper, fake } = await setup({ openFirstQuestionDialog: true })

    await wrapper.find('.card-footer .footer-btn.secondary').trigger('click')
    await flush()

    expect(fake._ipcCalls).toHaveLength(1)
    expect(fake._ipcCalls[0][2]).toEqual({ kind: 'cancel' })
  })
})

describe('Other 流程（select → editor 两帧）', () => {
  it('提交自定义答案：先应答 select 帧为 Other 行，editor 帧到达后补答文本', async () => {
    const { wrapper, fake, sid } = await setup({ openFirstQuestionDialog: true })

    // 选 Other → 出现输入框
    await wrapper.findAll('.option-btn')[2].trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.custom-input').exists()).toBe(true)
    expect(fake._ipcCalls).toHaveLength(0) // 还没提交，不应答

    await wrapper.find('.custom-input').setValue('悬浮窗预览')
    await wrapper.find('.custom-submit').trigger('click')
    await flush()

    // select 帧已答为 Other 行
    expect(fake._ipcCalls).toHaveLength(1)
    expect(fake._ipcCalls[0][2]).toEqual({ kind: 'value', value: '3. Other (free-form)' })

    // 扩展随后发 editor 帧（标题 = 题目原文）→ watch 自动补答
    fake._handlers.onExtensionDialogRequest({
      sessionId: sid,
      data: { dialogId: 'uuid-e1', method: 'editor', title: QUESTIONS[0].question, prefill: '' },
    })
    await flush()
    await wrapper.vm.$nextTick()

    expect(fake._ipcCalls).toHaveLength(2)
    expect(fake._ipcCalls[1].slice(0, 2)).toEqual([sid, 'uuid-e1'])
    expect(fake._ipcCalls[1][2]).toEqual({ kind: 'value', value: '悬浮窗预览' })
  })

  it('无 editor 帧（配对失败）时 Other 提交只写本地，不炸', async () => {
    const { wrapper, fake } = await setup()

    await wrapper.findAll('.option-btn')[2].trigger('click')
    await wrapper.find('.custom-input').setValue('本地答案')
    await wrapper.find('.custom-submit').trigger('click')
    await flush()

    expect(fake._ipcCalls).toHaveLength(0)
  })
})

describe('多题翻页', () => {
  it('下一题要等当前题有答案，翻过去显示第二题', async () => {
    const { wrapper } = await setup()

    const next = wrapper.find('.card-footer .footer-btn.primary')
    expect(next.attributes('disabled')).toBeDefined()

    await wrapper.findAll('.option-btn')[0].trigger('click')
    await wrapper.vm.$nextTick()
    expect(next.attributes('disabled')).toBeUndefined()

    await next.trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.progress-text').text()).toBe('2 / 2')
    expect(wrapper.find('.question-title').text()).toContain('预览时如何应用主题')
    // 第一题的点标记为 done
    expect(wrapper.findAll('.progress-dots .dot')[0].classes()).toContain('done')
  })
})

describe('坑 6：textarea 输入不重渲染选项区', () => {
  it('input 事件后选项 DOM 引用不变', async () => {
    const { wrapper } = await setup()

    await wrapper.findAll('.option-btn')[2].trigger('click')
    await wrapper.vm.$nextTick()

    const before = wrapper.findAll('.option-btn').map(o => o.element)
    const textarea = wrapper.find('.custom-input')
    await textarea.setValue('一')
    await textarea.setValue('一二')
    await wrapper.vm.$nextTick()

    const after = wrapper.findAll('.option-btn').map(o => o.element)
    expect(after).toHaveLength(before.length)
    expect(after[0]).toBe(before[0])
    expect(after[2]).toBe(before[2])
  })
})

describe('坑 7：键盘快捷键不劫持输入框', () => {
  it('焦点在 textarea 里按数字不选中选项；焦点不在输入框时才选中', async () => {
    const { wrapper } = await setup()

    // 目标是 textarea 的按键事件：数字 1 不触发选择
    const foreign = document.createElement('textarea')
    document.body.appendChild(foreign)
    foreign.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.option-btn')[0].classes()).not.toContain('selected')

    // 目标是 body（无输入焦点）：数字 1 选中第一个选项
    document.body.removeChild(foreign)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }))
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.option-btn')[0].classes()).toContain('selected')
  })
})

describe('汇总态', () => {
  it('completed 后折叠成 summary，展开显示问答记录（output 回溯）', async () => {
    const output = JSON.stringify({
      cancelled: false,
      answers: [{ question: QUESTIONS[0].question, answer: '2. 设置页 + 侧栏 \u2014 覆盖最高频区域' }],
    })
    const { wrapper } = await setup({
      toolCall: makeToolCall({ status: 'completed', output }),
    })

    expect(wrapper.find('.summary-header').exists()).toBe(true)
    expect(wrapper.find('.summary-chevron').exists()).toBe(true)

    await wrapper.find('.summary-header').trigger('click')
    await wrapper.vm.$nextTick()

    const items = wrapper.findAll('.summary-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('设置页 + 侧栏')
    expect(items[1].text()).toContain('未回答')
  })

  it('cancelled 输出显示已跳过 + warn 着色', async () => {
    const output = JSON.stringify({ cancelled: true, answers: [] })
    const { wrapper } = await setup({
      toolCall: makeToolCall({ status: 'completed', output }),
    })

    expect(wrapper.find('.summary-header h3').text()).toContain('已跳过')
    expect(wrapper.find('.summary-header .header-icon').classes()).toContain('warn')
  })

  it('output 解析失败显示「已结束」，不造数据', async () => {
    const { wrapper } = await setup({
      toolCall: makeToolCall({ status: 'completed', output: '{"truncated...' }),
    })

    expect(wrapper.find('.summary-header').exists()).toBe(true)
    await wrapper.find('.summary-header').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.summary-answer span').text()).toContain('已结束')
  })
})
