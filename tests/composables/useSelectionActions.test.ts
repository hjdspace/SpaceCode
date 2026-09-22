/**
 * useSelectionActions composable 测试 — 检测、改写簿记(Keep/Discard/Try again)、添加到对话。
 * jsdom 环境下 mock window.getSelection 与 AI/electronAPI 依赖。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const aiMocks = vi.hoisted(() => ({
  runSelectionAction: vi.fn(),
}))

vi.mock('@/services/selectionAI', () => ({
  runSelectionAction: aiMocks.runSelectionAction,
}))

const apiMocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
}))

vi.mock('@/services/electronAPI', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, api: { ...(actual.api as object), writeFile: apiMocks.writeFile } }
})

vi.mock('@/i18n', () => ({
  i18n: {
    global: {
      locale: { value: 'zh-CN' },
      t: (key: string) => key,
    },
  },
  detectSystemLanguage: () => 'zh-CN',
}))

import { useSelectionBarStore } from '@/stores/selectionBar'
import { useAppStore } from '@/stores/app'
import { registerSelectionHost, useSelectionActions, _resetSelectionActionsState } from '@/composables/useSelectionActions'

/** 构造一个落在指定 host 元素内的假选区 */
function mockSelection(host: HTMLElement, text: string) {
  const textNode = document.createTextNode(text)
  host.appendChild(textNode)
  const range = {
    commonAncestorContainer: textNode,
    startContainer: textNode,
    endContainer: textNode,
    startOffset: 0,
    endOffset: text.length,
    getClientRects: () => [{ top: 10, bottom: 30, left: 50, width: 120, height: 20 } as DOMRect],
    getBoundingClientRect: () => ({ top: 10, bottom: 30, left: 50, width: 120, height: 20 } as DOMRect),
  }
  const sel = {
    rangeCount: 1,
    isCollapsed: false,
    toString: () => text,
    getRangeAt: () => range,
  }
  vi.spyOn(window, 'getSelection').mockReturnValue(sel as unknown as Selection)
  return { textNode, range, sel }
}

function setupFileTab(content: string) {
  const appStore = useAppStore()
  appStore.openInfoTab({
    id: 'file::/repo/a.ts',
    type: 'file',
    title: 'a.ts',
    icon: null,
    data: { path: '/repo/a.ts', name: 'a.ts', content, language: 'typescript' },
    closeable: true,
  })
  return appStore
}

describe('useSelectionActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    _resetSelectionActionsState()
    document.body.innerHTML = ''
    aiMocks.runSelectionAction.mockReset()
    apiMocks.writeFile.mockReset()
  })

  it('mouseup 检测选区并打开浮条(chat 场景)', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, { context: 'chat' })
    mockSelection(host, 'hello world')

    host.dispatchEvent(new MouseEvent('mouseup'))
    const store = useSelectionBarStore()
    expect(store.visible).toBe(true)
    expect(store.context).toBe('chat')
    expect(store.selectedText).toBe('hello world')
    expect(store.anchor).toEqual({ top: 10, bottom: 30, left: 50, width: 120 })
  })

  it('选区过短不触发', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, { context: 'chat' })
    mockSelection(host, ' a ')

    host.dispatchEvent(new MouseEvent('mouseup'))
    expect(useSelectionBarStore().visible).toBe(false)
  })

  it('addToConversation 以引用附件推入输入框', () => {
    const appStore = useAppStore()
    const pushSpy = vi.spyOn(appStore, 'pushToInput')
    const store = useSelectionBarStore()
    store.open({ context: 'chat', selectedText: 'line1\nline2', anchor: { top: 0, bottom: 0, left: 0, width: 0 } })

    const { addToConversation } = useSelectionActions()
    addToConversation()
    expect(pushSpy).toHaveBeenCalledWith({
      quote: { id: expect.any(String), text: 'line1\nline2' },
    })
    expect(store.visible).toBe(false)
  })

  it('file 场景改写: 精确偏移拼接 + result 相位', async () => {
    const content = 'const a = 1;\nconst b = 2;\nconst c = 3;'
    const appStore = setupFileTab(content)
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, {
      context: 'file',
      getSelectionInfo: () => ({ absStart: 13, absEnd: 25, text: 'const b = 2;', startLine: 2, endLine: 2 }),
    })

    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: 'const b = 2;', anchor: { top: 0, bottom: 0, left: 0, width: 0 } })
    aiMocks.runSelectionAction.mockResolvedValue('const b = 20;')

    const { runAction } = useSelectionActions()
    await runAction('improve')

    expect(appStore.currentFile?.content).toBe('const a = 1;\nconst b = 20;\nconst c = 3;')
    expect(store.phase).toBe('result')
  })

  it('Discard 还原原文, 磁盘未写', async () => {
    const content = 'original text'
    setupFileTab(content)
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, {
      context: 'file',
      getSelectionInfo: () => ({ absStart: 0, absEnd: 13, text: content, startLine: 1, endLine: 1 }),
    })

    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: content, anchor: { top: 0, bottom: 0, left: 0, width: 0 } })
    aiMocks.runSelectionAction.mockResolvedValue('rewritten text')

    const actions = useSelectionActions()
    await actions.runAction('improve')
    const appStore = useAppStore()
    expect(appStore.currentFile?.content).toBe('rewritten text')

    actions.discard()
    expect(appStore.currentFile?.content).toBe('original text')
    expect(apiMocks.writeFile).not.toHaveBeenCalled()
    expect(store.visible).toBe(false)
  })

  it('Keep 写入磁盘并派发 refresh-file-tree', async () => {
    setupFileTab('original')
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, {
      context: 'file',
      getSelectionInfo: () => ({ absStart: 0, absEnd: 8, text: 'original', startLine: 1, endLine: 1 }),
    })

    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: 'original', anchor: { top: 0, bottom: 0, left: 0, width: 0 } })
    aiMocks.runSelectionAction.mockResolvedValue('improved')
    apiMocks.writeFile.mockResolvedValue({ success: true })

    const actions = useSelectionActions()
    await actions.runAction('improve')
    const eventSpy = vi.fn()
    window.addEventListener('refresh-file-tree', eventSpy)
    await actions.keep()
    window.removeEventListener('refresh-file-tree', eventSpy)

    expect(apiMocks.writeFile).toHaveBeenCalledWith('/repo/a.ts', 'improved')
    expect(eventSpy).toHaveBeenCalledTimes(1)
    expect(store.visible).toBe(false)
  })

  it('Keep 失败进入 error 相位且不关闭浮条', async () => {
    setupFileTab('original')
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, {
      context: 'file',
      getSelectionInfo: () => ({ absStart: 0, absEnd: 8, text: 'original', startLine: 1, endLine: 1 }),
    })

    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: 'original', anchor: { top: 0, bottom: 0, left: 0, width: 0 } })
    aiMocks.runSelectionAction.mockResolvedValue('improved')
    apiMocks.writeFile.mockResolvedValue({ success: false, error: 'disk full' })

    const actions = useSelectionActions()
    await actions.runAction('improve')
    await actions.keep()
    expect(store.phase).toBe('error')
    expect(store.error).toBe('disk full')
    expect(store.visible).toBe(true)
  })

  it('Try again 替换已应用区间, Discard 仍还原最初原文', async () => {
    setupFileTab('AAA BBB')
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, {
      context: 'file',
      getSelectionInfo: () => ({ absStart: 0, absEnd: 3, text: 'AAA', startLine: 1, endLine: 1 }),
    })

    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: 'AAA', anchor: { top: 0, bottom: 0, left: 0, width: 0 } })
    aiMocks.runSelectionAction.mockResolvedValueOnce('X1')

    const actions = useSelectionActions()
    await actions.runAction('improve')
    const appStore = useAppStore()
    expect(appStore.currentFile?.content).toBe('X1 BBB')

    aiMocks.runSelectionAction.mockResolvedValueOnce('X2-longer')
    await actions.tryAgain()
    expect(appStore.currentFile?.content).toBe('X2-longer BBB')

    actions.discard()
    expect(appStore.currentFile?.content).toBe('AAA BBB')
  })

  it('getSelectionInfo 返回 null 时回退字符串定位', async () => {
    const content = 'find-me-here'
    setupFileTab(content)
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, { context: 'file', getSelectionInfo: () => null })

    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: 'find-me-here', anchor: { top: 0, bottom: 0, left: 0, width: 0 } })
    aiMocks.runSelectionAction.mockResolvedValue('replaced')

    await useSelectionActions().runAction('improve')
    expect(useAppStore().currentFile?.content).toBe('replaced')
  })

  it('字符串定位失败时进入 error 相位', async () => {
    setupFileTab('nothing matches')
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, { context: 'file', getSelectionInfo: () => null })

    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: 'missing text', anchor: { top: 0, bottom: 0, left: 0, width: 0 } })

    await useSelectionActions().runAction('improve')
    expect(store.phase).toBe('error')
    expect(store.error).toBe('selectionActions.errorLocate')
  })

  it('chat 场景 explain: 显示解释卡片, 浮条隐藏', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, { context: 'chat' })

    const store = useSelectionBarStore()
    store.open({ context: 'chat', selectedText: 'what is this', anchor: { top: 0, bottom: 0, left: 0, width: 0 } })
    aiMocks.runSelectionAction.mockResolvedValue('it is a thing')

    await useSelectionActions().runAction('explain')
    expect(store.showExplainCard).toBe(true)
    expect(store.explainText).toBe('it is a thing')
    expect(store.visible).toBe(true) // 浮条仍可见, 由模板按 !showExplainCard 隐藏

    const { closeExplainCard } = useSelectionActions()
    closeExplainCard()
    expect(store.visible).toBe(false)
    expect(store.showExplainCard).toBe(false)
  })

  it('AI 抛错进入 error 相位', async () => {
    setupFileTab('text')
    const host = document.createElement('div')
    document.body.appendChild(host)
    registerSelectionHost(host, {
      context: 'file',
      getSelectionInfo: () => ({ absStart: 0, absEnd: 4, text: 'text', startLine: 1, endLine: 1 }),
    })

    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: 'text', anchor: { top: 0, bottom: 0, left: 0, width: 0 } })
    aiMocks.runSelectionAction.mockRejectedValue(new Error('API key invalid'))

    await useSelectionActions().runAction('improve')
    expect(store.phase).toBe('error')
    expect(store.error).toBe('API key invalid')
  })
})
