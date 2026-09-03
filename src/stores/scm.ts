/**
 * SCM Store - Source Code Management State
 *
 * Manages git status, staging, committing, branching.
 * Architecture follows VSCode's SCM model: separate staged/unstaged/tracked groups.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import { useAppStore } from './app'
import { generateAiCommitMessage } from '@/services/aiCommitMessage'
import { useI18n } from 'vue-i18n'

export interface ScmFile {
  path: string
  originalPath?: string
  statusCode: string
  status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored' | 'conflict'
  staged: boolean
  isTracked: boolean
}

export interface ScmBranch {
  name: string
  current: boolean
  isRemote: boolean
  upstream?: string
  ahead?: number
  behind?: number
}

export interface ScmLogEntry {
  hash: string
  shortHash: string
  subject: string
  author: string
  date: string
  refs: string
  parents?: string[]
}

export interface ScmFileStat {
  additions: number | null
  deletions: number | null
}

export interface ScmCommitFileStat {
  path: string
  originalPath?: string
  statusCode: string
  additions: number | null
  deletions: number | null
  isBinary: boolean
}

export const useScmStore = defineStore('scm', () => {
  const appStore = useAppStore()
  const { locale } = useI18n()

  const isRepo = ref(false)
  const isLoading = ref(false)
  const branch = ref('')
  const upstream = ref<string | null>(null)
  const ahead = ref(0)
  const behind = ref(0)
  const staged = ref<ScmFile[]>([])
  const unstaged = ref<ScmFile[]>([])
  const untracked = ref<ScmFile[]>([])
  const conflicted = ref<ScmFile[]>([])
  const branches = ref<ScmBranch[]>([])
  const log = ref<ScmLogEntry[]>([])
  const commitMessage = ref('')
  const error = ref<string | null>(null)

  // Selected file for diff viewing
  const selectedFile = ref<ScmFile | null>(null)
  const selectedFileStaged = ref(false)

  // Changes list view mode (VSCode SCM: list / tree), persisted in localStorage
  const VIEW_MODE_STORAGE_KEY = 'scm.viewMode'
  const storedViewMode = typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_MODE_STORAGE_KEY) : null
  const viewMode = ref<'list' | 'tree'>(storedViewMode === 'tree' ? 'tree' : 'list')

  function setViewMode(mode: 'list' | 'tree') {
    viewMode.value = mode
    try { localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode) } catch {}
  }

  // Per-file +/- stats for the changes list (populated from getFullDiff)
  const fileStats = ref<Record<string, ScmFileStat>>({})
  const fileStatsLoading = ref(false)

  // Selected commit detail (git graph)
  const selectedCommit = ref<ScmLogEntry | null>(null)
  const commitFiles = ref<ScmCommitFileStat[]>([])
  const commitFilesLoading = ref(false)

  const totalChanges = computed(() =>
    staged.value.length + unstaged.value.length + untracked.value.length + conflicted.value.length
  )

  const stagedCount = computed(() => staged.value.length)
  const unstagedCount = computed(() => unstaged.value.length + untracked.value.length)

  async function refresh() {
    const cwd = appStore.projectRoot
    if (!cwd) {
      isRepo.value = false
      return
    }

    isLoading.value = true
    error.value = null

    try {
      const repoStatus = await api.git.getStatus(cwd)
      if (!repoStatus) {
        console.warn('[SCM] getStatus returned null for cwd:', cwd)
        isRepo.value = false
        return
      }

      isRepo.value = repoStatus.isRepo
      branch.value = repoStatus.branch || ''
      upstream.value = repoStatus.upstream ?? null
      ahead.value = repoStatus.ahead || 0
      behind.value = repoStatus.behind || 0
      staged.value = repoStatus.staged || []
      unstaged.value = repoStatus.unstaged || []
      untracked.value = repoStatus.untracked || []
      conflicted.value = repoStatus.conflicted || []

      console.log(`[SCM] refresh result: isRepo=${repoStatus.isRepo}, branch=${repoStatus.branch}, staged=${staged.value.length}, unstaged=${unstaged.value.length}, untracked=${untracked.value.length}, conflicted=${conflicted.value.length}`)

      // Start file watcher when we detect a git repo
      if (repoStatus.isRepo) {
        startWatching()
        scheduleFileStatsRefresh()
      }
    } catch (e: any) {
      console.error('[SCM] refresh failed:', e)
      error.value = e.message
      isRepo.value = false
    } finally {
      isLoading.value = false
    }
  }

  async function stagePaths(paths: string[]) {
    const cwd = appStore.projectRoot
    if (!cwd) return
    await api.git.stage(cwd, paths)
    await refresh()
  }

  async function unstagePaths(paths: string[]) {
    const cwd = appStore.projectRoot
    if (!cwd) return
    await api.git.unstage(cwd, paths)
    await refresh()
  }

  async function stageAllFiles() {
    const cwd = appStore.projectRoot
    if (!cwd) return
    await api.git.stageAll(cwd)
    await refresh()
  }

  async function unstageAllFiles() {
    const cwd = appStore.projectRoot
    if (!cwd) return
    await api.git.unstageAll(cwd)
    await refresh()
  }

  async function commitChanges(message?: string, amend?: boolean) {
    const cwd = appStore.projectRoot
    if (!cwd) return
    const msg = message || commitMessage.value
    if (!msg.trim()) return

    const result = await api.git.commit(cwd, msg, amend)
    if (result.success) {
      commitMessage.value = ''
      await refresh()
    } else {
      error.value = result.error || 'Commit failed'
    }
    return result
  }

  async function discardFileChanges(paths: string[]) {
    const cwd = appStore.projectRoot
    if (!cwd) return
    await api.git.discardChanges(cwd, paths)
    await refresh()
  }

  async function refreshBranches() {
    const cwd = appStore.projectRoot
    if (!cwd) {
      console.warn('[SCM] refreshBranches skipped: no projectRoot')
      return
    }
    try {
      const result = await api.git.getBranches(cwd)
      branches.value = result
      console.log(`[SCM] refreshBranches: loaded ${result.length} branches`)
    } catch (e) {
      console.error('[SCM] refreshBranches failed:', e)
      branches.value = []
    }
  }

  async function checkoutBranch(ref: string) {
    const cwd = appStore.projectRoot
    if (!cwd) return
    const result = await api.git.checkout(cwd, ref)
    if (result.success) {
      await refresh()
      await refreshBranches()
    } else {
      error.value = result.error ?? null
    }
    return result
  }

  async function createBranch(name: string, checkoutTo?: boolean) {
    const cwd = appStore.projectRoot
    if (!cwd) return
    const result = await api.git.createBranch(cwd, name, checkoutTo)
    if (result.success) {
      await refresh()
      await refreshBranches()
    } else {
      error.value = result.error ?? null
    }
    return result
  }

  async function deleteBranch(name: string, force?: boolean) {
    const cwd = appStore.projectRoot
    if (!cwd) return
    const result = await api.git.deleteBranch(cwd, name, force)
    if (result.success) {
      await refreshBranches()
    } else {
      error.value = result.error ?? null
    }
    return result
  }

  async function refreshLog(count?: number) {
    const cwd = appStore.projectRoot
    if (!cwd) return
    log.value = await api.git.getLog(cwd, count)
  }

  async function pull() {
    const cwd = appStore.projectRoot
    if (!cwd) return
    const result = await api.git.pull(cwd)
    if (result.success) {
      await refresh()
    } else {
      error.value = result.error ?? null
    }
    return result
  }

  async function push() {
    const cwd = appStore.projectRoot
    if (!cwd) return
    const result = await api.git.push(cwd)
    if (result.success) {
      await refresh()
    } else {
      error.value = result.error ?? null
    }
    return result
  }

  async function stash() {
    const cwd = appStore.projectRoot
    if (!cwd) return
    const result = await api.git.stash(cwd)
    if (result.success) {
      await refresh()
    }
    return result
  }

  async function stashPop() {
    const cwd = appStore.projectRoot
    if (!cwd) return
    const result = await api.git.stashPop(cwd)
    if (result.success) {
      await refresh()
    }
    return result
  }

  async function fetchAll() {
    const cwd = appStore.projectRoot
    if (!cwd) return
    await api.git.fetchAll(cwd)
    await refresh()
    await refreshBranches()
    await refreshLog(50)
  }

  function selectFile(file: ScmFile | null, isStaged: boolean = false) {
    selectedFile.value = file
    selectedFileStaged.value = isStaged
  }

  // --- Per-file +/- stats (VSCode-style badges) ---

  let fileStatsTimer: ReturnType<typeof setTimeout> | null = null

  /** Debounced refresh: heavy numstat call, only run when there are changes. */
  function scheduleFileStatsRefresh(): void {
    if (fileStatsTimer) clearTimeout(fileStatsTimer)
    fileStatsTimer = setTimeout(() => {
      fileStatsTimer = null
      refreshFileStats()
    }, 300)
  }

  async function refreshFileStats(): Promise<void> {
    const cwd = appStore.projectRoot
    if (!cwd || !isRepo.value || totalChanges.value === 0) {
      fileStats.value = {}
      return
    }
    fileStatsLoading.value = true
    try {
      const result = await api.git.getFullDiff(cwd)
      const stats: Record<string, ScmFileStat> = {}
      if (result?.files) {
        for (const f of result.files) {
          stats[f.path] = {
            additions: f.isBinary ? null : f.linesAdded,
            deletions: f.isBinary ? null : f.linesRemoved,
          }
        }
      }
      fileStats.value = stats
    } catch (e) {
      console.warn('[SCM] refreshFileStats failed:', e)
    } finally {
      fileStatsLoading.value = false
    }
  }

  // --- Commit detail (git graph) ---

  async function selectCommit(entry: ScmLogEntry | null): Promise<void> {
    selectedCommit.value = entry
    commitFiles.value = []
    if (!entry) return
    const cwd = appStore.projectRoot
    if (!cwd) return
    commitFilesLoading.value = true
    try {
      commitFiles.value = (await api.git.getCommitFiles(cwd, entry.hash)) || []
    } catch (e) {
      console.warn('[SCM] getCommitFiles failed:', e)
    } finally {
      commitFilesLoading.value = false
    }
  }

  async function resetTo(hash: string, mode: 'soft' | 'mixed' | 'hard') {
    const cwd = appStore.projectRoot
    if (!cwd) return { success: false, error: 'No project root' }
    const result = await api.git.reset(cwd, hash, mode)
    if (result.success) {
      await refresh()
      await refreshLog(50)
    } else {
      error.value = result.error ?? null
    }
    return result
  }

  // --- Hunk-level staging ---

  async function stageHunks(path: string, patch: string) {
    const cwd = appStore.projectRoot
    if (!cwd) return { success: false, error: 'No project root' }
    const result = await api.git.stageHunks(cwd, path, patch)
    if (result.success) {
      await refresh()
      scheduleFileStatsRefresh()
    }
    return result
  }

  async function unstageHunks(path: string, patch: string) {
    const cwd = appStore.projectRoot
    if (!cwd) return { success: false, error: 'No project root' }
    const result = await api.git.unstageHunks(cwd, path, patch)
    if (result.success) {
      await refresh()
      scheduleFileStatsRefresh()
    }
    return result
  }

  // AI commit message generation state
  const isGeneratingCommitMessage = ref(false)

  // Git file watcher — listen for .git directory changes from main process
  let removeStatusChangeListener: (() => void) | null = null
  // Listener for SCM refresh events dispatched by chat stream after file tool calls
  let removeScmRefreshListener: (() => void) | null = null
  // Debounce rapid refresh requests (e.g. multiple file edits in one turn)
  let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null

  function startWatching(): void {
    if (removeStatusChangeListener) return // Already listening
    // Ensure main process file watcher is started so we receive git:statusChanged events
    const cwd = appStore.projectRoot
    if (cwd) {
      api.git.watchProject(cwd).catch(() => {})
    }
    removeStatusChangeListener = api.git.onStatusChanged(() => {
      refresh()
    })

    // Listen for explicit SCM refresh requests from the chat stream (e.g. after
    // Write/Edit tool calls). The fs watcher may not detect changes in
    // subdirectories, so this provides a reliable fallback.
    const handleScmRefresh = () => {
      if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer)
      refreshDebounceTimer = setTimeout(() => {
        refresh()
        refreshDebounceTimer = null
      }, 300)
    }
    window.addEventListener('scm:refresh', handleScmRefresh)
    removeScmRefreshListener = () => {
      window.removeEventListener('scm:refresh', handleScmRefresh)
    }
  }

  function stopWatching(): void {
    if (removeStatusChangeListener) {
      removeStatusChangeListener()
      removeStatusChangeListener = null
    }
    if (removeScmRefreshListener) {
      removeScmRefreshListener()
      removeScmRefreshListener = null
    }
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer)
      refreshDebounceTimer = null
    }
    if (fileStatsTimer) {
      clearTimeout(fileStatsTimer)
      fileStatsTimer = null
    }
    api.git.stopWatch().catch(() => {})
  }

  async function generateCommitMessage(): Promise<string> {
    const cwd = appStore.projectRoot
    if (!cwd) throw new Error('No project root')
    if (stagedCount.value === 0) throw new Error('No staged changes to analyze. Please stage your changes first.')

    isGeneratingCommitMessage.value = true
    try {
      return await generateAiCommitMessage(cwd, staged.value, locale.value)
    } finally {
      isGeneratingCommitMessage.value = false
    }
  }

  return {
    isRepo,
    isLoading,
    branch,
    upstream,
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    conflicted,
    branches,
    log,
    commitMessage,
    error,
    selectedFile,
    selectedFileStaged,
    viewMode,
    setViewMode,
    fileStats,
    fileStatsLoading,
    refreshFileStats,
    selectedCommit,
    commitFiles,
    commitFilesLoading,
    selectCommit,
    resetTo,
    stageHunks,
    unstageHunks,
    totalChanges,
    stagedCount,
    unstagedCount,
    refresh,
    stagePaths,
    unstagePaths,
    stageAllFiles,
    unstageAllFiles,
    commitChanges,
    discardFileChanges,
    refreshBranches,
    checkoutBranch,
    createBranch,
    deleteBranch,
    refreshLog,
    pull,
    push,
    stash,
    stashPop,
    fetchAll,
    selectFile,
    isGeneratingCommitMessage,
    generateCommitMessage,
    startWatching,
    stopWatching,
  }
})
