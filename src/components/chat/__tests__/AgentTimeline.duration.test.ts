/**
 * 收口后的「总用时」必须与运行中的秒表同一把尺子。
 *
 * 现场证据（会话 0d64141c，2026-11-02）：用户 14:49:33 发出任务，引擎分三段
 * result 收口 —— 15:16:02 durationMs=1481712、15:30:31 durationMs=646573、
 * 15:30:54 durationMs=22857（后台任务通知与排队消息投递都会切出一段）。
 * 旧实现收口时直接取最后一段的 metadata.duration，于是跑了近 40 分钟的卡片
 * 在结算瞬间显示 17.9s，还小于同一张卡上的「思考中 24m 08s」。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { config, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import AgentTimeline from '../AgentTimeline.vue'
import type { Message } from '@/types'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'

const i18n = createI18n({
  legacy: false,
  locale: 'zh-CN',
  fallbackLocale: 'en-US',
  messages: { 'zh-CN': zhCN, 'en-US': enUS },
})
const rootPinia = createPinia()
config.global.plugins = [i18n, rootPinia]

const STUBS = ['MarkdownRenderer', 'ReasoningCard', 'TurnSummaryBar', 'LoadingState', 'ErrorCard']

/** 固定纪元时刻，避免断言跟着 Date.now 漂 */
const T0 = 1_770_000_000_000

function segment(offsetMs: number, durationMs: number, extra: Partial<Message> = {}): Message {
  return {
    id: `m-${offsetMs}`,
    role: 'assistant',
    content: '已完成',
    timestamp: T0 + offsetMs,
    metadata: { model: 'glm-5-3-flash-260828', duration: durationMs, inputTokens: 140_136, outputTokens: 977 },
    timelineEvents: [
      { id: `text-${offsetMs}`, type: 'text', timestamp: T0 + offsetMs + durationMs, status: 'completed', content: '已完成' },
    ],
    ...extra,
  }
}

function mountTimeline(messages: Message[], extra: Record<string, unknown> = {}) {
  return mount(AgentTimeline, {
    props: { messages, loading: false, turnStartTime: T0, ...extra },
    global: { stubs: STUBS },
  })
}

function summaryDuration(wrapper: ReturnType<typeof mountTimeline>): number {
  return wrapper.findComponent({ name: 'TurnSummaryBar' }).props('totalDurationMs') as number
}

describe('AgentTimeline 回合总用时', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('引擎分多段 result：总用时取整段跨度，不是最后一段的 duration', () => {
    const wrapper = mountTimeline([
      segment(1_000, 1_481_712, {
        reasoning: { content: '规划', startTime: T0 + 2_000, endTime: T0 + 1_450_000 },
      }),
      segment(1_500_000, 646_573),
      segment(2_150_000, 22_857),
    ])

    // 最晚落点 = 最后一段收口时刻 T0+2_150_000+22_857；锚点 = 用户消息 T0
    expect(summaryDuration(wrapper)).toBe(2_172_857)
    expect(wrapper.find('.timer-value').text()).toBe('36m 13s')
  })

  it('只看末段消息也会算回回合起点：单段任务不被切成十几秒', () => {
    const wrapper = mountTimeline([segment(2_150_000, 22_857)])

    expect(summaryDuration(wrapper)).toBe(2_172_857)
  })

  it('单段任务：总用时 = 发送时刻到收口，含引擎冷启动', () => {
    const wrapper = mountTimeline([segment(1_000, 17_900)])

    expect(summaryDuration(wrapper)).toBe(18_900)
  })

  it('没有用户消息锚点时（嵌入式面板）退回本组首条消息，等于原 duration', () => {
    const wrapper = mountTimeline([segment(1_000, 17_900)], { turnStartTime: undefined })

    expect(summaryDuration(wrapper)).toBe(17_900)
  })

  it('运行中：秒表与收口共用同一锚点，结算瞬间不跳数', () => {
    const startedAt = Date.now() - 60_000
    const liveMsg: Message = { id: 'm-live', role: 'assistant', content: '正在写', timestamp: startedAt + 1_000 }
    const wrapper = mountTimeline([liveMsg], { loading: true, turnStartTime: startedAt })

    const live = summaryDuration(wrapper)
    expect(live).toBeGreaterThanOrEqual(59_000)
    expect(live).toBeLessThan(120_000)
  })

  it('时间戳不可用时回退到 metadata.duration，不显示 0s', () => {
    const legacy: Message = {
      id: 'm-legacy',
      role: 'assistant',
      content: '已完成',
      timestamp: 0,
      metadata: { model: 'glm', duration: 9_000 },
    }
    const wrapper = mountTimeline([legacy])

    expect(summaryDuration(wrapper)).toBe(9_000)
  })
})
