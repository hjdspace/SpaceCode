/**
 * splitLayout store — 中央区分屏布局
 *
 * 使用二叉分割树（Binary Split Tree）表达分屏：
 *  - Leaf  节点：一个具体的可视面板（绑定到一个 centerTab，即会话或终端）
 *  - Split 节点：两个孩子 + 方向（row=左右 / column=上下）+ 比例
 *
 * 该结构天然支持单屏 / 左右 / 上下 / L 形 / 2×2 十字等所有 ≤ 4 leaf 组合。
 *
 * 阶段约定：
 *  - 阶段 2：默认仅 1 个 leaf（content kind='main'）→ 行为等价于改造前。
 *  - 阶段 3：splitPane / closePane / setSplitRatio 启用；最多 4 leaf。
 *  - 阶段 4：跨进程持久化 + activePane 同步 chatStore.currentSessionId。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/** Leaf 承载的内容类型 */
export type PaneContentKind = 'main' | 'session' | 'terminal' | 'empty'

export interface PaneContent {
  kind: PaneContentKind
  /**
   * 关联的 centerTab id。
   * - kind='main'    → null（兼容 App.vue 现有 `centerTabs[0]='chat'` 单屏模式，由 leaf 内部根据 appStore.activeCenterTab 决定具体内容）
   * - kind='session' → `session-<sessionId>` 或 'chat'
   * - kind='terminal'→ `terminal-<n>`
   * - kind='empty'   → null（等待用户挑选）
   */
  tabId: string | null
}

export interface PaneLeaf {
  type: 'leaf'
  id: string
  content: PaneContent
}

export interface PaneSplit {
  type: 'split'
  id: string
  direction: 'row' | 'column'
  /** 第一个孩子占整段长度的比例，0~1 */
  ratio: number
  children: [PaneNode, PaneNode]
}

export type PaneNode = PaneLeaf | PaneSplit

const STORAGE_KEY = 'app_split_layout'
const MAX_LEAVES = 4

function uuid(): string {
  // crypto.randomUUID 在所有目标 Electron 版本均可用
  try {
    return crypto.randomUUID()
  } catch {
    return 'pane-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

function makeLeaf(content: PaneContent = { kind: 'main', tabId: null }): PaneLeaf {
  return { type: 'leaf', id: uuid(), content }
}

function isLeaf(node: PaneNode): node is PaneLeaf {
  return node.type === 'leaf'
}

/** 收集所有 leaf 节点（前序遍历） */
export function collectLeaves(node: PaneNode, acc: PaneLeaf[] = []): PaneLeaf[] {
  if (isLeaf(node)) {
    acc.push(node)
  } else {
    collectLeaves(node.children[0], acc)
    collectLeaves(node.children[1], acc)
  }
  return acc
}

export function countLeaves(node: PaneNode): number {
  return collectLeaves(node).length
}

/** 找到指定 paneId 所在节点（DFS） */
export function findLeaf(root: PaneNode, paneId: string): PaneLeaf | null {
  if (isLeaf(root)) return root.id === paneId ? root : null
  return findLeaf(root.children[0], paneId) ?? findLeaf(root.children[1], paneId)
}

/** 找到 paneId 的父 split + 自身索引 0/1（用于 closePane 提升兄弟节点）。
 *  同时支持 leaf 和 split 节点 id。 */
function findParent(
  root: PaneNode,
  paneId: string,
  parent: PaneSplit | null = null,
  index = -1,
): { parent: PaneSplit | null; index: number } | null {
  // 匹配当前节点自身（可能是 split 节点）
  if (root.id === paneId) {
    return { parent, index }
  }
  if (isLeaf(root)) return null
  // root 是 split → 递归孩子
  for (let i = 0; i < 2; i++) {
    const r = findParent(root.children[i], paneId, root, i)
    if (r) return r
  }
  return null
}

/** 简单深拷贝（结构体里没有响应式 / Symbol，JSON 足够） */
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

function isValidNode(n: any): n is PaneNode {
  if (!n || typeof n !== 'object') return false
  if (n.type === 'leaf') {
    return typeof n.id === 'string' && !!n.content && typeof n.content.kind === 'string'
  }
  if (n.type === 'split') {
    return (
      typeof n.id === 'string' &&
      (n.direction === 'row' || n.direction === 'column') &&
      typeof n.ratio === 'number' &&
      Array.isArray(n.children) &&
      n.children.length === 2 &&
      isValidNode(n.children[0]) &&
      isValidNode(n.children[1])
    )
  }
  return false
}

function defaultRoot(): PaneLeaf {
  // 默认 leaf 内容为 'main'：意为「跟随 appStore.activeCenterTab 渲染」，等价于改造前的单屏行为。
  return makeLeaf({ kind: 'main', tabId: null })
}

function loadRootFromStorage(): PaneNode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultRoot()
    const parsed = JSON.parse(raw)
    if (parsed && isValidNode(parsed)) {
      // 限制 leaf ≤ 4，保护：超出则丢弃
      if (countLeaves(parsed) <= MAX_LEAVES) return parsed
    }
  } catch { /* ignore */ }
  return defaultRoot()
}

export const useSplitLayoutStore = defineStore('splitLayout', () => {
  const root = ref<PaneNode>(loadRootFromStorage())
  const activePaneId = ref<string | null>(isLeaf(root.value) ? root.value.id : (collectLeaves(root.value)[0]?.id ?? null))

  // ─── Derived ────────────────────────────────────────────────────────────
  const leaves = computed<PaneLeaf[]>(() => collectLeaves(root.value))
  const leafCount = computed(() => leaves.value.length)
  const canSplit = computed(() => leafCount.value < MAX_LEAVES)
  const isSingleLeaf = computed(() => leafCount.value === 1)
  const activePane = computed<PaneLeaf | null>(() => {
    if (!activePaneId.value) return null
    return findLeaf(root.value, activePaneId.value)
  })

  // ─── Persistence ────────────────────────────────────────────────────────
  let _saveScheduled = false
  function saveSoon() {
    if (_saveScheduled) return
    _saveScheduled = true
    setTimeout(() => {
      _saveScheduled = false
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(root.value))
      } catch { /* ignore */ }
    }, 50)
  }

  // ─── Mutations ──────────────────────────────────────────────────────────

  /** 设置整棵树（持久化、校验） */
  function setRoot(node: PaneNode) {
    if (!isValidNode(node)) return
    if (countLeaves(node) > MAX_LEAVES) return
    root.value = clone(node)
    if (!activePaneId.value || !findLeaf(root.value, activePaneId.value)) {
      activePaneId.value = collectLeaves(root.value)[0]?.id ?? null
    }
    saveSoon()
  }

  /** 重置为单 leaf 默认布局 */
  function resetToSingle(content?: PaneContent) {
    const leaf = makeLeaf(content ?? { kind: 'main', tabId: null })
    root.value = leaf
    activePaneId.value = leaf.id
    saveSoon()
  }

  /** 替换 leaf 的内容（用于把某个 Tab 放入指定 pane） */
  function setPaneContent(paneId: string, content: PaneContent) {
    const leaf = findLeaf(root.value, paneId)
    if (!leaf) return
    leaf.content = clone(content)
    saveSoon()
  }

  function setActivePane(paneId: string) {
    if (findLeaf(root.value, paneId)) {
      activePaneId.value = paneId
    }
  }

  /**
   * 在指定 leaf 处插入分屏：当前 leaf 与新 leaf 成为同一个 split 的两个孩子。
   * - position='right'/'bottom' → 新 leaf 在第二个孩子
   * - position='left' /'top'    → 新 leaf 在第一个孩子
   * 已达最大 leaf 数时返回 null。
   */
  function splitPane(
    paneId: string,
    position: 'left' | 'right' | 'top' | 'bottom',
    newContent: PaneContent = { kind: 'empty', tabId: null },
  ): string | null {
    if (!canSplit.value) return null
    const target = findLeaf(root.value, paneId)
    if (!target) return null

    const direction: 'row' | 'column' = (position === 'left' || position === 'right') ? 'row' : 'column'
    const newLeaf = makeLeaf(newContent)
    const insertFirst = position === 'left' || position === 'top'

    const newSplit: PaneSplit = {
      type: 'split',
      id: uuid(),
      direction,
      ratio: 0.5,
      children: insertFirst ? [newLeaf, target] : [target, newLeaf],
    }

    if (root.value === target || (isLeaf(root.value) && root.value.id === target.id)) {
      root.value = newSplit
    } else {
      const found = findParent(root.value, paneId)
      if (!found || !found.parent) return null
      found.parent.children[found.index] = newSplit
    }

    activePaneId.value = newLeaf.id
    saveSoon()
    return newLeaf.id
  }

  /** 关闭 pane：移除 leaf，把兄弟节点提升至父节点位置（split → leaf 或保留 split）。
   *
   *  注意：`findParent` 现在同时匹配 leaf 和 split 节点，因此
   *  `findParent(root.value, found.parent.id)` 可以正确找到祖父 split。 */
  function closePane(paneId: string) {
    const found = findParent(root.value, paneId)
    if (!found) return
    if (!found.parent) {
      // 关闭最后一个 leaf → 回退到默认 root
      resetToSingle()
      return
    }
    const sibling = found.parent.children[1 - found.index]
    // 找祖父并替换
    const grand = findParent(root.value, found.parent.id)
    if (grand && grand.parent) {
      grand.parent.children[grand.index] = sibling
    } else {
      // parent 就是根
      root.value = sibling
    }
    // 修正 activePane
    if (activePaneId.value === paneId) {
      activePaneId.value = collectLeaves(root.value)[0]?.id ?? null
    }
    saveSoon()
  }

  /** 调整 split 比例（拖拽分隔条） */
  function setSplitRatio(splitId: string, ratio: number) {
    const r = Math.min(0.9, Math.max(0.1, ratio))
    const walk = (n: PaneNode): boolean => {
      if (isLeaf(n)) return false
      if (n.id === splitId) {
        n.ratio = r
        return true
      }
      return walk(n.children[0]) || walk(n.children[1])
    }
    if (walk(root.value)) saveSoon()
  }

  /**
   * 当 centerTab 被关闭时调用，把所有引用该 tabId 的 leaf 重置为 empty。
   * 如果重置后所有 leaf 都变成 empty → 恢复为默认 root（kind='main'），
   * 避免用户陷入「空 pane 死锁」。
   */
  function clearLeavesForTab(tabId: string) {
    let changed = false
    for (const leaf of collectLeaves(root.value)) {
      if (leaf.content.tabId === tabId) {
        leaf.content = { kind: 'empty', tabId: null }
        changed = true
      }
    }
    if (changed) {
      // 检查是否所有 leaf 都是 empty
      const allEmpty = collectLeaves(root.value).every(l => l.content.kind === 'empty')
      if (allEmpty) {
        resetToSingle()
        return
      }
      // 修正 activePane：如果指向被清空的 leaf 则跳转
      const pa = activePaneId.value
      if (pa && findLeaf(root.value, pa)?.content.kind === 'empty') {
        const next = collectLeaves(root.value).find(l => l.content.kind !== 'empty')
        activePaneId.value = next?.id ?? null
      }
      saveSoon()
    }
  }

  return {
    // state
    root,
    activePaneId,
    // getters
    leaves,
    leafCount,
    canSplit,
    isSingleLeaf,
    activePane,
    // mutations
    setRoot,
    resetToSingle,
    setPaneContent,
    setActivePane,
    splitPane,
    closePane,
    setSplitRatio,
    clearLeavesForTab,
    // constants
    MAX_LEAVES,
  }
})
