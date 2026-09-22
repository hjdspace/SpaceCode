/**
 * selectionBar store 测试 — 相位机与单实例规则。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSelectionBarStore } from '@/stores/selectionBar'

const anchor = { top: 10, bottom: 30, left: 100, width: 200 }

describe('selectionBar store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初始状态不可见', () => {
    const store = useSelectionBarStore()
    expect(store.visible).toBe(false)
    expect(store.phase).toBe('idle')
    expect(store.anchor).toBeNull()
  })

  it('open 设置状态并重置相位/错误/卡片', () => {
    const store = useSelectionBarStore()
    store.setBusy('selectionActions.busyImprove')
    store.setError('boom')
    store.open({ context: 'chat', selectedText: 'hello world', anchor })
    expect(store.visible).toBe(true)
    expect(store.context).toBe('chat')
    expect(store.selectedText).toBe('hello world')
    expect(store.anchor).toEqual(anchor)
    expect(store.phase).toBe('idle')
    expect(store.error).toBe('')
    expect(store.showExplainCard).toBe(false)
    expect(store.expanded).toBe(false)
    expect(store.draft).toBe('')
  })

  it('open 在浮条已打开时切换场景(单实例规则)', () => {
    const store = useSelectionBarStore()
    store.open({ context: 'chat', selectedText: 'first selection', anchor })
    store.setBusy('selectionActions.busyExplain')
    store.open({ context: 'file', selectedText: 'second selection', anchor })
    expect(store.context).toBe('file')
    expect(store.selectedText).toBe('second selection')
    expect(store.phase).toBe('idle')
    expect(store.busyKey).toBe('')
  })

  it('close 清空全部状态', () => {
    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: 'text', anchor })
    store.setExplain('explanation')
    store.close()
    expect(store.visible).toBe(false)
    expect(store.anchor).toBeNull()
    expect(store.selectedText).toBe('')
    expect(store.showExplainCard).toBe(false)
    expect(store.explainText).toBe('')
  })

  it('相位流转 idle → busy → result', () => {
    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: 'text', anchor })
    store.setBusy('selectionActions.busyImprove')
    expect(store.phase).toBe('busy')
    expect(store.busyKey).toBe('selectionActions.busyImprove')
    store.setResult()
    expect(store.phase).toBe('result')
    expect(store.busyKey).toBe('')
  })

  it('setError 覆盖 busy 并记录错误信息', () => {
    const store = useSelectionBarStore()
    store.open({ context: 'file', selectedText: 'text', anchor })
    store.setBusy('selectionActions.busyImprove')
    store.setError('API failed')
    expect(store.phase).toBe('error')
    expect(store.error).toBe('API failed')
    expect(store.busyKey).toBe('')
  })

  it('setExplain 显示卡片, closeExplainCard 清空', () => {
    const store = useSelectionBarStore()
    store.setExplain('an explanation')
    expect(store.showExplainCard).toBe(true)
    expect(store.explainText).toBe('an explanation')
    store.closeExplainCard()
    expect(store.showExplainCard).toBe(false)
    expect(store.explainText).toBe('')
  })
})
