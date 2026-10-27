// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 引擎 spawn 前的机器探测快照（注册表 PATH / Python 位置 / Git Bash）。
 *
 * 这段逻辑原先是 SessionProcess 的私有方法，函数体里 `require('child_process')`
 * —— vi.mock 打不进去，所以单测只能强制 `process.platform='linux'` 把它整个绕开，
 * 四条 Windows 分支一条都没被覆盖过。搬到独立模块并改成顶层 import + 异步
 * execFile 之后，这里钉的是它真正的行为：
 *   - 合并顺序 system → user → 进程 PATH，按大小写不敏感去重（注册表里是
 *     REG_EXPAND_SZ，%VAR% 必须先展开，否则引擎的 bash 工具拿到的是字面量）；
 *   - 探测结果按 TTL 复用，且并发会话共享同一次在飞探测 —— 这是这次优化的全部
 *     意义所在，一旦哪天有人把缓存摘了或让两个会话各扫一遍注册表，这里会红；
 *   - 探测失败不能让 PATH 变差：reg 挂了宁可退回继承的进程 PATH；
 *   - 非 Windows 一个子进程都不起。
 */

const runtime = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: string[] }>,
  stdout: new Map<string, string>(),
  failAll: false,
}))

vi.mock('child_process', () => ({
  execFile: (command: string, args: string[], _opts: any, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    runtime.calls.push({ command, args })
    const key = `${command} ${args.join(' ')}`
    if (runtime.failAll) {
      cb(new Error('boom'), '', '')
      return
    }
    cb(null, runtime.stdout.get(key) ?? '', '')
  },
}))

const fsp = vi.hoisted(() => ({
  files: new Set<string>(),
  dirs: new Map<string, string[]>(),
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => fsp.files.has(String(p)),
  readdirSync: (p: unknown) => {
    const entries = fsp.dirs.get(String(p))
    if (!entries) throw new Error('ENOENT')
    return entries
  },
}))

vi.mock('os', () => ({ homedir: () => 'C:\\Users\\u' }))

vi.mock('../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  processRaw: vi.fn(), sdkMessage: vi.fn(), setSessionLogPath: vi.fn(), traceEvent: vi.fn(),
}))

const SYSTEM_HIVE = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'
const USER_HIVE = 'HKCU\\Environment'
const SYSTEM_REG_KEY = `reg query ${SYSTEM_HIVE} /v Path`
const USER_REG_KEY = `reg query ${USER_HIVE} /v Path`

/** 每次都要一个干净的模块实例：缓存与在飞 promise 都是模块级状态。 */
async function loadFresh() {
  vi.resetModules()
  return import('../spawnEnvironment')
}

function regLine(value: string): string {
  return `    Path    REG_EXPAND_SZ    ${value}\r\n`
}

const originalPlatform = process.platform
const savedPath = process.env.PATH
const savedLocalAppData = process.env.LOCALAPPDATA
const savedGitBash = process.env.CLAUDE_CODE_GIT_BASH_PATH

beforeEach(() => {
  vi.clearAllMocks()
  runtime.calls.length = 0
  runtime.stdout.clear()
  runtime.failAll = false
  fsp.files = new Set()
  fsp.dirs = new Map()
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
  process.env.PATH = 'C:\\Windows;C:\\app'
  delete process.env.LOCALAPPDATA
  delete process.env.CLAUDE_CODE_GIT_BASH_PATH
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  process.env.PATH = savedPath
  if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA
  else process.env.LOCALAPPDATA = savedLocalAppData
  if (savedGitBash === undefined) delete process.env.CLAUDE_CODE_GIT_BASH_PATH
  else process.env.CLAUDE_CODE_GIT_BASH_PATH = savedGitBash
})

describe('spawnEnvironment — 注册表 PATH 合并', () => {
  it('按 system → user → 进程 PATH 的顺序合并，大小写不敏感去重，并展开 %VAR%', async () => {
    runtime.stdout.set(SYSTEM_REG_KEY, regLine('C:\\Windows\\system32'))
    runtime.stdout.set(USER_REG_KEY, regLine('%USERPROFILE%\\Tools;C:\\Windows'))
    process.env.USERPROFILE = 'C:\\Users\\u'

    const { getSpawnEnvironment } = await loadFresh()
    const snapshot = await getSpawnEnvironment()

    expect(snapshot.path?.split(';')).toEqual([
      'C:\\Windows\\system32',
      'C:\\Users\\u\\Tools',
      'C:\\Windows',
      'C:\\app',
    ])
  })

  it('注册表读不到时不破坏继承的 PATH —— 引擎的 bash 工具照样可用', async () => {
    runtime.stdout.set(SYSTEM_REG_KEY, '')
    runtime.stdout.set(USER_REG_KEY, '')

    const { getSpawnEnvironment } = await loadFresh()
    const snapshot = await getSpawnEnvironment()

    expect(snapshot.path).toBe('C:\\Windows;C:\\app')
  })

  it('reg query 整体失败也不能让 spawn 抛错', async () => {
    runtime.failAll = true

    const { getSpawnEnvironment } = await loadFresh()
    await expect(getSpawnEnvironment()).resolves.toMatchObject({ gitBashPath: null })
  })

  it('非 Windows 一个子进程都不起', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    const { getSpawnEnvironment } = await loadFresh()
    const snapshot = await getSpawnEnvironment()

    expect(snapshot).toEqual({ path: null, gitBashPath: null })
    expect(runtime.calls).toEqual([])
  })
})

describe('spawnEnvironment — 探测结果复用', () => {
  it('TTL 内第二次 spawn 不再起探测子进程（这次优化的全部意义）', async () => {
    runtime.stdout.set(SYSTEM_REG_KEY, regLine('C:\\Windows\\system32'))
    runtime.stdout.set(USER_REG_KEY, regLine('C:\\Users\\u\\Tools'))

    const { getSpawnEnvironment } = await loadFresh()
    await getSpawnEnvironment()
    const callsAfterFirst = runtime.calls.length
    const again = await getSpawnEnvironment()

    expect(callsAfterFirst).toBeGreaterThan(0)
    expect(runtime.calls).toHaveLength(callsAfterFirst)
    expect(again.path).toContain('C:\\Users\\u\\Tools')
  })

  it('并发拉起多个会话时共享同一次在飞探测', async () => {
    runtime.stdout.set(SYSTEM_REG_KEY, regLine('C:\\Windows\\system32'))
    runtime.stdout.set(USER_REG_KEY, regLine('C:\\Users\\u\\Tools'))

    const { getSpawnEnvironment } = await loadFresh()
    const [a, b] = await Promise.all([getSpawnEnvironment(), getSpawnEnvironment()])

    expect(a).toEqual(b)
    // 系统 + 用户两条 PATH 查询各一次，而不是每个会话各扫一遍
    expect(runtime.calls.filter(c => c.command === 'reg')).toHaveLength(2)
  })
})

describe('spawnEnvironment — Git Bash 定位', () => {
  it('命中固定安装路径时不起 where 子进程', async () => {
    fsp.files.add('C:\\Program Files\\Git\\bin\\bash.exe')

    const { getSpawnEnvironment } = await loadFresh()
    const snapshot = await getSpawnEnvironment()

    expect(snapshot.gitBashPath).toBe('C:\\Program Files\\Git\\bin\\bash.exe')
    expect(runtime.calls.filter(c => c.command === 'where')).toHaveLength(0)
  })

  it('常见路径都没有才查 where git，并从 git.exe 位置推 bin/bash.exe', async () => {
    fsp.files.add('D:\\Git\\bin\\bash.exe')
    runtime.stdout.set('where git', 'D:\\Git\\cmd\\git.exe\r\n')

    const { getSpawnEnvironment } = await loadFresh()
    const snapshot = await getSpawnEnvironment()

    expect(snapshot.gitBashPath).toBe('D:\\Git\\bin\\bash.exe')
  })

  it('用户已经指定 CLAUDE_CODE_GIT_BASH_PATH 时直接采信，不覆盖成别处', async () => {
    fsp.files.add('E:\\custom\\bash.exe')
    process.env.CLAUDE_CODE_GIT_BASH_PATH = 'E:\\custom\\bash.exe'

    const { getSpawnEnvironment } = await loadFresh()
    const snapshot = await getSpawnEnvironment()

    expect(snapshot.gitBashPath).toBe('E:\\custom\\bash.exe')
    expect(runtime.calls.filter(c => c.command === 'where')).toHaveLength(0)
  })
})

describe('spawnEnvironment — 未加入 PATH 的 Python', () => {
  it('把没在 PATH 上的 Python 目录前置进去（安装时没勾 Add to PATH 的情况）', async () => {
    runtime.stdout.set(SYSTEM_REG_KEY, regLine('C:\\Windows\\system32'))
    runtime.stdout.set(USER_REG_KEY, regLine('C:\\Users\\u\\Tools'))
    process.env.LOCALAPPDATA = 'C:\\Users\\u\\AppData\\Local'
    fsp.dirs.set('C:\\Users\\u\\AppData\\Local\\Programs\\Python', ['Python312'])
    fsp.files.add('C:\\Users\\u\\AppData\\Local\\Programs\\Python\\Python312\\python.exe')

    const { getSpawnEnvironment } = await loadFresh()
    const snapshot = await getSpawnEnvironment()

    expect(snapshot.path?.startsWith('C:\\Users\\u\\AppData\\Local\\Programs\\Python\\Python312;')).toBe(true)
  })

  it('已经在 PATH 上的 Python 不重复前置', async () => {
    const pyDir = 'C:\\Users\\u\\AppData\\Local\\Programs\\Python\\Python312'
    process.env.PATH = `C:\\Windows;${pyDir}`
    process.env.LOCALAPPDATA = 'C:\\Users\\u\\AppData\\Local'
    fsp.dirs.set('C:\\Users\\u\\AppData\\Local\\Programs\\Python', ['Python312'])
    fsp.files.add(`${pyDir}\\python.exe`)

    const { getSpawnEnvironment } = await loadFresh()
    const snapshot = await getSpawnEnvironment()

    expect(snapshot.path?.split(';').filter(p => p === pyDir)).toHaveLength(1)
  })
})
