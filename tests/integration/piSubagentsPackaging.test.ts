// @vitest-environment node
/**
 * 子代理扩展的「打包配置 ↔ 运行时解析」那条缝 (issue #46)。
 *
 * 与 #45 / #52 同一类失效：build.extraResources 把扩展搬到某个位置，主进程按另一个位置去找，
 * 而找不到时 pi 一句错都不报 —— 只是没有子代理，界面照旧显示「已按该 agent 运行」。
 * 这里把两边钉成同一个字符串，并额外钉两件事：
 *   - 入口必须是包清单 `pi.extensions` 声明的那个文件（上游改布局时这里先红，而不是运行时静默失效）；
 *   - 扩展自己的运行时依赖必须在盘上：croner 有顶层条目，nanoid 是版本冲突后被 npm
 *     塞进扩展包 node_modules 的那一份，随包一起搬 —— 只认顶层条目就会漏。
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const EXT_PACKAGE = '@tintinweb/pi-subagents'
const EXT_SOURCE = `node_modules/${EXT_PACKAGE}`
const EXT_ENTRY_REL = ['src', 'index.ts']
/** 扩展运行时的裸 import：这些必须在 resources 下有真实副本（@earendil-works/* 与 typebox 由 bundle 的虚拟模块满足） */
const CLOSURE_PACKAGES = ['croner', 'nanoid']

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

const STAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-subagents-stage-'))
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
  return import('@electron/engine/engines/piSubagentsExtension')
}

describe('子代理扩展的打包产物布局', () => {
  it('扩展是 devDependency：宿主进程从不 require 它，进 dependencies 只会把闭包拖进 asar', () => {
    expect(Object.keys(PKG.dependencies ?? {}), `dependencies 仍含 ${EXT_PACKAGE}`).not.toContain(EXT_PACKAGE)
    expect(PKG.devDependencies[EXT_PACKAGE]).toBeTruthy()
  })

  it('解析器在打包态要找的入口，就是 build 配置会落成的那个路径', async () => {
    expect(extEntry, `extraResources 缺 from=${EXT_SOURCE}`).toBeDefined()
    // 必须落成 node_modules 树：子进程用 node 的目录规则解析扩展自己的 import
    expect(extEntry!.to).toBe('pi-extensions/node_modules/@tintinweb/pi-subagents')
    expect(extEntry!.filter).toEqual(
      expect.arrayContaining(['package.json', 'src/**/*', 'node_modules/**/*']),
    )

    const resourcesPath = stageExtension()
    const stagedEntry = path.join(resourcesPath, extEntry!.to, ...EXT_ENTRY_REL)
    const { resolveSubagentsExtensionPath } = await loadResolverPackaged(resourcesPath)

    expect(resolveSubagentsExtensionPath()).toBe(stagedEntry)
  })

  it('resources 里没有扩展时返回 null —— 由调用方 fail closed，不去凑一个能跑的副本', async () => {
    const resourcesPath = path.join(STAGE_ROOT, 'empty-resources')
    fs.mkdirSync(resourcesPath, { recursive: true })
    const { resolveSubagentsExtensionPath } = await loadResolverPackaged(resourcesPath)

    expect(resolveSubagentsExtensionPath()).toBeNull()
  })

  it.each(CLOSURE_PACKAGES)('扩展运行时依赖 %s 搬得过去（顶层条目或随宿主包的嵌套副本）', (name) => {
    const covered = entries.some(e =>
      e.to === `pi-extensions/node_modules/${name}`
      // 版本与顶层冲突时 npm 把包塞进宿主包的 node_modules，那份随包一起搬；
      // 只认顶层条目的话，打包后扩展加载失败而 dev 一切正常。
      || fs.existsSync(path.join(REPO_ROOT, e.from, 'node_modules', name)),
    )

    expect(covered, `${name} 没被 extraResources 覆盖`).toBe(true)
  })

  it('入口按包清单 pi.extensions 声明，不是猜出来的 dist 路径', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, EXT_SOURCE, 'package.json'), 'utf8'),
    ) as { pi?: { extensions?: string[] } }

    expect(manifest.pi?.extensions).toEqual(['./src/index.ts'])
  })
})
