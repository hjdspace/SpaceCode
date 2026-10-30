/**
 * 合并弹窗：九项预检展示、致命项禁用确认、勾选确认、方式切换与错误提示。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type { FactoryMergeBlocker, FactoryMergePreflight, FactoryTask } from '@/shared/factory'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
  }),
}))

import FactoryMergeDialog from '../FactoryMergeDialog.vue'

const task: FactoryTask = {
  id: 'bl-1',
  runId: 'run-1',
  source: 'local',
  title: '合并任务',
  goal: '目标',
  lane: 'mergeable',
  stageIdx: 5,
  branch: 'agent/task-bl-1',
  worktree: '.spacecode/worktrees/bl-1',
  model: 'Opus 4.8',
  iteration: 1,
  maxIterations: 5,
  diff: { additions: 12, deletions: 3 },
  timestamps: { claimedAt: '2026-10-28T10:00:00Z' },
}

function preflight(overrides: Partial<FactoryMergePreflight> = {}): FactoryMergePreflight {
  return {
    taskId: 'bl-1',
    branch: 'agent/task-bl-1',
    targetBranch: 'main',
    commits: 2,
    diff: { additions: 12, deletions: 3 },
    tests: { status: 'pass', command: 'npm run test', at: '2026-10-28T10:02:00Z' },
    review: { verdict: 'approved', summary: 'ok', comments: [], at: '2026-10-28T10:03:00Z' },
    worktreeClean: true,
    workspaceClean: true,
    baseAdvanced: false,
    conflicts: false,
    conflictFiles: [],
    verify: {
      status: 'pass',
      command: 'npm run test',
      at: '2026-10-28T10:04:00Z',
      exitCode: 0,
    },
    blockers: [],
    checkedAt: '2026-10-28T10:04:00Z',
    ...overrides,
  }
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(FactoryMergeDialog, {
    props: {
      task,
      target: 'main',
      preflight: preflight(),
      checking: false,
      error: null,
      mode: 'merge',
      confirmed: false,
      merging: false,
      canConfirm: false,
      ...props,
    },
  })
}

describe('FactoryMergeDialog', () => {
  it('shows the preflight facts and no blockers for a clean task', () => {
    const wrapper = mountDialog()
    expect(wrapper.find('[data-merge-preview]').text()).toContain('factory.merge.commitCount|{"count":2}')
    expect(wrapper.find('[data-merge-base]').text()).toBe('factory.merge.baseCurrent')
    expect(wrapper.find('[data-merge-conflicts]').text()).toBe('factory.merge.conflictNone')
    expect(wrapper.find('[data-merge-worktree]').text()).toBe('factory.merge.clean')
    expect(wrapper.find('[data-merge-blockers]').exists()).toBe(false)
  })

  it('renders every blocker and keeps confirm disabled', () => {
    const blockers: FactoryMergeBlocker[] = ['base-advanced', 'conflict', 'verify-failed']
    const wrapper = mountDialog({
      preflight: preflight({
        baseAdvanced: true,
        conflicts: true,
        conflictFiles: ['README.md'],
        blockers,
      }),
      confirmed: true,
      canConfirm: false,
    })

    expect(wrapper.find('[data-merge-base]').text()).toBe('factory.merge.baseAdvanced')
    expect(wrapper.find('[data-merge-conflicts]').text()).toBe('factory.merge.conflictFound')
    expect(wrapper.find('[data-merge-conflict-files]').text()).toContain('README.md')
    expect(wrapper.findAll('[data-merge-blocker]').map((item) => item.attributes('data-merge-blocker'))).toEqual(
      blockers,
    )
    expect(wrapper.find('[data-merge-confirm]').attributes('disabled')).toBeDefined()
  })

  it('emits acknowledgment changes and blocks confirm until acknowledged', async () => {
    const wrapper = mountDialog()
    const checkbox = wrapper.find('[data-merge-confirm-checkbox]')
    await checkbox.setValue(true)
    expect(wrapper.emitted('update:confirmed')?.[0]).toEqual([true])
    expect(wrapper.find('[data-merge-confirm]').attributes('disabled')).toBeDefined()
  })

  it('emits confirm when the acknowledgment and preflight allow it', async () => {
    const wrapper = mountDialog({ confirmed: true, canConfirm: true })
    expect(wrapper.find('[data-merge-confirm]').attributes('disabled')).toBeUndefined()
    await wrapper.find('[data-merge-confirm]').trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('emits the selected merge mode and a refresh request', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-merge-mode="squash"]').setValue()
    expect(wrapper.emitted('update:mode')?.[0]).toEqual(['squash'])
    await wrapper.find('[data-merge-refresh]').trigger('click')
    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('surfaces a failed preflight and an action error', () => {
    const wrapper = mountDialog({
      preflight: null,
      error: { code: 'git-error', detail: 'fatal: not a git repository' },
    })
    expect(wrapper.find('[data-merge-preflight-error]').text()).toContain(
      'factory.errors.git-error fatal: not a git repository',
    )
    expect(wrapper.find('[data-merge-confirm]').attributes('disabled')).toBeDefined()
  })

  it('shows the verification output behind the verdict', () => {
    const wrapper = mountDialog({
      preflight: preflight({
        verify: {
          status: 'pass',
          command: 'npm run test:changed',
          at: '2026-10-28T10:04:00Z',
          exitCode: 0,
          detail: 'Tests  64 passed (64)\nDuration  38.24s',
        },
      }),
    })

    const detail = wrapper.find('[data-merge-verify-detail]')
    expect(detail.exists()).toBe(true)
    expect(detail.text()).toContain('64 passed')
    expect(detail.text()).toContain('38.24s')
    // 短输出不需要展开入口。
    expect(wrapper.find('[data-merge-verify-toggle]').exists()).toBe(false)
  })

  it('reads "not run yet" when the preflight has no verification result', () => {
    const wrapper = mountDialog({ preflight: preflight({ verify: undefined }) })
    expect(wrapper.find('[data-merge-verify]').text()).toBe('factory.inspector.pending')
    expect(wrapper.find('[data-merge-verify-detail]').exists()).toBe(false)
  })

  it('ignores a blank verification output instead of rendering an empty block', () => {
    const wrapper = mountDialog({
      preflight: preflight({
        verify: { status: 'pass', command: 'npm run test', at: '2026-10-28T10:04:00Z', detail: '  \n\n' },
      }),
    })
    expect(wrapper.find('[data-merge-verify-detail]').exists()).toBe(false)
    expect(wrapper.find('[data-merge-verify-toggle]').exists()).toBe(false)
  })

  it('collapses a long verification output to its tail and opens it on demand', async () => {
    const output = Array.from({ length: 9 }, (_, index) => `output line ${index + 1}`).join('\n')
    const wrapper = mountDialog({
      preflight: preflight({
        verify: { status: 'fail', command: 'npm run test:changed', at: '2026-10-28T10:04:00Z', detail: output },
      }),
    })

    // 计数与耗时摘要落在输出尾部，折叠态先看这一段。
    const detail = wrapper.find('[data-merge-verify-detail]')
    expect(detail.text()).toContain('output line 9')
    expect(detail.text()).not.toContain('output line 1')

    const toggle = wrapper.find('[data-merge-verify-toggle]')
    expect(toggle.text()).toBe('factory.merge.verifyExpand')
    await toggle.trigger('click')

    expect(wrapper.find('[data-merge-verify-detail]').text()).toContain('output line 1')
    expect(wrapper.find('[data-merge-verify-toggle]').text()).toBe('factory.merge.verifyCollapse')
  })
})
