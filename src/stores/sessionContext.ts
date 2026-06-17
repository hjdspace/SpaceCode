/**
 * Session Context Store — 管理面板系统状态
 *
 * 三层 UI:
 * 1. EnvPanel: 右上角嵌入式卡片（环境概览），展开时对话区域缩小
 * 2. RightPanel: 右侧内嵌面板（tasks / review），由 EnvPanel 内的操作触发
 * 3. BranchDropdown: 左侧覆盖层，由点击 "main" 触发
 */

import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'

/** 右侧面板子视图 */
export type RightPanelView = 'tasks' | 'review'
export type PanelExpandMode = 'auto' | 'always-expand' | 'always-collapse'

export interface SessionContextFile {
  path: string
  insertions: number
  deletions: number
}

export const useSessionContext = defineStore('sessionContext', () => {
  // === Env Panel (right-top embedded card) ===
  const showEnvPanel = ref(false)

  // === Right side panel (tasks / review) ===
  const showRightPanel = ref(false)
  const rightPanelView = ref<RightPanelView>('tasks')

  // === Branch dropdown overlay ===
  const showBranchDropdown = ref(false)

  // === Commit dialog ===
  const showCommitDialog = ref(false)
  const showPanelMenu = ref(false)
  const panelExpandMode = ref<PanelExpandMode>('auto')
  const userOverride = ref(false) // true = user manually toggled, overrides auto mode

  // === Task data ===
  const tasks = ref<Array<{
    id?: string
    content: string
    status: 'pending' | 'in_progress' | 'completed'
    owner?: string
    blockedBy?: string[]
    isSubtask?: boolean
  }>>([])

  const taskProgress = computed(() => {
    const total = tasks.value.filter(t => !t.isSubtask).length
    const completed = tasks.value.filter(t => !t.isSubtask && t.status === 'completed').length
    return { completed, total }
  })

  // === Git stats ===
  const gitAdditions = ref(0)
  const gitDeletions = ref(0)
  const changedFiles = ref<SessionContextFile[]>([])

  // === Review state ===
  const expandedReviewFiles = ref<Set<string>>(new Set())

  // === Computed ===
  /** 是否有任何面板展开（用于胶囊判断） */
  const hasActivity = computed(() => tasks.value.length > 0 || gitAdditions.value > 0)

  // === Actions: Env Panel ===
  function toggleEnvPanel() {
    showEnvPanel.value = !showEnvPanel.value
    userOverride.value = true
  }

  function openEnvPanel() {
    showEnvPanel.value = true
    userOverride.value = false // clear override, let mode take over
  }

  /** User manually collapses → becomes capsule */
  function closeEnvPanel() {
    showEnvPanel.value = false
    userOverride.value = true // user explicitly collapsed
  }

  // === Actions: Right Panel ===
  function openRightPanel(view: RightPanelView = 'tasks') {
    rightPanelView.value = view
    showRightPanel.value = true
  }

  function closeRightPanel() {
    showRightPanel.value = false
  }

  function switchRightPanelView(view: RightPanelView) {
    rightPanelView.value = view
  }

  // === Actions: Branch Dropdown ===
  function togglePanelMenu() {
    showPanelMenu.value = !showPanelMenu.value
  }

  function closePanelMenu() {
    showPanelMenu.value = false
  }

  function setPanelExpandMode(mode: PanelExpandMode) {
    panelExpandMode.value = mode
    showPanelMenu.value = false
    userOverride.value = false // mode change → re-evaluate from scratch
    evaluateAutoExpand()
  }

  /** Evaluate whether panel should be expanded in 'auto' mode */
  function evaluateAutoExpand() {
    if (userOverride.value) return
    if (panelExpandMode.value === 'always-expand') {
      showEnvPanel.value = true
    } else if (panelExpandMode.value === 'always-collapse') {
      showEnvPanel.value = false
    } else {
      // auto: follow activity
      showEnvPanel.value = hasActivity.value
    }
  }

  function toggleBranchDropdown() {
    showBranchDropdown.value = !showBranchDropdown.value
  }

  function closeBranchDropdown() {
    showBranchDropdown.value = false
  }

  // === Actions: Commit Dialog ===
  function openCommitDialog() {
    showCommitDialog.value = true
  }

  function closeCommitDialog() {
    showCommitDialog.value = false
  }

  // === Actions: Tasks ===
  function updateTasks(newTasks: typeof tasks.value) {
    tasks.value = newTasks
    evaluateAutoExpand()
  }

  // === Actions: Git stats ===
  function updateGitStats(stats: {
    additions: number
    deletions: number
    files: SessionContextFile[]
  }) {
    gitAdditions.value = stats.additions
    gitDeletions.value = stats.deletions
    changedFiles.value = stats.files
    evaluateAutoExpand()
  }

  // === Actions: Review ===
  function toggleReviewFile(path: string) {
    const s = new Set(expandedReviewFiles.value)
    if (s.has(path)) {
      s.delete(path)
    } else {
      s.add(path)
    }
    expandedReviewFiles.value = s
  }

  function isReviewFileExpanded(path: string): boolean {
    return expandedReviewFiles.value.has(path)
  }

  // === Actions: Reset ===
  function reset() {
    showEnvPanel.value = false
    showRightPanel.value = false
    showBranchDropdown.value = false
    showCommitDialog.value = false
    showPanelMenu.value = false
    panelExpandMode.value = 'auto'
    userOverride.value = false
    rightPanelView.value = 'tasks'
    tasks.value = []
    gitAdditions.value = 0
    gitDeletions.value = 0
    changedFiles.value = []
    expandedReviewFiles.value = new Set()
  }

  // === Auto mode watcher: when activity changes, clear user override and re-evaluate ===
  watch(hasActivity, () => {
    if (panelExpandMode.value === 'auto') {
      userOverride.value = false
      evaluateAutoExpand()
    }
  })

  return {
    // State
    showEnvPanel,
    showRightPanel,
    rightPanelView,
    showBranchDropdown,
    showCommitDialog,
    showPanelMenu,
    panelExpandMode,
    userOverride,
    tasks,
    taskProgress,
    gitAdditions,
    gitDeletions,
    changedFiles,
    expandedReviewFiles,
    hasActivity,

    // Env panel
    toggleEnvPanel,
    openEnvPanel,
    closeEnvPanel,
    evaluateAutoExpand,

    // Right panel
    openRightPanel,
    closeRightPanel,
    switchRightPanelView,

    // Branch dropdown
    togglePanelMenu,
    closePanelMenu,
    setPanelExpandMode,
    toggleBranchDropdown,
    closeBranchDropdown,

    // Commit
    openCommitDialog,
    closeCommitDialog,

    // Tasks
    updateTasks,

    // Git
    updateGitStats,

    // Review
    toggleReviewFile,
    isReviewFileExpanded,

    // Reset
    reset,
  }
})
