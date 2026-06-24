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
  /**
   * 是否为预打包服务器：构建时已将依赖打入安装包 <resources>/mcp-vendor/。
   * 为 true 时，electron/mcpConfigStore.ts 的 buildEnabledMcpConfig() 会用
   * 打包内的 bun + 预装 server.js 解析绝对路径覆盖 config.command/args；
   * 若预打包路径不存在（如开发模式未运行 copy-mcp-vendor），回退到 config
   * 里的 npx 配置。bundled 预设通常不设 dependency（打包模式无需外部命令）。
   */
  bundled?: boolean
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
  {
    // 注意：key 不能用 'computer-use' —— 该名字被 Claude Code 引擎列为保留名
    // （COMPUTER_USE_MCP_SERVER_NAME，由 CHICAGO_MCP feature 控制），外部
    // --mcp-config 一旦命中会直接 process.exit(1)。详见 engine/src/main.tsx
    // 的 reservedNameError 检查。这里用 'sc-computer-use' 前缀避免冲突。
    key: 'sc-computer-use',
    name: 'Computer Use MCP',
    description:
      '让模型直接控制桌面：截图、鼠标、键盘、剪贴板、窗口与应用管理。基于 Rust 原生模块，支持 Windows/macOS/Linux，适合操作原生应用、安装器、模态对话框等 UI-only 场景。',
    homepage: 'https://www.npmjs.com/package/@zavora-ai/computer-use-mcp',
    requirements: '已随安装包内置，无需额外下载',
    bundled: true,
    config: {
      type: 'stdio',
      // 回退配置：当预打包路径不存在（开发模式未运行 copy-mcp-vendor）时使用
      command: 'npx',
      args: ['--yes', '--prefer-offline', '@zavora-ai/computer-use-mcp'],
      env: {},
    },
  },
]

/**
 * 历史 key → 当前 key 的迁移映射。
 *
 * 早期版本内置预设 key 曾为 'computer-use'，与 Claude Code 引擎保留名冲突
 * （会导致 CLI 启动即 exit(1)）。改名后，老用户 mcp-servers.json 里仍可能
 * 残留旧 key 记录，syncBuiltinServers 会据此把它迁移到新 key 并删除旧记录，
 * 避免旧记录继续被 buildEnabledMcpConfig 注入 CLI 触发保留名错误。
 */
export const DEPRECATED_BUILTIN_KEY_ALIASES: Record<string, string> = {
  'computer-use': 'sc-computer-use',
}

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
