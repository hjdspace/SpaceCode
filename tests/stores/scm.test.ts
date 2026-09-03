/**
 * SCM store 增量测试 — viewMode 持久化、fileStats、提交详情、reset、hunk 级暂存。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  git: {
    getStatus: vi.fn(),
    getFullDiff: vi.fn(),
    getCommitFiles: vi.fn(),
    getLog: vi.fn(),
    reset: vi.fn(),
    stageHunks: vi.fn(),
    unstageHunks: vi.fn(),
    watchProject: vi.fn().mockResolvedValue(true),
    stopWatch: vi.fn().mockResolvedValue(true),
    onStatusChanged: vi.fn(() => () => {}),
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: apiMocks }))

vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue-i18n')>()
  return { ...actual, useI18n: () => ({ locale: { value: 'zh-CN' } }) }
})

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ projectRoot: '/repo' }),
}))

import { useScmStore } from '@/stores/scm'

describe('scm store — viewMode 持久化', () => {
  beforeEach(() => {
    localStorage.clear()
    apiMocks.git.getStatus.mockResolvedValue(null)
    setActivePinia(createPinia())
  })

  it('默认为 list 视图', () => {
    const store = useScmStore()
    expect(store.viewMode).toBe('list')
  })

  it('setViewMode 切换并写入 localStorage', () => {
    const store = useScmStore()
    store.setViewMode('tree')
    expect(store.viewMode).toBe('tree')
    expect(localStorage.getItem('scm.viewMode')).toBe('tree')
  })

  it('初始化时从 localStorage 恢复 tree 视图', () => {
    localStorage.setItem('scm.viewMode', 'tree')
    setActivePinia(createPinia())
    const store = useScmStore()
    expect(store.viewMode).toBe('tree')
  })
})

describe('scm store — fileStats', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    apiMocks.git.getStatus.mockResolvedValue({ isRepo: true, branch: 'main', staged: [], unstaged: [], untracked: [], conflicted: [] })
    setActivePinia(createPinia())
  })

  it('refreshFileStats 从 getFullDiff 填充 +/- 统计，二进制为 null', async () => {
    apiMocks.git.getFullDiff.mockResolvedValue({
      files: [
        { path: 'a.ts', isBinary: false, linesAdded: 3, linesRemoved: 1 },
        { path: 'img.png', isBinary: true, linesAdded: 0, linesRemoved: 0 },
      ],
    })
    const store = useScmStore()
    store.isRepo = true
    store.staged = [{ path: 'a.ts', statusCode: 'M', status: 'modified', staged: true, isTracked: true }]
    await store.refreshFileStats()

    expect(apiMocks.git.getFullDiff).toHaveBeenCalledWith('/repo')
    expect(store.fileStats['a.ts']).toEqual({ additions: 3, deletions: 1 })
    expect(store.fileStats['img.png']).toEqual({ additions: null, deletions: null })
  })

  it('无变更时清空 fileStats 且不调用 getFullDiff', async () => {
    const store = useScmStore()
    await store.refreshFileStats()
    expect(store.fileStats).toEqual({})
    expect(apiMocks.git.getFullDiff).not.toHaveBeenCalled()
  })
})

describe('scm store — 提交详情', () => {
  beforeEach(() => {
    localStorage.clear()
    apiMocks.git.getStatus.mockResolvedValue({ isRepo: true, branch: 'main', staged: [], unstaged: [], untracked: [], conflicted: [] })
    setActivePinia(createPinia())
  })

  it('selectCommit(null) 清空选中与文件列表', async () => {
    const store = useScmStore()
    await store.selectCommit(null)
    expect(store.selectedCommit).toBeNull()
    expect(store.commitFiles).toEqual([])
    expect(apiMocks.git.getCommitFiles).not.toHaveBeenCalled()
  })

  it('selectCommit 加载提交文件列表', async () => {
    const commitFiles = [{ path: 'a.ts', statusCode: 'M', additions: 2, deletions: 0, isBinary: false }]
    apiMocks.git.getCommitFiles.mockResolvedValue(commitFiles)
    const store = useScmStore()
    const entry = { hash: 'abc123', shortHash: 'abc123', subject: 'feat', author: 'a', date: '', refs: '', parents: [] }
    await store.selectCommit(entry)

    expect(apiMocks.git.getCommitFiles).toHaveBeenCalledWith('/repo', 'abc123')
    expect(store.selectedCommit).toEqual(entry)
    expect(store.commitFiles).toEqual(commitFiles)
    expect(store.commitFilesLoading).toBe(false)
  })
})

describe('scm store — resetTo / hunk 级暂存', () => {
  beforeEach(() => {
    localStorage.clear()
    apiMocks.git.getStatus.mockResolvedValue({ isRepo: true, branch: 'main', staged: [], unstaged: [], untracked: [], conflicted: [] })
    apiMocks.git.getLog.mockResolvedValue([])
    setActivePinia(createPinia())
  })

  it('resetTo 成功后刷新状态与日志', async () => {
    apiMocks.git.reset.mockResolvedValue({ success: true })
    const store = useScmStore()
    const result = await store.resetTo('abc123', 'mixed')

    expect(apiMocks.git.reset).toHaveBeenCalledWith('/repo', 'abc123', 'mixed')
    expect(result).toEqual({ success: true })
    expect(store.error).toBeNull()
    expect(apiMocks.git.getLog).toHaveBeenCalled()
  })

  it('resetTo 失败时写入 error', async () => {
    apiMocks.git.reset.mockResolvedValue({ success: false, error: 'conflict' })
    const store = useScmStore()
    await store.resetTo('abc123', 'hard')
    expect(store.error).toBe('conflict')
  })

  it('stageHunks 成功后刷新状态', async () => {
    apiMocks.git.stageHunks.mockResolvedValue({ success: true })
    const store = useScmStore()
    const result = await store.stageHunks('a.ts', 'patch')

    expect(apiMocks.git.stageHunks).toHaveBeenCalledWith('/repo', 'a.ts', 'patch')
    expect(result).toEqual({ success: true })
  })

  it('unstageHunks 失败不刷新也不写 error（由调用方处理）', async () => {
    apiMocks.git.unstageHunks.mockResolvedValue({ success: false, error: 'apply failed' })
    const store = useScmStore()
    const result = await store.unstageHunks('a.ts', 'patch')
    expect(result).toEqual({ success: false, error: 'apply failed' })
  })
})
