// @vitest-environment node
/**
 * 沙箱契约的规格测试 — 钉住 ADR 0015 的安全红线。
 *
 * 这些字面量同时被主进程协议处理器、开发期静态服务与渲染端桥使用，
 * 任何一条指令被"顺手放宽"都会让这张卡失去意义，所以逐条断言。
 */
import { describe, it, expect } from 'vitest'
import {
  GENUI_SANDBOX_CSP,
  GENUI_SANDBOX_DEV_BASE_URL,
  GENUI_SANDBOX_PROD_BASE_URL,
  GENUI_SANDBOX_PROTOCOL_VERSION,
  GENUI_SANDBOX_SCHEME,
} from '../genuiSandbox'

/** `'a b; c d'` → `{ a: 'b', c: 'd' }` — 只用于断言，不进产品代码。 */
function directives(csp: string): Record<string, string> {
  return Object.fromEntries(
    csp
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [directive, ...sources] = part.split(/\s+/)
        return [directive, sources.join(' ')]
      }),
  )
}

const MAIN_WINDOW_DEV_ORIGIN = 'http://127.0.0.1:5173'

describe('GenUI 沙箱 CSP', () => {
  const parsed = directives(GENUI_SANDBOX_CSP)

  it('default-src 与网络/导航类指令全部收紧到 none', () => {
    expect(parsed['default-src']).toBe("'none'")
    expect(parsed['connect-src']).toBe("'none'")
    expect(parsed['form-action']).toBe("'none'")
    expect(parsed['base-uri']).toBe("'none'")
    expect(parsed['frame-src']).toBe("'none'")
    expect(parsed['object-src']).toBe("'none'")
  })

  it('脚本只允许自身资源与 unsafe-eval，样式允许自身与内联，图片与字体允许自身与 data:', () => {
    expect(directives(GENUI_SANDBOX_CSP)['script-src']).toBe("'self' 'unsafe-eval'")
    expect(parsed['style-src']).toBe("'self' 'unsafe-inline'")
    expect(parsed['img-src']).toBe("'self' data:")
    expect(parsed['font-src']).toBe("'self' data:")
  })

  it('unsafe-eval 只出现在 script-src，且不放开 unsafe-inline', () => {
    expect(GENUI_SANDBOX_CSP.match(/unsafe-eval/g)).toHaveLength(1)
    expect(parsed['script-src']).not.toContain("'unsafe-inline'")
  })
})

describe('GenUI 沙箱源', () => {
  it('开发源与主窗口开发源同时换主机名与端口 — 只换端口不算换 site', () => {
    const dev = new URL(GENUI_SANDBOX_DEV_BASE_URL)
    const main = new URL(MAIN_WINDOW_DEV_ORIGIN)
    expect(dev.hostname).not.toBe(main.hostname)
    expect(dev.port).not.toBe(main.port)
    expect(dev.protocol).toBe('http:')
  })

  it('生产源是注册为 secure 的自定义 standard scheme，带固定 host 参与 origin 计算', () => {
    const prod = new URL(GENUI_SANDBOX_PROD_BASE_URL)
    expect(prod.protocol).toBe(`${GENUI_SANDBOX_SCHEME}:`)
    expect(prod.hostname).not.toBe('')
    expect(GENUI_SANDBOX_SCHEME).not.toMatch(/[^a-z0-9.-]/)
  })

  it('开发与生产两个源互不相同，主窗口 CSP 需同时放行', () => {
    expect(GENUI_SANDBOX_DEV_BASE_URL).not.toBe(GENUI_SANDBOX_PROD_BASE_URL)
  })
})

describe('GenUI 握手协议版本', () => {
  it('是宿主与沙箱共同声明的正整数', () => {
    expect(Number.isInteger(GENUI_SANDBOX_PROTOCOL_VERSION)).toBe(true)
    expect(GENUI_SANDBOX_PROTOCOL_VERSION).toBeGreaterThan(0)
  })
})
