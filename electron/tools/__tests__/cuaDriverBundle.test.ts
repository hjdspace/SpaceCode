// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'

/**
 * CuaDriver.app 的落地。
 *
 * stageAppBundle 是唯一会往系统目录写的路径，所以它只在用户点「安装」时跑到。
 * 这里钉住三件事：
 * - /Applications 不可写时退到 ~/Applications，而不是直接失败；
 * - 用 ditto 复制（保住上游签名），并给 LaunchServices 注册一次 —— `open -a
 *   CuaDriver` 按名字找，没注册上的话驱动的 auto-relaunch 会落空；
 * - 没有内置 bundle 时明确失败，绝不退回"复制个裸二进制凑数"。
 */

const probe = vi.hoisted(() => ({
  existing: new Set<string>(),
  realpaths: new Map<string, string>(),
  mkdirThrows: new Set<string>(),
  execLog: [] as Array<{ cmd: string; args: string[] }>,
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
  execFile: (cmd: string, args: string[], _o: unknown, cb: (err: Error | null) => void) => {
    probe.execLog.push({ cmd, args })
    setImmediate(() => cb(null))
  },
}))

vi.mock('fs', () => ({
  existsSync: (p: string) => probe.existing.has(String(p)),
  mkdirSync: (p: string) => {
    if (probe.mkdirThrows.has(String(p))) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
  },
  realpathSync: (p: string) => {
    const mapped = probe.realpaths.get(String(p))
    if (!mapped) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    return mapped
  },
}))

vi.mock('os', () => ({
  homedir: () => path.join(process.cwd(), 'home'),
}))

const runtime = vi.hoisted(() => ({ isPackaged: false }))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return runtime.isPackaged
    },
    getPath: () => path.join(process.cwd(), 'userdata'),
  },
}))

vi.mock('../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

const HOME = path.join(process.cwd(), 'home')
const APP_BIN = path.join('CuaDriver.app', 'Contents', 'MacOS', 'cua-driver')
/** 与模块里同一个位置 —— 找不到它就该跳过注册这一步，而不是跳过整个落地 */
const LSREGISTER = path.join(
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support',
  'lsregister',
)
const ORIGINAL_RESOURCES = (process as { resourcesPath?: string }).resourcesPath

function appBin(dir: string): string {
  return path.join(dir, APP_BIN)
}

type Bundle = typeof import('../cuaDriverBundle')

async function loadBundle(): Promise<Bundle> {
  vi.resetModules()
  return (await import('../cuaDriverBundle')) as Bundle
}

beforeEach(() => {
  probe.existing.clear()
  probe.realpaths.clear()
  probe.mkdirThrows.clear()
  probe.execLog = []
  runtime.isPackaged = true
  ;(process as { resourcesPath?: string }).resourcesPath = path.join(process.cwd(), 'packed', 'resources')
})

afterEach(() => {
  ;(process as { resourcesPath?: string }).resourcesPath = ORIGINAL_RESOURCES
})

describe('isInsideCuaDriverApp', () => {
  it('follows a symlink into the bundle rather than trusting the link path', async () => {
    const { isInsideCuaDriverApp } = await loadBundle()
    const link = path.join(HOME, '.local', 'bin', 'cua-driver')
    probe.realpaths.set(link, appBin('/Applications'))

    expect(isInsideCuaDriverApp(link)).toBe(true)
  })

  it('rejects a same-named binary that resolves outside any bundle', async () => {
    const { isInsideCuaDriverApp } = await loadBundle()
    const link = path.join(HOME, '.local', 'bin', 'cua-driver')
    probe.realpaths.set(link, path.join('/opt', 'tools', 'cua-driver'))

    expect(isInsideCuaDriverApp(link)).toBe(false)
  })

  it('rejects a path that does not resolve at all', async () => {
    const { isInsideCuaDriverApp } = await loadBundle()

    expect(isInsideCuaDriverApp(path.join('/nope', 'cua-driver'))).toBe(false)
  })
})

describe('stageAppBundle', () => {
  const staged = appBin('/Applications')

  beforeEach(() => {
    // 内置副本，落地来源
    probe.existing.add(
      path.join(process.cwd(), 'packed', 'resources', 'cua-driver', APP_BIN),
    )
  })

  it('copies into /Applications and registers it with LaunchServices', async () => {
    const { stageAppBundle } = await loadBundle()
    probe.existing.add(staged)
    probe.existing.add(LSREGISTER)

    const result = await stageAppBundle()

    expect(result.ok).toBe(true)
    expect(result.binaryPath).toBe(staged)
    const ditto = probe.execLog.find((c) => c.cmd === 'ditto')
    expect(ditto?.args).toEqual([
      path.join(process.cwd(), 'packed', 'resources', 'cua-driver', 'CuaDriver.app'),
      path.join('/Applications', 'CuaDriver.app'),
    ])
    // 不注册的话 `open -a CuaDriver` 找不到它，驱动的 auto-relaunch 就落空
    expect(probe.execLog.find((c) => c.cmd === LSREGISTER)?.args).toEqual([
      '-f',
      path.join('/Applications', 'CuaDriver.app'),
    ])
  })

  it('still stages when lsregister is unavailable', async () => {
    const { stageAppBundle } = await loadBundle()
    probe.existing.add(staged)

    const result = await stageAppBundle()

    expect(result.ok).toBe(true)
    expect(probe.execLog.some((c) => c.cmd === LSREGISTER)).toBe(false)
  })

  it('falls back to ~/Applications when /Applications is not writable', async () => {
    const { stageAppBundle } = await loadBundle()
    probe.mkdirThrows.add('/Applications')
    const userStaged = appBin(path.join(HOME, 'Applications'))
    probe.existing.add(userStaged)

    const result = await stageAppBundle()

    expect(result.ok).toBe(true)
    expect(result.appDir).toBe(path.join(HOME, 'Applications', 'CuaDriver.app'))
  })

  it('fails loudly instead of leaving a bare binary behind', async () => {
    const { stageAppBundle } = await loadBundle()
    probe.mkdirThrows.add('/Applications')
    probe.mkdirThrows.add(path.join(HOME, 'Applications'))

    const result = await stageAppBundle()

    expect(result.ok).toBe(false)
    expect(result.error).toContain('EACCES')
  })

  it('reports no bundled payload when the app ships none', async () => {
    const { stageAppBundle } = await loadBundle()
    probe.existing.clear()

    const result = await stageAppBundle()

    expect(result.ok).toBe(false)
    expect(result.error).toContain('CuaDriver.app')
    expect(probe.execLog.filter((c) => c.cmd === 'ditto')).toHaveLength(0)
  })

  it('refuses a copy that lands without an inner binary', async () => {
    const { stageAppBundle } = await loadBundle()
    // ditto "成功"但 Contents/MacOS/cua-driver 不在 —— 半个 bundle 比没有更糟
    probe.existing.delete(staged)

    const result = await stageAppBundle()

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Contents/MacOS/cua-driver')
  })
})
