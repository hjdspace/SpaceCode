// @vitest-environment jsdom
/**
 * pi plan_mode_complete 计划文档卡（方案 A · 卡片同构）。
 *
 * 钉住四件事：
 *   1. 渲染门槛：input.plan 为空整卡不渲染（同 AskUserQuestion 的 shouldRender 思路）；
 *   2. 折叠态：默认 120px 折叠（collapsed class），点击展开/收起切换；目录锚点来自 ## 标题；
 *   3. 状态徽标：completed→已提交、error→已失败（不造中间态文案）；
 *   4. 行动条降级：pending 的 plan-action select 帧（标题含 "Plan mode"）在场时
 *      渲染选项原文按钮，点击按原文应答那一帧；不在场时只留展开/复制，无假按钮。
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PlanModeCompleteToolCard from '@/components/chat/tools/PlanModeCompleteToolCard.vue'
import { useTurnStore } from '@/stores/turn'
import { useChatSessionStore } from '@/stores/chatSession'
import { extensionDialogService } from '@/services/extensionDialogService'
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

const PLAN = [
  '## 背景',
  '切换主题后只能整页生效。',
  '',
  '## 方案概述',
  '预览范围：设置页 + 侧栏。',
  '',
  '## 实现步骤',
  '1. 抽取 PreviewScope 容器组件',
].join('\n')

const ACTION_OPTIONS = ['Start implementation', 'Revise plan']

function makeToolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    id: 'tc-plan-complete',
    name: 'plan_mode_complete',
    input: { plan: PLAN },
    status: 'completed',
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
  /** 预先放进账本的 plan-action select 帧 */
  openPlanActionDialog?: boolean
}

async function setup({ toolCall = makeToolCall(), openPlanActionDialog = false }: SetupOptions = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const fake = makeFakeApi()
  useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [] })
  const sid = sessionStore.currentSessionId!

  if (openPlanActionDialog) {
    fake._handlers.onExtensionDialogRequest({
      sessionId: sid,
      data: {
        dialogId: 'uuid-act',
        method: 'select',
        title: 'Plan mode — what next?',
        options: ACTION_OPTIONS,
      },
    })
  }

  const wrapper = mount(PlanModeCompleteToolCard, {
    props: { toolCall },
    global: { plugins: [i18n, pinia] },
  })

  return { wrapper, fake, sid }
}

beforeEach(() => {
  extensionDialogService.clear()
  document.body.innerHTML = ''
})

describe('渲染门槛', () => {
  it('plan 为空（缺失或纯空白）整卡不渲染', async () => {
    const missing = await setup({ toolCall: makeToolCall({ input: {} }) })
    expect(missing.wrapper.find('.plan-complete-card').exists()).toBe(false)

    const blank = await setup({ toolCall: makeToolCall({ input: { plan: '   \n  ' } }) })
    expect(blank.wrapper.find('.plan-complete-card').exists()).toBe(false)
  })

  it('有 plan 时渲染 head 与正文，默认折叠', async () => {
    const { wrapper } = await setup()

    expect(wrapper.find('.plan-head .p-title h3').text()).toContain('实施计划')
    expect(wrapper.find('.plan-content').exists()).toBe(true)
    expect(wrapper.find('.plan-body').classes()).toContain('collapsed')
  })
})

describe('折叠与展开', () => {
  it('点击展开/收起切换 collapsed class', async () => {
    const { wrapper } = await setup()

    const expandBtn = wrapper.findAll('.plan-foot .pf-btn')[0]
    await expandBtn.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.plan-body').classes()).not.toContain('collapsed')

    await expandBtn.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.plan-body').classes()).toContain('collapsed')
  })

  it('目录锚点：## 标题渲染成 chips，点击展开正文并滚动', async () => {
    ;(Element.prototype as any).scrollTo = vi.fn()
    const { wrapper } = await setup()

    const chips = wrapper.findAll('.toc-item')
    expect(chips.map(c => c.text())).toEqual(['背景', '方案概述', '实现步骤'])

    await chips[1].trigger('click')
    await flush()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.plan-body').classes()).not.toContain('collapsed')
    expect((Element.prototype as any).scrollTo).toHaveBeenCalled()
  })
})

describe('状态徽标', () => {
  it('completed→已提交(ok)、error→已失败(error)', async () => {
    const done = await setup()
    expect(done.wrapper.find('.state-pill').text()).toBe('已提交')
    expect(done.wrapper.find('.state-pill').classes()).toContain('ok')

    const failed = await setup({ toolCall: makeToolCall({ status: 'error' }) })
    expect(failed.wrapper.find('.state-pill').text()).toBe('已失败')
    expect(failed.wrapper.find('.state-pill').classes()).toContain('error')
  })
})

describe('复制 Markdown', () => {
  it('复制按钮写入剪贴板并给出已复制反馈', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const { wrapper } = await setup()

    const copyBtn = wrapper.findAll('.plan-foot .pf-btn')[1]
    await copyBtn.trigger('click')
    await flush()

    expect(writeText).toHaveBeenCalledWith(PLAN)
    expect(copyBtn.text()).toContain('已复制')
  })
})

describe('行动条（plan-action 配对降级）', () => {
  it('有配对帧时渲染选项原文按钮（首个 primary），点击按原文应答', async () => {
    const { wrapper, fake, sid } = await setup({ openPlanActionDialog: true })

    const buttons = wrapper.findAll('.plan-foot .pf-btn')
    expect(buttons.map(b => b.text())).toEqual(['展开全文', '复制 Markdown', ...ACTION_OPTIONS])
    expect(buttons[2].classes()).toContain('primary')
    expect(buttons[3].classes()).not.toContain('primary')

    await buttons[3].trigger('click')
    await flush()

    expect(fake._ipcCalls).toHaveLength(1)
    expect(fake._ipcCalls[0].slice(0, 3)).toEqual([sid, 'uuid-act', { kind: 'value', value: 'Revise plan' }])
    // 应答成功后帧离开 pending，行动条随之消失
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.plan-foot .pf-btn').map(b => b.text())).toEqual(['展开全文', '复制 Markdown'])
  })

  it('无配对帧（已应答 / 历史回放）时只有展开与复制，无假按钮', async () => {
    const { wrapper, fake } = await setup()

    const buttons = wrapper.findAll('.plan-foot .pf-btn')
    expect(buttons.map(b => b.text())).toEqual(['展开全文', '复制 Markdown'])
    expect(fake._ipcCalls).toHaveLength(0)
  })
})
