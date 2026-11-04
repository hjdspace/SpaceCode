/**
 * WorkerTaskCard 契约（T06 #76）：
 *  - 单行卡片展示标题、ticketId/代次/范围与状态；
 *  - 状态表达双通道：状态点颜色之外必须有短状态词（i18n），不能只靠颜色；
 *  - 覆盖全状态集（12 个卡片状态）；
 *  - 执行中的工单展示轻量进度（当前工具），无进度时不占空间。
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
