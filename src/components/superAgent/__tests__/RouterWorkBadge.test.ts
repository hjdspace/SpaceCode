/**
 * Router 工卡（悬浮工牌）契约。
 *
 * 这块 UI 只解决一件事：Super Agent 对话区看不出工作目录。所以判据是——
 *  - 折叠态就把目录报出来，且此时不拉策略/检查点（没人点开就不必读盘）；
 *  - 展开才拉，并且展开态把「Router 恒在项目根」与「工单可能各走 worktree」分开列，
 *    不让人误以为在工卡上改目录能改 Worker 的落点；
 *  - 没有项目根时整块不出现，不留下一个空工牌。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type {
  SuperAgentCheckpointInfo,
  SuperAgentExecutionPolicyView,
  SuperAgentQueueSnapshot,
  SuperAgentSnapshot,
} from '@/shared/channels/superAgent'
import RouterWorkBadge from '../RouterWorkBadge.vue'
import { useSuperAgentStore } from '@/stores/superAgent'

const mocks = vi.hoisted(() => ({
  executionPolicy: vi.fn(),
  checkpoint: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  createI18n: () => ({ global: { locale: 'zh-CN', t: (key: string) => key } }),
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    superAgent: {
      executionPolicy: mocks.executionPolicy,
      checkpoint: mocks.checkpoint,
    },
  },
}))

function snapshot(overrides: Partial<SuperAgentSnapshot> = {}): SuperAgentSnapshot {
  return {
    repoRoot: 'D:/doc/AI/SpaceCode',
    seq: 1,
    asOf: Date.now(),
    staleAfterMs: 5000,
    router: { sessionId: 'router-1', running: false },
    attention: { unanswered: 0 },
    review: { reminded: 0 },
    ...overrides,
  }
}

function mountBadge() {
  return mount(RouterWorkBadge)
}

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.executionPolicy.mockReset().mockResolvedValue({
    repoRoot: 'D:/doc/AI/SpaceCode',
    policy: { mode: 'serial', maxWorkers: 1, worktree: 'none' },
  } as SuperAgentExecutionPolicyView)
  mocks.checkpoint.mockReset().mockResolvedValue({
    repoRoot: 'D:/doc/AI/SpaceCode',
    checkpoint: null,
    changedFiles: [],
  } as SuperAgentCheckpointInfo)
})

describe('RouterWorkBadge', () => {
  it('折叠态就把工作目录报出来，且不去读策略与检查点', () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()
    superAgent.boundSessionId = 'router-1'

    const wrapper = mountBadge()

    expect(wrapper.find('[data-testid="super-agent-work-badge"]').exists()).toBe(true)
    expect(wrapper.find('.cwd').text()).toBe('D:/doc/AI/SpaceCode')
    expect(wrapper.find('.name').text()).toBe('SpaceCode')
    expect(wrapper.find('[data-testid="super-agent-badge-toggle"]').attributes('aria-expanded'))
      .toBe('false')
    expect(mocks.executionPolicy).not.toHaveBeenCalled()
    expect(mocks.checkpoint).not.toHaveBeenCalled()
  })

  it('点开才展开档案，并读一次执行策略与检查点', async () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()
    superAgent.boundSessionId = 'router-1'

    const wrapper = mountBadge()
    await wrapper.find('[data-testid="super-agent-badge-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="super-agent-badge-toggle"]').attributes('aria-expanded'))
      .toBe('true')
    expect(mocks.executionPolicy).toHaveBeenCalledWith('D:/doc/AI/SpaceCode')
    expect(mocks.checkpoint).toHaveBeenCalledWith('D:/doc/AI/SpaceCode')
    // 展开态的工作目录独立成行，而不是只藏在标题里
    expect(wrapper.find('.field .path').text()).toBe('D:/doc/AI/SpaceCode')
    // 串行 = 共享项目根；这一行必须说清 worktree 归属，不让人误读成可改
    expect(wrapper.text()).toContain('superAgent.badge.serialValue')
  })

  it('Router 在跑时挂上岗标记', () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()
    superAgent.routerRunning = true

    const wrapper = mountBadge()

    expect(wrapper.find('[data-testid="super-agent-badge-on-duty"]').exists()).toBe(true)
  })

  it('还没绑定项目时整块不出现（不报一个尚未绑定的目录）', () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = null

    const wrapper = mountBadge()

    expect(wrapper.find('[data-testid="super-agent-work-badge"]').exists()).toBe(false)
  })

  it('读盘失败不炸工卡：目录仍然可见，读不到的行如实留空而不是永远"读取中"', async () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()
    superAgent.executionPolicy = null
    superAgent.checkpointInfo = null
    mocks.executionPolicy.mockRejectedValue(new Error('no state'))
    mocks.checkpoint.mockRejectedValue(new Error('no state'))

    const wrapper = mountBadge()
    await wrapper.find('[data-testid="super-agent-badge-toggle"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.cwd').text()).toBe('D:/doc/AI/SpaceCode')
    expect(wrapper.text()).not.toContain('superAgent.badge.loading')
    expect(wrapper.text()).toContain('—')
  })

  it('队列现状进档案：执行中与排队按队列快照算', async () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()
    superAgent.queue = {
      repoRoot: 'D:/doc/AI/SpaceCode',
      maxWorkers: 1,
      running: [{ ticketId: 't-1', title: 'A', position: 0, state: 'running', dirty: null }],
      queued: [
        { ticketId: 't-2', title: 'B', position: 1, state: 'queued', dirty: null },
        { ticketId: 't-3', title: 'C', position: 2, state: 'queued', dirty: null },
      ],
    } as SuperAgentQueueSnapshot

    const wrapper = mountBadge()
    await wrapper.find('[data-testid="super-agent-badge-toggle"]').trigger('click')

    expect(wrapper.text()).toContain('superAgent.badge.crewValue')
    expect(wrapper.text()).toContain('"running":1')
    expect(wrapper.text()).toContain('"queued":2')
  })
})
