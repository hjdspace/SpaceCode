/**
 * H5 父页面的逐响应下发策略（票 06 第 2 条，ADR 0015 第 2 条 H5 分支）。
 *
 * 构建产物里的 `index.html` 带一条面向桌面的 CSP meta：`frame-src` 放行的是
 * `localhost:5174` 与 `spacecode-genui:`，在浏览器里两者都不存在。浏览器会**同时**执行
 * meta 与响应头里的策略（取交集），所以只加头不改 meta 等于什么都没放开 —
 * 这里逐响应把那条 meta 换成 H5 专用的策略，并只放行第二个源。
 *
 * 沙箱源必须由服务端说：`主端口 +1` 只在浏览器能直接看到那个端口时成立；
 * 走反向代理或隧道时对外端口是 443，推导会算出一个没人监听的端口。因此同源策略里写什么，
 * 就用内联引导脚本把什么交给渲染端 — 两边不可能对不上。引导脚本靠当次 nonce 进场，
 * `script-src` 因此保持 `'self'` + nonce，不因为卡片引入 `unsafe-eval` 或 `unsafe-inline`。
 */
import { withCspScriptNonce, GENUI_H5_SANDBOX_GLOBAL } from '@/shared/genuiSandbox'
import { withCspMeta } from '../infra/cspDocument'

/** 与 `index.html` 的 CSP meta 同源；tests 钉住"只允许 frame-src / script-src 两条不同值"。 */
const BASE_DIRECTIVES: Array<[string, string]> = [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self' 'unsafe-inline'"],
  ['connect-src', "'self' ws: wss: http: https:"],
  ['img-src', "'self' data: http: https: blob:"],
  ['media-src', "'self' data: blob:"],
  ['font-src', "'self'"],
  ['frame-src', "'self'"],
  ['object-src', "'none'"],
  ['base-uri', "'self'"],
]

/** Host 头是远端可控的，只接受正常的主机名字符；其余一律不给源。 */
const SAFE_HOSTNAME = /^[A-Za-z0-9._-]{1,253}$/

export type H5SandboxOriginInput = {
  /** 请求里的 authority（浏览器看到的 host[:port]），可能不带端口 */
  requestAuthority: string
  /** 运维配置的对外基地址；配置了就以它的主机与协议为准 */
  publicBaseUrl: string | null
  /** 显式配置的沙箱端口，`null` 表示按"主端口 +1" */
  sandboxPort: number | null
  /** 主服务实际监听端口 */
  mainPort: number
}

export type H5DocumentPolicy = { sandboxBaseUrl: string; nonce: string }

/** 沙箱源用哪个端口：显式配置优先，否则"对外可见的主端口 +1"。 */
function sandboxPortOf(input: H5SandboxOriginInput, base: URL | null): number | null {
  if (input.sandboxPort !== null) {
    return input.sandboxPort >= 1 && input.sandboxPort <= 65535 ? input.sandboxPort : null
  }
  // 端口写在 authority 里就以它为准（直连与端口型代理都对）；
  // 只剩 443/80 这种看不见的端口时，退回服务自己的监听端口 +1。
  const explicit = base?.port || authorityPort(input.requestAuthority)
  const mainPort = explicit ? Number(explicit) : input.mainPort
  return Number.isFinite(mainPort) && mainPort > 0 ? mainPort + 1 : null
}

function authorityPort(authority: string): string {
  const at = authority.lastIndexOf(':')
  if (at < 0) return ''
  const port = authority.slice(at + 1)
  return /^\d+$/.test(port) ? port : ''
}

function authorityHost(authority: string): string {
  const at = authority.lastIndexOf(':')
  return at > 0 ? authority.slice(0, at) : authority
}

/**
 * 拼出沙箱静态服务的对外源。给不出源时返回 `null`：宁让卡片落回"宿主未接入沙箱"，
 * 也不下发一条指向不确定地址的 `frame-src`。
 */
export function resolveH5SandboxBaseUrl(input: H5SandboxOriginInput): string | null {
  const configured = parseBaseUrl(input.publicBaseUrl)
  const host = configured?.hostname || authorityHost(input.requestAuthority)
  const protocol = configured?.protocol ?? 'http:'

  if (!SAFE_HOSTNAME.test(host)) return null

  const port = sandboxPortOf(input, configured)
  if (port === null || !Number.isInteger(port) || port < 1 || port > 65535) return null

  // 端口与协议默认值一致时不写端口：`https://x:443` 是同一个源，写出来只会让
  // frame-src 与页面实际用的源对不上。
  const isDefaultPort = (protocol === 'http:' && port === 80) || (protocol === 'https:' && port === 443)
  return isDefaultPort ? `${protocol}//${host}` : `${protocol}//${host}:${port}`
}

function parseBaseUrl(value: string | null): URL | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

/** 这条文档策略只改两条指令：`frame-src` 换成第二个源，`script-src` 加上当次 nonce。 */
export function buildH5DocumentCsp(policy: H5DocumentPolicy): string {
  const base = BASE_DIRECTIVES.map(([name, sources]) => {
    if (name === 'frame-src') return `frame-src 'self' ${policy.sandboxBaseUrl}`
    return `${name} ${sources}`
  }).join('; ')
  // nonce 是引导脚本唯一的进场凭据：script-src 因此保持 'self'，既不放开内联也不放开 eval
  return withCspScriptNonce(base, policy.nonce)
}

/**
 * 改写文档：替换（或补上）CSP meta，并在应用入口之前注入带 nonce 的引导脚本。
 * 返回的 `csp` 同时作为响应头下发，两份是同一个字符串。
 */
export function renderH5Document(
  html: string,
  policy: H5DocumentPolicy,
): { html: string; csp: string; nonce: string } {
  const csp = buildH5DocumentCsp(policy)
  const withBootstrap = injectBootstrap(withCspMeta(html, csp), policy.sandboxBaseUrl, policy.nonce)
  return { html: withBootstrap, csp, nonce: policy.nonce }
}

function injectBootstrap(html: string, sandboxBaseUrl: string, nonce: string): string {
  // 上游的 host 闸门已经保证这里只有正常字符；`\u003c` 转义是最后一道，
  // 免得改写代码哪天放宽就变成自家 XSS。nonce 由主进程的 WebCrypto 生成，形状固定。
  const literal = JSON.stringify(sandboxBaseUrl).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  const script = `<script nonce="${nonce}">window.${GENUI_H5_SANDBOX_GLOBAL}=${literal};</script>`
  const firstScript = html.search(/<script\b/i)
  if (firstScript >= 0) return `${html.slice(0, firstScript)}${script}${html.slice(firstScript)}`
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${script}</head>`)
  return `${script}${html}`
}
