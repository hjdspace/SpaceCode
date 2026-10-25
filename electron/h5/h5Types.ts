// electron/h5Types.ts
// H5 WebUI 访问功能的类型定义

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
  projectPath: string | null
  title: string | null
  timestamp: number
  /** false 表示只在会话列表落位、不抢当前视图（定时任务后台触发用） */
  activate?: boolean
  /** 触发方为该会话指定的模型（实际模型名），用于桌面输入框显示与续话沿用 */
  model?: string
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
