/**
 * app store 面板/标签/侧边任务的生产行为契约：
 *
 * 1. openInfoTab 按 id 去重：重复打开同一 id 只激活、不重复 push。
 * 2. closeInfoTab 关闭激活 tab 时激活相邻 tab（取 min(index, len-1)）；关闭
 *    最后一个 tab 时面板收起并退出全屏（否则中间区被全屏面板挡住）。
 * 3. 关闭 side-task tab 即销毁全部侧边任务（连带 deleteSession），不留后台会话。
 * 4. subagent 面板优先级高于 tab 类型：打开时清空 activeInfoTabId，避免
 *    currentFile/toolDiffData 等 computed 残留上一个 tab 的值；切换会话时自动关闭。
 * 5. 侧边任务会话是 ephemeral（createSession 带 { ephemeral: true, activate: false }），
 *    不抢占主会话。
 * 6. openFile 的路径解析优先 resolvedPath，读取失败时回退原始路径再试一次。
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { nextTick, reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

const probe = vi.hoisted(() => ({
  api: {
    cron: { setProjectRoot: vi.fn() },
    readFile: vi.fn(),
    preview: { getUrl: vi.fn() },
  },
  session: null as any,
  terminal: null as any,
  split: null as any,
  ephCount: 0,
  termCount: 0,
}))

vi.mock('@/services/electronAPI', () => ({ api: probe.api }))

vi.mock('../chatSession', () => ({
  useChatSessionStore: () => probe.session,
}))

vi.mock('../terminal', () => ({
  useTerminalStore: () => probe.terminal,
}))

vi.mock('../splitLayout', () => ({
  useSplitLayoutStore: () => probe.split,
}))

vi.mock('@/i18n', () => ({
  i18n: { global: { t: (key: string) => key } },
}))

import { useAppStore, type InfoPanelTab } from '../app'

function fakeTab(id: string, type: InfoPanelTab['type'] = 'file', data: any = null): InfoPanelTab {
  return { id, type, title: id, icon: null, data, closeable: true }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  probe.ephCount = 0
  probe.termCount = 0
  probe.api.cron.setProjectRoot.mockClear()
  probe.api.readFile.mockReset().mockResolvedValue('content')
  probe.api.preview.getUrl.mockReset().mockResolvedValue(null)
  probe.session = reactive({
    currentSessionId: 'main-session' as string | null,
    workingDirectory: '',
    currentProjectRoot: '',
    sessions: [{ id: 'main-session', engineType: 'claude-code' }],
    createSession: vi.fn(() => ({ id: `eph-${++probe.ephCount}` })),
    deleteSession: vi.fn(),
  })
  probe.terminal = reactive({
    tabs: [] as Array<{ id: string; label: string }>,
    createTab: vi.fn(() => {
      const id = `terminal-${++probe.termCount}`
      probe.terminal.tabs.push({ id, label: `Terminal ${probe.termCount}` })
      return id
    }),
    closeTab: vi.fn(),
  })
  probe.split = { clearLeavesForTab: vi.fn() }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('主题切换', () => {
  it('toggleTheme 按 light→dark→anthropic→anthropic-dark 循环并写 data-theme', () => {
    const store = useAppStore()
    store.setTheme('anthropic-dark')
    store.toggleTheme()
    expect(store.theme).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    store.toggleTheme()
    expect(store.theme).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    store.toggleTheme()
    expect(store.theme).toBe('anthropic')
    store.toggleTheme()
    expect(store.theme).toBe('anthropic-dark')
    expect(store.isDark).toBe(true)
  })
})

describe('信息面板 tab 的打开/关闭', () => {
  it('openInfoTab：同 id 只激活不重复入列', () => {
    const store = useAppStore()
    store.openInfoTab(fakeTab('file::a.ts', 'file', { path: 'a.ts', name: 'a.ts', content: '', language: 'ts' }))
    store.openInfoTab(fakeTab('file::a.ts', 'file', { path: 'a.ts', name: 'a.ts', content: 'x', language: 'ts' }))
    expect(store.infoPanelTabs).toHaveLength(1)
    expect(store.activeInfoTabId).toBe('file::a.ts')
    expect(store.infoPanelVisible).toBe(true)
    expect(store.panelHome).toBe(false)
  })

  it('closeInfoTab：关闭激活 tab 时激活相邻 tab（取右侧，越界取左侧）', () => {
    const store = useAppStore()
    store.openInfoTab(fakeTab('t1'))
    store.openInfoTab(fakeTab('t2'))
    store.openInfoTab(fakeTab('t3'))
    store.closeInfoTab('t2')
    expect(store.activeInfoTabId).toBe('t3')
    store.closeInfoTab('t3')
    expect(store.activeInfoTabId).toBe('t1')
    expect(store.infoPanelVisible).toBe(true)
  })

  it('closeInfoTab：关闭最后一个 tab → 清激活、收起面板、退出全屏', () => {
    const store = useAppStore()
    store.openInfoTab(fakeTab('only'))
    store.toggleInfoPanelFullscreen()
    store.closeInfoTab('only')
    expect(store.infoPanelTabs).toHaveLength(0)
    expect(store.activeInfoTabId).toBeNull()
    expect(store.infoPanelVisible).toBe(false)
    expect(store.infoPanelFullscreen).toBe(false)
  })

  it('closeInfoTab：关闭非激活 tab 不影响激活 tab；未知 id 无操作', () => {
    const store = useAppStore()
    store.openInfoTab(fakeTab('t1'))
    store.openInfoTab(fakeTab('t2'))
    store.closeInfoTab('t2')
    expect(store.activeInfoTabId).toBe('t1')
    store.closeInfoTab('ghost')
    expect(store.infoPanelTabs).toHaveLength(1)
  })

  it('closeInfoTab：关闭 side-task tab 即销毁全部侧边任务', () => {
    const store = useAppStore()
    store.openSideTaskPanel()
    store.addSideTask()
    const ids = store.sideTasks.map((t) => t.sessionId)
    store.closeInfoTab('side-task')
    expect(probe.session.deleteSession).toHaveBeenCalledTimes(2)
    for (const id of ids) expect(probe.session.deleteSession).toHaveBeenCalledWith(id)
    expect(store.sideTasks).toHaveLength(0)
    expect(store.activeSideTaskSessionId).toBeNull()
  })

  it('closeAllInfoTabs：清空全部 tab、销毁侧边任务、退出全屏', () => {
    const store = useAppStore()
    store.openSideTaskPanel()
    store.toggleInfoPanelFullscreen()
    store.closeAllInfoTabs()
    expect(store.infoPanelTabs).toHaveLength(0)
    expect(store.infoPanelVisible).toBe(false)
    expect(store.infoPanelFullscreen).toBe(false)
    expect(store.sideTasks).toHaveLength(0)
    expect(probe.session.deleteSession).toHaveBeenCalledTimes(1)
  })

  it('toggleInfoPanel：subagent 关闭后重开时恢复激活最近的标签', () => {
    const store = useAppStore()
    store.openInfoTab(fakeTab('t1'))
    store.openSubagentPanel('tc-1')
    expect(store.activeInfoTabId).toBeNull()
    store.toggleInfoPanel()
    expect(store.infoPanelVisible).toBe(false)
    expect(store.subagentPanelState).toBeNull()
    store.toggleInfoPanel()
    expect(store.infoPanelVisible).toBe(true)
    expect(store.activeInfoTabId).toBe('t1')
    expect(store.panelHome).toBe(false)
  })

  it('toggleInfoPanel：无 tab 时打开进入启动器', () => {
    const store = useAppStore()
    store.toggleInfoPanel()
    expect(store.infoPanelVisible).toBe(true)
    expect(store.panelHome).toBe(true)
  })
})

describe('subagent 面板', () => {
  it('openSubagentPanel 记录当前会话 id 并清空激活 tab', () => {
    const store = useAppStore()
    probe.session.currentSessionId = 'sess-9'
    store.openInfoTab(fakeTab('t1'))
    store.openSubagentPanel('tc-1')
    expect(store.subagentPanelState).toEqual({ toolCallId: 'tc-1', sessionId: 'sess-9' })
    expect(store.activeInfoTabId).toBeNull()
    expect(store.infoPanelVisible).toBe(true)
    expect(store.panelHome).toBe(false)
    expect(store.infoPanelMode).toBe('subagent')
  })

  it('closeSubagentPanel：直接收起面板并退出全屏', () => {
    const store = useAppStore()
    store.openSubagentPanel('tc-1')
    store.toggleInfoPanelFullscreen()
    store.closeSubagentPanel()
    expect(store.subagentPanelState).toBeNull()
    expect(store.infoPanelVisible).toBe(false)
    expect(store.infoPanelFullscreen).toBe(false)
  })

  it('切换会话时自动关闭 subagent 面板', async () => {
    const store = useAppStore()
    store.openSubagentPanel('tc-1')
    probe.session.currentSessionId = 'another-session'
    await nextTick()
    expect(store.subagentPanelState).toBeNull()
  })
})

describe('侧边任务', () => {
  it('addSideTask：创建 ephemeral 会话且不抢占主会话', () => {
    const store = useAppStore()
    probe.session.currentProjectRoot = '/proj'
    const id = store.addSideTask()
    expect(probe.session.createSession).toHaveBeenCalledWith(
      'sideTask.newTask', '/proj', undefined, { ephemeral: true, activate: false },
    )
    expect(id).toBe('eph-1')
    expect(store.sideTasks).toEqual([{ sessionId: 'eph-1', title: 'sideTask.newTask' }])
    expect(store.activeSideTaskSessionId).toBe('eph-1')
  })

  it('addSideTask：无项目根时传 undefined', () => {
    const store = useAppStore()
    store.addSideTask()
    expect(probe.session.createSession).toHaveBeenCalledWith(
      'sideTask.newTask', undefined, undefined, { ephemeral: true, activate: false },
    )
  })

  it('openSideTaskPanel：清 subagent 态，无任务时先建一个', () => {
    const store = useAppStore()
    store.openSubagentPanel('tc-1')
    store.openSideTaskPanel()
    expect(store.subagentPanelState).toBeNull()
    expect(store.activeInfoTabId).toBe('side-task')
    expect(store.sideTasks).toHaveLength(1)
  })

  it('openSideTaskPanel：已有任务时不再新建', () => {
    const store = useAppStore()
    store.addSideTask()
    store.openSideTaskPanel()
    expect(store.sideTasks).toHaveLength(1)
  })

  it('selectSideTask：只接受已存在的任务 id', () => {
    const store = useAppStore()
    const id = store.addSideTask()
    store.selectSideTask('ghost')
    expect(store.activeSideTaskSessionId).toBe(id)
  })

  it('closeSideTask：激活项被删时选中相邻任务；最后一项被删时清空', () => {
    const store = useAppStore()
    const first = store.addSideTask()
    const second = store.addSideTask()
    store.closeSideTask(second)
    expect(probe.session.deleteSession).toHaveBeenCalledWith(second)
    expect(store.activeSideTaskSessionId).toBe(first)
    store.closeSideTask(first)
    expect(store.activeSideTaskSessionId).toBeNull()
    expect(store.sideTasks).toHaveLength(0)
  })

  it('closeSideTask：未知 id 无操作', () => {
    const store = useAppStore()
    store.addSideTask()
    store.closeSideTask('ghost')
    expect(probe.session.deleteSession).not.toHaveBeenCalled()
    expect(store.sideTasks).toHaveLength(1)
  })

  it('askInSideTask：有激活任务时注入引用；无任务时先建一个', () => {
    const store = useAppStore()
    store.askInSideTask('选中内容')
    const created = store.activeSideTaskSessionId
    expect(created).toBe('eph-1')
    const payload = store.consumeInputInjection()
    expect(payload?.quote?.text).toBe('选中内容')
    expect(payload?.targetSessionId).toBe(created)

    const second = store.addSideTask()
    store.selectSideTask(second)
    store.askInSideTask('再来一条')
    expect(store.consumeInputInjection()?.targetSessionId).toBe(second)
  })
})

describe('工具 diff 面板', () => {
  it('showToolDiff：已完成操作在打开时标记 actionCompleted', () => {
    const store = useAppStore()
    store.markToolActionCompleted('tc-9')
    store.showToolDiff({ type: 'edit', filePath: 'a.ts', originalContent: '', modifiedContent: '', toolCallId: 'tc-9', language: 'ts' })
    expect(store.activeInfoTabId).toBe('tool-diff::tc-9')
    expect((store.activeInfoTab?.data as any).actionCompleted).toBe(true)
  })

  it('showToolDiff：未完成的操作不带标记', () => {
    const store = useAppStore()
    store.showToolDiff({ type: 'grep', filePath: 'a.ts', originalContent: '', modifiedContent: '', toolCallId: 'tc-1', language: 'ts' })
    expect((store.activeInfoTab?.data as any).actionCompleted).toBeFalsy()
  })

  it('markToolActionCompleted：更新已打开 tab 的 actionCompleted', () => {
    const store = useAppStore()
    store.showToolDiff({ type: 'edit', filePath: 'a.ts', originalContent: '', modifiedContent: '', toolCallId: 'tc-1', language: 'ts' })
    store.markToolActionCompleted('tc-1')
    expect(store.completedToolActions.has('tc-1')).toBe(true)
    expect((store.activeInfoTab?.data as any).actionCompleted).toBe(true)
  })
})

describe('文件 tab', () => {
  it('setCurrentFile：markdown 与普通文件分类型；null 直接返回', () => {
    const store = useAppStore()
    store.setCurrentFile(null)
    expect(store.infoPanelTabs).toHaveLength(0)

    store.setCurrentFile({ path: 'r.md', name: 'r.md', content: '# hi', language: 'markdown' })
    expect(store.activeInfoTabId).toBe('markdown::r.md')
    expect(store.activeInfoTab?.type).toBe('markdown')
    expect(store.currentFile?.content).toBe('# hi')

    store.setCurrentFile({ path: 'a.ts', name: 'a.ts', content: '', language: 'typescript' })
    expect(store.activeInfoTabId).toBe('file::a.ts')
    expect(store.activeInfoTab?.type).toBe('file')
  })

  it('updateOpenFileContent：只同步同路径的 file/markdown tab', () => {
    const store = useAppStore()
    store.setCurrentFile({ path: 'a.ts', name: 'a.ts', content: 'old', language: 'typescript' })
    store.setCurrentFile({ path: 'r.md', name: 'r.md', content: 'old', language: 'markdown' })
    store.showToolDiff({ type: 'edit', filePath: 'a.ts', originalContent: '', modifiedContent: '', toolCallId: 'tc-1', language: 'ts' })

    store.updateOpenFileContent('a.ts', 'new')
    const fileTab = store.infoPanelTabs.find((t) => t.id === 'file::a.ts')
    const mdTab = store.infoPanelTabs.find((t) => t.id === 'markdown::r.md')
    expect((fileTab?.data as any).content).toBe('new')
    expect((mdTab?.data as any).content).toBe('old')
  })

  it('openFile：api 缺失时报错并放弃', async () => {
    const store = useAppStore()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const original = probe.api.readFile
    ;(probe.api as any).readFile = undefined
    try {
      await store.openFile('/a.ts')
      expect(errSpy).toHaveBeenCalledWith('[AppStore] readFile API not available')
      expect(store.infoPanelTabs).toHaveLength(0)
    } finally {
      probe.api.readFile = original
    }
  })

  it('openFile：相对路径解析到项目根；记录行号；语言按扩展名', async () => {
    const store = useAppStore()
    store.setProjectRoot('/root')
    await store.openFile('src/foo.ts', 5, 10)
    expect(probe.api.readFile).toHaveBeenCalledWith('/root/src/foo.ts')
    expect(store.activeInfoTabId).toBe('file::/root/src/foo.ts')
    const data = store.activeInfoTab?.data as any
    expect(data).toMatchObject({ path: '/root/src/foo.ts', name: 'foo.ts', content: 'content', language: 'typescript' })
    expect(store.currentLine).toBe(5)
    expect(store.currentEndLine).toBe(10)
  })

  it('openFile：解析路径读取失败时回退原始路径', async () => {
    const store = useAppStore()
    store.setProjectRoot('/root')
    probe.api.readFile.mockResolvedValueOnce(null).mockResolvedValueOnce('late')
    await store.openFile('src/foo.ts')
    expect(probe.api.readFile).toHaveBeenNthCalledWith(1, '/root/src/foo.ts')
    expect(probe.api.readFile).toHaveBeenNthCalledWith(2, 'src/foo.ts')
    expect((store.activeInfoTab?.data as any).content).toBe('late')
  })

  it('openFile：两次读取都失败 → 警告且不开 tab', async () => {
    const store = useAppStore()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    probe.api.readFile.mockResolvedValue(null)
    await store.openFile('/missing.ts')
    expect(warnSpy).toHaveBeenCalledWith('[AppStore] Failed to open file (not found):', '/missing.ts')
    expect(store.infoPanelTabs).toHaveLength(0)
  })

  it('openFile：读取抛错被捕获', async () => {
    const store = useAppStore()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    probe.api.readFile.mockRejectedValue(new Error('EIO'))
    await store.openFile('/a.ts')
    expect(errSpy).toHaveBeenCalledWith('[AppStore] Failed to open file:', '/a.ts', expect.any(Error))
  })

  it('openFile：已存在的 tab 更新内容并激活；markdown 无行号时用 markdown 类型', async () => {
    const store = useAppStore()
    await store.openFile('/doc.md')
    expect(store.activeInfoTab?.type).toBe('markdown')
    probe.api.readFile.mockResolvedValue('v2')
    await store.openFile('/doc.md', 3)
    expect(store.infoPanelTabs.filter((t) => t.id === 'file::/doc.md')).toHaveLength(1)
    expect(store.activeInfoTabId).toBe('file::/doc.md')
    expect((store.activeInfoTab?.data as any).content).toBe('v2')
    expect(store.currentLine).toBe(3)
  })
})

describe('路径解析', () => {
  // resolveFilePath 未从 store 导出，经由 openFile 的公共出口覆盖各分支
  it('openFile：绝对路径原样读取（盘符 / UNC / unix 均不拼接）', async () => {
    const store = useAppStore()
    await store.openFile('/abs/x.ts')
    await store.openFile('C:\\abs\\x.ts')
    await store.openFile('//unc/share')
    expect(probe.api.readFile).toHaveBeenNthCalledWith(1, '/abs/x.ts')
    expect(probe.api.readFile).toHaveBeenNthCalledWith(2, 'C:\\abs\\x.ts')
    expect(probe.api.readFile).toHaveBeenNthCalledWith(3, '//unc/share')
  })

  it('openFile：相对路径拼到项目根，容忍尾部斜杠与 ./ 前缀', async () => {
    const store = useAppStore()
    store.setProjectRoot('/root/')
    await store.openFile('src/a.ts')
    await store.openFile('./src/b.ts')
    expect(probe.api.readFile).toHaveBeenNthCalledWith(1, '/root/src/a.ts')
    expect(probe.api.readFile).toHaveBeenNthCalledWith(2, '/root/src/b.ts')
  })

  it('openFile：反斜杠项目根用反斜杠连接；无项目根原样读取', async () => {
    const store = useAppStore()
    store.setProjectRoot('D:\\repo')
    await store.openFile('src\\a.ts')
    expect(probe.api.readFile).toHaveBeenCalledWith('D:\\repo\\src\\a.ts')

    store.setProjectRoot('')
    await store.openFile('src/rel.ts')
    expect(probe.api.readFile).toHaveBeenCalledWith('src/rel.ts')
  })

  it('resolveSessionPath：会话工作目录优先于项目根；两者皆无时原样返回', () => {
    const store = useAppStore()
    expect(store.resolveSessionPath('out/x.html')).toBe('out/x.html')
    store.setProjectRoot('/root')
    expect(store.resolveSessionPath('out/x.html')).toBe('/root/out/x.html')
    probe.session.workingDirectory = '/sess'
    expect(store.resolveSessionPath('out/x.html')).toBe('/sess/out/x.html')
    expect(store.resolveSessionPath('C:\\abs\\x.html')).toBe('C:\\abs\\x.html')
  })
})

describe('面板快捷入口', () => {
  it('goPanelHome / showInfoPanel / hideInfoPanel', () => {
    const store = useAppStore()
    store.goPanelHome()
    expect(store.panelHome).toBe(true)
    expect(store.infoPanelVisible).toBe(true)

    store.hideInfoPanel()
    expect(store.infoPanelVisible).toBe(false)
    expect(store.infoPanelTabs).toHaveLength(0)

    store.showInfoPanel('file')
    expect(store.infoPanelVisible).toBe(true)
  })

  it('openArtifactsPanel / openDesignPreview + closeDesignPreview', () => {
    const store = useAppStore()
    store.openArtifactsPanel()
    expect(store.activeInfoTabId).toBe('artifacts-panel')
    store.openDesignPreview()
    expect(store.activeInfoTabId).toBe('design-preview')
    expect(store.activeInfoTab?.closeable).toBe(false)
    store.closeDesignPreview()
    expect(store.activeInfoTabId).toBe('artifacts-panel')
  })

  it('openTerminalInPanel：无终端标签时先创建', () => {
    const store = useAppStore()
    store.openTerminalInPanel()
    expect(probe.terminal.createTab).toHaveBeenCalled()
    expect(store.activeInfoTabId).toBe('terminal-panel')

    probe.terminal.createTab.mockClear()
    store.closeInfoTab('terminal-panel')
    store.openTerminalInPanel()
    expect(probe.terminal.createTab).not.toHaveBeenCalled()
  })

  it('openBlankWebview：新 tab 历史为空；已存在时只激活', () => {
    const store = useAppStore()
    store.openBlankWebview()
    expect(store.activeInfoTabId).toBe('webview::new')
    expect(store.webviewUrl).toBe('')
    expect(store.webviewHistory).toEqual([])
    store.openBlankWebview()
    expect(store.infoPanelTabs.filter((t) => t.id === 'webview::new')).toHaveLength(1)
  })
})

describe('Office 预览', () => {
  it('openOfficePreview：pdf 默认 html，其余默认 watch；可显式指定', () => {
    const store = useAppStore()
    store.openOfficePreview('/a/report.pdf')
    expect(store.officePreviewFile).toBe('/a/report.pdf')
    expect(store.officePreviewMode).toBe('html')
    expect(store.activeInfoTabId).toBe('office-preview')
    expect(store.activeInfoTab?.title).toBe('report.pdf')

    store.openOfficePreview('/a/x.docx', 'screenshots')
    expect(store.officePreviewMode).toBe('screenshots')

    store.openOfficePreview('/a/y.docx')
    expect(store.officePreviewMode).toBe('watch')
  })

  it('closeOfficePreview：清文件与 tab', () => {
    const store = useAppStore()
    store.openOfficePreview('/a/report.pdf')
    store.closeOfficePreview()
    expect(store.officePreviewFile).toBe('')
    expect(store.infoPanelTabs.find((t) => t.id === 'office-preview')).toBeUndefined()
  })
})

describe('SCM diff tab', () => {
  it('openScmDiff：新建与已存在（刷新 staged 状态）', () => {
    const store = useAppStore()
    store.openScmDiff('src/a.ts', false)
    expect(store.activeInfoTabId).toBe('diff::src/a.ts')
    expect(store.activeInfoTab?.title).toBe('a.ts')
    store.openScmDiff('src/a.ts', true)
    expect(store.infoPanelTabs.filter((t) => t.id === 'diff::src/a.ts')).toHaveLength(1)
    expect((store.activeInfoTab?.data as any).staged).toBe(true)
  })

  it('openCommitDiff：有文件名时 tab 含文件维度；标题取 hash 前 8 位', () => {
    const store = useAppStore()
    store.openCommitDiff('abcdef1234567890')
    expect(store.activeInfoTabId).toBe('diff::commit::abcdef1234567890')
    expect(store.activeInfoTab?.title).toBe('abcdef12')

    store.openCommitDiff('abcdef1234567890', 'src/b.ts')
    expect(store.activeInfoTabId).toBe('diff::commit::abcdef1234567890::src/b.ts')
    expect(store.activeInfoTab?.title).toBe('b.ts')
  })
})

describe('getLanguageFromPath', () => {
  it('按扩展名映射，大小写不敏感，未知扩展回 plaintext', () => {
    const store = useAppStore()
    expect(store.getLanguageFromPath('a.TS')).toBe('typescript')
    expect(store.getLanguageFromPath('b.py')).toBe('python')
    expect(store.getLanguageFromPath('c.SVH')).toBe('verilog')
    expect(store.getLanguageFromPath('d.md')).toBe('markdown')
    expect(store.getLanguageFromPath('e.unknown')).toBe('plaintext')
    expect(store.getLanguageFromPath('noext')).toBe('plaintext')
  })
})

describe('项目根 / 模式 / 工作区的持久化', () => {
  it('初始值读 localStorage，setProjectRoot 回写并通知主进程 cron', async () => {
    localStorage.setItem('app_project_root', '/pre')
    const freshPinia = createPinia()
    setActivePinia(freshPinia)
    const store = useAppStore()
    expect(store.projectRoot).toBe('/pre')
    expect(probe.api.cron.setProjectRoot).toHaveBeenCalledWith('/pre')

    store.setProjectRoot('/now')
    expect(localStorage.getItem('app_project_root')).toBe('/now')
    await nextTick()
    expect(probe.api.cron.setProjectRoot).toHaveBeenLastCalledWith('/now')
  })

  it('closeProject：清根、清存储、关全部面板 tab', () => {
    const store = useAppStore()
    store.setProjectRoot('/root')
    store.openInfoTab(fakeTab('t1'))
    store.closeProject()
    expect(store.projectRoot).toBe('')
    expect(localStorage.getItem('app_project_root')).toBeNull()
    expect(store.infoPanelTabs).toHaveLength(0)
    expect(store.infoPanelVisible).toBe(false)
  })

  it('setMode / setWorkWorkspace / clearWorkWorkspace 持久化', () => {
    const store = useAppStore()
    store.setMode('work')
    expect(localStorage.getItem('app_mode')).toBe('work')
    store.setWorkWorkspace('/ww')
    expect(store.workWorkspace).toBe('/ww')
    expect(store.workWorkspaceConfirmed).toBe(true)
    expect(localStorage.getItem('app_work_workspace')).toBe('/ww')
    store.clearWorkWorkspace()
    expect(store.workWorkspace).toBe('')
    expect(store.workWorkspaceConfirmed).toBe(false)
    expect(localStorage.getItem('app_work_workspace')).toBeNull()
  })

  it('toggleShowHiddenFiles 持久化', () => {
    const store = useAppStore()
    store.toggleShowHiddenFiles()
    expect(store.showHiddenFiles).toBe(true)
    expect(localStorage.getItem('app_show_hidden_files')).toBe('true')
  })
})

describe('输入注入', () => {
  it('pushToInput / consumeInputInjection：消费一次后清空', () => {
    const store = useAppStore()
    store.pushToInput({ text: 'inject' })
    expect(store.consumeInputInjection()).toEqual({ text: 'inject' })
    expect(store.consumeInputInjection()).toBeNull()
  })
})
