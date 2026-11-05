/**
 * AttentionBubble 组件契约（T08 #78）：
 *  - 非模态：内联渲染、textarea 无 autofocus 且挂载后不抢占焦点；
 *  - open：展示问题 + 工单溯源 + 等待徽章 + 就地回答入口（空回答禁用提交），
 *    已提交回答数量提示；提交走 store.answerAttention（requestId 幂等键生成），
 *    成功清空输入，失败展示错误提示；
 *  - 认领后折叠为一行审计，点击展开可查看问题与认领数量；
 *  - 非 question（delivery）只展示提示，不提供回答入口。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AttentionBubble from '../AttentionBubble.vue'
import { useSuperAgentStore } from '@/stores/superAgent'
import type { SuperAgentAttentionView } from '@/shared/channels/superAgent'

const mocks = vi.hoisted(() => ({
  attentionAnswer: vi.fn(),
  attentions: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  // store 模块级 import '@/i18n' 会调用 createI18n，需要一并 mock
  createI18n: () => ({ global: { locale: 'zh-CN', t: (key: string) => key } }),
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && 'count' in params) return `${key}:${params.count}`
      return key
    },
  }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    superAgent: {
      attentionAnswer: mocks.attentionAnswer,
      attentions: mocks.attentions,
    },
  },
}))

function view(overrides: Partial<SuperAgentAttentionView> = {}): SuperAgentAttentionView {
  return {
    attentionId: 'attention-1',
    ticketId: 'ticket-1',
    ticketTitle: '修复登录',
    assignmentId: 'assignment-1',
    kind: 'question',
    question: '旧接口还要保留吗？',
    askedAt: '2026-01-01T00:00:00.000Z',
    status: 'open',
    answers: [],
    answeredAt: null,
    ...overrides,
  }
}

function mountBubble(attention: SuperAgentAttentionView): VueWrapper {
  return mount(AttentionBubble, { props: { attention } })
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  mocks.attentionAnswer.mockResolvedValue({
    attentionId: 'attention-1',
    ticketId: 'ticket-1',
    inputId: 'input-1',
    status: 'delivered',
    delivered: true,
    gated: false,
    duplicate: false,
  })
  mocks.attentions.mockResolvedValue({ repoRoot: 'D:/repo', attentions: [], pendingTickets: 0 })
  const store = useSuperAgentStore()
  store.snapshot = {
    repoRoot: 'D:/repo',
    seq: 1,
    asOf: Date.now(),
    staleAfterMs: 5000,
    router: null,
    attention: { unanswered: 1 },
    review: { reminded: 0 },
  }
})

describe('AttentionBubble', () => {
  it('renders an inline non-modal bubble with ticket traceability and no focus stealing', () => {
    const wrapper = mountBubble(view())

    expect(wrapper.find('[data-testid="attention-bubble"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="attention-bubble-question"]').text()).toBe('旧接口还要保留吗？')
    // 工单溯源
    expect(wrapper.find('.ticket-source').text()).toContain('修复登录')
    expect(wrapper.find('.waiting-badge').text()).toBe('superAgent.attention.waitingHint')

    // 非模态：无 overlay/teleport，textarea 不自动聚焦也不抢焦点
    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    expect(textarea.attributes('autofocus')).toBeUndefined()
    expect(document.activeElement).not.toBe(textarea.element)
    expect(wrapper.find('[data-testid="attention-bubble-collapsed"]').exists()).toBe(false)
  })

  it('disables submit until the answer is non-empty', async () => {
    const wrapper = mountBubble(view())

    const submit = wrapper.find('[data-testid="attention-bubble-submit"]')
    expect(submit.attributes('disabled')).toBeDefined()

    const textarea = wrapper.find('[data-testid="attention-bubble-input"]')
    await textarea.setValue('保留，别删')
    expect(wrapper.find('[data-testid="attention-bubble-submit"]').attributes('disabled')).toBeUndefined()
  })

  it('submits the in-place answer with a fresh requestId and clears the input on success', async () => {
    const wrapper = mountBubble(view())

    await wrapper.find('[data-testid="attention-bubble-input"]').setValue('保留，别删')
    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() => expect(mocks.attentionAnswer).toHaveBeenCalled())
    const [repoRoot, command] = mocks.attentionAnswer.mock.calls[0]
    expect(repoRoot).toBe('D:/repo')
    expect(command.attentionId).toBe('attention-1')
    expect(command.text).toBe('保留，别删')
    expect(command.requestId).toMatch(/[0-9a-f-]{8,}/i)
    // 成功后输入被清空（等待 submitAnswer 的 await 链完成）
    await vi.waitFor(() =>
      expect((wrapper.find('[data-testid="attention-bubble-input"]').element as HTMLTextAreaElement).value).toBe(''),
    )
  })

  it('shows the failure hint when submitting fails', async () => {
    mocks.attentionAnswer.mockRejectedValue(new Error('boom'))
    const wrapper = mountBubble(view())

    await wrapper.find('[data-testid="attention-bubble-input"]').setValue('保留，别删')
    await wrapper.find('form').trigger('submit')

    await vi.waitFor(() =>
      expect(wrapper.find('[data-testid="attention-bubble-error"]').exists()).toBe(true),
    )
    expect(wrapper.find('[data-testid="attention-bubble-error"]').text()).toBe(
      'superAgent.attention.answerFailedHint',
    )
  })

  it('shows the submitted-answers hint while waiting for the worker claim', () => {
    const wrapper = mountBubble(view({ answers: ['input-1', 'input-2'] }))

    const hint = wrapper.find('[data-testid="attention-bubble-submitted"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('superAgent.attention.submittedHint:2')
  })

  it('collapses into a one-line audit row after the claim and expands on click', async () => {
    const wrapper = mountBubble(
      view({ status: 'answered', answers: ['input-1'], answeredAt: '2026-01-02T00:00:00.000Z' }),
    )

    const collapsed = wrapper.find('[data-testid="attention-bubble-collapsed"]')
    expect(collapsed.exists()).toBe(true)
    expect(wrapper.find('[data-testid="attention-bubble"]').exists()).toBe(false)
    expect(collapsed.text()).toContain('旧接口还要保留吗？')
    expect(wrapper.find('.audit-detail').exists()).toBe(false)

    await collapsed.find('button').trigger('click')
    const audit = wrapper.find('.audit-detail')
    expect(audit.exists()).toBe(true)
    expect(audit.text()).toContain('superAgent.attention.answeredAudit:1')
    expect(audit.find('.ticket-source').text()).toContain('修复登录')
  })

  it('only offers the answer form for question attentions', () => {
    const wrapper = mountBubble(view({ kind: 'delivery' }))

    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('.delivery-hint').text()).toBe('superAgent.attention.deliveryHint')
  })
})
