// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PermissionRequestCard from '@/components/chat/tools/PermissionRequestCard.vue'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'

vi.mock('@/stores/turn', () => ({
  useTurnStore: () => ({
    allowPermission: vi.fn(),
    denyPermission: vi.fn(),
    getPendingPermissionForToolUse: vi.fn(() => undefined),
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
  locale: 'en-US',
  messages: { 'en-US': enUS, 'zh-CN': zhCN },
})

// 引擎 control_request 里 ExitPlanMode 的真实形状：plan 是带真换行的 Markdown 字符串
const PLAN = [
  '# 为 electronAPI 门面与 PiProcessPool 补充单元测试',
  '',
  '## Context',
  '',
  '用户要求分析测试覆盖率缺口，选定 `src/services/electronAPI.ts`（api 门面，773 行）。',
  '',
  '1. **`electron/engine/engines/PiProcessPool.ts`（267 行）** — Pi 引擎进程池',
  '2. 不触碰 `vitest.config.ts` 的阈值结构本身',
].join('\n')

async function mountCard(input: Record<string, unknown>, toolName = 'ExitPlanMode') {
  const wrapper = mount(PermissionRequestCard, {
    props: { messageId: 'msg-1', toolUseId: 'tu-1', toolName, input },
    global: { plugins: [i18n, createPinia()] },
  })
  // MarkdownRenderer 用 rAF 节流渲染块，等两个宏任务让 DOM 落地
  await new Promise(r => setTimeout(r, 0))
  await new Promise(r => setTimeout(r, 0))
  return wrapper
}

describe('PermissionRequestCard ExitPlanMode', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.readFile.mockResolvedValue('content')
    apiMocks.readFileAsBase64.mockResolvedValue(null)
    apiMocks.loadGuiSettings.mockResolvedValue({ success: false })
    apiMocks.getEnv.mockResolvedValue(undefined)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('renders the plan body as markdown, not as a JSON dump', async () => {
    const wrapper = await mountCard({ plan: PLAN })
    const plan = wrapper.find('.plan-preview')

    expect(plan.exists()).toBe(true)
    expect(plan.find('h1.md-heading').text()).toContain('electronAPI')
    expect(plan.find('h2.md-heading').text()).toBe('Context')
    expect(plan.findAll('li')).toHaveLength(2)
    expect(plan.find('code').text()).toContain('electronAPI.ts')
    // 旧行为: JSON.stringify 把真换行转义成字面量 \n 塞进 <pre>
    expect(wrapper.find('.json-preview').exists()).toBe(false)
    expect(plan.text()).not.toContain('\\n')
  })

  it('shows nothing but the plan: other input keys stay hidden', async () => {
    const wrapper = await mountCard({
      plan: PLAN,
      planFilePath: 'C:\\Users\\me\\.claude\\plans\\witty-valley.md',
      allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
    })

    expect(wrapper.text()).not.toContain('planFilePath')
    expect(wrapper.text()).not.toContain('witty-valley')
    expect(wrapper.text()).not.toContain('allowedPrompts')
    expect(wrapper.text()).not.toContain('run tests')
  })

  it('renders an empty card while the plan is missing, never the raw input', async () => {
    const wrapper = await mountCard({ planFilePath: 'C:\\plans\\x.md' })

    expect(wrapper.find('.plan-preview').exists()).toBe(false)
    expect(wrapper.find('.json-preview').exists()).toBe(false)
  })

  it('keeps other tools on the generic JSON branch', async () => {
    const wrapper = await mountCard({ notebook_path: 'a.ipynb' }, 'NotebookEdit')

    expect(wrapper.find('.plan-preview').exists()).toBe(false)
    expect(wrapper.find('.json-preview').text()).toContain('a.ipynb')
  })
})
