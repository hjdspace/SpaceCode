import type { MCPServer } from '@/stores/mcp'

/**
 * 内置 MCP 预设服务器。
 *
 * 这些是开箱即用、用户可在 MCP 管理页面里自由开关的官方/社区推荐 MCP。
 * 内置服务器和用户自建服务器共享同一份 `mcp-servers.json`，区别仅在
 * `_source: 'builtin'` 标记，方便 UI 上展示「内置」徽标并防止用户误删。
 *
 * 如果用户曾经禁用/修改过某个内置服务器，我们会保留其修改后的状态，
 * 而不是每次都重置成默认值——见 `useMcpStore.applyBuiltinPresets`。
 */
export interface BuiltinMcpPreset {
  /** 唯一 key，同时作为写入 mcp-servers.json 的 server 名 */
  key: string
  /** 展示名称（i18n key：`mcpSettings.builtin.<key>`） */
  name: string
  /** 简介（i18n key：`mcpSettings.builtin.<key>Desc`） */
  description: string
  /** 官方仓库/主页链接，用于「了解更多」 */
  homepage: string
  /** 运行该 MCP 需要的额外依赖说明（用于 tooltip） */
  requirements?: string
  /**
   * 该 MCP 启动所依赖的外部命令（如 cdp-bridge 依赖 uvx，chrome-devtools 依赖 npx）。
   *
   * - `command`：要在 PATH 上检测的命令名。
   * - `installer`：能一键装上该命令的安装器标识；不填则只展示「未安装」+「了解更多」外链，
   *   不提供一键安装按钮（例如 `npx` 随 Node 自带，我们不在这里装 Node）。
   * - `installerDocs`：当 installer 未填或自动安装失败时，跳转到的官方文档链接。
   */
  dependency?: {
    command: string
    installer?: 'uv'
    installerDocs?: string
  }
  /** 服务器配置（不含 id/name/_source，由 store 注入） */
  config: Omit<MCPServer, 'id' | 'name' | 'enabled'>
}

export const BUILTIN_MCP_PRESETS: BuiltinMcpPreset[] = [
  {
    key: 'cdp-bridge',
    name: 'CDP Bridge MCP',
    description:
      '连接你正在使用的真实浏览器（已登录态），让模型读取标签页、扫描页面、执行 JS、截图与导航。需配合浏览器扩展使用。',
    homepage: 'https://github.com/Unagi-cq/cdp-bridge-mcp',
    requirements: '需要安装 uv（uvx 命令）并加载配套的 Chromium 扩展',
    dependency: {
      command: 'uvx',
      installer: 'uv',
      installerDocs: 'https://docs.astral.sh/uv/getting-started/installation/',
    },
    config: {
      type: 'stdio',
      command: 'uvx',
      args: ['cdp-bridge@latest'],
      env: {},
    },
  },
  {
    key: 'chrome-devtools',
    name: 'Chrome DevTools MCP',
    description:
      '通过 Chrome DevTools 控制和检查实时 Chrome 浏览器，支持性能分析、网络调试、截图与控制台日志。适合自动化与调试场景。',
    homepage: 'https://github.com/ChromeDevTools/chrome-devtools-mcp',
    requirements: '需要 Node.js LTS 与 Chrome 稳定版',
    dependency: {
      command: 'npx',
      // npx 随 Node.js 自带，不提供一键安装；只给官方下载页指引
      installerDocs: 'https://nodejs.org/en/download',
    },
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'chrome-devtools-mcp@latest'],
      env: {},
    },
  },
]

/** 标记内置服务器的来源 */
export const BUILTIN_MCP_SOURCE = 'builtin'

/** 判断一个 MCPServer 是否来自内置预设 */
export function isBuiltinServer(server: MCPServer | undefined | null): boolean {
  return !!server && server._source === BUILTIN_MCP_SOURCE
}

/** 按 key 查找预设定义 */
export function findBuiltinPreset(key: string): BuiltinMcpPreset | undefined {
  return BUILTIN_MCP_PRESETS.find(p => p.key === key)
}
