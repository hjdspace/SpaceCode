/**
 * ComposerStatusBar — 任务进度按会话取数。
 *
 * 回归：Worker 会话的 TodoWrite 曾通过共享 taskManager 写进全局
 * sessionContext.tasks，导致 Router 页输入框上方的胶囊显示 Worker 的任务。
 * 组件必须只读自己 sessionId 对应的会话消息。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const mocks = vi.hoisted(() => ({
  openRightPanel: vi.fn(),
  openReviewPanel: vi.fn(),
  openReviewWithFile: vi.fn(),
  summaryFor: vi.fn(),
  groupedFor: vi.fn(() => ({ current: [], earlier: [] })),
  getDisplayMessages: vi.fn(),
  currentSessionId: 'router-session',
  /** 全局 sessionContext 里残留着 Worker 的任务 —— 组件不得读取它 */
  globalTasks: [{ id: '1', content: '分析覆盖率', status: 'in_progress' }],
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && typeof params.total === 'number'
        ? `${key}:${params.completed}/${params.total}`
        : key,
  }),
}))

vi.mock('@/stores/sessionContext', () => ({
  useSessionContext: () => ({
    tasks: mocks.globalTasks,
    taskProgress: { completed: 0, total: 1 },
    openRightPanel: mocks.openRightPanel,
    openReviewPanel: mocks.openReviewPanel,
    openReviewWithFile: mocks.openReviewWithFile,
  }),
}))

vi.mock('@/stores/sessionFileChanges', () => ({
  useSessionFileChangesStore: () => ({
    summaryFor: mocks.summaryFor,
    groupedFor: mocks.groupedFor,
  }),
}))

vi.mock('@/stores/chatSession', () => ({
  useChatSessionStore: () => ({
    get currentSessionId() { return mocks.currentSessionId },
    getDisplayMessages: mocks.getDisplayMessages,
  }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ projectRoot: 'D:/repo' }),
}))

import ComposerStatusBar from '../ComposerStatusBar.vue'

const EMPTY_SUMMARY = {
  files: [],
  sessionCount: 0,
  sessionAdditions: 0,
  sessionDeletions: 0,
  turn: 0,
  turnCount: 0,
  turnAdditions: 0,
  turnDeletions: 0,
}

const messagesBySession: Record<string, unknown[]> = {
  'router-session': [{ role: 'assistant', toolCalls: [] }],
  'worker-session': [
    {
      role: 'assistant',
      toolCalls: [{
        id: 'tool-1',
        name: 'TodoWrite',
        status: 'completed',
        input: {
          todos: [
            { id: '1', content: '分析覆盖率', status: 'completed' },
            { id: '2', content: '补测试', status: 'in_progress' },
            { id: '3', content: '跑覆盖率', status: 'pending' },
          ],
        },
      }],
    },
  ],
  'v2-session': [
    {
      role: 'assistant',
      toolCalls: [{
        id: 'tool-2',
        name: 'TaskCreate',
        status: 'completed',
        input: { description: '分析覆盖率' },
        output: 'Task #1 created successfully: 分析覆盖率',
      }],
    },
    {
      role: 'assistant',
      toolCalls: [{
        id: 'tool-3',
        name: 'TaskUpdate',
        status: 'completed',
        input: { taskId: '1', status: 'completed' },
        output: 'Updated task #1',
      }],
    },
  ],
}

function mountBar(sessionId: string, props: Record<string, unknown> = {}) {
  return mount(ComposerStatusBar, {
    props: { sessionId, ...props },
  })
}

beforeEach(() => {
  mocks.openRightPanel.mockClear()
  mocks.summaryFor.mockReset()
  mocks.summaryFor.mockReturnValue(EMPTY_SUMMARY)
  mocks.getDisplayMessages.mockReset()
  mocks.getDisplayMessages.mockImplementation((sid: string) => messagesBySession[sid] ?? [])
})

describe('ComposerStatusBar 任务进度按会话取数', () => {
  it('Router 会话不显示胶囊，即使全局 sessionContext 残留 Worker 的任务', () => {
    const wrapper = mountBar('router-session')

    expect(wrapper.find('.composer-status-bar').exists()).toBe(false)
    expect(wrapper.find('.task-zone').exists()).toBe(false)
  })

  it('只显示本会话的 TodoWrite 进度', () => {
    const wrapper = mountBar('worker-session')

    expect(wrapper.get('.task-zone').text()).toContain('composerStatus.stepProgress:1/3')
  })

  it('V2 task 工具同样按会话回放，口径与 ChatPanel 一致', () => {
    const wrapper = mountBar('v2-session')

    expect(wrapper.get('.task-zone').text()).toContain('composerStatus.stepProgress:1/1')
  })

  it('openTaskPanel=false 的宿主不打开会话右面板，也不渲染按钮语义', async () => {
    const wrapper = mountBar('worker-session', { openTaskPanel: false })
    const zone = wrapper.get('.task-zone')

    expect(zone.attributes('role')).toBeUndefined()
    await zone.trigger('click')
    expect(mocks.openRightPanel).not.toHaveBeenCalled()
  })

  it('默认点击任务区打开会话右面板', async () => {
    const wrapper = mountBar('worker-session')

    await wrapper.get('.task-zone').trigger('click')
    expect(mocks.openRightPanel).toHaveBeenCalledWith('tasks')
  })
})
