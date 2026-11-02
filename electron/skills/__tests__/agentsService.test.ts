// @vitest-environment node
/**
 * agentsService — 助手库扫描 / 安装 / 卸载 / 已装列表 / 自定义保存。
 *
 * 入口全部是 ipcMain handler（模块私有函数），因此经 mock 的 ipcMain.handle
 * 捕获后直接调用。fs 全走真实临时目录：
 *  - 助手库根 = process.resourcesPath/agents-lib（isPackaged=true 路径）
 *  - 全局目录 = 临时 home/.claude/agents
 *  - 项目目录 = 临时 cwd/.claude/agents
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentDef } from '../agentsService'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  getPath: vi.fn((_name: string) => ''),
}))

const runtime = vi.hoisted(() => ({
  isPackaged: true,
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return runtime.isPackaged
    },
    getPath: electronMock.getPath,
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      electronMock.handlers.set(channel, handler)
    }),
  },
}))

import { registerAgentsIPCHandlers } from '../agentsService'

let home = ''
let resources = ''
let cwd = ''

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = electronMock.handlers.get(channel)
  if (!handler) throw new Error(`handler ${channel} was not registered`)
  return (await handler({}, ...args)) as T
}

async function expectInvokeError(channel: string, ...args: unknown[]): Promise<string> {
  try {
    await invoke(channel, ...args)
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  throw new Error(`expected ${channel}(${args.join(', ')}) to throw`)
}

/** 在助手库里写一个助手 .md（根目录或 work/ 子目录）。 */
function writeLibAgent(name: string, frontMatter: string, body = ''): string {
  const dir = join(resources, 'agents-lib')
  mkdirSync(dir, { recursive: true })
  const full = join(dir, `${name}.md`)
  writeFileSync(full, `---\n${frontMatter}\n---\n\n${body}`, 'utf-8')
  return full
}

function writeGlobalAgent(name: string, content = '# g'): void {
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(home, '.claude', 'agents', `${name}.md`), content, 'utf-8')
}

function writeProjectAgent(name: string, content = '# p'): void {
  mkdirSync(join(cwd, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(cwd, '.claude', 'agents', `${name}.md`), content, 'utf-8')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sc-agents-home-'))
  resources = mkdtempSync(join(tmpdir(), 'sc-agents-res-'))
  cwd = mkdtempSync(join(tmpdir(), 'sc-agents-cwd-'))
  runtime.isPackaged = true
  ;(process as unknown as { resourcesPath: string }).resourcesPath = resources
  electronMock.getPath.mockImplementation((name: string) => {
    if (name !== 'home') throw new Error(`unexpected getPath(${name})`)
    return home
  })
  electronMock.handlers.clear()
  registerAgentsIPCHandlers()
})

afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(resources, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

describe('agents:scanLibrary', () => {
  it('returns an empty list when the library root does not exist', async () => {
    const { agents } = await invoke<{ agents: AgentDef[] }>('agents:scanLibrary')
    expect(agents).toEqual([])
  })

  it('parses front matter, falls back to the filename for the name, and infers categories', async () => {
    writeLibAgent(
      'sec-reviewer',
      'description: Security reviews\ntools: ["Read", "Bash"]\nmodel: opus\ncolor: red\ncategory: custom-cat',
      'do reviews',
    )
    writeLibAgent('mystery', 'description: no name field')

    const { agents } = await invoke<{ agents: AgentDef[] }>('agents:scanLibrary')
    const byName = Object.fromEntries(agents.map((a) => [a.name, a]))

    expect(byName['sec-reviewer']).toMatchObject({
      description: 'Security reviews',
      tools: ['Read', 'Bash'],
      model: 'opus',
      color: 'red',
      category: 'custom-cat',
      isInstalled: false,
      installedScope: undefined,
    })
    expect(byName['sec-reviewer'].content).toContain('do reviews')
    expect(byName['sec-reviewer'].agentPath).toBe(join(resources, 'agents-lib', 'sec-reviewer.md'))

    // name 缺失回退文件名；category 未经 front-matter 指定且名字无关键词时落 general
    expect(byName['mystery']).toMatchObject({ name: 'mystery', category: 'general', description: 'no name field' })
  })

  it('scans one level of subdirectories but not deeper', async () => {
    writeLibAgent('root-agent', 'description: r')
    mkdirSync(join(resources, 'agents-lib', 'work'), { recursive: true })
    writeFileSync(
      join(resources, 'agents-lib', 'work', 'excel-creator.md'),
      '---\nname: excel-creator\ndescription: w\nmode: work\n---\nbody',
      'utf-8',
    )
    mkdirSync(join(resources, 'agents-lib', 'work', 'deeper'), { recursive: true })
    writeFileSync(
      join(resources, 'agents-lib', 'work', 'deeper', 'buried.md'),
      '---\nname: buried\ndescription: d\n---\nbody',
      'utf-8',
    )

    const { agents } = await invoke<{ agents: AgentDef[] }>('agents:scanLibrary', cwd)

    expect(agents.map((a) => a.name).sort()).toEqual(['excel-creator', 'root-agent'])
    const workAgent = agents.find((a) => a.name === 'excel-creator')!
    expect(workAgent.mode).toBe('work')
    expect(workAgent.sourceDir).toBe(join(resources, 'agents-lib', 'work'))
  })

  it('marks agents installed against global first, then project scope', async () => {
    writeLibAgent('dual', 'description: d')
    writeGlobalAgent('dual')
    writeLibAgent('local', 'description: d')
    writeProjectAgent('local')

    const { agents } = await invoke<{ agents: AgentDef[] }>('agents:scanLibrary', cwd)
    const byName = Object.fromEntries(agents.map((a) => [a.name, a]))

    expect(byName['dual'].isInstalled).toBe(true)
    expect(byName['dual'].installedScope).toBe('global')
    expect(byName['local'].isInstalled).toBe(true)
    expect(byName['local'].installedScope).toBe('project')
    // 没传 cwd 时项目级不算安装
    const noCwd = await invoke<{ agents: AgentDef[] }>('agents:scanLibrary')
    expect(noCwd.agents.find((a) => a.name === 'local')!.isInstalled).toBe(false)
  })

  it('normalizes optional list fields from arrays, single strings and snake_case aliases', async () => {
    writeLibAgent(
      'fields',
      [
        'description: d',
        'mode: code',
        'avatar: 🤖',
        'permission: acceptEdits',
        'skills:',
        '  - xlsx',
        '  - docx',
        'mcps: mcp-server-one',
        'recommendedPrompts: [do a, do b]',
        'description_zh: 中文描述',
        'recommendedPrompts_zh: [做甲]',
        'skillRuntime: officecli',
        'skill_descriptions: [表格处理]',
      ].join('\n'),
    )

    const { agents } = await invoke<{ agents: AgentDef[] }>('agents:scanLibrary')
    const a = agents[0]

    expect(a).toMatchObject({
      mode: 'code',
      avatar: '🤖',
      permission: 'acceptEdits',
      skills: ['xlsx', 'docx'],
      mcps: ['mcp-server-one'],
      recommendedPrompts: ['do a', 'do b'],
      descriptionZh: '中文描述',
      recommendedPromptsZh: ['做甲'],
      skillRuntime: 'officecli',
      skillDescriptions: ['表格处理'],
    })
  })

  it('survives a malformed front-matter file and unknown mode values', async () => {
    const dir = join(resources, 'agents-lib')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'broken.md'), '没有 front matter 的内容', 'utf-8')
    writeLibAgent('odd-mode', 'description: d\nmode: weird')

    const { agents } = await invoke<{ agents: AgentDef[] }>('agents:scanLibrary')
    const byName = Object.fromEntries(agents.map((a) => [a.name, a]))

    expect(byName['broken']).toMatchObject({ name: 'broken', description: '' })
    expect(byName['odd-mode'].mode).toBeUndefined()
  })
})

describe('agents:install', () => {
  it.each(['../evil', 'a/b', 'a\\b'])('rejects path-traversal names (%j)', async (name) => {
    await expect(expectInvokeError('agents:install', name, 'global')).resolves.toBe('Invalid agent name')
  })

  it('throws when the agent is not in the library', async () => {
    await expect(expectInvokeError('agents:install', 'ghost', 'global')).resolves.toBe(
      "Agent 'ghost' not found in library",
    )
  })

  it('copies the source file into the global agents dir and creates it', async () => {
    writeLibAgent('reviewer', 'description: d', 'review body')

    await expect(invoke('agents:install', 'reviewer', 'global')).resolves.toEqual({ success: true })

    const target = join(home, '.claude', 'agents', 'reviewer.md')
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf-8')).toContain('review body')
  })

  it('installs into the project scope under the given cwd', async () => {
    writeLibAgent('planner', 'description: d')

    await expect(invoke('agents:install', 'planner', 'project', cwd)).resolves.toEqual({ success: true })
    expect(existsSync(join(cwd, '.claude', 'agents', 'planner.md'))).toBe(true)
  })

  it('finds agents nested one level deep in the library', async () => {
    mkdirSync(join(resources, 'agents-lib', 'work'), { recursive: true })
    writeFileSync(
      join(resources, 'agents-lib', 'work', 'nested.md'),
      '---\nname: nested\ndescription: d\n---\nbody',
      'utf-8',
    )

    await expect(invoke('agents:install', 'nested', 'global')).resolves.toEqual({ success: true })
    expect(existsSync(join(home, '.claude', 'agents', 'nested.md'))).toBe(true)
  })

  it('refuses to overwrite an already installed agent', async () => {
    writeLibAgent('dupe', 'description: d')
    writeGlobalAgent('dupe', 'existing')

    const target = join(home, '.claude', 'agents', 'dupe.md')
    await expect(expectInvokeError('agents:install', 'dupe', 'global')).resolves.toBe(
      `Agent 'dupe' is already installed at ${target}`,
    )
    expect(readFileSync(target, 'utf-8')).toBe('existing')
  })
})

describe('agents:uninstall', () => {
  it.each(['../evil', 'x/y'])('rejects path-traversal names (%j)', async (name) => {
    await expect(expectInvokeError('agents:uninstall', name, 'global')).resolves.toBe('Invalid agent name')
  })

  it('throws when the agent is not installed', async () => {
    await expect(expectInvokeError('agents:uninstall', 'ghost', 'global')).resolves.toBe(
      "Agent 'ghost' is not installed",
    )
  })

  it('removes the installed file from the requested scope', async () => {
    writeLibAgent('gone', 'description: d')
    await invoke('agents:install', 'gone', 'project', cwd)
    const target = join(cwd, '.claude', 'agents', 'gone.md')
    expect(existsSync(target)).toBe(true)

    await expect(invoke('agents:uninstall', 'gone', 'project', cwd)).resolves.toEqual({ success: true })
    expect(existsSync(target)).toBe(false)
  })
})

describe('agents:getInstalled', () => {
  it('merges global and project agents with scope markers', async () => {
    writeGlobalAgent('g-one', '---\nname: g-one\ndescription: global\n---\nbody')
    writeProjectAgent('p-one', '---\nname: p-one\ndescription: project\n---\nbody')

    const { agents } = await invoke<{ agents: AgentDef[] }>('agents:getInstalled', cwd)

    expect(agents.map((a) => a.name).sort()).toEqual(['g-one', 'p-one'])
    expect(agents.find((a) => a.name === 'g-one')).toMatchObject({ isInstalled: true, installedScope: 'global' })
    expect(agents.find((a) => a.name === 'p-one')).toMatchObject({ isInstalled: true, installedScope: 'project' })
  })

  it('returns only global agents without a cwd and nothing when no dirs exist', async () => {
    expect((await invoke<{ agents: AgentDef[] }>('agents:getInstalled')).agents).toEqual([])

    writeGlobalAgent('only-global')
    const { agents } = await invoke<{ agents: AgentDef[] }>('agents:getInstalled')
    expect(agents.map((a) => a.name)).toEqual(['only-global'])
  })
})

describe('agents:saveCustom', () => {
  it.each(['../evil', 'x/y'])('rejects path-traversal names (%j)', async (name) => {
    await expect(expectInvokeError('agents:saveCustom', name, 'content')).resolves.toBe('Invalid agent name')
  })

  it('writes the custom agent into the global agents dir and creates the dir', async () => {
    const result = await invoke<{ success: boolean; path: string }>(
      'agents:saveCustom',
      'my-custom',
      '---\nname: my-custom\n---\nbody',
    )

    expect(result.success).toBe(true)
    expect(result.path).toBe(join(home, '.claude', 'agents', 'my-custom.md'))
    expect(readFileSync(result.path, 'utf-8')).toContain('body')
  })

  it('overwrites an existing custom agent with the new content', async () => {
    writeGlobalAgent('mine', 'old')
    await invoke('agents:saveCustom', 'mine', 'new content')

    expect(readFileSync(join(home, '.claude', 'agents', 'mine.md'), 'utf-8')).toBe('new content')
  })
})

describe('registerAgentsIPCHandlers', () => {
  it('registers all five channels', () => {
    expect([...electronMock.handlers.keys()].sort()).toEqual([
      'agents:getInstalled',
      'agents:install',
      'agents:saveCustom',
      'agents:scanLibrary',
      'agents:uninstall',
    ])
  })
})
