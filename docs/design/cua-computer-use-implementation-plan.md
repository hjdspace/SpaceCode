# SpaceCode Computer-Use 实现方案（基于 cua-driver）

> **文档版本**: v1.0  
> **日期**: 2026-06-28  
> **目标**: 在 SpaceCode 桌面程序中实现基于 cua-driver 的 Computer-Use 功能，完全复刻 hermes-agent 的实现模式

---

## 1. 背景分析

### 1.1 cua-driver 是什么

[trycua/cua](https://github.com/trycua/cua) 是一个开源的 Computer-Use Agent 框架，其中 **cua-driver** 是核心驱动组件：

- **语言**: Rust（跨平台原生二进制 `cua-driver`）
- **通信协议**: MCP (Model Context Protocol) over stdio (JSON-RPC 2.0)
- **平台支持**: macOS、Windows、Linux
- **核心特性**: **后台操作** — 不抢占用户光标、不偷键盘焦点、不切换虚拟桌面
- **底层技术**:
  | 平台 | 无障碍树 | 输入派发 |
  |------|---------|---------|
  | macOS | AX (私有 SkyLight SPI) | `SLPSPostEventRecordTo` — pid 级别，无光标移动 |
  | Windows | UIAutomation | `SendInput` + `PostMessage` — 无焦点窃取 |
  | Linux | AT-SPI (X11 + Wayland) | XTest (X11) / virtual-keyboard (Wayland) |

#### cua-driver 提供的 MCP 工具

| 工具名 | 功能 | 类别 |
|--------|------|------|
| `screenshot` / `get_window_state` | 截图 + AX 树 + 编号元素覆盖层 | 截图 |
| `list_windows` | 列出屏幕上的窗口 | 枚举 |
| `list_apps` | 列出运行中的应用 | 枚举 |
| `click` / `double_click` / `right_click` | 鼠标点击（element_index 或像素坐标） | 输入 |
| `drag` | 拖拽 | 输入 |
| `scroll` | 滚动 | 输入 |
| `type_text` | 输入文本 | 输入 |
| `press_key` / `hotkey` | 按键 / 组合键 | 输入 |
| `set_value` | 原生设置元素值（如下拉选择） | 输入 |
| `launch_app` / `kill_app` | 启动 / 终止应用 | 应用管理 |
| `bring_to_front` | 激活窗口 | 应用管理 |
| `move_cursor` | 移动 Agent 光标覆盖层（非真实光标） | 光标覆盖层 |
| `get_cursor_position` | 获取真实 OS 光标位置 | 枚举 |
| `get_screen_size` | 获取屏幕尺寸 | 枚举 |
| `zoom` | 窗口区域截图（可缩放） | 截图 |
| `start_session` / `end_session` | 会话生命周期管理（光标颜色、配置隔离） | 会话 |
| `set_agent_cursor_*` | Agent 光标样式/行为配置 | 光标覆盖层 |
| `start_recording` / `stop_recording` | 轨迹录制（截图序列 + 动作 JSON） | 录制 |
| `replay_trajectory` | 回放录制轨迹 | 录制 |
| `health_report` | 健康检查矩阵 | 诊断 |
| `check_for_update` | 检查更新 | 诊断 |
| `page` | 浏览器页面操作 (CDP / Apple Events) | 浏览器 |

### 1.2 hermes-agent 如何使用 cua

hermes-agent 的 computer-use 实现位于 `tools/computer_use/` 目录，架构分层清晰：

```
tools/computer_use/
├── __init__.py          # 公开接口导出
├── backend.py           # 抽象后端接口 ComputerUseBackend
├── cua_backend.py       # cua-driver MCP 后端实现（核心）
├── tool.py              # 模型无关的 computer_use 工具入口 + 安全门控
├── schema.py            # OpenAI function-calling 格式的工具 schema
├── vision_routing.py    # 视觉路由（非视觉模型走辅助视觉管线）
├── permissions.py       # macOS TCC 权限管理
└── doctor.py            # 健康检查 CLI
```

#### 核心设计模式

1. **抽象后端接口** (`backend.py`): 定义 `ComputerUseBackend` ABC，声明 `capture()`, `click()`, `drag()`, `scroll()`, `type_text()`, `key()`, `set_value()`, `list_apps()`, `focus_app()` 等抽象方法。返回 `CaptureResult` / `ActionResult` 数据类。

2. **cua-driver MCP 后端** (`cua_backend.py`): `CuaDriverBackend` 实现，通过 stdio MCP 协议与 `cua-driver` 二进制通信：
   - `_AsyncBridge`: 后台线程运行 asyncio 事件循环
   - `_CuaDriverSession`: 管理 MCP `ClientSession` 生命周期（懒启动、自动重连）
   - 会话管理: `start_session(session_id)` / `end_session(session_id)` 隔离并发运行
   - 能力发现: `tools/list` 响应中读取 `capabilities` 和 `capability_version`
   - 元素令牌: `element_token` 用于陈旧检测（防止点击错误元素）
   - 截图获取: 优先 `screenshot` 工具，回退 `get_window_state`
   - 元素解析: 优先 `structuredContent.elements`，回退 markdown 正则解析

3. **模型无关工具入口** (`tool.py`): `handle_computer_use(args)` 函数：
   - 安全门控: 阻断危险按键组合（`cmd+shift+q` 等）、阻断危险文本输入（`curl|bash` 等）
   - 审批回调: 破坏性操作需要用户批准 (`approve_once` / `approve_session` / `always_approve` / `deny`)
   - 分发: 将统一 schema 的 `action` 参数映射到后端方法
   - 响应封装: 文本结果返回 JSON 字符串；截图结果返回 `_multimodal` 字典（text + image_url）

4. **统一 Schema** (`schema.py`): 标准 OpenAI function-calling 格式，任何支持工具调用的模型都能驱动：
   ```python
   computer_use(action="capture", mode="som", app="Chrome")
   computer_use(action="click", element=7)
   computer_use(action="type", text="hello", capture_after=True)
   ```

5. **三种截图模式**:
   - `som` (默认): 截图 + 编号覆盖层 + AX 树索引
   - `vision`: 纯截图
   - `ax`: 仅 AX 树（无图像，适合纯文本模型）

6. **视觉路由** (`vision_routing.py`): 当主模型不支持视觉时，将截图路由到辅助视觉模型进行预分析，返回文本描述。

7. **诊断系统** (`doctor.py`): 通过 MCP 协议调用 `health_report` 工具，输出结构化检查矩阵。

8. **权限管理** (`permissions.py`): macOS 上调用 `cua-driver permissions status/grant` 管理 TCC 权限。

9. **桌面 UI** (`computer-use-panel.tsx`): 设置面板中的 Computer Use 预检卡片，显示安装状态、权限状态、健康检查结果。

### 1.3 SpaceCode 现有架构

SpaceCode 是一个 Electron + Vue 3 桌面应用：

```
SpaceCode/
├── electron/               # Electron 主进程
│   ├── main.ts             # 主进程入口，注册 IPC handlers
│   ├── preload.ts          # Context Bridge (安全 IPC API)
│   ├── sessionProcess.ts   # Claude Code CLI 进程管理 (NDJSON 通信)
│   ├── claudeCodeIPC.ts    # Claude Code IPC 桥接
│   ├── mcpConfigStore.ts   # MCP 配置持久化 (mcp-servers.json)
│   ├── mcpProbe.ts         # MCP 服务器探测
│   ├── gitService.ts       # Git 操作
│   ├── skillsService.ts    # 技能管理
│   └── ...
├── src/                    # Vue 3 渲染进程
│   ├── components/
│   │   ├── settings/       # 设置面板（GeneralSettings, ModelSettings, McpSettings...）
│   │   ├── mcp/            # MCP 管理组件
│   │   └── ...
│   ├── stores/             # Pinia stores (mcp, chat, settings, config...)
│   ├── lib/                # 业务逻辑 (builtinMcp.ts, tool-registry.ts...)
│   ├── services/           # 服务层 (electronAPI.ts)
│   ├── i18n/               # 国际化 (en-US, zh-CN)
│   └── types/              # TypeScript 类型
└── engine/                 # CLI 引擎 (Bun, 独立子项目，禁止修改)
```

#### 现有 Computer-Use 集成

SpaceCode 已有一个基于 `@zavora-ai/computer-use-mcp` 的 computer-use MCP 预设：

- **配置位置**: `src/lib/builtinMcp.ts` → `BUILTIN_MCP_PRESETS` 中的 `sc-computer-use`
- **MCP 名称**: `sc-computer-use`（不能用 `computer-use`，与 Claude Code 引擎保留名冲突）
- **后端**: `@zavora-ai/computer-use-mcp` (Node.js MCP 服务器，非 cua-driver)
- **注入方式**: 通过 `--mcp-config` 参数注入到 Claude Code CLI
- **系统提示**: `sessionProcess.ts` 中的 `COMPUTER_USE_AVAILABILITY_HINT` 引导 LLM 使用工具
- **MCP 探测**: `mcpProbe.ts` 可独立探测 MCP 服务器连通性
- **配置存储**: `mcpConfigStore.ts` 管理持久化到 `mcp-servers.json`

**关键差距**: 当前方案使用的是 `@zavora-ai/computer-use-mcp`，而非 cua-driver。cua-driver 提供了更强大的能力（后台操作、AX 树、元素令牌、光标覆盖层、录制回放、健康检查等），且是 hermes-agent 验证过的成熟方案。

---

## 2. 实现目标

1. **替换后端**: 将 `@zavora-ai/computer-use-mcp` 替换为 `cua-driver` 作为 Computer-Use 的 MCP 后端
2. **完全复刻 hermes-agent 模式**: 实现抽象后端、安全门控、诊断系统、权限管理、视觉路由等核心功能
3. **Electron 原生集成**: cua-driver 生命周期由 Electron 主进程管理，而非简单注入 CLI
4. **UI 面板**: 设置面板中新增 Computer-Use 配置卡片（安装状态、权限检查、健康诊断）
5. **i18n 国际化**: 所有新增 UI 文本支持中英文
6. **保持兼容**: 不破坏现有 MCP 管理体系，cua-driver 作为内置 MCP 预设之一

---

## 3. 架构设计

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    SpaceCode Electron App                    │
│                                                               │
│  ┌──────────────┐   IPC    ┌──────────────────────────────┐ │
│  │  Renderer     │◄────────►│  Main Process                │ │
│  │  (Vue 3)      │          │                              │ │
│  │               │          │  ┌────────────────────────┐  │ │
│  │  ┌──────────┐ │          │  │ cuaDriverService.ts    │  │ │
│  │  │ComputerUse│ │          │  │  - binary detect       │  │ │
│  │  │Settings  │ │          │  │  - install/upgrade     │  │ │
│  │  │Panel.vue │ │          │  │  - MCP session mgmt    │  │ │
│  │  └──────────┘ │          │  │  - health_report       │  │ │
│  │               │          │  │  - permissions (TCC)   │  │ │
│  │  ┌──────────┐ │          │  │  - direct tool calls   │  │ │
│  │  │computerUse│ │          │  └───────────┬────────────┘  │ │
│  │  │Store     │ │          │               │ stdio MCP     │ │
│  │  └──────────┘ │          │               ▼               │ │
│  └──────────────┘          │  ┌────────────────────────┐  │ │
│                            │  │ cua-driver binary      │  │ │
│                            │  │ (Rust, MCP over stdio) │  │ │
│                            │  └────────────────────────┘  │ │
│                            │                               │ │
│                            │  ┌────────────────────────┐  │ │
│                            │  │ sessionProcess.ts      │  │ │
│                            │  │  --mcp-config (cua)    │──┼─┼─► Claude Code CLI
│                            │  └────────────────────────┘  │ │    (engine)
│                            └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| cua-driver 通信方式 | MCP over stdio (与 hermes 一致) | cua-driver 原生支持，hermes 验证过 |
| cua-driver 注入 CLI 方式 | 作为内置 MCP 预设（`--mcp-config`） | 复用现有 MCP 基础设施 |
| 主进程直接 MCP 通信 | 是（用于 UI 功能：健康检查、权限、预览） | 不依赖 CLI 也能做诊断和配置 |
| 抽象后端接口 | 是（TypeScript interface，对齐 hermes 的 `ComputerUseBackend`） | 可扩展、可测试、未来支持其他后端 |
| 安全门控 | 在 sessionProcess.ts 系统提示中引导 + MCP 工具层不拦截 | Claude Code CLI 已有工具审批机制 |
| 截图模式 | som / vision / ax (与 hermes 一致) | 模型无关，灵活适配 |
| 视觉路由 | 暂不实现（SpaceCode 主力模型均支持视觉） | 后续可按需添加 |

### 3.3 双通道架构

SpaceCode 的 cua-driver 集成有两条通信通道：

1. **CLI 通道**（主通道）: cua-driver 作为 MCP 服务器通过 `--mcp-config` 注入 Claude Code CLI，LLM 直接调用 `mcp__cua-driver__*` 工具。这是 Agent 驱动桌面的主要路径。

2. **主进程直连通道**（辅助通道）: Electron 主进程通过 stdio MCP 直接与 cua-driver 通信，用于 UI 层面的功能：
   - 健康检查 (`health_report`)
   - 权限状态查询 (`permissions status`)
   - 权限请求 (`permissions grant`)
   - 版本检查 (`check-update`)
   - 未来扩展：实时截图预览、录制管理

---

## 4. 文件清单

### 4.1 新建文件

| 文件路径 | 职责 |
|---------|------|
| `electron/cuaDriverService.ts` | cua-driver 核心服务：二进制检测、安装、MCP 会话管理、健康检查、权限管理 |
| `electron/cuaDriverMcpClient.ts` | MCP over stdio 客户端（轻量 JSON-RPC 2.0 实现，不依赖 `@modelcontextprotocol/sdk`） |
| `src/types/computerUse.ts` | Computer-Use 相关 TypeScript 类型定义 |
| `src/stores/computerUse.ts` | Computer-Use Pinia store（状态管理） |
| `src/components/settings/ComputerUseSettings.vue` | Computer-Use 设置面板组件 |
| `src/lib/cuaDriverSchema.ts` | cua-driver MCP 工具 schema 定义 + 系统提示构建 |

### 4.2 修改文件

| 文件路径 | 修改内容 |
|---------|---------|
| `electron/main.ts` | 注册 cuaDriver IPC handlers |
| `electron/preload.ts` | 暴露 `computerUse` API 命名空间到渲染进程 |
| `electron/mcpConfigStore.ts` | 将 `sc-computer-use` 预设的 config 改为 cua-driver 命令 |
| `electron/sessionProcess.ts` | 更新 `COMPUTER_USE_AVAILABILITY_HINT` 系统提示以匹配 cua-driver 工具名 |
| `src/lib/builtinMcp.ts` | 更新 `sc-computer-use` 预设描述和配置 |
| `src/services/electronAPI.ts` | 添加 `computerUse` API 封装 |
| `src/components/settings/SettingsPanel.vue` | 添加 Computer-Use 设置 tab |
| `src/i18n/locales/zh-CN.ts` | 添加 computerUse 相关中文翻译 |
| `src/i18n/locales/en-US.ts` | 添加 computerUse 相关英文翻译 |

---

## 5. 详细实现

### 5.1 Electron 主进程：cuaDriverService.ts

**文件**: `electron/cuaDriverService.ts`

**职责**: cua-driver 二进制管理、MCP 会话管理、IPC handler 注册

```typescript
// 核心接口设计

/** cua-driver 二进制状态 */
interface CuaDriverStatus {
  platform: string
  platformSupported: boolean
  installed: boolean
  binaryPath: string | null
  version: string | null
  ready: boolean | null        // null = 未知
  canGrant: boolean            // macOS 才有 TCC
  checks: HealthCheck[]
  error: string | null
  // macOS TCC 权限
  accessibility: boolean | null
  screenRecording: boolean | null
}

/** 健康检查项 */
interface HealthCheck {
  label: string
  status: 'pass' | 'fail' | 'skip'
  message: string
  hint?: string
}

/** MCP 工具调用结果 */
interface McpToolResult {
  data: unknown
  images: string[]              // base64 图片数组
  imageMimeTypes: string[]
  structuredContent: Record<string, unknown> | null
  isError: boolean
}
```

**核心功能模块**:

#### 5.1.1 二进制检测与安装

```typescript
/** 检测 cua-driver 是否在 PATH 上 */
function findCuaDriverBinary(): string | null {
  // 1. 检查环境变量 CUA_DRIVER_CMD
  // 2. 检查 PATH 上的 cua-driver / cua-driver.exe
  // 3. 检查 SpaceCode userData 目录下的预安装副本
  return which('cua-driver') || null
}

/** 安装 cua-driver（调用上游安装脚本） */
async function installCuaDriver(): Promise<{ success: boolean; error?: string }> {
  // Windows: irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex
  // macOS/Linux: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"
  // 通过 PowerShell / bash 子进程执行，流式输出进度
}
```

#### 5.1.2 MCP over stdio 客户端

**文件**: `electron/cuaDriverMcpClient.ts`

轻量级 JSON-RPC 2.0 over stdio 客户端，不引入 `@modelcontextprotocol/sdk` 依赖（Electron 主进程保持轻量）。对齐 hermes-agent 的 `_CuaDriverSession` 设计：

```typescript
class CuaDriverMcpClient {
  private proc: ChildProcess | null = null
  private requestId = 0
  private pending = new Map<number, { resolve, reject, timeout }>()
  private buffer = ''

  /** 启动 cua-driver mcp 子进程并完成 initialize 握手 */
  async start(): Promise<void> {
    // 1. spawn('cua-driver', ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] })
    // 2. 发送 initialize 请求
    // 3. 发送 tools/list 获取能力信息
    // 4. 缓存 capabilities 和 capability_version
  }

  /** 调用 MCP 工具 */
  async callTool(name: string, args: Record<string, unknown>, timeoutMs?: number): Promise<McpToolResult> {
    // 发送 tools/call JSON-RPC 请求
    // 解析响应：content (text/image parts) + structuredContent + isError
  }

  /** 优雅关闭 */
  async stop(): Promise<void> {
    // 关闭 stdin，等待进程退出，超时则 kill
  }

  /** 能力查询 */
  supportsCapability(capability: string, tool?: string): boolean
  hasTool(name: string): boolean
}
```

#### 5.1.3 健康检查

```typescript
/** 调用 cua-driver health_report MCP 工具，返回结构化检查矩阵 */
async function runHealthReport(): Promise<{ ok: boolean; checks: HealthCheck[] }> {
  // 通过 MCP 客户端调用 health_report 工具
  // 解析 structuredContent: { schema_version, platform, driver_version, overall, checks: [{name, status, message, hint, data}] }
}
```

#### 5.1.4 权限管理（macOS）

```typescript
/** 查询 macOS TCC 权限状态 */
async function getPermissionsStatus(): Promise<{
  accessibility: boolean | null
  screenRecording: boolean | null
}> {
  // macOS: 调用 cua-driver permissions status --json
  // Windows/Linux: 返回 null（无 TCC 模型）
}

/** 请求 macOS TCC 权限 */
async function grantPermissions(): Promise<{ success: boolean; error?: string }> {
  // macOS: 调用 cua-driver permissions grant
  // 会弹出系统设置对话框，需要用户手动授权
}
```

#### 5.1.5 统一状态查询

```typescript
/** 获取 Computer-Use 完整就绪状态（对齐 hermes 的 computer_use_status） */
async function getComputerUseStatus(): Promise<CuaDriverStatus> {
  // 组合：二进制检测 + 版本 + 健康检查 + 权限状态
  // ready = macOS: accessibility && screenRecording
  //       = Windows/Linux: doctor.ok
}
```

#### 5.1.6 IPC Handler 注册

```typescript
function registerCuaDriverIPCHandlers(): void {
  // cua-driver:status — 获取完整状态
  ipcMain.handle('cua-driver:status', () => getComputerUseStatus())

  // cua-driver:install — 安装/升级 cua-driver
  ipcMain.handle('cua-driver:install', () => installCuaDriver())

  // cua-driver:doctor — 运行健康检查
  ipcMain.handle('cua-driver:doctor', () => runHealthReport())

  // cua-driver:permissions:status — 查询权限
  ipcMain.handle('cua-driver:permissions:status', () => getPermissionsStatus())

  // cua-driver:permissions:grant — 请求权限
  ipcMain.handle('cua-driver:permissions:grant', () => grantPermissions())

  // cua-driver:check-update — 检查更新
  ipcMain.handle('cua-driver:check-update', () => checkUpdate())

  // cua-driver:tool — 直接调用 MCP 工具（用于 UI 扩展功能）
  ipcMain.handle('cua-driver:tool', (_e, name, args) => callToolDirectly(name, args))
}
```

### 5.2 Preload API 暴露

**文件**: `electron/preload.ts`

在 `contextBridge.exposeInMainWorld('electronAPI', {...})` 中添加 `computerUse` 命名空间：

```typescript
computerUse: {
  /** 获取 cua-driver 完整状态 */
  getStatus: (): Promise<CuaDriverStatus> =>
    ipcRenderer.invoke('cua-driver:status'),

  /** 安装/升级 cua-driver */
  install: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('cua-driver:install'),

  /** 运行健康检查 */
  doctor: (): Promise<{ ok: boolean; checks: HealthCheck[] }> =>
    ipcRenderer.invoke('cua-driver:doctor'),

  /** 查询 macOS TCC 权限状态 */
  getPermissions: (): Promise<{
    accessibility: boolean | null
    screenRecording: boolean | null
  }> => ipcRenderer.invoke('cua-driver:permissions:status'),

  /** 请求 macOS TCC 权限 */
  grantPermissions: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('cua-driver:permissions:grant'),

  /** 检查 cua-driver 更新 */
  checkUpdate: (): Promise<{ updateAvailable: boolean; latestVersion?: string; currentVersion?: string }> =>
    ipcRenderer.invoke('cua-driver:check-update'),

  /** 直接调用 cua-driver MCP 工具（高级用途） */
  callTool: (name: string, args: Record<string, unknown>): Promise<McpToolResult> =>
    ipcRenderer.invoke('cua-driver:tool', name, args),
},
```

### 5.3 TypeScript 类型定义

**文件**: `src/types/computerUse.ts`

```typescript
/** cua-driver 二进制状态 */
export interface CuaDriverStatus {
  platform: string
  platformSupported: boolean
  installed: boolean
  binaryPath: string | null
  version: string | null
  ready: boolean | null
  canGrant: boolean
  checks: HealthCheck[]
  error: string | null
  accessibility: boolean | null
  screenRecording: boolean | null
}

/** 健康检查项 */
export interface HealthCheck {
  label: string
  status: 'pass' | 'fail' | 'skip'
  message: string
  hint?: string
}

/** MCP 工具调用结果 */
export interface McpToolResult {
  data: unknown
  images: string[]
  imageMimeTypes: string[]
  structuredContent: Record<string, unknown> | null
  isError: boolean
}

/** cua-driver 更新检查结果 */
export interface CuaDriverUpdateInfo {
  updateAvailable: boolean
  latestVersion: string | null
  currentVersion: string | null
}
```

### 5.4 Pinia Store

**文件**: `src/stores/computerUse.ts`

```typescript
export const useComputerUseStore = defineStore('computerUse', () => {
  const status = ref<CuaDriverStatus | null>(null)
  const loading = ref(false)
  const installing = ref(false)
  const granting = ref(false)
  const error = ref<string | null>(null)

  /** 刷新状态 */
  async function refreshStatus() {
    loading.value = true
    try {
      status.value = await api.computerUse.getStatus()
    } catch (e) {
      error.value = String(e)
    } finally {
      loading.value = false
    }
  }

  /** 安装 cua-driver */
  async function install() {
    installing.value = true
    try {
      const result = await api.computerUse.install()
      if (result.success) await refreshStatus()
      return result
    } finally {
      installing.value = false
    }
  }

  /** 请求权限（macOS） */
  async function grantPermissions() {
    granting.value = true
    try {
      const result = await api.computerUse.grantPermissions()
      if (result.success) await refreshStatus()
      return result
    } finally {
      granting.value = false
    }
  }

  /** 运行健康检查 */
  async function runDoctor() {
    return api.computerUse.doctor()
  }

  /** 是否已就绪 */
  const isReady = computed(() => status.value?.ready === true)
  /** 是否已安装 */
  const isInstalled = computed(() => status.value?.installed === true)
  /** 是否支持当前平台 */
  const isPlatformSupported = computed(() => status.value?.platformSupported === true)

  return {
    status, loading, installing, granting, error,
    isReady, isInstalled, isPlatformSupported,
    refreshStatus, install, grantPermissions, runDoctor,
  }
})
```

### 5.5 设置面板组件

**文件**: `src/components/settings/ComputerUseSettings.vue`

**UI 结构**（复刻 hermes 的 `computer-use-panel.tsx`）:

```
┌─────────────────────────────────────────────────┐
│  🖥️ Computer Use                                │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 安装状态                                 │    │
│  │  ✅ cua-driver v0.5.8 已安装             │    │
│  │  [检查更新] [重新安装]                    │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 权限状态 (仅 macOS)                      │    │
│  │  ✅ 辅助功能 (Accessibility)     已授权  │    │
│  │  ✅ 屏幕录制 (Screen Recording)  已授权  │    │
│  │  [请求权限]                              │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 健康检查                                 │    │
│  │  ✅ binary_version: cua-driver 0.5.8    │    │
│  │  ✅ platform_supported: macOS 26.4      │    │
│  │  ✅ ax_capability: AX is trusted        │    │
│  │  ✅ screen_capture: ScreenCaptureKit OK │    │
│  │  [运行诊断]                              │    │
│  └─────────────────────────────────────────┘    │
│                                                  │
│  ┌─────────────────────────────────────────┐    │
│  │ 使用说明                                 │    │
│  │  • Agent 会在后台操作桌面，不抢占光标     │    │
│  │  • 支持 macOS / Windows / Linux          │    │
│  │  • 需要 cua-driver 已安装并授权           │    │
│  │  • 在聊天中让 Agent 操作桌面应用即可      │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### 5.6 内置 MCP 预设更新

**文件**: `src/lib/builtinMcp.ts`

将 `sc-computer-use` 预设的后端从 `@zavora-ai/computer-use-mcp` 改为 `cua-driver`：

```typescript
{
  key: 'sc-computer-use',
  name: 'Computer Use (cua-driver)',
  description: '基于 cua-driver 的后台桌面控制：截图、鼠标、键盘、滚动、拖拽 — 不抢占用户光标和键盘焦点。支持 macOS/Windows/Linux。',
  homepage: 'https://github.com/trycua/cua',
  requirements: '需要安装 cua-driver 二进制（可在 Computer Use 设置面板中一键安装）',
  dependency: {
    command: 'cua-driver',
    installerDocs: 'https://cua.ai/docs/cua-driver',
  },
  config: {
    type: 'stdio',
    command: 'cua-driver',
    args: ['mcp'],
    env: {},
  },
},
```

### 5.7 系统提示更新

**文件**: `electron/sessionProcess.ts`

更新 `COMPUTER_USE_AVAILABILITY_HINT` 以匹配 cua-driver 的 MCP 工具命名：

```typescript
const COMPUTER_USE_AVAILABILITY_HINT = [
  'You have access to the sc-computer-use MCP server (cua-driver) for background desktop control — screenshots, mouse, keyboard, scroll, drag — without stealing the user\'s cursor or keyboard focus.',
  'Tools are prefixed with `mcp__sc-computer-use__`. If these tools are not directly in your tool list, they may be deferred behind ToolSearch. Load them first: call ToolSearch with query `select:mcp__sc-computer-use__get_window_state` to load the screenshot/AX-tree tool.',
  'Canonical workflow: (1) call `mcp__sc-computer-use__get_window_state` with pid+window_id to snapshot a window (returns screenshot + numbered element overlays + AX tree). (2) Click by element_index: `mcp__sc-computer-use__click` with pid+window_id+element_index. (3) Re-snapshot to verify.',
  'Use `mcp__sc-computer-use__list_windows` to find target windows, `mcp__sc-computer-use__list_apps` to list running apps, `mcp__sc-computer-use__launch_app` to start an app.',
  'For typing: `mcp__sc-computer-use__type_text` (pid+text). For key combos: `mcp__sc-computer-use__hotkey` (pid+keys). For scrolling: `mcp__sc-computer-use__scroll` (pid+direction+amount).',
  'When the user asks to operate a desktop application, interact with native UI, or perform any GUI task, use these tools. Do NOT just describe what you would do — actually call the tools.',
].join(' ')
```

### 5.8 SettingsPanel 集成

**文件**: `src/components/settings/SettingsPanel.vue`

在设置菜单中添加 Computer-Use tab：

```typescript
// 在 settingMenuItems 中添加
{
  id: 'computer-use',
  label: t('computerUse.title'),
  icon: MonitorIcon,  // 或 MousePointer 图标
}

// 在模板中添加
<ComputerUseSettings
  v-else-if="activeTab === 'computer-use'"
/>
```

### 5.9 i18n 国际化

**文件**: `src/i18n/locales/zh-CN.ts` 和 `src/i18n/locales/en-US.ts`

```typescript
// zh-CN.ts
computerUse: {
  title: 'Computer Use',
  description: '基于 cua-driver 的后台桌面控制，让 Agent 在不抢占光标和键盘焦点的情况下操作桌面应用',
  installStatus: '安装状态',
  installed: '已安装',
  notInstalled: '未安装',
  version: '版本',
  install: '安装',
  reinstall: '重新安装',
  upgrade: '升级',
  checkingUpdate: '检查更新中...',
  updateAvailable: '有新版本可用',
  upToDate: '已是最新版本',
  permissionStatus: '权限状态',
  accessibility: '辅助功能',
  screenRecording: '屏幕录制',
  granted: '已授权',
  notGranted: '未授权',
  unknown: '未知',
  grantPermissions: '请求权限',
  granting: '请求中...',
  healthCheck: '健康检查',
  runDoctor: '运行诊断',
  running: '诊断中...',
  ready: '已就绪',
  notReady: '未就绪',
  platformNotSupported: '当前平台不支持 Computer Use',
  installHint: '点击安装 cua-driver 以启用桌面控制功能',
  permissionHint: 'macOS 需要辅助功能和屏幕录制权限才能控制桌面',
  grantHint: '点击请求 macOS 系统权限，授权后 Agent 可以控制桌面',
  usageGuide: '使用说明',
  usage1: 'Agent 会在后台操作桌面，不抢占光标和键盘焦点',
  usage2: '支持 macOS / Windows / Linux',
  usage3: '需要 cua-driver 已安装并授权',
  usage4: '在聊天中让 Agent 操作桌面应用即可',
  installSuccess: 'cua-driver 安装成功',
  installFailed: 'cua-driver 安装失败',
  grantSuccess: '权限请求已发起，请在系统设置中授权',
  grantFailed: '权限请求失败',
  doctorResult: '诊断结果',
  noChecks: '无检查项',
  refresh: '刷新',
  binaryMissing: 'cua-driver 二进制未找到，请先安装',
  checkUpdateFailed: '检查更新失败',
  driverHealth: '驱动健康状态',
  windowsNote: '首次运行可能触发 Windows SmartScreen 提示，请允许',
  linuxNote: '通过 X11/XWayland 无障碍堆栈驱动桌面 — 无需权限提示',
}
```

---

## 6. 实现步骤

### 阶段 1: Electron 主进程服务层

1. **创建 `electron/cuaDriverMcpClient.ts`**
   - 实现 JSON-RPC 2.0 over stdio 协议
   - `start()` / `stop()` 生命周期管理
   - `callTool(name, args)` 工具调用
   - `initialize` 握手 + `tools/list` 能力发现
   - 超时处理 + 自动重连

2. **创建 `electron/cuaDriverService.ts`**
   - 二进制检测: `findCuaDriverBinary()`
   - 安装/升级: `installCuaDriver()` (Windows PowerShell / Unix bash)
   - 健康检查: `runHealthReport()` (通过 MCP 客户端调用 `health_report`)
   - 权限管理: `getPermissionsStatus()` / `grantPermissions()` (macOS only)
   - 更新检查: `checkUpdate()` (调用 `cua-driver check-update --json`)
   - 统一状态: `getComputerUseStatus()`
   - IPC 注册: `registerCuaDriverIPCHandlers()`

3. **修改 `electron/main.ts`**
   - 导入并注册 `registerCuaDriverIPCHandlers()`
   - 应用退出时清理 MCP 客户端连接

### 阶段 2: Preload + 类型 + API

4. **创建 `src/types/computerUse.ts`**
   - 定义 `CuaDriverStatus`, `HealthCheck`, `McpToolResult`, `CuaDriverUpdateInfo` 类型

5. **修改 `electron/preload.ts`**
   - 添加 `computerUse` 命名空间到 `electronAPI`

6. **修改 `src/services/electronAPI.ts`**
   - 添加 `computerUse` API 封装（带 fallback）

### 阶段 3: 前端 Store + UI

7. **创建 `src/stores/computerUse.ts`**
   - Pinia store: status, loading, installing, granting
   - 方法: refreshStatus, install, grantPermissions, runDoctor

8. **创建 `src/components/settings/ComputerUseSettings.vue`**
   - 安装状态卡片
   - 权限状态卡片（macOS）
   - 健康检查卡片
   - 使用说明卡片
   - 所有操作按钮 + loading 状态

9. **修改 `src/components/settings/SettingsPanel.vue`**
   - 添加 Computer-Use tab 到设置菜单
   - 引入 `ComputerUseSettings` 组件

### 阶段 4: MCP 集成 + 系统提示

10. **修改 `src/lib/builtinMcp.ts`**
    - 将 `sc-computer-use` 预设的后端改为 `cua-driver`
    - 更新描述、homepage、requirements

11. **修改 `electron/mcpConfigStore.ts`**
    - 更新 `BUNDLED_MCP_SERVERS` 中 `sc-computer-use` 的配置（cua-driver 是独立二进制，不走 bun + server.js 模式）
    - 移除 `bundled` 标记，改为 `dependency.command = 'cua-driver'` 模式

12. **修改 `electron/sessionProcess.ts`**
    - 更新 `COMPUTER_USE_AVAILABILITY_HINT` 常量，匹配 cua-driver 的工具命名

### 阶段 5: i18n

13. **修改 `src/i18n/locales/zh-CN.ts`**
    - 添加 `computerUse` 命名空间的所有翻译

14. **修改 `src/i18n/locales/en-US.ts`**
    - 添加 `computerUse` 命名空间的所有翻译

### 阶段 6: 验证

15. **构建验证**
    - `npm run typecheck` — 类型检查通过
    - `npm run build` — 构建通过

16. **功能验证**
    - 安装 cua-driver: 在设置面板中点击安装
    - 权限授权: macOS 上请求辅助功能 + 屏幕录制权限
    - 健康检查: 运行诊断，查看检查矩阵
    - 聊天中使用: 在聊天中让 Agent 操作桌面应用

---

## 7. 关键实现细节

### 7.1 MCP 客户端协议实现

cua-driver 使用标准 MCP JSON-RPC 2.0 over stdio 协议。Electron 主进程的 MCP 客户端需要实现：

```typescript
// 1. 启动子进程
const proc = spawn('cua-driver', ['mcp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, CUA_DRIVER_RS_TELEMETRY_ENABLED: '0' },
})

// 2. 发送 initialize 请求
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
// 等待响应...

// 3. 发送 tools/list 获取工具清单
send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
// 解析响应中的 tools[].capabilities 和 capability_version

// 4. 调用工具
send({
  jsonrpc: '2.0', id: 3, method: 'tools/call',
  params: { name: 'health_report', arguments: {} }
})
// 解析响应: result.content (text/image parts) + result.structuredContent + result.isError
```

**响应解析**（对齐 hermes 的 `_extract_tool_result`）:

```typescript
function extractToolResult(mcpResult: any): McpToolResult {
  const data = null
  const images: string[] = []
  const imageMimeTypes: string[] = []
  const textChunks: string[] = []
  const isError = mcpResult.isError ?? false
  const structured = mcpResult.structuredContent ?? null

  for (const part of mcpResult.content ?? []) {
    if (part.type === 'text') {
      textChunks.push(part.text ?? '')
    } else if (part.type === 'image') {
      if (part.data) {
        images.push(part.data)
        imageMimeTypes.push(part.mimeType ?? '')
      }
    }
  }

  let parsedData: unknown = null
  if (textChunks.length > 0) {
    const joined = textChunks.join('\n')
    try {
      parsedData = joined.trim().startsWith('{') || joined.trim().startsWith('[')
        ? JSON.parse(joined)
        : joined
    } catch {
      parsedData = joined
    }
  }

  return { data: parsedData, images, imageMimeTypes, structuredContent: structured, isError }
}
```

### 7.2 安装脚本

**Windows (PowerShell)**:

```typescript
async function installCuaDriverWindows(): Promise<void> {
  const psScript = `irm https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1 | iex`
  const proc = spawn('powershell', ['-ExecutionPolicy', 'Bypass', '-Command', psScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // 流式读取 stdout/stderr，等待退出
}
```

**macOS/Linux (bash)**:

```typescript
async function installCuaDriverUnix(): Promise<void> {
  const cmd = `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)"`
  const proc = spawn('bash', ['-c', cmd], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  // 流式读取 stdout/stderr，等待退出
}
```

### 7.3 健康检查解析

cua-driver 的 `health_report` MCP 工具返回结构化数据：

```json
{
  "schema_version": "1",
  "platform": "darwin",
  "driver_version": "0.5.8",
  "overall": "ok" | "degraded" | "failed",
  "checks": [
    {
      "name": "binary_version",
      "status": "pass" | "fail" | "skip",
      "message": "cua-driver 0.5.8",
      "hint": "...",
      "data": { ... }
    }
  ]
}
```

解析为 `HealthCheck[]`:

```typescript
function parseHealthReport(report: any): { ok: boolean; checks: HealthCheck[] } {
  return {
    ok: report.overall === 'ok',
    checks: (report.checks ?? []).map((c: any) => ({
      label: c.name ?? '',
      status: c.status ?? 'skip',
      message: c.message ?? '',
      hint: c.hint,
    })),
  }
}
```

### 7.4 安全考虑

对齐 hermes-agent 的安全策略，但在 SpaceCode 中安全门控主要依赖 Claude Code CLI 自身的工具审批机制（`permissionMode`），不需要在 MCP 层重复实现。原因：

1. **Claude Code CLI 已有审批**: `sessionProcess.ts` 中的 `ControlProtocolHandler` 已实现工具调用审批流程
2. **MCP 工具名可控**: cua-driver 工具通过 `mcp__sc-computer-use__*` 前缀暴露，可在 `allowedTools` 中精确控制
3. **系统提示引导**: `COMPUTER_USE_AVAILABILITY_HINT` 引导 LLM 正确使用工具

**可选增强**（后续迭代）: 在 `cuaDriverService.ts` 的 `callTool` 方法中添加安全检查：
- 阻断危险按键组合（`cmd+shift+q`, `win+l` 等）
- 阻断危险文本输入（`curl|bash`, `sudo rm -rf` 等）

### 7.5 与现有 `@zavora-ai/computer-use-mcp` 的迁移

现有用户可能已启用 `sc-computer-use`（基于 `@zavora-ai/computer-use-mcp`）。迁移策略：

1. **配置自动迁移**: `mcpConfigStore.ts` 的 `buildEnabledMcpConfig()` 检测到旧配置（command 为 `npx --yes @zavora-ai/computer-use-mcp`）时，自动替换为 `cua-driver mcp`
2. **依赖检测**: 设置面板显示 cua-driver 是否已安装；未安装时提供一键安装
3. **回退兼容**: 如果 cua-driver 未安装但用户已启用 sc-computer-use，在系统提示中告知 Agent 该工具集不可用

---

## 8. 测试计划

### 8.1 单元测试

| 测试项 | 文件 | 覆盖内容 |
|--------|------|---------|
| MCP 客户端 | `electron/__tests__/cuaDriverMcpClient.test.ts` | JSON-RPC 协议、initialize 握手、tool call、错误处理、超时 |
| 状态查询 | `electron/__tests__/cuaDriverService.test.ts` | 二进制检测、健康检查解析、权限状态解析 |
| Store | `tests/composables/computerUse.test.ts` | 状态管理、loading 状态、错误处理 |

### 8.2 集成测试

| 测试项 | 步骤 |
|--------|------|
| 安装流程 | 点击安装 → 等待完成 → 验证二进制可用 |
| 权限流程 (macOS) | 点击请求权限 → 系统设置弹窗 → 授权 → 状态更新 |
| 健康检查 | 运行诊断 → 查看检查矩阵 → 验证结果正确 |
| 聊天集成 | 启用 sc-computer-use → 聊天中让 Agent 截图 → 验证截图返回 |

### 8.3 构建验证

```bash
npm run typecheck   # TypeScript 类型检查
npm run build       # 完整构建
```

---

## 9. 后续迭代方向

1. **实时截图预览**: 在 InfoPanel 中显示 cua-driver 截图，用户可实时查看 Agent 看到的画面
2. **轨迹录制 UI**: 在设置面板中管理录制（start/stop/replay），查看录制历史
3. **Agent 光标自定义**: 让用户自定义 Agent 光标颜色、样式、动画
4. **安全门控增强**: 在主进程层实现危险按键/文本阻断（对齐 hermes 的 `_BLOCKED_KEY_COMBOS`）
5. **视觉路由**: 当主模型不支持视觉时，将截图路由到辅助视觉模型预分析
6. **多会话光标**: 支持并发 Agent 会话各自拥有独立光标颜色
7. **cua-driver 自动更新**: 定期检查更新，一键升级
8. **技能包安装**: 集成 `cua-driver skills install` 安装平台深度文档

---

## 10. 参考资源

- [cua GitHub 仓库](https://github.com/trycua/cua)
- [cua-driver 文档](https://cua.ai/docs/cua-driver)
- [cua-driver README](https://github.com/trycua/cua/blob/main/libs/cua-driver/README.md)
- [cua-driver SKILL.md](https://github.com/trycua/cua/blob/main/libs/cua-driver/rust/Skills/cua-driver/SKILL.md)
- [hermes-agent computer-use 文档](https://hermes-agent.nousresearch.com/docs/user-guide/features/computer-use)
- [MCP 协议规范](https://spec.modelcontextprotocol.io/)
- [cua-driver install.ps1](https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.ps1)
- [cua-driver install.sh](https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh)
