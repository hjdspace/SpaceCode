// electron/h5Types.ts
// H5 WebUI 访问功能的类型定义

/** H5 访问设置（持久化到 h5-access.json） */
export interface H5AccessSettings {
  enabled: boolean
  token: string | null
  tokenPreview: string | null
  publicBaseUrl: string | null
  fixedPort: number | null
}

/** H5 服务器运行时状态 */
export interface H5ServerStatus {
  running: boolean
  port: number
  ip: string
  publicUrl: string | null
  connectedClients: number
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
