// @vitest-environment node
/**
 * plan 模式扩展的「打包配置 ↔ 运行时解析」那条缝 (issue #45)。
 *
 * 与 #52 同一类失效：build.extraResources 把扩展搬到某个位置，而主进程按另一个位置去找。
 * 不同的是这里更安静 —— 解析不到时 Pi 不报错，只是没有权限闸，界面照样显示「计划模式」。
 * 所以把两边钉成同一个字符串，并且把「扩展的运行时依赖必须在盘上」一起钉住：
 * bundle 入口只把 @earendil-works/* 做成虚拟模块，@narumitw/pi-tui-kit 这些得真搬过去才解析得到。
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const EXT_PACKAGE = '@narumitw/pi-plan-mode'
const EXT_SOURCE = `node_modules/${EXT_PACKAGE}`
const EXT_ENTRY_REL = ['dist', 'index.ts']
/** 扩展运行时的裸 import：这些包必须在 resources 下有真实副本 */
const CLOSURE_PACKAGES = ['@narumitw/pi-tui-kit', 'highlight.js', 'grok-mermaid']

interface ExtraResourceEntry { from: string; to: string; filter?: string[] }

const PKG = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>
  devDependencies: Record<string, string>
  build: { extraResources: Array<string | ExtraResourceEntry> }
}

const entries = PKG.build.extraResources.filter((e): e is ExtraResourceEntry => typeof e === 'object')
const extEntry = entries.find(e => e.from === EXT_SOURCE)

vi.mock('@electron/infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

const STAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-plan-ext-stage-'))
afterAll(() => fs.rmSync(STAGE_ROOT, { recursive: true, force: true }))

/** 按 build 配置摆出 packaged 态的 resources 目录 */
function stageExtension(): string {
  const resourcesPath = path.join(STAGE_ROOT, 'resources')
  const staged = path.join(resourcesPath, extEntry!.to)
  fs.mkdirSync(path.join(staged, ...EXT_ENTRY_REL.slice(0, -1)), { recursive: true })
  fs.copyFileSync(path.join(REPO_ROOT, EXT_SOURCE, 'package.json'), path.join(staged, 'package.json'))
  fs.copyFileSync(path.join(REPO_ROOT, EXT_SOURCE, ...EXT_ENTRY_REL), path.join(staged, ...EXT_ENTRY_REL))
  return resourcesPath
}

async function loadResolverPackaged(resourcesPath: string) {
  vi.resetModules()
  vi.doMock('electron', () => ({ app: { isPackaged: true, getAppPath: () => path.join(resourcesPath, 'app.asar') } }))
  Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true })
  return import('@electron/engine/engines/piPlanModeExtension')
}

describe('plan 模式扩展的打包产物布局', () => {
  it('扩展是 devDependency：宿主进程从不 require 它，进 dependencies 只会把闭包拖进 asar', () => {
    expect(Object.keys(PKG.dependencies ?? {}), `dependencies 仍含 ${EXT_PACKAGE}`).not.toContain(EXT_PACKAGE)
    expect(PKG.devDependencies[EXT_PACKAGE]).toBeTruthy()
  })

  it('解析器在打包态要找的入口，就是 build 配置会落成的那个路径', async () => {
    expect(extEntry, `extraResources 缺 from=${EXT_SOURCE}`).toBeDefined()
    // 必须落成 node_modules 树：子进程用 node 的目录规则解析扩展自己的 import
    expect(extEntry!.to).toBe('pi-extensions/node_modules/@narumitw/pi-plan-mode')
    expect(extEntry!.filter).toEqual(expect.arrayContaining(['package.json', 'dist/**/*']))

    const resourcesPath = stageExtension()
    const stagedEntry = path.join(resourcesPath, extEntry!.to, ...EXT_ENTRY_REL)
    const { resolvePlanModeExtensionPath } = await loadResolverPackaged(resourcesPath)

    expect(resolvePlanModeExtensionPath()).toBe(stagedEntry)
  })

  it('resources 里没有扩展时返回 null —— 由调用方 fail closed，不去凑一个能跑的副本', async () => {
    const resourcesPath = path.join(STAGE_ROOT, 'empty-resources')
    fs.mkdirSync(resourcesPath, { recursive: true })
    const { resolvePlanModeExtensionPath } = await loadResolverPackaged(resourcesPath)

    expect(resolvePlanModeExtensionPath()).toBeNull()
  })

  it.each([...CLOSURE_PACKAGES, 'diff'])('扩展运行时依赖 %s 搬得过去（顶层条目或随宿主包的嵌套副本）', (name) => {
    const stagedTo = `pi-extensions/node_modules/${name}`
    // diff 是嵌套在 pi-tui-kit 里的那份（版本与顶层冲突时 npm 的放法），它随包一起搬；
    // 只认顶层条目的话，打包后扩展加载失败而 dev 一切正常。
    const covered = entries.some(e =>
      e.to === stagedTo || fs.existsSync(path.join(REPO_ROOT, e.from, 'node_modules', name)),
    )

    expect(covered, `${name} 没被 extraResources 覆盖`).toBe(true)
  })
})
