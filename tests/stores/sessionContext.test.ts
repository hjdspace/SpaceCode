/**
 * SessionContext store tests — panel visibility, auto-expand modes,
 * right panel views, git stats, review state, and reset.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('@/services/electronAPI', () => ({ api: {} }))

import { useSessionContext } from '@/stores/sessionContext'

describe('sessionContext store — initial state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with all panels hidden', () => {
    const store = useSessionContext()
    expect(store.showEnvPanel).toBe(false)
    expect(store.showRightPanel).toBe(false)
    expect(store.showBranchDropdown).toBe(false)
    expect(store.showCommitDialog).toBe(false)
    expect(store.showCreateBranchDialog).toBe(false)
    expect(store.showGitGraphModal).toBe(false)
    expect(store.showPushDialog).toBe(false)
    expect(store.showGitOpsMenu).toBe(false)
    expect(store.showPanelMenu).toBe(false)
  })

  it('starts with auto expand mode and no user override', () => {
    const store = useSessionContext()
    expect(store.panelExpandMode).toBe('auto')
    expect(store.userOverride).toBe(false)
  })

  it('starts with empty tasks and git stats', () => {
    const store = useSessionContext()
    expect(store.tasks).toEqual([])
    expect(store.gitAdditions).toBe(0)
    expect(store.gitDeletions).toBe(0)
    expect(store.changedFiles).toEqual([])
    expect(store.hasActivity).toBe(false)
  })
})

describe('sessionContext store — env panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('toggleEnvPanel flips visibility and sets userOverride', () => {
    const store = useSessionContext()
    store.toggleEnvPanel()
    expect(store.showEnvPanel).toBe(true)
    expect(store.userOverride).toBe(true)
  })

  it('openEnvPanel sets visible and clears userOverride', () => {
    const store = useSessionContext()
    store.closeEnvPanel()
    store.openEnvPanel()
    expect(store.showEnvPanel).toBe(true)
    expect(store.userOverride).toBe(false)
  })

  it('closeEnvPanel hides and sets userOverride', () => {
    const store = useSessionContext()
    store.openEnvPanel()
    store.closeEnvPanel()
    expect(store.showEnvPanel).toBe(false)
    expect(store.userOverride).toBe(true)
  })
})

describe('sessionContext store — right panel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('openRightPanel opens with given view', () => {
    const store = useSessionContext()
    store.openRightPanel('review')
    expect(store.showRightPanel).toBe(true)
    expect(store.rightPanelView).toBe('review')
  })

  it('openRightPanel defaults to tasks view', () => {
    const store = useSessionContext()
    store.openRightPanel()
    expect(store.rightPanelView).toBe('tasks')
  })

  it('closeRightPanel hides the panel', () => {
    const store = useSessionContext()
    store.openRightPanel('tasks')
    store.closeRightPanel()
    expect(store.showRightPanel).toBe(false)
  })

  it('switchRightPanelView changes view without closing', () => {
    const store = useSessionContext()
    store.openRightPanel('tasks')
    store.switchRightPanelView('review')
    expect(store.rightPanelView).toBe('review')
    expect(store.showRightPanel).toBe(true)
  })

  it('openReviewWithFile sets review view with pending file', () => {
    const store = useSessionContext()
    store.openReviewWithFile('src/a.ts')
    expect(store.rightPanelView).toBe('review')
    expect(store.pendingReviewFile).toBe('src/a.ts')
    expect(store.showRightPanel).toBe(true)
    expect(store.expandedReviewFiles.size).toBe(0)
  })

  it('openReviewPanel clears review state', () => {
    const store = useSessionContext()
    store.openReviewWithFile('src/a.ts')
    store.openReviewPanel()
    expect(store.pendingReviewFile).toBeNull()
    expect(store.rightPanelView).toBe('review')
  })

  it('clearPendingReviewFile clears pending file', () => {
    const store = useSessionContext()
    store.openReviewWithFile('src/a.ts')
    store.clearPendingReviewFile()
    expect(store.pendingReviewFile).toBeNull()
  })

  it('right panel open auto-collapses env panel, close restores', async () => {
    const store = useSessionContext()
    store.openEnvPanel()
    expect(store.showEnvPanel).toBe(true)

    // Wait for Vue watchers to flush (openEnvPanel sets userOverride=false,
    // but hasActivity watcher may fire evaluateAutoExpand)
    await nextTick()

    store.openRightPanel()
    await nextTick()
    expect(store.showEnvPanel).toBe(false)

    store.closeRightPanel()
    await nextTick()
    expect(store.showEnvPanel).toBe(true)
  })

  it('right panel open does not collapse if env panel was already hidden', () => {
    const store = useSessionContext()
    // env panel starts hidden
    store.openRightPanel()
    expect(store.showEnvPanel).toBe(false)
    // Should not try to restore
    store.closeRightPanel()
    expect(store.showEnvPanel).toBe(false)
  })
})

describe('sessionContext store — panel expand modes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('setPanelExpandMode to always-expand shows env panel', () => {
    const store = useSessionContext()
    store.setPanelExpandMode('always-expand')
    expect(store.panelExpandMode).toBe('always-expand')
    expect(store.showEnvPanel).toBe(true)
    expect(store.userOverride).toBe(false)
    expect(store.showPanelMenu).toBe(false)
  })

  it('setPanelExpandMode to always-collapse hides env panel', () => {
    const store = useSessionContext()
    store.setPanelExpandMode('always-collapse')
    expect(store.panelExpandMode).toBe('always-collapse')
    expect(store.showEnvPanel).toBe(false)
  })

  it('setPanelExpandMode to auto follows hasActivity', () => {
    const store = useSessionContext()
    // No activity → hidden
    store.setPanelExpandMode('auto')
    expect(store.showEnvPanel).toBe(false)

    // Add activity
    store.updateGitStats({ additions: 5, deletions: 1, files: [{ path: 'a.ts', insertions: 5, deletions: 1 }] })
    // hasActivity watcher should fire and open the panel
    expect(store.showEnvPanel).toBe(true)
  })

  it('userOverride prevents auto mode from changing visibility', () => {
    const store = useSessionContext()
    store.setPanelExpandMode('always-expand')
    // Simulate user override by closing manually
    store.closeEnvPanel()
    expect(store.userOverride).toBe(true)

    // hasActivity changes, but userOverride should block evaluateAutoExpand
    store.updateGitStats({ additions: 5, deletions: 1, files: [{ path: 'a.ts', insertions: 5, deletions: 1 }] })
    // Should still be hidden because of userOverride
    expect(store.showEnvPanel).toBe(false)
  })

  it('evaluateAutoExpand respects always-expand mode', () => {
    const store = useSessionContext()
    store.setPanelExpandMode('always-expand')
    store.showEnvPanel = false
    store.evaluateAutoExpand()
    expect(store.showEnvPanel).toBe(true)
  })

  it('evaluateAutoExpand respects always-collapse mode', () => {
    const store = useSessionContext()
    store.setPanelExpandMode('always-collapse')
    store.showEnvPanel = true
    store.evaluateAutoExpand()
    expect(store.showEnvPanel).toBe(false)
  })

  it('evaluateAutoExpand respects auto mode with no activity', () => {
    const store = useSessionContext()
    store.setPanelExpandMode('auto')
    store.showEnvPanel = true
    store.evaluateAutoExpand()
    expect(store.showEnvPanel).toBe(false)
  })
})

describe('sessionContext store — branch dropdown & menus', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('toggleBranchDropdown flips state', () => {
    const store = useSessionContext()
    store.toggleBranchDropdown()
    expect(store.showBranchDropdown).toBe(true)
    store.toggleBranchDropdown()
    expect(store.showBranchDropdown).toBe(false)
  })

  it('closeBranchDropdown hides', () => {
    const store = useSessionContext()
    store.toggleBranchDropdown()
    store.closeBranchDropdown()
    expect(store.showBranchDropdown).toBe(false)
  })

  it('togglePanelMenu flips state', () => {
    const store = useSessionContext()
    store.togglePanelMenu()
    expect(store.showPanelMenu).toBe(true)
    store.togglePanelMenu()
    expect(store.showPanelMenu).toBe(false)
  })

  it('closePanelMenu hides', () => {
    const store = useSessionContext()
    store.togglePanelMenu()
    store.closePanelMenu()
    expect(store.showPanelMenu).toBe(false)
  })

  it('toggleGitOpsMenu flips state', () => {
    const store = useSessionContext()
    store.toggleGitOpsMenu()
    expect(store.showGitOpsMenu).toBe(true)
    store.toggleGitOpsMenu()
    expect(store.showGitOpsMenu).toBe(false)
  })

  it('closeGitOpsMenu hides', () => {
    const store = useSessionContext()
    store.toggleGitOpsMenu()
    store.closeGitOpsMenu()
    expect(store.showGitOpsMenu).toBe(false)
  })
})

describe('sessionContext store — dialog state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('open/close commit dialog', () => {
    const store = useSessionContext()
    store.openCommitDialog()
    expect(store.showCommitDialog).toBe(true)
    store.closeCommitDialog()
    expect(store.showCommitDialog).toBe(false)
  })

  it('open/close create branch dialog', () => {
    const store = useSessionContext()
    store.openCreateBranchDialog()
    expect(store.showCreateBranchDialog).toBe(true)
    store.closeCreateBranchDialog()
    expect(store.showCreateBranchDialog).toBe(false)
  })

  it('open/close git graph modal', () => {
    const store = useSessionContext()
    store.openGitGraphModal()
    expect(store.showGitGraphModal).toBe(true)
    store.closeGitGraphModal()
    expect(store.showGitGraphModal).toBe(false)
  })

  it('open/close push dialog', () => {
    const store = useSessionContext()
    store.openPushDialog()
    expect(store.showPushDialog).toBe(true)
    store.closePushDialog()
    expect(store.showPushDialog).toBe(false)
  })
})

describe('sessionContext store — tasks & git stats', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('updateTasks sets tasks and triggers evaluateAutoExpand', () => {
    const store = useSessionContext()
    store.setPanelExpandMode('auto')
    const tasks = [
      { id: '1', content: 'task1', status: 'pending' as const },
      { id: '2', content: 'task2', status: 'in_progress' as const },
    ]
    store.updateTasks(tasks)
    expect(store.tasks).toEqual(tasks)
    // hasActivity becomes true → auto-expand opens env panel
    expect(store.showEnvPanel).toBe(true)
  })

  it('updateGitStats sets stats and triggers evaluateAutoExpand', () => {
    const store = useSessionContext()
    store.setPanelExpandMode('auto')
    store.updateGitStats({
      additions: 10,
      deletions: 5,
      files: [{ path: 'a.ts', insertions: 10, deletions: 5 }],
    })
    expect(store.gitAdditions).toBe(10)
    expect(store.gitDeletions).toBe(5)
    expect(store.changedFiles).toHaveLength(1)
    expect(store.hasActivity).toBe(true)
    expect(store.showEnvPanel).toBe(true)
  })

  it('hasActivity is true when tasks exist', () => {
    const store = useSessionContext()
    store.updateTasks([{ content: 'task', status: 'pending' }])
    expect(store.hasActivity).toBe(true)
  })

  it('hasActivity is true when git stats exist', () => {
    const store = useSessionContext()
    store.updateGitStats({ additions: 1, deletions: 0, files: [] })
    expect(store.hasActivity).toBe(true)
  })

  it('hasActivity is false when everything empty', () => {
    const store = useSessionContext()
    expect(store.hasActivity).toBe(false)
  })

  it('taskProgress counts non-subtask completed/total', () => {
    const store = useSessionContext()
    store.updateTasks([
      { content: 't1', status: 'completed' },
      { content: 't2', status: 'pending' },
      { content: 'sub1', status: 'completed', isSubtask: true },
    ])
    const tp = store.taskProgress
    expect(tp.total).toBe(2) // t1 + t2 (sub1 excluded)
    expect(tp.completed).toBe(1) // only t1
  })
})

describe('sessionContext store — review file expansion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('toggleReviewFile adds and removes', () => {
    const store = useSessionContext()
    expect(store.isReviewFileExpanded('a.ts')).toBe(false)

    store.toggleReviewFile('a.ts')
    expect(store.isReviewFileExpanded('a.ts')).toBe(true)

    store.toggleReviewFile('a.ts')
    expect(store.isReviewFileExpanded('a.ts')).toBe(false)
  })

  it('multiple files can be expanded independently', () => {
    const store = useSessionContext()
    store.toggleReviewFile('a.ts')
    store.toggleReviewFile('b.ts')
    expect(store.isReviewFileExpanded('a.ts')).toBe(true)
    expect(store.isReviewFileExpanded('b.ts')).toBe(true)
    expect(store.isReviewFileExpanded('c.ts')).toBe(false)
  })
})

describe('sessionContext store — reset', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('reset clears all state to defaults', () => {
    const store = useSessionContext()
    // Set up some state
    store.openEnvPanel()
    store.openRightPanel('review')
    store.toggleBranchDropdown()
    store.openCommitDialog()
    store.openCreateBranchDialog()
    store.openGitGraphModal()
    store.openPushDialog()
    store.toggleGitOpsMenu()
    store.togglePanelMenu()
    store.setPanelExpandMode('always-expand')
    store.updateTasks([{ content: 'task', status: 'pending' }])
    store.updateGitStats({ additions: 5, deletions: 2, files: [{ path: 'a.ts', insertions: 5, deletions: 2 }] })
    store.toggleReviewFile('a.ts')

    // Reset
    store.reset()

    expect(store.showEnvPanel).toBe(false)
    expect(store.showRightPanel).toBe(false)
    expect(store.showBranchDropdown).toBe(false)
    expect(store.showCommitDialog).toBe(false)
    expect(store.showCreateBranchDialog).toBe(false)
    expect(store.showGitGraphModal).toBe(false)
    expect(store.showPushDialog).toBe(false)
    expect(store.showGitOpsMenu).toBe(false)
    expect(store.showPanelMenu).toBe(false)
    expect(store.panelExpandMode).toBe('auto')
    expect(store.userOverride).toBe(false)
    expect(store.rightPanelView).toBe('tasks')
    expect(store.tasks).toEqual([])
    expect(store.gitAdditions).toBe(0)
    expect(store.gitDeletions).toBe(0)
    expect(store.changedFiles).toEqual([])
    expect(store.expandedReviewFiles.size).toBe(0)
    expect(store.pendingReviewFile).toBeNull()
  })
})
