/**
 * 选中文字浮动操作条 — 全局单例控制器。
 * 负责选区检测、锚点计算、AI 编排与改写簿记(Keep/Discard/Try again)。
 * UI 状态在 selectionBar store, 非响应式簿记在本模块闭包中。
 */

import { onBeforeUnmount } from 'vue'
import { useSelectionBarStore, type SelectionBarAnchor } from '@/stores/selectionBar'
import { useAppStore } from '@/stores/app'
import { runSelectionAction, type SelectionActionType } from '@/services/selectionAI'
import { i18n } from '@/i18n'

/** 文件查看器提供的选区在源文件中的精确位置 */
export interface CodeSelectionInfo {
  /** 选区起点在文件内容中的绝对偏移; -1 表示无法定位(需回退字符串匹配) */
  absStart: number
  absEnd: number
  text: string
  startLine: number
  endLine: number
}

export interface SelectionHostOptions {
  context: 'chat' | 'file'
  /** file 场景: 返回选区在源文件中的位置; 不提供则仅支持字符串回退定位 */
  getSelectionInfo?: () => CodeSelectionInfo | null
  /** CodeViewer: 改写应用后高亮受影响行 */
  flashRange?: (startLine: number, endLine: number) => void
}

interface SelectionHost {
  el: HTMLElement
  options: SelectionHostOptions
}

interface PendingRewrite {
  filePath: string
  originalContent: string
  appliedStart: number
  appliedEnd: number
  type: SelectionActionType
  instruction?: string
  inputText: string
  isCode: boolean
}

const hosts = new Set<SelectionHost>()
let pending: PendingRewrite | null = null
let lastAction: { type: SelectionActionType; instruction?: string } | null = null
let selectionChangeHandler: (() => void) | null = null
let debounceTimer: ReturnType<typeof setTimeout> | undefined

function t(key: string): string {
  return i18n.global.t(key)
}

function detectSelection(host: SelectionHost) {
  const store = useSelectionBarStore()
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
  const range = sel.getRangeAt(0)
  if (!host.el.contains(range.commonAncestorContainer)) return
  const text = sel.toString()
  if (text.trim().length < 2) return
  // 选区在输入类元素内不触发
  const startEl = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement
  if (startEl?.closest('input, textarea, [contenteditable]')) return

  const rects = range.getClientRects()
  const lastLine = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
  if (lastLine.width === 0 && lastLine.height === 0) return
  const anchor: SelectionBarAnchor = {
    top: lastLine.top,
    bottom: lastLine.bottom,
    left: lastLine.left,
    width: lastLine.width,
  }
  store.open({ context: host.options.context, selectedText: text, anchor })
}

function isSelectionInsideAnyHost(): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  for (const host of hosts) {
    if (host.el.contains(range.commonAncestorContainer)) return true
  }
  return false
}

function ensureSelectionChangeListener() {
  if (selectionChangeHandler) return
  selectionChangeHandler = () => {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined
      const store = useSelectionBarStore()
      // busy/result 相位浮条不再依赖实时选区
      if (!store.visible || store.phase !== 'idle') return
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !isSelectionInsideAnyHost()) {
        store.close()
      }
    }, 100)
  }
  document.addEventListener('selectionchange', selectionChangeHandler)
}

function removeSelectionChangeListener() {
  if (!selectionChangeHandler) return
  document.removeEventListener('selectionchange', selectionChangeHandler)
  selectionChangeHandler = null
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer)
    debounceTimer = undefined
  }
}

/** 注册选区 host; 返回清理函数(onBeforeUnmount 调用) */
export function registerSelectionHost(el: HTMLElement, options: SelectionHostOptions): () => void {
  const host: SelectionHost = { el, options }
  hosts.add(host)
  ensureSelectionChangeListener()

  const onMouseUp = () => detectSelection(host)
  const onScroll = () => {
    const store = useSelectionBarStore()
    if (store.visible && store.phase === 'idle') store.close()
  }
  el.addEventListener('mouseup', onMouseUp)
  el.addEventListener('scroll', onScroll, { passive: true })

  return () => {
    el.removeEventListener('mouseup', onMouseUp)
    el.removeEventListener('scroll', onScroll)
    hosts.delete(host)
    if (hosts.size === 0) removeSelectionChangeListener()
  }
}

/** 非组件上下文使用(如 App.vue 挂载的浮条组件仍需在 setup 中调用) */
export function useSelectionActions() {
  const store = useSelectionBarStore()
  const appStore = useAppStore()

  function addToConversation() {
    appStore.pushToInput({ quote: { id: crypto.randomUUID(), text: store.selectedText } })
    store.close()
  }

  function locateInSource(content: string, text: string): { start: number; end: number } | null {
    const trimmed = text.trim()
    let idx = content.indexOf(trimmed)
    if (idx >= 0) return { start: idx, end: idx + trimmed.length }
    idx = content.indexOf(text)
    if (idx >= 0) return { start: idx, end: idx + text.length }
    return null
  }

  async function runAction(type: SelectionActionType, instruction?: string) {
    lastAction = { type, instruction }
    const busyKey = type === 'explain' ? 'selectionActions.busyExplain'
      : type === 'improve' ? 'selectionActions.busyImprove'
      : type === 'shorten' ? 'selectionActions.busyShorten'
      : type === 'tone' ? 'selectionActions.busyTone'
      : type === 'grammar' ? 'selectionActions.busyGrammar'
      : 'selectionActions.busyCustom'

    const isFileContext = store.context === 'file'
    const host = [...hosts].find(h => h.options.context === store.context)

    try {
      if (!isFileContext) {
        store.setBusy(busyKey)
        const result = await runSelectionAction({
          type,
          selectedText: store.selectedText,
          isCode: false,
          locale: i18n.global.locale.value,
        })
        // 仅设卡片状态: 浮条模板以 !showExplainCard 隐藏自身, 关闭卡片时才整体 close
        store.setExplain(result)
        return
      }

      const filePath = appStore.currentFile?.path
      const content = appStore.currentFile?.content
      if (!filePath || content === undefined) {
        store.setError(t('selectionActions.errorFailed'))
        return
      }

      // Try again: 替换当前已应用区间; 首次: 定位选区
      let start: number
      let end: number
      let inputText: string
      if (pending && pending.filePath === filePath) {
        start = pending.appliedStart
        end = pending.appliedEnd
        inputText = pending.inputText
      } else {
        const info = host?.options.getSelectionInfo?.()
        if (info && info.absStart >= 0 && info.absEnd > info.absStart) {
          start = info.absStart
          end = info.absEnd
          inputText = info.text
        } else {
          const located = locateInSource(content, store.selectedText)
          if (!located) {
            store.setError(t('selectionActions.errorLocate'))
            return
          }
          start = located.start
          end = located.end
          inputText = store.selectedText
        }
      }

      store.setBusy(busyKey)
      const result = await runSelectionAction({
        type,
        selectedText: inputText,
        customInstruction: instruction,
        isCode: true,
        locale: i18n.global.locale.value,
        fileName: appStore.currentFile?.name,
      })
      if (!result.trim()) {
        store.setError(t('selectionActions.errorFailed'))
        return
      }

      if (!pending || pending.filePath !== filePath) {
        pending = {
          filePath,
          originalContent: content,
          appliedStart: start,
          appliedEnd: end,
          type,
          instruction,
          inputText,
          isCode: true,
        }
      }

      const newContent = content.slice(0, start) + result + content.slice(end)
      appStore.updateOpenFileContent(filePath, newContent)
      pending.appliedStart = start
      pending.appliedEnd = start + result.length
      pending.type = type
      pending.instruction = instruction

      const startLine = newContent.slice(0, start).split('\n').length
      const endLine = startLine + result.split('\n').length - 1
      host?.options.flashRange?.(startLine, endLine)
      store.setResult()
    } catch (err) {
      store.setError(err instanceof Error ? err.message : t('selectionActions.errorFailed'))
    }
  }

  function submitDraft() {
    const instruction = store.draft.trim()
    if (!instruction) return
    store.draft = ''
    runAction('custom', instruction)
  }

  function keep() {
    if (!pending) {
      store.close()
      return
    }
    const current = appStore.currentFile
    if (!current || current.path !== pending.filePath) {
      store.close()
      return
    }
    return apiWrite(pending.filePath, current.content)
  }

  async function apiWrite(filePath: string, content: string) {
    const { api } = await import('@/services/electronAPI')
    try {
      const result = await api.writeFile(filePath, content)
      if (result.success) {
        pending = null
        window.dispatchEvent(new CustomEvent('refresh-file-tree'))
        store.close()
      } else {
        store.setError(result.error || t('selectionActions.errorFailed'))
      }
    } catch (err) {
      store.setError(err instanceof Error ? err.message : t('selectionActions.errorFailed'))
    }
  }

  function discard() {
    if (pending) {
      appStore.updateOpenFileContent(pending.filePath, pending.originalContent)
      pending = null
    }
    store.close()
  }

  function tryAgain() {
    if (lastAction) {
      runAction(lastAction.type, lastAction.instruction)
    }
  }

  function closeExplainCard() {
    store.closeExplainCard()
    store.close()
  }

  return {
    addToConversation,
    runAction,
    submitDraft,
    keep,
    discard,
    tryAgain,
    closeExplainCard,
  }
}

/** 供测试使用: 重置模块级簿记状态 */
export function _resetSelectionActionsState() {
  hosts.clear()
  pending = null
  lastAction = null
  removeSelectionChangeListener()
}
