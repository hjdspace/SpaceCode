import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { mount, type DOMWrapper } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import type { Message } from '@/types'
import zhCN from '@/i18n/locales/zh-CN'
import enUS from '@/i18n/locales/en-US'
import SessionContextTaskPanel from '../SessionContextTaskPanel.vue'
import { useSessionFileChangesStore } from '@/stores/sessionFileChanges'
import { useScmStore } from '@/stores/scm'
import { useAppStore } from '@/stores/app'
import { useSessionContext } from '@/stores/sessionContext'

const ROOT = 'D:/repo'

const diffCalls = vi.hoisted(() => ({
  getReviewDiff: vi.fn(),
  getSessionFileDiff: vi.fn(),
}))

// 只顶掉这两个 diff 源，其余保持真实 —— 面板与它依赖的 store 在挂载过程中还会碰到别的 api
vi.mock('@/services/electronAPI', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/electronAPI')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      git: { ...actual.api.git, getReviewDiff: diffCalls.getReviewDiff },
      session: { ...actual.api.session, getSessionFileDiff: diffCalls.getSessionFileDiff },
    },
  }
})

function assistant(toolCalls: Array<{ tool: string; path: string }>): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: toolCalls.map((p, i) => ({
      id: `tc${i}`,
      name: p.tool,
      input: { file_path: p.path },
      status: 'completed',
    })),
  } as unknown as Message
}

/**
 * store 要在组件 setup 里取：scm store 内部用 useI18n()，在测试函数体里直接
 * useScmStore() 会脱离 app context 抛错。真实调用方（ChatPanel）本来也是在
 * setup 里同步数据的，这里照搬那个形状。
 */
function mountPanel(files: Message[], stats: Record<string, { additions: number | null; deletions: number | null }>) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const i18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    fallbackLocale: 'en-US',
    messages: { 'zh-CN': zhCN, 'en-US': enUS },
  })

  const Host = defineComponent({
    setup() {
      useAppStore().projectRoot = ROOT
      useScmStore().fileStats = stats
      useSessionFileChangesStore().syncSession('s1', files, { projectRoot: ROOT, workingDirectory: ROOT })
      useSessionContext().rightPanelView = 'review'
      return () => h(SessionContextTaskPanel, { sessionId: 's1' })
    },
  })

  return mount(Host, { global: { plugins: [pinia, i18n] } })
}

function rows(wrapper: ReturnType<typeof mountPanel>) {
  const text = (row: DOMWrapper<Element>, selector: string) =>
    row.find(selector).exists() ? row.find(selector).text() : ''

  return wrapper.findAll('.sc-file-row').map(row => ({
    name: text(row, '.sc-file-name'),
    tool: text(row, '.sc-file-tool'),
    tag: text(row, '.sc-file-tag'),
    stats: text(row, '.sc-file-stats'),
  }))
}

describe('SessionContextTaskPanel 会话改动列表', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('仓库外文件标出"不在 git 仓库内"，并且不显示假的 +0 -0', () => {
    const [row] = rows(mountPanel(
      [assistant([{ tool: 'Edit', path: 'C:/Users/me/.claude/projects/x/MEMORY.md' }])],
      {},
    ))

    expect(row.name).toBe('MEMORY.md')
    expect(row.tag).toBe('不在 git 仓库内')
    expect(row.stats).toBe('')
  })

  it('仓库内未提交的文件显示工具名与 git 行数，不带状态标签', () => {
    const [row] = rows(mountPanel(
      [assistant([{ tool: 'Write', path: `${ROOT}/src/a.ts` }])],
      { 'src/a.ts': { additions: 168, deletions: 0 } },
    ))

    expect(row.tool).toBe('Write')
    expect(row.tag).toBe('')
    expect(row.stats).toBe('+168-0')
  })

  it('仓库内但已无未提交差异（已提交/已回退）单独说明，不与仓库外混为一谈', () => {
    const [row] = rows(mountPanel(
      [assistant([{ tool: 'Edit', path: `${ROOT}/tests/a.test.ts` }])],
      {},
    ))

    expect(row.tag).toBe('已无未提交改动')
    expect(row.stats).toBe('')
  })

  it('回合窗口观测到的文件标为"命令/外部"，不显示工具名', () => {
    const message = {
      id: 'm2',
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      metadata: { commandFiles: [{ path: 'dist/report.xlsx', at: Date.now() }] },
    } as unknown as Message

    const [row] = rows(mountPanel([message], { 'dist/report.xlsx': { additions: null, deletions: null } }))

    expect(row.tool).toBe('')
    expect(row.tag).toBe('命令/外部')
  })
})

describe('SessionContextTaskPanel diff 来源', () => {
  const gitHunks = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, content: '+fromGit' }]

  beforeEach(() => {
    setActivePinia(createPinia())
    diffCalls.getReviewDiff.mockReset()
    diffCalls.getSessionFileDiff.mockReset()
  })

  async function expandFirstFile(wrapper: ReturnType<typeof mountPanel>) {
    await wrapper.find('.sc-file-row').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('git 里还有未提交差异时优先用 git，不去取会话备份', async () => {
    diffCalls.getReviewDiff.mockResolvedValue({ hunks: gitHunks })

    const wrapper = await expandFirstFile(mountPanel(
      [assistant([{ tool: 'Write', path: `${ROOT}/src/a.ts` }])],
      { 'src/a.ts': { additions: 3, deletions: 0 } },
    ))

    expect(diffCalls.getSessionFileDiff).not.toHaveBeenCalled()
    expect(wrapper.find('.sc-diff-block').text()).toContain('fromGit')
  })

  it('仓库外文件改用会话备份，并说明 diff 的来源', async () => {
    const outside = 'C:/Users/me/.claude/projects/x/MEMORY.md'
    diffCalls.getSessionFileDiff.mockResolvedValue({
      state: 'ok',
      path: outside,
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-old line\n+new line\n',
    })

    const wrapper = await expandFirstFile(mountPanel(
      [assistant([{ tool: 'Edit', path: outside }])],
      {},
    ))

    expect(diffCalls.getSessionFileDiff).toHaveBeenCalledWith('s1', outside, ROOT)
    const block = wrapper.find('.sc-diff-block')
    expect(block.text()).toContain('该文件不在 git 仓库内，以下 diff 来自本会话的改动备份')
    expect(block.text()).toContain('new line')
    expect(block.text()).toContain('-old line')
  })

  it('备份已被清理时说"无法还原"，而不是回落到全文或假 diff', async () => {
    const outside = 'C:/Users/me/.claude/projects/x/MEMORY.md'
    diffCalls.getSessionFileDiff.mockResolvedValue({ state: 'evidence_lost', path: outside })

    const wrapper = await expandFirstFile(mountPanel(
      [assistant([{ tool: 'Edit', path: outside }])],
      {},
    ))

    expect(wrapper.find('.sc-diff-error').text()).toContain('本会话的改动备份已被清理')
    expect(diffCalls.getReviewDiff).not.toHaveBeenCalled()
  })

  it('仓库内已提交掉的改动也能 review：git 无差异时落到会话备份', async () => {
    const committed = 'tests/a.test.ts'
    diffCalls.getSessionFileDiff.mockResolvedValue({
      state: 'ok',
      path: committed,
      diff: `diff --git a/${committed} b/${committed}\n--- a/${committed}\n+++ b/${committed}\n@@ -1,1 +1,1 @@\n+committed by session\n`,
    })

    const wrapper = await expandFirstFile(mountPanel(
      [assistant([{ tool: 'Edit', path: `${ROOT}/${committed}` }])],
      {},
    ))

    const block = wrapper.find('.sc-diff-block')
    expect(block.text()).toContain('git 已无未提交差异，以下 diff 来自本会话的改动备份')
    expect(block.text()).toContain('committed by session')
  })

  it('会话备份里没有这个文件时保留原有兜底：仓库外给全文', async () => {
    const outside = 'C:/Users/me/notes/plan.md'
    diffCalls.getSessionFileDiff.mockResolvedValue({ state: 'no_evidence', path: outside })
    diffCalls.getReviewDiff.mockResolvedValue({ hunks: [{ ...gitHunks[0]!, content: '+whole file body' }] })

    const wrapper = await expandFirstFile(mountPanel(
      [assistant([{ tool: 'Write', path: outside }])],
      {},
    ))

    expect(diffCalls.getReviewDiff).toHaveBeenLastCalledWith(ROOT, outside)
    expect(wrapper.find('.sc-diff-block').text()).toContain('whole file body')
  })
})
