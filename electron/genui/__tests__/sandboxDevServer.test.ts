// @vitest-environment node
/**
 * 开发环境的沙箱承载服务（票 01 第 1、4 条）。
 *
 * 它和打包环境的自定义协议走同一个 `resolveSandboxFile`，所以这里只验"HTTP 这条路"
 * 独有的部分：监听在独立主机名与端口、逐响应下发 CSP、端口被占时不静默换端口。
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('../../infra/logger', () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }))

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GENUI_SANDBOX_CSP } from '@/shared/genuiSandbox'
import { startGenuiSandboxDevServer } from '../sandboxDevServer'

const root = mkdtempSync(join(tmpdir(), 'genui-sandbox-dev-'))
mkdirSync(join(root, 'assets'), { recursive: true })
writeFileSync(join(root, 'index.html'), '<!DOCTYPE html><html><body>dev card</body></html>')
writeFileSync(join(root, 'assets', 'sandbox.js'), 'console.log("dev")')
writeFileSync(join(root, 'secret-outside-root.txt'), 'never-served')

let server: Awaited<ReturnType<typeof startGenuiSandboxDevServer>>
let base: string

beforeAll(async () => {
  // 测试用 0 号端口，避免与真实开发实例抢 5174
  server = await startGenuiSandboxDevServer({ resourceRoot: root, port: 0 })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  await server.stop()
  rmSync(root, { recursive: true, force: true })
})

describe('开发期沙箱服务', () => {
  it('入口文档带沙箱 CSP 与正确 MIME', async () => {
    const res = await fetch(`${base}/index.html`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(res.headers.get('content-security-policy')).toBe(GENUI_SANDBOX_CSP)
    expect(await res.text()).toContain('dev card')
  })

  it('根路径落到入口文档', async () => {
    const res = await fetch(`${base}/`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('dev card')
  })

  it('脚本子资源不需要 CORS 头也能被 opaque origin 文档以经典脚本加载', async () => {
    const res = await fetch(`${base}/assets/sandbox.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('路径穿越与越界文件一律失败且不泄露内容', async () => {
    const up = await fetch(`${base}/../secret-outside-root.txt`)
    expect(up.status).toBeGreaterThanOrEqual(400)
    expect(await up.text()).not.toContain('never-served')

    const encoded = await fetch(`${base}/%2e%2e%2fgenui-sandbox-dev-escape.txt`)
    expect(encoded.status).toBeGreaterThanOrEqual(400)
  })

  it('不放行任意源的跨站读取', async () => {
    const res = await fetch(`${base}/index.html`, { headers: { Origin: 'http://evil.example' } })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
