# SpaceCode 手机端 App 设计文档

> 日期: 2026-06-07
> 状态: 设计完成，待实现

## 1. 概述

开发一个 Flutter 手机端 App，与 SpaceCode 桌面端联动。手机端发送聊天消息，桌面端引擎处理后将 LLM 回复流式返回手机端。桌面端提供"连接手机"功能，弹出二维码供手机端扫描连接。

### 1.1 功能范围

- 聊天核心：发送消息、接收流式回复、工具调用展示、权限交互
- 会话管理：历史会话浏览/恢复、新建会话、切换会话
- Agent 选择：从桌面端同步 Agent 列表，指定 Agent 对话
- 主题同步：桌面端主题配置实时同步到手机端
- 设置同步：部分设置与桌面端保持一致

### 1.2 连接场景

- **首版**：局域网直连（同一 WiFi），WebSocket 通信
- **后续迭代**：远程连接（中继服务器 / 内网穿透 / WebRTC P2P）

### 1.3 交互风格

原生移动端体验，保留核心信息结构，交互适配移动端习惯（底部输入、手势操作、底部 Sheet）。

## 2. 整体架构

```
Flutter App (mobile-app/)
    │  WebSocket (局域网直连)
    ▼
Electron 主进程 (mobileServer.ts)
    │  复用现有 IPC 逻辑
    ▼
引擎子进程 (SessionProcess)
    │  HTTP/SSE
    ▼
LLM API
```

### 2.1 项目结构

```
d:\AI\SpaceCode\
├── electron/
│   ├── mobileServer.ts          # 新增: WebSocket 服务器
│   ├── main.ts                  # 修改: 注册 mobile IPC
│   ├── preload.ts               # 修改: 暴露 mobile API
│   └── ...
├── src/
│   ├── components/
│   │   └── mobile/
│   │       └── ConnectMobileDialog.vue  # 新增: 连接手机弹窗
│   ├── services/
│   │   └── electronAPI.ts       # 修改: 新增 mobile API
│   └── ...
├── mobile-app/                  # 新增: Flutter 手机端
│   ├── lib/
│   │   ├── main.dart
│   │   ├── app.dart
│   │   ├── core/
│   │   │   ├── connection/
│   │   │   │   ├── connection_service.dart
│   │   │   │   ├── connection_state.dart
│   │   │   │   └── qr_scanner_page.dart
│   │   │   ├── protocol/
│   │   │   │   ├── protocol.dart
│   │   │   │   └── protocol_parser.dart
│   │   │   ├── theme/
│   │   │   │   ├── theme_service.dart
│   │   │   │   ├── theme_definitions.dart
│   │   │   │   └── code_theme.dart
│   │   │   └── storage/
│   │   │       └── local_storage.dart
│   │   ├── features/
│   │   │   ├── chat/
│   │   │   │   ├── chat_screen.dart
│   │   │   │   ├── chat_controller.dart
│   │   │   │   ├── widgets/
│   │   │   │   │   ├── message_list.dart
│   │   │   │   │   ├── message_bubble.dart
│   │   │   │   │   ├── streaming_text.dart
│   │   │   │   │   ├── thinking_block.dart
│   │   │   │   │   ├── tool_call_card.dart
│   │   │   │   │   ├── permission_card.dart
│   │   │   │   │   ├── code_block.dart
│   │   │   │   │   ├── markdown_renderer.dart
│   │   │   │   │   └── chat_input.dart
│   │   │   │   └── models/
│   │   │   │       ├── message.dart
│   │   │   │       ├── tool_call.dart
│   │   │   │       └── permission_request.dart
│   │   │   ├── sessions/
│   │   │   │   ├── sessions_screen.dart
│   │   │   │   └── session_tile.dart
│   │   │   ├── agents/
│   │   │   │   ├── agents_screen.dart
│   │   │   │   └── agent_card.dart
│   │   │   └── settings/
│   │   │       └── settings_screen.dart
│   │   └── routing/
│   │       └── router.dart
│   └── pubspec.yaml
└── ...
```

## 3. 通信协议

WebSocket 消息采用 JSON 格式，分为请求（客户端→桌面端）和推送（桌面端→客户端）两类。

### 3.1 客户端 → 桌面端（请求）

| 类型 | 说明 | 对应现有 IPC |
|------|------|-------------|
| `connect` | 连接认证（token） | — |
| `send_message` | 发送聊天消息 | `claude-code:sendMessage` |
| `abort` | 中断当前回复 | `claude-code:abort` |
| `allow_permission` | 批准权限请求 | `claude-code:allowPermission` |
| `deny_permission` | 拒绝权限请求 | `claude-code:denyPermission` |
| `submit_tool_answer` | 工具交互回答 | `claude-code:submitToolAnswer` |
| `list_sessions` | 获取会话列表 | `claude-code:listProjectSessions` |
| `restore_session` | 恢复历史会话 | `claude-code:restoreSession` |
| `new_session` | 新建会话 | — |
| `switch_session` | 切换会话 | — |
| `list_agents` | 获取 Agent 列表 | `claude-code:listAgents` |
| `get_settings` | 获取设置 | `claude-code:getSettings` |

### 3.2 桌面端 → 客户端（推送）

| 类型 | 说明 | 对应现有事件 |
|------|------|-------------|
| `connected` | 连接成功确认 + 主题同步 | — |
| `stream_event` | 流式 token | `claude-code:stream_event` |
| `assistant` | 完整助手消息 | `claude-code:assistant` |
| `tool_use` | 工具调用 | `claude-code:tool_use` |
| `tool_result` | 工具结果 | `claude-code:tool_result` |
| `permission_request` | 权限请求 | `claude-code:permission_request` |
| `result` | 对话完成 | `claude-code:result` |
| `sessions_list` | 会话列表响应 | — |
| `theme_sync` | 完整主题配置 | — |
| `theme_changed` | 主题变更通知 | — |
| `error` | 错误通知 | — |

### 3.3 消息格式

```json
// 请求消息
{
  "type": "send_message",
  "id": "req-1",
  "data": {
    "sessionId": "s-abc",
    "content": "你好",
    "images": []
  }
}

// 推送消息 - 流式 token
{
  "type": "stream_event",
  "data": {
    "sessionId": "s-abc",
    "delta": "你",
    "messageIndex": 0
  }
}

// 推送消息 - 权限请求
{
  "type": "permission_request",
  "data": {
    "sessionId": "s-abc",
    "toolUseId": "tu-xyz",
    "toolName": "Bash",
    "input": "rm -rf /tmp/test"
  }
}

// 推送消息 - 连接成功 + 主题同步
{
  "type": "connected",
  "data": {
    "deviceName": "iPhone 15",
    "theme": { ... }
  }
}
```

## 4. 主题系统

### 4.1 桌面端主题体系

5 套主题，每套包含 60+ CSS 变量：

| 主题 | 风格 | 主色调 |
|------|------|--------|
| `light` | 冷灰蓝 + Teal | `#0d9488` |
| `dark` | 纯黑 + Blue | `#3b82f6` |
| `anthropic` | 暖米色 + Coral | `#cc785c` |
| `anthropic-dark` | 深棕 + Coral | `#cc785c` |
| `system` | 跟随系统 | — |

### 4.2 主题同步协议

连接成功后桌面端推送完整主题配置，主题变更时实时推送：

```json
{
  "type": "theme_sync",
  "data": {
    "theme": "anthropic-dark",
    "accentColor": "anthropic-orange",
    "density": "default",
    "colors": {
      "bgPrimary": "#181715",
      "bgSecondary": "#1c1b1a",
      "bgTertiary": "#1f1e1b",
      "bgElevated": "#252320",
      "bgHover": "#2d2c29",
      "bgActive": "#353332",
      "textPrimary": "#faf9f5",
      "textSecondary": "#a09d96",
      "textMuted": "#6c6a64",
      "textDisabled": "#3d3d3a",
      "accentPrimary": "#cc785c",
      "accentPrimaryHover": "#dd8a6e",
      "accentSecondary": "#5db8a6",
      "accentTertiary": "#e8a55a",
      "success": "#5db872",
      "warning": "#d4a017",
      "error": "#c64545",
      "borderSubtle": "rgba(250,249,245,0.04)",
      "borderDefault": "rgba(250,249,245,0.08)",
      "borderStrong": "rgba(250,249,245,0.14)"
    },
    "codeTheme": {
      "bg": "#1a1918",
      "fg": "#faf9f5",
      "keyword": "#e08870",
      "string": "#7dce94",
      "number": "#f0b56a",
      "comment": "#6c6a64",
      "function": "#7dccbe",
      "builtin": "#dd8a6e",
      "attr": "#7dccbe",
      "tag": "#7dce94"
    }
  }
}
```

### 4.3 Flutter 主题映射

| 桌面端 CSS 变量 | Flutter ColorScheme |
|-----------------|---------------------|
| `--bg-primary` ~ `--bg-active` | `surface` ~ `surfaceContainerHighest` |
| `--text-primary` ~ `--text-disabled` | `onSurface` ~ `outline` |
| `--accent-primary` | `primary` |
| `--accent-secondary` | `secondary` |
| `--accent-tertiary` | `tertiary` |
| `--success/warning/error` | 扩展字段 |
| `--code-*` | 自定义 `CodeTheme` 类 |
| `--border-*` | `outline` / `outlineVariant` |

## 5. 桌面端改动

### 5.1 新增 `electron/mobileServer.ts`

MobileServer 类核心职责：

- 启动 WS 服务器（默认端口 9527，范围 9527-9547）
- 生成连接 Token（`crypto.randomBytes(32).toString('hex')`）
- 二维码数据生成（`ws://IP:PORT?token=XXX`）
- 客户端连接认证
- 消息路由（请求 → 现有 IPC 处理器）
- 事件转发（IPC 事件 → WS 推送）
- 连接管理（心跳、断线）

关键设计：

```typescript
class MobileServer {
  private wss: WebSocket.Server
  private token: string
  private client: WebSocket | null
  private sessionSubscriptions: Map<string, Function[]>

  async start(port?: number): Promise<QRCodeData>
  async stop(): Promise<void>
  getStatus(): ServerStatus

  private handleConnection(ws: WebSocket, req: IncomingMessage)
  private routeMessage(message: MobileRequest): Promise<MobileResponse>
  private subscribeSessionEvents(sessionId: string)
  private unsubscribeSessionEvents(sessionId: string)
  private startHeartbeat()
}
```

消息路由映射：

```typescript
const routeMap = {
  'send_message':       (data) => sessionProcess.sendMessage(data.sessionId, data.content, data.images),
  'abort':              (data) => sessionProcess.abort(data.sessionId),
  'allow_permission':   (data) => sessionProcess.allowPermission(data.sessionId, data.toolUseId),
  'deny_permission':    (data) => sessionProcess.denyPermission(data.sessionId, data.toolUseId),
  'submit_tool_answer': (data) => sessionProcess.submitToolAnswer(data.sessionId, data.toolUseId, data.answer),
  'list_sessions':      ()     => sessionHistoryManager.listProjectSessions(projectRoot),
  'restore_session':    (data) => sessionProcess.resume(data.sessionId),
  'list_agents':        ()     => agentsService.scanLibrary(),
  'get_settings':       ()     => settingsStore.appearance,
  'new_session':        ()     => createNewSession(),
  'switch_session':     (data) => switchToSession(data.sessionId),
}
```

事件转发：

```typescript
private subscribeSessionEvents(sessionId: string) {
  const forward = (eventType: string) => (event: any, data: any) => {
    if (data.sessionId === sessionId) {
      this.sendToClient({ type: eventType, data })
    }
  }

  const unsubscribers = [
    onIPC('claude-code:stream_event',       forward('stream_event')),
    onIPC('claude-code:assistant',           forward('assistant')),
    onIPC('claude-code:tool_use',            forward('tool_use')),
    onIPC('claude-code:tool_result',         forward('tool_result')),
    onIPC('claude-code:permission_request',  forward('permission_request')),
    onIPC('claude-code:result',              forward('result')),
  ]

  this.sessionSubscriptions.set(sessionId, unsubscribers)
}
```

### 5.2 新增 `src/components/mobile/ConnectMobileDialog.vue`

连接手机弹窗：

- 标题："连接手机"
- 二维码展示区域
- 连接状态（等待连接 / 已连接: XXX 设备）
- 局域网地址显示
- 取消按钮

### 5.3 新增 IPC 通道

| 通道 | 方向 | 用途 |
|------|------|------|
| `mobile:startServer` | invoke | 启动 WS 服务器 |
| `mobile:stopServer` | invoke | 停止 WS 服务器 |
| `mobile:getStatus` | invoke | 获取连接状态 |
| `mobile:getQRCode` | invoke | 获取二维码数据 |
| `mobile:onConnected` | on | 手机连接成功通知 |
| `mobile:onDisconnected` | on | 手机断开连接通知 |

### 5.4 修改文件清单

| 文件 | 改动 |
|------|------|
| `electron/main.ts` | 注册 mobile IPC 处理器，生命周期管理 |
| `electron/preload.ts` | 暴露 mobile API 到渲染进程 |
| `src/services/electronAPI.ts` | 新增 mobile API 封装 |
| `src/App.vue` 或设置面板 | 添加"连接手机"入口按钮 |

## 6. Flutter 手机端 App

### 6.1 页面流程

```
App 启动 → 聊天主界面（空状态）
    │ 未连接
    ▼
扫码连接页 → 扫描二维码 → 连接成功
    │ 已连接
    ▼
聊天主界面
├── 顶部: 会话标题 + Agent 名称 + 连接状态灯
├── 左滑手势: 会话列表抽屉
├── 消息区域: 用户消息 / AI 流式回复 / 思考过程 / 工具调用 / 权限请求
└── 底部: 输入栏 + Agent 选择器 + 发送按钮
```

### 6.2 关键交互

- **流式文本**: 逐字渲染 + 光标闪烁动画
- **思考过程**: 默认折叠，点击展开，渐变遮罩
- **代码块**: 语法高亮 + 一键复制 + 横向滚动
- **工具调用卡片**: 可折叠，显示工具名 + 输入摘要 + 执行状态
- **权限请求卡片**: 底部弹出 Sheet，允许/拒绝按钮
- **会话管理**: 左滑抽屉，长按删除/重命名，下拉刷新
- **Agent 选择**: 输入栏左侧图标，点击弹出底部 Sheet

### 6.3 状态管理

使用 Riverpod：

| Provider | 职责 |
|----------|------|
| `connectionProvider` | WS 连接状态 |
| `themeProvider` | 当前主题 |
| `chatProvider` | 当前会话消息列表 + 流式状态 |
| `sessionsProvider` | 会话列表 |
| `agentsProvider` | Agent 列表 |
| `settingsProvider` | 设置 |

### 6.4 依赖包

| 包 | 用途 |
|----|------|
| `web_socket_channel` | WebSocket 通信 |
| `riverpod` + `flutter_hooks` | 状态管理 |
| `go_router` | 路由 |
| `mobile_scanner` | 二维码扫描 |
| `flutter_markdown` + `markdown` | Markdown 渲染 |
| `highlight` + `flutter_highlight` | 代码语法高亮 |
| `shared_preferences` | 本地持久化 |
| `flutter_animate` | 动画 |
| `google_fonts` | 字体（Space Grotesk / IBM Plex Sans / JetBrains Mono） |

## 7. 安全设计

| 措施 | 说明 |
|------|------|
| Token 认证 | 32 字节随机 hex，每次启动生成新 Token |
| 单连接限制 | 同一时间只允许一个手机客户端 |
| 端口范围 | 9527-9547，自动寻找可用端口 |
| 消息校验 | 所有入站消息做类型+字段校验，异常断开 |
| 心跳超时 | 30s 间隔，60s 无响应断开 |
| 桌面端确认 | 首次连接时桌面端弹窗确认设备信息 |

## 8. 远程方案预留

首版只做局域网，架构上预留远程扩展点：

```typescript
interface ConnectionTransport {
  start(): Promise<void>
  stop(): Promise<void>
  send(data: string): void
  onMessage(handler: (data: string) => void): void
  onClose(handler: () => void): void
}

// 首版
class LocalWebSocketTransport implements ConnectionTransport { ... }

// 后续迭代
class RelayTransport implements ConnectionTransport { ... }   // 中继服务器
class WebRTCTransport implements ConnectionTransport { ... }  // P2P
```

## 9. 完整数据流

### 9.1 发送消息 → 收到流式回复

```
1. 手机端用户输入 → chatInput 发送
2. ConnectionService.sendWS({ type: 'send_message', data: { sessionId, content, images } })
3. mobileServer.routeMessage() → sessionProcess.sendMessage()
4. 引擎处理 → stdout 输出事件流
5. ControlProtocolHandler 解析 → EventEmitter 发出事件
6. mobileServer 事件转发器捕获 → WS 推送到手机端
   - stream_event (逐字)
   - assistant (完整消息)
   - tool_use / tool_result (工具调用)
   - result (对话完成)
7. 手机端 ConnectionService 收到 → chatProvider 更新 → UI 实时渲染
```

### 9.2 权限交互

```
1. 引擎发起 can_use_tool → mobileServer 转发 permission_request
2. 手机端 PermissionCard 展示底部 Sheet
3. 用户点击允许/拒绝 → ConnectionService.sendWS({ type: 'allow_permission/deny_permission' })
4. mobileServer → sessionProcess.allowPermission/denyPermission()
5. 引擎继续执行
```
