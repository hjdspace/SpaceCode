/**
 * 预览文档里注入的 shim（Issue #64 第 2 项）。
 *
 * iframe 不再授予 allow-popups，外链体验全靠这段捕获阶段拦截：
 * target=_blank、修饰键、中键、键盘 Enter 都必须改成 `od:sandbox:open` 回传宿主；
 * 非 http(s) scheme 与 opaque origin 下的相对链接一律吞掉，不能落到系统 Shell。
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { buildBridgedDocument, PREVIEW_MSG_OPEN, PREVIEW_SANDBOX_SHIM_ID } from '@/shared/previewDocument'

const NONCE = 'nonce-shim-test'
const HOST_ORIGIN = 'http://localhost:3000'

function shimSource(): string {
  const doc = buildBridgedDocument('<html><head></head><body></body></html>', {
    nonce: NONCE,
    hostOrigin: HOST_ORIGIN,
  })
  const match = doc.match(new RegExp(`<script id="${PREVIEW_SANDBOX_SHIM_ID}">([\\s\\S]*?)</script>`))
  if (!match) throw new Error('sandbox shim not injected')
  return match[1]
}

beforeAll(() => {
  // 直接执行注入内容：jsdom 不会执行 innerHTML 里的脚本
  new Function(shimSource())()
})

let anchor: HTMLAnchorElement

beforeEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  anchor = document.createElement('a')
  anchor.textContent = 'link'
  document.body.appendChild(anchor)
})

function click(init: MouseEventInit = {}): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  anchor.dispatchEvent(event)
  return event
}

function opened(): string[] {
  return vi.mocked(window.postMessage).mock.calls
    .map(([payload]) => payload as { type?: string; url?: string })
    .filter((payload) => payload?.type === PREVIEW_MSG_OPEN)
    .map((payload) => payload.url ?? '')
}

describe('沙箱 shim — 新窗口意图改走宿主', () => {
  it('target=_blank 的 https 外链被拦截并回传宿主', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    anchor.href = 'https://example.com/a'
    anchor.target = '_blank'

    const event = click()

    expect(event.defaultPrevented).toBe(true)
    expect(opened()).toEqual(['https://example.com/a'])
  })

  it('Ctrl / Cmd / Shift / Alt 点击外链都按新窗口意图处理', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    anchor.href = 'https://example.com/m'

    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
    }

    expect(opened()).toEqual([
      'https://example.com/m',
      'https://example.com/m',
      'https://example.com/m',
      'https://example.com/m',
    ])
  })

  it('中键 auxclick 被拦截', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    anchor.href = 'https://example.com/middle'
    anchor.target = '_blank'

    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    anchor.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(opened()).toEqual(['https://example.com/middle'])
  })

  it('聚焦链接上按 Enter 也走同一套判定', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    anchor.href = 'https://example.com/enter'
    anchor.target = '_blank'

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    anchor.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(opened()).toEqual(['https://example.com/enter'])
  })

  it('普通左键点击同源链接不拦截：站内导航仍由浏览器处理', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})
    anchor.href = '#section'

    const event = click()

    expect(event.defaultPrevented).toBe(false)
    expect(opened()).toEqual([])
  })

  it('file: 与 javascript: 不会进入系统 Shell', () => {
    vi.spyOn(window, 'postMessage').mockImplementation(() => {})

    for (const href of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-settings:']) {
      anchor.href = href
      anchor.target = '_blank'
      const event = click()
      expect(event.defaultPrevented).toBe(true)
    }

    expect(opened()).toEqual([])
  })
})
