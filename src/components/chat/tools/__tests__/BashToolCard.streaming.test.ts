// @vitest-environment jsdom
/**
 * Bash 卡片的实时输出视图：
 *  - 运行中显示尾部（终端语义），终态显示开头（错误通常在最前面）
 *  - 新输出到来时跟随到底部；用户上翻后不抢滚动
 *  - tail/重定向型命令长时间无输出时给出缓冲提示
 */
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import BashToolCard from '@/components/chat/tools/BashToolCard.vue'
import enUS from '@/i18n/locales/en-US'
import zhCN from '@/i18n/locales/zh-CN'

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => ({ workingDirectory: 'D:/proj' }),
}))

const appMocks = vi.hoisted(() => ({ openTerminalTab: vi.fn() }))
vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ openTerminalTab: appMocks.openTerminalTab }),
}))

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  messages: { 'en-US': enUS, 'zh-CN': zhCN },
})

function makeToolCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tu-bash',
    name: 'Bash',
    input: { command: 'npm run dev' },
    status: 'running',
    startTime: 1_000,
    ...overrides,
  } as any
}

function mountCard(toolCall = makeToolCall(), now?: number) {
  return mount(BashToolCard, {
    props: { toolCall, now },
    global: { plugins: [i18n, createPinia()] },
  })
}

async function expand(wrapper: ReturnType<typeof mountCard>) {
  await wrapper.find('.tool-header').trigger('click')
  await nextTick()
}

describe('BashToolCard 实时输出', () => {
  it('运行中展示尾部，而不是冻结在开头', async () => {
    const output = 'HEAD_MARK\n' + 'a'.repeat(3500) + '\nTAIL_MARK'
    const wrapper = mountCard(makeToolCall({ output }), 5_000)
    await expand(wrapper)

    const text = wrapper.find('.term-output').text()
    expect(text).toContain('TAIL_MARK')
    expect(text.includes('HEAD_MARK')).toBe(false)
  })

  it('终态仍展示开头，避免错误行被尾部截掉', async () => {
    const output = 'HEAD_MARK\n' + 'a'.repeat(3500) + '\nTAIL_MARK'
    const wrapper = mountCard(makeToolCall({ output, status: 'completed' }), 5_000)
    await expand(wrapper)

    const text = wrapper.find('.term-output').text()
    expect(text).toContain('HEAD_MARK')
    expect(text.includes('TAIL_MARK')).toBe(false)
  })

  it('新输出到来时跟随到底部', async () => {
    const wrapper = mountCard(makeToolCall({ output: '' }), 5_000)
    await expand(wrapper)

    const el = wrapper.find('.terminal-content').element as HTMLElement
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1_000 })
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 })
    el.scrollTop = 800

    await wrapper.setProps({ toolCall: makeToolCall({ output: 'new line' }), now: 5_000 })
    await nextTick()
    await nextTick()

    expect(el.scrollTop).toBe(1_000)
  })

  it('用户上翻后不再抢滚动', async () => {
    const wrapper = mountCard(makeToolCall({ output: '' }), 5_000)
    await expand(wrapper)

    const el = wrapper.find('.terminal-content').element as HTMLElement
    Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 1_000 })
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 })
    el.scrollTop = 100
    await wrapper.find('.terminal-content').trigger('scroll')

    await wrapper.setProps({ toolCall: makeToolCall({ output: 'new line' }), now: 5_000 })
    await nextTick()
    await nextTick()

    expect(el.scrollTop).toBe(100)
  })

  it('tail 管道长时间无输出时提示缓冲', async () => {
    const wrapper = mountCard(
      makeToolCall({ input: { command: 'npm run test:coverage 2>&1 | tail -60' } }),
      5_000,
    )
    await expand(wrapper)

    expect(wrapper.find('.term-buffered-hint').exists()).toBe(true)
  })

  it('普通命令或已有输出时不提示缓冲', async () => {
    const plain = mountCard(makeToolCall(), 5_000)
    await expand(plain)
    expect(plain.find('.term-buffered-hint').exists()).toBe(false)

    const withOutput = mountCard(
      makeToolCall({
        input: { command: 'npm run test:coverage 2>&1 | tail -60' },
        output: 'partial output',
      }),
      5_000,
    )
    await expand(withOutput)
    expect(withOutput.find('.term-buffered-hint').exists()).toBe(false)
  })
})
