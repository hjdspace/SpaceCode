/**
 * 沙箱该从哪个源加载（票 01 第 1、9 条）。
 *
 * 主窗口自己知道自己在哪个源：开发是 Vite 的 `http://127.0.0.1:5173`，
 * 打包是 `file://`。据此选沙箱源，不新增一条 IPC 去问主进程。
 */
import { describe, it, expect } from 'vitest'
import {
  GENUI_SANDBOX_DEV_BASE_URL,
  GENUI_SANDBOX_DOC_PATH,
  GENUI_SANDBOX_PROD_BASE_URL,
} from '@/shared/genuiSandbox'
import { resolveSandboxSource } from '../sandboxUrl'

function locationOf(href: string) {
  const url = new URL(href)
  return { protocol: url.protocol, hostname: url.hostname, port: url.port }
}

describe('桌面两种运行环境各自选源', () => {
  it('开发：主窗口在 127.0.0.1:5173，沙箱走独立主机名与端口', () => {
    expect(resolveSandboxSource(locationOf('http://127.0.0.1:5173/index.html'))).toEqual({
      baseUrl: GENUI_SANDBOX_DEV_BASE_URL,
      docUrl: `${GENUI_SANDBOX_DEV_BASE_URL}${GENUI_SANDBOX_DOC_PATH}`,
    })
  })

  it('生产：主窗口是 file://，沙箱走注册为 secure 的自定义协议', () => {
    expect(resolveSandboxSource({ protocol: 'file:', hostname: '', port: '' })).toEqual({
      baseUrl: GENUI_SANDBOX_PROD_BASE_URL,
      docUrl: `${GENUI_SANDBOX_PROD_BASE_URL}${GENUI_SANDBOX_DOC_PATH}`,
    })
  })
})

describe('未接入的宿主不给沙箱源', () => {
  it('H5（票 06 才接）返回 null，让卡片落错误占位而不是静默空白', () => {
    expect(resolveSandboxSource(locationOf('http://192.168.1.20:4174/'))).toBeNull()
    expect(resolveSandboxSource(locationOf('https://app.example.com/'))).toBeNull()
  })

  it('主窗口端口不是 5173 的 http 宿主也不猜', () => {
    expect(resolveSandboxSource(locationOf('http://127.0.0.1:5199/'))).toBeNull()
  })

  it('沙箱文档 URL 始终带独立源，绝不落回主窗口自身', () => {
    const dev = resolveSandboxSource(locationOf('http://127.0.0.1:5173/'))
    expect(dev?.docUrl.startsWith('http://127.0.0.1:5173')).toBe(false)
  })
})
