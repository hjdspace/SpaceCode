// @vitest-environment node
/**
 * 设计产物打包 — 票 08：导出 ZIP 必须真实产出 .zip，且包含 HTML 与其相对引用的资源。
 *
 * 引用收集是纯字符串处理（不碰 fs）；工作区根与越界引用这类范围闸门用真实临时目录验证。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join, parse, resolve } from 'path'
import { collectLocalRefs, collectModuleRefs, resolveArtifactRoot, exportZip } from '../artifactExport'
import { readZip, entryNames } from './zipReader'

/** Windows 上建符号链接要特权：探测不到就跳过该用例，而不是让它默默通过。 */
const probeDir = mkdtempSync(join(tmpdir(), 'design-export-symlink-'))
function probeSymlinkSupport(): boolean {
  try {
    mkdirSync(join(probeDir, 'target'))
    symlinkSync(join(probeDir, 'target'), join(probeDir, 'link'), 'dir')
    return true
  } catch {
    return false
  } finally {
    rmSync(join(probeDir, 'link'), { force: true })
    rmSync(join(probeDir, 'target'), { recursive: true, force: true })
  }
}
const canSymlink = probeSymlinkSupport()
afterAll(() => rmSync(probeDir, { recursive: true, force: true }))

describe('collectLocalRefs', () => {
  it('收集 link / script / img / srcset 的相对引用', () => {
    const html = `
      <link rel="stylesheet" href="./style.css">
      <script src="assets/app.js"></script>
      <img src='logo.png' alt="">
      <source srcset="hero-2x.png">
    `
    expect(collectLocalRefs(html).sort()).toEqual(
      ['assets/app.js', 'hero-2x.png', 'logo.png', 'style.css'].sort(),
    )
  })

  it('忽略外链、协议相对、data/anchor/mailto 与站点根绝对路径', () => {
    const html = `
      <link href="https://cdn.example.com/tw.js">
      <link href="//cdn.example.com/tw.css">
      <img src="data:image/png;base64,AAAA">
      <a href="#top">top</a>
      <a href="mailto:x@y.z">mail</a>
      <link href="/root-absolute.css">
      <link href="./real.css">
    `
    expect(collectLocalRefs(html)).toEqual(['real.css'])
  })

  it('去掉查询串与锚点，并解码百分号编码', () => {
    const html = `<script src="./app.js?v=2#x"></script><img src="my%20pic.png">`
    expect(collectLocalRefs(html).sort()).toEqual(['app.js', 'my pic.png'].sort())
  })

  it('收集内联 style 里的 url()', () => {
    const html = `
      <style>.bg { background: url(./bg.png) } .f { src: url('../fonts/a.woff2') }</style>
      <div style="background-image:url('x/y.jpg')"></div>
    `
    expect(collectLocalRefs(html).sort()).toEqual(['../fonts/a.woff2', 'bg.png', 'x/y.jpg'].sort())
  })

  it('同一资源多处引用只收一次', () => {
    expect(collectLocalRefs(`<link href="a.css"><link href="./a.css">`)).toEqual(['a.css'])
  })

  it('反斜杠引用按浏览器规则归一成正斜杠', () => {
    expect(collectLocalRefs('<img src="assets\\logo.png">')).toEqual(['assets/logo.png'])
  })

  it('收集 CSS @import 的相对目标', () => {
    expect(collectLocalRefs('@import "base.css"; @import url("theme.css");').sort()).toEqual([
      'base.css',
      'theme.css',
    ])
  })

  it('无引用时返回空数组', () => {
    expect(collectLocalRefs('<html><body>hi</body></html>')).toEqual([])
  })
})

describe('collectModuleRefs', () => {
  it('收集静态与动态 import 的相对说明符，丢掉裸说明符与外链', () => {
    const js = `
      import './hero.js'
      import { x } from "./utils/helper.js?v=2"
      export * from '../shared/ui.js'
      const mod = await import('./lazy/data.js')
      import('https://cdn.example.com/esm.js')
      import { createApp } from 'vue'
    `
    expect(collectModuleRefs(js).sort()).toEqual([
      '../shared/ui.js',
      'hero.js',
      'lazy/data.js',
      'utils/helper.js',
    ])
  })

  it('纯 CSS 里没有 src/href 属性时不误收', () => {
    expect(collectModuleRefs('body { color: red }')).toEqual([])
  })
})

describe('resolveArtifactRoot', () => {
  it('工作区根包含产物时用工作区根', () => {
    const ws = resolve('a', 'ws')
    expect(resolveArtifactRoot(join(ws, 'sub', 'index.html'), ws)).toBe(ws)
  })

  it('工作区根不包含产物时退到产物所在目录', () => {
    const ws = resolve('a', 'ws')
    expect(resolveArtifactRoot(join(ws, 'index.html'), resolve('a', 'other'))).toBe(ws)
  })

  it('未提供工作区根时退到产物所在目录', () => {
    const ws = resolve('a', 'ws')
    expect(resolveArtifactRoot(join(ws, 'index.html'))).toBe(ws)
  })

  it('宽到文件系统根时没有可用根（与预览服务同一拒绝规则）', () => {
    const fsRoot = parse(resolve(__filename)).root
    expect(resolveArtifactRoot(join(fsRoot, 'index.html'))).toBeNull()
    expect(resolveArtifactRoot(join(fsRoot, 'ws', 'index.html'), fsRoot)).toBe(join(fsRoot, 'ws'))
  })
})

describe('exportZip', () => {
  let dir: string
  let ws: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'design-export-zip-'))
    ws = join(dir, 'ws')
    mkdirSync(join(ws, 'assets'), { recursive: true })
    mkdirSync(join(dir, 'outside'), { recursive: true })
    writeFileSync(
      join(ws, 'index.html'),
      `<link rel="stylesheet" href="./style.css">
       <script type="module" src="app.js"></script>
       <img src="../outside/escape.png">`,
    )
    writeFileSync(join(ws, 'style.css'), 'body{color:red;background:url(./assets/bg.png)}')
    writeFileSync(join(ws, 'app.js'), "import './hero.js'; import('./lazy.js');")
    writeFileSync(join(ws, 'hero.js'), 'export const hero = 1')
    writeFileSync(join(ws, 'lazy.js'), 'export default () => 2')
    writeFileSync(join(ws, 'assets', 'app.js'), 'console.log("hi")')
    writeFileSync(join(ws, 'assets', 'bg.png'), 'PNGDATA')
    writeFileSync(join(ws, 'notes.txt'), 'not referenced')
    writeFileSync(join(dir, 'outside', 'escape.png'), 'PNG')
  })

  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('在产物旁生成同名 .zip 文件', () => {
    const output = exportZip(join(ws, 'index.html'), ws)
    expect(output).toBe(join(ws, 'index.zip'))
    expect(existsSync(output)).toBe(true)
    expect(readFileSync(output).subarray(0, 2).toString()).toBe('PK')
  })

  it('归档条目 = HTML + 相对引用，排除未引用文件与越出工作区根的引用', () => {
    const output = exportZip(join(ws, 'index.html'), ws)
    expect(entryNames(readFileSync(output)).sort()).toEqual([
      'app.js',
      'assets/bg.png',
      'hero.js',
      'index.html',
      'lazy.js',
      'style.css',
    ])
  })

  it('ES Module 图里的兄弟脚本一并入档（解压后不白屏）', () => {
    const output = exportZip(join(ws, 'index.html'), ws)
    const entries = readZip(readFileSync(output))
    expect(entries.find(e => e.name === 'hero.js')?.data.toString()).toBe('export const hero = 1')
    expect(entries.find(e => e.name === 'lazy.js')?.data.toString()).toBe('export default () => 2')
  })

  it('兄弟 CSS 里 url() 引用的资源一并入档（解压后样式不断）', () => {
    const output = exportZip(join(ws, 'index.html'), ws)
    expect(entryNames(readFileSync(output))).toContain('assets/bg.png')
  })

  it('CSS 互引成环时仍能收敛', () => {
    const loop = join(ws, 'loop')
    mkdirSync(loop, { recursive: true })
    writeFileSync(join(loop, 'a.css'), '@import "b.css";')
    writeFileSync(join(loop, 'b.css'), '@import "a.css";')
    writeFileSync(join(loop, 'page.html'), '<link href="a.css">')

    expect(entryNames(readFileSync(exportZip(join(loop, 'page.html'), ws))).sort()).toEqual([
      'loop/a.css',
      'loop/b.css',
      'loop/page.html',
    ])
  })

  it('产物不存在时报错并带上路径', () => {
    expect(() => exportZip(join(ws, 'missing.html'), ws)).toThrow(/missing\.html/)
  })

  it('工作区根不含产物时退到产物目录，条目名相对该目录', () => {
    const sub = join(ws, 'sub')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'page.html'), '<link href="sibling.css">')
    writeFileSync(join(sub, 'sibling.css'), 'a{}')

    expect(entryNames(readFileSync(exportZip(join(sub, 'page.html'), join(dir, 'outside')))).sort())
      .toEqual(['page.html', 'sibling.css'])
  })

  it('单文件内联设计也能导出（只有 HTML 自身）', () => {
    const solo = join(ws, 'solo.html')
    writeFileSync(solo, '<html><body>inline</body></html>')
    const entries = readZip(readFileSync(exportZip(solo, ws)))
    expect(entries.map(e => e.name)).toEqual(['solo.html'])
    expect(entries[0].data.toString()).toContain('inline')
  })

  it.skipIf(!canSymlink)('符号链接指向工作区外时不入档（与预览服务同一闸门）', () => {
    writeFileSync(join(dir, 'outside', 'secret.css'), '.leak{color:red}')
    const link = join(ws, 'linked.css')
    symlinkSync(join(dir, 'outside', 'secret.css'), link)
    writeFileSync(join(ws, 'linked.html'), '<link href="./linked.css">')

    try {
      expect(entryNames(readFileSync(exportZip(join(ws, 'linked.html'), ws)))).toEqual([
        'linked.html',
      ])
    } finally {
      rmSync(link, { force: true })
    }
  })
})
