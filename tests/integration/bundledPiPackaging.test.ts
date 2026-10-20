// @vitest-environment node
/**
 * 打包配置与运行时解析器之间的那道缝 (issue #52)。
 *
 * 两边各写对一半就等于都写错：electron-builder 把 bundled pi 搬到 resources/<to>，
 * 而主进程按另一个路径去找 —— 找不到就一路 fall through 到用户全局装的 pi，
 * 引擎版本由不得 package.json。这类漂移不报类型错，也不会在 dev 里露头，
 * 只有真打包 + 真装机才看得见，所以这里按 build 配置摆一个假的 resources 目录，
 * 把两边钉成同一个字符串。
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const PI_SOURCE = 'node_modules/@earendil-works/pi-coding-agent'
const PI_PACKAGE = '@earendil-works/pi-coding-agent'

interface ExtraResourceEntry { from: string; to: string; filter?: string[] }

const PKG = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies: Record<string, string>
  build: { files: string[]; asarUnpack: string[]; extraResources: Array<string | ExtraResourceEntry> }
}

const PI_VERSION = (JSON.parse(fs.readFileSync(path.join(REPO_ROOT, PI_SOURCE, 'package.json'), 'utf8')) as { version: string }).version

const H = vi.hoisted(() => ({ globalLookupCalls: 0 }))

// 打包态一次都不该去 shell out 找全局 pi；mock 掉是为了让「有没有调」可断言
vi.mock('child_process', () => ({
  execSync: () => {
    H.globalLookupCalls += 1
    return ''
  },
  execFileSync: () => {
    H.globalLookupCalls += 1
    return ''
  },
  spawn: vi.fn(),
}))

vi.mock('@electron/infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

const piBuildEntry = PKG.build.extraResources.find(
  (entry): entry is ExtraResourceEntry => typeof entry === 'object' && entry.from === PI_SOURCE,
)

/** 假的安装目录：只摆出 extraResources 会落成的那部分 */
const STAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-pi-stage-'))
afterAll(() => fs.rmSync(STAGE_ROOT, { recursive: true, force: true }))

function stageBundledPi(): { resourcesPath: string; stagedCli: string } {
  const resourcesPath = path.join(STAGE_ROOT, 'resources')
  const staged = path.join(resourcesPath, piBuildEntry!.to)
  fs.mkdirSync(path.join(staged, 'dist', 'bundle'), { recursive: true })
  fs.copyFileSync(path.join(REPO_ROOT, PI_SOURCE, 'package.json'), path.join(staged, 'package.json'))
  fs.copyFileSync(path.join(REPO_ROOT, PI_SOURCE, 'dist', 'bundle', 'cli.js'), path.join(staged, 'dist', 'bundle', 'cli.js'))
  return { resourcesPath, stagedCli: path.join(staged, 'dist', 'bundle', 'cli.js') }
}

async function loadResolverPackaged(resourcesPath: string) {
  vi.resetModules()
  vi.doMock('electron', () => ({ app: { isPackaged: true, getAppPath: () => path.join(resourcesPath, 'app.asar') } }))
  Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true })
  return import('@electron/engine/engines/piCliResolver')
}

describe('pi 的打包产物布局', () => {
  it('pi 是 devDependency：留在 dependencies 会让它的依赖闭包塞满 asar', () => {
    expect(Object.keys(PKG.dependencies ?? {}), `dependencies 仍含 ${PI_PACKAGE}`).not.toContain(PI_PACKAGE)
    expect(PKG.devDependencies[PI_PACKAGE]).toBeTruthy()
  })

  it('build.files 与 asarUnpack 都不再带 pi 的 node_modules 副本', () => {
    expect(PKG.build.files.filter(p => p.includes('@earendil-works'))).toEqual([])
    expect(PKG.build.asarUnpack.filter(p => p.includes('@earendil-works'))).toEqual([])
  })

  it('extraResources 同时搬 bundle 与 package.json —— 只搬 bundle 会报出错版本', () => {
    expect(piBuildEntry, `extraResources 缺 from=${PI_SOURCE}`).toBeDefined()
    expect(piBuildEntry!.filter).toEqual(expect.arrayContaining(['package.json', 'dist/bundle/**/*']))

    // 源真的在盘上：规则写对而目录不存在，只会搬出个空 resources/pi
    for (const rel of ['package.json', path.join('dist', 'bundle', 'cli.js')]) {
      expect(fs.existsSync(path.join(REPO_ROOT, PI_SOURCE, rel)), `${PI_SOURCE}/${rel} 不存在`).toBe(true)
    }
    // 上游自己也拿 dist/bundle/cli.js 当发行入口，才敢把这份副本当成能独立跑的东西
    const piPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, PI_SOURCE, 'package.json'), 'utf8')) as { bin: Record<string, string> }
    expect(piPkg.bin.pi).toBe('dist/bundle/cli.js')
  })

  it('解析器在打包态要找的路径，就是 build 配置会落成的那个路径', async () => {
    const { resourcesPath, stagedCli } = stageBundledPi()
    const { detectPiCli } = await loadResolverPackaged(resourcesPath)

    expect(detectPiCli()).toMatchObject({
      entry: stagedCli,
      source: 'bundled',
      version: PI_VERSION,
      available: true,
      reason: 'ok',
    })
    expect(H.globalLookupCalls).toBe(0)
  })

  it('resources 里没有 bundled 副本时判不可用，也不去看全局 pi', async () => {
    const resourcesPath = path.join(STAGE_ROOT, 'empty-resources')
    fs.mkdirSync(resourcesPath, { recursive: true })
    const { detectPiCli } = await loadResolverPackaged(resourcesPath)

    expect(detectPiCli()).toMatchObject({ entry: null, available: false, reason: 'not-found' })
    expect(H.globalLookupCalls).toBe(0)
  })
})
