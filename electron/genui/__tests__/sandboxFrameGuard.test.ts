// @vitest-environment node
/**
 * 沙箱 frame 的导航闸门（ADR 0015 第 5 条：卡片不能导航）。
 *
 * 判定只依赖 `isMainFrame` 与目标 URL —— Electron 43 的子 frame 导航事件里
 * `senderFrame` 是 undefined（spike 实测），主进程无法据此认身份。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../infra/logger', () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }))

import {
  GENUI_SANDBOX_DEV_BASE_URL,
  GENUI_SANDBOX_DOC_PATH,
  GENUI_SANDBOX_PROD_BASE_URL,
} from '@/shared/genuiSandbox'
import {
  attachGenuiFrameGuard,
  decideFrameNavigation,
  genuiFrameGuardPolicy,
  type FrameNavigationDecision,
} from '../sandboxFrameGuard'

const SANDBOX_SITES = [GENUI_SANDBOX_DEV_BASE_URL, GENUI_SANDBOX_PROD_BASE_URL]
const DEV_DOC = `${GENUI_SANDBOX_DEV_BASE_URL}${GENUI_SANDBOX_DOC_PATH}`
const PROD_DOC = `${GENUI_SANDBOX_PROD_BASE_URL}${GENUI_SANDBOX_DOC_PATH}`

function decide(details: { targetUrl: string; isMainFrame?: boolean }): FrameNavigationDecision {
  return decideFrameNavigation({
    sandboxSites: SANDBOX_SITES,
    sandboxDocUrls: [DEV_DOC, PROD_DOC],
    ...details,
  })
}

/** 断言被拒并返回拒绝分支，TS 才能读到 reason。 */
function reject(details: Parameters<typeof decide>[0]): Extract<FrameNavigationDecision, { allow: false }> {
  const result = decide(details)
  if (result.allow) throw new Error(`expected rejection, got allow: ${JSON.stringify(details)}`)
  return result
}

describe('主窗口与卡片初次加载不受影响', () => {
  it('主窗口自己的导航不归沙箱闸门管', () => {
    expect(decide({ targetUrl: 'https://example.com/', isMainFrame: true }).allow).toBe(true)
  })

  it('宿主注入的卡片文档 URL 正常加载（开发与生产各一条）', () => {
    expect(decide({ targetUrl: DEV_DOC }).allow).toBe(true)
    expect(decide({ targetUrl: PROD_DOC }).allow).toBe(true)
  })
})

describe('沙箱源内的其他目标一律拒', () => {
  // spike 实测：卡片把自身 frame 跳到同源的另一个 URL 时，宿主 CSP 的 frame-src 是放行的，
  // 只有这道闸门拦得下 —— 带查询串的自跳转正是把内容带出去的最短路径。
  it.each([
    'spacecode-genui://genui/other.html?d=leak',
    'spacecode-genui://genui/index.html?d=leak',
    'spacecode-genui://genui/assets/sandbox.js',
    'http://localhost:5174/other.html',
  ])('%s 被拒', (targetUrl) => {
    expect(reject({ targetUrl }).reason).toBe('not-card-document')
  })

  it('无法解析的目标 URL 拒绝，不让它走到协议层', () => {
    expect(reject({ targetUrl: 'not a url' }).reason).toBe('bad-url')
    expect(reject({ targetUrl: '::::' }).reason).toBe('bad-url')
  })

  it('javascript: 目标算可解析的同文档执行，不由这道闸门负责', () => {
    // 它不产生跨文档导航，脚本只在卡片自己的 opaque origin 里跑；
    // 外链协议白名单是票 03 的 openLink 动作口径。
    expect(decide({ targetUrl: 'javascript:fetch("http://evil/")' }).allow).toBe(true)
  })
})

describe('跨源目标交回宿主 CSP', () => {
  it.each([
    'http://127.0.0.1:4173/index.html',
    'https://evil.example/?leak=token',
    'about:blank',
    'data:text/html,<p>x</p>',
    'file:///C:/Windows/win.ini',
  ])('闸门不冒充 frame 身份判定：%s 照旧放行', (targetUrl) => {
    expect(decide({ targetUrl }).allow).toBe(true)
  })
})

describe('挂到 webContents 上的接线', () => {
  type NavigateEvent = { url: string; isMainFrame: boolean; preventDefault: () => void }

  function fakeWebContents() {
    const listeners: Array<(event: NavigateEvent) => void> = []
    return {
      on: (_event: 'will-frame-navigate', listener: (event: NavigateEvent) => void) => {
        listeners.push(listener)
      },
      off: vi.fn(),
      emit(event: NavigateEvent) {
        for (const listener of listeners) listener(event)
      },
    }
  }

  it('放行卡片文档初载，拒掉同源内的另一个目标', () => {
    const host = fakeWebContents()
    attachGenuiFrameGuard(host)

    const initialPrevent = vi.fn()
    host.emit({ url: PROD_DOC, isMainFrame: false, preventDefault: initialPrevent })
    expect(initialPrevent).not.toHaveBeenCalled()

    const leakPrevent = vi.fn()
    host.emit({
      url: `${GENUI_SANDBOX_PROD_BASE_URL}/other.html?d=leak`,
      isMainFrame: false,
      preventDefault: leakPrevent,
    })
    expect(leakPrevent).toHaveBeenCalledTimes(1)
  })

  it('解绑后不再监听', () => {
    const host = fakeWebContents()
    const detach = attachGenuiFrameGuard(host)
    detach()
    expect(host.off).toHaveBeenCalledWith('will-frame-navigate', expect.any(Function))
  })

  it('默认口径同时覆盖开发与生产两个沙箱源', () => {
    const policy = genuiFrameGuardPolicy()
    expect(policy.sandboxSites).toEqual([GENUI_SANDBOX_DEV_BASE_URL, GENUI_SANDBOX_PROD_BASE_URL])
    expect(policy.sandboxDocUrls).toEqual([DEV_DOC, PROD_DOC])
  })
})
