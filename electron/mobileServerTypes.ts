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
      | 'permission_request' | 'result' | 'sessions_list' | 'agents_list'
      | 'settings_sync' | 'theme_sync' | 'theme_changed' | 'error' | 'pong'
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
