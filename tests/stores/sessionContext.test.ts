import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSessionContext } from '@/stores/sessionContext'

describe('sessionContext Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('should reset all state when reset() is called', () => {
    const sessionContext = useSessionContext()

    // 模拟会话有活动数据
    sessionContext.updateTasks([
      { id: '1', content: 'Task 1', status: 'in_progress' },
      { id: '2', content: 'Task 2', status: 'pending' },
    ])
    sessionContext.updateGitStats({
      additions: 10,
      deletions: 5,
      files: [{ path: 'test.ts', insertions: 10, deletions: 5 }],
    })

    // 验证数据已设置
    expect(sessionContext.tasks).toHaveLength(2)
    expect(sessionContext.gitAdditions).toBe(10)
    expect(sessionContext.changedFiles).toHaveLength(1)

    // 调用 reset
    sessionContext.reset()

    // 验证所有状态已清空
    expect(sessionContext.tasks).toHaveLength(0)
    expect(sessionContext.gitAdditions).toBe(0)
    expect(sessionContext.gitDeletions).toBe(0)
    expect(sessionContext.changedFiles).toHaveLength(0)
    expect(sessionContext.showEnvPanel).toBe(false)
    expect(sessionContext.showRightPanel).toBe(false)
  })

  it('should clear tasks and git stats when switching sessions to prevent stale data flash', () => {
    const sessionContext = useSessionContext()

    // 模拟旧会话有数据
    sessionContext.updateTasks([
      { id: '1', content: 'Old task', status: 'completed' },
    ])
    sessionContext.updateGitStats({
      additions: 20,
      deletions: 10,
      files: [{ path: 'old.ts', insertions: 20, deletions: 10 }],
    })

    expect(sessionContext.tasks).toHaveLength(1)
    expect(sessionContext.gitAdditions).toBe(20)

    // 模拟会话切换时调用 reset()
    sessionContext.reset()

    // 验证数据立即清空，防止 ComposerStatusBar 显示旧数据
    expect(sessionContext.tasks).toHaveLength(0)
    expect(sessionContext.gitAdditions).toBe(0)
    expect(sessionContext.gitDeletions).toBe(0)
    expect(sessionContext.changedFiles).toHaveLength(0)
  })

  it('should maintain panel state consistency after reset', () => {
    const sessionContext = useSessionContext()

    // 打开各种面板
    sessionContext.openEnvPanel()
    sessionContext.openRightPanel('tasks')
    sessionContext.toggleBranchDropdown()

    expect(sessionContext.showEnvPanel).toBe(true)
    expect(sessionContext.showRightPanel).toBe(true)
    expect(sessionContext.showBranchDropdown).toBe(true)

    // Reset
    sessionContext.reset()

    // 验证所有面板都关闭
    expect(sessionContext.showEnvPanel).toBe(false)
    expect(sessionContext.showRightPanel).toBe(false)
    expect(sessionContext.showBranchDropdown).toBe(false)
    expect(sessionContext.showCommitDialog).toBe(false)
    expect(sessionContext.showCreateBranchDialog).toBe(false)
  })
})
