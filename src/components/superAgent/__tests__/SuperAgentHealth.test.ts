/**
 * 可操作系统问题面板契约（T13 #83，T20 #90 升级）：
 *  - 问题列表逐项展示：类别文案（经 i18n 键）+ 稳定错误码的本地化文案 + 关联工单；
 *  - 系统级问题提供重试/忽略，忽略走两步确认（确认/取消）；
 *  - unavailable Eval（eval 类别主体项）提供重新评估/忽略，不提供重试；
 *  - 面板操作与只读态视觉区分：有问题时挂 actionable 类、渲染按钮；
 *    空态无按钮；
 *  - 处置动作全部上抛给父级（emit），面板自身不发命令。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { SuperAgentHealthItem } from '@/shared/channels/superAgent'
import SuperAgentHealth from '../SuperAgentHealth.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    // 身份映射便于断言键名；占位符额外拼出参数，验证插值链路
    t: (key: string, params?: Record<string, unknown>) =>
      params && 'ticketId' in params
        ? `${key} ${String(params.ticketId)}`
        : params && 'count' in params
          ? `${key} ${String(params.count)}`
          : key,
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
    subjectId: null,
    ...overrides,
  }
}

function find(wrapper: ReturnType<typeof mount>, testid: string) {
  return wrapper.find(`[data-testid="${testid}"]`)
}

describe('SuperAgentHealth actionable panel（T20 #90）', () => {
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
    expect(text).toContain('superAgent.health.summary 2')
    expect(text).toContain('superAgent.health.actionableHint')
    expect(text).toContain('superAgent.health.categories.engine')
    expect(text).toContain('superAgent.errors.slotUnavailable')
    expect(text).toContain('superAgent.errors.assignmentEnded')
    expect(text).toContain('superAgent.health.relatedTicket ticket-1')
  })

  it('falls back to the generic category key for an unknown category', () => {
    const wrapper = mount(SuperAgentHealth, { props: { problems: [item({ category: 'effect:telemetry' })] } })

    expect(wrapper.text()).toContain('superAgent.health.unknownCategory')
  })

  it('shows the empty state when there are no problems', () => {
    const wrapper = mount(SuperAgentHealth, { props: { problems: [] } })

    expect(wrapper.text()).toContain('superAgent.health.empty')
    expect(wrapper.find('.super-agent-health').classes()).not.toContain('actionable')
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('marks the panel actionable and renders retry/dismiss for system-level problems', async () => {
    const wrapper = mount(SuperAgentHealth, { props: { problems: [item()] } })

    expect(wrapper.find('.super-agent-health').classes()).toContain('actionable')
    expect(find(wrapper, 'super-agent-health-retry-engine').exists()).toBe(true)
    expect(find(wrapper, 'super-agent-health-dismiss-engine').exists()).toBe(true)
    expect(find(wrapper, 'super-agent-health-reevaluate-engine').exists()).toBe(false)

    await find(wrapper, 'super-agent-health-retry-engine').trigger('click')
    expect(wrapper.emitted('retry')).toEqual([['engine', null]])
  })

  it('renders reevaluate/dismiss (not retry) for an unavailable eval subject', async () => {
    const wrapper = mount(SuperAgentHealth, {
      props: {
        problems: [
          item({
            category: 'eval',
            code: 'evalUnavailable',
            codeI18nKey: 'superAgent.errors.evalUnavailable',
            subjectId: 'eval-1',
          }),
        ],
      },
    })

    expect(find(wrapper, 'super-agent-health-reevaluate-eval-eval-1').exists()).toBe(true)
    expect(find(wrapper, 'super-agent-health-retry-eval-eval-1').exists()).toBe(false)
    expect(find(wrapper, 'super-agent-health-dismiss-eval-eval-1').exists()).toBe(true)

    await find(wrapper, 'super-agent-health-reevaluate-eval-eval-1').trigger('click')
    expect(wrapper.emitted('reevaluate')).toEqual([['eval-1']])
  })

  it('requires a two-step confirmation before dismissing', async () => {
    const wrapper = mount(SuperAgentHealth, { props: { problems: [item()] } })

    // 第一步：忽略 → 出现确认/取消，不 emit
    await find(wrapper, 'super-agent-health-dismiss-engine').trigger('click')
    expect(wrapper.text()).toContain('superAgent.health.dismissConfirm')
    expect(find(wrapper, 'super-agent-health-dismiss-confirm-engine').exists()).toBe(true)
    expect(wrapper.emitted('dismiss')).toBeUndefined()

    // 取消：回到普通态，不 emit
    await find(wrapper, 'super-agent-health-dismiss-cancel-engine').trigger('click')
    expect(find(wrapper, 'super-agent-health-dismiss-confirm-engine').exists()).toBe(false)
    expect(wrapper.emitted('dismiss')).toBeUndefined()

    // 确认忽略：emit dismiss
    await find(wrapper, 'super-agent-health-dismiss-engine').trigger('click')
    await find(wrapper, 'super-agent-health-dismiss-confirm-engine').trigger('click')
    expect(wrapper.emitted('dismiss')).toEqual([['engine', null]])
  })

  it('dismisses an eval subject with its subjectId', async () => {
    const wrapper = mount(SuperAgentHealth, {
      props: {
        problems: [
          item({
            category: 'eval',
            code: 'evalUnavailable',
            codeI18nKey: 'superAgent.errors.evalUnavailable',
            subjectId: 'eval-1',
          }),
        ],
      },
    })

    await find(wrapper, 'super-agent-health-dismiss-eval-eval-1').trigger('click')
    await find(wrapper, 'super-agent-health-dismiss-confirm-eval-eval-1').trigger('click')
    expect(wrapper.emitted('dismiss')).toEqual([['eval', 'eval-1']])
  })
})
