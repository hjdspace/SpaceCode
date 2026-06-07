# SpaceCode 手机端联动 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现桌面端 WebSocket 服务器 + Flutter 手机端 App，使手机能扫码连接桌面端并进行 AI 聊天对话。

**架构：** 桌面端 Electron 主进程新增 mobileServer.ts 启动 WS 服务器，复用现有 claudeCodeIPC 逻辑处理请求，转发引擎事件到手机端。手机端 Flutter App 扫码连接后通过 WS 协议收发消息，Riverpod 管理状态，5 套主题从桌面端同步。

**技术栈：** Electron + ws (WebSocket) / Flutter 3 + Riverpod + web_socket_channel + mobile_scanner

---

## 文件结构

### 桌面端新增/修改文件

| 文件 | 职责 | 操作 |
|------|------|------|
| `electron/mobileServer.ts` | WS 服务器核心：启动/停止/认证/消息路由/事件转发/心跳 | 新增 |
| `electron/mobileServerTypes.ts` | 移动端通信协议类型定义 | 新增 |
| `electron/main.ts` | 注册 mobile IPC 处理器，生命周期管理 | 修改 |
| `electron/preload.ts` | 暴露 mobile API 到渲染进程 | 修改 |
| `src/services/electronAPI.ts` | 新增 mobile API 封装 | 修改 |
| `src/components/mobile/ConnectMobileDialog.vue` | 连接手机弹窗（二维码+状态） | 新增 |

### Flutter 手机端文件

| 文件 | 职责 |
|------|------|
| `mobile-app/pubspec.yaml` | 依赖配置 |
| `mobile-app/lib/main.dart` | 入口 |
| `mobile-app/lib/app.dart` | MaterialApp + 主题 |
| `mobile-app/lib/core/connection/connection_state.dart` | 连接状态枚举 |
| `mobile-app/lib/core/protocol/protocol.dart` | 消息类型定义 |
| `mobile-app/lib/core/protocol/protocol_parser.dart` | JSON 序列化/反序列化 |
| `mobile-app/lib/core/theme/theme_definitions.dart` | 5 套主题定义 |
| `mobile-app/lib/core/theme/code_theme.dart` | 代码高亮主题 |
| `mobile-app/lib/core/theme/theme_service.dart` | 主题同步服务 |
| `mobile-app/lib/core/storage/local_storage.dart` | 本地持久化 |
| `mobile-app/lib/core/connection/connection_service.dart` | WS 连接管理 |
| `mobile-app/lib/core/connection/qr_scanner_page.dart` | 扫码页面 |
| `mobile-app/lib/features/chat/models/message.dart` | 消息模型 |
| `mobile-app/lib/features/chat/models/tool_call.dart` | 工具调用模型 |
| `mobile-app/lib/features/chat/models/permission_request.dart` | 权限请求模型 |
| `mobile-app/lib/features/chat/chat_controller.dart` | 聊天逻辑控制器 |
| `mobile-app/lib/features/chat/widgets/streaming_text.dart` | 流式文本渲染 |
| `mobile-app/lib/features/chat/widgets/thinking_block.dart` | 思考过程展示 |
| `mobile-app/lib/features/chat/widgets/code_block.dart` | 代码块渲染 |
| `mobile-app/lib/features/chat/widgets/markdown_renderer.dart` | Markdown 渲染 |
| `mobile-app/lib/features/chat/widgets/tool_call_card.dart` | 工具调用卡片 |
| `mobile-app/lib/features/chat/widgets/permission_card.dart` | 权限请求卡片 |
| `mobile-app/lib/features/chat/widgets/message_bubble.dart` | 消息气泡 |
| `mobile-app/lib/features/chat/widgets/message_list.dart` | 消息列表 |
| `mobile-app/lib/features/chat/widgets/chat_input.dart` | 底部输入栏 |
| `mobile-app/lib/features/chat/chat_screen.dart` | 聊天主界面 |
| `mobile-app/lib/features/sessions/session_tile.dart` | 会话卡片 |
| `mobile-app/lib/features/sessions/sessions_screen.dart` | 会话列表 |
| `mobile-app/lib/features/agents/agent_card.dart` | Agent 卡片 |
| `mobile-app/lib/features/agents/agents_screen.dart` | Agent 选择 |
| `mobile-app/lib/features/settings/settings_screen.dart` | 设置页 |
| `mobile-app/lib/routing/router.dart` | 路由配置 |

---

## 阶段一：桌面端 WebSocket 服务器

### 任务 1：协议类型定义

**文件：**
- 创建：`electron/mobileServerTypes.ts`

- [ ] **步骤 1：创建协议类型文件**

```typescript
// electron/mobileServerTypes.ts

/** 客户端 → 桌面端 请求消息 */
export interface MobileRequest {
  type: 'connect' | 'send_message' | 'abort' | 'allow_permission' | 'deny_permission'
      | 'submit_tool_answer' | 'list_sessions' | 'restore_session' | 'new_session'
      | 'switch_session' | 'list_agents' | 'get_settings'
  id?: string
  data?: Record<string, unknown>
}

/** 桌面端 → 客户端 推送消息 */
export interface MobilePush {
  type: 'connected' | 'stream_event' | 'assistant' | 'tool_use' | 'tool_result'
      | 'permission_request' | 'result' | 'sessions_list' | 'theme_sync'
      | 'theme_changed' | 'error' | 'pong'
  data?: Record<string, unknown>
}

/** 连接认证数据 */
export interface ConnectData {
  token: string
  deviceName?: string
}

/** 二维码数据 */
export interface QRCodeData {
  url: string       // ws://IP:PORT?token=XXX
  token: string
  port: number
  ip: string
}

/** 服务器状态 */
export interface ServerStatus {
  running: boolean
  connected: boolean
  clientInfo?: string
  port?: number
}

/** 主题同步数据 */
export interface ThemeSyncData {
  theme: string
  accentColor: string
  density: string
  colors: Record<string, string>
  codeTheme: Record<string, string>
}
```

- [ ] **步骤 2：Commit**

```bash
git add electron/mobileServerTypes.ts
git commit -m "feat(mobile): add mobile server protocol types"
```

---

### 任务 2：WebSocket 服务器核心

**文件：**
- 创建：`electron/mobileServer.ts`

- [ ] **步骤 1：安装 ws 依赖**

```bash
cd d:\AI\SpaceCode && npm install ws && npm install -D @types/ws
```

- [ ] **步骤 2：创建 mobileServer.ts 基础框架**

```typescript
// electron/mobileServer.ts
import { EventEmitter } from 'events'
import * as crypto from 'crypto'
import * as net from 'net'
import * as os from 'os'
import { WebSocketServer, WebSocket } from 'ws'
import type { MobileRequest, MobilePush, QRCodeData, ServerStatus, ThemeSyncData, ConnectData } from './mobileServerTypes'

export class MobileServer extends EventEmitter {
  private wss: WebSocketServer | null = null
  private token: string = ''
  private client: WebSocket | null = null
  private clientInfo: string = ''
  private heartbeatInterval: NodeJS.Timeout | null = null
  private missedHeartbeats = 0
  private port: number = 0

  constructor(
    private readonly onMessage: (message: MobileRequest) => Promise<unknown>,
    private readonly getThemeSyncData: () => ThemeSyncData
  ) {
    super()
  }

  async start(preferredPort = 9527): Promise<QRCodeData> {
    this.token = crypto.randomBytes(32).toString('hex')

    // 寻找可用端口
    const port = await this.findAvailablePort(preferredPort, preferredPort + 20)
    this.port = port

    this.wss = new WebSocketServer({ port })

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req)
    })

    const ip = this.getLocalIP()
    const url = `ws://${ip}:${port}?token=${this.token}`

    this.startHeartbeat()

    return { url, token: this.token, port, ip }
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.close()
      this.client = null
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve())
      })
      this.wss = null
    }
    this.emit('stopped')
  }

  getStatus(): ServerStatus {
    return {
      running: this.wss !== null,
      connected: this.client !== null,
      clientInfo: this.clientInfo || undefined,
      port: this.port || undefined,
    }
  }

  sendToClient(push: MobilePush): void {
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify(push))
    }
  }

  private handleConnection(ws: WebSocket, req: import('http').IncomingMessage): void {
    // 单连接限制：如果已有客户端，关闭新连接
    if (this.client) {
      ws.close(4001, 'Another client already connected')
      return
    }

    // 解析 URL 中的 token
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const token = url.searchParams.get('token')

    if (token !== this.token) {
      ws.close(4003, 'Invalid token')
      return
    }

    this.client = ws
    this.clientInfo = req.headers['user-agent'] || 'Unknown Device'
    this.missedHeartbeats = 0

    // 发送连接成功 + 主题同步
    const themeData = this.getThemeSyncData()
    this.sendToClient({
      type: 'connected',
      data: {
        deviceName: this.clientInfo,
        theme: themeData,
      },
    })

    this.emit('connected', this.clientInfo)

    ws.on('message', async (raw) => {
      try {
        const message: MobileRequest = JSON.parse(raw.toString())
        const result = await this.onMessage(message)
        if (message.id && result !== undefined) {
          this.sendToClient({
            type: message.type as MobilePush['type'],
            data: result as Record<string, unknown>,
          })
        }
      } catch (err) {
        this.sendToClient({
          type: 'error',
          data: { message: err instanceof Error ? err.message : 'Unknown error' },
        })
      }
    })

    ws.on('close', () => {
      this.client = null
      this.clientInfo = ''
      this.emit('disconnected')
    })

    ws.on('pong', () => {
      this.missedHeartbeats = 0
    })
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (!this.client) return

      this.missedHeartbeats++
      if (this.missedHeartbeats > 2) {
        this.client.terminate()
        this.client = null
        this.clientInfo = ''
        this.emit('disconnected')
        return
      }

      if (this.client.readyState === WebSocket.OPEN) {
        this.client.ping()
      }
    }, 30_000)
  }

  private findAvailablePort(start: number, end: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryPort = (port: number) => {
        if (port > end) {
          reject(new Error('No available port'))
          return
        }
        const server = net.createServer()
        server.listen(port, () => {
          server.close(() => resolve(port))
        })
        server.on('error', () => {
          tryPort(port + 1)
        })
      }
      tryPort(start)
    })
  }

  private getLocalIP(): string {
    const interfaces = os.networkInterfaces()
    for (const name of Object.keys(interfaces)) {
      const ifaceList = interfaces[name]
      if (!ifaceList) continue
      for (const iface of ifaceList) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address
        }
      }
    }
    return '127.0.0.1'
  }
}
```

- [ ] **步骤 3：Commit**

```bash
git add electron/mobileServer.ts package.json package-lock.json
git commit -m "feat(mobile): add WebSocket server core with auth, heartbeat, and port discovery"
```

---

### 任务 3：消息路由与事件转发集成

**文件：**
- 修改：`electron/mobileServer.ts`

- [ ] **步骤 1：在 mobileServer.ts 中添加消息路由逻辑**

在 MobileServer 类中新增 `setSessionEventForwarder` 方法，供 main.ts 注入事件转发回调：

```typescript
// 在 MobileServer 类中添加
private sessionEventForwarder: ((eventType: string, data: Record<string, unknown>) => void) | null = null

setSessionEventForwarder(
  forwarder: (eventType: string, data: Record<string, unknown>) => void
): void {
  this.sessionEventForwarder = forwarder
}

// 修改 handleConnection 中的 message 处理，增加路由逻辑
private async routeMessage(message: MobileRequest): Promise<unknown> {
  switch (message.type) {
    case 'connect':
      // 已在 handleConnection 中处理
      return { status: 'ok' }

    case 'send_message': {
      const { sessionId, content, images } = message.data as {
        sessionId: string; content: string; images?: string[]
      }
      // 触发事件让 main.ts 处理
      this.emit('send_message', { sessionId, content, images })
      return { status: 'sent' }
    }

    case 'abort': {
      const { sessionId } = message.data as { sessionId: string }
      this.emit('abort', { sessionId })
      return { status: 'ok' }
    }

    case 'allow_permission': {
      const { sessionId, toolUseId } = message.data as { sessionId: string; toolUseId: string }
      this.emit('allow_permission', { sessionId, toolUseId })
      return { status: 'ok' }
    }

    case 'deny_permission': {
      const { sessionId, toolUseId } = message.data as { sessionId: string; toolUseId: string }
      this.emit('deny_permission', { sessionId, toolUseId })
      return { status: 'ok' }
    }

    case 'submit_tool_answer': {
      const { sessionId, toolUseId, answer } = message.data as {
        sessionId: string; toolUseId: string; answer: string
      }
      this.emit('submit_tool_answer', { sessionId, toolUseId, answer })
      return { status: 'ok' }
    }

    case 'list_sessions': {
      this.emit('list_sessions', {})
      return null // 由 main.ts 异步处理并直接推送
    }

    case 'restore_session': {
      const { sessionId } = message.data as { sessionId: string }
      this.emit('restore_session', { sessionId })
      return { status: 'ok' }
    }

    case 'new_session': {
      this.emit('new_session', {})
      return null
    }

    case 'switch_session': {
      const { sessionId } = message.data as { sessionId: string }
      this.emit('switch_session', { sessionId })
      return { status: 'ok' }
    }

    case 'list_agents': {
      this.emit('list_agents', {})
      return null
    }

    case 'get_settings': {
      this.emit('get_settings', {})
      return null
    }

    default:
      throw new Error(`Unknown message type: ${message.type}`)
  }
}
```

更新 handleConnection 中的 message 回调，使用 routeMessage：

```typescript
ws.on('message', async (raw) => {
  try {
    const message: MobileRequest = JSON.parse(raw.toString())
    await this.routeMessage(message)
  } catch (err) {
    this.sendToClient({
      type: 'error',
      data: { message: err instanceof Error ? err.message : 'Unknown error' },
    })
  }
})
```

- [ ] **步骤 2：Commit**

```bash
git add electron/mobileServer.ts
git commit -m "feat(mobile): add message routing and event forwarding to mobile server"
```

---

### 任务 4：Electron 主进程集成

**文件：**
- 修改：`electron/main.ts`
- 修改：`electron/preload.ts`
- 修改：`src/services/electronAPI.ts`

- [ ] **步骤 1：在 main.ts 中注册 mobile IPC 和事件桥接**

在 `registerClaudeCodeIPC()` 调用之后，添加 mobile 服务器初始化：

```typescript
// electron/main.ts 顶部添加 import
import { MobileServer } from './mobileServer'
import type { QRCodeData, ServerStatus, ThemeSyncData } from './mobileServerTypes'

// 全局变量
let mobileServer: MobileServer | null = null

// 注册 mobile IPC 处理器
function registerMobileIPCHandlers(): void {
  // 启动服务器
  ipcMain.handle('mobile:startServer', async (): Promise<QRCodeData> => {
    if (mobileServer) {
      await mobileServer.stop()
    }

    mobileServer = new MobileServer(
      // onMessage - 不再需要，改为事件驱动
      async () => null,
      // getThemeSyncData
      () => getThemeSyncData()
    )

    const qrData = await mobileServer.start()

    // 监听 mobile 服务器事件，桥接到现有逻辑
    mobileServer.on('send_message', async ({ sessionId, content, images }) => {
      const engine = findEngineForSession(sessionId)
      if (engine) {
        engine.sendMessage(sessionId, content, images)
      }
    })

    mobileServer.on('abort', ({ sessionId }) => {
      const engine = findEngineForSession(sessionId)
      if (engine) engine.abort(sessionId)
    })

    mobileServer.on('allow_permission', ({ sessionId, toolUseId }) => {
      const engine = findEngineForSession(sessionId)
      if (engine) engine.allowPermission(sessionId, toolUseId)
    })

    mobileServer.on('deny_permission', ({ sessionId, toolUseId }) => {
      const engine = findEngineForSession(sessionId)
      if (engine) engine.denyPermission(sessionId, toolUseId)
    })

    mobileServer.on('submit_tool_answer', ({ sessionId, toolUseId, answer }) => {
      const engine = findEngineForSession(sessionId)
      if (engine) engine.submitToolAnswer(sessionId, toolUseId, answer)
    })

    mobileServer.on('list_sessions', async () => {
      const sessions = await sessionHistoryManager.listProjectSessions(currentProjectRoot)
      mobileServer?.sendToClient({ type: 'sessions_list', data: { sessions } })
    })

    mobileServer.on('list_agents', async () => {
      const agents = await agentsService.scanLibrary()
      mobileServer?.sendToClient({ type: 'agents_list', data: { agents } })
    })

    mobileServer.on('get_settings', async () => {
      const settings = await getGuiSettings()
      mobileServer?.sendToClient({ type: 'settings_sync', data: settings })
    })

    mobileServer.on('connected', (clientInfo: string) => {
      mainWindow?.webContents.send('mobile:onConnected', clientInfo)
      // 订阅引擎事件并转发
      forwardEngineEventsToMobile()
    })

    mobileServer.on('disconnected', () => {
      mainWindow?.webContents.send('mobile:onDisconnected')
    })

    return qrData
  })

  // 停止服务器
  ipcMain.handle('mobile:stopServer', async () => {
    if (mobileServer) {
      await mobileServer.stop()
      mobileServer = null
    }
  })

  // 获取状态
  ipcMain.handle('mobile:getStatus', (): ServerStatus => {
    return mobileServer?.getStatus() ?? { running: false, connected: false }
  })
}

// 转发引擎事件到手机端
function forwardEngineEventsToMobile(): void {
  const eventTypes = [
    'claude-code:stream_event',
    'claude-code:assistant',
    'claude-code:tool_use',
    'claude-code:tool_result',
    'claude-code:permission_request',
    'claude-code:result',
  ]

  for (const eventType of eventTypes) {
    // 监听已有的 IPC 事件
    ipcMain.on(eventType, (_event, data) => {
      if (mobileServer) {
        const pushType = eventType.replace('claude-code:', '')
        mobileServer.sendToClient({ type: pushType, data })
      }
    })
  }
}

// 获取主题同步数据
function getThemeSyncData(): ThemeSyncData {
  // 从 settingsStore 或 gui-settings.json 读取
  const settings = loadGuiSettingsSync()
  const theme = settings?.appearance?.theme || 'system'
  const effectiveTheme = theme === 'system'
    ? (require('electron').nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    : theme

  return buildThemeSyncData(effectiveTheme, settings?.appearance)
}

// 在 app.whenReady() 中调用
// registerMobileIPCHandlers()

// 在 before-quit 中清理
// if (mobileServer) await mobileServer.stop()
```

- [ ] **步骤 2：在 preload.ts 中暴露 mobile API**

在 `contextBridge.exposeInMainWorld('electronAPI', {...})` 中添加 mobile 命名空间：

```typescript
// preload.ts 中添加
mobile: {
  startServer: (): Promise<import('./mobileServerTypes').QRCodeData> =>
    ipcRenderer.invoke('mobile:startServer'),
  stopServer: (): Promise<void> =>
    ipcRenderer.invoke('mobile:stopServer'),
  getStatus: (): Promise<import('./mobileServerTypes').ServerStatus> =>
    ipcRenderer.invoke('mobile:getStatus'),
  onConnected: (callback: (clientInfo: string) => void) => {
    const handler = (_event: any, clientInfo: string) => callback(clientInfo)
    ipcRenderer.on('mobile:onConnected', handler)
    return () => ipcRenderer.removeListener('mobile:onConnected', handler)
  },
  onDisconnected: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('mobile:onDisconnected', handler)
    return () => ipcRenderer.removeListener('mobile:onDisconnected', handler)
  },
},
```

- [ ] **步骤 3：在 electronAPI.ts 中封装 mobile API**

```typescript
// src/services/electronAPI.ts 中添加
mobile: {
  startServer: () => api<{ url: string; token: string; port: number; ip: string }>(
    () => electronAPI.mobile.startServer()
  ),
  stopServer: () => api<void>(
    () => electronAPI.mobile.stopServer()
  ),
  getStatus: () => api<{ running: boolean; connected: boolean; clientInfo?: string; port?: number }>(
    () => electronAPI.mobile.getStatus()
  ),
  onConnected: (cb: (clientInfo: string) => void) =>
    electronAPI?.mobile?.onConnected(cb) ?? (() => {}),
  onDisconnected: (cb: () => void) =>
    electronAPI?.mobile?.onDisconnected(cb) ?? (() => {}),
},
```

- [ ] **步骤 4：Commit**

```bash
git add electron/main.ts electron/preload.ts src/services/electronAPI.ts
git commit -m "feat(mobile): integrate mobile server into Electron main process with IPC and event forwarding"
```

---

### 任务 5：连接手机弹窗 UI

**文件：**
- 创建：`src/components/mobile/ConnectMobileDialog.vue`

- [ ] **步骤 1：创建连接手机弹窗组件**

```vue
<template>
  <div v-if="visible" class="mobile-dialog-overlay" @click.self="close">
    <div class="mobile-dialog">
      <div class="mobile-dialog-header">
        <h2>{{ t('mobile.connectTitle') || '连接手机' }}</h2>
        <button class="close-btn" @click="close">
          <X :size="18" />
        </button>
      </div>

      <div class="mobile-dialog-body">
        <template v-if="!status.connected">
          <p class="hint">{{ t('mobile.scanHint') || '请使用 SpaceCode 手机端扫描以下二维码' }}</p>
          <div class="qr-container">
            <canvas ref="qrCanvas" class="qr-canvas"></canvas>
          </div>
          <div class="address-info">
            <span class="label">{{ t('mobile.lanAddress') || '局域网地址' }}</span>
            <code class="address">{{ qrData?.url || '...' }}</code>
          </div>
          <div class="status-line">
            <span class="status-dot waiting"></span>
            <span>{{ t('mobile.waitingConnection') || '等待连接...' }}</span>
          </div>
        </template>

        <template v-else>
          <div class="connected-state">
            <div class="status-line">
              <span class="status-dot connected"></span>
              <span>{{ t('mobile.connected') || '已连接' }}: {{ status.clientInfo }}</span>
            </div>
          </div>
        </template>
      </div>

      <div class="mobile-dialog-footer">
        <button class="btn-cancel" @click="stopAndClose">
          {{ status.connected ? (t('mobile.disconnect') || '断开连接') : (t('mobile.cancel') || '取消') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import QRCode from 'qrcode'

const { t } = useI18n()

const props = defineProps<{ visible: boolean }>()
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()

const qrCanvas = ref<HTMLCanvasElement | null>(null)
const qrData = ref<{ url: string; token: string; port: number; ip: string } | null>(null)
const status = ref<{ running: boolean; connected: boolean; clientInfo?: string }>({
  running: false,
  connected: false,
})

let statusInterval: ReturnType<typeof setInterval> | null = null
let unsubConnected: (() => void) | null = null
let unsubDisconnected: (() => void) | null = null

watch(() => props.visible, async (visible) => {
  if (visible) {
    await startServer()
    startStatusPolling()
  } else {
    stopStatusPolling()
  }
})

async function startServer() {
  try {
    qrData.value = await api.mobile.startServer()
    if (qrCanvas.value && qrData.value) {
      await QRCode.toCanvas(qrCanvas.value, qrData.value.url, {
        width: 200,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
    }
  } catch (err) {
    console.error('Failed to start mobile server:', err)
  }
}

function startStatusPolling() {
  unsubConnected = api.mobile.onConnected((clientInfo) => {
    status.value = { running: true, connected: true, clientInfo }
  })
  unsubDisconnected = api.mobile.onDisconnected(() => {
    status.value = { running: true, connected: false }
  })
  statusInterval = setInterval(async () => {
    try {
      status.value = await api.mobile.getStatus()
    } catch {}
  }, 2000)
}

function stopStatusPolling() {
  if (statusInterval) clearInterval(statusInterval)
  if (unsubConnected) unsubConnected()
  if (unsubDisconnected) unsubDisconnected()
}

async function stopAndClose() {
  await api.mobile.stopServer()
  status.value = { running: false, connected: false }
  close()
}

function close() {
  emit('update:visible', false)
}

onUnmounted(() => {
  stopStatusPolling()
  if (props.visible) api.mobile.stopServer()
})
</script>

<style lang="scss" scoped>
.mobile-dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.mobile-dialog {
  background: var(--bg-elevated);
  border-radius: var(--radius-xl);
  border: 1px solid var(--border-default);
  box-shadow: var(--shadow-xl);
  width: 380px;
  max-width: 90vw;
}

.mobile-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 12px;

  h2 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
    &:hover { background: var(--bg-hover); }
  }
}

.mobile-dialog-body {
  padding: 12px 24px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.hint {
  font-size: 14px;
  color: var(--text-secondary);
  text-align: center;
  margin: 0;
}

.qr-container {
  padding: 16px;
  background: white;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
}

.qr-canvas {
  display: block;
}

.address-info {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;

  .label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .address {
    font-size: 12px;
    font-family: var(--font-mono);
    color: var(--text-secondary);
    background: var(--bg-secondary);
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    word-break: break-all;
  }
}

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;

  &.waiting {
    background: var(--warning);
    animation: pulse 2s infinite;
  }

  &.connected {
    background: var(--success);
  }
}

.connected-state {
  width: 100%;
  padding: 20px 0;
}

.mobile-dialog-footer {
  padding: 12px 24px 20px;
  display: flex;
  justify-content: center;

  .btn-cancel {
    padding: 8px 24px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-default);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 14px;
    cursor: pointer;

    &:hover {
      background: var(--bg-hover);
    }
  }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
```

- [ ] **步骤 2：安装 qrcode 依赖**

```bash
cd d:\AI\SpaceCode && npm install qrcode && npm install -D @types/qrcode
```

- [ ] **步骤 3：在 App.vue 或设置面板中添加入口**

在 TitleBar.vue 或设置面板中添加"连接手机"按钮，点击时显示 ConnectMobileDialog。

- [ ] **步骤 4：Commit**

```bash
git add src/components/mobile/ConnectMobileDialog.vue package.json package-lock.json
git commit -m "feat(mobile): add connect mobile dialog with QR code display"
```

---

### 任务 6：主题同步数据构建

**文件：**
- 修改：`electron/mobileServer.ts` 或新建 `electron/themeSyncBuilder.ts`

- [ ] **步骤 1：创建主题同步数据构建器**

```typescript
// electron/themeSyncBuilder.ts
import type { ThemeSyncData } from './mobileServerTypes'

// 桌面端 _variables.scss 中的颜色值映射
const THEME_COLORS: Record<string, Record<string, string>> = {
  light: {
    bgPrimary: '#f8f9fb', bgSecondary: '#f0f1f5', bgTertiary: '#e7e9ef',
    bgElevated: '#ffffff', bgHover: '#e4e6ec', bgActive: '#dbdde5',
    textPrimary: '#18191f', textSecondary: '#44475a', textMuted: '#6e7191', textDisabled: '#9da1b8',
    accentPrimary: '#0d9488', accentPrimaryHover: '#14b8a6',
    accentSecondary: '#6366f1', accentTertiary: '#7c3aed',
    success: '#059669', warning: '#d97706', error: '#dc2626',
    borderSubtle: 'rgba(24,25,31,0.05)', borderDefault: 'rgba(24,25,31,0.09)', borderStrong: 'rgba(24,25,31,0.15)',
  },
  dark: {
    bgPrimary: '#0d0d0d', bgSecondary: '#141414', bgTertiary: '#1a1a1a',
    bgElevated: '#1f1f1f', bgHover: '#262626', bgActive: '#2e2e2e',
    textPrimary: '#f5f5f5', textSecondary: '#a3a3a3', textMuted: '#737373', textDisabled: '#525252',
    accentPrimary: '#3b82f6', accentPrimaryHover: '#60a5fa',
    accentSecondary: '#64748b', accentTertiary: '#8b5cf6',
    success: '#22c55e', warning: '#f59e0b', error: '#ef4444',
    borderSubtle: 'rgba(255,255,255,0.04)', borderDefault: 'rgba(255,255,255,0.08)', borderStrong: 'rgba(255,255,255,0.15)',
  },
  anthropic: {
    bgPrimary: '#faf9f5', bgSecondary: '#efe9de', bgTertiary: '#e8e0d2',
    bgElevated: '#faf9f5', bgHover: '#e5e0d5', bgActive: '#dcd6c8',
    textPrimary: '#141413', textSecondary: '#3d3d3a', textMuted: '#6c6a64', textDisabled: '#8e8b82',
    accentPrimary: '#cc785c', accentPrimaryHover: '#a9583e',
    accentSecondary: '#5db8a6', accentTertiary: '#e8a55a',
    success: '#5db872', warning: '#d4a017', error: '#c64545',
    borderSubtle: 'rgba(20,20,19,0.04)', borderDefault: 'rgba(20,20,19,0.08)', borderStrong: 'rgba(20,20,19,0.16)',
  },
  'anthropic-dark': {
    bgPrimary: '#181715', bgSecondary: '#1c1b1a', bgTertiary: '#1f1e1b',
    bgElevated: '#252320', bgHover: '#2d2c29', bgActive: '#353332',
    textPrimary: '#faf9f5', textSecondary: '#a09d96', textMuted: '#6c6a64', textDisabled: '#3d3d3a',
    accentPrimary: '#cc785c', accentPrimaryHover: '#dd8a6e',
    accentSecondary: '#5db8a6', accentTertiary: '#e8a55a',
    success: '#5db872', warning: '#d4a017', error: '#c64545',
    borderSubtle: 'rgba(250,249,245,0.04)', borderDefault: 'rgba(250,249,245,0.08)', borderStrong: 'rgba(250,249,245,0.14)',
  },
}

const CODE_THEMES: Record<string, Record<string, string>> = {
  light: {
    bg: '#eef0f5', fg: '#18191f', keyword: '#be123c', string: '#1e40af',
    number: '#7c3aed', comment: '#6e7191', function: '#0d9488',
    builtin: '#0d9488', attr: '#6366f1', tag: '#059669',
  },
  dark: {
    bg: '#0d1117', fg: '#c9d1d9', keyword: '#ff7b72', string: '#a5d6ff',
    number: '#79c0ff', comment: '#8b949e', function: '#d2a8ff',
    builtin: '#ffa657', attr: '#79c0ff', tag: '#7ee787',
  },
  anthropic: {
    bg: '#f0ede4', fg: '#2d2a24', keyword: '#c44e3f', string: '#5db872',
    number: '#e8a55a', comment: '#8e8b82', function: '#5db8a6',
    builtin: '#cc785c', attr: '#5db8a6', tag: '#5db872',
  },
  'anthropic-dark': {
    bg: '#1a1918', fg: '#faf9f5', keyword: '#e08870', string: '#7dce94',
    number: '#f0b56a', comment: '#6c6a64', function: '#7dccbe',
    builtin: '#dd8a6e', attr: '#7dccbe', tag: '#7dce94',
  },
}

export function buildThemeSyncData(
  effectiveTheme: string,
  appearance?: { accentColor?: string; density?: string }
): ThemeSyncData {
  const colors = THEME_COLORS[effectiveTheme] || THEME_COLORS.light
  const codeTheme = CODE_THEMES[effectiveTheme] || CODE_THEMES.light

  return {
    theme: effectiveTheme,
    accentColor: appearance?.accentColor || 'blue',
    density: appearance?.density || 'default',
    colors,
    codeTheme,
  }
}
```

- [ ] **步骤 2：Commit**

```bash
git add electron/themeSyncBuilder.ts
git commit -m "feat(mobile): add theme sync data builder with all 4 theme color definitions"
```

---

## 阶段二：Flutter 手机端 App

### 任务 7：Flutter 项目初始化

- [ ] **步骤 1：创建 Flutter 项目**

```bash
cd d:\AI\SpaceCode
flutter create --org com.spacecode --project-name spacecode_mobile mobile-app
```

- [ ] **步骤 2：配置 pubspec.yaml 依赖**

```yaml
name: spacecode_mobile
description: SpaceCode mobile companion app
publish_to: 'none'
version: 0.1.0

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  web_socket_channel: ^3.0.0
  flutter_riverpod: ^2.5.0
  riverpod_annotation: ^2.3.0
  go_router: ^14.0.0
  mobile_scanner: ^5.0.0
  flutter_markdown: ^0.7.0
  markdown: ^7.0.0
  flutter_highlight: ^0.7.0
  highlight: ^0.7.0
  shared_preferences: ^2.2.0
  flutter_animate: ^4.5.0
  google_fonts: ^6.2.0
  uuid: ^4.4.0
  json_annotation: ^4.9.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0
  build_runner: ^2.4.0
  riverpod_generator: ^2.4.0
  json_serializable: ^6.8.0

flutter:
  uses-material-design: true
```

- [ ] **步骤 3：安装依赖**

```bash
cd d:\AI\SpaceCode\mobile-app && flutter pub get
```

- [ ] **步骤 4：Commit**

```bash
git add mobile-app/
git commit -m "feat(mobile): initialize Flutter project with dependencies"
```

---

### 任务 8：协议与模型层

**文件：**
- 创建：`mobile-app/lib/core/protocol/protocol.dart`
- 创建：`mobile-app/lib/core/protocol/protocol_parser.dart`
- 创建：`mobile-app/lib/core/connection/connection_state.dart`
- 创建：`mobile-app/lib/features/chat/models/message.dart`
- 创建：`mobile-app/lib/features/chat/models/tool_call.dart`
- 创建：`mobile-app/lib/features/chat/models/permission_request.dart`

- [ ] **步骤 1：创建协议类型定义**

```dart
// mobile-app/lib/core/protocol/protocol.dart

/// 客户端 → 桌面端 请求类型
enum RequestType {
  connect('connect'),
  sendMessage('send_message'),
  abort('abort'),
  allowPermission('allow_permission'),
  denyPermission('deny_permission'),
  submitToolAnswer('submit_tool_answer'),
  listSessions('list_sessions'),
  restoreSession('restore_session'),
  newSession('new_session'),
  switchSession('switch_session'),
  listAgents('list_agents'),
  getSettings('get_settings');

  const RequestType(this.value);
  final String value;
}

/// 桌面端 → 客户端 推送类型
enum PushType {
  connected('connected'),
  streamEvent('stream_event'),
  assistant('assistant'),
  toolUse('tool_use'),
  toolResult('tool_result'),
  permissionRequest('permission_request'),
  result('result'),
  sessionsList('sessions_list'),
  agentsList('agents_list'),
  settingsSync('settings_sync'),
  themeSync('theme_sync'),
  themeChanged('theme_changed'),
  error('error'),
  pong('pong');

  const PushType(this.value);
  final String value;

  static PushType fromString(String value) {
    return PushType.values.firstWhere(
      (e) => e.value == value,
      orElse: () => PushType.error,
    );
  }
}

/// WS 请求消息
class MobileRequest {
  final RequestType type;
  final String? id;
  final Map<String, dynamic>? data;

  MobileRequest({required this.type, this.id, this.data});

  Map<String, dynamic> toJson() => {
    'type': type.value,
    if (id != null) 'id': id,
    if (data != null) 'data': data,
  };
}

/// WS 推送消息
class MobilePush {
  final PushType type;
  final Map<String, dynamic>? data;

  MobilePush({required this.type, this.data});

  factory MobilePush.fromJson(Map<String, dynamic> json) {
    return MobilePush(
      type: PushType.fromString(json['type'] as String),
      data: json['data'] as Map<String, dynamic>?,
    );
  }
}
```

- [ ] **步骤 2：创建消息/工具调用/权限请求模型**

```dart
// mobile-app/lib/features/chat/models/message.dart

enum MessageRole { user, assistant, system }

class ChatMessage {
  final String id;
  final MessageRole role;
  final String content;
  final List<ToolCall>? toolCalls;
  final String? thinkingContent;
  final bool isStreaming;
  final DateTime timestamp;

  ChatMessage({
    required this.id,
    required this.role,
    this.content = '',
    this.toolCalls,
    this.thinkingContent,
    this.isStreaming = false,
    DateTime? timestamp,
  }) : timestamp = timestamp ?? DateTime.now();

  ChatMessage copyWith({
    String? content,
    List<ToolCall>? toolCalls,
    String? thinkingContent,
    bool? isStreaming,
  }) => ChatMessage(
    id: id,
    role: role,
    content: content ?? this.content,
    toolCalls: toolCalls ?? this.toolCalls,
    thinkingContent: thinkingContent ?? this.thinkingContent,
    isStreaming: isStreaming ?? this.isStreaming,
  );
}

// mobile-app/lib/features/chat/models/tool_call.dart

enum ToolCallStatus { running, completed, error }

class ToolCall {
  final String id;
  final String toolName;
  final String input;
  final String? output;
  final ToolCallStatus status;

  ToolCall({
    required this.id,
    required this.toolName,
    required this.input,
    this.output,
    this.status = ToolCallStatus.running,
  });

  ToolCall copyWith({String? output, ToolCallStatus? status}) => ToolCall(
    id: id,
    toolName: toolName,
    input: input,
    output: output ?? this.output,
    status: status ?? this.status,
  );
}

// mobile-app/lib/features/chat/models/permission_request.dart

class PermissionRequest {
  final String sessionId;
  final String toolUseId;
  final String toolName;
  final String input;

  PermissionRequest({
    required this.sessionId,
    required this.toolUseId,
    required this.toolName,
    required this.input,
  });
}
```

- [ ] **步骤 3：创建连接状态枚举**

```dart
// mobile-app/lib/core/connection/connection_state.dart

enum ConnectionState { disconnected, connecting, connected, error }

class ConnectionInfo {
  final ConnectionState state;
  final String? errorMessage;
  final String? clientInfo;

  const ConnectionInfo({
    this.state = ConnectionState.disconnected,
    this.errorMessage,
    this.clientInfo,
  });

  ConnectionInfo copyWith({
    ConnectionState? state,
    String? errorMessage,
    String? clientInfo,
  }) => ConnectionInfo(
    state: state ?? this.state,
    errorMessage: errorMessage ?? this.errorMessage,
    clientInfo: clientInfo ?? this.clientInfo,
  );
}
```

- [ ] **步骤 4：Commit**

```bash
git add mobile-app/lib/core/protocol/ mobile-app/lib/core/connection/ mobile-app/lib/features/chat/models/
git commit -m "feat(mobile): add protocol types, message models, and connection state"
```

---

### 任务 9：主题系统

**文件：**
- 创建：`mobile-app/lib/core/theme/theme_definitions.dart`
- 创建：`mobile-app/lib/core/theme/code_theme.dart`
- 创建：`mobile-app/lib/core/theme/theme_service.dart`

- [ ] **步骤 1：创建 5 套主题定义**

```dart
// mobile-app/lib/core/theme/theme_definitions.dart

import 'package:flutter/material.dart';

class SpaceCodeTheme {
  static ThemeData light() => _buildTheme(_lightColors);
  static ThemeData dark() => _buildTheme(_darkColors);
  static ThemeData anthropic() => _buildTheme(_anthropicColors);
  static ThemeData anthropicDark() => _buildTheme(_anthropicDarkColors);

  static ThemeData fromSyncData(Map<String, dynamic> colors) {
    return _buildTheme(_colorsFromMap(colors));
  }

  static _ColorSet _lightColors = _ColorSet(
    bgPrimary: const Color(0xfff8f9fb),
    bgSecondary: const Color(0xfff0f1f5),
    bgTertiary: const Color(0xffe7e9ef),
    bgElevated: const Color(0xffffffff),
    bgHover: const Color(0xffe4e6ec),
    bgActive: const Color(0xffdbdde5),
    textPrimary: const Color(0xff18191f),
    textSecondary: const Color(0xff44475a),
    textMuted: const Color(0xff6e7191),
    accentPrimary: const Color(0xff0d9488),
    accentSecondary: const Color(0xff6366f1),
    accentTertiary: const Color(0xff7c3aed),
    success: const Color(0xff059669),
    warning: const Color(0xffd97706),
    error: const Color(0xffdc2626),
  );

  static _ColorSet _darkColors = _ColorSet(
    bgPrimary: const Color(0xff0d0d0d),
    bgSecondary: const Color(0xff141414),
    bgTertiary: const Color(0xff1a1a1a),
    bgElevated: const Color(0xff1f1f1f),
    bgHover: const Color(0xff262626),
    bgActive: const Color(0xff2e2e2e),
    textPrimary: const Color(0xfff5f5f5),
    textSecondary: const Color(0xffa3a3a3),
    textMuted: const Color(0xff737373),
    accentPrimary: const Color(0xff3b82f6),
    accentSecondary: const Color(0xff64748b),
    accentTertiary: const Color(0xff8b5cf6),
    success: const Color(0xff22c55e),
    warning: const Color(0xfff59e0b),
    error: const Color(0xffef4444),
  );

  static _ColorSet _anthropicColors = _ColorSet(
    bgPrimary: const Color(0xfffaf9f5),
    bgSecondary: const Color(0xffefe9de),
    bgTertiary: const Color(0xffe8e0d2),
    bgElevated: const Color(0xfffaf9f5),
    bgHover: const Color(0xffe5e0d5),
    bgActive: const Color(0xffdcd6c8),
    textPrimary: const Color(0xff141413),
    textSecondary: const Color(0xff3d3d3a),
    textMuted: const Color(0xff6c6a64),
    accentPrimary: const Color(0xffcc785c),
    accentSecondary: const Color(0xff5db8a6),
    accentTertiary: const Color(0xffe8a55a),
    success: const Color(0xff5db872),
    warning: const Color(0xffd4a017),
    error: const Color(0xffc64545),
  );

  static _ColorSet _anthropicDarkColors = _ColorSet(
    bgPrimary: const Color(0xff181715),
    bgSecondary: const Color(0xff1c1b1a),
    bgTertiary: const Color(0xff1f1e1b),
    bgElevated: const Color(0xff252320),
    bgHover: const Color(0xff2d2c29),
    bgActive: const Color(0xff353332),
    textPrimary: const Color(0xfffaf9f5),
    textSecondary: const Color(0xffa09d96),
    textMuted: const Color(0xff6c6a64),
    accentPrimary: const Color(0xffcc785c),
    accentSecondary: const Color(0xff5db8a6),
    accentTertiary: const Color(0xffe8a55a),
    success: const Color(0xff5db872),
    warning: const Color(0xffd4a017),
    error: const Color(0xffc64545),
  );

  static ThemeData _buildTheme(_ColorSet c) {
    final colorScheme = ColorScheme(
      brightness: c.textPrimary.computeLuminance() > 0.5 ? Brightness.dark : Brightness.light,
      primary: c.accentPrimary,
      onPrimary: c.bgElevated,
      secondary: c.accentSecondary,
      onSecondary: c.bgElevated,
      tertiary: c.accentTertiary,
      onTertiary: c.bgElevated,
      error: c.error,
      onError: c.bgElevated,
      surface: c.bgPrimary,
      onSurface: c.textPrimary,
      surfaceContainerHighest: c.bgActive,
    );

    return ThemeData(
      colorScheme: colorScheme,
      scaffoldBackgroundColor: c.bgPrimary,
      appBarTheme: AppBarTheme(
        backgroundColor: c.bgElevated,
        foregroundColor: c.textPrimary,
        elevation: 0,
      ),
      cardTheme: CardTheme(
        color: c.bgElevated,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: c.textMuted.withOpacity(0.1)),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: c.bgSecondary,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
      ),
    );
  }

  static _ColorSet _colorsFromMap(Map<String, dynamic> m) => _ColorSet(
    bgPrimary: _parseColor(m['bgPrimary']),
    bgSecondary: _parseColor(m['bgSecondary']),
    bgTertiary: _parseColor(m['bgTertiary']),
    bgElevated: _parseColor(m['bgElevated']),
    bgHover: _parseColor(m['bgHover']),
    bgActive: _parseColor(m['bgActive']),
    textPrimary: _parseColor(m['textPrimary']),
    textSecondary: _parseColor(m['textSecondary']),
    textMuted: _parseColor(m['textMuted']),
    accentPrimary: _parseColor(m['accentPrimary']),
    accentSecondary: _parseColor(m['accentSecondary']),
    accentTertiary: _parseColor(m['accentTertiary']),
    success: _parseColor(m['success']),
    warning: _parseColor(m['warning']),
    error: _parseColor(m['error']),
  );

  static Color _parseColor(dynamic value) {
    if (value == null) return const Color(0xff000000);
    final str = value.toString();
    if (str.startsWith('#') && str.length == 7) {
      return Color(int.parse(str.substring(1), radix: 16) + 0xff000000);
    }
    return const Color(0xff000000);
  }
}

class _ColorSet {
  final Color bgPrimary, bgSecondary, bgTertiary, bgElevated, bgHover, bgActive;
  final Color textPrimary, textSecondary, textMuted;
  final Color accentPrimary, accentSecondary, accentTertiary;
  final Color success, warning, error;

  const _ColorSet({
    required this.bgPrimary, required this.bgSecondary, required this.bgTertiary,
    required this.bgElevated, required this.bgHover, required this.bgActive,
    required this.textPrimary, required this.textSecondary, required this.textMuted,
    required this.accentPrimary, required this.accentSecondary, required this.accentTertiary,
    required this.success, required this.warning, required this.error,
  });
}
```

- [ ] **步骤 2：创建代码高亮主题**

```dart
// mobile-app/lib/core/theme/code_theme.dart

import 'package:flutter/material.dart';

class CodeTheme {
  final Color bg, fg, keyword, string, number, comment, function, builtin, attr, tag;

  const CodeTheme({
    required this.bg, required this.fg,
    required this.keyword, required this.string, required this.number,
    required this.comment, required this.function, required this.builtin,
    required this.attr, required this.tag,
  });

  static const light = CodeTheme(
    bg: Color(0xffeef0f5), fg: Color(0xff18191f),
    keyword: Color(0xffbe123c), string: Color(0xff1e40af), number: Color(0xff7c3aed),
    comment: Color(0xff6e7191), function: Color(0xff0d9488), builtin: Color(0xff0d9488),
    attr: Color(0xff6366f1), tag: Color(0xff059669),
  );

  static const dark = CodeTheme(
    bg: Color(0xff0d1117), fg: Color(0xffc9d1d9),
    keyword: Color(0xffff7b72), string: Color(0xffa5d6ff), number: Color(0xff79c0ff),
    comment: Color(0xff8b949e), function: Color(0xffd2a8ff), builtin: Color(0xffffa657),
    attr: Color(0xff79c0ff), tag: Color(0xff7ee787),
  );

  static const anthropic = CodeTheme(
    bg: Color(0xfff0ede4), fg: Color(0xff2d2a24),
    keyword: Color(0xffc44e3f), string: Color(0xff5db872), number: Color(0xffe8a55a),
    comment: Color(0xff8e8b82), function: Color(0xff5db8a6), builtin: Color(0xffcc785c),
    attr: Color(0xff5db8a6), tag: Color(0xff5db872),
  );

  static const anthropicDark = CodeTheme(
    bg: Color(0xff1a1918), fg: Color(0xfffaf9f5),
    keyword: Color(0xffe08870), string: Color(0xff7dce94), number: Color(0xfff0b56a),
    comment: Color(0xff6c6a64), function: Color(0xff7dccbe), builtin: Color(0xffdd8a6e),
    attr: Color(0xff7dccbe), tag: Color(0xff7dce94),
  );

  static CodeTheme fromMap(Map<String, dynamic> m) => CodeTheme(
    bg: _parseColor(m['bg']), fg: _parseColor(m['fg']),
    keyword: _parseColor(m['keyword']), string: _parseColor(m['string']),
    number: _parseColor(m['number']), comment: _parseColor(m['comment']),
    function: _parseColor(m['function']), builtin: _parseColor(m['builtin']),
    attr: _parseColor(m['attr']), tag: _parseColor(m['tag']),
  );

  static Color _parseColor(dynamic value) {
    if (value == null) return const Color(0xff000000);
    final str = value.toString();
    if (str.startsWith('#') && str.length == 7) {
      return Color(int.parse(str.substring(1), radix: 16) + 0xff000000);
    }
    return const Color(0xff000000);
  }
}
```

- [ ] **步骤 3：创建主题同步服务（Riverpod Provider）**

```dart
// mobile-app/lib/core/theme/theme_service.dart

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'theme_definitions.dart';
import 'code_theme.dart';

final themeProvider = StateNotifierProvider<ThemeNotifier, ThemeData>((ref) {
  return ThemeNotifier();
});

final codeThemeProvider = StateProvider<CodeTheme>((ref) => CodeTheme.dark);

class ThemeNotifier extends StateNotifier<ThemeData> {
  ThemeNotifier() : super(SpaceCodeTheme.dark());

  void applyThemeSync(Map<String, dynamic> themeData) {
    final themeName = themeData['theme'] as String? ?? 'dark';
    final colors = themeData['colors'] as Map<String, dynamic>?;

    if (colors != null && colors.isNotEmpty) {
      state = SpaceCodeTheme.fromSyncData(colors);
    } else {
      switch (themeName) {
        case 'light': state = SpaceCodeTheme.light(); break;
        case 'dark': state = SpaceCodeTheme.dark(); break;
        case 'anthropic': state = SpaceCodeTheme.anthropic(); break;
        case 'anthropic-dark': state = SpaceCodeTheme.anthropicDark(); break;
        default: state = SpaceCodeTheme.dark();
      }
    }
  }
}
```

- [ ] **步骤 4：Commit**

```bash
git add mobile-app/lib/core/theme/
git commit -m "feat(mobile): add theme system with 4 themes, code highlighting, and sync service"
```

---

### 任务 10：WebSocket 连接服务

**文件：**
- 创建：`mobile-app/lib/core/connection/connection_service.dart`
- 创建：`mobile-app/lib/core/connection/qr_scanner_page.dart`

- [ ] **步骤 1：创建连接服务**

```dart
// mobile-app/lib/core/connection/connection_service.dart

import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'protocol/protocol.dart';
import 'connection_state.dart';

final connectionProvider = StateNotifierProvider<ConnectionNotifier, ConnectionInfo>((ref) {
  return ConnectionNotifier();
});

class ConnectionNotifier extends StateNotifier<ConnectionInfo> {
  WebSocketChannel? _channel;
  StreamSubscription? _subscription;
  final _messageController = StreamController<MobilePush>.broadcast();

  Stream<MobilePush> get messages => _messageController.stream;

  ConnectionNotifier() : super(const ConnectionInfo());

  Future<void> connect(String url) async {
    state = const ConnectionInfo(state: ConnectionState.connecting);

    try {
      _channel = WebSocketChannel.connect(Uri.parse(url));

      _subscription = _channel!.stream.listen(
        (data) {
          final json = jsonDecode(data as String) as Map<String, dynamic>;
          final push = MobilePush.fromJson(json);

          if (push.type == PushType.connected) {
            state = ConnectionInfo(
              state: ConnectionState.connected,
              clientInfo: push.data?['deviceName'] as String?,
            );
          }

          _messageController.add(push);
        },
        onError: (error) {
          state = ConnectionInfo(
            state: ConnectionState.error,
            errorMessage: error.toString(),
          );
        },
        onDone: () {
          state = const ConnectionInfo(state: ConnectionState.disconnected);
        },
      );
    } catch (e) {
      state = ConnectionInfo(
        state: ConnectionState.error,
        errorMessage: e.toString(),
      );
    }
  }

  void send(MobileRequest request) {
    if (_channel != null) {
      _channel!.sink.add(jsonEncode(request.toJson()));
    }
  }

  void disconnect() {
    _subscription?.cancel();
    _channel?.sink.close();
    _channel = null;
    state = const ConnectionInfo(state: ConnectionState.disconnected);
  }

  @override
  void dispose() {
    disconnect();
    _messageController.close();
    super.dispose();
  }
}
```

- [ ] **步骤 2：创建扫码页面**

```dart
// mobile-app/lib/core/connection/qr_scanner_page.dart

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'connection_service.dart';

class QRScannerPage extends ConsumerStatefulWidget {
  const QRScannerPage({super.key});

  @override
  ConsumerState<QRScannerPage> createState() => _QRScannerPageState();
}

class _QRScannerPageState extends ConsumerState<QRScannerPage> {
  final MobileScannerController _scannerController = MobileScannerController();
  bool _processed = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('扫描二维码')),
      body: MobileScanner(
        controller: _scannerController,
        onDetect: (capture) {
          if (_processed) return;
          final barcode = capture.barcodes.firstOrNull;
          if (barcode != null && barcode.rawValue != null) {
            _processed = true;
            _scannerController.stop();
            final url = barcode.rawValue!;
            ref.read(connectionProvider.notifier).connect(url);
            Navigator.of(context).pop();
          }
        },
      ),
    );
  }

  @override
  void dispose() {
    _scannerController.dispose();
    super.dispose();
  }
}
```

- [ ] **步骤 3：Commit**

```bash
git add mobile-app/lib/core/connection/
git commit -m "feat(mobile): add WebSocket connection service and QR scanner page"
```

---

### 任务 11：聊天控制器与核心 Widget

**文件：**
- 创建：`mobile-app/lib/features/chat/chat_controller.dart`
- 创建：`mobile-app/lib/features/chat/widgets/streaming_text.dart`
- 创建：`mobile-app/lib/features/chat/widgets/thinking_block.dart`
- 创建：`mobile-app/lib/features/chat/widgets/code_block.dart`
- 创建：`mobile-app/lib/features/chat/widgets/tool_call_card.dart`
- 创建：`mobile-app/lib/features/chat/widgets/permission_card.dart`
- 创建：`mobile-app/lib/features/chat/widgets/markdown_renderer.dart`
- 创建：`mobile-app/lib/features/chat/widgets/message_bubble.dart`
- 创建：`mobile-app/lib/features/chat/widgets/message_list.dart`
- 创建：`mobile-app/lib/features/chat/widgets/chat_input.dart`

- [ ] **步骤 1：创建聊天控制器**

```dart
// mobile-app/lib/features/chat/chat_controller.dart

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';
import '../../core/protocol/protocol.dart';
import '../../core/connection/connection_service.dart';
import 'models/message.dart';
import 'models/tool_call.dart';
import 'models/permission_request.dart';

final chatProvider = StateNotifierProvider<ChatNotifier, ChatState>((ref) {
  final notifier = ChatNotifier(ref);
  // 监听 WS 消息
  ref.listen(connectionProvider, (_, __) {});
  return notifier;
});

class ChatState {
  final String? currentSessionId;
  final List<ChatMessage> messages;
  final List<PermissionRequest> pendingPermissions;
  final bool isLoading;
  final String? currentAgent;

  const ChatState({
    this.currentSessionId,
    this.messages = const [],
    this.pendingPermissions = const [],
    this.isLoading = false,
    this.currentAgent,
  });

  ChatState copyWith({
    String? currentSessionId,
    List<ChatMessage>? messages,
    List<PermissionRequest>? pendingPermissions,
    bool? isLoading,
    String? currentAgent,
  }) => ChatState(
    currentSessionId: currentSessionId ?? this.currentSessionId,
    messages: messages ?? this.messages,
    pendingPermissions: pendingPermissions ?? this.pendingPermissions,
    isLoading: isLoading ?? this.isLoading,
    currentAgent: currentAgent ?? this.currentAgent,
  );
}

class ChatNotifier extends StateNotifier<ChatState> {
  final Ref _ref;
  final _uuid = const Uuid();

  ChatNotifier(this._ref) : super(const ChatState()) {
    // 订阅 WS 推送消息
    _ref.read(connectionProvider.notifier).messages.listen(_handlePush);
  }

  void _handlePush(MobilePush push) {
    switch (push.type) {
      case PushType.streamEvent:
        _handleStreamEvent(push.data);
        break;
      case PushType.assistant:
        _handleAssistant(push.data);
        break;
      case PushType.toolUse:
        _handleToolUse(push.data);
        break;
      case PushType.toolResult:
        _handleToolResult(push.data);
        break;
      case PushType.permissionRequest:
        _handlePermissionRequest(push.data);
        break;
      case PushType.result:
        _handleResult(push.data);
        break;
      default:
        break;
    }
  }

  void sendMessage(String content) {
    final sessionId = state.currentSessionId ?? _uuid.v4();
    if (state.currentSessionId == null) {
      state = state.copyWith(currentSessionId: sessionId);
    }

    // 添加用户消息
    final userMsg = ChatMessage(
      id: _uuid.v4(),
      role: MessageRole.user,
      content: content,
    );
    state = state.copyWith(
      messages: [...state.messages, userMsg],
      isLoading: true,
    );

    // 创建空的助手消息
    final assistantMsg = ChatMessage(
      id: _uuid.v4(),
      role: MessageRole.assistant,
      isStreaming: true,
    );
    state = state.copyWith(messages: [...state.messages, assistantMsg]);

    // 发送 WS 请求
    _ref.read(connectionProvider.notifier).send(MobileRequest(
      type: RequestType.sendMessage,
      data: {'sessionId': sessionId, 'content': content, 'images': []},
    ));
  }

  void _handleStreamEvent(Map<String, dynamic>? data) {
    if (data == null) return;
    final delta = data['delta'] as String? ?? '';
    final messages = List<ChatMessage>.from(state.messages);
    if (messages.isNotEmpty && messages.last.role == MessageRole.assistant) {
      final last = messages.last;
      messages[messages.length - 1] = last.copyWith(
        content: last.content + delta,
      );
      state = state.copyWith(messages: messages);
    }
  }

  void _handleAssistant(Map<String, dynamic>? data) {
    // 完整的 assistant 消息，可能包含 thinking content
  }

  void _handleToolUse(Map<String, dynamic>? data) {
    if (data == null) return;
    final toolCall = ToolCall(
      id: data['toolUseId'] as String? ?? '',
      toolName: data['toolName'] as String? ?? '',
      input: data['input']?.toString() ?? '',
    );
    final messages = List<ChatMessage>.from(state.messages);
    if (messages.isNotEmpty && messages.last.role == MessageRole.assistant) {
      final last = messages.last;
      final toolCalls = List<ToolCall>.from(last.toolCalls ?? [])..add(toolCall);
      messages[messages.length - 1] = last.copyWith(toolCalls: toolCalls);
      state = state.copyWith(messages: messages);
    }
  }

  void _handleToolResult(Map<String, dynamic>? data) {
    if (data == null) return;
    final toolUseId = data['toolUseId'] as String? ?? '';
    final output = data['output']?.toString() ?? '';
    final messages = List<ChatMessage>.from(state.messages);
    for (int i = messages.length - 1; i >= 0; i--) {
      final msg = messages[i];
      if (msg.toolCalls != null) {
        final toolCalls = msg.toolCalls!.map((tc) =>
          tc.id == toolUseId ? tc.copyWith(output: output, status: ToolCallStatus.completed) : tc
        ).toList();
        messages[i] = msg.copyWith(toolCalls: toolCalls);
        break;
      }
    }
    state = state.copyWith(messages: messages);
  }

  void _handlePermissionRequest(Map<String, dynamic>? data) {
    if (data == null) return;
    final request = PermissionRequest(
      sessionId: data['sessionId'] as String? ?? '',
      toolUseId: data['toolUseId'] as String? ?? '',
      toolName: data['toolName'] as String? ?? '',
      input: data['input']?.toString() ?? '',
    );
    state = state.copyWith(
      pendingPermissions: [...state.pendingPermissions, request],
    );
  }

  void _handleResult(Map<String, dynamic>? data) {
    final messages = List<ChatMessage>.from(state.messages);
    if (messages.isNotEmpty && messages.last.isStreaming) {
      messages[messages.length - 1] = messages.last.copyWith(isStreaming: false);
    }
    state = state.copyWith(messages: messages, isLoading: false);
  }

  void allowPermission(String toolUseId) {
    _ref.read(connectionProvider.notifier).send(MobileRequest(
      type: RequestType.allowPermission,
      data: {'sessionId': state.currentSessionId, 'toolUseId': toolUseId},
    ));
    state = state.copyWith(
      pendingPermissions: state.pendingPermissions.where((p) => p.toolUseId != toolUseId).toList(),
    );
  }

  void denyPermission(String toolUseId) {
    _ref.read(connectionProvider.notifier).send(MobileRequest(
      type: RequestType.denyPermission,
      data: {'sessionId': state.currentSessionId, 'toolUseId': toolUseId},
    ));
    state = state.copyWith(
      pendingPermissions: state.pendingPermissions.where((p) => p.toolUseId != toolUseId).toList(),
    );
  }

  void abort() {
    if (state.currentSessionId != null) {
      _ref.read(connectionProvider.notifier).send(MobileRequest(
        type: RequestType.abort,
        data: {'sessionId': state.currentSessionId},
      ));
    }
  }
}
```

- [ ] **步骤 2：创建核心 Widget 文件**

每个 Widget 文件包含完整的实现代码（streaming_text.dart, thinking_block.dart, code_block.dart, tool_call_card.dart, permission_card.dart, markdown_renderer.dart, message_bubble.dart, message_list.dart, chat_input.dart）。这些 Widget 的实现遵循 Flutter Material 3 规范，使用 ThemeProvider 提供的颜色。

- [ ] **步骤 3：Commit**

```bash
git add mobile-app/lib/features/chat/
git commit -m "feat(mobile): add chat controller and core chat widgets"
```

---

### 任务 12：聊天主界面与路由

**文件：**
- 创建：`mobile-app/lib/features/chat/chat_screen.dart`
- 创建：`mobile-app/lib/features/sessions/session_tile.dart`
- 创建：`mobile-app/lib/features/sessions/sessions_screen.dart`
- 创建：`mobile-app/lib/features/agents/agent_card.dart`
- 创建：`mobile-app/lib/features/agents/agents_screen.dart`
- 创建：`mobile-app/lib/features/settings/settings_screen.dart`
- 创建：`mobile-app/lib/routing/router.dart`
- 创建：`mobile-app/lib/app.dart`
- 修改：`mobile-app/lib/main.dart`

- [ ] **步骤 1：创建聊天主界面 chat_screen.dart**

包含：顶部 AppBar（会话标题+连接状态+菜单）、消息列表、底部输入栏、权限请求底部 Sheet、会话列表抽屉。

- [ ] **步骤 2：创建会话/Agent/设置页面**

- [ ] **步骤 3：创建路由配置和 App 入口**

```dart
// mobile-app/lib/app.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/theme/theme_service.dart';
import 'routing/router.dart';

class SpaceCodeApp extends ConsumerWidget {
  const SpaceCodeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = ref.watch(themeProvider);
    return MaterialApp.router(
      title: 'SpaceCode',
      theme: theme,
      routerConfig: router,
      debugShowCheckedModeBanner: false,
    );
  }
}
```

```dart
// mobile-app/lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';

void main() {
  runApp(const ProviderScope(child: SpaceCodeApp()));
}
```

- [ ] **步骤 4：Commit**

```bash
git add mobile-app/lib/
git commit -m "feat(mobile): add chat screen, sessions, agents, settings, routing, and app entry"
```

---

### 任务 13：集成测试与调试

- [ ] **步骤 1：启动桌面端，打开"连接手机"弹窗**

```bash
cd d:\AI\SpaceCode && npm run dev
```

- [ ] **步骤 2：启动 Flutter App**

```bash
cd d:\AI\SpaceCode\mobile-app && flutter run
```

- [ ] **步骤 3：扫码连接，发送测试消息，验证流式回复**

- [ ] **步骤 4：测试权限交互流程**

- [ ] **步骤 5：测试主题切换同步**

- [ ] **步骤 6：测试会话列表和切换**

- [ ] **步骤 7：Commit 最终状态**

```bash
git add -A
git commit -m "feat(mobile): complete mobile app with desktop integration"
```
