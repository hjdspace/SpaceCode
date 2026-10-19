// @vitest-environment node
/**
 * Hooks 作用域文件必须落在渲染进程显式传入的项目根下。
 *
 * 原实现（issue #41 第 7 项）用 `(global as any).__projectCwd ?? process.cwd()`
 * 定位 project/local 根，而 `__projectCwd` 全仓从未赋值 —— 于是"从目录 A 启动、
 * 给项目 B 保存项目级 Hook"会写到 A，并在 A 下 mkdirSync 出一个凭空 .claude。
 * 这里把进程 cwd 当成"启动目录 A"，把显式参数当成"项目 B"：
 * B 有文件、A 连目录都不许出现，才算修好。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

const probe = vi.hoisted(() => ({
  ipcHandlers: {} as Record<string, (...args: unknown[]) => unknown>,
  home: '',
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      probe.ipcHandlers[channel] = handler
    }),
    on: vi.fn(),
  },
  app: { getPath: () => probe.home },
  shell: {},
}))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))
vi.mock('../../infra/proxyManager', () => ({
  proxyManager: { isRunning: () => false, stop: vi.fn(), start: vi.fn(), updateConfig: vi.fn() },
  buildProxyConfigFromSettings: vi.fn(() => null),
}))
vi.mock('../../session/tokenStatsService', () => ({
  aggregateLocalTokenStats: vi.fn(() => []),
}))

import { registerSettingsIPCHandlers } from '../settingsIpc'

const HOOKS_JSON = JSON.stringify({
  Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo hi' }] }],
})

interface HooksResult { success: boolean; data?: string | null; error?: string }

function callHooks(channel: 'settings:loadHooksSettings' | 'settings:saveHooksSettings', ...args: unknown[]): Promise<HooksResult> {
  return Promise.resolve(probe.ipcHandlers[channel](undefined, ...args)) as Promise<HooksResult>
}

const tmpDirs: string[] = []
const originalCwd = process.cwd()
function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`))
  tmpDirs.push(dir)
  return dir
}

let dirA: string
let dirB: string

beforeAll(() => {
  registerSettingsIPCHandlers()
})

beforeEach(() => {
  // A = 程序启动目录（原缺陷的落点），B = 当前打开的项目
  dirA = mkTmp('hooks-scope-A')
  dirB = mkTmp('hooks-scope-B')
  probe.home = mkTmp('hooks-scope-home')
  process.chdir(dirA)
})

afterEach(() => {
  process.chdir(originalCwd)
})

afterAll(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function projectSettings(scope: 'project' | 'local', root: string): string {
  return path.join(root, '.claude', scope === 'project' ? 'settings.json' : 'settings.local.json')
}

describe('settings hooks scope path', () => {
  it('scope=project 写入显式项目根，启动目录下不产生任何文件', async () => {
    const res = await callHooks('settings:saveHooksSettings', HOOKS_JSON, 'project', dirB)

    expect(res).toEqual({ success: true })
    const written = JSON.parse(fs.readFileSync(projectSettings('project', dirB), 'utf-8'))
    expect(written.hooks.Stop[0].hooks[0].command).toBe('echo hi')
    expect(fs.existsSync(path.join(dirA, '.claude'))).toBe(false)
  })

  it('scope=local 写入项目根下的 settings.local.json', async () => {
    const res = await callHooks('settings:saveHooksSettings', HOOKS_JSON, 'local', dirB)

    expect(res).toEqual({ success: true })
    expect(fs.existsSync(projectSettings('local', dirB))).toBe(true)
    expect(fs.existsSync(path.join(dirA, '.claude'))).toBe(false)
  })

  it('保存保留目标项目 settings.json 里的其它字段', async () => {
    fs.mkdirSync(path.join(dirB, '.claude'), { recursive: true })
    fs.writeFileSync(
      projectSettings('project', dirB),
      JSON.stringify({ permissions: { allow: ['Bash'] }, model: 'keep-me' }, null, 2),
      'utf-8',
    )

    await callHooks('settings:saveHooksSettings', HOOKS_JSON, 'project', dirB)

    const written = JSON.parse(fs.readFileSync(projectSettings('project', dirB), 'utf-8'))
    expect(written.permissions).toEqual({ allow: ['Bash'] })
    expect(written.model).toBe('keep-me')
  })

  it('scope=user 用用户主目录，不需要项目根', async () => {
    const res = await callHooks('settings:saveHooksSettings', HOOKS_JSON, 'user', '')

    expect(res).toEqual({ success: true })
    const userPath = path.join(probe.home, '.claude', 'settings.json')
    expect(JSON.parse(fs.readFileSync(userPath, 'utf-8')).hooks).toBeTruthy()
    expect(fs.existsSync(path.join(dirA, '.claude'))).toBe(false)
  })

  it('缺少项目根时 project/local 明确失败且不写盘', async () => {
    for (const scope of ['project', 'local'] as const) {
      const res = await callHooks('settings:saveHooksSettings', HOOKS_JSON, scope, '')

      expect(res.success).toBe(false)
      expect(res.error).toBeTruthy()
    }
    expect(fs.existsSync(path.join(dirA, '.claude'))).toBe(false)
    expect(fs.existsSync(path.join(dirB, '.claude'))).toBe(false)
  })

  it('拒绝相对项目根，避免落到进程 cwd', async () => {
    const res = await callHooks('settings:saveHooksSettings', HOOKS_JSON, 'project', 'relative/dir')

    expect(res.success).toBe(false)
    expect(fs.existsSync(path.join(dirA, '.claude'))).toBe(false)
    expect(fs.existsSync(path.join(dirA, 'relative'))).toBe(false)
  })

  it('项目根已失效（目录不存在）时保存与读取都明确失败，不凭空造出目录树', async () => {
    const stale = path.join(dirB, 'project-was-deleted')

    const saved = await callHooks('settings:saveHooksSettings', HOOKS_JSON, 'project', stale)
    const loaded = await callHooks('settings:loadHooksSettings', 'project', stale)

    expect(saved.success).toBe(false)
    expect(saved.error).toBeTruthy()
    expect(loaded.success).toBe(false)
    expect(fs.existsSync(stale)).toBe(false)
  })

  it('load 从显式项目根读取，而不是启动目录', async () => {
    fs.mkdirSync(path.join(dirB, '.claude'), { recursive: true })
    fs.writeFileSync(projectSettings('project', dirB), JSON.stringify({ hooks: JSON.parse(HOOKS_JSON) }), 'utf-8')
    fs.mkdirSync(path.join(dirA, '.claude'), { recursive: true })
    fs.writeFileSync(
      projectSettings('project', dirA),
      JSON.stringify({ hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'from-A' }] }] } }),
      'utf-8',
    )

    const res = await callHooks('settings:loadHooksSettings', 'project', dirB)

    expect(res.success).toBe(true)
    expect(res.data).toContain('echo hi')
    expect(res.data).not.toContain('from-A')
  })

  it('load 在缺少项目根时明确失败', async () => {
    const res = await callHooks('settings:loadHooksSettings', 'local', '')

    expect(res.success).toBe(false)
    expect(res.error).toBeTruthy()
  })
})
