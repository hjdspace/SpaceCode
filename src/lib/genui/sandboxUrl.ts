/**
 * 沙箱源选择：主窗口自己的 location 就是唯一线索。
 *
 * 开发环境主窗口是 `http://127.0.0.1:5173`，沙箱由独立主机名与端口的构建服务提供；
 * 打包环境主窗口是 `file://`，沙箱由自定义协议提供。H5 的第二个源在票 06 接入，
 * 这里返回 null 让卡片走错误占位，而不是猜一个源渲染出空白 iframe。
 */
import {
  GENUI_SANDBOX_DEV_BASE_URL,
  GENUI_SANDBOX_PROD_BASE_URL,
  genuiSandboxDocUrl,
} from '@/shared/genuiSandbox'

export type SandboxSource = { baseUrl: string; docUrl: string }

export type WindowLocationLike = { protocol: string; hostname: string; port: string }

/** 主窗口开发源，与 `vite.config.mts` 的 server 配置一致。 */
const MAIN_WINDOW_DEV_HOST = '127.0.0.1'
const MAIN_WINDOW_DEV_PORT = '5173'

function toSource(baseUrl: string): SandboxSource {
  return { baseUrl, docUrl: genuiSandboxDocUrl(baseUrl) }
}

export function resolveSandboxSource(location: WindowLocationLike): SandboxSource | null {
  if (location.protocol === 'file:') return toSource(GENUI_SANDBOX_PROD_BASE_URL)
  if (location.hostname === MAIN_WINDOW_DEV_HOST && location.port === MAIN_WINDOW_DEV_PORT) {
    return toSource(GENUI_SANDBOX_DEV_BASE_URL)
  }
  return null
}
