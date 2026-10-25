/**
 * contenteditable 光标快照 —— 记录选区在节点树里的路径与偏移。
 *
 * 不用文本偏移：草稿里可能有 chip 等非文本节点，同一段 DOM 恢复后
 * 按子节点下标回放最准确；恢复失败（节点结构变了）时静默放弃。
 */
export interface CaretSnapshot {
  /** 从编辑器根节点到 startContainer 的子节点下标链。 */
  path: number[]
  offset: number
}

export function captureCaret(root: HTMLElement): CaretSnapshot | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const container = range.startContainer
  if (container !== root && !root.contains(container)) return null

  return { path: nodePath(root, container), offset: range.startOffset }
}

export function restoreCaret(root: HTMLElement, snapshot: CaretSnapshot): void {
  const container = resolvePath(root, snapshot.path)
  if (!container) return

  const offset = Math.min(Math.max(snapshot.offset, 0), nodeLength(container))
  const range = document.createRange()
  range.setStart(container, offset)
  range.collapse(true)

  const selection = window.getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

function nodePath(root: Node, node: Node): number[] {
  const path: number[] = []
  let current: Node | null = node
  while (current && current !== root) {
    const parent: Node | null = current.parentNode
    if (!parent) return []
    let index = 0
    for (let child = parent.firstChild; child; child = child.nextSibling) {
      if (child === current) break
      index++
    }
    path.unshift(index)
    current = parent
  }
  return path
}

function resolvePath(root: Node, path: number[]): Node | null {
  let current: Node = root
  for (const index of path) {
    const next = current.childNodes[index]
    if (!next) return null
    current = next
  }
  return current
}

function nodeLength(node: Node): number {
  return node.nodeType === Node.TEXT_NODE ? (node.textContent?.length ?? 0) : node.childNodes.length
}
