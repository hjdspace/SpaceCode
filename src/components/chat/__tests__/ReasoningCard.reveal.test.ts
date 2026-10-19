import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import ReasoningCard from '../ReasoningCard.vue'
import type { ReasoningBlock } from '@/types'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
config.global.plugins = [i18n]

function block(content: string): ReasoningBlock {
  return { content, startTime: 1000, endTime: 2000 }
}

function shownText(wrapper: ReturnType<typeof mount>): string {
  return wrapper.find('.reasoning-text').text()
}

describe('ReasoningCard 流式揭示', () => {
  beforeEach(() => {
    // jsdom 没有实现 Element.prototype.scrollTo，自动滚底会抛错
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('展开已完成的思考块时直接显示全文，不回放', async () => {
    const content = 'x'.repeat(200)
    const w = mount(ReasoningCard, { props: { reasoning: block(content), isThinking: false } })
    await w.find('.reasoning-header').trigger('click')
    await w.vm.$nextTick()
    expect(shownText(w)).toBe(content)
  })

  it('一批内容到达后逐帧放出，而不是一次贴满', async () => {
    const w = mount(ReasoningCard, { props: { reasoning: block(''), isThinking: true } })
    await w.setProps({ reasoning: block('x'.repeat(100)) })

    await vi.advanceTimersByTimeAsync(16)
    const afterOneFrame = shownText(w).length
    expect(afterOneFrame).toBeGreaterThan(0)
    expect(afterOneFrame).toBeLessThan(100)

    await vi.advanceTimersByTimeAsync(500)
    expect(shownText(w).length).toBeGreaterThan(afterOneFrame)
  })

  it('思考结束时立刻补齐剩余内容', async () => {
    const content = 'x'.repeat(100)
    const w = mount(ReasoningCard, { props: { reasoning: block(''), isThinking: true } })
    await w.setProps({ reasoning: block(content) })
    await vi.advanceTimersByTimeAsync(64)
    expect(shownText(w).length).toBeLessThan(100)

    // 收口会同时折叠卡片，正文节点离开 DOM —— 用页眉摘要验证游标已追平全文
    await w.setProps({ isThinking: false })
    await w.vm.$nextTick()
    expect(w.find('.reasoning-summary').text()).toBe(content)
  })

  it('新的思考块把内容重置后，已显示文本一起回到起点', async () => {
    const w = mount(ReasoningCard, { props: { reasoning: block(''), isThinking: true } })
    await w.setProps({ reasoning: block('x'.repeat(100)) })
    await vi.advanceTimersByTimeAsync(80)
    const partial = shownText(w).length
    expect(partial).toBeGreaterThan(0)
    expect(partial).toBeLessThan(100)

    await w.setProps({ reasoning: block('') })
    await w.vm.$nextTick()
    expect(shownText(w)).toBe('')
  })
})
