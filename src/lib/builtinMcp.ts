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
  /**
   * 预设配置版本号。当预设的 command/args/env 等核心配置发生变更时递增。
   *
   * syncBuiltinServers 会比较持久化记录中的 _configVersion 与此值：
   * - 不匹配时，用预设的最新 config 覆盖存储的 command/args/env/type/url/headers，
   *   确保 builtin 预设始终使用正确的启动命令（例如从 npx 迁移到 cua-driver）。
   * - 匹配时，保留用户对 enabled/env 等字段的修改。
   */
  configVersion?: number
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
    //
    // 后端：cua-driver（Rust 原生二进制，MCP over stdio）。
    // 特性：后台操作 — 不抢占用户光标、不偷键盘焦点、不切换虚拟桌面。
    // 支持 macOS（SkyLight SPI）、Windows（UIAutomation + SendInput）、
    // Linux（AT-SPI + XTest）。
    // 二进制管理见 electron/cuaDriverService.ts 和设置面板 Computer Use tab。
    key: 'sc-computer-use',
    name: 'Computer Use (cua-driver)',
    description:
      '基于 cua-driver 的后台桌面控制：截图、鼠标、键盘、滚动、拖拽、窗口/应用管理 — 不抢占用户光标和键盘焦点。支持 macOS/Windows/Linux，可操作后台窗口和原生 UI。',
    homepage: 'https://github.com/trycua/cua',
    requirements: '需要安装 cua-driver 二进制（可在 Computer Use 设置面板中一键安装或使用内置版本）',
    dependency: {
      command: 'cua-driver',
      installerDocs: 'https://cua.ai/docs/cua-driver',
    },
    // configVersion 2: 从 npx @zavora-ai/computer-use-mcp 迁移到 cua-driver mcp
    configVersion: 2,
    config: {
      type: 'stdio',
      command: 'cua-driver',
      args: ['mcp'],
      env: {},
    },
  },
  {
    // Browser Use：Python browser-use 库的 MCP 桥接。
    // 后端：resources/browser-use/bridge.py（Python MCP over stdio）。
    // 特性：AI 驱动的浏览器自动化 — 浏览网页、填写表单、提取数据、截图。
    // 依赖：Python 3.11+、browser-use 包、Playwright Chromium。
    // 安装管理见 electron/browserUseService.ts 和设置面板 Browser Use tab。
    // mcpConfigStore.buildEnabledMcpConfig() 会在运行时用 getBrowserUseMcpServerConfig()
    // 覆盖 command/args/env 为实际 Python 路径 + bridge.py 路径 + LLM 环境变量。
    key: 'browser-use',
    name: 'Browser Use',
    description:
      'AI 驱动的浏览器自动化：浏览网页、填写表单、提取数据、截图。基于 Python browser-use 库，支持 LLM 自主导航和操作网页。需安装 Python 3.11+ 和 browser-use 包。',
    homepage: 'https://github.com/browser-use/browser-use',
    requirements: '需要 Python 3.11+、browser-use 包和 Playwright Chromium（可在 Browser Use 设置面板中一键安装）',
    dependency: {
      command: 'python',
      installerDocs: 'https://www.python.org/downloads/',
    },
    config: {
      type: 'stdio',
      command: 'python',
      args: ['bridge.py', '--mcp'],
      env: {},
    },
  },
  {
    // Browser Use Cloud：官方 Cloud MCP Server（HTTP 类型）。
    // 后端：https://api.browser-use.com/v3/mcp（Browser Use Cloud 托管服务）。
    // 特性：零安装、隐身浏览器、CAPTCHA 绕过、195+ 国家住宅代理、实时预览。
    // 依赖：仅需 Browser Use API Key（以 bu_ 开头），无需 Python/Playwright。
    // API Key 获取：https://cloud.browser-use.com/settings?tab=api-keys&new=1
    // 用户需在 MCP 管理页面中将 headers 中的 YOUR_API_KEY 替换为实际 API Key。
    key: 'browser-use-cloud',
    name: 'Browser Use Cloud',
    description:
      '官方 Cloud MCP Server：零安装即用，内置隐身浏览器、CAPTCHA 绕过、195+ 国家住宅代理。仅需 Browser Use API Key（bu_ 开头），无需 Python/Playwright。',
    homepage: 'https://docs.browser-use.com/cloud/guides/mcp-server',
    requirements: '需要 Browser Use API Key（在 https://cloud.browser-use.com/settings?tab=api-keys 获取）。启用后请点击「编辑」按钮，将 headers 中的 YOUR_API_KEY 替换为你的实际 API Key（bu_ 开头）。',
    config: {
      type: 'http',
      url: 'https://api.browser-use.com/v3/mcp',
      command: '',
      args: [],
      env: {},
      headers: {
        'x-browser-use-api-key': 'YOUR_API_KEY',
      },
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
