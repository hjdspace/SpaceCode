/**
 * 注入到预览文档里的两座 bridge：出站带密钥与固定宿主源，入站只认端口 + 密钥。
 * 这里把生成的脚本原样执行在假 window/document 上 —— 桥的真实行为（而不是字符串
 * 长相）就是被测对象。
 */
import { describe, it, expect, vi } from 'vitest'
import { buildSrcdoc } from '../srcdoc'
import {
  PREVIEW_MAX_HTML_CHARS,
  PREVIEW_MSG_ALERT,
  PREVIEW_MSG_CONFIRM,
  PREVIEW_MSG_OPEN,
  PREVIEW_MSG_READY,
  PREVIEW_MSG_TRANSPORT,
  PREVIEW_SANDBOX_SHIM_ID,
  PREVIEW_TRANSPORT_BRIDGE_ID,
} from '../previewBridge'

const NONCE = 'nonce-42'
const HOST_ORIGIN = 'file://'
const HTML = '<html><body><h1>preview</h1></body></html>'

function build(): string {
  return buildSrcdoc(HTML, { nonce: NONCE, hostOrigin: HOST_ORIGIN })
}

function scriptOf(srcdoc: string, id: string): string {
  const match = srcdoc.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))
  if (!match) throw new Error(`missing injected script: ${id}`)
  return match[1]
}

type Posted = { message: any; origin: string; transfer?: unknown[] }

function runTransport(srcdoc: string) {
  const writes: string[] = []
  const posted: Posted[] = []
  const windowListeners: Array<(event: any) => void> = []
  const port1: { onmessage: ((event: any) => void) | null } = { onmessage: null }

  const windowLike: any = {
    parent: {
      postMessage: (message: any, origin: string, transfer?: unknown[]) => posted.push({ message, origin, transfer }),
    },
    addEventListener: (type: string, listener: (event: any) => void) => {
      if (type === 'message') windowListeners.push(listener)
    },
  }
  const documentLike = {
    open: vi.fn(),
    write: (value: string) => writes.push(value),
    close: vi.fn(),
  }
  class FakeChannel {
    port1 = port1
    port2 = { kind: 'port2' }
  }

  new Function('window', 'document', 'MessageChannel', scriptOf(srcdoc, PREVIEW_TRANSPORT_BRIDGE_ID))(
    windowLike,
    documentLike,
    FakeChannel,
  )
  return { writes, posted, port1, windowListeners, windowLike }
}

function runShim(srcdoc: string) {
  const posted: Posted[] = []
  const windowLike: any = {
    parent: {
      postMessage: (message: any, origin: string) => posted.push({ message, origin }),
    },
    addEventListener: vi.fn(),
  }
  new Function('window', scriptOf(srcdoc, PREVIEW_SANDBOX_SHIM_ID))(windowLike)
  return { posted, windowLike }
}

describe('srcdoc bridge — ready 握手', () => {
  it('ready 带本实例密钥、发往固定宿主源，并转移一个端口', () => {
    const { posted } = runTransport(build())

    expect(posted).toHaveLength(1)
    expect(posted[0].message).toEqual({ type: PREVIEW_MSG_READY, nonce: NONCE })
    expect(posted[0].origin).toBe(HOST_ORIGIN)
    expect(posted[0].transfer).toHaveLength(1)
  })
})

describe('srcdoc bridge — 端口注入', () => {
  it('密钥匹配的注入写进文档', () => {
    const { port1, writes } = runTransport(build())

    port1.onmessage?.({ data: { type: PREVIEW_MSG_TRANSPORT, nonce: NONCE, html: '<p>v2</p>' } })

    expect(writes).toEqual(['<p>v2</p>'])
  })

  it('密钥不匹配、类型不对、内容为空或超限都不写文档', () => {
    const { port1, writes } = runTransport(build())

    port1.onmessage?.({ data: { type: PREVIEW_MSG_TRANSPORT, nonce: 'other', html: '<p>evil</p>' } })
    port1.onmessage?.({ data: { type: 'od:other', nonce: NONCE, html: '<p>evil</p>' } })
    port1.onmessage?.({ data: { type: PREVIEW_MSG_TRANSPORT, nonce: NONCE, html: '' } })
    port1.onmessage?.({ data: { type: PREVIEW_MSG_TRANSPORT, nonce: NONCE, html: 'x'.repeat(PREVIEW_MAX_HTML_CHARS + 1) } })
    port1.onmessage?.({ data: null })

    expect(writes).toEqual([])
  })
})

describe('srcdoc bridge — 窗口兜底通道', () => {
  it('只有来源是宿主且密钥匹配才写文档', () => {
    const { windowListeners, windowLike, writes } = runTransport(build())

    windowListeners[0]({ source: {}, data: { type: PREVIEW_MSG_TRANSPORT, nonce: NONCE, html: '<p>from-popup</p>' } })
    windowListeners[0]({ source: windowLike.parent, data: { type: PREVIEW_MSG_TRANSPORT, nonce: 'other', html: '<p>wrong-nonce</p>' } })
    expect(writes).toEqual([])

    windowListeners[0]({ source: windowLike.parent, data: { type: PREVIEW_MSG_TRANSPORT, nonce: NONCE, html: '<p>from-host</p>' } })
    expect(writes).toEqual(['<p>from-host</p>'])
  })
})

describe('sandbox shim', () => {
  it('alert / confirm / open 回传都带密钥与固定宿主源', () => {
    const { posted, windowLike } = runShim(build())

    windowLike.alert('hello')
    expect(windowLike.confirm('sure?')).toBe(false)
    windowLike.open('https://example.com')

    expect(posted.map(item => item.message)).toEqual([
      { type: PREVIEW_MSG_ALERT, nonce: NONCE, message: 'hello' },
      { type: PREVIEW_MSG_CONFIRM, nonce: NONCE, message: 'sure?' },
      { type: PREVIEW_MSG_OPEN, nonce: NONCE, url: 'https://example.com' },
    ])
    expect(posted.every(item => item.origin === HOST_ORIGIN)).toBe(true)
  })
})

describe('每次构建换新密钥', () => {
  it('不同密钥产出的文档互不相同，且都写进了两座桥', () => {
    const first = buildSrcdoc(HTML, { nonce: 'nonce-a', hostOrigin: HOST_ORIGIN })
    const second = buildSrcdoc(HTML, { nonce: 'nonce-b', hostOrigin: HOST_ORIGIN })

    expect(first).not.toBe(second)
    expect(scriptOf(first, PREVIEW_TRANSPORT_BRIDGE_ID)).toContain('nonce-a')
    expect(scriptOf(second, PREVIEW_TRANSPORT_BRIDGE_ID)).toContain('nonce-b')
    expect(scriptOf(first, PREVIEW_SANDBOX_SHIM_ID)).toContain('nonce-a')
  })
})

describe('产物自带的 CSP meta', () => {
  it('构建时被移除，策略只由承载方决定', () => {
    const withMeta =
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'none\'"></head>' +
      '<body>x</body></html>'

    const doc = buildSrcdoc(withMeta, { nonce: NONCE, hostOrigin: HOST_ORIGIN })

    expect(doc).not.toMatch(/http-equiv="Content-Security-Policy"/i)
    expect(doc).toContain('x')
  })
})
