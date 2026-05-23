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
import { sendMessage as sendLLMMessage, initLLMService, isLLMConfigured } from '@/services/llm'
import { useSettingsStore } from './settings'

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
    if (stagedCount.value === 0) throw new Error('No staged changes to analyze. Please stage your changes first.')

    // Ensure LLM service is initialized
    if (!isLLMConfigured()) {
      // Try to init from settings
      const settingsStore = useSettingsStore()
      const cfg = settingsStore.config
      if (cfg.apiKey) {
        await initLLMService({ provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model })
      } else {
        throw new Error('LLM not configured. Please set API key in Settings.')
      }
    }

    isGeneratingCommitMessage.value = true

    try {
      const [diff, logResult] = await Promise.all([
        api.git.getStagedDiff(cwd),
        api.git.getLog(cwd, 10),
      ])

      const logEntries: ScmLogEntry[] = logResult || []
      const recentCommits = logEntries.map(e => e.subject).join('\n')

      const changedFiles = staged.value
        .map(f => `  ${f.status.toUpperCase()} ${f.path}`)
        .join('\n')

      const systemPrompt = `你是一位专业的 Git 提交信息撰写专家。你需要根据代码变更生成高质量、规范的中文提交信息。

## 输出格式要求
- 使用 Conventional Commits 规范：type(scope): subject
- type 包括：feat / fix / refactor / docs / style / test / chore / perf / ci / build
- scope 为可选，表示影响范围（模块、组件、功能区域等）
- subject 使用中文，简明扼要描述"做了什么"，不超过 72 个字符
- 必须在 subject 空一行后添加 body，用编号列表逐条说明关键变更：
  1. 每条说明一个具体的改动点
  2. 描述改动的目的和影响
  3. 条目数量根据实际变更复杂度决定，至少1条
- 仅输出提交信息本身，不要输出任何解释、分析或额外文字

## 示例
feat(登录): 新增微信扫码登录功能

1. 实现微信扫码OAuth2.0认证流程
2. 添加登录页面二维码组件及自动刷新逻辑
3. 集成后端回调接口完成用户自动绑定

fix(支付): 修复订单金额计算精度丢失的问题

1. 将浮点数运算替换为BigDecimal精确计算
2. 修复折扣叠加时金额溢出的边界情况

refactor(路由): 将路由配置从硬编码改为动态加载

1. 抽取路由表为独立配置文件，支持按模块拆分
2. 实现路由守卫的插件化注册机制
3. 提升路由模块的可维护性，支持插件动态注册路由

chore(deps): 升级 vite 至 5.4 版本

1. 更新vite及相关插件版本至5.4以修复HMR缓存泄漏
2. 适配vite配置breaking change`

      const userPrompt = `## 最近的提交记录（用于参考风格）：
${recentCommits || '（暂无提交记录）'}

## 变更文件列表：
${changedFiles}

## Git Diff：
${diff.substring(0, 16000)}${diff.length > 16000 ? '\n... (已截断)' : ''}

请根据以上变更生成提交信息。`

      const result = await sendLLMMessage(
        [{ role: 'user', content: userPrompt }],
        { system: systemPrompt }
      )

      return result.trim()
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
