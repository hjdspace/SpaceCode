/**
 * 第二个源到底通不通（票 06 第 5 条）。
 *
 * 握手超时有两种成因：沙箱源没人监听（第二个端口没暴露、被防火墙拦下），
 * 或者源在、卡片自己起不来。前者要指引运维去暴露端口，后者不该跟着喊部署问题。
 *
 * 探测只问"这个源有没有回应"：`mode: 'no-cors'` 拿回的是不透明响应，读不到任何内容，
 * 成功仅代表 TCP/HTTP 走通了。沙箱源只有静态产物，多这一条查询不放大可读面。
 */
import { GENUI_SANDBOX_DOC_PATH } from '@/shared/genuiSandbox'

export type SandboxReachability = 'reachable' | 'unreachable' | 'mixed-content'

export type SandboxProbeDeps = {
  fetchImpl?: typeof fetch
  /** 当前页面的协议；默认取 window.location */
  page?: { protocol: string }
}

function pageProtocol(): string {
  const scope = globalThis as { location?: { protocol?: string } }
  return scope.location?.protocol ?? 'http:'
}

/**
 * `reachable` 同时表示"探不出更多"：宿主没有 fetch 时不去猜一个更糟的结论，
 * 让卡片沿用原来的握手超时说明。
 */
export async function probeSandboxReachability(
  sandboxBaseUrl: string,
  deps: SandboxProbeDeps = {},
): Promise<SandboxReachability> {
  let sandboxProtocol = 'http:'
  try {
    sandboxProtocol = new URL(sandboxBaseUrl).protocol
  } catch {
    return 'unreachable'
  }

  const page = deps.page?.protocol ?? pageProtocol()
  // 混合内容在浏览器里一定被拦，请求根本发不出去；先认出来，别把它算成"源不可达"
  if (page === 'https:' && sandboxProtocol === 'http:') return 'mixed-content'

  const doFetch = deps.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch
  if (typeof doFetch !== 'function') return 'reachable'

  try {
    await doFetch(`${sandboxBaseUrl}${GENUI_SANDBOX_DOC_PATH}`, {
      mode: 'no-cors',
      credentials: 'omit',
      cache: 'no-store',
    })
    return 'reachable'
  } catch {
    return 'unreachable'
  }
}
