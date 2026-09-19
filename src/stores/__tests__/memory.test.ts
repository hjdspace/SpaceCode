import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryFile, MemoryFileDetail, MemoryProject } from '@/types/memory'

const memoryApiMock = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  saveFile: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: { memory: memoryApiMock },
}))

import { useMemoryStore } from '../memory'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const project = (id: string, isCurrent = false): MemoryProject => ({
  id,
  label: `/workspace/${id}`,
  memoryDir: `/tmp/.claude/projects/${id}/memory`,
  exists: true,
  fileCount: 1,
  isCurrent,
})

const file = (path: string): MemoryFile => {
  const parts = path.split('/')
  return {
    path,
    name: parts[parts.length - 1] ?? path,
    bytes: 12,
    updatedAt: '2026-07-24T00:00:00.000Z',
    title: path,
    isIndex: path === 'MEMORY.md',
  }
}

function detail(path: string, content: string): MemoryFileDetail {
  return { path, content, updatedAt: '2026-07-24T00:00:00.000Z', bytes: 12 }
}

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  const store = useMemoryStore()
  store.$patch({
    projects: [],
    files: [],
    selectedProjectId: null,
    selectedFile: null,
    draftContent: '',
    isLoadingProjects: false,
    isLoadingFiles: false,
    isLoadingFile: false,
    isSaving: false,
    error: null,
    lastSavedAt: null,
    pendingOpenPath: null,
  })
})

describe('memory store request ownership', () => {
  it('keeps the newest cwd project response when requests finish out of order', async () => {
    const first = deferred<{ projects: MemoryProject[] }>()
    const second = deferred<{ projects: MemoryProject[] }>()
    memoryApiMock.listProjects.mockImplementation((cwd?: string) =>
      cwd === '/workspace/first' ? first.promise : second.promise,
    )

    const store = useMemoryStore()
    const firstRequest = store.fetchProjects('/workspace/first')
    const secondRequest = store.fetchProjects('/workspace/second')

    second.resolve({ projects: [project('second', true)] })
    await secondRequest
    first.resolve({ projects: [project('first', true)] })
    await firstRequest

    expect(store.projects).toEqual([project('second', true)])
    expect(store.selectedProjectId).toBe('second')
    expect(store.isLoadingProjects).toBe(false)
    expect(store.error).toBeNull()
  })

  it('does not let an old project file response replace the current project files', async () => {
    const first = deferred<{ files: MemoryFile[] }>()
    const second = deferred<{ files: MemoryFile[] }>()
    memoryApiMock.listFiles.mockImplementation((projectId: string) =>
      projectId === 'first' ? first.promise : second.promise,
    )

    const store = useMemoryStore()
    store.$patch({ projects: [project('first'), project('second')], selectedProjectId: 'first' })

    const firstRequest = store.fetchFiles('first')
    store.selectProject('second')
    const secondRequest = store.fetchFiles('second')

    second.resolve({ files: [file('second.md')] })
    await secondRequest
    first.resolve({ files: [file('first.md')] })
    await firstRequest

    expect(store.selectedProjectId).toBe('second')
    expect(store.files).toEqual([file('second.md')])
    expect(store.isLoadingFiles).toBe(false)
    expect(store.error).toBeNull()
  })

  it('keeps the newest file open response when reads finish out of order', async () => {
    const first = deferred<{ file: MemoryFileDetail }>()
    const second = deferred<{ file: MemoryFileDetail }>()
    memoryApiMock.readFile.mockImplementation((_projectId: string, path: string) =>
      path === 'first.md' ? first.promise : second.promise,
    )

    const store = useMemoryStore()
    store.$patch({
      projects: [project('demo')],
      selectedProjectId: 'demo',
      files: [file('first.md'), file('second.md')],
    })

    const firstRequest = store.openFile('demo', 'first.md')
    const secondRequest = store.openFile('demo', 'second.md')

    second.resolve({ file: detail('second.md', '# Second') })
    await secondRequest
    first.resolve({ file: detail('first.md', '# First') })
    await firstRequest

    expect(store.selectedFile).toMatchObject({ path: 'second.md', content: '# Second' })
    expect(store.draftContent).toBe('# Second')
    expect(store.isLoadingFile).toBe(false)
    expect(store.error).toBeNull()
  })

  it('keeps the selected file when a project refresh still lists it', async () => {
    memoryApiMock.listFiles.mockResolvedValue({ files: [file('MEMORY.md')] })
    const store = useMemoryStore()
    store.$patch({
      selectedProjectId: 'demo',
      selectedFile: detail('MEMORY.md', '# Draft'),
      draftContent: '# Draft',
    })

    await store.fetchFiles('demo')

    expect(store.selectedFile).toMatchObject({ path: 'MEMORY.md', content: '# Draft' })
    expect(store.draftContent).toBe('# Draft')
  })

  it('drops the selected file when a project refresh no longer lists it', async () => {
    memoryApiMock.listFiles.mockResolvedValue({ files: [file('other.md')] })
    const store = useMemoryStore()
    store.$patch({
      selectedProjectId: 'demo',
      selectedFile: detail('MEMORY.md', '# Draft'),
      draftContent: '# Draft',
    })

    await store.fetchFiles('demo')

    expect(store.selectedFile).toBeNull()
    expect(store.draftContent).toBe('')
  })
})

describe('memory store save', () => {
  it('serializes saves, sends the loaded revision, and does not cross project context', async () => {
    const save = deferred<{ ok: true; file: { path: string; updatedAt: string; bytes: number } }>()
    memoryApiMock.saveFile.mockReturnValue(save.promise)
    memoryApiMock.listFiles.mockResolvedValue({ files: [file('MEMORY.md')] })

    const store = useMemoryStore()
    store.$patch({
      projects: [project('first'), project('second')],
      selectedProjectId: 'first',
      selectedFile: detail('MEMORY.md', '# Original'),
      draftContent: '# Edited',
    })

    const firstSave = store.saveFile()
    const duplicateSave = store.saveFile()

    expect(memoryApiMock.saveFile).toHaveBeenCalledTimes(1)
    expect(memoryApiMock.saveFile).toHaveBeenCalledWith({
      projectId: 'first',
      path: 'MEMORY.md',
      content: '# Edited',
      expectedUpdatedAt: '2026-07-24T00:00:00.000Z',
      expectedBytes: 12,
    })
    await expect(duplicateSave).resolves.toBe(false)

    store.selectProject('second')
    save.resolve({
      ok: true,
      file: { path: 'MEMORY.md', updatedAt: '2026-07-24T00:01:00.000Z', bytes: 8 },
    })

    await expect(firstSave).resolves.toBe(false)
    expect(store.selectedProjectId).toBe('second')
    expect(store.selectedFile).toBeNull()
    expect(store.draftContent).toBe('')
    expect(store.isSaving).toBe(false)
    expect(store.lastSavedAt).toBeNull()
  })

  it('records the new revision and refreshes the file list after a successful save', async () => {
    memoryApiMock.saveFile.mockResolvedValue({
      ok: true,
      file: { path: 'MEMORY.md', updatedAt: '2026-07-24T00:01:00.000Z', bytes: 20 },
    })
    memoryApiMock.listFiles.mockResolvedValue({ files: [file('MEMORY.md')] })

    const store = useMemoryStore()
    store.$patch({
      selectedProjectId: 'demo',
      selectedFile: detail('MEMORY.md', '# Original'),
      draftContent: '# Edited',
    })

    await expect(store.saveFile()).resolves.toBe(true)
    expect(store.selectedFile).toMatchObject({
      content: '# Edited',
      bytes: 20,
      updatedAt: '2026-07-24T00:01:00.000Z',
    })
    expect(store.lastSavedAt).toBe('2026-07-24T00:01:00.000Z')
    expect(store.error).toBeNull()
    expect(memoryApiMock.listFiles).toHaveBeenCalledWith('demo')
  })

  it('surfaces the failure message and keeps the draft when the revision conflicts', async () => {
    memoryApiMock.saveFile.mockRejectedValue(new Error('记忆文件已被外部修改，请重新打开后再保存：MEMORY.md'))

    const store = useMemoryStore()
    store.$patch({
      selectedProjectId: 'demo',
      selectedFile: detail('MEMORY.md', '# Original'),
      draftContent: '# Edited',
    })

    await expect(store.saveFile()).resolves.toBe(false)
    expect(store.error).toContain('已被外部修改')
    expect(store.isSaving).toBe(false)
    expect(store.draftContent).toBe('# Edited')
    expect(store.selectedFile).toMatchObject({ content: '# Original' })
  })
})

describe('memory store project selection', () => {
  it('prefers the current project and skips projects without a memory dir', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        project('missing', true),
        project('other'),
        project('current', true),
      ].map((entry) => (entry.id === 'missing' ? { ...entry, exists: false, fileCount: 0 } : entry)),
    })
    memoryApiMock.listFiles.mockResolvedValue({ files: [] })

    const store = useMemoryStore()
    await store.fetchProjects('/workspace/current')

    expect(store.selectedProjectId).toBe('current')
    expect(store.projects).toHaveLength(3)
  })

  it('keeps the previous selection when it is still selectable', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [project('alpha'), project('beta', true)],
    })
    memoryApiMock.listFiles.mockResolvedValue({ files: [] })

    const store = useMemoryStore()
    store.$patch({ selectedProjectId: 'alpha' })
    await store.fetchProjects()

    expect(store.selectedProjectId).toBe('alpha')
  })

  it('clears selection when nothing is selectable', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [{ ...project('missing', true), exists: false, fileCount: 0 }],
    })

    const store = useMemoryStore()
    await store.fetchProjects()

    expect(store.selectedProjectId).toBeNull()
    expect(store.error).toBeNull()
  })
})
