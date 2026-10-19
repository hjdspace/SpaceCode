import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  collectLeaves,
  contentForTab,
  useSplitLayoutStore,
  type PaneContent,
  type PaneNode,
} from '../splitLayout'

function leaf(id: string, content: PaneContent): PaneNode {
  return { type: 'leaf', id, content }
}

function split(id: string, children: [PaneNode, PaneNode], direction: 'row' | 'column' = 'row'): PaneNode {
  return { type: 'split', id, direction, ratio: 0.5, children }
}

const sessionContent = (tabId: string): PaneContent => ({ kind: 'session', tabId })

/** 侧边栏传入的「切换会话之前」的全局标签快照 */
const globalTab = (activeCenterTab = 'chat', currentSessionId = '') => ({ activeCenterTab, currentSessionId })

function contentOf(store: ReturnType<typeof useSplitLayoutStore>, paneId: string | null): PaneContent | undefined {
  if (!paneId) return undefined
  return collectLeaves(store.root).find(l => l.id === paneId)?.content
}

describe('contentForTab', () => {
  it('maps terminal tabs to terminal panes', () => {
    expect(contentForTab('terminal-1', '')).toEqual({ kind: 'terminal', tabId: 'terminal-1' })
  })

  it('maps session and orchestration tabs to session panes', () => {
    expect(contentForTab('session-abc', '')).toEqual(sessionContent('session-abc'))
    expect(contentForTab('orchestration-1', '')).toEqual(sessionContent('orchestration-1'))
  })

  it('expands the "chat" alias into the session it actually follows', () => {
    expect(contentForTab('chat', 'current-1')).toEqual(sessionContent('session-current-1'))
    // 没有当前会话时保持原样，由 ChatPanel 回退到 current
    expect(contentForTab('chat', '')).toEqual(sessionContent('chat'))
  })
})

describe('splitLayout.openSessionPane', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('splits a single main pane to the right and freezes its own content', () => {
    const store = useSplitLayoutStore()
    // 默认 root 为 kind='main'（跟随全局 activeCenterTab）

    const paneId = store.openSessionPane('session-new', globalTab('session-old', 'old'))

    expect(store.leafCount).toBe(2)
    expect(contentOf(store, paneId)).toEqual(sessionContent('session-new'))
    // 基准 pane 必须固化成具体内容，否则两个 pane 会一起跟随全局状态
    expect(store.leaves.find(l => l.id !== paneId)?.content).toEqual(sessionContent('session-old'))
    expect(store.activePaneId).toBe(paneId)
  })

  it('freezes a main pane on the chat tab to the current session', () => {
    const store = useSplitLayoutStore()

    const paneId = store.openSessionPane('session-new', globalTab('chat', 'old'))

    expect(contentOf(store, paneId)).toEqual(sessionContent('session-new'))
    expect(store.leaves.find(l => l.id !== paneId)?.content).toEqual(sessionContent('session-old'))
  })

  it('freezes a terminal main pane as a terminal before splitting', () => {
    const store = useSplitLayoutStore()

    const paneId = store.openSessionPane('session-new', globalTab('terminal-1'))

    expect(store.leaves.find(l => l.id !== paneId)?.content).toEqual({ kind: 'terminal', tabId: 'terminal-1' })
  })

  it('adds a new pane when the session is not visible yet', () => {
    const store = useSplitLayoutStore()
    store.setRoot(split('s0', [leaf('a', sessionContent('session-1')), leaf('b', sessionContent('session-2'))]))
    store.setActivePane('a')

    const paneId = store.openSessionPane('session-3', globalTab('session-1', '1'))

    expect(store.leafCount).toBe(3)
    expect(contentOf(store, paneId)).toEqual(sessionContent('session-3'))
    expect(contentOf(store, 'a')).toEqual(sessionContent('session-1'))
    expect(contentOf(store, 'b')).toEqual(sessionContent('session-2'))
  })

  it('focuses the pane already showing the session instead of opening a duplicate', () => {
    const store = useSplitLayoutStore()
    store.setRoot(split('s0', [leaf('a', sessionContent('session-1')), leaf('b', sessionContent('session-2'))]))
    store.setActivePane('a')

    const paneId = store.openSessionPane('session-2', globalTab('session-1', '1'))

    expect(paneId).toBe('b')
    expect(store.leafCount).toBe(2)
    expect(store.activePaneId).toBe('b')
  })

  it('fills an empty pane rather than splitting it', () => {
    const store = useSplitLayoutStore()
    store.setRoot(split('s0', [leaf('a', { kind: 'empty', tabId: null }), leaf('b', sessionContent('session-1'))]))
    store.setActivePane('a')

    const paneId = store.openSessionPane('session-2', globalTab())

    expect(paneId).toBe('a')
    expect(store.leafCount).toBe(2)
    expect(contentOf(store, 'a')).toEqual(sessionContent('session-2'))
    expect(store.activePaneId).toBe('a')
  })

  it('replaces the active pane content once the leaf limit is reached', () => {
    const store = useSplitLayoutStore()
    store.setRoot(split('s0', [
      split('s1', [leaf('a', sessionContent('session-1')), leaf('b', sessionContent('session-2'))]),
      split('s2', [leaf('c', sessionContent('session-3')), leaf('d', sessionContent('session-4'))]),
    ]))
    store.setActivePane('a')
    expect(store.canSplit).toBe(false)

    const paneId = store.openSessionPane('session-5', globalTab('session-1', '1'))

    expect(paneId).toBe('a')
    expect(store.leafCount).toBe(4)
    expect(contentOf(store, 'a')).toEqual(sessionContent('session-5'))
  })
})
