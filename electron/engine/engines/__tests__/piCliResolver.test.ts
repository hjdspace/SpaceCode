// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as path from 'path'

/**
 * issue #52：打包态曾经一路 fall through 到用户全局 `pi`，引擎版本由用户机器说了算。
 * 这个模块是唯一的 pi CLI 解析入口 —— PiEngine 的可用性、PiSessionProcess 的 spawn、
 * 界面的「能力可用」声明全部读它，三者不再各算一套候选序列。
 *
 * 两条契约：
 *   - packaged 只认随产物走的那份 bundled pi（resources/pi/dist/bundle/cli.js），
 *     找不到就 fail closed，绝不为了「能跑起来」去碰全局 pi / npx。
 *   - 「可用」= 拿到了具体版本号且 >= MIN_PI_VERSION。版本无从核验（npx、package.json
 *     读不到、探针失败）一律算不可用 —— 界面不能声称能力可用。
 */

const RESOURCES = '/app/resources'
const SRC_DIR = path.resolve(__dirname, '..')
const DEV_CLI_1 = path.resolve(SRC_DIR, '..', '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const DEV_CLI_2 = path.resolve(SRC_DIR, '..', '..', '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const APP_CLI = path.join('/app/root', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const APP_MONOREPO_CLI = path.join('/app/root', 'pi-engine', 'packages', 'coding-agent', 'dist', 'cli.js')
const BUNDLED_CLI = path.join(RESOURCES, 'pi', 'dist', 'bundle', 'cli.js')
const BUNDLED_PKG_JSON = path.join(RESOURCES, 'pi', 'package.json')
/** 旧打包布局的产物：node_modules 副本 + 全局查找，packaged 分支都不该再看 */
const LEGACY_UNPACKED_CLI = path.join(RESOURCES, 'app.asar.unpacked', 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
const GLOBAL_PI = 'C:\\tools\\pi.exe'

const H = vi.hoisted(() => ({
  existing: new Set<string>(),
  files: new Map<string, string>(),
  isPackaged: false,
  appPath: '/app/root',
  lookupCalls: [] as string[],
  lookupResult: null as string | null,
  versionProbeCalls: [] as string[][],
  versionProbeResult: null as string | null,
  versionProbeThrows: false,
}))

vi.mock('fs', () => ({
  existsSync: (p: unknown) => H.existing.has(String(p)),
  readFileSync: (p: unknown) => {
    const key = String(p)
    if (!H.files.has(key)) throw new Error(`ENOENT: no such file or directory, open '${key}'`)
    return H.files.get(key) as string
  },
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return H.isPackaged
    },
    getAppPath: () => H.appPath,
  },
}))

vi.mock('child_process', () => ({
  execSync: (cmd: string) => {
    H.lookupCalls.push(cmd)
    if (H.lookupResult === null) throw new Error(`${cmd} exited with code 1`)
    return H.lookupResult
  },
  execFileSync: (file: string, args: string[]) => {
    H.versionProbeCalls.push([file, ...args])
    if (H.versionProbeThrows) throw new Error('spawn ENOENT')
    if (H.versionProbeResult === null) throw new Error(`${file} exited with code 1`)
    return H.versionProbeResult
  },
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

const ORIGINAL_PLATFORM = process.platform

async function loadResolver() {
  return import('../piCliResolver')
}

function bundledPackageJson(version: string): void {
  H.files.set(BUNDLED_PKG_JSON, JSON.stringify({ name: '@earendil-works/pi-coding-agent', version }))
}

/** 平台只影响 `where`/`which` 与命令拼法，用例里临时切换再还原 */
async function onPlatform(platform: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    await run()
  } finally {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
  }
}

function devPackageJson(cli: string, version: string): void {
  H.files.set(path.join(path.dirname(path.dirname(cli)), 'package.json'), JSON.stringify({ version }))
}

beforeEach(() => {
  vi.resetModules()
  H.existing = new Set()
  H.files = new Map()
  H.isPackaged = false
  H.appPath = '/app/root'
  H.lookupCalls = []
  H.lookupResult = null
  H.versionProbeCalls = []
  H.versionProbeResult = null
  H.versionProbeThrows = false
  Object.defineProperty(process, 'resourcesPath', { value: RESOURCES, configurable: true })
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true })
})

describe('packaged — 只认随产物走的 bundled pi', () => {
  it('用 resources/pi 里的那份，并且根本不查询全局 pi', async () => {
    H.isPackaged = true
    H.existing.add(BUNDLED_CLI).add(LEGACY_UNPACKED_CLI).add(GLOBAL_PI)
    H.lookupResult = `${GLOBAL_PI}\n`
    H.versionProbeResult = '9.9.9'
    bundledPackageJson('1.3.0')

    const { detectPiCli } = await loadResolver()
    const info = detectPiCli()

    expect(info).toMatchObject({ entry: BUNDLED_CLI, source: 'bundled', version: '1.3.0', available: true, reason: 'ok' })
    expect(H.lookupCalls).toEqual([])
    expect(H.versionProbeCalls).toEqual([])
  })

  it('bundled 缺失时直接判不可用，不 fall through 到全局 pi 也不 fall through 到旧 asar 副本', async () => {
    H.isPackaged = true
    H.existing.add(LEGACY_UNPACKED_CLI).add(GLOBAL_PI)
    globalLookupPi()

    const { detectPiCli } = await loadResolver()
    expect(detectPiCli()).toMatchObject({ entry: null, available: false, reason: 'not-found' })
    expect(H.lookupCalls).toEqual([])
  })

  it('resourcesPath 缺失也不抛，按不可用收口', async () => {
    H.isPackaged = true
    Object.defineProperty(process, 'resourcesPath', { value: undefined, configurable: true })
    globalLookupPi()

    const { detectPiCli } = await loadResolver()
    expect(detectPiCli()).toMatchObject({ entry: null, available: false, reason: 'not-found' })
  })

  it('版本低于下限时按不可用收口', async () => {
    H.isPackaged = true
    H.existing.add(BUNDLED_CLI)
    bundledPackageJson('0.73.0')

    const { detectPiCli, MIN_PI_VERSION } = await loadResolver()
    expect(detectPiCli()).toMatchObject({ version: '0.73.0', available: false, reason: 'version-too-old' })
    expect(MIN_PI_VERSION).toBe('1.1.0')
  })

  it('1.0.x 低于扩展 peer 下限，1.1.0 起恢复可用', async () => {
    H.isPackaged = true
    H.existing.add(BUNDLED_CLI)

    bundledPackageJson('1.0.4')
    const { detectPiCli } = await loadResolver()
    expect(detectPiCli()).toMatchObject({ version: '1.0.4', available: false, reason: 'version-too-old' })

    bundledPackageJson('1.1.0')
    expect(detectPiCli()).toMatchObject({ version: '1.1.0', available: true, reason: 'ok' })
  })

  it('读不到 package.json 版本时按不可用收口 —— bundled 副本必须连 package.json 一起带', async () => {
    H.isPackaged = true
    H.existing.add(BUNDLED_CLI)

    const { detectPiCli } = await loadResolver()
    expect(detectPiCli()).toMatchObject({ entry: BUNDLED_CLI, version: null, available: false, reason: 'version-unknown' })
    expect(H.versionProbeCalls).toEqual([])
  })

  it('package.json 坏了与版本非法都收口成 version-unknown', async () => {
    H.isPackaged = true
    H.existing.add(BUNDLED_CLI)
    H.files.set(BUNDLED_PKG_JSON, '{ not json')
    const { detectPiCli } = await loadResolver()
    expect(detectPiCli()).toMatchObject({ available: false, reason: 'version-unknown' })

    H.files.set(BUNDLED_PKG_JSON, JSON.stringify({ version: 'next' }))
    expect(detectPiCli()).toMatchObject({ available: false, reason: 'version-unknown' })
  })
})

describe('dev — 候选序列与旧实现一致', () => {
  it('编译产物旁的 node_modules 副本优先，其次更外一层', async () => {
    const { detectPiCli } = await loadResolver()
    H.existing.add(DEV_CLI_1).add(DEV_CLI_2)
    devPackageJson(DEV_CLI_1, '1.3.0')
    expect(detectPiCli()).toMatchObject({ entry: DEV_CLI_1, source: 'dev', available: true })

    H.existing = new Set([DEV_CLI_2])
    devPackageJson(DEV_CLI_2, '1.3.0')
    expect(detectPiCli()).toMatchObject({ entry: DEV_CLI_2, source: 'dev', available: true })
  })

  it('dev 才看 app 路径与本地 pi-engine 仓库，且装的包优先于仓库副本', async () => {
    H.existing.add(APP_CLI).add(APP_MONOREPO_CLI)
    devPackageJson(APP_CLI, '1.3.0')
    const { detectPiCli } = await loadResolver()
    expect(detectPiCli().entry).toBe(APP_CLI)

    H.existing = new Set([APP_MONOREPO_CLI])
    devPackageJson(APP_MONOREPO_CLI, '1.3.0')
    expect(detectPiCli().entry).toBe(APP_MONOREPO_CLI)
  })

  it('cwd 相对路径兜底', async () => {
    const cwdCli = path.join(process.cwd(), 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js')
    H.existing.add(cwdCli)
    devPackageJson(cwdCli, '1.3.0')
    const { detectPiCli } = await loadResolver()
    expect(detectPiCli()).toMatchObject({ entry: cwdCli, source: 'dev', available: true })
  })

  it('全局 pi 靠 --version 探针定版本', async () => {
    globalLookupPi()
    H.versionProbeResult = '1.3.0\n'

    const { detectPiCli } = await loadResolver()
    const info = detectPiCli()

    expect(info).toMatchObject({ entry: 'pi', source: 'installed', version: '1.3.0', available: true, reason: 'ok' })
    expect(H.versionProbeCalls).toEqual([['pi', '--version']])
  })

  it('全局 pi 版本过低或探针失败都判不可用', async () => {
    globalLookupPi()
    H.versionProbeResult = '0.73.1\n'
    const { detectPiCli, resetPiCliProbeCache } = await loadResolver()
    expect(detectPiCli()).toMatchObject({ source: 'installed', available: false, reason: 'version-too-old' })

    // 换一轮检测：探针失败必须收口成无从核验，而不是沿用上一轮缓存里的版本
    resetPiCliProbeCache()
    H.versionProbeResult = null
    expect(detectPiCli()).toMatchObject({ available: false, reason: 'version-unknown' })
  })

  it('找不到任何候选时不返回 npx —— npx 拉的版本没人管，按不可用收口', async () => {
    const { detectPiCli } = await loadResolver()
    expect(detectPiCli()).toMatchObject({ entry: null, available: false, reason: 'not-found' })
  })
})

describe('版本探针的缓存', () => {
  it('同一个入口只探针一次，换了入口再探', async () => {
    globalLookupPi()
    H.versionProbeResult = '1.3.0\n'
    const { detectPiCli, resetPiCliProbeCache } = await loadResolver()

    detectPiCli()
    detectPiCli()
    expect(H.versionProbeCalls).toHaveLength(1)

    resetPiCliProbeCache()
    detectPiCli()
    expect(H.versionProbeCalls).toHaveLength(2)
  })
})

describe('piShellCommand — 终端里跑的就是应用要 spawn 的那个', () => {
  it('Windows 上用宿主 runtime 跑脚本入口，路径带引号', async () => {
    H.isPackaged = true
    H.existing.add(BUNDLED_CLI)
    bundledPackageJson('1.3.0')

    await onPlatform('win32', async () => {
      const { piShellCommand } = await loadResolver()
      expect(piShellCommand()).toBe(`set ELECTRON_RUN_AS_NODE=1&& "${process.execPath}" "${BUNDLED_CLI}"`)
    })
  })

  it('posix 用内联环境变量前缀', async () => {
    H.isPackaged = true
    H.existing.add(BUNDLED_CLI)
    bundledPackageJson('1.3.0')

    await onPlatform('linux', async () => {
      const { piShellCommand } = await loadResolver()
      expect(piShellCommand()).toBe(`ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${BUNDLED_CLI}"`)
    })
  })

  it('本机全局 pi 直接回命令名，不套 runtime', async () => {
    globalLookupPi()
    H.versionProbeResult = '1.3.0\n'
    const { piShellCommand } = await loadResolver()

    expect(piShellCommand()).toBe('pi')
  })

  it('什么都解析不到时回 null —— 调用方不能退去 npx 拉第三个版本', async () => {
    const { piShellCommand } = await loadResolver()

    expect(piShellCommand()).toBeNull()
  })
})

describe('isVersionGte — 能力下限比较', () => {  const cases: Array<[string, string, boolean]> = [
    ['1.3.0', '1.0.0', true],
    ['1.0.0', '1.0.0', true],
    ['0.80.6', '1.0.0', false],
    ['1.10.0', '1.9.9', true],
    ['1', '1.0.1', false],
    ['v1.3.0', '1.0.0', true],
    ['1.3.0-beta.1', '1.0.0', true],
    ['latest', '1.0.0', false],
    ['', '1.0.0', false],
  ]

  it.each(cases)('%s >= %s ? %s', async (version, floor, expected) => {
    const { isVersionGte } = await loadResolver()
    expect(isVersionGte(version, floor)).toBe(expected)
  })
})

function globalLookupPi(): void {
  H.lookupResult = `${GLOBAL_PI}\n`
  H.existing.add(GLOBAL_PI)
}
