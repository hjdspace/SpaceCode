import { beforeEach, describe, expect, it, vi } from 'vitest'
import { watch } from 'vue'
import { useDiffViewerTarget } from '@/composables/useDiffViewerTarget'

const mocks = vi.hoisted(() => ({
  api: {
    git: {
      getRawDiff: vi.fn(),
      showFile: vi.fn(),
    },
    readFile: vi.fn(),
  },
  appStore: {
    activeInfoTab: null as null,
    projectRoot: 'C:/project' as string | null,
  },
  scmStore: {
    selectedFile: {
      path: 'src/example.ts',
      status: 'modified' as const,
    },
    selectedFileStaged: false,
    untracked: [] as Array<{ path: string }>,
  },
}))

vi.mock('@/services/electronAPI', () => ({ api: mocks.api }))
vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.appStore }))
vi.mock('@/stores/scm', () => ({ useScmStore: () => mocks.scmStore }))

const RAW_DIFF = [
  'diff --git a/src/example.ts b/src/example.ts',
  'index 1111111..2222222 100644',
  '--- a/src/example.ts',
  '+++ b/src/example.ts',
  '@@ -1,2 +1,2 @@',
  '-old',
  '+new',
  ' keep',
].join('\n') + '\n'

describe('useDiffViewerTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appStore.activeInfoTab = null
    mocks.appStore.projectRoot = 'C:/project'
    mocks.scmStore.selectedFile = { path: 'src/example.ts', status: 'modified' }
    mocks.scmStore.selectedFileStaged = false
    mocks.scmStore.untracked = []
    mocks.api.git.getRawDiff.mockResolvedValue(RAW_DIFF)
    mocks.api.git.showFile.mockResolvedValue('old\nkeep\n')
    mocks.api.readFile.mockResolvedValue('new\nkeep\n')
  })

  it('uses the index as the old side for an unstaged diff', async () => {
    const target = useDiffViewerTarget()

    await target.load()

    expect(mocks.api.git.showFile).toHaveBeenCalledWith('C:/project', 'src/example.ts', true)
    expect(target.oldContent.value).toBe('old\nkeep\n')
    expect(target.newContent.value).toBe('new\nkeep\n')
  })

  it('commits patch and side contents in a single reactive flush', async () => {
    // Regression test for the SCM diff freeze: assigning rawPatch/oldContent/
    // newContent across separate awaits made @git-diff-view re-run its full
    // synchronous pipeline (parse + full-file highlight + tree rebuild) once
    // per intermediate state. All three refs must land in one flush.
    const target = useDiffViewerTarget()
    let flushWaves = 0
    const stop = watch(
      [target.rawPatch, target.oldContent, target.newContent],
      () => { flushWaves++ }
    )

    await target.load()
    stop()

    expect(flushWaves).toBe(1)
    expect(target.rawPatch.value).toBe(RAW_DIFF)
    expect(target.oldContent.value).toBe('old\nkeep\n')
    expect(target.newContent.value).toBe('new\nkeep\n')
  })

  it('de-duplicates concurrent loads for the same target', async () => {
    // DiffViewer's tab watcher and SCM selection watcher can both fire for a
    // single click — the second load must be skipped, not re-run git.
    const target = useDiffViewerTarget()

    const first = target.load()
    const second = target.load()
    await Promise.all([first, second])

    expect(mocks.api.git.getRawDiff).toHaveBeenCalledTimes(1)
    expect(target.rawPatch.value).toBe(RAW_DIFF)
  })

  it('discards a stale load when the target is cleared mid-flight', async () => {
    const target = useDiffViewerTarget()
    let resolveRawDiff!: (v: string) => void
    mocks.api.git.getRawDiff.mockImplementation(
      () => new Promise<string>(resolve => { resolveRawDiff = resolve })
    )

    const pending = target.load()
    expect(target.isLoading.value).toBe(true)

    // Selection cleared while the git call is still in flight
    mocks.appStore.projectRoot = null
    await target.load()
    expect(target.rawPatch.value).toBe('')
    expect(target.isLoading.value).toBe(false)

    resolveRawDiff(RAW_DIFF)
    await pending

    // The late result must not clobber the cleared state
    expect(target.rawPatch.value).toBe('')
    expect(target.oldContent.value).toBeNull()
    expect(target.newContent.value).toBeNull()
    expect(target.isLoading.value).toBe(false)
  })

  it('reloads the same target again after a previous load finished', async () => {
    // The in-flight dedup must not block sequential reloads (e.g. after
    // staging a hunk, applyHunk calls load() again for the same file).
    const target = useDiffViewerTarget()

    await target.load()
    await target.load()

    expect(mocks.api.git.getRawDiff).toHaveBeenCalledTimes(2)
  })
})
