# SpaceCode H5 WebUI 访问功能 — 实现方案与复刻方案

> 基于 cc-haha 开源项目 H5 访问功能的深度分析与 SpaceCode 项目适配方案

---

## 目录

1. [参考项目 cc-haha H5 访问功能分析](#1-参考项目-cc-haha-h5-访问功能分析)
2. [当前 SpaceCode 项目架构分析](#2-当前-spacecode-项目架构分析)
3. [关键问题回答：手机 WebUI 是重新实现还是复用桌面前端？](#3-关键问题回答)
4. [复刻方案：SpaceCode H5 WebUI 实现](#4-复刻方案spacecode-h5-webui-实现)
5. [详细实现步骤](#5-详细实现步骤)
6. [技术对比与差异](#6-技术对比与差异)

---

## 1. 参考 cc-haha H5 访问功能分析

### 1.1 整体架构

cc-haha 的 H5 访问功能由以下核心组件构成：

```
┌──────────────────────────────────────────────────────────────────────┐
│                        桌面端 (Electron / Tauri)                       │
│                                                                      │
│  ┌─────────────┐    ┌──────────────────────────────────────────────┐ │
│  │  Desktop UI  │    │           Sidecar Server (Bun 二进制)         │ │
│  │  (React App) │    │                                              │ │
│  │              │    │  ┌──────────┐  ┌──────────┐  ┌───────────┐ │ │
│  │  - Settings  │    │  │ HTTP API │  │ H5 静态  │  │ WebSocket │ │ │
│  │  - H5 Tab    │───▶│  │ /api/*   │  │ /code/*  │  │ /ws/*     │ │ │
│  │  - QR Code   │    │  └──────────┘  └──────────┘  └───────────┘ │ │
│  └─────────────┘    │       │              │              │        │ │
│                     │  ┌─────────────────────────────────┐ │        │ │
│                     │  │     H5 Access 认证中间件         │ │        │ │
│                     │  │  (Token 验证 + 请求分类)          │ │        │ │
│                     │  └─────────────────────────────────┘ │        │ │
│                     └──────────────────────────────────────┼────────┘ │
│                                                      │               │
│              绑定 0.0.0.0:<port> (局域网可访问)         │               │
└──────────────────────────────────────────────────────┼───────────────┘
                                                       │
                                    ┌──────────────────┼──────────────┐
                                    │     局域网 (LAN)                 │
                                    │                                  │
                          ┌─────────┴──────────┐                      │
                          │   手机浏览器 (H5)    │                      │
                          │                     │                      │
                          │  扫码打开 URL:       │                      │
                          │  http://<IP>:<PORT>  │                      │
                          │  ?h5Token=<TOKEN>    │                      │
                          │                     │                      │
                          │  加载 H5 Web UI     │                      │
                          │  (同一套前端代码)    │                      │
                          └─────────────────────┘                      │
                                    │                                  │
                          ┌─────────┴──────────┐                      │
                          │   其他手机浏览器    │                      │
                          └─────────────────────┘                      │
                                                                 ──────┘
```

### 1.2 核心文件清单

| 文件路径 | 职责 |
|---------|------|
| `src/server/services/h5AccessService.ts` | H5 访问服务核心：Token 管理、设置持久化、LAN IP 发现 |
| `src/server/api/h5-access.ts` | H5 访问 REST API 路由（enable/disable/regenerate/verify） |
| `src/server/h5AccessPolicy.ts` | 请求分类策略：local-trusted / internal-sdk / h5-browser |
| `src/server/middleware/auth.ts` | 认证中间件：API Key + H5 Token 双重验证 |
| `src/server/router.ts` | 路由注册，将 `/api/h5-access` 映射到处理器 |
| `desktop/electron/services/serverRuntime.ts` | Electron 端 Sidecar 服务器生命周期管理 |
| `desktop/electron/services/sidecarManager.ts` | Sidecar 进程管理：端口分配、环境变量、进程启停 |
| `desktop/src/api/h5Access.ts` | 桌面端 API 客户端：调用 `/api/h5-access/*` |
| `desktop/src/pages/Settings.tsx` | 桌面端设置页 H5 Access Tab（QR 码、Token 管理） |
| `desktop/src/components/layout/H5ConnectionView.tsx` | H5 连接视图（手机端首次连接时输入 URL + Token） |

### 1.3 Token 机制

#### Token 生成与格式

```typescript
// 格式：h5_<base64url(32 random bytes)>
function createToken(): string {
  return `h5_${randomBytes(32).toString('base64url')}`
}
```

#### Token 持久化

Token 存储在 `~/.claude/cc-haha/settings.json` 中：

```json
{
  "h5Access": {
    "enabled": true,
    "token": "h5_aBcDeFgHiJkLmNoPqRsTuVwXyZ...",
    "tokenHash": "sha256hash...",
    "tokenPreview": "h5_aBcD...wXyZ",
    "allowedOrigins": [],
    "publicBaseUrl": "http://192.168.1.100:8080",
    "fixedPort": 8080,
    "disconnectGraceSeconds": 30
  }
}
```

**关键设计决策**：
- **明文存储 Token**（不只是 hash），以便桌面端重启后仍可显示和恢复（issue #767）
- **重新启用时复用已有 Token**，避免已配对的手机断连
- SHA-256 hash 用于服务端验证，避免明文比较
- Token 正则验证：`/^[\x21-\x7e]{16,512}$/`（允许用户自定义 Token）

#### Token 验证流程

```typescript
async validateToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false
  const { h5Access } = await this.readStoredSettings()
  if (!h5Access.enabled || !h5Access.tokenHash) return false
  return hashToken(token) === h5Access.tokenHash  // SHA-256 比较
}
```

### 1.4 请求分类策略

`h5AccessPolicy.ts` 实现了三级请求分类：

| 分类 | 条件 | 是否需要 Token |
|------|------|---------------|
| `local-trusted` | 回环地址 + 本地 Origin | 否 |
| `internal-sdk` | 回环地址 + 本地 Origin + `/sdk/` 路径 | 否 |
| `h5-browser` | 非回环地址（局域网/远程） | **是** |

```typescript
export function classifyH5Request(request: Request, url: URL, context: H5RequestContext): H5RequestKind {
  const origin = request.headers.get('Origin')
  const localTrusted = Boolean(context.clientAddress) &&
    isLoopbackHost(context.clientAddress!) &&
    isLocalDesktopOrNavigationOrigin(origin)

  if (url.pathname.startsWith('/sdk/') && localTrusted) return 'internal-sdk'
  if (localTrusted) return 'local-trusted'
  return 'h5-browser'
}
```

**受保护的路径**：
- `/api/*` — REST API
- `/local-file/*`, `/preview-fs/*` — 文件系统访问
- `/proxy/*` — 代理请求
- `/ws/*` — WebSocket 连接
- `/sdk/*` — SDK 接口

### 1.5 LAN IP 发现

```typescript
export function findPrivateLanAddress(): string | null {
  // 遍历所有网络接口，筛选 IPv4 + 非内部 + 私有地址
  // 按评分排序：
  //   + 物理接口 (wifi/ethernet/en*/eth*) +100
  //   - 虚拟接口 (docker/wsl/vmware/vpn) -200
  //   + 192.168.x.x +30
  //   + 10.x.x.x +20
  //   + 172.16-31.x.x +10
  //   - 169.254.x.x (link-local) -100
}
```

### 1.6 端口管理

```typescript
// 优先端口顺序：
// 1. 用户配置的 fixedPort (settings.json → h5Access.fixedPort)
// 2. 上次使用的端口 (desktop-server-state.json → lastPort)
// 3. OS 分配的随机端口（兜底）

export function preferredServerPorts(env = process.env): number[] {
  const ports: number[] = []
  const fixedPort = readH5FixedPort(env)    // 用户配置
  if (fixedPort !== null) ports.push(fixedPort)
  const lastPort = readLastServerPort(env)  // 上次使用
  if (lastPort !== null && !ports.includes(lastPort)) ports.push(lastPort)
  return ports
}
```

### 1.7 QR 码内容

QR 码包含的是一个完整的启动 URL：

```
http://192.168.1.100:8080?serverUrl=http://192.168.1.100:8080&h5Token=h5_aBcD...
```

手机扫码后：
1. 浏览器打开该 URL
2. 加载 H5 Web UI（同一套前端代码构建的静态文件）
3. 前端从 URL 参数中提取 `serverUrl` 和 `h5Token`
4. 使用这些参数建立 WebSocket 连接和发送 API 请求

### 1.8 Sidecar 服务器

cc-haha 使用 Bun 编译的独立二进制作为服务器：

```typescript
// 环境变量配置
CLAUDE_H5_AUTO_PUBLIC_URL=1     // 启用自动 LAN URL 发现
CLAUDE_H5_DIST_DIR=./dist       // H5 静态文件目录

// 启动命令
claude-sidecar server --app-root . --host 0.0.0.0 --port 8080
```

服务器同时提供：
- **静态文件服务**：`/code/*` 路径服务 H5 Web UI
- **REST API**：`/api/*` 路径提供会话、消息等 API
- **WebSocket**：`/ws/*` 路径提供实时通信
- **健康检查**：`/health` 端点

### 1.9 桌面端 H5 设置 UI

桌面端设置页有专门的 "H5 Access" Tab：

- **启用/禁用开关**：带确认弹窗
- **状态徽章**：显示 Enabled/Disabled
- **QR 码展示**：`QRCode.toDataURL(h5LaunchUrl)` 生成
- **Token 显示**：带显示/隐藏切换、复制按钮
- **启动 URL 复制**：复制完整的带 Token 的 URL
- **Public Base URL 配置**：可手动指定或自动发现
- **Fixed Port 配置**：固定端口（下次启动生效）
- **Disconnect Grace 配置**：空闲断开宽限期
- **诊断信息**：主机可达性、建议主机、活跃端口

### 1.10 H5 Web UI 本身

**关键发现**：H5 Web UI **就是桌面端前端应用本身**，构建为静态文件后由 Sidecar 服务器提供。

- 桌面端 React 应用通过 `vite build` 构建到 `dist/` 目录
- Sidecar 服务器从 `CLAUDE_H5_DIST_DIR` 指定的目录提供静态文件
- 手机浏览器访问 `/code` 路径加载同一套前端代码
- 前端应用检测运行环境（Electron vs 浏览器），自动切换通信方式：
  - **Electron 环境**：使用 IPC（`window.electronAPI`）
  - **浏览器环境**：使用 HTTP API + WebSocket
- 前端具有响应式设计，适配手机屏幕

---

## 2. 当前 SpaceCode 项目架构分析

### 2.1 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vue 3 + TypeScript + Vite 5 |
| 桌面 | Electron 29 |
| 状态管理 | Pinia stores |
| 样式 | Sass (`.scss`), scoped styles |
| 引擎 | Bun runtime (engine/, 独立子项目) |

### 2.2 现有移动端基础设施

SpaceCode **已有**一套基于 WebSocket + Flutter 原生 App 的移动端方案：

| 组件 | 路径 | 状态 | 说明 |
|------|------|------|------|
| WebSocket 服务器 | `electron/mobileServer.ts` | ✅ 已实现 | 仅 WebSocket，无 HTTP/静态文件 |
| 移动端类型定义 | `electron/mobileServerTypes.ts` | ✅ 已实现 | MobileRequest/MobilePush/QRCodeData |
| IPC 桥接 | `electron/main.ts` (registerMobileIPCHandlers) | ✅ 已实现 | mobile:startServer/stopServer/getStatus |
| Preload API | `electron/preload.ts` | ✅ 已实现 | mobile 命名空间 |
| 渲染进程 API | `src/services/electronAPI.ts` | ✅ 已实现 | mobile API 封装 |
| 连接弹窗 | `src/components/mobile/ConnectMobileDialog.vue` | ✅ 已实现 | QR 码展示 + 状态轮询 |
| Flutter App | `mobile-app/` | ✅ 已实现 | 原生 App，WebSocket 连接 |
| 远程控制服务器 | `engine/packages/remote-control-server/` | ✅ 已实现 | 独立 Hono 服务器 + React Web UI |

### 2.3 现有 WebSocket 服务器分析

```typescript
// electron/mobileServer.ts — 当前实现
export class MobileServer extends EventEmitter {
  // 仅 WebSocket，无 HTTP
  async start(preferredPort = 9527): Promise<QRCodeData> {
    this.token = crypto.randomBytes(32).toString('hex')  // 每次重新生成，不持久化
    this.wss = new WebSocketServer({ port })              // 仅 WebSocket
    const url = `ws://${ip}:${port}?token=${this.token}`  // QR 码内容是 ws:// URL
    return { url, token, port, ip }
  }
}
```

**与 cc-haha 的关键差异**：

| 特性 | SpaceCode 现有 | cc-haha |
|------|---------------|---------|
| 协议 | 仅 WebSocket | HTTP + WebSocket |
| 静态文件服务 | ❌ 无 | ✅ 提供 H5 Web UI |
| Token 持久化 | ❌ 每次重新生成 | ✅ 持久化到 settings.json |
| Token 格式 | `hex(32 bytes)` | `h5_<base64url(32 bytes)>` |
| QR 码内容 | `ws://IP:PORT?token=XXX` | `http://IP:PORT?serverUrl=...&h5Token=...` |
| 手机端 | Flutter 原生 App | 浏览器 H5 |
| 请求分类 | ❌ 无 | ✅ local-trusted / h5-browser |
| 端口管理 | 随机可用端口 | 固定端口 + 粘性端口 |
| LAN IP 发现 | 第一个非内部 IPv4 | 评分排序（物理接口优先） |
| 设置 UI | 连接弹窗（仅 QR + 状态） | 完整设置 Tab |

### 2.4 聊天/会话架构

```
用户输入 → chatSession store → sessionProcess (Electron)
                                    ↓
                            Claude Code CLI 子进程
                                    ↓
                            流式响应 → chatStream store → UI 更新
```

- `chatSession` store 管理会话列表和当前会话
- `sessionProcess.ts` (Electron 主进程) 管理 CLI 子进程
- `chatStream` store 处理流式响应
- IPC 通道：`claude-code:sendMessage`, `claude-code:stream_event`, `claude-code:permission_request` 等

### 2.5 前端构建

```typescript
// vite.config.mts
export default defineConfig({
  plugins: [
    vue({ ... }),
    electron([
      { entry: 'electron/main.ts', ... },
      { entry: 'electron/preload.ts', ... },
    ]),
    renderer({ ... }),
  ],
  build: {
    outDir: 'dist',  // 前端构建输出目录
  },
})
```

前端构建产物在 `dist/` 目录，包含 `index.html` + `assets/*`。

---

## 3. 关键问题回答

### 问题：手机扫码连接后的手机 WebUI 界面是重新实现的吗，还是复用当前桌面前端然后做手机端适配？

### 回答：**复用桌面前端 + 手机端适配**（cc-haha 的做法）

在 cc-haha 项目中，H5 Web UI **就是桌面端前端应用本身**，具体机制如下：

1. **同一套代码**：桌面端 React 应用和手机 H5 页面使用完全相同的前端代码库
2. **构建为静态文件**：通过 `vite build` 构建到 `dist/` 目录
3. **由服务器提供**：Sidecar 服务器从 `CLAUDE_H5_DIST_DIR` 提供静态文件服务
4. **环境检测**：前端应用检测运行环境（`window.electronAPI` 是否存在），自动切换通信方式：
   - Electron 环境 → IPC 通信
   - 浏览器环境 → HTTP API + WebSocket
5. **响应式设计**：前端 UI 使用 CSS 响应式布局，适配不同屏幕尺寸
6. **URL 参数传递**：扫码后从 URL 参数获取 `serverUrl` 和 `h5Token`，自动建立连接

### 对 SpaceCode 的建议

**推荐采用同样的"复用 + 适配"策略**，理由如下：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **A. 复用桌面前端** ✅ 推荐 | 代码复用率高、UI 一致、维护成本低 | 需要前端做响应式适配 + 环境检测 |
| B. 重新实现 H5 | 可针对手机优化体验 | 代码重复、维护成本高、UI 不一致 |
| C. 复用 engine/remote-control-server | 已有 React Web UI | 技术栈不统一(React vs Vue)、需额外集成 |

**方案 A 的具体实现思路**：

1. Vue 3 前端添加环境检测层（`isElectron()` / `isBrowser()`）
2. 创建统一的 API 抽象层，根据环境自动选择 IPC 或 HTTP/WebSocket
3. 添加 CSS 响应式断点，手机端隐藏侧边栏等桌面专属 UI
4. Electron 主进程内嵌 HTTP 服务器，提供静态文件 + REST API + WebSocket
5. QR 码包含 HTTP URL + Token，手机浏览器扫码后加载同一套前端

---

## 4. 复刻方案：SpaceCode H5 WebUI 实现

### 4.1 目标架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                        SpaceCode 桌面端 (Electron)                     │
│                                                                      │
│  ┌─────────────┐    ┌──────────────────────────────────────────────┐ │
│  │  Desktop UI  │    │         Electron 内嵌 HTTP 服务器              │ │
│  │  (Vue 3 App) │    │    (express/http + ws, 运行在主进程)           │ │
│  │              │    │                                              │ │
│  │  - Settings  │    │  ┌──────────┐  ┌──────────┐  ┌───────────┐ │ │
│  │  - H5 Tab    │───▶│  │ REST API │  │ 静态文件  │  │ WebSocket │ │ │
│  │  - QR Code   │    │  │ /api/*   │  │ /h5/*    │  │ /ws       │ │ │
│  └─────────────┘    │  └──────────┘  └──────────┘  └───────────┘ │ │
│                     │       │              │              │        │ │
│                     │  ┌─────────────────────────────────┐ │        │ │
│                     │  │     H5 Token 认证中间件          │ │        │ │
│                     │  │  (Bearer Token 验证)              │ │        │ │
│                     │  └─────────────────────────────────┘ │        │ │
│                     └──────────────────────────────────────┼────────┘ │
│                      绑定 0.0.0.0:<port> (局域网可访问)      │          │
└──────────────────────────────────────────────────────────┼───────────┘
                                                           │
                                    ┌──────────────────────┼──────────┐
                                    │     局域网 (LAN)                 │
                                    │                                  │
                          ┌─────────┴──────────┐                      │
                          │   手机浏览器 (H5)    │                      │
                          │                     │                      │
                          │  扫码打开 URL:       │                      │
                          │  http://<IP>:<PORT>  │                      │
                          │  /h5?token=<TOKEN>   │                      │
                          │                     │                      │
                          │  加载 Vue 3 Web UI  │                      │
                          │  (同一套前端代码)    │                      │
                          │  + 手机端响应式适配  │                      │
                          └─────────────────────┘                      │
                                                                 ──────┘
```

### 4.2 核心设计决策

| 决策点 | 方案 | 理由 |
|--------|------|------|
| HTTP 服务器 | Electron 主进程内嵌 `express` + `ws` | 无需独立 Sidecar 二进制，简化部署 |
| 前端复用 | 同一套 Vue 3 代码，环境检测切换通信层 | 代码复用率最高，维护成本低 |
| Token 持久化 | 存储到 `gui-settings.json` | 与现有设置系统一致 |
| 静态文件 | 从 `dist/` 目录提供 | 复用 Vite 构建产物 |
| 通信协议 | HTTP REST API + WebSocket | REST 用于请求/响应，WS 用于流式推送 |

### 4.3 新增/修改文件清单

#### 新增文件

| 文件 | 职责 |
|------|------|
| `electron/h5Server.ts` | H5 HTTP 服务器核心（express + 静态文件 + API 路由） |
| `electron/h5AuthService.ts` | H5 Token 管理（生成、验证、持久化） |
| `electron/h5Types.ts` | H5 相关 TypeScript 类型定义 |
| `src/services/h5Api.ts` | 浏览器端 API 客户端（HTTP fetch 封装） |
| `src/services/h5WebSocket.ts` | 浏览器端 WebSocket 客户端 |
| `src/composables/useH5Mode.ts` | H5 模式 composable（环境检测 + API 切换） |
| `src/components/settings/H5AccessSettings.vue` | H5 访问设置面板组件 |
| `src/styles/mobile.scss` | 手机端响应式样式 |

#### 修改文件

| 文件 | 改动 |
|------|------|
| `electron/main.ts` | 注册 H5 服务器 IPC，生命周期管理 |
| `electron/preload.ts` | 暴露 H5 API 到渲染进程 |
| `src/services/electronAPI.ts` | 新增 H5 API 封装 |
| `src/App.vue` | 添加 H5 模式路由入口 + 响应式布局 |
| `src/stores/chatSession.ts` | 添加 H5 模式下的会话管理适配 |
| `src/stores/chatStream.ts` | 添加 H5 模式下的流式响应适配 |
| `src/composables/useChat.ts` | 根据 H5 模式切换通信层 |
| `src/i18n/locales/zh-CN.ts` | 添加 H5 相关国际化文本 |
| `src/i18n/locales/en-US.ts` | 添加 H5 相关国际化文本 |
| `vite.config.mts` | 添加 H5 模式构建配置 |

---

## 5. 详细实现步骤

### 阶段一：H5 服务器核心（Electron 主进程）

#### 步骤 1.1：安装依赖

```bash
npm install express ws
npm install -D @types/express @types/ws
```

#### 步骤 1.2：创建 H5 类型定义

```typescript
// electron/h5Types.ts

/** H5 访问设置 */
export interface H5AccessSettings {
  enabled: boolean
  token: string | null
  tokenPreview: string | null
  publicBaseUrl: string | null
  fixedPort: number | null
}

/** H5 服务器状态 */
export interface H5ServerStatus {
  running: boolean
  port: number
  ip: string
  publicUrl: string | null
  connectedClients: number
}

/** QR 码数据 */
export interface H5QRCodeData {
  url: string         // http://IP:PORT/h5?token=TOKEN
  token: string
  port: number
  ip: string
}

/** H5 认证结果 */
export interface H5AuthResult {
  valid: boolean
  error?: string
}
```

#### 步骤 1.3：创建 H5 认证服务

```typescript
// electron/h5AuthService.ts
import { createHash, randomBytes } from 'crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import os from 'os'

const TOKEN_PREFIX = 'h5_'
const TOKEN_REGEX = /^h5_[A-Za-z0-9_-]{16,512}$/

export class H5AuthService {
  private settingsPath: string
  private cachedSettings: H5AccessSettings | null = null

  constructor() {
    this.settingsPath = join(app.getPath('userData'), 'h5-access.json')
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  private createToken(): string {
    return `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  }

  private createTokenPreview(token: string): string {
    return `${token.slice(0, 8)}...${token.slice(-4)}`
  }

  private readSettings(): H5AccessSettings {
    if (this.cachedSettings) return this.cachedSettings
    try {
      const raw = readFileSync(this.settingsPath, 'utf-8')
      this.cachedSettings = JSON.parse(raw)
    } catch {
      this.cachedSettings = {
        enabled: false,
        token: null,
        tokenPreview: null,
        publicBaseUrl: null,
        fixedPort: null,
      }
    }
    return this.cachedSettings!
  }

  private writeSettings(settings: H5AccessSettings): void {
    mkdirSync(dirname(this.settingsPath), { recursive: true })
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
    this.cachedSettings = settings
  }

  getSettings(): H5AccessSettings {
    return this.readSettings()
  }

  enable(): { settings: H5AccessSettings; token: string } {
    const current = this.readSettings()
    // 复用已有 token（已配对的手机不会断连）
    const token = current.token && TOKEN_REGEX.test(current.token)
      ? current.token
      : this.createToken()
    const next: H5AccessSettings = {
      ...current,
      enabled: true,
      token,
      tokenPreview: this.createTokenPreview(token),
    }
    this.writeSettings(next)
    return { settings: next, token }
  }

  disable(): H5AccessSettings {
    const current = this.readSettings()
    const next: H5AccessSettings = { ...current, enabled: false }
    this.writeSettings(next)
    return next
  }

  regenerateToken(): { settings: H5AccessSettings; token: string } {
    const current = this.readSettings()
    const token = this.createToken()
    const next: H5AccessSettings = {
      ...current,
      enabled: true,
      token,
      tokenPreview: this.createTokenPreview(token),
    }
    this.writeSettings(next)
    return { settings: next, token }
  }

  updateSettings(input: Partial<Pick<H5AccessSettings, 'publicBaseUrl' | 'fixedPort'>>): H5AccessSettings {
    const current = this.readSettings()
    const next: H5AccessSettings = { ...current, ...input }
    this.writeSettings(next)
    return next
  }

  validateToken(token: string | null | undefined): boolean {
    if (!token) return false
    const settings = this.readSettings()
    if (!settings.enabled || !settings.token) return false
    return this.hashToken(token) === this.hashToken(settings.token)
  }

  /** 发现局域网 IP（参考 cc-haha 评分排序） */
  findLanIP(): string {
    const interfaces = os.networkInterfaces()
    const candidates: Array<{ address: string; score: number }> = []

    for (const [name, entries] of Object.entries(interfaces)) {
      if (!entries) continue
      for (const entry of entries) {
        if (entry.family !== 'IPv4' || entry.internal) continue
        let score = 0
        if (/^(wi-?fi|wlan|ethernet|en\d+|eth\d+)/i.test(name)) score += 100
        if (/^(wsl|docker|hyper-?v|veth|virtual|vmware)/i.test(name)) score -= 200
        if (entry.address.startsWith('192.168.')) score += 30
        else if (entry.address.startsWith('10.')) score += 20
        candidates.push({ address: entry.address, score })
      }
    }

    candidates.sort((a, b) => b.score - a.score)
    return candidates[0]?.address ?? '127.0.0.1'
  }
}
```

#### 步骤 1.4：创建 H5 HTTP 服务器

```typescript
// electron/h5Server.ts
import express from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { join } from 'path'
import { existsSync } from 'fs'
import { createServer } from 'http'
import { H5AuthService } from './h5AuthService'
import type { H5QRCodeData, H5ServerStatus } from './h5Types'

export class H5Server {
  private app: express.Application
  private server: ReturnType<typeof createServer> | null = null
  private wss: WebSocketServer | null = null
  private port: number = 0
  private ip: string = '127.0.0.1'
  private auth: H5AuthService
  private clients: Set<WebSocket> = new Set()
  private distDir: string

  constructor(
    private readonly onMessage: (ws: WebSocket, message: any) => Promise<unknown>,
    distDir?: string,
  ) {
    this.app = express()
    this.auth = new H5AuthService()
    this.distDir = distDir ?? join(__dirname, '../dist')
    this.setupMiddleware()
    this.setupRoutes()
  }

  /** Token 认证中间件 */
  private authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // 本地请求不需要认证
    const clientIp = req.ip || req.socket.remoteAddress || ''
    if (this.isLoopback(clientIp) && this.isLocalOrigin(req)) {
      return next()
    }

    // 远程请求需要 Bearer Token
    const authHeader = req.headers.authorization
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

    if (!this.auth.validateToken(token)) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or missing H5 token' })
    }
    next()
  }

  private isLoopback(ip: string): boolean {
    const normalized = ip.replace(/^::ffff:/, '')
    return normalized === '127.0.0.1' || normalized === '::1' || normalized === 'localhost'
  }

  private isLocalOrigin(req: express.Request): boolean {
    const origin = req.headers.origin
    if (!origin) return true
    try {
      const url = new URL(origin)
      return this.isLoopback(url.hostname)
    } catch {
      return false
    }
  }

  private setupMiddleware(): void {
    this.app.use(express.json())

    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*')
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      if (req.method === 'OPTIONS') return res.sendStatus(200)
      next()
    })
  }

  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', version: '1.0.0' })
    })

    // H5 静态文件服务
    const h5Dir = existsSync(this.distDir) ? this.distDir : join(__dirname, '../dist')
    this.app.use('/h5', express.static(h5Dir))
    // SPA fallback
    this.app.get('/h5', (_req, res) => {
      res.sendFile(join(h5Dir, 'index.html'))
    })
    this.app.get('/h5/*', (_req, res) => {
      res.sendFile(join(h5Dir, 'index.html'))
    })

    // H5 Token 认证 API
    this.app.post('/api/h5/verify', (req, res) => {
      const token = req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7) : null
      if (!this.auth.validateToken(token)) {
        return res.status(401).json({ error: 'Invalid token' })
      }
      res.json({ ok: true })
    })

    // 受保护的 API 路由（需要 Token）
    this.app.use('/api', this.authMiddleware)

    // 会话管理 API
    this.app.get('/api/sessions', async (_req, res) => {
      // 由 main.ts 注入实现
      const sessions = await this.onMessage(null as any, { type: 'list_sessions' })
      res.json({ sessions })
    })

    this.app.post('/api/sessions/:sessionId/messages', async (req, res) => {
      const { sessionId } = req.params
      const { content, images } = req.body
      await this.onMessage(null as any, { type: 'send_message', sessionId, content, images })
      res.json({ status: 'sent' })
    })

    this.app.post('/api/sessions/:sessionId/abort', async (req, res) => {
      const { sessionId } = req.params
      await this.onMessage(null as any, { type: 'abort', sessionId })
      res.json({ status: 'ok' })
    })

    this.app.post('/api/sessions/:sessionId/permission/:action', async (req, res) => {
      const { sessionId, action } = req.params
      const { toolUseId, answer } = req.body
      await this.onMessage(null as any, {
        type: action === 'allow' ? 'allow_permission' : 'deny_permission',
        sessionId, toolUseId,
      })
      res.json({ status: 'ok' })
    })
  }

  async start(preferredPort = 9527): Promise<H5QRCodeData> {
    this.ip = this.auth.findLanIP()
    this.port = await this.findAvailablePort(preferredPort, preferredPort + 20)

    this.server = createServer(this.app)
    this.wss = new WebSocketServer({ server: this.server, path: '/ws' })

    this.wss.on('connection', (ws, req) => {
      this.handleWebSocketConnection(ws, req)
    })

    await new Promise<void>((resolve) => {
      this.server!.listen(this.port, '0.0.0.0', resolve)
    })

    const token = this.auth.getSettings().token || ''
    const url = `http://${this.ip}:${this.port}/h5?token=${token}`

    return { url, token, port: this.port, ip: this.ip }
  }

  private handleWebSocketConnection(ws: WebSocket, req: import('http').IncomingMessage): void {
    // Token 认证
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const token = url.searchParams.get('token')

    if (!this.auth.validateToken(token)) {
      ws.close(4003, 'Invalid token')
      return
    }

    this.clients.add(ws)
    ws.on('message', async (raw) => {
      try {
        const message = JSON.parse(raw.toString())
        await this.onMessage(ws, message)
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: err instanceof Error ? err.message : 'Unknown error' },
        }))
      }
    })
    ws.on('close', () => {
      this.clients.delete(ws)
    })
  }

  broadcast(message: any): void {
    const data = JSON.stringify(message)
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data)
      }
    }
  }

  getStatus(): H5ServerStatus {
    return {
      running: this.server !== null,
      port: this.port,
      ip: this.ip,
      publicUrl: `http://${this.ip}:${this.port}/h5`,
      connectedClients: this.clients.size,
    }
  }

  async stop(): Promise<void> {
    for (const client of this.clients) {
      client.close()
    }
    this.clients.clear()
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()))
      this.wss = null
    }
    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()))
      this.server = null
    }
  }

  private findAvailablePort(start: number, end: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const net = require('net')
      const tryPort = (port: number) => {
        if (port > end) return reject(new Error('No available port'))
        const server = net.createServer()
        server.listen(port, () => server.close(() => resolve(port)))
        server.on('error', () => tryPort(port + 1))
      }
      tryPort(start)
    })
  }
}
```

#### 步骤 1.5：集成到 Electron 主进程

在 `electron/main.ts` 中添加 H5 服务器管理：

```typescript
// 新增 import
import { H5Server } from './h5Server'
import { H5AuthService } from './h5AuthService'

// 全局变量
let h5Server: H5Server | null = null
const h5Auth = new H5AuthService()

// 注册 H5 IPC 处理器
function registerH5IPCHandlers(): void {
  // 启动 H5 服务器
  ipcMain.handle('h5:startServer', async (): Promise<H5QRCodeData> => {
    if (h5Server) await h5Server.stop()

    h5Server = new H5Server(async (ws, message) => {
      // 桥接到现有 claudeCode IPC
      switch (message.type) {
        case 'send_message':
          mainWindow?.webContents.send('h5:relay', message)
          break
        case 'abort':
          mainWindow?.webContents.send('h5:relay', message)
          break
        case 'allow_permission':
        case 'deny_permission':
          mainWindow?.webContents.send('h5:relay', message)
          break
        case 'list_sessions':
          const sessions = await mainWindow?.webContents.executeJavaScript(
            `window.__spacecode_api__?.getSessions() || []`
          )
          h5Server?.broadcast({ type: 'sessions_list', data: { sessions } })
          break
      }
    })

    const qrData = await h5Server.start()

    // 转发引擎事件到 H5 客户端
    forwardEngineEventsToH5()

    return qrData
  })

  // 停止 H5 服务器
  ipcMain.handle('h5:stopServer', async () => {
    if (h5Server) {
      await h5Server.stop()
      h5Server = null
    }
  })

  // 获取 H5 状态
  ipcMain.handle('h5:getStatus', (): H5ServerStatus => {
    return h5Server?.getStatus() ?? { running: false, port: 0, ip: '', publicUrl: null, connectedClients: 0 }
  })

  // H5 设置管理
  ipcMain.handle('h5:getSettings', (): H5AccessSettings => h5Auth.getSettings())
  ipcMain.handle('h5:enable', () => h5Auth.enable())
  ipcMain.handle('h5:disable', () => h5Auth.disable())
  ipcMain.handle('h5:regenerate', () => h5Auth.regenerateToken())
  ipcMain.handle('h5:updateSettings', (_e, input) => h5Auth.updateSettings(input))
}

// 转发引擎事件到 H5 客户端
function forwardEngineEventsToH5(): void {
  const eventTypes = [
    'claude-code:stream_event',
    'claude-code:assistant',
    'claude-code:tool_use',
    'claude-code:tool_result',
    'claude-code:permission_request',
    'claude-code:result',
  ]
  for (const eventType of eventTypes) {
    ipcMain.on(eventType, (_event, data) => {
      if (h5Server) {
        const pushType = eventType.replace('claude-code:', '')
        h5Server.broadcast({ type: pushType, data })
      }
    })
  }
}
```

### 阶段二：前端适配

#### 步骤 2.1：创建 H5 模式检测 composable

```typescript
// src/composables/useH5Mode.ts
import { computed } from 'vue'

export function useH5Mode() {
  const isElectron = computed(() => {
    return typeof window !== 'undefined' && !!(window as any).electronAPI
  })

  const isH5Mode = computed(() => {
    if (isElectron.value) return false
    // 检查 URL 是否包含 token 参数（H5 模式标志）
    const url = new URL(window.location.href)
    return url.searchParams.has('token') || url.pathname.startsWith('/h5')
  })

  const h5Token = computed(() => {
    if (!isH5Mode.value) return null
    const url = new URL(window.location.href)
    return url.searchParams.get('token')
  })

  const h5ServerUrl = computed(() => {
    if (!isH5Mode.value) return null
    return window.location.origin
  })

  return { isElectron, isH5Mode, h5Token, h5ServerUrl }
}
```

#### 步骤 2.2：创建 H5 API 客户端

```typescript
// src/services/h5Api.ts
import { ref } from 'vue'

export class H5ApiClient {
  private baseUrl: string
  private token: string

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl
    this.token = token
  }

  private async request(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...options.headers,
      },
    })
  }

  async verifyToken(): Promise<boolean> {
    try {
      const res = await this.request('/api/h5/verify', { method: 'POST' })
      return res.ok
    } catch {
      return false
    }
  }

  async getSessions() {
    const res = await this.request('/api/sessions')
    return res.json()
  }

  async sendMessage(sessionId: string, content: string, images?: string[]) {
    const res = await this.request(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, images }),
    })
    return res.json()
  }

  async abort(sessionId: string) {
    const res = await this.request(`/api/sessions/${sessionId}/abort`, { method: 'POST' })
    return res.json()
  }

  async allowPermission(sessionId: string, toolUseId: string) {
    const res = await this.request(`/api/sessions/${sessionId}/permission/allow`, {
      method: 'POST',
      body: JSON.stringify({ toolUseId }),
    })
    return res.json()
  }

  async denyPermission(sessionId: string, toolUseId: string) {
    const res = await this.request(`/api/sessions/${sessionId}/permission/deny`, {
      method: 'POST',
      body: JSON.stringify({ toolUseId }),
    })
    return res.json()
  }
}
```

#### 步骤 2.3：创建 H5 WebSocket 客户端

```typescript
// src/services/h5WebSocket.ts
import { EventEmitter } from 'events'

export class H5WebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null
  private baseUrl: string
  private token: string
  private reconnectAttempts = 0

  constructor(baseUrl: string, token: string) {
    super()
    this.baseUrl = baseUrl
    this.token = token
  }

  connect(): void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws')
    this.ws = new WebSocket(`${wsUrl}/ws?token=${this.token}`)

    this.ws.onopen = () => {
      this.reconnectAttempts = 0
      this.emit('connected')
    }

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data)
        this.emit('message', message)
        // 按类型分发
        if (message.type) {
          this.emit(message.type, message.data)
        }
      } catch (err) {
        console.error('H5 WS parse error:', err)
      }
    }

    this.ws.onclose = () => {
      this.emit('disconnected')
      this.attemptReconnect()
    }

    this.ws.onerror = (err) => {
      this.emit('error', err)
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= 5) return
    this.reconnectAttempts++
    const delay = Math.min(1000 * this.reconnectAttempts, 5000)
    setTimeout(() => this.connect(), delay)
  }

  send(message: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }
}
```

#### 步骤 2.4：统一通信层适配

修改 `src/composables/useChat.ts`，根据运行环境选择通信方式：

```typescript
// src/composables/useChat.ts 中的关键适配
import { useH5Mode } from './useH5Mode'
import { H5ApiClient } from '@/services/h5Api'
import { H5WebSocketClient } from '@/services/h5WebSocket'

export function useChat() {
  const { isH5Mode, h5Token, h5ServerUrl } = useH5Mode()

  // H5 模式下创建 API 客户端
  const h5Api = isH5Mode.value && h5Token.value && h5ServerUrl.value
    ? new H5ApiClient(h5ServerUrl.value, h5Token.value)
    : null

  const h5Ws = isH5Mode.value && h5Token.value && h5ServerUrl.value
    ? new H5WebSocketClient(h5ServerUrl.value, h5Token.value)
    : null

  async function sendMessage(sessionId: string, content: string, images?: string[]) {
    if (h5Api) {
      // H5 模式：通过 HTTP API
      return h5Api.sendMessage(sessionId, content, images)
    } else {
      // Electron 模式：通过 IPC
      return api.claudeCode.sendMessage(sessionId, content, images)
    }
  }

  // 流式事件监听
  function onStreamEvent(callback: (data: any) => void) {
    if (h5Ws) {
      h5Ws.on('stream_event', callback)
      h5Ws.connect()
    } else {
      // Electron 模式：监听 IPC 事件
      window.electronAPI?.on('claude-code:stream_event', callback)
    }
  }

  return { sendMessage, onStreamEvent, /* ... */ }
}
```

#### 步骤 2.5：响应式布局适配

在 `src/App.vue` 或全局样式中添加手机端适配：

```scss
// src/styles/mobile.scss

// 手机端断点
$mobile-breakpoint: 768px;

// H5 模式下隐藏桌面专属 UI
body.h5-mode {
  // 隐藏侧边栏
  .sidebar-panel {
    display: none !important;
  }

  // 隐藏右侧信息面板
  .info-panel {
    display: none !important;
  }

  // 聊天面板全宽
  .chat-panel {
    flex: 1 !important;
    width: 100% !important;
  }

  // 输入框适配
  .chat-input-area {
    padding: 8px 12px;

    textarea {
      font-size: 16px; // iOS 防止缩放
    }
  }
}

@media (max-width: $mobile-breakpoint) {
  // 触摸友好的按钮尺寸
  button {
    min-height: 44px;
    min-width: 44px;
  }

  // 消息气泡全宽
  .message-bubble {
    max-width: 95% !important;
  }
}
```

### 阶段三：桌面端设置 UI

#### 步骤 3.1：创建 H5 访问设置面板

```vue
<!-- src/components/settings/H5AccessSettings.vue -->
<template>
  <div class="h5-access-settings">
    <div class="settings-header">
      <QrCodeIcon :size="20" />
      <h3>{{ t('settings.h5Access.title') }}</h3>
    </div>

    <p class="description">{{ t('settings.h5Access.description') }}</p>

    <!-- 启用/禁用 -->
    <div class="enable-row">
      <label class="toggle">
        <input type="checkbox" v-model="localEnabled" @change="handleToggle" />
        <span>{{ t('settings.h5Access.enable') }}</span>
      </label>
      <span class="status-badge" :class="{ active: settings.enabled }">
        {{ settings.enabled ? t('settings.h5Access.enabled') : t('settings.h5Access.disabled') }}
      </span>
    </div>

    <!-- QR 码 -->
    <div v-if="settings.enabled && qrData" class="qr-section">
      <canvas ref="qrCanvas" class="qr-canvas"></canvas>
      <div class="qr-info">
        <div class="url-row">
          <span class="label">{{ t('settings.h5Access.url') }}</span>
          <code class="url">{{ qrData.url }}</code>
          <button class="copy-btn" @click="copyUrl">{{ t('common.copy') }}</button>
        </div>
        <div class="token-row">
          <span class="label">{{ t('settings.h5Access.token') }}</span>
          <code class="token">{{ tokenDisplay }}</code>
          <button class="toggle-btn" @click="showToken = !showToken">
            {{ showToken ? t('common.hide') : t('common.show') }}
          </button>
        </div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div v-if="settings.enabled" class="actions">
      <button class="btn-regenerate" @click="handleRegenerate">
        {{ t('settings.h5Access.regenerate') }}
      </button>
      <button class="btn-stop" @click="handleStop">
        {{ t('settings.h5Access.stopServer') }}
      </button>
    </div>

    <!-- 状态信息 -->
    <div v-if="status.running" class="status-info">
      <p>端口: {{ status.port }} | IP: {{ status.ip }}</p>
      <p>已连接客户端: {{ status.connectedClients }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import QRCode from 'qrcode'
import { api } from '@/services/electronAPI'

const { t } = useI18n()
const qrCanvas = ref<HTMLCanvasElement | null>(null)
const qrData = ref<{ url: string; token: string } | null>(null)
const settings = ref({ enabled: false, token: null, tokenPreview: null })
const status = ref({ running: false, port: 0, ip: '', publicUrl: null, connectedClients: 0 })
const showToken = ref(false)
const localEnabled = ref(false)
let statusInterval: ReturnType<typeof setInterval> | null = null

const tokenDisplay = computed(() => {
  if (!settings.value.token) return ''
  return showToken.value ? settings.value.token : settings.value.tokenPreview || ''
})

async function loadSettings() {
  settings.value = await api.h5.getSettings()
  localEnabled.value = settings.value.enabled
}

async function startServer() {
  try {
    qrData.value = await api.h5.startServer()
    if (qrCanvas.value && qrData.value) {
      await QRCode.toCanvas(qrCanvas.value, qrData.value.url, {
        width: 200, margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
    }
  } catch (err) {
    console.error('Failed to start H5 server:', err)
  }
}

async function handleToggle() {
  if (localEnabled.value) {
    await api.h5.enable()
    await startServer()
  } else {
    await api.h5.disable()
    await api.h5.stopServer()
    qrData.value = null
  }
  await loadSettings()
}

async function handleRegenerate() {
  await api.h5.regenerate()
  await loadSettings()
  await startServer()
}

async function handleStop() {
  await api.h5.stopServer()
  qrData.value = null
}

async function copyUrl() {
  if (qrData.value) {
    await navigator.clipboard.writeText(qrData.value.url)
  }
}

function startStatusPolling() {
  statusInterval = setInterval(async () => {
    try {
      status.value = await api.h5.getStatus()
    } catch {}
  }, 2000)
}

onMounted(async () => {
  await loadSettings()
  if (settings.value.enabled) {
    await startServer()
  }
  startStatusPolling()
})

onUnmounted(() => {
  if (statusInterval) clearInterval(statusInterval)
})
</script>
```

### 阶段四：Preload API + i18n

#### 步骤 4.1：扩展 preload API

```typescript
// electron/preload.ts 中添加
h5: {
  startServer: (): Promise<import('./h5Types').H5QRCodeData> =>
    ipcRenderer.invoke('h5:startServer'),
  stopServer: (): Promise<void> =>
    ipcRenderer.invoke('h5:stopServer'),
  getStatus: (): Promise<import('./h5Types').H5ServerStatus> =>
    ipcRenderer.invoke('h5:getStatus'),
  getSettings: (): Promise<import('./h5Types').H5AccessSettings> =>
    ipcRenderer.invoke('h5:getSettings'),
  enable: () => ipcRenderer.invoke('h5:enable'),
  disable: () => ipcRenderer.invoke('h5:disable'),
  regenerate: () => ipcRenderer.invoke('h5:regenerate'),
  updateSettings: (input: any) => ipcRenderer.invoke('h5:updateSettings', input),
},
```

#### 步骤 4.2：添加 i18n 文本

```typescript
// src/i18n/locales/zh-CN.ts
h5Access: {
  title: 'H5 访问',
  description: '在局域网内暴露 H5 应用，手机扫码即可在浏览器中使用',
  enable: '启用 H5 访问',
  enabled: '已启用',
  disabled: '已禁用',
  url: '访问地址',
  token: '访问令牌',
  regenerate: '重新生成令牌',
  stopServer: '停止服务器',
  scanHint: '使用手机浏览器扫描二维码',
  waitingConnection: '等待连接...',
  connected: '已连接',
}

// src/i18n/locales/en-US.ts
h5Access: {
  title: 'H5 Access',
  description: 'Expose H5 app on LAN, scan QR code to use in phone browser',
  enable: 'Enable H5 Access',
  enabled: 'Enabled',
  disabled: 'Disabled',
  url: 'Access URL',
  token: 'Access Token',
  regenerate: 'Regenerate Token',
  stopServer: 'Stop Server',
  scanHint: 'Scan QR code with phone browser',
  waitingConnection: 'Waiting for connection...',
  connected: 'Connected',
}
```

---

## 6. 技术对比与差异

### 6.1 cc-haha vs SpaceCode 架构对比

| 维度 | cc-haha | SpaceCode (方案) |
|------|---------|-----------------|
| **服务器** | 独立 Bun 二进制 (Sidecar) | Electron 主进程内嵌 express |
| **前端框架** | React | Vue 3 |
| **构建工具** | Vite | Vite |
| **桌面壳** | Electron + Tauri | Electron |
| **Token 存储** | `~/.claude/cc-haha/settings.json` | `app.getPath('userData')/h5-access.json` |
| **Token 格式** | `h5_<base64url>` | `h5_<base64url>` (相同) |
| **认证方式** | Bearer Token + 请求分类 | Bearer Token + 本地免认证 |
| **静态文件** | Sidecar 从 `CLAUDE_H5_DIST_DIR` 提供 | express 从 `dist/` 提供 |
| **WebSocket** | Sidecar 提供 `/ws/*` | ws 库提供 `/ws` |
| **手机端** | 浏览器 H5 (同套代码) | 浏览器 H5 (同套代码) |
| **通信切换** | `window.electronAPI` 检测 | `window.electronAPI` 检测 |

### 6.2 现有 MobileServer vs 新 H5Server 对比

| 特性 | 现有 MobileServer | 新 H5Server |
|------|-------------------|-------------|
| 协议 | 仅 WebSocket | HTTP + WebSocket |
| 静态文件 | ❌ | ✅ |
| Token 持久化 | ❌ | ✅ |
| REST API | ❌ | ✅ |
| 多客户端 | ❌ (单客户端) | ✅ |
| QR 码内容 | `ws://...` | `http://.../h5?token=...` |
| 手机端 | Flutter 原生 App | 浏览器 H5 |
| 请求分类 | ❌ | ✅ |

### 6.3 实现优先级建议

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | H5 HTTP 服务器 | express + 静态文件 + Token 认证 |
| P0 | Token 管理 | 生成、持久化、验证 |
| P0 | 前端环境检测 | Electron vs 浏览器自动切换 |
| P0 | 通信层适配 | API + WebSocket 客户端 |
| P1 | 响应式布局 | 手机端 CSS 适配 |
| P1 | 设置面板 | H5 Access 设置 Tab |
| P1 | QR 码生成 | 桌面端显示 QR 码 |
| P2 | 多客户端支持 | 同时多个手机连接 |
| P2 | 请求分类策略 | local-trusted / h5-browser |
| P2 | 端口管理 | 固定端口 + 粘性端口 |
| P3 | 断开宽限期 | 空闲会话清理 |
| P3 | LAN IP 评分 | 物理接口优先 |
| P3 | 诊断面板 | 主机可达性检测 |

---

## 总结

本方案基于 cc-haha 开源项目的 H5 访问功能深度分析，为 SpaceCode 设计了一套**复用桌面前端 + 手机端适配**的 H5 WebUI 访问方案。核心思路是：

1. **在 Electron 主进程内嵌 HTTP 服务器**（express + ws），同时提供静态文件服务、REST API 和 WebSocket
2. **复用 Vue 3 前端代码**，通过环境检测自动切换 IPC / HTTP 通信方式
3. **Token 认证机制**，持久化存储，支持启用/禁用/重新生成
4. **QR 码扫码连接**，手机浏览器打开即用，无需安装 App

与现有 Flutter 原生 App 方案互补，用户可以选择安装原生 App 或直接使用浏览器访问。
