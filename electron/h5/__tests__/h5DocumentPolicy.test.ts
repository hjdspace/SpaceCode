// @vitest-environment node
/**
 * H5 父页面的下发策略（票 06 第 2 条）。
 *
 * 这条缝决定浏览器允许这个页面 frame 谁，所以断言全部落在**下发出去的那段文本**上：
 * frame-src 只放行第二个源、脚本只认当次 nonce、绝不因为卡片而放开 unsafe-eval、
 * 引导脚本里的源与 CSP 里的源是同一个（对不上就等于卡片必然被拦）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import {
  buildH5DocumentCsp,
  renderH5Document,
  resolveH5SandboxBaseUrl,
} from '../h5DocumentPolicy'
import { cspDirectives as directivesOf, cspMetaOf as cspMeta } from './h5TestKit'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
/** 桌面与 H5 共用的那份文档模板；那条面向桌面的 CSP meta 就是改写要对付的对象。 */
const REPO_INDEX_HTML = readFileSync(join(repoRoot, 'index.html'), 'utf-8')

describe('第二个源的地址', () => {
  it('直连局域网时跟着浏览器看到的 host，端口取主端口 +1', () => {
    expect(
      resolveH5SandboxBaseUrl({
        requestAuthority: '192.168.1.20:8080',
        publicBaseUrl: null,
        sandboxPort: null,
        mainPort: 8080,
      }),
    ).toBe('http://192.168.1.20:8081')
  })

  it('主机名里没有端口时用主服务端口兜底', () => {
    expect(
      resolveH5SandboxBaseUrl({
        requestAuthority: '192.168.1.20',
        publicBaseUrl: null,
        sandboxPort: null,
        mainPort: 8080,
      }),
    ).toBe('http://192.168.1.20:8081')
  })

  it('显式配置的沙箱端口优先于 +1 约定', () => {
    expect(
      resolveH5SandboxBaseUrl({
        requestAuthority: '192.168.1.20:8080',
        publicBaseUrl: null,
        sandboxPort: 9100,
        mainPort: 8080,
      }),
    ).toBe('http://192.168.1.20:9100')
  })

  it('配了对外的 https 基地址时，源用基地址的主机与协议，端口仍走 +1 或显式配置', () => {
    expect(
      resolveH5SandboxBaseUrl({
        requestAuthority: '127.0.0.1:8080',
        publicBaseUrl: 'https://space.example.com',
        sandboxPort: null,
        mainPort: 8080,
      }),
    ).toBe('https://space.example.com:8081')

    expect(
      resolveH5SandboxBaseUrl({
        requestAuthority: '127.0.0.1:8080',
        publicBaseUrl: 'https://space.example.com',
        sandboxPort: 8444,
        mainPort: 8080,
      }),
    ).toBe('https://space.example.com:8444')
  })

  it('基地址自带端口时按它 +1，不再看内部监听端口', () => {
    expect(
      resolveH5SandboxBaseUrl({
        requestAuthority: '127.0.0.1:9999',
        publicBaseUrl: 'http://10.0.0.5:7000',
        sandboxPort: null,
        mainPort: 8080,
      }),
    ).toBe('http://10.0.0.5:7001')
  })

  it('Host 头被塞进别的东西时不给源，而不是拼出一个能骗过 frame-src 的串', () => {
    for (const authority of [
      'evil.example/',
      "evil.example' ",
      'evil.example;frame-src',
      'ev"il.example',
      '',
      'ho st.example',
    ]) {
      expect(
        resolveH5SandboxBaseUrl({
          requestAuthority: authority,
          publicBaseUrl: null,
          sandboxPort: null,
          mainPort: 8080,
        }),
      ).toBeNull()
    }
  })

  it('端口越界或不带主机名都不给源', () => {
    expect(
      resolveH5SandboxBaseUrl({ requestAuthority: '192.168.1.20:8080', publicBaseUrl: null, sandboxPort: 70000, mainPort: 8080 }),
    ).toBeNull()
    expect(
      resolveH5SandboxBaseUrl({ requestAuthority: '192.168.1.20:8080', publicBaseUrl: null, sandboxPort: 0, mainPort: 8080 }),
    ).toBeNull()
  })

  it('基地址只取协议与主机，路径与查询串不会拼进源里', () => {
    expect(
      resolveH5SandboxBaseUrl({
        requestAuthority: '127.0.0.1:8080',
        publicBaseUrl: 'https://space.example.com/h5?token=x#frag',
        sandboxPort: 8444,
        mainPort: 8080,
      }),
    ).toBe('https://space.example.com:8444')
  })

  it('基地址写坏了不抛错，退回请求里真正看到的 host', () => {
    expect(
      resolveH5SandboxBaseUrl({
        requestAuthority: '192.168.1.20:8080',
        publicBaseUrl: 'not a url',
        sandboxPort: null,
        mainPort: 8080,
      }),
    ).toBe('http://192.168.1.20:8081')
  })
})

describe('H5 文档 CSP', () => {
  const csp = buildH5DocumentCsp({ sandboxBaseUrl: 'http://192.168.1.20:8081', nonce: 'nonce-abc' })
  const directives = directivesOf(csp)

  it('frame-src 只放行自身与第二个源', () => {
    expect(directives['frame-src']).toBe("'self' http://192.168.1.20:8081")
    // 桌面那两个源在浏览器里没有对应服务，留着只会扩大可 frame 的面
    expect(directives['frame-src']).not.toContain('localhost:5174')
    expect(directives['frame-src']).not.toContain('spacecode-genui')
  })

  it('script-src 保持 self 加当次 nonce，卡片要用的 unsafe-eval 不泄漏到主文档', () => {
    expect(directives['script-src']).toBe("'self' 'nonce-nonce-abc'")
    expect(csp).not.toContain('unsafe-eval')
  })

  it('不放开内联脚本，也不给泛域 CORS 之外的口子', () => {
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    expect(directives['default-src']).toBe("'self'")
    expect(directives['object-src']).toBe("'none'")
    expect(directives['base-uri']).toBe("'self'")
  })

  it('除 frame-src 与 script-src 之外的指令与构建产物里的 CSP meta 逐条同值', () => {
    // index.html 的 meta 是桌面与 H5 共用的基准；这里只允许改写这两条，其余漂移要失败。
    const baked = directivesOf(cspMeta(REPO_INDEX_HTML))
    const changed = Object.entries(baked)
      .filter(([name, value]) => directives[name] !== value)
      .map(([name]) => name)
      .sort()
    expect(changed).toEqual(['frame-src', 'script-src'])
  })
})

describe('文档改写', () => {
  const rendered = renderH5Document(REPO_INDEX_HTML, {
    sandboxBaseUrl: 'http://192.168.1.20:8081',
    nonce: 'nonce-abc',
  })

  it('替换掉构建产物里那条面向桌面的 CSP，不留下第二个策略', () => {
    expect(rendered.html.match(/http-equiv="Content-Security-Policy"/g)).toHaveLength(1)
    expect(cspMeta(rendered.html)).toBe(rendered.csp)
    expect(cspMeta(rendered.html)).not.toContain('spacecode-genui:')
  })

  it('引导脚本带着 CSP 里同一个 nonce，并排在应用入口之前', () => {
    expect(rendered.html).toContain(
      `<script nonce="nonce-abc">window.__SPACECODE_GENUI_SANDBOX__="http://192.168.1.20:8081";</script>`,
    )
    expect(rendered.html.indexOf('__SPACECODE_GENUI_SANDBOX__')).toBeLessThan(
      rendered.html.indexOf('src="/src/main.ts"'),
    )
  })

  it('沙箱源里的尖括号与引号不会拼出第二个标签', () => {
    // 上游的 host 闸门已经拦掉畸形 authority；这里的转义是最后一道，免得改写代码
    // 哪天放宽了就变成自家 XSS。
    const hostile = renderH5Document(REPO_INDEX_HTML, {
      sandboxBaseUrl: 'http://a.example/"><img src=x onerror=alert(1)>',
      nonce: 'nonce-abc',
    })
    expect(hostile.html).not.toContain('<img')
    expect(hostile.html).toContain('onerror=alert(1)') // 只作为字符串留在引号里
    expect(hostile.html).toContain("\\u003c")
  })

  it('文档里没有 CSP meta 时补一条，而不是静默下发无策略页面', () => {
    const bare = '<!DOCTYPE html><html><head><title>x</title></head><body></body></html>'
    const out = renderH5Document(bare, { sandboxBaseUrl: 'http://192.168.1.20:8081', nonce: 'n1' })

    expect(cspMeta(out.html)).toBe(out.csp)
    // 没有脚本标签也要注入引导，位置落在 </head> 之前
    expect(out.html.indexOf('__SPACECODE_GENUI_SANDBOX__')).toBeLessThan(out.html.indexOf('</head>'))
  })
})
