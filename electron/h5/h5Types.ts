// electron/h5Types.ts
// H5 WebUI 访问功能的类型定义

import type { PermissionMode } from '@/shared/channels/claudeCode'
import type { SuperAgentSessionKind } from '@/shared/channels/superAgent'

/** H5 访问设置（持久化到 h5-access.json） */
export interface H5AccessSettings {
  enabled: boolean
  token: string | null
  tokenPreview: string | null
  publicBaseUrl: string | null
  fixedPort: number | null
  /**
   * GenUI 卡片沙箱的第二个端口（票 06）。`null` = 主服务端口 +1；
   * 显式配置用于"+1 被别的服务占了"或"代理上另有端口规划"的部署。
   */
  sandboxPort: number | null
}

/** H5 服务器运行时状态 */
export interface H5ServerStatus {
  running: boolean
  port: number
  ip: string
  publicUrl: string | null
  connectedClients: number
  /** 卡片沙箱该用的端口；主服务起来就有一个值，即使它没能成功监听 */
  sandboxPort: number
  /** 第二个端口是否真的在监听 —— false 时卡片只能显示部署错误 */
  sandboxRunning: boolean
}

/** QR 码数据（桌面端显示，手机扫码） */
export interface H5QRCodeData {
  url: string // http://IP:PORT/h5?token=TOKEN
  token: string
  port: number
  ip: string
}

/** WS 连接后推送的初始化消息 */
export interface H5ConnectedPayload {
  projectPath: string | null
  sessionId: string | null
}

/** 桌面端切换会话时推送的消息 */
export interface H5SessionChangedPayload {
  sessionId: string | null
  projectPath: string | null
}

/** 手机端发起并需要同步到桌面端/其他 H5 客户端的用户消息 */
export interface H5RemoteUserMessagePayload {
  __h5RemoteUserMessage: true
  messageId: string | null
  content: string
  startTurn?: boolean
  history?: unknown[]
  projectPath: string | null
  title: string | null
  timestamp: number
  /** false 表示只在会话列表落位、不抢当前视图（定时任务后台触发用） */
  activate?: boolean
  /** 触发方为该会话指定的模型（实际模型名），用于桌面输入框显示与续话沿用 */
  model?: string
  /**
   * 触发方为该会话指定的权限模式。缺省时桌面按全局默认档对账引擎 —— 流水线接管
   * 这类「引擎已由主进程起好」的会话必须带上它，否则会话会被就地降级。
   */
  permissionMode?: PermissionMode
  /**
   * 推送方拥有的会话种类。Super Agent 的 Router/Worker 会话不由人发起，渲染层
   * 建行时必须带上它，否则这条会话会出现在侧边栏普通会话列表里。
   */
  sessionType?: SuperAgentSessionKind
  /**
   * 气泡落在哪一侧。缺省 'user' —— 手机端/IM 发起的确实是人消息。
   * 宿主代发的受控 reply 不是人在说话，必须带 'assistant'，否则它会顶着
   * 用户头像出现在自己那条答复下面，还会被 retryLastMessage 当成「上一次问的」重发。
   */
  role?: 'user' | 'assistant'
}

/** WS 推送的消息格式 */
export interface H5PushMessage {
  type: string
  sessionId?: string
  data?: unknown
}

/** H5 客户端发来的 WS 请求消息 */
export interface H5ClientMessage {
  type: string
  data?: Record<string, unknown>
}
