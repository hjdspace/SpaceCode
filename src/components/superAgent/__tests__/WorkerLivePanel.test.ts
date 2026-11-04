/**
 * WorkerLivePanel 只读镜像契约（T07 #77）：
 *  - 面板从激活 worker 标签取 ticketId，镜像缺失时幂等挂 workerBind；
 *  - 复用 AgentTimeline 渲染 Worker 稳定会话，readonly 恒为 true，
 *    loading 跟随最新 Assignment 是否执行中；
 *  - 代次分段以时间线上方薄层区块叠加，按 generation 升序（复用不新分段、重试新分段）；
 *  - 只读提示可见：默认只读，不自动接管。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SuperAgentWorkerMirror } from '@/shared/channels/superAgent'

const probe = vi.hoisted(() => ({
  projectRoot: 'D:/repo',
  ticketId: 'ticket-1' as string | null,
  mirror: null as SuperAgentWorkerMirror | null,
  bindWorker: vi.fn().mockResolvedValue(undefined),
  messages: [] as unknown[],
}))

vi.mock('vue-i18n', () => ({
  createI18n: vi.fn(),
  useI18n: () => ({ t: (key: string, params?: Record<string, unknown>) => {
    if (params && typeof params.n === 'number') return `${key}:${params.n}`
    return key
  } }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    get projectRoot() { return probe.projectRoot },
    get activeInfoTab() {
      if (!probe.ticketId) return null
      return {
        id: `worker:${probe.ticketId}`,
        type: 'worker',
        title: '工单',
        icon: null,
        data: { ticketId: probe.ticketId, repoRoot: probe.projectRoot },
        closeable: true,
      }
    },
  }),
  // 与实现同源的收窄辅助：直接复刻 store 侧判别逻辑
  workerTicketId: (tab: { type?: string; data?: { ticketId?: string } | null } | null) =>
    tab && tab.type === 'worker' ? (tab.data?.ticketId ?? null) : null,
}))

vi.mock('@/stores/superAgent', () => ({
  useSuperAgentStore: () => ({
    get workerMirrors() {
      return probe.mirror ? { [probe.mirror.ticketId]: probe.mirror } : {}
    },
    bindWorker: probe.bindWorker,
  }),
}))

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => ({
    getDisplayMessages: () => probe.messages,
  }),
}))

import WorkerLivePanel from '../WorkerLivePanel.vue'
import AgentTimeline from '@/components/chat/AgentTimeline.vue'

function workerMirror(overrides: Partial<SuperAgentWorkerMirror> = {}): SuperAgentWorkerMirror {
  return {
    repoRoot: 'D:/repo',
    ticketId: 'ticket-1',
    title: '修复登录',
    sessionId: 'superagent-worker-ticket-1',
    running: false,
    segments: [
      {
        assignmentId: 'assignment-1',
        generation: 1,
        state: 'pending',
        endedReason: null,
        createdAt: '2026-01-01T00:00:00Z',
        startedAt: null,
        endedAt: null,
        reportKind: null,
        reportSummary: null,
      },
    ],
    ...overrides,
  }
}

function mountPanel() {
  return mount(WorkerLivePanel, {
    global: {
      // 只替换渲染层，保留组件引用与 props 供断言
      stubs: { AgentTimeline: true },
    },
  })
}

beforeEach(() => {
  probe.projectRoot = 'D:/repo'
  probe.ticketId = 'ticket-1'
  probe.mirror = null
  probe.messages = []
  probe.bindWorker.mockClear()
  probe.bindWorker.mockResolvedValue(undefined)
})

describe('WorkerLivePanel readonly mirror（T07 #77）', () => {
  it('镜像缺失时挂载即幂等挂 workerBind，已有快照则不重复挂', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    expect(probe.bindWorker).toHaveBeenCalledWith('D:/repo', 'ticket-1')

    // 镜像已在 store 中（例如从其他标签切回）时不再重复 IPC
    probe.bindWorker.mockClear()
    probe.mirror = workerMirror()
    const second = mountPanel()
    await flushPromises()
    expect(probe.bindWorker).not.toHaveBeenCalled()
    second.unmount()
    wrapper.unmount()
  })

  it('复用 AgentTimeline 渲染 Worker 稳定会话：readonly 恒 true，loading 跟随执行状态', async () => {
    probe.mirror = workerMirror({ running: true })
    const wrapper = mountPanel()
    await flushPromises()

    const timeline = wrapper.findComponent(AgentTimeline)
    expect(timeline.exists()).toBe(true)
    expect(timeline.props('sessionId')).toBe('superagent-worker-ticket-1')
    expect(timeline.props('readonly')).toBe(true)
    expect(timeline.props('loading')).toBe(true)
    expect(timeline.props('messages')).toEqual([])
    wrapper.unmount()
  })

  it('代次分段作为时间线上方薄层区块，按 generation 升序展示状态与 Report 摘要', async () => {
    probe.mirror = workerMirror({
      running: true,
      segments: [
        {
          assignmentId: 'assignment-1',
          generation: 1,
          state: 'ended',
          endedReason: 'completed',
          createdAt: '2026-01-01T00:00:00Z',
          startedAt: '2026-01-01T00:00:01Z',
          endedAt: '2026-01-01T00:10:00Z',
          reportKind: 'ready',
          reportSummary: '登录按钮已修复，等待复核',
        },
        {
          assignmentId: 'assignment-2',
          generation: 2,
          state: 'running',
          endedReason: null,
          createdAt: '2026-01-01T00:11:00Z',
          startedAt: '2026-01-01T00:11:01Z',
          endedAt: null,
          reportKind: 'progress',
          reportSummary: '正在补充测试',
        },
      ],
    })
    const wrapper = mountPanel()
    await flushPromises()

    const segments = wrapper.findAll('[data-testid^="worker-segment-"]')
    expect(segments).toHaveLength(2)
    // 复用不新分段（gen 1 保持），重试新分段（gen 2 追加），升序渲染
    expect(segments[0].attributes('data-testid')).toBe('worker-segment-1')
    expect(segments[0].text()).toContain('superAgent.worker.generation:1')
    expect(segments[0].text()).toContain('superAgent.worker.states.ended')
    expect(segments[0].text()).toContain('登录按钮已修复，等待复核')
    expect(segments[1].attributes('data-testid')).toBe('worker-segment-2')
    expect(segments[1].text()).toContain('superAgent.worker.states.running')
    wrapper.unmount()
  })

  it('默认只读不自动接管：只读提示可见，且最新分段高亮执行状态', async () => {
    probe.mirror = workerMirror({ running: true })
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.find('[data-testid="worker-readonly-hint"]').text()).toBe(
      'superAgent.worker.readonlyHint',
    )
    const head = wrapper.find('[data-testid="worker-state"]')
    expect(head.text()).toBe('superAgent.worker.running')
    expect(head.classes()).toContain('running')
    wrapper.unmount()
  })

  it('激活标签不是 worker 时保持空态且不做 IPC', async () => {
    probe.ticketId = null
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.findComponent(AgentTimeline).exists()).toBe(false)
    expect(probe.bindWorker).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
