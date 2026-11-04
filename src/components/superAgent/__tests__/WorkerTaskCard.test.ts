/**
 * WorkerTaskCard 契约（T06 #76 + T10 #80）：
 *  - 单行卡片展示标题、ticketId/代次/范围与状态；
 *  - 状态表达双通道：状态点颜色之外必须有短状态词（i18n），不能只靠颜色；
 *  - 覆盖全状态集（12 个卡片状态）；
 *  - 执行中的工单展示轻量进度（当前工具），无进度时不占空间；
 *  - T10 #80：review 卡片必须有接受验收/继续追问/停止三个显式出口；
 *    delivery/blocked/failed 卡片按 canRetry 显示重试；超时提醒过的 review
 *    卡片显示「验收超时」徽标；继续追问走内联输入，离开 review 自动收起。
 */
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  SUPER_AGENT_TICKET_CARD_STATES,
  type SuperAgentTicketCard,
} from '@/shared/channels/superAgent'
import WorkerTaskCard from '../WorkerTaskCard.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'superAgent.ticket.generation') return `Gen ${params?.count}`
      if (key === 'superAgent.ticket.scopeAll') return 'whole repo'
      if (key.startsWith('superAgent.ticket.states.')) return key.replace('superAgent.ticket.states.', '')
      return key
    },
  }),
}))

function card(overrides: Partial<SuperAgentTicketCard> = {}): SuperAgentTicketCard {
  return {
    ticketId: 'ticket-abcd1234efgh',
    title: '修复登录',
    state: 'working',
    assignmentId: 'assignment-1',
    generation: 2,
    scopePaths: ['src/auth'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ended: null,
    reviewRemindedAt: null,
    canRetry: false,
    ...overrides,
  }
}

function stateWord(wrapper: ReturnType<typeof mount>): string {
  return wrapper.get('[data-testid="worker-task-card-state"]').text()
}

describe('WorkerTaskCard 单行工单卡片（T06 #76）', () => {
  it('renders title, ticketId, generation and scope in one line', () => {
    const wrapper = mount(WorkerTaskCard, { props: { card: card() } })

    expect(wrapper.get('[data-testid="worker-task-card-title"]').text()).toBe('修复登录')
    const meta = wrapper.get('[data-testid="worker-task-card-meta"]').text()
    expect(meta).toContain('#ticket-a')
    expect(meta).toContain('Gen 2')
    expect(meta).toContain('src/auth')
    // 状态词走 i18n（双通道：不能只靠颜色区分）
    expect(stateWord(wrapper)).toBe('working')
  })

  it('renders the scope-all wording when the mandate covers the whole repo', () => {
    const wrapper = mount(WorkerTaskCard, {
      props: { card: card({ scopePaths: [] }) },
    })
    expect(wrapper.get('[data-testid="worker-task-card-meta"]').text()).toContain('whole repo')
  })

  it('covers every card state with a distinct visible word', () => {
    const states = [...SUPER_AGENT_TICKET_CARD_STATES]
    const words = states.map((state) => {
      const wrapper = mount(WorkerTaskCard, { props: { card: card({ state }) } })
      expect(wrapper.attributes('data-state')).toBe(state)
      return stateWord(wrapper)
    })
    // 全状态集都有词，且互不重复（并非只靠颜色区分）
    expect(words).toEqual(states)
    expect(new Set(words).size).toBe(states.length)
  })

  it('shows the current tool suffix while working and hides it without progress', () => {
    const withProgress = mount(WorkerTaskCard, {
      props: {
        card: card(),
        progress: {
          repoRoot: 'D:/repo',
          seq: 1,
          ticketId: 'ticket-abcd1234efgh',
          state: 'working',
          assignmentId: 'assignment-1',
          currentTool: 'Edit',
          elapsedMs: 1200,
          toolCalls: 4,
          lastActivityAt: '2026-01-01T00:00:02Z',
        },
      },
    })
    expect(withProgress.get('[data-testid="worker-task-card-progress"]').text()).toBe('Edit')

    const withoutProgress = mount(WorkerTaskCard, { props: { card: card() } })
    expect(withoutProgress.find('[data-testid="worker-task-card-progress"]').exists()).toBe(false)
  })

  it('ignores progress that belongs to another ticket', () => {
    const wrapper = mount(WorkerTaskCard, {
      props: {
        card: card(),
        progress: {
          repoRoot: 'D:/repo',
          seq: 1,
          ticketId: 'ticket-other',
          state: 'working',
          assignmentId: 'assignment-1',
          currentTool: 'Edit',
          elapsedMs: null,
          toolCalls: null,
          lastActivityAt: null,
        },
      },
    })
    expect(wrapper.find('[data-testid="worker-task-card-progress"]').exists()).toBe(false)
  })

  it('exposes the ended summary for closed tickets', () => {
    const wrapper = mount(WorkerTaskCard, {
      props: {
        card: card({
          state: 'stopped',
          ended: { outcome: 'stopped', by: 'user', reason: '方向调整', at: '2026-01-01T00:00:05Z' },
        }),
      },
    })
    expect(stateWord(wrapper)).toBe('stopped')
  })
})

describe('WorkerTaskCard 验收、停止与重试出口（T10 #80）', () => {
  it('shows accept/continue/stop outlets only on review cards', () => {
    const review = mount(WorkerTaskCard, { props: { card: card({ state: 'review' }) } })
    expect(review.find('[data-testid="worker-task-card-review-actions"]').exists()).toBe(true)
    expect(review.find('[data-testid="worker-task-card-accept"]').exists()).toBe(true)
    expect(review.find('[data-testid="worker-task-card-continue"]').exists()).toBe(true)
    expect(review.find('[data-testid="worker-task-card-stop"]').exists()).toBe(true)

    const working = mount(WorkerTaskCard, { props: { card: card({ state: 'working' }) } })
    expect(working.find('[data-testid="worker-task-card-review-actions"]').exists()).toBe(false)
  })

  it('emits accept and stop with the ticketId', async () => {
    const wrapper = mount(WorkerTaskCard, { props: { card: card({ state: 'review' }) } })
    await wrapper.get('[data-testid="worker-task-card-accept"]').trigger('click')
    expect(wrapper.emitted('accept')).toEqual([['ticket-abcd1234efgh']])
    await wrapper.get('[data-testid="worker-task-card-stop"]').trigger('click')
    expect(wrapper.emitted('stop')).toEqual([['ticket-abcd1234efgh']])
  })

  it('follow-up outlet opens an inline input, emits the message payload and closes', async () => {
    const wrapper = mount(WorkerTaskCard, { props: { card: card({ state: 'review' }) } })
    await wrapper.get('[data-testid="worker-task-card-continue"]').trigger('click')
    const input = wrapper.get('[data-testid="worker-task-card-followup-input"]')
    await input.setValue('再改一版')
    await wrapper.get('[data-testid="worker-task-card-followup-send"]').trigger('click')
    expect(wrapper.emitted('message')).toEqual([
      [{ ticketId: 'ticket-abcd1234efgh', text: '再改一版' }],
    ])
    // 提交后输入收起，不重复占空间
    expect(wrapper.find('[data-testid="worker-task-card-followup-input"]').exists()).toBe(false)
  })

  it('does not emit a whitespace-only follow-up', async () => {
    const wrapper = mount(WorkerTaskCard, { props: { card: card({ state: 'review' }) } })
    await wrapper.get('[data-testid="worker-task-card-continue"]').trigger('click')
    await wrapper.get('[data-testid="worker-task-card-followup-input"]').setValue('   ')
    await wrapper.get('[data-testid="worker-task-card-followup-send"]').trigger('click')
    expect(wrapper.emitted('message')).toBeUndefined()
    expect(wrapper.find('[data-testid="worker-task-card-followup-input"]').exists()).toBe(true)
  })

  it('closes the follow-up input when the card leaves review', async () => {
    const wrapper = mount(WorkerTaskCard, { props: { card: card({ state: 'review' }) } })
    await wrapper.get('[data-testid="worker-task-card-continue"]').trigger('click')
    expect(wrapper.find('[data-testid="worker-task-card-followup-input"]').exists()).toBe(true)
    await wrapper.setProps({ card: card({ state: 'working' }) })
    expect(wrapper.find('[data-testid="worker-task-card-followup-input"]').exists()).toBe(false)
  })

  it('shows the review-overdue badge only after a reminder', () => {
    const reminded = mount(WorkerTaskCard, {
      props: {
        card: card({ state: 'review', reviewRemindedAt: '2026-01-02T00:00:00.000Z' }),
      },
    })
    expect(reminded.find('[data-testid="worker-task-card-reminded"]').exists()).toBe(true)
    const notReminded = mount(WorkerTaskCard, { props: { card: card({ state: 'review' }) } })
    expect(notReminded.find('[data-testid="worker-task-card-reminded"]').exists()).toBe(false)
  })

  it('shows retry only when canRetry and emits retry with the ticketId', async () => {
    const failed = mount(WorkerTaskCard, {
      props: { card: card({ state: 'failed', canRetry: true }) },
    })
    await failed.get('[data-testid="worker-task-card-retry"]').trigger('click')
    expect(failed.emitted('retry')).toEqual([['ticket-abcd1234efgh']])

    const blocked = mount(WorkerTaskCard, {
      props: { card: card({ state: 'blocked', canRetry: false }) },
    })
    expect(blocked.find('[data-testid="worker-task-card-retry"]').exists()).toBe(false)
  })
})
