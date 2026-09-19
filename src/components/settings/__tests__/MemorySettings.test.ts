import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryFile, MemoryProject } from '@/types/memory'
import { useMemoryStore } from '@/stores/memory'

const memoryApiMock = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listFiles: vi.fn(),
  readFile: vi.fn(),
  saveFile: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: { memory: memoryApiMock },
}))

// 页面只读取这两个 store 的项目根，避免把整棵 store 依赖图拖进单测
vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ projectRoot: 'D:/repo' }),
}))

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({ projectRoot: '' }),
}))

// i18n 按仓库既有约定替换成 key 断言，避免测试与文案耦合。
// 带参数的 key 追加上参数值，便于断言 aria-label。
// createI18n 仍需可用：@/i18n 在被间接 import 时会实例化一次。
vi.mock('vue-i18n', () => ({
  createI18n: () => ({
    global: {
      locale: { value: 'en-US' },
      t: (key: string) => key,
    },
  }),
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${Object.values(params).join(',')}` : key,
  }),
}))

const PROJECT: MemoryProject = {
  id: '-workspace-demo',
  label: '/workspace/demo',
  memoryDir: '/tmp/claude/projects/-workspace-demo/memory',
  exists: true,
  fileCount: 1,
  isCurrent: true,
}

const INDEX_FILE: MemoryFile = {
  path: 'MEMORY.md',
  name: 'MEMORY.md',
  title: 'MEMORY.md',
  bytes: 18,
  updatedAt: '2026-05-01T00:00:00.000Z',
  type: 'project',
  description: 'Project conventions.',
  isIndex: true,
}

const MANUAL_FILE: MemoryFile = {
  path: 'notes/manual.md',
  name: 'manual.md',
  title: 'Manual',
  bytes: 42,
  updatedAt: '2026-05-01T00:02:00.000Z',
  type: 'feedback',
  description: 'Operator workflow.',
  isIndex: false,
}

const MarkdownRendererStub = defineComponent({
  name: 'MarkdownRenderer',
  props: {
    content: { type: String, default: '' },
    filePath: { type: String, default: '' },
  },
  computed: {
    href(): string {
      const match = /\[[^\]]+\]\(([^)]+)\)/.exec(this.content)
      return match ? match[1] : ''
    },
  },
  template:
    '<div data-test="markdown-preview"><span>{{ content }}</span>' +
    '<a v-if="href" :href="href">linked</a></div>',
})

async function settle() {
  await flushPromises()
  await nextTick()
  await flushPromises()
}

let activePinia: ReturnType<typeof createPinia>

async function mountPage(): Promise<VueWrapper<unknown>> {
  activePinia = createPinia()
  setActivePinia(activePinia)
  const { default: MemorySettings } = await import('../MemorySettings.vue')
  const wrapper = mount(MemorySettings, {
    global: {
      plugins: [activePinia],
      stubs: { MarkdownRenderer: MarkdownRendererStub },
    },
  })
  await settle()
  return wrapper
}

function previewText(wrapper: VueWrapper<unknown>): string {
  return wrapper.find('[data-test="markdown-preview"]').text()
}

function editor(wrapper: VueWrapper<unknown>) {
  return wrapper.find('textarea')
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  setActivePinia(createPinia())

  memoryApiMock.listProjects.mockResolvedValue({ projects: [PROJECT] })
  memoryApiMock.listFiles.mockResolvedValue({ files: [INDEX_FILE] })
  memoryApiMock.readFile.mockResolvedValue({
    file: { path: 'MEMORY.md', content: '# Project Memory\n', updatedAt: '2026-05-01T00:00:00.000Z', bytes: 18 },
  })
  memoryApiMock.saveFile.mockResolvedValue({
    ok: true,
    file: { path: 'MEMORY.md', updatedAt: '2026-05-01T00:01:00.000Z', bytes: 28 },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MemorySettings', () => {
  it('opens memory files in preview mode, edits on demand, and returns to preview after save', async () => {
    const wrapper = await mountPage()

    expect(memoryApiMock.listProjects).toHaveBeenCalledWith('D:/repo')
    expect(wrapper.text()).toContain('workspace/demo')
    expect(wrapper.text()).toContain('MEMORY.md')
    // 列表项只展示标题，不展示元数据
    expect(wrapper.text()).not.toContain('Project conventions.')
    expect(editor(wrapper).exists()).toBe(false)
    expect(previewText(wrapper)).toContain('Project Memory')

    await wrapper.find('.ms-icon-btn').trigger('click')
    await nextTick()

    const textarea = editor(wrapper)
    expect(textarea.exists()).toBe(true)
    expect((textarea.element as HTMLTextAreaElement).value).toBe('# Project Memory\n')

    await textarea.setValue('# Project Memory\n\n- Prefer small diffs.\n')
    expect(wrapper.text()).toContain('memorySettings.unsaved')
    expect(wrapper.find('[data-test="markdown-preview"]').exists()).toBe(false)

    await wrapper.find('.ms-save-btn').trigger('click')
    await settle()

    expect(memoryApiMock.saveFile).toHaveBeenCalledWith({
      projectId: '-workspace-demo',
      path: 'MEMORY.md',
      content: '# Project Memory\n\n- Prefer small diffs.\n',
      expectedUpdatedAt: '2026-05-01T00:00:00.000Z',
      expectedBytes: 18,
    })
    expect(editor(wrapper).exists()).toBe(false)
    expect(previewText(wrapper)).toContain('Prefer small diffs')
  })

  it('does not select a missing current project with no memory files', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        {
          id: '-programs-claude-code',
          label: 'C:\\Programs\\claude-code',
          memoryDir: 'C:\\Users\\HUAWEI\\.claude\\projects\\-programs-claude-code\\memory',
          exists: false,
          fileCount: 0,
          isCurrent: true,
        },
      ],
    })

    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('Programs/claude-code')
    expect(wrapper.text()).toContain('memorySettings.missing')
    expect(wrapper.text()).toContain('memorySettings.noFileSelected')
    expect(wrapper.text()).toContain('memorySettings.selectProject')
    expect(wrapper.text()).not.toContain('HUAWEI')
    expect(memoryApiMock.listFiles).not.toHaveBeenCalled()
  })

  it('lets the markdown editor fill the remaining detail pane height', async () => {
    const wrapper = await mountPage()

    await wrapper.find('.ms-icon-btn').trigger('click')
    await nextTick()

    const textarea = editor(wrapper)
    expect(textarea.exists()).toBe(true)
    expect(textarea.classes()).toContain('ms-textarea')
    expect(textarea.element.parentElement?.className).toContain('ms-editor')
  })

  it('cancels edit mode by discarding the unsaved draft', async () => {
    const wrapper = await mountPage()

    expect(previewText(wrapper)).toContain('Project Memory')
    await wrapper.find('.ms-icon-btn').trigger('click')
    await editor(wrapper).setValue('# Changed Memory\n')

    const cancelButton = wrapper.findAll('.ms-text-btn')[0]
    await cancelButton.trigger('click')
    await settle()

    expect(memoryApiMock.saveFile).not.toHaveBeenCalled()
    expect(editor(wrapper).exists()).toBe(false)
    expect(previewText(wrapper)).toContain('Project Memory')
    expect(previewText(wrapper)).not.toContain('Changed Memory')
  })

  it('keeps unsaved edits when file switching is not confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    memoryApiMock.listFiles.mockResolvedValue({ files: [INDEX_FILE, MANUAL_FILE] })

    const wrapper = await mountPage()

    await wrapper.find('.ms-icon-btn').trigger('click')
    await editor(wrapper).setValue('# Unsaved Memory\n')

    const manualRow = wrapper.findAll('.ms-tree-row').find((row) => row.text().includes('Manual'))
    expect(manualRow).toBeTruthy()
    await manualRow!.trigger('click')
    await settle()

    expect(confirmSpy).toHaveBeenCalled()
    expect(memoryApiMock.readFile).not.toHaveBeenCalledWith('-workspace-demo', 'notes/manual.md')
    expect((editor(wrapper).element as HTMLTextAreaElement).value).toBe('# Unsaved Memory\n')
  })

  it('saves with the platform shortcut while editing and returns to preview mode', async () => {
    const wrapper = await mountPage()

    await wrapper.find('.ms-icon-btn').trigger('click')
    await editor(wrapper).setValue('# Project Memory\n\n- Shortcut save.\n')

    const event = new KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true })
    document.dispatchEvent(event)
    await settle()

    expect(memoryApiMock.saveFile).toHaveBeenCalledWith({
      projectId: '-workspace-demo',
      path: 'MEMORY.md',
      content: '# Project Memory\n\n- Shortcut save.\n',
      expectedUpdatedAt: '2026-05-01T00:00:00.000Z',
      expectedBytes: 18,
    })
    expect(editor(wrapper).exists()).toBe(false)
    expect(previewText(wrapper)).toContain('Shortcut save')
  })

  it('filters the unified resource tree by project path', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        { ...PROJECT, id: '-workspace-alpha', label: '/workspace/alpha' },
        { ...PROJECT, id: '-workspace-beta', label: '/workspace/beta', isCurrent: false, fileCount: 2 },
      ],
    })
    memoryApiMock.listFiles.mockResolvedValue({ files: [INDEX_FILE] })

    const wrapper = await mountPage()
    const projectRows = wrapper.findAll('.ms-project-row')
    expect(projectRows.map((row) => row.text())).toEqual(['workspace/alpha', 'workspace/beta'])

    await wrapper.find('.ms-search-input').setValue('beta')
    await nextTick()

    expect(wrapper.findAll('.ms-project-row').map((row) => row.text())).toEqual(['workspace/beta'])

    const betaRow = wrapper.findAll('.ms-project-row').find((row) => row.attributes('aria-label')?.includes('beta'))
    expect(betaRow).toBeTruthy()
    await betaRow!.trigger('click')
    await settle()

    expect(memoryApiMock.listFiles).toHaveBeenCalledWith('-workspace-beta')
  })

  it('renders nested memory files as a collapsible resource tree', async () => {
    memoryApiMock.listFiles.mockResolvedValue({
      files: [
        INDEX_FILE,
        MANUAL_FILE,
        {
          path: 'notes/archive/old.md',
          name: 'old.md',
          title: 'Old note',
          bytes: 24,
          updatedAt: '2026-05-01T00:03:00.000Z',
          isIndex: false,
        },
      ],
    })
    memoryApiMock.readFile.mockImplementation((_projectId: string, path: string) =>
      Promise.resolve({
        file: {
          path,
          content: path === 'notes/manual.md' ? '# Manual\n' : '# Project Memory\n',
          updatedAt: '2026-05-01T00:00:00.000Z',
          bytes: 18,
        },
      }),
    )

    const wrapper = await mountPage()

    const folderRows = wrapper.findAll('.ms-tree-row.is-nested')
    expect(wrapper.text()).toContain('notes')
    expect(wrapper.text()).toContain('Manual')
    expect(folderRows.length).toBeGreaterThan(0)

    const notesRow = wrapper.findAll('.ms-tree-row').find((row) => row.text().trim() === 'notes')
    expect(notesRow).toBeTruthy()
    await notesRow!.trigger('click')
    await nextTick()

    expect(wrapper.text()).not.toContain('Manual')

    await wrapper.find('.ms-search-input').setValue('manual')
    await nextTick()

    const manualRow = wrapper.findAll('.ms-tree-row').find((row) => row.text().includes('Manual'))
    expect(manualRow).toBeTruthy()
    await manualRow!.trigger('click')
    await settle()

    expect(memoryApiMock.readFile).toHaveBeenCalledWith('-workspace-demo', 'notes/manual.md')
    expect(previewText(wrapper)).toContain('Manual')
    expect(editor(wrapper).exists()).toBe(false)
  })

  it('opens linked memory markdown files from the rendered preview', async () => {
    memoryApiMock.listFiles.mockResolvedValue({ files: [INDEX_FILE, MANUAL_FILE] })
    memoryApiMock.readFile.mockImplementation((_projectId: string, path: string) =>
      Promise.resolve({
        file: {
          path,
          content: path === 'notes/manual.md' ? '# Manual\n' : '# Project Memory\n\n- [Manual](notes/manual.md)\n',
          updatedAt: '2026-05-01T00:00:00.000Z',
          bytes: 48,
        },
      }),
    )

    const wrapper = await mountPage()

    await wrapper.find('[data-test="markdown-preview"] a').trigger('click')
    await settle()

    expect(memoryApiMock.readFile).toHaveBeenCalledWith('-workspace-demo', 'notes/manual.md')
    expect(previewText(wrapper)).toContain('Manual')
    expect(editor(wrapper).exists()).toBe(false)
  })

  it('keeps frontmatter editable but removes it from the rendered preview', async () => {
    memoryApiMock.readFile.mockResolvedValue({
      file: {
        path: 'MEMORY.md',
        content: '---\ntype: project\n---\n\n# Project Memory\n',
        updatedAt: '2026-05-01T00:00:00.000Z',
        bytes: 39,
      },
    })

    const wrapper = await mountPage()

    expect(previewText(wrapper)).toContain('Project Memory')
    expect(previewText(wrapper)).not.toContain('type: project')

    await wrapper.find('.ms-icon-btn').trigger('click')
    await nextTick()

    expect((editor(wrapper).element as HTMLTextAreaElement).value).toBe('---\ntype: project\n---\n\n# Project Memory\n')
  })

  it('opens the exact memory file requested from outside the page', async () => {
    memoryApiMock.listProjects.mockResolvedValue({
      projects: [
        { ...PROJECT, fileCount: 0 },
        {
          ...PROJECT,
          id: '-workspace-other',
          label: '/workspace/other',
          memoryDir: '/tmp/claude/projects/-workspace-other/memory',
          isCurrent: false,
        },
      ],
    })
    memoryApiMock.listFiles.mockImplementation((projectId: string) =>
      Promise.resolve({
        files:
          projectId === '-workspace-other'
            ? [{ ...MANUAL_FILE, path: 'preferences.md', name: 'preferences.md', title: 'preferences.md' }]
            : [],
      }),
    )
    memoryApiMock.readFile.mockResolvedValue({
      file: { path: 'preferences.md', content: '# Preferences\n', updatedAt: '2026-05-01T00:00:00.000Z', bytes: 24 },
    })

    const wrapper = await mountPage()

    const memoryStore = useMemoryStore()
    memoryStore.setPendingOpenPath('/tmp/claude/projects/-workspace-other/memory/preferences.md')
    await settle()

    expect(memoryStore.selectedProjectId).toBe('-workspace-other')
    expect(memoryApiMock.readFile).toHaveBeenCalledWith('-workspace-other', 'preferences.md')
    expect(memoryStore.pendingOpenPath).toBeNull()
    expect(previewText(wrapper)).toContain('Preferences')
    expect(editor(wrapper).exists()).toBe(false)
  })
})
