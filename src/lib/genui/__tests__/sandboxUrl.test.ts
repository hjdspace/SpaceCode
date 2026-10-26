/**
 * 沙箱该从哪个源加载（票 01 第 1、9 条 / 票 06 第 4 条）。
 *
 * 桌面两个宿主靠主窗口自己的 location 选源：开发是 Vite 的 `http://127.0.0.1:5173`，
 * 打包是 `file://`。不新增一条 IPC 去问主进程。
 * H5 靠服务端逐响应注入的源（与同一次响应的 frame-src 同源计算），页面不自己推导端口。
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
      kind: 'dev',
    })
  })

  it('生产：主窗口是 file://，沙箱走注册为 secure 的自定义协议', () => {
    expect(resolveSandboxSource({ protocol: 'file:', hostname: '', port: '' })).toEqual({
      baseUrl: GENUI_SANDBOX_PROD_BASE_URL,
      docUrl: `${GENUI_SANDBOX_PROD_BASE_URL}${GENUI_SANDBOX_DOC_PATH}`,
      kind: 'prod',
    })
  })
})

describe('未接入的宿主不给沙箱源', () => {
  it('没有服务端注入的 http 宿主返回 null，让卡片落错误占位而不是静默空白', () => {
    expect(resolveSandboxSource(locationOf('http://192.168.1.20:4174/'))).toBeNull()
    expect(resolveSandboxSource(locationOf('https://app.example.com/'))).toBeNull()
  })

  it('主窗口端口不是 5173、也没有注入的 http 宿主不猜源', () => {
    expect(resolveSandboxSource(locationOf('http://127.0.0.1:5199/'))).toBeNull()
  })

  it('沙箱文档 URL 始终带独立源，绝不落回主窗口自身', () => {
    const dev = resolveSandboxSource(locationOf('http://127.0.0.1:5173/'))
    expect(dev?.docUrl.startsWith('http://127.0.0.1:5173')).toBe(false)
  })
})

/**
 * H5（票 06 第 4 条）：沙箱源由服务端逐响应写进文档，与同一次响应的 frame-src 出自
 * 同一个计算 —— 渲染端不再自己按"端口 +1"推导，因为走反向代理时浏览器看到的端口
 * 与服务端监听的端口不是一回事。
 */
describe('H5 用服务端注入的沙箱源', () => {
  const H5_LOCATION = locationOf('http://192.168.1.20:8080/')

  it('注入的源直接成为卡片文档地址', () => {
    expect(resolveSandboxSource(H5_LOCATION, 'http://192.168.1.20:8081')).toEqual({
      baseUrl: 'http://192.168.1.20:8081',
      docUrl: `http://192.168.1.20:8081${GENUI_SANDBOX_DOC_PATH}`,
      kind: 'h5',
    })
  })

  it('桌面两个宿主优先，注入值不改写它们的选择', () => {
    expect(resolveSandboxSource({ protocol: 'file:', hostname: '', port: '' }, 'http://evil:1')?.kind).toBe('prod')
    expect(
      resolveSandboxSource(locationOf('http://127.0.0.1:5173/'), 'http://evil:1')?.baseUrl,
    ).toBe(GENUI_SANDBOX_DEV_BASE_URL)
  })

  it('注入值与页面同源时拒绝：同源的 iframe 不是沙箱', () => {
    expect(resolveSandboxSource(H5_LOCATION, 'http://192.168.1.20:8080')).toBeNull()
    // 默认端口写法不同也算同源
    expect(resolveSandboxSource(locationOf('http://lan.example/'), 'http://lan.example:80')).toBeNull()
    expect(resolveSandboxSource(locationOf('https://app.example/'), 'https://app.example:443')).toBeNull()
  })

  it.each([
    'http://192.168.1.20:8081/sandbox',
    'http://192.168.1.20:8081/?token=leak',
    'http://192.168.1.20:8081/#x',
    'spacecode-genui://genui',
    'javascript:alert(1)',
    '//192.168.1.20:8081',
    'not a url',
    '',
    'http://:8081',
  ])('注入值 %s 不可信就不用它', (value) => {
    expect(resolveSandboxSource(H5_LOCATION, value)).toBeNull()
  })

  it('允许带尾斜杠的注入值，文档 URL 不出现双斜杠', () => {
    const source = resolveSandboxSource(H5_LOCATION, 'http://192.168.1.20:8081/')
    expect(source?.baseUrl).toBe('http://192.168.1.20:8081')
    expect(source?.docUrl).toBe(`http://192.168.1.20:8081${GENUI_SANDBOX_DOC_PATH}`)
  })

  it('默认从 window 上的注入属性读取', () => {
    ;(window as unknown as Record<string, unknown>).__SPACECODE_GENUI_SANDBOX__ = 'http://192.168.1.20:8081'
    try {
      expect(resolveSandboxSource(H5_LOCATION)?.kind).toBe('h5')
    } finally {
      delete (window as unknown as Record<string, unknown>).__SPACECODE_GENUI_SANDBOX__
    }
  })
})
