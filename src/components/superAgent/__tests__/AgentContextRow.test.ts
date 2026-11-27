/**
 * Agent 上下文行（#110）结构测试。
 *
 * 判据：
 *  - 有 boundRepoRoot 时渲染上下文行（工作区名 + 目录触发器 + 分支触发器）；
 *  - 没有 boundRepoRoot 时整块不出现；
 *  - 目录下拉可展开，列出最近项目根目录，选中时触发 openProjectByPath 重建会话；
 *  - 分支下拉在 git 仓库时展示分支列表，选中时调用 scmStore.checkoutBranch（与 IDE 一致）。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { SuperAgentSnapshot } from '@/shared/channels/superAgent'
import AgentContextRow from '../AgentContextRow.vue'
import { useSuperAgentStore } from '@/stores/superAgent'

// ── Mocks ────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  getBranches: vi.fn(),
  checkout: vi.fn(),
  selectFolder: vi.fn(),
  openProjectByPath: vi.fn(),
  scmCheckoutBranch: vi.fn(),
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
    git: {
      getBranches: mocks.getBranches,
      checkout: mocks.checkout,
    },
    selectFolder: mocks.selectFolder,
  },
}))

vi.mock('@/composables/useOpenProjectWorkflow', () => ({
  useOpenProjectWorkflow: () => ({
    openProjectByPath: mocks.openProjectByPath,
  }),
}))

vi.mock('@/stores/scm', () => ({
  useScmStore: () => ({
    checkoutBranch: mocks.scmCheckoutBranch,
  }),
}))

// Stub localStorage for getRecentProjectRoots
const STORAGE_KEY = 'app_recent_project_roots_v1'
beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(['D:/proj/A', 'D:/proj/B', 'D:/proj/C']),
  )
})

function snapshot(overrides: Partial<SuperAgentSnapshot> = {}): SuperAgentSnapshot {
  return {
    repoRoot: 'D:/proj/A',
    seq: 1,
    asOf: Date.now(),
    staleAfterMs: 5000,
    router: { sessionId: 'router-1', running: false },
    attention: { unanswered: 0 },
    review: { reminded: 0 },
    ...overrides,
  }
}

function mountRow() {
  return mount(AgentContextRow, {
    global: {
      stubs: {
        // Stub Transition to avoid timing issues in tests
        Transition: { template: '<div><slot /></div>' },
      },
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  mocks.getBranches.mockReset().mockResolvedValue([
    { name: 'main', current: true, isRemote: false },
    { name: 'dev', current: false, isRemote: false },
  ])
  mocks.checkout.mockReset().mockResolvedValue({ success: true })
  mocks.scmCheckoutBranch.mockReset().mockResolvedValue({ success: true })
  mocks.selectFolder.mockReset().mockResolvedValue({ canceled: true, filePaths: [] })
  mocks.openProjectByPath.mockReset()
})

describe('AgentContextRow', () => {
  it('有 boundRepoRoot 时渲染上下文行，显示工作区名', () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()

    const wrapper = mountRow()

    expect(wrapper.find('[data-testid="agent-context-row"]').exists()).toBe(true)
    expect(wrapper.find('.ctx-workspace').text()).toContain('A')
  })

  it('没有 boundRepoRoot 时整块不出现', () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = null

    const wrapper = mountRow()

    expect(wrapper.find('[data-testid="agent-context-row"]').exists()).toBe(false)
  })

  it('目录下拉可展开并列出最近项目根目录', async () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()

    const wrapper = mountRow()

    // Initially dropdown is closed
    expect(wrapper.find('[data-testid="agent-context-dir-dropdown"]').exists()).toBe(false)

    // Open dropdown
    await wrapper.find('[data-testid="agent-context-dir-trigger"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="agent-context-dir-dropdown"]').exists()).toBe(true)
    const items = wrapper.findAll('[data-testid="agent-context-dir-item"]')
    expect(items.length).toBeGreaterThanOrEqual(3)
    // Current directory should be marked as selected
    expect(items[0].classes()).toContain('selected')
  })

  it('选中不同目录时调用 openProjectByPath 重建会话', async () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()

    const wrapper = mountRow()
    await wrapper.find('[data-testid="agent-context-dir-trigger"]').trigger('click')
    await flushPromises()

    // Click the second directory (D:/proj/B)
    const items = wrapper.findAll('[data-testid="agent-context-dir-item"]')
    // Find an item that is not the current one
    const target = items.find((item) => !item.classes().includes('selected'))
    expect(target).toBeTruthy()
    await target!.trigger('click')
    await flushPromises()

    expect(mocks.openProjectByPath).toHaveBeenCalledWith('D:/proj/B')
    // Rebuild hint should appear
    expect(wrapper.find('[data-testid="agent-context-rebuild-hint"]').exists()).toBe(true)
  })

  it('点击当前目录不触发重建', async () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()

    const wrapper = mountRow()
    await wrapper.find('[data-testid="agent-context-dir-trigger"]').trigger('click')
    await flushPromises()

    const items = wrapper.findAll('[data-testid="agent-context-dir-item"]')
    const current = items.find((item) => item.classes().includes('selected'))
    expect(current).toBeTruthy()
    await current!.trigger('click')

    expect(mocks.openProjectByPath).not.toHaveBeenCalled()
  })

  it('git 仓库时显示分支触发器并可展开分支列表', async () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()

    const wrapper = mountRow()
    await flushPromises()

    // Branch trigger should exist and show the current branch name
    const branchTrigger = wrapper.find('[data-testid="agent-context-branch-trigger"]')
    expect(branchTrigger.exists()).toBe(true)
    expect(branchTrigger.find('.ctx-label').text()).toContain('main')

    // Open branch dropdown
    await wrapper.find('[data-testid="agent-context-branch-trigger"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="agent-context-branch-dropdown"]').exists()).toBe(true)
    expect(mocks.getBranches).toHaveBeenCalledWith('D:/proj/A')
    // Branch list should show branches
    const branchItems = wrapper.findAll('.ctx-item')
    const branchNames = branchItems.map((item) => item.find('.ctx-item-name').text())
    expect(branchNames).toContain('main')
    expect(branchNames).toContain('dev')
  })

  it('选中非当前分支时调用 scmStore.checkoutBranch', async () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()

    const wrapper = mountRow()
    await flushPromises()

    await wrapper.find('[data-testid="agent-context-branch-trigger"]').trigger('click')
    await flushPromises()

    // Find the 'dev' branch item (not current)
    const branchItems = wrapper.findAll('.ctx-item')
    const devItem = branchItems.find((item) => item.find('.ctx-item-name').text() === 'dev')
    expect(devItem).toBeTruthy()
    await devItem!.trigger('click')

    expect(mocks.scmCheckoutBranch).toHaveBeenCalledWith('dev')
  })

  it('非 git 仓库时不显示分支触发器', async () => {
    const superAgent = useSuperAgentStore()
    superAgent.snapshot = snapshot()
    mocks.getBranches.mockResolvedValue([])

    const wrapper = mountRow()
    await flushPromises()

    // No branch → no branch trigger
    expect(wrapper.find('[data-testid="agent-context-branch-trigger"]').exists()).toBe(false)
  })
})
