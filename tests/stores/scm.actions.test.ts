/**
 * SCM store action tests — refresh, commit, stage/unstage, branch, discard,
 * selectFile, and computed properties.
 *
 * Complements the existing scm.test.ts which covers viewMode, fileStats,
 * commit detail, resetTo, and hunk staging.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const apiMocks = vi.hoisted(() => ({
  git: {
    getStatus: vi.fn(),
    getFullDiff: vi.fn(),
    getCommitFiles: vi.fn(),
    getLog: vi.fn(),
    getBranches: vi.fn(),
    reset: vi.fn(),
    stageHunks: vi.fn(),
    unstageHunks: vi.fn(),
    stage: vi.fn(),
    unstage: vi.fn(),
    stageAll: vi.fn(),
    unstageAll: vi.fn(),
    commit: vi.fn(),
    checkout: vi.fn(),
    createBranch: vi.fn(),
    deleteBranch: vi.fn(),
    discardChanges: vi.fn(),
    pull: vi.fn(),
    push: vi.fn(),
    stash: vi.fn(),
    stashPop: vi.fn(),
    fetchAll: vi.fn(),
    showFile: vi.fn(),
    getRawDiff: vi.fn(),
    getStagedDiff: vi.fn(),
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

// Mock generateAiCommitMessage so generateCommitMessage can be tested
vi.mock('@/services/aiCommitMessage', () => ({
  generateAiCommitMessage: vi.fn().mockResolvedValue('ai: feat: new thing'),
}))

import { useScmStore } from '@/stores/scm'

describe('scm store — refresh', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    apiMocks.git.getStatus.mockResolvedValue(null)
    setActivePinia(createPinia())
  })

  it('refresh sets isRepo=false when getStatus returns null', async () => {
    const store = useScmStore()
    await store.refresh()
    expect(store.isRepo).toBe(false)
    expect(store.isLoading).toBe(false)
  })

  it('refresh populates status fields from getStatus', async () => {
    apiMocks.git.getStatus.mockResolvedValue({
      isRepo: true,
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      staged: [{ path: 'a.ts', statusCode: 'M', status: 'modified', staged: true, isTracked: true }],
      unstaged: [{ path: 'b.ts', statusCode: 'M', status: 'modified', staged: false, isTracked: true }],
      untracked: [{ path: 'c.ts', statusCode: '?', status: 'untracked', staged: false, isTracked: false }],
      conflicted: [],
    })
    const store = useScmStore()
    await store.refresh()

    expect(store.isRepo).toBe(true)
    expect(store.branch).toBe('main')
    expect(store.upstream).toBe('origin/main')
    expect(store.ahead).toBe(2)
    expect(store.behind).toBe(1)
    expect(store.staged).toHaveLength(1)
    expect(store.unstaged).toHaveLength(1)
    expect(store.untracked).toHaveLength(1)
    expect(store.error).toBeNull()
  })

  it('refresh handles errors gracefully', async () => {
    apiMocks.git.getStatus.mockRejectedValue(new Error('network error'))
    const store = useScmStore()
    await store.refresh()

    expect(store.isRepo).toBe(false)
    expect(store.error).toBe('network error')
    expect(store.isLoading).toBe(false)
  })

  it('refresh with no projectRoot sets isRepo=false', async () => {
    vi.doMock('@/stores/app', () => ({
      useAppStore: () => ({ projectRoot: '' }),
    }))
    const store = useScmStore()
    await store.refresh()
    expect(store.isRepo).toBe(false)
  })
})

describe('scm store — stage/unstage actions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    apiMocks.git.getStatus.mockResolvedValue({
      isRepo: true,
      branch: 'main',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
    })
    apiMocks.git.getFullDiff.mockResolvedValue(null)
    setActivePinia(createPinia())
  })

  it('stagePaths calls api.git.stage then refreshes', async () => {
    apiMocks.git.stage.mockResolvedValue(true)
    const store = useScmStore()
    await store.stagePaths(['a.ts', 'b.ts'])

    expect(apiMocks.git.stage).toHaveBeenCalledWith('/repo', ['a.ts', 'b.ts'])
    expect(apiMocks.git.getStatus).toHaveBeenCalled()
  })

  it('unstagePaths calls api.git.unstage then refreshes', async () => {
    apiMocks.git.unstage.mockResolvedValue(true)
    const store = useScmStore()
    await store.unstagePaths(['a.ts'])

    expect(apiMocks.git.unstage).toHaveBeenCalledWith('/repo', ['a.ts'])
  })

  it('stageAllFiles calls api.git.stageAll', async () => {
    apiMocks.git.stageAll.mockResolvedValue(true)
    const store = useScmStore()
    await store.stageAllFiles()
    expect(apiMocks.git.stageAll).toHaveBeenCalledWith('/repo')
  })

  it('unstageAllFiles calls api.git.unstageAll', async () => {
    apiMocks.git.unstageAll.mockResolvedValue(true)
    const store = useScmStore()
    await store.unstageAllFiles()
    expect(apiMocks.git.unstageAll).toHaveBeenCalledWith('/repo')
  })
})

describe('scm store — commitChanges', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    apiMocks.git.getStatus.mockResolvedValue({
      isRepo: true,
      branch: 'main',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
    })
    setActivePinia(createPinia())
  })

  it('commit succeeds: clears commitMessage, refreshes', async () => {
    apiMocks.git.commit.mockResolvedValue({ success: true, hash: 'abc1234' })
    const store = useScmStore()
    store.commitMessage = 'feat: new thing'
    const result = await store.commitChanges()

    expect(apiMocks.git.commit).toHaveBeenCalledWith('/repo', 'feat: new thing', undefined)
    expect(result.success).toBe(true)
    expect(store.commitMessage).toBe('')
    expect(store.error).toBeNull()
  })

  it('commit fails: sets error, keeps commitMessage', async () => {
    apiMocks.git.commit.mockResolvedValue({ success: false, error: 'nothing staged' })
    const store = useScmStore()
    store.commitMessage = 'feat: thing'
    const result = await store.commitChanges('feat: thing')

    expect(result.success).toBe(false)
    expect(store.error).toBe('nothing staged')
    expect(store.commitMessage).toBe('feat: thing')
  })

  it('commit with empty message returns early', async () => {
    const store = useScmStore()
    store.commitMessage = '   '
    const result = await store.commitChanges()

    expect(result).toBeUndefined()
    expect(apiMocks.git.commit).not.toHaveBeenCalled()
  })

  it('commit with --amend flag passes amend to api', async () => {
    apiMocks.git.commit.mockResolvedValue({ success: true, hash: 'abc1234' })
    const store = useScmStore()
    await store.commitChanges('msg', true)
    expect(apiMocks.git.commit).toHaveBeenCalledWith('/repo', 'msg', true)
  })
})

describe('scm store — branch actions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    apiMocks.git.getStatus.mockResolvedValue({
      isRepo: true,
      branch: 'main',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
    })
    apiMocks.git.getBranches.mockResolvedValue([])
    apiMocks.git.getLog.mockResolvedValue([])
    apiMocks.git.getFullDiff.mockResolvedValue(null)
    setActivePinia(createPinia())
  })

  it('refreshBranches populates branches array', async () => {
    const mockBranches = [
      { name: 'main', current: true, isRemote: false },
      { name: 'dev', current: false, isRemote: false },
    ]
    apiMocks.git.getBranches.mockResolvedValue(mockBranches)
    const store = useScmStore()
    await store.refreshBranches()

    expect(store.branches).toEqual(mockBranches)
  })

  it('refreshBranches handles error and clears branches', async () => {
    apiMocks.git.getBranches.mockRejectedValue(new Error('failed'))
    const store = useScmStore()
    await store.refreshBranches()
    expect(store.branches).toEqual([])
  })

  it('checkoutBranch succeeds and refreshes', async () => {
    apiMocks.git.checkout.mockResolvedValue({ success: true })
    const store = useScmStore()
    const result = await store.checkoutBranch('dev')

    expect(apiMocks.git.checkout).toHaveBeenCalledWith('/repo', 'dev')
    expect(result.success).toBe(true)
    expect(apiMocks.git.getStatus).toHaveBeenCalled()
    expect(apiMocks.git.getBranches).toHaveBeenCalled()
  })

  it('checkoutBranch fails: sets error', async () => {
    apiMocks.git.checkout.mockResolvedValue({ success: false, error: 'branch not found' })
    const store = useScmStore()
    const result = await store.checkoutBranch('missing')
    expect(result.success).toBe(false)
    expect(store.error).toBe('branch not found')
  })

  it('createBranch succeeds and refreshes', async () => {
    apiMocks.git.createBranch.mockResolvedValue({ success: true })
    const store = useScmStore()
    const result = await store.createBranch('feature', true)
    expect(apiMocks.git.createBranch).toHaveBeenCalledWith('/repo', 'feature', true)
    expect(result.success).toBe(true)
  })

  it('createBranch fails: sets error', async () => {
    apiMocks.git.createBranch.mockResolvedValue({ success: false, error: 'exists' })
    const store = useScmStore()
    await store.createBranch('main')
    expect(store.error).toBe('exists')
  })

  it('deleteBranch succeeds and refreshes branches', async () => {
    apiMocks.git.deleteBranch.mockResolvedValue({ success: true })
    const store = useScmStore()
    const result = await store.deleteBranch('old-branch', true)
    expect(apiMocks.git.deleteBranch).toHaveBeenCalledWith('/repo', 'old-branch', true)
    expect(result.success).toBe(true)
  })
})

describe('scm store — discard, pull, push, stash', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    apiMocks.git.getStatus.mockResolvedValue({
      isRepo: true,
      branch: 'main',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
    })
    apiMocks.git.getFullDiff.mockResolvedValue(null)
    setActivePinia(createPinia())
  })

  it('discardFileChanges calls api.git.discardChanges and refreshes', async () => {
    apiMocks.git.discardChanges.mockResolvedValue(true)
    const store = useScmStore()
    await store.discardFileChanges(['a.ts'])
    expect(apiMocks.git.discardChanges).toHaveBeenCalledWith('/repo', ['a.ts'])
  })

  it('pull succeeds and refreshes', async () => {
    apiMocks.git.pull.mockResolvedValue({ success: true })
    const store = useScmStore()
    const result = await store.pull()
    expect(result.success).toBe(true)
    expect(apiMocks.git.getStatus).toHaveBeenCalled()
  })

  it('pull fails: sets error', async () => {
    apiMocks.git.pull.mockResolvedValue({ success: false, error: 'merge conflict' })
    const store = useScmStore()
    const result = await store.pull()
    expect(result.success).toBe(false)
    expect(store.error).toBe('merge conflict')
  })

  it('push succeeds and refreshes', async () => {
    apiMocks.git.push.mockResolvedValue({ success: true })
    const store = useScmStore()
    const result = await store.push()
    expect(result.success).toBe(true)
  })

  it('stash succeeds and refreshes', async () => {
    apiMocks.git.stash.mockResolvedValue({ success: true })
    const store = useScmStore()
    const result = await store.stash()
    expect(result.success).toBe(true)
  })

  it('stashPop succeeds and refreshes', async () => {
    apiMocks.git.stashPop.mockResolvedValue({ success: true })
    const store = useScmStore()
    const result = await store.stashPop()
    expect(result.success).toBe(true)
  })

  it('fetchAll refreshes status, branches, and log', async () => {
    apiMocks.git.fetchAll.mockResolvedValue({ success: true })
    apiMocks.git.getBranches.mockResolvedValue([])
    apiMocks.git.getLog.mockResolvedValue([])
    const store = useScmStore()
    await store.fetchAll()
    expect(apiMocks.git.fetchAll).toHaveBeenCalledWith('/repo')
    expect(apiMocks.git.getStatus).toHaveBeenCalled()
    expect(apiMocks.git.getBranches).toHaveBeenCalled()
    expect(apiMocks.git.getLog).toHaveBeenCalled()
  })
})

describe('scm store — selectFile', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('selectFile sets selectedFile and selectedFileStaged', () => {
    const store = useScmStore()
    const file = { path: 'a.ts', statusCode: 'M', status: 'modified', staged: true, isTracked: true }
    store.selectFile(file, true)
    expect(store.selectedFile).toEqual(file)
    expect(store.selectedFileStaged).toBe(true)
  })

  it('selectFile(null) clears selection', () => {
    const store = useScmStore()
    store.selectFile(null)
    expect(store.selectedFile).toBeNull()
    expect(store.selectedFileStaged).toBe(false)
  })
})

describe('scm store — computed properties', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('totalChanges sums all change groups', () => {
    const store = useScmStore()
    store.staged = [{ path: 'a', statusCode: 'M', status: 'modified', staged: true, isTracked: true }]
    store.unstaged = [{ path: 'b', statusCode: 'M', status: 'modified', staged: false, isTracked: true }]
    store.untracked = [{ path: 'c', statusCode: '?', status: 'untracked', staged: false, isTracked: false }]
    store.conflicted = [{ path: 'd', statusCode: 'U', status: 'conflict', staged: false, isTracked: true }]
    expect(store.totalChanges).toBe(4)
  })

  it('stagedCount returns staged length', () => {
    const store = useScmStore()
    store.staged = [
      { path: 'a', statusCode: 'M', status: 'modified', staged: true, isTracked: true },
      { path: 'b', statusCode: 'A', status: 'added', staged: true, isTracked: true },
    ]
    expect(store.stagedCount).toBe(2)
  })

  it('unstagedCount returns unstaged + untracked length', () => {
    const store = useScmStore()
    store.unstaged = [{ path: 'a', statusCode: 'M', status: 'modified', staged: false, isTracked: true }]
    store.untracked = [{ path: 'b', statusCode: '?', status: 'untracked', staged: false, isTracked: false }]
    expect(store.unstagedCount).toBe(2)
  })
})

describe('scm store — refreshLog', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    setActivePinia(createPinia())
  })

  it('refreshLog populates log from api', async () => {
    const mockLog = [
      { hash: 'abc123', shortHash: 'abc1234', subject: 'feat: a', author: 'A', date: '', refs: '' },
    ]
    apiMocks.git.getLog.mockResolvedValue(mockLog)
    const store = useScmStore()
    await store.refreshLog(10)
    expect(apiMocks.git.getLog).toHaveBeenCalledWith('/repo', 10)
    expect(store.log).toEqual(mockLog)
  })
})

describe('scm store — generateCommitMessage', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    apiMocks.git.getStatus.mockResolvedValue({
      isRepo: true,
      branch: 'main',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: [],
      conflicted: [],
    })
    setActivePinia(createPinia())
  })

  it('generates AI commit message', async () => {
    const { generateAiCommitMessage } = await import('@/services/aiCommitMessage')
    ;(generateAiCommitMessage as any).mockResolvedValue('ai: feat: generated')

    const store = useScmStore()
    store.isRepo = true
    store.staged = [{ path: 'a.ts', statusCode: 'M', status: 'modified', staged: true, isTracked: true }]
    const msg = await store.generateCommitMessage()
    expect(msg).toBe('ai: feat: generated')
    expect(store.isGeneratingCommitMessage).toBe(false)
  })

  it('throws when no staged changes', async () => {
    const store = useScmStore()
    store.isRepo = true
    store.staged = []
    await expect(store.generateCommitMessage()).rejects.toThrow('No staged changes')
    expect(store.isGeneratingCommitMessage).toBe(false)
  })
})
