import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSessionContext } from '@/stores/sessionContext'

describe('sessionContext Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('should reset panel and task state when reset() is called', () => {
    const sessionContext = useSessionContext()

    // 模拟会话有活动数据
    sessionContext.updateTasks([
      { id: '1', content: 'Task 1', status: 'in_progress' },
      { id: '2', content: 'Task 2', status: 'pending' },
    ])
    sessionContext.updateGitTotals({ additions: 10, deletions: 5 })

    // 验证数据已设置
    expect(sessionContext.tasks).toHaveLength(2)
    expect(sessionContext.gitAdditions).toBe(10)

    // 调用 reset
    sessionContext.reset()

    // 验证所有状态已清空
    expect(sessionContext.tasks).toHaveLength(0)
    expect(sessionContext.showEnvPanel).toBe(false)
    expect(sessionContext.showRightPanel).toBe(false)
  })

  it('clears tasks on session switch but keeps repo-wide git totals', () => {
    const sessionContext = useSessionContext()

    // 模拟旧会话有数据
    sessionContext.updateTasks([
      { id: '1', content: 'Old task', status: 'completed' },
    ])
    sessionContext.updateGitTotals({ additions: 20, deletions: 10 })

    expect(sessionContext.tasks).toHaveLength(1)
    expect(sessionContext.gitAdditions).toBe(20)

    // 模拟会话切换时调用 reset()
    sessionContext.reset()

    // 任务必须立即清空，否则 ComposerStatusBar 会把上一个会话的进度闪给新会话
    expect(sessionContext.tasks).toHaveLength(0)
    // git 总量是仓库口径（环境卡片/commit 对话框要用），归 scm.fileStats 的 watcher 管，
    // 会话切换清零它会让面板显示 +0 -0 直到下一次 git 事件
    expect(sessionContext.gitAdditions).toBe(20)
    expect(sessionContext.gitDeletions).toBe(10)
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
