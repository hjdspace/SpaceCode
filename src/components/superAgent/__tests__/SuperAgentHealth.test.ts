/**
 * 只读系统问题面板契约（T13 #83）：
 *  - 问题列表逐项展示：类别文案（经 i18n 键）+ 稳定错误码的本地化文案 + 关联工单；
 *  - 无问题时显示空态文案；
 *  - 面板只读：不渲染任何 button（无重试/忽略等处置入口）。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { SuperAgentHealthItem } from '@/shared/channels/superAgent'
import SuperAgentHealth from '../SuperAgentHealth.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    // 身份映射便于断言键名；工单占位符额外拼出参数，验证插值链路
    t: (key: string, params?: Record<string, unknown>) =>
      params && 'ticketId' in params ? `${key} ${String(params.ticketId)}` : key,
  }),
}))

function item(overrides: Partial<SuperAgentHealthItem> = {}): SuperAgentHealthItem {
  return {
    category: 'engine',
    status: 'error',
    consecutiveFailures: 3,
    code: 'slotUnavailable',
    codeI18nKey: 'superAgent.errors.slotUnavailable',
    lastFailedAt: '2026-01-01T00:00:00Z',
    ticketId: null,
    reflectedOnTicket: false,
    ...overrides,
  }
}

describe('SuperAgentHealth read-only panel', () => {
  it('renders each problem with its category text, localized error text and related ticket', () => {
    const wrapper = mount(SuperAgentHealth, {
      props: {
        problems: [
          item(),
          item({
            category: 'effect:reply',
            code: 'assignmentEnded',
            codeI18nKey: 'superAgent.errors.assignmentEnded',
            ticketId: 'ticket-1',
          }),
        ],
      },
    })

    const text = wrapper.text()
    expect(text).toContain('superAgent.health.title')
    expect(text).toContain('superAgent.health.readonlyHint')
    expect(text).toContain('superAgent.health.categories.engine')
    expect(text).toContain('superAgent.errors.slotUnavailable')
    expect(text).toContain('superAgent.errors.assignmentEnded')
    expect(text).toContain('ticket-1')
  })

  it('falls back to the generic category key for an unknown category', () => {
    const wrapper = mount(SuperAgentHealth, {
      props: { problems: [item({ category: 'effect:telemetry' })] },
    })

    expect(wrapper.text()).toContain('superAgent.health.unknownCategory')
  })

  it('shows the empty state when there are no problems', () => {
    const wrapper = mount(SuperAgentHealth, { props: { problems: [] } })

    expect(wrapper.text()).toContain('superAgent.health.empty')
  })

  it('renders no buttons: the panel is strictly read-only in MVP', () => {
    const withProblems = mount(SuperAgentHealth, { props: { problems: [item()] } })
    const empty = mount(SuperAgentHealth, { props: { problems: [] } })

    expect(withProblems.findAll('button')).toHaveLength(0)
    expect(empty.findAll('button')).toHaveLength(0)
  })
})
