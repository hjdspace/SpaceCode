/**
 * CronRunsPanel 组件测试 — 「查看错误 / 查看输出」要真的把内容展开出来。
 * Seam: api.cron.taskRuns 返回的记录 → 面板上的可见文本。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import CronRunsPanel from '@/components/cron/CronRunsPanel.vue'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { api } from '@/services/electronAPI'
import enUS from '@/i18n/locales/en-US'

enableAutoUnmount(afterEach)

const i18n = createI18n({ legacy: false, locale: 'en-US', messages: { 'en-US': enUS } })

const failedRun = {
  id: 'r1',
  taskId: 't1',
  taskName: '依赖巡检',
  startedAt: '2026-10-07T10:00:00.000Z',
  completedAt: '2026-10-07T10:00:01.000Z',
  status: 'failed' as const,
  prompt: '分析当前项目',
  error: "'bun' is not recognized as an internal or external command",
}

const completedRun = {
  id: 'r2',
  taskId: 't1',
  taskName: '依赖巡检',
  startedAt: '2026-10-06T10:00:00.000Z',
  status: 'completed' as const,
  prompt: '分析当前项目',
  output: '{"type":"result","result":"ok"}',
}

function mountPanel() {
  return mount(CronRunsPanel, {
    props: { taskId: 't1' },
    global: { plugins: [i18n], stubs: { Teleport: true } },
    attachTo: document.body,
  })
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useAppStore().projectRoot = '/project'
  vi.spyOn(api.cron, 'taskRuns').mockResolvedValue([failedRun, completedRun] as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('CronRunsPanel', () => {
  it('点「查看错误」展开该条记录的 stderr，再点收起', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    const errorBtn = wrapper.findAll('.run-output-btn')[0]
    expect(errorBtn.text()).toBe('View Error')

    await errorBtn.trigger('click')
    expect(wrapper.find('.run-output').text()).toContain('not recognized')

    await wrapper.findAll('.run-output-btn')[0].trigger('click')
    expect(wrapper.find('.run-output').exists()).toBe(false)
  })

  it('成功记录展开的是 stdout 而不是错误', async () => {
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.findAll('.run-output-btn')[1].trigger('click')
    expect(wrapper.find('.run-output').text()).toContain('"result":"ok"')
  })

  it('没有内容的记录不会点开一片空白', async () => {
    vi.mocked(api.cron.taskRuns).mockResolvedValue([
      { ...completedRun, output: undefined },
    ] as never)
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('.run-output-btn').trigger('click')
    expect(wrapper.find('.run-output').text()).toBe('This run produced no output')
  })

  it('执行记录给出「View Session」入口，点了就切到那次执行的会话', async () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('依赖巡检', '/project', 'sess-cron-1', { activate: false })
    vi.mocked(api.cron.taskRuns).mockResolvedValue([
      { ...completedRun, sessionId: 'sess-cron-1' },
    ] as never)
    const wrapper = mountPanel()
    await flushPromises()

    const appStore = useAppStore()
    appStore.showCronManager = true
    const sessionBtn = wrapper.find('.run-session-btn')
    expect(sessionBtn.text()).toBe('View Session')

    await sessionBtn.trigger('click')
    expect(sessionStore.currentSessionId).toBe('sess-cron-1')
    expect(appStore.showCronManager).toBe(false)
  })

  it('会话已被删除时不给死按钮', async () => {
    vi.mocked(api.cron.taskRuns).mockResolvedValue([
      { ...completedRun, sessionId: 'sess-gone' },
    ] as never)
    const wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.find('.run-session-btn').exists()).toBe(false)
  })
})
