/**
 * 卡片 frame 的导航闸门 — 主进程侧的"卡片不能导航"（ADR 0015 第 5 条）。
 *
 * 实测 Electron 43 的两条事实决定了这里的形状：
 *  1. 子 frame 的 `will-frame-navigate` 里 `senderFrame` 为 undefined，
 *     主进程拿不到"这个 frame 当前是什么文档"，所以无法按 frame 身份判回归避；
 *     能用的只有 `isMainFrame` 与目标 URL。
 *  2. 跨源自跳转（卡片往 evil.com 跑）在主窗口 CSP 的 `frame-src` 上就被拦掉，
 *     导航根本到不了网络层；沙箱源内的跳转 CSP 是放行的，只能靠这里拒。
 *
 * 于是规则收到最小：**非主 frame 只允许加载精确的沙箱卡片文档 URL**，
 * 指向沙箱源的其他目标（换一个 path、带查询串外泄、加载沙箱脚本当文档）一律拒；
 * 其他源交回宿主 CSP 处理，这里不冒充能判定 frame 身份。
 */
import { warn } from '../infra/logger'
import {
  GENUI_SANDBOX_DEV_BASE_URL,
  GENUI_SANDBOX_PROD_BASE_URL,
  genuiSandboxDocUrl,
} from '@/shared/genuiSandbox'

export type FrameNavigationInput = {
  /** 沙箱源，开发与生产各一条 */
  sandboxSites: string[]
  /** 宿主唯一注入的卡片文档 URL，精确匹配（带查询串就不算） */
  sandboxDocUrls: string[]
  targetUrl: string
  isMainFrame?: boolean
}

export type FrameNavigationDecision =
  | { allow: true }
  | { allow: false; reason: 'bad-url' | 'not-card-document' }

/** standard scheme 的 host 参与 origin；`URL.origin` 对非 special scheme 只会给 "null"，自己算。 */
function siteOf(url: URL): string {
  return `${url.protocol}//${url.host}`
}

export function decideFrameNavigation(input: FrameNavigationInput): FrameNavigationDecision {
  if (input.isMainFrame) return { allow: true }
  // 宿主注入的卡片文档本身：唯一放行的沙箱目标
  if (input.sandboxDocUrls.includes(input.targetUrl)) return { allow: true }

  let targetSite: string
  try {
    targetSite = siteOf(new URL(input.targetUrl))
  } catch {
    return { allow: false, reason: 'bad-url' }
  }
  if (input.sandboxSites.includes(targetSite)) {
    return { allow: false, reason: 'not-card-document' }
  }
  return { allow: true }
}

/** 主窗口与沙箱两侧共同的放行口径：两个源 + 两个精确文档 URL。 */
export function genuiFrameGuardPolicy(): Pick<FrameNavigationInput, 'sandboxSites' | 'sandboxDocUrls'> {
  return {
    sandboxSites: [GENUI_SANDBOX_DEV_BASE_URL, GENUI_SANDBOX_PROD_BASE_URL],
    sandboxDocUrls: [
      genuiSandboxDocUrl(GENUI_SANDBOX_DEV_BASE_URL),
      genuiSandboxDocUrl(GENUI_SANDBOX_PROD_BASE_URL),
    ],
  }
}

/** Electron 的 will-frame-navigate 事件里桥真正读取的字段。 */
type FrameNavigateEvent = {
  url: string
  isMainFrame: boolean
  preventDefault: () => void
}

interface NavigableFrameHost {
  on: (event: 'will-frame-navigate', listener: (event: FrameNavigateEvent) => void) => void
  off: (event: 'will-frame-navigate', listener: (event: FrameNavigateEvent) => void) => void
}

/** 把闸门挂到主窗口 webContents 上，返回解绑函数供窗口关闭时清理。 */
export function attachGenuiFrameGuard(
  webContents: NavigableFrameHost,
  policy = genuiFrameGuardPolicy(),
): () => void {
  const listener = (event: FrameNavigateEvent) => {
    const decision = decideFrameNavigation({
      ...policy,
      targetUrl: event.url,
      isMainFrame: event.isMainFrame,
    })
    if (decision.allow) return
    event.preventDefault()
    warn('GenUISandbox', `Blocked card frame navigation | reason=${decision.reason}`, {
      target: event.url.slice(0, 200),
    })
  }
  webContents.on('will-frame-navigate', listener)
  return () => webContents.off('will-frame-navigate', listener)
}
