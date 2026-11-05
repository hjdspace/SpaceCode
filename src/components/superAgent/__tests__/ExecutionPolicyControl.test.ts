/**
 * ExecutionPolicyControl（T12 #82）组件接线契约：
 *  - 默认渲染当前模式 chip；打开面板显示串行提示与「切换到并行」入口；
 *  - 开启并行走两步确认：先弹确认区（上限输入 + 确认文案），确认后以
 *    { mode:'parallel', maxWorkers, confirmed:true } 委托 store.setPolicy；
 *  - 后端拒绝（如 policyChangeBlocked）时就地显示稳定错误码文案；
 *  - 回到串行直接委托 { mode:'serial' }（无确认）；
 *  - 检查点回退：渲染检查点时间与回退候选清单，逐文件回退委托
 *    store.rollbackCheckpointFiles，成功显示回退数量提示。
 */
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const probe = vi.hoisted(() => ({
  loadPolicy: vi.fn().mockResolvedValue(undefined),
  setPolicy: vi.fn().mockResolvedValue(undefined),
  loadCheckpoint: vi.fn().mockResolvedValue(undefined),
  rollbackCheckpointFiles: vi.fn().mockResolvedValue({ rolled: ['src/a.ts'], skipped: [] }),
  executionPolicy: null as { repoRoot: string; policy: { mode: 'serial' | 'parallel'; maxWorkers: number; worktree: 'none' | 'per-ticket' } } | null,
  checkpointInfo: null as { repoRoot: string; checkpoint: { savedAt: string; head: string | null; entries: string[] } | null; changedFiles: string[] } | null,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('@/stores/superAgent', () => ({
  useSuperAgentStore: () => ({
    loadPolicy: probe.loadPolicy,
    setPolicy: probe.setPolicy,
    loadCheckpoint: probe.loadCheckpoint,
    rollbackCheckpointFiles: probe.rollbackCheckpointFiles,
    get executionPolicy() { return probe.executionPolicy },
    get checkpointInfo() { return probe.checkpointInfo },
  }),
}))

import ExecutionPolicyControl from '../ExecutionPolicyControl.vue'

const REPO = 'D:/repo'

function mountControl() {
  return mount(ExecutionPolicyControl, { props: { repoRoot: REPO } })
}

beforeEach(() => {
  vi.clearAllMocks()
  probe.executionPolicy = { repoRoot: REPO, policy: { mode: 'serial', maxWorkers: 1, worktree: 'none' } }
  probe.checkpointInfo = { repoRoot: REPO, checkpoint: null, changedFiles: [] }
  probe.setPolicy.mockResolvedValue(undefined)
  probe.rollbackCheckpointFiles.mockResolvedValue({ rolled: ['src/a.ts'], skipped: [] })
})

describe('ExecutionPolicyControl rendering', () => {
  it('shows the serial mode on the chip and loads policy & checkpoint on mount', async () => {
    const wrapper = mountControl()
    await flushPromises()

    expect(wrapper.get('[data-testid="execution-policy"]').text()).toContain('superAgent.policy.serial')
    expect(probe.loadPolicy).toHaveBeenCalledWith(REPO)
    expect(probe.loadCheckpoint).toHaveBeenCalledWith(REPO)
  })

  it('shows the parallel mode with worker limit on the chip', async () => {
    probe.executionPolicy = {
      repoRoot: REPO,
      policy: { mode: 'parallel', maxWorkers: 4, worktree: 'per-ticket' },
    }
    const wrapper = mountControl()
    await flushPromises()

    expect(wrapper.get('.chip').text()).toContain('superAgent.policy.parallel')
    expect(wrapper.get('.chip').text()).toContain('4')
  })
})

describe('switching policy', () => {
  it('requires a two-step confirmation before enabling parallel (confirmed: true)', async () => {
    const wrapper = mountControl()
    await flushPromises()

    // 第一步：打开面板并点「切换到并行」→ 出现确认区，尚未调用 setPolicy
    await wrapper.get('.chip').trigger('click')
    await wrapper.get('[data-testid="policy-begin-parallel"]').trigger('click')
    expect(wrapper.find('[data-testid="policy-confirm"]').exists()).toBe(true)
    expect(probe.setPolicy).not.toHaveBeenCalled()

    // 第二步：确认 → setPolicy 携带 confirmed:true 与上限
    await wrapper.get('[data-testid="policy-confirm-parallel"]').trigger('click')
    await flushPromises()
    expect(probe.setPolicy).toHaveBeenCalledWith(REPO, {
      mode: 'parallel',
      maxWorkers: 2,
      confirmed: true,
    })
  })

  it('lets the user cancel before confirming parallel', async () => {
    const wrapper = mountControl()
    await flushPromises()
    await wrapper.get('.chip').trigger('click')
    await wrapper.get('[data-testid="policy-begin-parallel"]').trigger('click')
    await wrapper.get('.action:last-of-type').trigger('click') // 取消
    expect(wrapper.find('[data-testid="policy-confirm"]').exists()).toBe(false)
    expect(probe.setPolicy).not.toHaveBeenCalled()
  })

  it('shows a stable error message when the backend refuses (policyChangeBlocked)', async () => {
    probe.setPolicy.mockRejectedValue({ code: 'policyChangeBlocked' })
    const wrapper = mountControl()
    await flushPromises()
    await wrapper.get('.chip').trigger('click')
    await wrapper.get('[data-testid="policy-begin-parallel"]').trigger('click')
    await wrapper.get('[data-testid="policy-confirm-parallel"]').trigger('click')
    await flushPromises()

    expect(wrapper.get('[data-testid="policy-error"]').text()).toContain('superAgent.errors.policyChangeBlocked')
  })

  it('switches back to serial directly (no confirmation)', async () => {
    probe.executionPolicy = {
      repoRoot: REPO,
      policy: { mode: 'parallel', maxWorkers: 3, worktree: 'per-ticket' },
    }
    const wrapper = mountControl()
    await flushPromises()
    await wrapper.get('.chip').trigger('click')
    await wrapper.get('[data-testid="policy-back-serial"]').trigger('click')
    await flushPromises()

    expect(probe.setPolicy).toHaveBeenCalledWith(REPO, { mode: 'serial' })
    expect(wrapper.get('[data-testid="policy-notice"]').text()).toContain('superAgent.policy.applied')
  })
})

describe('checkpoint rollback', () => {
  it('lists post-checkpoint files and rolls back the selected file explicitly', async () => {
    probe.checkpointInfo = {
      repoRoot: REPO,
      checkpoint: { savedAt: '2026-01-01T00:00:00.000Z', head: 'abc123', entries: [] },
      changedFiles: ['src/a.ts'],
    }
    const wrapper = mountControl()
    await flushPromises()
    await wrapper.get('.chip').trigger('click')

    const rollbackButton = wrapper.get('[data-testid="checkpoint-rollback-src/a.ts"]')
    expect(wrapper.text()).toContain('src/a.ts')
    await rollbackButton.trigger('click')
    await flushPromises()

    expect(probe.rollbackCheckpointFiles).toHaveBeenCalledWith(REPO, ['src/a.ts'])
    expect(wrapper.get('[data-testid="policy-notice"]').text()).toContain('superAgent.policy.rollbackDone')
  })

  it('shows the empty hint when no rollback candidates exist', async () => {
    probe.checkpointInfo = {
      repoRoot: REPO,
      checkpoint: { savedAt: '2026-01-01T00:00:00.000Z', head: 'abc123', entries: [] },
      changedFiles: [],
    }
    const wrapper = mountControl()
    await flushPromises()
    await wrapper.get('.chip').trigger('click')

    expect(wrapper.text()).toContain('superAgent.policy.checkpointEmpty')
  })
})
