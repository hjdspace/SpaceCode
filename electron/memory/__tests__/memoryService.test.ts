// @vitest-environment node
/**
 * memoryService 主进程测试。
 *
 * 直接在临时目录上跑真实文件系统：路径校验、目录边界、frontmatter 解析、
 * 原子写入与 revision 冲突检测都在真实 IO 上验证。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const ipcHandlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler)
    },
  },
  app: {},
}))

// 不依赖真实 git：项目根直接取工作目录
vi.mock('../../git/gitService', () => ({
  getGitRoot: vi.fn(async () => null),
}))

import { registerMemoryIPCHandlers } from '../memoryService'

const MAX_MEMORY_FILE_BYTES = 512 * 1024

let configDir: string
let projectsDir: string
let previousConfigDir: string | undefined
let previousRemoteDir: string | undefined
let previousXdgDir: string | undefined

function sanitizePathForTest(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '-')
}

function projectIdFor(cwd: string): string {
  return sanitizePathForTest(fs.realpathSync(cwd).normalize('NFC'))
}

function memoryDirFor(cwd: string): string {
  return path.join(projectsDir, projectIdFor(cwd), 'memory')
}

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = ipcHandlers.get(channel)
  if (!handler) throw new Error(`未注册的 channel: ${channel}`)
  return Promise.resolve(handler(null, ...args) as T)
}

function readFile(projectId: string, relativePath: string) {
  return invoke<{ file: { path: string; content: string; bytes: number; updatedAt: string } }>(
    'memory:readFile',
    projectId,
    relativePath,
  )
}

function saveFile(input: Record<string, unknown>) {
  return invoke<{ ok: true; file: { path: string; bytes: number; updatedAt: string } }>(
    'memory:saveFile',
    input,
  )
}

beforeEach(() => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  previousRemoteDir = process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
  previousXdgDir = process.env.XDG_CONFIG_HOME
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-memory-'))
  projectsDir = path.join(configDir, 'projects')
  process.env.CLAUDE_CONFIG_DIR = configDir
  delete process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
  delete process.env.XDG_CONFIG_HOME
  ipcHandlers.clear()
  registerMemoryIPCHandlers()
})

afterEach(() => {
  if (previousConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  if (previousRemoteDir === undefined) delete process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
  else process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR = previousRemoteDir
  if (previousXdgDir === undefined) delete process.env.XDG_CONFIG_HOME
  else process.env.XDG_CONFIG_HOME = previousXdgDir
  fs.rmSync(configDir, { recursive: true, force: true })
})

describe('memory:listProjects', () => {
  it('lists projects that have a memory dir and marks the current one', async () => {
    const currentCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-cwd-'))
    const otherId = 'other-project'
    fs.mkdirSync(path.join(projectsDir, otherId, 'memory'), { recursive: true })
    fs.writeFileSync(path.join(projectsDir, otherId, 'memory', 'MEMORY.md'), '# other\n')
    fs.mkdirSync(memoryDirFor(currentCwd), { recursive: true })
    fs.writeFileSync(path.join(memoryDirFor(currentCwd), 'MEMORY.md'), '# current\n')
    fs.writeFileSync(path.join(memoryDirFor(currentCwd), 'notes.md'), '# notes\n')
    // 没有 memory 目录的项目不应出现在结果里
    fs.mkdirSync(path.join(projectsDir, 'empty-project'), { recursive: true })

    const { projects } = await invoke<{
      projects: Array<{ id: string; label: string; isCurrent: boolean; fileCount: number; memoryDir: string }>
    }>('memory:listProjects', currentCwd)

    expect(projects.map((project) => project.id)).toEqual([projectIdFor(currentCwd), otherId])
    expect(projects[0]).toMatchObject({
      isCurrent: true,
      fileCount: 2,
      memoryDir: memoryDirFor(currentCwd),
    })
    expect(projects[1]).toMatchObject({ isCurrent: false, fileCount: 1 })
    // 当前项目的 label 应还原成真实路径
    expect(projects[0].label).toContain(path.basename(currentCwd))

    fs.rmSync(currentCwd, { recursive: true, force: true })
  })

  it('returns an empty list when the projects dir does not exist', async () => {
    const { projects } = await invoke<{ projects: unknown[] }>('memory:listProjects', configDir)
    expect(projects).toEqual([])
  })
})

describe('memory:listFiles', () => {
  it('walks nested directories, skips hidden and non-markdown files, and reads frontmatter', async () => {
    const projectId = projectIdFor(configDir)
    const memoryDir = path.join(projectsDir, projectId, 'memory')
    fs.mkdirSync(path.join(memoryDir, 'notes'), { recursive: true })
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '---\ntype: project\ndescription: Conventions\n---\n# Index\n')
    fs.writeFileSync(path.join(memoryDir, 'notes', 'manual.md'), '---\ntype: feedback\n---\n# Manual\n')
    fs.writeFileSync(path.join(memoryDir, 'notes', 'manual.txt'), 'ignored')
    fs.writeFileSync(path.join(memoryDir, '.hidden.md'), '# hidden\n')

    const { files } = await invoke<{
      files: Array<{ path: string; title: string; isIndex: boolean; type?: string; description?: string }>
    }>('memory:listFiles', projectId)

    expect(files.map((file) => file.path)).toEqual(['MEMORY.md', 'notes/manual.md'])
    expect(files[0]).toMatchObject({ isIndex: true, title: 'MEMORY.md', type: 'project', description: 'Conventions' })
    expect(files[1]).toMatchObject({ isIndex: false, title: 'manual', type: 'feedback' })
    expect(files[1].description).toBeUndefined()
  })

  it('ignores unknown memory types', async () => {
    const projectId = projectIdFor(configDir)
    const memoryDir = path.join(projectsDir, projectId, 'memory')
    fs.mkdirSync(memoryDir, { recursive: true })
    fs.writeFileSync(path.join(memoryDir, 'weird.md'), '---\ntype: whatever\n---\n# Weird\n')

    const { files } = await invoke<{ files: Array<{ type?: string }> }>('memory:listFiles', projectId)
    expect(files[0].type).toBeUndefined()
  })

  it('rejects an invalid project id', async () => {
    await expect(invoke('memory:listFiles', '../escape')).rejects.toThrow('项目标识无效')
  })
})

describe('memory:readFile', () => {
  it('returns the content together with its revision', async () => {
    const projectId = projectIdFor(configDir)
    const memoryDir = path.join(projectsDir, projectId, 'memory')
    fs.mkdirSync(memoryDir, { recursive: true })
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '# Index\n')

    const { file } = await readFile(projectId, 'MEMORY.md')

    expect(file.path).toBe('MEMORY.md')
    expect(file.content).toBe('# Index\n')
    expect(file.bytes).toBe(Buffer.byteLength('# Index\n'))
    expect(Number.isNaN(Date.parse(file.updatedAt))).toBe(false)
  })

  it('normalizes windows separators and rejects unsafe or missing paths', async () => {
    const projectId = projectIdFor(configDir)
    const memoryDir = path.join(projectsDir, projectId, 'memory')
    fs.mkdirSync(path.join(memoryDir, 'notes'), { recursive: true })
    fs.writeFileSync(path.join(memoryDir, 'notes', 'manual.md'), '# Manual\n')

    await expect(readFile(projectId, 'notes\\manual.md')).resolves.toMatchObject({
      file: { path: 'notes/manual.md' },
    })
    await expect(readFile(projectId, '../outside.md')).rejects.toThrow('相对路径')
    await expect(readFile(projectId, 'notes/manual.txt')).rejects.toThrow('相对路径')
    await expect(readFile(projectId, 'C:/absolute.md')).rejects.toThrow('相对路径')
    await expect(readFile(projectId, 'missing.md')).rejects.toThrow('记忆文件不存在')
  })
})

describe('memory:saveFile', () => {
  it('creates missing directories and files, then reports the new revision', async () => {
    const projectId = projectIdFor(configDir)

    const result = await saveFile({
      projectId,
      path: 'notes/manual.md',
      content: '# Manual\n',
    })

    expect(result.ok).toBe(true)
    expect(result.file).toMatchObject({ path: 'notes/manual.md', bytes: Buffer.byteLength('# Manual\n') })
    const onDisk = fs.readFileSync(path.join(projectsDir, projectId, 'memory', 'notes', 'manual.md'), 'utf-8')
    expect(onDisk).toBe('# Manual\n')
    // 原子写入不应残留临时文件
    const leftovers = fs
      .readdirSync(path.join(projectsDir, projectId, 'memory', 'notes'))
      .filter((entry) => entry.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('overwrites when the revision matches and rejects when it does not', async () => {
    const projectId = projectIdFor(configDir)
    const created = await saveFile({ projectId, path: 'MEMORY.md', content: '# v1\n' })

    const updated = await saveFile({
      projectId,
      path: 'MEMORY.md',
      content: '# v2\n',
      expectedUpdatedAt: created.file.updatedAt,
      expectedBytes: created.file.bytes,
    })
    expect(fs.readFileSync(path.join(projectsDir, projectId, 'memory', 'MEMORY.md'), 'utf-8')).toBe('# v2\n')

    await expect(
      saveFile({
        projectId,
        path: 'MEMORY.md',
        content: '# v3\n',
        expectedUpdatedAt: created.file.updatedAt,
        expectedBytes: created.file.bytes,
      }),
    ).rejects.toThrow('已被外部修改')
    expect(fs.readFileSync(path.join(projectsDir, projectId, 'memory', 'MEMORY.md'), 'utf-8')).toBe('# v2\n')
    expect(updated.file.bytes).toBe(Buffer.byteLength('# v2\n'))
  })

  it('requires the revision fields to be provided together', async () => {
    const projectId = projectIdFor(configDir)
    await expect(
      saveFile({ projectId, path: 'MEMORY.md', content: '# v1\n', expectedBytes: 4 }),
    ).rejects.toThrow('必须成对提供')
    await expect(
      saveFile({ projectId, path: 'MEMORY.md', content: '# v1\n', expectedUpdatedAt: 'nope' }),
    ).rejects.toThrow('必须成对提供')
  })

  it('rejects oversized content and unsafe paths', async () => {
    const projectId = projectIdFor(configDir)
    await expect(
      saveFile({ projectId, path: 'MEMORY.md', content: 'x'.repeat(MAX_MEMORY_FILE_BYTES + 1) }),
    ).rejects.toThrow('512 KB')
    await expect(saveFile({ projectId, path: '../escape.md', content: '# x\n' })).rejects.toThrow('相对路径')
    await expect(saveFile({ projectId, path: 'notes/../x.md', content: '# x\n' })).rejects.toThrow('相对路径')
    await expect(saveFile({ projectId, path: 'note.txt', content: '# x\n' })).rejects.toThrow('相对路径')
    await expect(saveFile({ projectId, path: 'MEMORY.md' })).rejects.toThrow('缺少 content')
  })

  it('rejects a path that escapes the memory dir through a symlink', async () => {
    const projectId = projectIdFor(configDir)
    const memoryDir = path.join(projectsDir, projectId, 'memory')
    const outsideDir = path.join(configDir, 'outside')
    fs.mkdirSync(memoryDir, { recursive: true })
    fs.mkdirSync(outsideDir, { recursive: true })
    fs.writeFileSync(path.join(outsideDir, 'secret.md'), '# secret\n')
    try {
      fs.symlinkSync(outsideDir, path.join(memoryDir, 'link'), 'dir')
    } catch {
      // Windows 上未开启开发者模式时无法创建符号链接，跳过该用例
      return
    }

    await expect(readFile(projectId, 'link/secret.md')).rejects.toThrow('路径越出记忆目录')
  })
})
