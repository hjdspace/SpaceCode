/**
 * 沙箱源选择：主窗口自己的 location 是线索，H5 由服务端逐响应注入权威源。
 *
 * 开发环境主窗口是 `http://127.0.0.1:5173`，沙箱由独立主机名与端口的构建服务提供；
 * 打包环境主窗口是 `file://`，沙箱由自定义协议提供。
 *
 * H5（票 06）不一样：沙箱源不能由页面自己按"端口 +1"推导 —— 走反向代理或隧道时浏览器
 * 看到的端口与服务端监听的端口不是一回事，推导出来的地址没人监听。服务端把同一个值同时
 * 写进这次响应的 `frame-src` 与内联引导脚本，渲染端只认注入值，两边不可能对不上。
 * 没有注入值时返回 null，让卡片落回错误占位，而不是猜一个源渲染出空白 iframe。
 */
import {
  GENUI_SANDBOX_DEV_BASE_URL,
  GENUI_SANDBOX_PROD_BASE_URL,
  GENUI_H5_SANDBOX_GLOBAL,
  genuiSandboxDocUrl,
} from '@/shared/genuiSandbox'

/**
 * `h5` 这一档只跨 origin、与主服务同 site，没有桌面端的 OOPIF 进程隔离（ADR 0015 后果）。
 * 宿主按这个标记决定要不要做可达性探测，卡片文案也据此分叉。
 */
export type SandboxSourceKind = 'dev' | 'prod' | 'h5'

export type SandboxSource = { baseUrl: string; docUrl: string; kind: SandboxSourceKind }

export type WindowLocationLike = { protocol: string; hostname: string; port: string }

/** 主窗口开发源，与 `vite.config.mts` 的 server 配置一致。 */
const MAIN_WINDOW_DEV_HOST = '127.0.0.1'
const MAIN_WINDOW_DEV_PORT = '5173'

function toSource(baseUrl: string, kind: SandboxSourceKind): SandboxSource {
  return { baseUrl, docUrl: genuiSandboxDocUrl(baseUrl), kind }
}

/** 服务端逐响应写进文档的注入值；桌面两个宿主没有它。 */
function readInjectedSandboxBaseUrl(): string | null {
  const scope = globalThis as Record<string, unknown>
  const value = scope[GENUI_H5_SANDBOX_GLOBAL]
  return typeof value === 'string' ? value : null
}

function originOf(protocol: string, hostname: string, port: string): string {
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`
}

/**
 * 注入值必须确实指向另一个源上的沙箱文档根：
 * 同源等于没有沙箱，带路径/查询/片段说明它不是我们那份固定的 `/index.html` 入口。
 */
function isUsableH5BaseUrl(value: string, location: WindowLocationLike): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  if (url.pathname !== '' && url.pathname !== '/') return null
  if (url.search || url.hash) return null
  if (url.origin === originOf(location.protocol, location.hostname, location.port)) return null
  return url.origin
}

export function resolveSandboxSource(
  location: WindowLocationLike,
  injected: string | null = readInjectedSandboxBaseUrl(),
): SandboxSource | null {
  if (location.protocol === 'file:') return toSource(GENUI_SANDBOX_PROD_BASE_URL, 'prod')
  if (location.hostname === MAIN_WINDOW_DEV_HOST && location.port === MAIN_WINDOW_DEV_PORT) {
    return toSource(GENUI_SANDBOX_DEV_BASE_URL, 'dev')
  }
  if (!injected) return null
  const baseUrl = isUsableH5BaseUrl(injected, location)
  return baseUrl ? toSource(baseUrl, 'h5') : null
}
