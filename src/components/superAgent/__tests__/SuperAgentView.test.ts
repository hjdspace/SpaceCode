/**
 * SuperAgentView 空态契约（T01 #71）：
 *  - 打开入口即出现 Super Agent 空聊天区，文案走 i18n；
 *  - 有项目根时执行 bind → state 的首次往返；无项目根时不做无意义的 IPC。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({
  bind: vi.fn().mockResolvedValue(undefined),
  loadState: vi.fn().mockResolvedValue(undefined),
  projectRoot: 'D:/repo',
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ get projectRoot() { return probe.projectRoot } }),
}))

vi.mock('@/stores/superAgent', () => ({
  useSuperAgentStore: () => ({ bind: probe.bind, loadState: probe.loadState }),
}))

import SuperAgentView from '../SuperAgentView.vue'

beforeEach(() => {
  probe.bind.mockClear()
  probe.loadState.mockClear()
  probe.projectRoot = 'D:/repo'
})

describe('SuperAgentView empty state', () => {
  it('renders the empty state copy and performs the first bind/state round trip', async () => {
    const wrapper = mount(SuperAgentView)

    expect(wrapper.text()).toContain('superAgent.emptyTitle')
    expect(wrapper.text()).toContain('superAgent.emptyHint')

    await flushPromises()
    expect(probe.bind).toHaveBeenCalledWith('D:/repo')
    expect(probe.loadState).toHaveBeenCalledWith('D:/repo')
    wrapper.unmount()
  })

  it('stays an empty state without calling IPC when no project is open', async () => {
    probe.projectRoot = ''
    const wrapper = mount(SuperAgentView)

    await flushPromises()

    expect(wrapper.text()).toContain('superAgent.emptyTitle')
    expect(probe.bind).not.toHaveBeenCalled()
    expect(probe.loadState).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
