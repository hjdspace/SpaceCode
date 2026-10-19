// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hasToolComponent } from '@/components/chat/tools/index'
import ExitPlanModeToolCard from '@/components/chat/tools/ExitPlanModeToolCard.vue'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'

const storeMocks = vi.hoisted(() => ({
  findPendingPermissionByToolUse: vi.fn(),
}))

vi.mock('@/stores/turn', () => ({
  useTurnStore: () => ({
    findPendingPermissionByToolUse: storeMocks.findPendingPermissionByToolUse,
  }),
}))

// MarkdownRenderer 链路会实例化 app → settings store 并调用 api；打桩避免 unhandled rejection
const apiMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readFileAsBase64: vi.fn(),
  loadGuiSettings: vi.fn(),
  getEnv: vi.fn(),
  terminalOnExit: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    readFile: apiMocks.readFile,
    readFileAsBase64: apiMocks.readFileAsBase64,
    loadGuiSettings: apiMocks.loadGuiSettings,
    getEnv: apiMocks.getEnv,
    terminal: { onExit: apiMocks.terminalOnExit },
  },
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'en-US': enUS, 'zh-CN': zhCN },
})

// 引擎 normalizeContentFromAPI 注入进 tool_use input 的真实形状：plan 是带真换行的 Markdown
const PLAN = [
  '# 为 ExitPlanMode 补专用卡片',
  '',
  '## Context',
  '',
  '1. **`ExitPlanModeToolCard.vue`** — 展开时用 MarkdownRenderer 渲染 plan',
  '2. 不修改 `vitest.config.ts` 的阈值结构本身',
].join('\n')

// ExitPlanModeV2Tool.mapToolResultToToolResultBlockParam 的产物：尾部附带整份计划副本
const TOOL_RESULT =
  'User has approved your plan. You can now start coding.\n\n## Approved Plan:\n' + PLAN

function makeToolCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tu-1',
    name: 'ExitPlanMode',
    input: { plan: PLAN, planFilePath: 'C:\\Users\\me\\.claude\\plans\\witty-valley.md' },
    status: 'completed',
    output: TOOL_RESULT,
    ...overrides,
  } as any
}

async function mountCard(toolCall = makeToolCall()) {
  const wrapper = mount(ExitPlanModeToolCard, {
    props: { toolCall },
    global: { plugins: [i18n, createPinia()] },
  })
  // MarkdownRenderer 用 rAF 节流渲染块，等两个宏任务让 DOM 落地
  await new Promise(r => setTimeout(r, 0))
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

async function expand(wrapper: Awaited<ReturnType<typeof mountCard>>) {
  await wrapper.find('.tool-header').trigger('click')
  await new Promise(r => setTimeout(r, 0))
  await new Promise(r => setTimeout(r, 0))
}

describe('ExitPlanModeToolCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.readFile.mockResolvedValue('content')
    apiMocks.readFileAsBase64.mockResolvedValue(null)
    apiMocks.loadGuiSettings.mockResolvedValue({ success: false })
    apiMocks.getEnv.mockResolvedValue(undefined)
    storeMocks.findPendingPermissionByToolUse.mockReturnValue(undefined)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders the approved plan as markdown once expanded', async () => {
    const wrapper = await mountCard()
    await expand(wrapper)

    const body = wrapper.find('.plan-body')
    expect(body.exists()).toBe(true)
    expect(body.find('h1.md-heading').text()).toContain('ExitPlanMode')
    expect(body.find('h2.md-heading').text()).toBe('Context')
    expect(body.findAll('li')).toHaveLength(2)
    expect(body.findAll('code').map(node => node.text())).toEqual(
      expect.arrayContaining(['ExitPlanModeToolCard.vue', 'vitest.config.ts']),
    )
  })

  it('keeps the plan out of the collapsed card and never dumps the raw input JSON', async () => {
    const wrapper = await mountCard()

    expect(wrapper.find('.plan-body').exists()).toBe(false)

    await expand(wrapper)

    // 旧行为: formatInput 走 JSON.stringify，把真换行转义成字面量 \n 塞进 <pre>
    expect(wrapper.text()).not.toContain('planFilePath')
    expect(wrapper.text()).not.toContain('witty-valley')
    expect(wrapper.find('.plan-body').text()).not.toContain('\\n')
  })

  it('hides the tool_result copy of the plan: it shows once, as markdown', async () => {
    const wrapper = await mountCard()
    await expand(wrapper)

    expect(wrapper.text()).not.toContain('User has approved your plan')
    expect(wrapper.text()).not.toContain('Approved Plan')
  })

  it('stays silent while the approval card owns the plan body', async () => {
    storeMocks.findPendingPermissionByToolUse.mockReturnValue({ requestId: 'req-1' })
    const wrapper = await mountCard(makeToolCall({ status: 'running' }))

    expect(wrapper.text()).toContain('等待确认')
    expect(wrapper.find('.tool-chevron').exists()).toBe(false)

    await expand(wrapper)

    expect(wrapper.find('.plan-body').exists()).toBe(false)
    expect(storeMocks.findPendingPermissionByToolUse).toHaveBeenCalledWith('tu-1')
  })

  it('offers no expand affordance when the plan is missing', async () => {
    const wrapper = await mountCard(
      makeToolCall({ input: { planFilePath: 'C:\\plans\\x.md' } }),
    )

    expect(wrapper.find('.tool-chevron').exists()).toBe(false)

    await expand(wrapper)

    expect(wrapper.find('.plan-body').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('planFilePath')
  })

  it('marks a rejected plan without rendering its body', async () => {
    const wrapper = await mountCard(
      makeToolCall({ status: 'error', output: 'The user doesn\'t want to proceed' }),
    )

    expect(wrapper.text()).toContain('已拒绝')
    expect(wrapper.find('.plan-body').exists()).toBe(false)
  })

  // AgentTimeline 与 ToolCallList 都用同一张 map 决定「专用卡片 vs generic JSON 行」，
  // 注册一次即两条渲染路径同时生效。
  it('is registered so no timeline surface falls back to the JSON row', () => {
    expect(hasToolComponent('ExitPlanMode')).toBe(true)
  })
})
