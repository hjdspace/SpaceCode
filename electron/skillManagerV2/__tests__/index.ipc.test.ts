// @vitest-environment node
/**
 * Skill Manager V2 IPC 层。
 *
 * 这一层此前 0% 覆盖：44 个通道大多是「渲染端说什么就派发什么」的薄转发，
 * 参数错位或漏掉 await 都不会被 service 的测试发现。这里钉住通道→方法映射、
 * 参数透传、懒初始化单例，以及解压/克隆两个真正有逻辑的 handler。
 */
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SCHEMA_MANAGER_CHANNELS } from '../channels'

const h = vi.hoisted(() => {
  const methods = [
    'initScan', 'getOverview', 'refresh', 'getSettings', 'updateSettings',
    'listCenterSkills', 'getSkillDetail', 'previewDeleteCenterSkill', 'executeDeleteCenterSkill',
    'previewAddCenterSkill', 'executeAddCenterSkill', 'previewDistribute', 'executeDistribute',
    'deleteTarget', 'scanAgentInventory', 'listUnmanaged', 'listAgentSkillInventory',
    'previewAdopt', 'executeAdopt', 'executeAdoptBatch', 'listPacks', 'getPackDetail',
    'upsertPack', 'previewDeletePack', 'deletePack', 'previewApplyPack', 'executeApplyPack',
    'previewRemovePackFromAgent', 'removePackFromAgent', 'previewSyncCopy', 'executeSyncCopy',
    'previewCopyTargetDiff', 'runDiagnosis', 'listDiagnosisIssues', 'executeSafeFixes',
    'exportSnapshot', 'listAgents', 'getAgentDetail', 'scanAgentDetail', 'refreshAgentVersions',
  ]
  const service: Record<string, Mock> = { close: vi.fn() }
  for (const m of methods) service[m] = vi.fn()
  return {
    methods,
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    service,
    bootstrap: vi.fn(),
    openPath: vi.fn(),
    getAppPath: vi.fn(),
    bundledSkillsRoot: vi.fn(),
    execFileSync: vi.fn(),
  }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      h.handlers.set(channel, fn)
    },
  },
  shell: { openPath: h.openPath },
  app: { getAppPath: h.getAppPath },
}))

vi.mock('child_process', () => ({ execFileSync: h.execFileSync }))
vi.mock('../service', () => ({ SkillManagerService: { bootstrap: h.bootstrap } }))
vi.mock('../bundledSkills', () => ({ bundledSkillsRoot: h.bundledSkillsRoot }))

type IpcModule = typeof import('../index')
let mod: IpcModule
let tmpDir: string

const EVENT = {} as unknown

function handler(channel: string): (...args: unknown[]) => unknown {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return fn
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return handler(channel)(EVENT, ...args)
}

beforeEach(async () => {
  vi.resetModules()
  h.handlers.clear()
  vi.clearAllMocks()
  for (const m of h.methods) {
    h.service[m].mockImplementation((...args: unknown[]) => ({ __method: m, args }))
  }
  h.service.close.mockImplementation(() => {})
  h.bootstrap.mockImplementation(() => h.service)
  h.openPath.mockImplementation(async (p: string) => `opened:${p}`)
  h.getAppPath.mockImplementation(() => '/fake/app')
  h.bundledSkillsRoot.mockImplementation(() => '/fake/bundled')
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-ipc-'))
  mod = await import('../index')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// ── 注册与生命周期 ─────────────────────────────────────────────────

describe('registerSkillManagerV2IPCHandlers', () => {
  it('注册全部 44 个通道，一个不漏', () => {
    mod.registerSkillManagerV2IPCHandlers()
    const expected = Object.values(SCHEMA_MANAGER_CHANNELS)
    expect(expected).toHaveLength(44)
    expect([...h.handlers.keys()].sort()).toEqual([...expected].sort())
  })

  it('注册时就 bootstrap，让内置技能在打开界面前就位', () => {
    mod.registerSkillManagerV2IPCHandlers()
    expect(h.bootstrap).toHaveBeenCalledTimes(1)
  })

  it('bootstrap 收到解析后的内置技能资源根', () => {
    mod.registerSkillManagerV2IPCHandlers()
    expect(h.bundledSkillsRoot).toHaveBeenCalledWith({
      resourcesPath: process.resourcesPath,
      appPath: '/fake/app',
    })
    expect(h.bootstrap).toHaveBeenCalledWith(undefined, undefined, '/fake/bundled')
  })

  it('bootstrap 失败只告警，通道照常注册（技能库没就绪不该让应用起不来）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.bootstrap.mockImplementation(() => {
      throw new Error('disk on fire')
    })

    mod.registerSkillManagerV2IPCHandlers()

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk on fire'))
    expect(h.handlers.size).toBe(44)
  })

  it('bootstrap 失败后后续 IPC 会重试初始化', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    h.bootstrap.mockImplementationOnce(() => {
      throw new Error('transient')
    })
    mod.registerSkillManagerV2IPCHandlers()

    expect(await invoke(SCHEMA_MANAGER_CHANNELS.OVERVIEW)).toEqual({
      __method: 'getOverview',
      args: [],
    })
    expect(h.bootstrap).toHaveBeenCalledTimes(2)
  })

  it('service 是懒初始化单例：多次调用只 bootstrap 一次', async () => {
    mod.registerSkillManagerV2IPCHandlers()
    await invoke(SCHEMA_MANAGER_CHANNELS.OVERVIEW)
    await invoke(SCHEMA_MANAGER_CHANNELS.LIST_AGENTS)
    await invoke(SCHEMA_MANAGER_CHANNELS.LIST_PACKS)
    expect(h.bootstrap).toHaveBeenCalledTimes(1)
  })
})

describe('closeSkillManagerService', () => {
  it('关闭 service 并释放单例', () => {
    mod.registerSkillManagerV2IPCHandlers()
    mod.closeSkillManagerService()
    expect(h.service.close).toHaveBeenCalledTimes(1)
  })

  it('未初始化时调用是安全的空操作', () => {
    mod.closeSkillManagerService()
    expect(h.service.close).not.toHaveBeenCalled()
  })

  it('重复调用不会二次 close', () => {
    mod.registerSkillManagerV2IPCHandlers()
    mod.closeSkillManagerService()
    mod.closeSkillManagerService()
    expect(h.service.close).toHaveBeenCalledTimes(1)
  })

  it('关闭后再次调用 IPC 会重新 bootstrap', async () => {
    mod.registerSkillManagerV2IPCHandlers()
    mod.closeSkillManagerService()
    await invoke(SCHEMA_MANAGER_CHANNELS.OVERVIEW)
    expect(h.bootstrap).toHaveBeenCalledTimes(2)
  })
})

// ── 薄转发：通道 → 方法 + 参数透传 ─────────────────────────────────

interface Delegation {
  channel: keyof typeof SCHEMA_MANAGER_CHANNELS
  method: string
  args: unknown[]
  /** handler 不返回 service 的结果（void 型命令） */
  voidResult?: boolean
}

const delegations: Delegation[] = [
  { channel: 'INIT', method: 'initScan', args: [] },
  { channel: 'OVERVIEW', method: 'getOverview', args: [] },
  { channel: 'REFRESH', method: 'refresh', args: [] },
  { channel: 'SETTINGS', method: 'getSettings', args: [] },
  { channel: 'UPDATE_SETTINGS', method: 'updateSettings', args: [{ startupScan: false }] },
  { channel: 'LIST_CENTER_SKILLS', method: 'listCenterSkills', args: [] },
  { channel: 'GET_SKILL_DETAIL', method: 'getSkillDetail', args: ['skill-1'] },
  { channel: 'PREVIEW_DELETE_CENTER_SKILL', method: 'previewDeleteCenterSkill', args: ['skill-1'] },
  { channel: 'EXECUTE_DELETE_CENTER_SKILL', method: 'executeDeleteCenterSkill', args: ['skill-1'], voidResult: true },
  { channel: 'PREVIEW_ADD_CENTER_SKILL', method: 'previewAddCenterSkill', args: [{ sourcePath: '/tmp/x' }] },
  {
    channel: 'EXECUTE_ADD_CENTER_SKILL',
    method: 'executeAddCenterSkill',
    args: [{ sourcePath: '/tmp/x' }, [{ candidateId: 'c1', action: 'import' }]],
  },
  { channel: 'PREVIEW_DISTRIBUTE', method: 'previewDistribute', args: [['s1', 's2'], ['claude-code'], 'link'] },
  { channel: 'EXECUTE_DISTRIBUTE', method: 'executeDistribute', args: [{ changes: [], blockers: [] }] },
  { channel: 'DELETE_TARGET', method: 'deleteTarget', args: ['target-1'], voidResult: true },
  { channel: 'SCAN_AGENT_INVENTORY', method: 'scanAgentInventory', args: ['claude-code'] },
  { channel: 'LIST_UNMANAGED', method: 'listUnmanaged', args: [] },
  { channel: 'LIST_AGENT_SKILL_INVENTORY', method: 'listAgentSkillInventory', args: [] },
  { channel: 'PREVIEW_ADOPT', method: 'previewAdopt', args: ['claude-code', 'unm-1'] },
  {
    channel: 'EXECUTE_ADOPT',
    method: 'executeAdopt',
    args: ['claude-code', 'unm-1', 'rename', 'new-id'],
    voidResult: true,
  },
  { channel: 'EXECUTE_ADOPT_BATCH', method: 'executeAdoptBatch', args: [[{ agentId: 'claude-code', unmanagedId: 'unm-1' }]] },
  { channel: 'LIST_PACKS', method: 'listPacks', args: [] },
  { channel: 'GET_PACK_DETAIL', method: 'getPackDetail', args: ['pack-1'] },
  { channel: 'UPSERT_PACK', method: 'upsertPack', args: [{ name: 'Pack', skillIds: ['s1'] }] },
  { channel: 'PREVIEW_DELETE_PACK', method: 'previewDeletePack', args: ['pack-1'] },
  { channel: 'DELETE_PACK', method: 'deletePack', args: ['pack-1'], voidResult: true },
  { channel: 'PREVIEW_APPLY_PACK', method: 'previewApplyPack', args: ['pack-1', ['codex'], 'copy'] },
  { channel: 'EXECUTE_APPLY_PACK', method: 'executeApplyPack', args: ['pack-1', ['codex'], 'copy'] },
  { channel: 'PREVIEW_REMOVE_PACK_FROM_AGENT', method: 'previewRemovePackFromAgent', args: ['pack-1', 'codex'] },
  { channel: 'EXECUTE_REMOVE_PACK_FROM_AGENT', method: 'removePackFromAgent', args: ['pack-1', 'codex'] },
  { channel: 'PREVIEW_SYNC_COPY', method: 'previewSyncCopy', args: ['target-1'] },
  { channel: 'EXECUTE_SYNC_COPY', method: 'executeSyncCopy', args: ['target-1', 'overwrite'] },
  { channel: 'PREVIEW_COPY_DIFF', method: 'previewCopyTargetDiff', args: ['target-1'] },
  { channel: 'RUN_DIAGNOSIS', method: 'runDiagnosis', args: [] },
  { channel: 'LIST_DIAGNOSIS_ISSUES', method: 'listDiagnosisIssues', args: [] },
  { channel: 'EXECUTE_SAFE_FIXES', method: 'executeSafeFixes', args: [] },
  { channel: 'EXPORT_SNAPSHOT', method: 'exportSnapshot', args: [] },
  { channel: 'LIST_AGENTS', method: 'listAgents', args: [] },
  { channel: 'GET_AGENT_DETAIL', method: 'getAgentDetail', args: ['claude-code'] },
  { channel: 'SCAN_AGENT_DETAIL', method: 'scanAgentDetail', args: ['claude-code'] },
]

describe('通道派发与参数透传', () => {
  beforeEach(() => {
    mod.registerSkillManagerV2IPCHandlers()
  })

  it('39 个薄转发 + 5 个特殊 handler = 44 个通道', () => {
    expect(delegations).toHaveLength(39)
  })

  for (const d of delegations) {
    it(`${d.channel} → ${d.method}，参数原样透传`, async () => {
      const result = await invoke(SCHEMA_MANAGER_CHANNELS[d.channel], ...d.args)
      expect(h.service[d.method]).toHaveBeenCalledTimes(1)
      expect(h.service[d.method]).toHaveBeenCalledWith(...d.args)
      if (d.voidResult) {
        expect(result).toBeUndefined()
      } else {
        expect(result).toEqual({ __method: d.method, args: d.args })
      }
    })
  }

  it('可选参数缺省时按 undefined 透传，不吞掉后续位置', async () => {
    await invoke(SCHEMA_MANAGER_CHANNELS.EXECUTE_ADOPT, 'claude-code', 'unm-1', 'keep')
    expect(h.service.executeAdopt).toHaveBeenCalledWith('claude-code', 'unm-1', 'keep', undefined)
  })

  it('service 抛错时原样冒泡，不在 IPC 层被吞掉', async () => {
    h.service.getSkillDetail.mockImplementation(() => {
      throw new Error('boom')
    })
    await expect(invoke(SCHEMA_MANAGER_CHANNELS.GET_SKILL_DETAIL, 's1')).rejects.toThrow('boom')
  })
})

// ── 特殊 handler ───────────────────────────────────────────────────

describe('BOOTSTRAP / OPEN_PATH / REFRESH_AGENT_VERSIONS', () => {
  beforeEach(() => {
    mod.registerSkillManagerV2IPCHandlers()
  })

  it('BOOTSTRAP 返回 success 而不是 service 实例', async () => {
    expect(await invoke(SCHEMA_MANAGER_CHANNELS.BOOTSTRAP)).toEqual({ success: true })
  })

  it('OPEN_PATH 交给 shell.openPath 并回传其结果', async () => {
    expect(await invoke(SCHEMA_MANAGER_CHANNELS.OPEN_PATH, '/some/path')).toBe('opened:/some/path')
    expect(h.openPath).toHaveBeenCalledWith('/some/path')
  })

  it('REFRESH_AGENT_VERSIONS 先 await 探测再取列表', async () => {
    let probed = false
    h.service.refreshAgentVersions.mockImplementation(async () => {
      await Promise.resolve()
      probed = true
    })
    h.service.listAgents.mockImplementation(() => {
      expect(probed).toBe(true)
      return [{ id: 'claude-code' }]
    })

    expect(await invoke(SCHEMA_MANAGER_CHANNELS.REFRESH_AGENT_VERSIONS)).toEqual([{ id: 'claude-code' }])
    expect(h.service.refreshAgentVersions).toHaveBeenCalledTimes(1)
  })
})

// ── EXTRACT_ARCHIVE ────────────────────────────────────────────────

describe('EXTRACT_ARCHIVE', () => {
  let archivePath: string

  beforeEach(() => {
    mod.registerSkillManagerV2IPCHandlers()
    archivePath = path.join(tmpDir, 'skill.zip')
    fs.writeFileSync(archivePath, 'not really a zip — execFileSync is mocked')
  })

  /** 解压命令的目标目录在 argv 里的位置随平台不同。 */
  function destOf(args: string[]): string {
    return process.platform === 'win32' ? args[5] : args[3]
  }

  function fakeExtract(create: (dest: string) => void): void {
    h.execFileSync.mockImplementation((_cmd: string, args: string[]) => {
      create(destOf(args))
      return Buffer.from('')
    })
  }

  function extract(p: string = archivePath): Promise<{ success: boolean; localPath?: string; error?: string }> {
    return invoke(SCHEMA_MANAGER_CHANNELS.EXTRACT_ARCHIVE, p) as Promise<{
      success: boolean; localPath?: string; error?: string
    }>
  }

  it('非 .zip 后缀被拒绝，且不调用解压命令', async () => {
    const tar = path.join(tmpDir, 'skill.tar.gz')
    fs.writeFileSync(tar, 'x')
    expect(await extract(tar)).toEqual({
      success: false,
      error: 'Only .zip archives are supported.',
    })
    expect(h.execFileSync).not.toHaveBeenCalled()
  })

  it('空路径被拒绝', async () => {
    expect(await extract('')).toEqual({
      success: false,
      error: 'Only .zip archives are supported.',
    })
  })

  it('后缀大小写不敏感', async () => {
    const upper = path.join(tmpDir, 'skill.ZIP')
    fs.writeFileSync(upper, 'x')
    fakeExtract((dest) => fs.writeFileSync(path.join(dest, 'SKILL.md'), '# s'))
    expect((await extract(upper)).success).toBe(true)
  })

  it('文件不存在时报 Archive not found', async () => {
    const missing = path.join(tmpDir, 'nope.zip')
    expect(await extract(missing)).toEqual({
      success: false,
      error: `Archive not found: ${missing}`,
    })
  })

  it('路径是目录时同样报 Archive not found', async () => {
    const dir = path.join(tmpDir, 'folder.zip')
    fs.mkdirSync(dir)
    expect(await extract(dir)).toEqual({
      success: false,
      error: `Archive not found: ${dir}`,
    })
  })

  it('单一顶层目录时下钻到该目录', async () => {
    fakeExtract((dest) => {
      fs.mkdirSync(path.join(dest, 'my-skill'), { recursive: true })
      fs.writeFileSync(path.join(dest, 'my-skill', 'SKILL.md'), '# s')
    })
    const result = await extract()
    expect(result.success).toBe(true)
    const [, args] = h.execFileSync.mock.calls[0] as [string, string[]]
    expect(result.localPath).toBe(path.join(destOf(args), 'my-skill'))
    expect(fs.existsSync(path.join(result.localPath!, 'SKILL.md'))).toBe(true)
  })

  it('多个顶层条目时返回解压根目录', async () => {
    fakeExtract((dest) => {
      fs.mkdirSync(path.join(dest, 'a'), { recursive: true })
      fs.mkdirSync(path.join(dest, 'b'), { recursive: true })
    })
    const result = await extract()
    expect(result.success).toBe(true)
    expect(fs.readdirSync(result.localPath!).sort()).toEqual(['a', 'b'])
  })

  it('顶层只有一个文件时不下钻', async () => {
    fakeExtract((dest) => fs.writeFileSync(path.join(dest, 'SKILL.md'), '# s'))
    const result = await extract()
    expect(result.success).toBe(true)
    expect(fs.readdirSync(result.localPath!)).toEqual(['SKILL.md'])
  })

  it('__MACOSX 被过滤后只剩一个目录时仍然下钻', async () => {
    fakeExtract((dest) => {
      fs.mkdirSync(path.join(dest, '__MACOSX'), { recursive: true })
      fs.mkdirSync(path.join(dest, 'my-skill'), { recursive: true })
    })
    const result = await extract()
    expect(result.success).toBe(true)
    expect(path.basename(result.localPath!)).toBe('my-skill')
  })

  it('只有 __MACOSX 时返回解压根目录', async () => {
    fakeExtract((dest) => fs.mkdirSync(path.join(dest, '__MACOSX'), { recursive: true }))
    const result = await extract()
    expect(result.success).toBe(true)
    expect(fs.readdirSync(result.localPath!)).toEqual(['__MACOSX'])
  })

  it('解压出空目录时返回解压根目录', async () => {
    fakeExtract(() => {})
    const result = await extract()
    expect(result.success).toBe(true)
    expect(fs.readdirSync(result.localPath!)).toEqual([])
  })

  it('按平台选择解压命令', async () => {
    fakeExtract(() => {})
    await extract()
    const [cmd, args] = h.execFileSync.mock.calls[0] as [string, string[]]
    if (process.platform === 'win32') {
      expect(cmd).toBe('powershell.exe')
      expect(args.join(' ')).toContain('Expand-Archive')
      expect(args[4]).toBe(archivePath)
    } else {
      expect(cmd).toBe('unzip')
      expect(args[1]).toBe(archivePath)
    }
  })

  it('解压命令抛错时返回 error 而不是抛出', async () => {
    h.execFileSync.mockImplementation(() => {
      throw new Error('unzip failed')
    })
    expect(await extract()).toEqual({ success: false, error: 'unzip failed' })
  })

  it('抛出非 Error 值时转成字符串', async () => {
    h.execFileSync.mockImplementation(() => {
      throw 'plain string failure'
    })
    expect(await extract()).toEqual({ success: false, error: 'plain string failure' })
  })
})

// ── CLONE_GITHUB_REPO ──────────────────────────────────────────────

describe('CLONE_GITHUB_REPO', () => {
  beforeEach(() => {
    mod.registerSkillManagerV2IPCHandlers()
    h.execFileSync.mockImplementation((_cmd: string, _args: string[], opts: { cwd: string }) => {
      const repo = path.join(opts.cwd, 'repo')
      fs.mkdirSync(path.join(repo, 'skills', 'demo'), { recursive: true })
      return Buffer.from('')
    })
  })

  function clone(
    url: string,
    branch?: string,
    subPath?: string
  ): Promise<{ success: boolean; localPath?: string; error?: string }> {
    return invoke(SCHEMA_MANAGER_CHANNELS.CLONE_GITHUB_REPO, url, branch, subPath) as Promise<{
      success: boolean; localPath?: string; error?: string
    }>
  }

  it('浅克隆到临时目录下的 repo', async () => {
    const result = await clone('https://github.com/o/r')
    expect(result.success).toBe(true)
    expect(path.basename(result.localPath!)).toBe('repo')
    const [cmd, args, opts] = h.execFileSync.mock.calls[0] as [string, string[], { cwd: string }]
    expect(cmd).toBe('git')
    expect(args).toEqual(['clone', '--depth', '1', '--', 'https://github.com/o/r', 'repo'])
    expect(opts.cwd).toBe(path.dirname(result.localPath!))
  })

  it('指定 branch 时插入 --branch', async () => {
    await clone('https://github.com/o/r', 'dev')
    const [, args] = h.execFileSync.mock.calls[0] as [string, string[]]
    expect(args).toEqual(['clone', '--depth', '1', '--branch', 'dev', '--', 'https://github.com/o/r', 'repo'])
  })

  it('url 前有 -- 分隔，以 - 开头的 url 不会被当成 flag', async () => {
    await clone('-oProxyCommand=evil')
    const [, args] = h.execFileSync.mock.calls[0] as [string, string[]]
    expect(args.indexOf('--')).toBeLessThan(args.indexOf('-oProxyCommand=evil'))
  })

  it('subPath 命中时返回子目录', async () => {
    const result = await clone('https://github.com/o/r', undefined, path.join('skills', 'demo'))
    expect(result.success).toBe(true)
    const [, , opts] = h.execFileSync.mock.calls[0] as [string, string[], { cwd: string }]
    expect(result.localPath).toBe(path.join(opts.cwd, 'repo', 'skills', 'demo'))
    expect(fs.existsSync(result.localPath!)).toBe(true)
  })

  it('subPath 不存在时报 Path not found', async () => {
    const result = await clone('https://github.com/o/r', undefined, 'nope')
    expect(result).toEqual({ success: false, error: 'Path not found: nope' })
  })

  it('git 抛错时返回 error 而不是抛出', async () => {
    h.execFileSync.mockImplementation(() => {
      throw new Error('repository not found')
    })
    expect(await clone('https://github.com/o/missing')).toEqual({
      success: false,
      error: 'repository not found',
    })
  })

  it('抛出非 Error 值时转成字符串', async () => {
    h.execFileSync.mockImplementation(() => {
      throw 42
    })
    expect(await clone('https://github.com/o/r')).toEqual({ success: false, error: '42' })
  })
})