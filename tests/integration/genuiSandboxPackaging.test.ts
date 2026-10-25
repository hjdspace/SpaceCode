// @vitest-environment node
/**
 * 票 09 第 1 条：沙箱产物要真的跟着安装包落地，并且装好之后从安装目录就读得到。
 *
 * 这里刻意不跑 electron-builder（一次完整打包要拉 Electron 与 nsis 二进制），而是把
 * 「builder 会摆出来的那部分布局」自己搭出来：`resources/app.asar/dist/genui-sandbox`。
 * 三段各自被钉住：
 *   1. 配置段 —— `build.files` 覆盖得到这个目录，且没有任何排除规则能命中它；
 *   2. 路径段 —— 消费方（协议处理器 / H5 第二端口）与生产方（构建脚本）指向同一个目录；
 *   3. 读取段 —— 真构建的四件产物放进那棵假安装树后，真处理器能取到文档与它引用的每个资源，
 *      并且拿不到开发服务器的任何线索。
 * 第 3 段用的是真产物而不是手抄文件：假安装树与真实安装包唯一的差别是 asar 这层 fs 包装，
 * 那层由运行时的 Electron 负责，写在验收矩阵里手工核对。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}))
vi.mock('../../electron/infra/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

import {
  GENUI_SANDBOX_DEV_PORT,
  GENUI_SANDBOX_DOC_PATH,
  GENUI_SANDBOX_HOST,
  GENUI_SANDBOX_SCHEME,
  genuiSandboxDocUrl,
} from '@/shared/genuiSandbox'
import { createSandboxRequestHandler } from '../../electron/genui/sandboxProtocol'
import { resolveSandboxResourceRoot } from '../../electron/genui/sandboxRoot'
import { startSandboxStaticServer, type SandboxStaticServer } from '../../electron/genui/sandboxStaticServer'
import {
  SANDBOX_OUT_DIR_REL,
  buildGenuiSandbox,
} from '../../scripts/genui-sandbox-build.mjs'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PKG = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
  scripts: Record<string, string>
  build: { files: string[] }
}

const fakeInstall = mkdtempSync(join(tmpdir(), 'genui-install-'))
/** 打包态的 app path：`resources/app.asar`（这里是同名普通目录，只有 asar 这层被略过） */
const packagedAppPath = join(fakeInstall, 'resources', 'app.asar')
const packagedSandboxRoot = resolveSandboxResourceRoot(packagedAppPath)

let sandboxServer: SandboxStaticServer | null = null

beforeAll(async () => {
  // 真构建，产物直接摆进假安装树：钉的是"这份东西打包后在不在该在的位置"
  await buildGenuiSandbox({ repoRoot: REPO_ROOT, outDir: packagedSandboxRoot })
}, 120_000)

afterAll(async () => {
  await sandboxServer?.stop()
  rmSync(fakeInstall, { recursive: true, force: true })
})

function withoutNonce(csp: string | null): string {
  return (csp ?? '').replace(/ 'nonce-[^']+'/g, '')
}

/**
 * electron-builder 的 `files` 语义：正向与排除按顺序求值，后匹配者胜出（gitignore 口径）。
 * 只实现判定"某个产物路径会不会被带进安装包"所需的部分：双星号跨任意层级（含零层），
 * 单星号只跨单层。宁可比真实实现严格 —— 它说"进得去"就确实进得去。
 */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0001')
    .replace(/\*\*/g, '\u0002')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0001/g, '(?:.*/)?')
    .replace(/\u0002/g, '.*')
  return new RegExp(`^${escaped}$`)
}

function isIncluded(files: string[], target: string): boolean {
  let included = false
  for (const pattern of files) {
    const negate = pattern.startsWith('!')
    if (patternToRegExp(negate ? pattern.slice(1) : pattern).test(target)) included = !negate
  }
  return included
}

const SANDBOX_ARTIFACTS = ['index.html', 'sandbox.js', 'sandbox.css', 'sandbox.theme.css']

describe('打包配置覆盖沙箱产物目录', () => {
  it.each(SANDBOX_ARTIFACTS)('dist/genui-sandbox/%s 会被带进安装包', (file) => {
    expect(isIncluded(PKG.build.files, `dist/genui-sandbox/${file}`)).toBe(true)
  })

  /**
   * 判据本身也要被钉住：上面的用例如果因为匹配器写错而变成"恒真"，
   * 整个"打包配置覆盖沙箱产物"这条断言就没有意义了。
   */
  it('匹配器不是恒真：排除规则命中时产物就进不去', () => {
    const withExclusion = [...PKG.build.files, '!**/dist/genui-sandbox/**']
    expect(isIncluded(withExclusion, 'dist/genui-sandbox/sandbox.js')).toBe(false)
    // 既有的排除规则只针对 node_modules，不会顺手命中主窗口产物
    expect(isIncluded(PKG.build.files, 'dist/index.html')).toBe(true)
    expect(isIncluded(PKG.build.files, 'node_modules/left-pad/index.js')).toBe(false)
  })

  it('每条打包脚本都在 electron-builder 之前构建沙箱产物', () => {
    for (const name of ['electron:build', 'electron:build:win', 'electron:build:mac', 'electron:build:linux']) {
      const script = PKG.scripts[name]
      const builderAt = script.indexOf('electron-builder')
      const buildAllAt = script.indexOf('npm run build:all')
      expect(builderAt, `${name} 必须调用 electron-builder`).toBeGreaterThan(-1)
      expect(buildAllAt, `${name} 必须在打包前跑 build:all`).toBeGreaterThan(-1)
      expect(buildAllAt, `${name} 里 build:all 要排在 electron-builder 之前`).toBeLessThan(builderAt)
    }
    expect(PKG.scripts.build).toContain('npm run build:genui-sandbox')
    expect(PKG.scripts['build:all']).toContain('npm run build')
  })
})

describe('资源根解析与产物目录同源', () => {
  it('打包态与开发态都指向 <appPath>/dist/genui-sandbox', () => {
    expect(resolveSandboxResourceRoot(packagedAppPath)).toBe(join(packagedAppPath, 'dist', 'genui-sandbox'))
    expect(resolveSandboxResourceRoot(REPO_ROOT)).toBe(join(REPO_ROOT, 'dist', 'genui-sandbox'))
  })

  it('解析口径与构建脚本的默认产物目录是同一个相对路径', () => {
    expect(resolveSandboxResourceRoot('X')).toBe(join('X', SANDBOX_OUT_DIR_REL))
  })
})

describe('安装目录下的自定义协议读取', () => {
  const handle = createSandboxRequestHandler({ resourceRoot: packagedSandboxRoot })

  async function get(path: string) {
    const res = await handle({ url: `${GENUI_SANDBOX_SCHEME}://${GENUI_SANDBOX_HOST}${path}`, method: 'GET' })
    return { status: res.status, headers: res.headers, body: await res.text() }
  }

  it('入口文档从安装目录读出，并逐响应带上沙箱 CSP 与 nonce', async () => {
    const res = await get(GENUI_SANDBOX_DOC_PATH)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('content-security-policy')).toMatch(/'nonce-[^']+'/)
    expect(res.body).toContain('waiting for host handshake')
  })

  it('文档引用的每个资源都能从同一个源取到', async () => {
    const doc = (await get(GENUI_SANDBOX_DOC_PATH)).body
    const refs = [...doc.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map((match) => match[1])
    expect(refs.length).toBeGreaterThanOrEqual(3)

    for (const ref of refs) {
      const res = await get(`/${ref}`)
      expect(res.status, `沙箱文档引用的 ./${ref} 在安装目录里取不到`).toBe(200)
    }
  })

  it('握手文档不依赖开发服务器：既不含回环地址也不含开发端口', async () => {
    const doc = (await get(GENUI_SANDBOX_DOC_PATH)).body
    expect(doc).not.toContain('localhost')
    expect(doc).not.toContain('127.0.0.1')
    expect(doc).not.toContain(String(GENUI_SANDBOX_DEV_PORT))
    // 打包态的沙箱源只有自定义协议这一条，握手 URL 由它拼出
    expect(genuiSandboxDocUrl(`${GENUI_SANDBOX_SCHEME}://${GENUI_SANDBOX_HOST}`)).toBe(
      `${GENUI_SANDBOX_SCHEME}://${GENUI_SANDBOX_HOST}${GENUI_SANDBOX_DOC_PATH}`,
    )
  })

  it('产物缺失时只回 404，不回落任何别的来源', async () => {
    expect((await get('/sandbox.js.tmp')).status).toBe(404)
    expect((await get('/missing.js')).status).toBe(404)
  })

  it('同一份安装在 H5 第二端口上给出同样的文档与策略', async () => {
    sandboxServer = await startSandboxStaticServer({
      resourceRoot: packagedSandboxRoot,
      bindHost: '127.0.0.1',
      port: 0,
      label: 'packaging-test',
    })

    const res = await fetch(`http://127.0.0.1:${sandboxServer.port}${GENUI_SANDBOX_DOC_PATH}`)
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(withoutNonce(res.headers.get('content-security-policy'))).toBe(
      withoutNonce((await get(GENUI_SANDBOX_DOC_PATH)).headers.get('content-security-policy')),
    )
    expect(body).toContain('waiting for host handshake')
    await sandboxServer.stop()
    sandboxServer = null
  })
})
