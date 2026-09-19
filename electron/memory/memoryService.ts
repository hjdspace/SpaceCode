/**
 * Memory Service — 项目记忆文件的读取与编辑（主进程）。
 *
 * 记忆目录布局：`<claude 配置目录>/projects/<projectId>/memory/`
 *   - projectId = sanitizePath(git 仓库根 ?? 工作目录)，sanitize 规则与
 *     会话记录一致（非字母数字一律替换为 '-'），因此同一个项目的会话
 *     JSONL 与 memory/ 落在同一个项目目录下；
 *   - 目录内全部为 Markdown 文件，`MEMORY.md` 是索引，子目录可以任意嵌套。
 *
 * 安全与一致性约束：
 *   - projectId / 相对路径都做白名单校验，路径解析后必须仍落在记忆目录内
 *     （存在时用 realpath 判定，防止符号链接逃逸）；
 *   - 写入走「同目录临时文件 + rename」的原子替换，并按目标文件路径串行化，
 *     避免并发覆盖；
 *   - 保存可携带读取时的 revision（mtime + size），不一致则拒绝写入。
 */
import { ipcMain } from 'electron'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { memoryChannels } from '@/shared/channels/memory'
import { registerHandlers } from '@/shared/handlerRegistry'
import { parseYamlFrontMatter } from '../infra/frontMatter'
import { getGitRoot } from '../git/gitService'
import { warn } from '../infra/logger'
import type {
  MemoryFile,
  MemoryFileDetail,
  MemoryFileRevision,
  MemoryProject,
  MemorySaveInput,
} from '@/types/memory'

/** 单个记忆文件的可编辑上限；超过则只展示元数据，不允许读取/写入。 */
const MAX_MEMORY_FILE_BYTES = 512 * 1024
/** 单个项目的记忆文件扫描上限（同时用于文件计数）。 */
const MAX_MEMORY_FILES = 500
const MAX_PROJECT_ID_BYTES = 1024
const MAX_RELATIVE_PATH_BYTES = 4096
const MAX_PATH_SEGMENT_BYTES = 255
/** 记忆索引文件固定名。 */
const MEMORY_ENTRYPOINT_NAME = 'MEMORY.md'
/** 还原项目真实路径时，最多检查最近 N 个会话文件。 */
const PROJECT_LABEL_SESSION_SCAN_LIMIT = 10
const PROJECT_LABEL_HEAD_BYTES = 64 * 1024
const PROJECT_LABEL_FS_SEARCH_DEPTH = 24
const PROJECT_LABEL_FS_SEARCH_NODE_LIMIT = 2000
/** frontmatter `type` 的合法取值。 */
const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const

/** 同一文件的写入队列，保证同一路径的写入串行执行。 */
const memoryFileWriteQueues = new Map<string, Promise<unknown>>()

export function registerMemoryIPCHandlers(): void {
  registerHandlers(ipcMain, memoryChannels, 'memory:', {
    listProjects: (cwd?: string) =>
      guard('listProjects', () => listMemoryProjects(cwd)),
    listFiles: (projectId: string) =>
      guard('listFiles', () => listMemoryFiles(projectId)),
    readFile: (projectId: string, relativePath: string) =>
      guard('readFile', () => readMemoryFile(projectId, relativePath)),
    saveFile: (input: MemorySaveInput) =>
      guard('saveFile', () => saveMemoryFile(input)),
  })
}

/**
 * 统一错误处理：把失败原因写进日志后原样抛出，
 * 由 IPC 层把 message 透传给渲染进程展示。
 */
async function guard<T>(operation: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    warn('Memory', `${operation} failed: ${err instanceof Error ? err.message : String(err)}`)
    throw err
  }
}

// ============================================================================
// 项目列表
// ============================================================================

async function listMemoryProjects(cwd?: string): Promise<{ projects: MemoryProject[] }> {
  const projectsDir = getProjectsDir()
  const currentCwd = cwd || process.cwd()
  const currentProjectId = await getProjectIdForCwd(currentCwd)
  const projects = new Map<string, MemoryProject>()

  addProject(projects, currentProjectId, true)

  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await fs.readdir(projectsDir, { withFileTypes: true })
  } catch {
    // 从未跑过引擎时项目目录不存在，等价于「没有项目」。
    entries = []
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    addProject(projects, entry.name, entry.name === currentProjectId)
  }

  const resolved = await Promise.all(
    Array.from(projects.values()).map(async (project) => {
      const [fileCount, label] = await Promise.all([
        countMarkdownFiles(project.memoryDir),
        resolveProjectLabel(project.id, currentCwd),
      ])
      return {
        ...project,
        label,
        exists: fileCount > 0 || (await directoryExists(project.memoryDir)),
        fileCount,
      }
    }),
  )

  return {
    projects: resolved
      .filter((project) => project.exists)
      .sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
        if (a.fileCount !== b.fileCount) return b.fileCount - a.fileCount
        return a.label.localeCompare(b.label)
      }),
  }
}

function addProject(projects: Map<string, MemoryProject>, id: string, isCurrent: boolean): void {
  if (!isValidProjectId(id)) return
  const existing = projects.get(id)
  if (existing) {
    existing.isCurrent = existing.isCurrent || isCurrent
    return
  }
  projects.set(id, {
    id,
    label: unsanitizeProjectLabel(id),
    memoryDir: path.join(getProjectsDir(), id, 'memory'),
    exists: false,
    fileCount: 0,
    isCurrent,
  })
}

// ============================================================================
// 文件列表与读取
// ============================================================================

async function listMemoryFiles(projectId: string): Promise<{ files: MemoryFile[] }> {
  const memoryDir = await ensureMemoryDirBoundary(projectId)
  if (!(await directoryExists(memoryDir))) return { files: [] }

  const files: MemoryFile[] = []

  async function walk(dir: string, prefix = ''): Promise<void> {
    if (files.length >= MAX_MEMORY_FILES) return

    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of entries) {
      if (files.length >= MAX_MEMORY_FILES) break
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue

      const stat = await fs.stat(fullPath)
      let type: string | undefined
      let description: string | undefined
      try {
        if (stat.size <= MAX_MEMORY_FILE_BYTES) {
          const raw = await fs.readFile(fullPath, 'utf-8')
          const frontmatter = parseYamlFrontMatter(raw) ?? {}
          type = parseMemoryType(frontmatter.type)
          description = typeof frontmatter.description === 'string' ? frontmatter.description : undefined
        }
      } catch {
        // 元数据是尽力而为的：读失败不影响该文件继续出现在列表里被编辑。
      }

      files.push({
        path: relativePath,
        name: entry.name,
        bytes: stat.size,
        updatedAt: stat.mtime.toISOString(),
        type,
        description,
        title: relativePath === MEMORY_ENTRYPOINT_NAME ? MEMORY_ENTRYPOINT_NAME : entry.name.replace(/\.md$/, ''),
        isIndex: relativePath === MEMORY_ENTRYPOINT_NAME,
      })
    }
  }

  await walk(memoryDir)
  return {
    files: files.sort((a, b) => {
      if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1
      return a.path.localeCompare(b.path)
    }),
  }
}

async function readMemoryFile(
  projectId: string,
  relativePath: string,
): Promise<{ file: MemoryFileDetail }> {
  const normalizedPath = requireMemoryPath(relativePath)
  const fullPath = await resolveMemoryFilePath(projectId, normalizedPath, true)

  const handle = await fs.open(fullPath, 'r')
  try {
    const before = await handle.stat()
    if (before.size > MAX_MEMORY_FILE_BYTES) {
      throw new Error(`记忆文件过大，无法编辑：${normalizedPath}`)
    }
    const content = await handle.readFile({ encoding: 'utf-8' })
    const after = await handle.stat()
    // 读取期间被外部改写则报错，避免把半新半旧的内容当成一致版本展示。
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      Buffer.byteLength(content, 'utf-8') > MAX_MEMORY_FILE_BYTES
    ) {
      throw new Error(`记忆文件在读取过程中被修改：${normalizedPath}`)
    }
    return {
      file: {
        path: normalizedPath,
        content,
        updatedAt: after.mtime.toISOString(),
        bytes: after.size,
      },
    }
  } finally {
    await handle.close()
  }
}

// ============================================================================
// 写入
// ============================================================================

async function saveMemoryFile(
  input: MemorySaveInput,
): Promise<{ ok: true; file: MemoryFileRevision }> {
  const projectId = typeof input?.projectId === 'string' ? input.projectId : ''
  const relativePath = requireMemoryPath(input?.path)
  const content = input?.content
  if (typeof content !== 'string') {
    throw new Error('保存记忆文件失败：缺少 content')
  }
  if (Buffer.byteLength(content, 'utf-8') > MAX_MEMORY_FILE_BYTES) {
    throw new Error('记忆文件内容超过 512 KB')
  }

  const expectedUpdatedAt = typeof input.expectedUpdatedAt === 'string' ? input.expectedUpdatedAt : undefined
  const rawExpectedBytes = input.expectedBytes
  const expectedBytes =
    typeof rawExpectedBytes === 'number' && Number.isSafeInteger(rawExpectedBytes) && rawExpectedBytes >= 0
      ? rawExpectedBytes
      : undefined
  if (
    (input.expectedUpdatedAt !== undefined && expectedUpdatedAt === undefined) ||
    (input.expectedBytes !== undefined && expectedBytes === undefined) ||
    (expectedUpdatedAt === undefined) !== (expectedBytes === undefined)
  ) {
    throw new Error('expectedUpdatedAt 与 expectedBytes 必须成对提供，且为有效值')
  }

  const memoryDir = await ensureMemoryDirBoundary(projectId)
  const fullPath = path.resolve(memoryDir, relativePath)
  await assertWithinDirectory(fullPath, memoryDir, false)
  await fs.mkdir(path.dirname(fullPath), { recursive: true, mode: 0o700 })
  await assertWithinDirectory(path.dirname(fullPath), memoryDir, false)
  if (await fileExists(fullPath)) {
    await assertWithinDirectory(fullPath, memoryDir, true)
  }

  const stat = await enqueueMemoryFileWrite(fullPath, async () => {
    if (expectedUpdatedAt !== undefined && expectedBytes !== undefined) {
      let current: import('node:fs').Stats
      try {
        current = await fs.stat(fullPath)
      } catch {
        throw new Error(`记忆文件已在保存前被删除：${relativePath}`)
      }
      if (current.mtime.toISOString() !== expectedUpdatedAt || current.size !== expectedBytes) {
        throw new Error(`记忆文件已被外部修改，请重新打开后再保存：${relativePath}`)
      }
    }

    await writeFileAtomically(fullPath, content)
    return fs.stat(fullPath)
  })

  return {
    ok: true,
    file: {
      path: relativePath,
      updatedAt: stat.mtime.toISOString(),
      bytes: stat.size,
    },
  }
}

async function enqueueMemoryFileWrite<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = memoryFileWriteQueues.get(filePath) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  memoryFileWriteQueues.set(filePath, current)
  try {
    return await current
  } finally {
    if (memoryFileWriteQueues.get(filePath) === current) {
      memoryFileWriteQueues.delete(filePath)
    }
  }
}

/** 同目录临时文件 + rename：读者要么看到旧内容，要么看到完整新内容。 */
async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let handle: fs.FileHandle | undefined
  try {
    handle = await fs.open(tempPath, 'wx', 0o600)
    await handle.writeFile(content, { encoding: 'utf-8' })
    await handle.sync()
    await handle.close()
    handle = undefined
    await fs.rename(tempPath, filePath)
  } finally {
    await handle?.close().catch(() => undefined)
    await fs.unlink(tempPath).catch(() => undefined)
  }
}

// ============================================================================
// 路径校验
// ============================================================================

/** 校验相对记忆目录的 Markdown 路径，返回规范化的正斜杠形式。 */
function requireMemoryPath(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') {
    throw new Error('保存记忆文件失败：缺少文件路径')
  }
  const normalized = value.replace(/\\/g, '/')
  const parts = normalized.split('/')
  if (
    normalized.length === 0 ||
    Buffer.byteLength(normalized, 'utf-8') > MAX_RELATIVE_PATH_BYTES ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(value) ||
    /[\0-\x1f\x7f]/.test(normalized) ||
    parts.some(
      (part) =>
        part === '' ||
        part === '.' ||
        part === '..' ||
        Buffer.byteLength(part, 'utf-8') > MAX_PATH_SEGMENT_BYTES,
    ) ||
    !normalized.endsWith('.md')
  ) {
    throw new Error('记忆文件路径必须是指向 .md 的相对路径')
  }
  return normalized
}

function isValidProjectId(projectId: string): boolean {
  return (
    projectId.length > 0 &&
    Buffer.byteLength(projectId, 'utf-8') <= MAX_PROJECT_ID_BYTES &&
    !/[\0-\x1f\x7f]/.test(projectId) &&
    !projectId.includes('/') &&
    !projectId.includes('\\') &&
    projectId !== '.' &&
    projectId !== '..'
  )
}

async function resolveMemoryFilePath(
  projectId: string,
  relativePath: string,
  mustExist: boolean,
): Promise<string> {
  const memoryDir = await ensureMemoryDirBoundary(projectId)
  const candidate = path.resolve(memoryDir, relativePath)
  await assertWithinDirectory(candidate, memoryDir, mustExist)
  if (mustExist && !(await fileExists(candidate))) {
    throw new Error(`记忆文件不存在：${relativePath}`)
  }
  return candidate
}

/** 计算记忆目录路径并确认它（以及项目目录）没有越出配置目录。 */
async function ensureMemoryDirBoundary(projectId: string): Promise<string> {
  if (!isValidProjectId(projectId)) {
    throw new Error('项目标识无效')
  }
  const projectsDir = path.resolve(getProjectsDir())
  const projectDir = path.resolve(projectsDir, projectId)
  await assertWithinDirectory(projectDir, projectsDir, false)
  const memoryDir = path.resolve(projectDir, 'memory')
  if (await directoryExists(projectDir)) {
    await assertWithinDirectory(projectDir, projectsDir, true)
  }
  if (await directoryExists(memoryDir)) {
    await assertWithinDirectory(memoryDir, projectDir, true)
  }
  return memoryDir
}

/**
 * 断言 candidate 位于 directory 内。
 * mustExist=true 时用 realpath 比较（符号链接指向外部也会被拒），
 * 否则只比较规范化后的字面路径（目录可能尚未创建）。
 */
async function assertWithinDirectory(
  candidate: string,
  directory: string,
  mustExist: boolean,
): Promise<void> {
  const resolvedDirectory = mustExist ? await safeRealpath(directory) : path.resolve(directory)
  const resolvedCandidate = mustExist ? await safeRealpath(candidate) : path.resolve(candidate)
  const boundary = resolvedDirectory.endsWith(path.sep)
    ? resolvedDirectory
    : `${resolvedDirectory}${path.sep}`
  if (resolvedCandidate !== resolvedDirectory && !resolvedCandidate.startsWith(boundary)) {
    throw new Error('路径越出记忆目录')
  }
}

async function safeRealpath(targetPath: string): Promise<string> {
  try {
    return await fs.realpath(targetPath)
  } catch {
    return path.resolve(targetPath)
  }
}

// ============================================================================
// 项目标识与标签
// ============================================================================

function getClaudeConfigHomeDir(): string {
  // 与会话目录（sessionHistoryManager）保持一致：CLAUDE_CONFIG_DIR 优先，
  // 其次 XDG_CONFIG_HOME/claude，最后 ~/.claude
  if (process.env.CLAUDE_CONFIG_DIR) {
    return process.env.CLAUDE_CONFIG_DIR
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'claude')
  }
  return path.join(homedir(), '.claude')
}

function getMemoryBaseDir(): string {
  // 引擎在远程/容器场景可把记忆目录整体改址，这里跟随同一开关。
  return process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR || getClaudeConfigHomeDir()
}

function getProjectsDir(): string {
  return path.join(getMemoryBaseDir(), 'projects')
}

/** 项目根取「git 仓库根（符号链接已解析）」，非 git 目录则取工作目录本身。 */
async function resolveCanonicalProjectRoot(cwd: string): Promise<string> {
  const gitRoot = await getGitRoot(cwd).catch(() => null)
  const raw = gitRoot || cwd
  try {
    return (await fs.realpath(raw)).normalize('NFC')
  } catch {
    return path.resolve(raw).normalize('NFC')
  }
}

async function getProjectIdForCwd(cwd: string): Promise<string> {
  return sanitizePath(await resolveCanonicalProjectRoot(cwd))
}

/** 与会话记录同源的目录名编码：非字母数字一律替换为 '-'。 */
function sanitizePath(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * 还原项目真实路径：优先当前工作目录，其次会话文件里记录的 cwd，
 * 最后在常见根目录下按「sanitize 前缀可匹配」做有限深度的目录搜索。
 */
async function resolveProjectLabel(projectId: string, currentCwd: string): Promise<string> {
  const currentRoot = await resolveCanonicalProjectRoot(currentCwd)
  if (sanitizePath(currentRoot) === projectId) return currentRoot

  const sessionPath = await inferProjectPathFromSessionFiles(projectId)
  if (sessionPath) return sessionPath

  const filesystemPath = await inferProjectPathFromExistingDirectory(projectId)
  return filesystemPath ?? unsanitizeProjectLabel(projectId)
}

async function inferProjectPathFromSessionFiles(projectId: string): Promise<string | undefined> {
  const projectDir = path.join(getProjectsDir(), projectId)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(projectDir, { withFileTypes: true })
  } catch {
    return undefined
  }

  const sessionFiles: Array<{ filePath: string; mtimeMs: number }> = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const filePath = path.join(projectDir, entry.name)
    try {
      const stat = await fs.stat(filePath)
      sessionFiles.push({ filePath, mtimeMs: stat.mtimeMs })
    } catch {
      // 并发删除不应影响其余会话文件的读取。
    }
  }

  sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const { filePath } of sessionFiles.slice(0, PROJECT_LABEL_SESSION_SCAN_LIMIT)) {
    const head = await readFileHead(filePath, PROJECT_LABEL_HEAD_BYTES)
    const candidate =
      extractJsonStringField(head, 'cwd') ??
      extractJsonStringField(head, 'workDir') ??
      extractJsonStringField(head, 'projectPath')
    if (candidate && path.isAbsolute(candidate)) return candidate.normalize('NFC')
  }

  return undefined
}

async function readFileHead(filePath: string, bytes: number): Promise<string> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(bytes)
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf-8')
  } catch {
    return ''
  } finally {
    await handle.close()
  }
}

/**
 * 从（可能被截断的）JSONL 片段里取出首个字符串字段值。
 * 用正则而非逐行 JSON.parse：会话文件头部很大，且最后一行常被截断。
 */
function extractJsonStringField(text: string, field: string): string | undefined {
  const match = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text)
  if (!match) return undefined
  try {
    const value = JSON.parse(`"${match[1]}"`)
    return typeof value === 'string' && value ? value : undefined
  } catch {
    return undefined
  }
}

async function inferProjectPathFromExistingDirectory(projectId: string): Promise<string | undefined> {
  const roots = Array.from(
    new Set(
      [homedir(), process.env.HOME, process.env.USERPROFILE, '/private/tmp', '/tmp'].filter(
        (root): root is string => Boolean(root && path.isAbsolute(root)),
      ),
    ),
  )

  for (const root of roots) {
    const resolvedRoot = path.resolve(root)
    if (!sanitizedPrefixCanMatch(projectId, sanitizePath(resolvedRoot))) continue
    const match = await findDirectoryBySanitizedPath(projectId, resolvedRoot, 0, { visited: 0 })
    if (match) return match.normalize('NFC')
  }

  return undefined
}

async function findDirectoryBySanitizedPath(
  projectId: string,
  candidate: string,
  depth: number,
  state: { visited: number },
): Promise<string | undefined> {
  if (state.visited >= PROJECT_LABEL_FS_SEARCH_NODE_LIMIT) return undefined
  state.visited += 1

  const candidateId = sanitizePath(candidate)
  if (candidateId === projectId) return candidate
  if (depth >= PROJECT_LABEL_FS_SEARCH_DEPTH || !sanitizedPrefixCanMatch(projectId, candidateId)) {
    return undefined
  }

  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(candidate, { withFileTypes: true })
  } catch {
    return undefined
  }

  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const child = path.join(candidate, entry.name)
    if (!sanitizedPrefixCanMatch(projectId, sanitizePath(child))) continue
    if (entry.isSymbolicLink() && !(await directoryExists(child))) continue
    const match = await findDirectoryBySanitizedPath(projectId, child, depth + 1, state)
    if (match) return match
  }

  return undefined
}

/**
 * 判断某个已 sanitize 的路径前缀是否还可能是目标项目的前缀：
 * sanitize 把分隔符压成了 '-'，所以只能按「前缀 + '-'」逐段收窄。
 */
function sanitizedPrefixCanMatch(projectId: string, prefix: string): boolean {
  if (projectId === prefix) return true
  return prefix.endsWith('-') ? projectId.startsWith(prefix) : projectId.startsWith(`${prefix}-`)
}

function unsanitizeProjectLabel(projectId: string): string {
  return projectId.replace(/^-/, '/').replace(/-/g, '/')
}

// ============================================================================
// 小工具
// ============================================================================

function parseMemoryType(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  return MEMORY_TYPES.find((type) => type === raw)
}

async function directoryExists(dir: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dir)
    return stat.isDirectory()
  } catch {
    return false
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath)
    return stat.isFile()
  } catch {
    return false
  }
}

async function countMarkdownFiles(dir: string): Promise<number> {
  let count = 0
  async function walk(current: string): Promise<void> {
    if (count >= MAX_MEMORY_FILES) return
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (count >= MAX_MEMORY_FILES) break
      if (entry.name.startsWith('.')) continue
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        count++
      }
    }
  }
  await walk(dir)
  return count
}
