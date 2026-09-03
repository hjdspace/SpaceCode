import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    projectRoot: 'C:/project',
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
})
