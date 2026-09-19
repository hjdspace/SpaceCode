/**
 * 项目记忆文件的纯逻辑：文件树构建、搜索过滤、Markdown 内部链接解析。
 *
 * 与 UI 无关，输入输出皆为普通数据，便于单独测试。
 */
import type { MemoryFile, MemoryProject } from '@/types/memory'

/** 记忆目录的索引文件名。 */
export const DEFAULT_MEMORY_PATH = 'MEMORY.md'

export type MemoryTreeNode =
  | {
      kind: 'folder'
      id: string
      name: string
      path: string
      fileCount: number
      children: MemoryTreeNode[]
    }
  | {
      kind: 'file'
      id: string
      name: string
      path: string
      file: MemoryFile
    }

type MutableFolderNode = Extract<MemoryTreeNode, { kind: 'folder' }>

/** 项目标签取路径最后两段，避免多项目同名时难以区分。 */
export function projectDisplayName(label: string): string {
  const normalized = label.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
  return parts[0] ?? label
}

export function fileNameFromPath(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** 预览用：剥掉 YAML frontmatter，正文才需要渲染。 */
export function stripMarkdownFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content
  const end = content.indexOf('\n---', 3)
  if (end < 0) return content
  const after = content.indexOf('\n', end + 4)
  return after < 0 ? '' : content.slice(after + 1).trimStart()
}

function normalizeSearch(value: string): string {
  return value.toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/').trim()
}

/**
 * 搜索项目：命中项目自身的标签/目录/标识，
 * 或命中当前已选项目的记忆文件（文件名、路径、描述、类型）。
 */
export function filterMemoryProjects(
  projects: MemoryProject[],
  query: string,
  selectedProjectId: string | null,
  selectedProjectFiles: MemoryFile[],
): MemoryProject[] {
  const normalized = normalizeSearch(query)
  if (!normalized) return projects
  return projects.filter(
    (project) =>
      normalizeSearch(`${project.label} ${project.memoryDir} ${project.id}`).includes(normalized) ||
      (project.id === selectedProjectId &&
        selectedProjectFiles.some((file) =>
          normalizeSearch(`${file.title} ${file.path} ${file.description ?? ''} ${file.type ?? ''}`).includes(
            normalized,
          ),
        )),
  )
}

export function filterMemoryFiles(files: MemoryFile[], query: string): MemoryFile[] {
  const normalized = normalizeSearch(query)
  if (!normalized) return files
  return files.filter((file) =>
    normalizeSearch(`${file.title} ${file.path} ${file.description ?? ''} ${file.type ?? ''}`).includes(normalized),
  )
}

/**
 * 按相对路径构建文件树：目录在前、索引文件优先、其余按名称不区分大小写排序。
 */
export function buildMemoryFileTree(files: MemoryFile[]): MemoryTreeNode[] {
  const root: MutableFolderNode = {
    kind: 'folder',
    id: '__root__',
    name: '__root__',
    path: '',
    fileCount: 0,
    children: [],
  }

  const folders = new Map<string, MutableFolderNode>([['', root]])
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean)
    let parent = root
    parts.slice(0, -1).forEach((part, index) => {
      const folderPath = parts.slice(0, index + 1).join('/')
      let folder = folders.get(folderPath)
      if (!folder) {
        folder = {
          kind: 'folder',
          id: `folder:${folderPath}`,
          name: part,
          path: folderPath,
          fileCount: 0,
          children: [],
        }
        folders.set(folderPath, folder)
        parent.children.push(folder)
      }
      folder.fileCount += 1
      parent = folder
    })
    parent.children.push({
      kind: 'file',
      id: `file:${file.path}`,
      name: parts[parts.length - 1] ?? file.name,
      path: file.path,
      file,
    })
  }

  sortMemoryTree(root.children)
  return root.children
}

function sortMemoryTree(nodes: MemoryTreeNode[]): void {
  nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    const aIndex = a.kind === 'file' ? a.file.isIndex : false
    const bIndex = b.kind === 'file' ? b.file.isIndex : false
    if (aIndex !== bIndex) return aIndex ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
  for (const node of nodes) {
    if (node.kind === 'folder') sortMemoryTree(node.children)
  }
}

function normalizeFsPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * 把绝对路径还原成「项目 + 相对路径」，用于外部（如会话里点开记忆文件）
 * 直接定位到某个文件。
 */
export function resolveMemoryFileTarget(
  projects: MemoryProject[],
  absolutePath: string,
): { projectId: string; path: string } | null {
  const target = normalizeFsPath(absolutePath)
  for (const project of projects) {
    const memoryDir = normalizeFsPath(project.memoryDir)
    if (!memoryDir) continue
    if (target === memoryDir) {
      return { projectId: project.id, path: DEFAULT_MEMORY_PATH }
    }
    if (target.startsWith(`${memoryDir}/`)) {
      return {
        projectId: project.id,
        path: target.slice(memoryDir.length + 1),
      }
    }
  }
  return null
}

function safeDecodeUriComponent(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function stripMarkdownLinkSuffix(value: string): string {
  return value.split('#')[0]?.split('?')[0]?.trim() ?? ''
}

function findMemoryFileByPath(files: MemoryFile[], path: string): string | null {
  const normalized = normalizeFsPath(path)
  return files.find((file) => normalizeFsPath(file.path) === normalized)?.path ?? null
}

/**
 * 解析预览里被点击的 Markdown 链接，返回应打开的记忆文件相对路径。
 *
 * 支持 file:// 绝对路径、记忆目录下的绝对路径，以及相对于当前文件的相对路径；
 * 锚点、外部链接、非 .md 目标、越出记忆文件集合的目标一律返回 null（交给默认行为）。
 */
export function resolveMarkdownMemoryLink(
  href: string,
  currentPath: string,
  projectMemoryDir: string | undefined,
  files: MemoryFile[],
): string | null {
  const rawHref = safeDecodeUriComponent(href.trim())
  if (!rawHref || rawHref.startsWith('#')) return null

  let target = rawHref
  try {
    const url = new URL(rawHref)
    if (url.protocol !== 'file:') return null
    target = url.pathname
  } catch {
    if (/^[a-z][a-z\d+.-]*:/i.test(rawHref)) return null
  }

  target = stripMarkdownLinkSuffix(target)
  if (!target || !target.endsWith('.md')) return null

  const absoluteTarget = normalizeFsPath(target)
  const memoryDir = projectMemoryDir ? normalizeFsPath(projectMemoryDir) : ''
  if (memoryDir) {
    if (absoluteTarget === memoryDir) return DEFAULT_MEMORY_PATH
    if (absoluteTarget.startsWith(`${memoryDir}/`)) {
      return findMemoryFileByPath(files, absoluteTarget.slice(memoryDir.length + 1))
    }
  }

  if (target.startsWith('/')) return null

  const currentParts = currentPath.split('/').filter(Boolean)
  const baseParts = currentParts.slice(0, -1)
  const resolvedParts: string[] = []
  for (const part of [...baseParts, ...target.split('/')]) {
    if (!part || part === '.') continue
    if (part === '..') {
      resolvedParts.pop()
      continue
    }
    resolvedParts.push(part)
  }

  return findMemoryFileByPath(files, resolvedParts.join('/'))
}
