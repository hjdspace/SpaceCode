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
import { sendMessage as sendLLMMessage, initLLMService } from '@/services/llm'

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
}

export const useScmStore = defineStore('scm', () => {
  const appStore = useAppStore()

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
        isRepo.value = false
        return
      }

      isRepo.value = repoStatus.isRepo
      branch.value = repoStatus.branch || ''
      upstream.value = repoStatus.upstream
      ahead.value = repoStatus.ahead || 0
      behind.value = repoStatus.behind || 0
      staged.value = repoStatus.staged || []
      unstaged.value = repoStatus.unstaged || []
      untracked.value = repoStatus.untracked || []
      conflicted.value = repoStatus.conflicted || []
    } catch (e: any) {
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
    if (!cwd) return
    branches.value = await api.git.getBranches(cwd)
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

  // AI commit message generation state
  const isGeneratingCommitMessage = ref(false)

  async function generateCommitMessage(): Promise<string> {
    const cwd = appStore.projectRoot
    if (!cwd) throw new Error('No project root')
    if (stagedCount.value === 0 && unstagedCount.value === 0) throw new Error('No changes to analyze')

    // Ensure LLM service is initialized
    if (!import('@/services/llm').then(m => m.isLLMConfigured?.() ?? false)) {
      // Try to init from settings
      const settingsModule = await import('@/stores/settings')
      const settingsStore = settingsModule.useSettingsStore()
      const cfg = settingsStore.config
      if (cfg.apiKey) {
        await initLLMService({ provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model })
      } else {
        throw new Error('LLM not configured. Please set API key in Settings.')
      }
    }

    isGeneratingCommitMessage.value = true

    try {
      // Gather git context (parallel)
      const [diffResult, logResult, statusResult] = await Promise.all([
        api.git.getDiff(cwd, '', false),
        api.git.getLog(cwd, 10),
        api.git.getStatus(cwd),
      ])

      const diff = typeof diffResult === 'string' ? diffResult : JSON.stringify(diffResult || {})
      const logEntries: ScmLogEntry[] = logResult || []
      const recentCommits = logEntries.map(e => e.subject).join('\n')

      // Get file list for context
      const changedFiles = [
        ...staged.value.map(f => `  ${f.status.toUpperCase()} ${f.path}`),
        ...unstaged.value.map(f => `  ${f.status.toUpperCase()} ${f.path}`),
        ...untracked.value.map(f => `  U ${f.path}`),
      ].join('\n')

      const prompt = `You are a git commit message expert. Analyze the following git changes and generate a concise, high-quality commit message.

## Recent commit messages (for style reference):
${recentCommits || '(none - this may be a new repo)'}

## Changed files:
${changedFiles}

## Git diff:
${diff.substring(0, 8000)}${diff.length > 8000 ? '\n... (truncated)' : ''}

## Rules:
- Write the message in English (standard for most repos)
- Use conventional commits format if the repo uses it (type: summary)
- Keep the subject line under 72 characters
- Focus on WHY changes were made, not just WHAT was done
- Be concise but informative
- Output ONLY the commit message, no explanation or extra text`

      const result = await sendLLMMessage([
        { role: 'user', content: prompt }
      ])

      return result.trim().split('\n')[0] // Return only first line as primary message
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
  }
})
