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
import { buildGenuiSandbox, SANDBOX_ENTRY_FILE } from '../scripts/genui-sandbox-build.mjs'

const outDir = mkdtempSync(join(tmpdir(), 'genui-sandbox-out-'))
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

beforeAll(async () => {
  await buildGenuiSandbox({ outDir })
})

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true })
})

function read(name: string) {
  return readFileSync(join(outDir, name), 'utf-8')
}

describe('沙箱构建产物', () => {
  it('独立资源目录里有入口文档、脚本与样式', () => {
    expect(existsSync(join(outDir, 'index.html'))).toBe(true)
    expect(existsSync(join(outDir, SANDBOX_ENTRY_FILE))).toBe(true)
    expect(existsSync(join(outDir, 'sandbox.css'))).toBe(true)
  })

  it('入口文档用经典脚本引用自身产物，且不含内联脚本', () => {
    const html = read('index.html')
    expect(html).toContain(`src="./${SANDBOX_ENTRY_FILE}"`)
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

  it('文档里的 CSP 与主进程下发的 CSP 逐字一致', () => {
    const html = read('index.html')
    const meta = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)
    expect(meta?.[1].replace(/\s+/g, ' ').trim()).toBe(GENUI_SANDBOX_CSP)
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
