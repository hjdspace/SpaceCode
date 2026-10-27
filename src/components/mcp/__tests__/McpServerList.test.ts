/**
 * McpServerList 组件测试 — 连接失败时把原因说出来。
 * Seam: 引擎运行时状态 + 探测结果 → 卡片上的可读诊断。
 *
 * 存在的理由：内置 chrome-devtools 在 Windows 上连不上时，界面上只有一个
 * 「等待中/失败」徽标，既看不到引擎报的 CONNECT_TIMEOUT，也看不到真正
 * spawn 的命令（`cmd /c npx -y chrome-devtools-mcp@1.12.0`）和存储的预设
 * （`npx … @latest`）并不是一回事。这两条信息不渲染出来，用户就无从自查。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import { createPinia, setActivePinia } from 'pinia'
import zhCN from '@/i18n/locales/zh-CN'
import McpServerList from '@/components/mcp/McpServerList.vue'
import { useMcpStore, type MCPServer } from '@/stores/mcp'

enableAutoUnmount(afterEach)
vi.mock('@/services/electronAPI', () => ({
  api: { mcp: {}, claudeCode: undefined },
}))

const i18n = createI18n({ legacy: false, locale: 'zh-CN', messages: { 'zh-CN': zhCN } })

const SERVERS: Record<string, MCPServer> = {
  'chrome-devtools': {
    id: 'a',
    name: 'chrome-devtools',
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
    env: {},
    enabled: true,
    _source: 'builtin',
  },
}

function mountList() {
  return mount(McpServerList, {
    props: { servers: SERVERS },
    global: { plugins: [i18n] },
  })
}

async function expand(wrapper: ReturnType<typeof mountList>) {
  await wrapper.find('.server-header').trigger('click')
  return wrapper
}

afterEach(() => setActivePinia(createPinia()))
setActivePinia(createPinia())

describe('McpServerList 失败诊断', () => {
  it('把引擎报告的错误渲染到详情里，并挂到状态徽标的 title 上', async () => {
    const store = useMcpStore()
    store.runtimeStatus = [
      { name: 'chrome-devtools', status: 'failed', error: 'MCP server "chrome-devtools" connection timed out after 15000ms' },
    ]

    const wrapper = await expand(mountList())

    expect(wrapper.find('.status-badge').attributes('title')).toContain('timed out after 15000ms')
    expect(wrapper.text()).toContain('引擎报告的错误')
    expect(wrapper.find('.probe-error').text()).toContain('connection timed out after 15000ms')
  })

  it('展示探测实际 spawn 的命令，而不是存储的预设命令', async () => {
    const store = useMcpStore()
    store.probeResults = {
      'chrome-devtools': {
        status: 'failed',
        error: 'Failed to start: spawn npx ENOENT',
        effectiveCommand: 'cmd /c npx -y chrome-devtools-mcp@1.12.0',
      },
    }

    const wrapper = await expand(mountList())

    expect(wrapper.text()).toContain('实际启动命令')
    expect(wrapper.find('.probe-effective-command code').text()).toBe('cmd /c npx -y chrome-devtools-mcp@1.12.0')
    // 存储值仍然显示在卡片副标题上，两者并存才看得出差异
    expect(wrapper.find('.server-command').text()).toContain('chrome-devtools-mcp@latest')
  })

  it('没有 error / effectiveCommand 时不渲染空的诊断块', async () => {
    const store = useMcpStore()
    store.runtimeStatus = [{ name: 'chrome-devtools', status: 'connected' }]
    store.probeResults = { 'chrome-devtools': { status: 'connected', tools: [{ name: 'click' }] } }

    const wrapper = await expand(mountList())

    expect(wrapper.find('.probe-error').exists()).toBe(false)
    expect(wrapper.find('.probe-effective-command').exists()).toBe(false)
  })
})
