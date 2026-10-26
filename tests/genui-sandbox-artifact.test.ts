// @vitest-environment node
/**
 * 沙箱构建产物（票 01 第 1 条）与 CSP 一致性（票 01 第 3、4、5 条）。
 *
 * 这里跑的是真构建：esbuild 处理一个 TS 入口是毫秒级，把"产物形状"钉住比钉配置文件字段
 * 更真实 —— 消费方（协议处理器与开发期静态服务）读的就是这三个文件。
 * 另一半钉住主窗口自己的 CSP：只放行沙箱源，绝不因为卡片而放开 unsafe-eval。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { GENUI_SANDBOX_CSP, GENUI_SANDBOX_DEV_BASE_URL, GENUI_SANDBOX_SCHEME } from '@/shared/genuiSandbox'
import { buildGenuiSandbox, SANDBOX_ENTRY_FILE, SANDBOX_THEME_FILE } from '../scripts/genui-sandbox-build.mjs'

const outDir = mkdtempSync(join(tmpdir(), 'genui-sandbox-out-'))
const devOutDir = mkdtempSync(join(tmpdir(), 'genui-sandbox-dev-out-'))
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

beforeAll(async () => {
  await buildGenuiSandbox({ outDir })
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
  rmSync(devOutDir, { recursive: true, force: true })
})

function read(name: string) {
  return readFileSync(join(outDir, name), 'utf-8')
}

describe('沙箱构建产物', () => {
  it('独立资源目录里有入口文档、脚本与两份样式', () => {
    expect(existsSync(join(outDir, 'index.html'))).toBe(true)
    expect(existsSync(join(outDir, SANDBOX_ENTRY_FILE))).toBe(true)
    // 官方物料样式由 esbuild 从 JS 里的 CSS import 收集，与手写的卡片外壳分开
    expect(existsSync(join(outDir, 'sandbox.css'))).toBe(true)
    expect(existsSync(join(outDir, SANDBOX_THEME_FILE))).toBe(true)
  })

  it('入口文档用经典脚本引用自身产物，且不含内联脚本', () => {
    const html = read('index.html')
    expect(html).toContain(`src="./${SANDBOX_ENTRY_FILE}"`)
    expect(html).toContain('href="./sandbox.css"')
    expect(html).toContain(`href="./${SANDBOX_THEME_FILE}"`)
    expect(html).not.toMatch(/<script[^>]+type=["']module["']/)
    // 内联 script 在 script-src 'self' 'unsafe-eval' 下必然被拦，产物不该依赖它
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/)
  })

  it('打包出来的脚本是 IIFE，不是需要 CORS 的 ESM', () => {
    const js = read(SANDBOX_ENTRY_FILE)
    expect(js).not.toMatch(/^\s*import\s/m)
    expect(js).not.toMatch(/^\s*export\s/m)
    expect(js).toContain('genui:ready')
  })

  it('卡片渲染走官方 mini 物料：样式与桥消息都在产物里', () => {
    const js = read(SANDBOX_ENTRY_FILE)
    const css = read('sandbox.css')

    // 票 02 的实质：产物里带真实物料与渲染器，而不是票 01 那套手搓 DOM
    expect(css).toContain('.tiny-button')
    expect(js).toContain('schema-render-container')
    expect(js).toContain('genui:size')
    expect(js).toContain('genui:error')
  })

  it('产物里的 CSP meta 与主进程下发的口径同源', () => {
    const html = read('index.html')
    const meta = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)
    // 下发时这条 meta 会被逐响应改写成同一条策略加当次 nonce（sandboxResponse），
    // 所以静态产物里留的是不含 nonce 的那一份基准
    expect(meta?.[1].replace(/\s+/g, ' ').trim()).toBe(GENUI_SANDBOX_CSP)
  })
})

/**
 * 票 09 第 2 条：调试 fixture 与承载自检只在开发产物里。
 *
 * 自检卡（`FixtureCard`）会主动 `fetch(location.href)` 试探 `connect-src`、用 `new Function`
 * 试探 `unsafe-eval`，并把沙箱自己的源、拦截结果画到卡片上 —— 那是给人看的诊断件，
 * 不该出现在装到用户机器上的那份产物里。两侧都跑真构建，钉的是产物本身而不是配置字段。
 */
describe('调试入口只随开发产物存在', () => {
  // 只用纯 ASCII 字面量：esbuild 默认把非 ASCII 转义成 \uXXXX，那样的"命中"取决于转义口径
  const DEBUG_MARKERS = [
    'FixtureCard',
    'sandbox self-check',
    'parent document unreadable',
    'own storage blocked',
  ]

  it('默认（生产）产物里一个调试标记都没有', () => {
    const js = read(SANDBOX_ENTRY_FILE)
    for (const marker of DEBUG_MARKERS) {
      expect(js, `生产沙箱产物里不应留下调试标记 ${marker}`).not.toContain(marker)
    }
  })

  it('生产产物仍然走真实卡片链路：握手与物料渲染都在', () => {
    const js = read(SANDBOX_ENTRY_FILE)
    expect(js).toContain('genui:ready')
    expect(js).toContain('genui:init')
    expect(js).toContain('schema-render-container')
  })

  it('开发产物保留调试入口，自检前提仍能在肉眼验收时读出来', async () => {
    await buildGenuiSandbox({ outDir: devOutDir, mode: 'development' })
    const js = readFileSync(join(devOutDir, SANDBOX_ENTRY_FILE), 'utf-8')
    for (const marker of DEBUG_MARKERS) {
      expect(js, `开发沙箱产物应保留调试标记 ${marker}`).toContain(marker)
    }
  })
})

describe('主窗口 CSP 只为 framing 放开沙箱源', () => {
  const html = readFileSync(join(repoRoot, 'index.html'), 'utf-8')
  const meta = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? ''
  const directives = Object.fromEntries(
    meta.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/)
      return [name, sources.join(' ')]
    }),
  )

  it('script-src 保持 self，卡片要用的 unsafe-eval 不泄漏到主文档', () => {
    expect(directives['script-src']).toBe("'self'")
    expect(meta).not.toContain('unsafe-eval')
  })

  it('frame-src 同时放行开发沙箱源与自定义协议', () => {
    expect(directives['frame-src']).toContain(GENUI_SANDBOX_DEV_BASE_URL)
    expect(directives['frame-src']).toContain(`${GENUI_SANDBOX_SCHEME}:`)
  })

  it('其余指令维持原样，不因为卡片而放宽', () => {
    expect(directives['default-src']).toBe("'self'")
    expect(directives['object-src']).toBe("'none'")
  })
})
