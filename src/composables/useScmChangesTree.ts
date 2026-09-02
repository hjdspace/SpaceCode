/**
 * SCM changes tree building — pure functions converting a flat change list
 * into a collapsible directory tree (VSCode SCM "tree view" mode).
 */
import type { ScmFile } from '@/stores/scm'

export interface ChangeTreeNode {
  name: string
  /** Normalized forward-slash path (file path for files, dir path for dirs). */
  path: string
  type: 'file' | 'dir'
  children?: ChangeTreeNode[]
  file?: ScmFile
  isStaged?: boolean
}

export interface FlatChangeItem {
  node: ChangeTreeNode
  depth: number
}

export interface ChangeTreeEntry {
  file: ScmFile
  isStaged: boolean
}

/**
 * Build a directory tree from change entries. Directory nodes are shared
 * (same dir path → same node), dirs sort before files, everything alphabetical.
 */
export function buildChangeTree(entries: ChangeTreeEntry[]): ChangeTreeNode[] {
  const dirNodes = new Map<string, ChangeTreeNode>()
  const roots: ChangeTreeNode[] = []

  const getOrCreateDir = (dirPath: string): ChangeTreeNode => {
    const existing = dirNodes.get(dirPath)
    if (existing) return existing
    const slashIdx = dirPath.lastIndexOf('/')
    const node: ChangeTreeNode = {
      name: slashIdx === -1 ? dirPath : dirPath.slice(slashIdx + 1),
      path: dirPath,
      type: 'dir',
      children: [],
    }
    dirNodes.set(dirPath, node)
    if (slashIdx === -1) {
      roots.push(node)
    } else {
      getOrCreateDir(dirPath.slice(0, slashIdx)).children!.push(node)
    }
    return node
  }

  for (const { file, isStaged } of entries) {
    const normalized = file.path.replace(/\\/g, '/')
    const slashIdx = normalized.lastIndexOf('/')
    const fileName = slashIdx === -1 ? normalized : normalized.slice(slashIdx + 1)
    const fileNode: ChangeTreeNode = {
      name: fileName,
      path: normalized,
      type: 'file',
      file,
      isStaged,
    }
    if (slashIdx === -1) {
      roots.push(fileNode)
    } else {
      getOrCreateDir(normalized.slice(0, slashIdx)).children!.push(fileNode)
    }
  }

  const sortNodes = (nodes: ChangeTreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.children) sortNodes(node.children)
    }
  }
  sortNodes(roots)

  return roots
}

/**
 * Flatten the tree for rendering/keyboard navigation, skipping children of
 * collapsed directories.
 */
export function flattenVisibleTree(
  nodes: ChangeTreeNode[],
  collapsedDirs: Set<string>,
  depth = 0
): FlatChangeItem[] {
  const out: FlatChangeItem[] = []
  for (const node of nodes) {
    out.push({ node, depth })
    if (node.type === 'dir' && !collapsedDirs.has(node.path)) {
      out.push(...flattenVisibleTree(node.children ?? [], collapsedDirs, depth + 1))
    }
  }
  return out
}
