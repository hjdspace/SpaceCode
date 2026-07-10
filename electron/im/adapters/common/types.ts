/**
 * IM Adapter Common Layer - Shared Type Definitions
 *
 * Mirrors the server-side ClientMessage / ServerMessage protocol types
 * without importing server code (zero-dependency principle).
 */

// ──────────────────────────────────────────────────────────────────────────
// Attachments
// ──────────────────────────────────────────────────────────────────────────

export interface AttachmentRef {
  type: 'file' | 'image'
  name?: string
  path?: string // file: server reads disk and injects @"path"
  data?: string // image: base64
  mimeType?: string
}

// ──────────────────────────────────────────────────────────────────────────
// Client → Server Messages (WsBridge sends these)
// ──────────────────────────────────────────────────────────────────────────

export type ClientMessage =
  | { type: 'user_message'; content: string; attachments?: AttachmentRef[] }
  | { type: 'permission_response'; requestId: string; allowed: boolean; rule?: 'always' }
  | { type: 'stop_generation' }
  | { type: 'ping' }

// ──────────────────────────────────────────────────────────────────────────
// Server → Client Messages (WsBridge receives these)
// ──────────────────────────────────────────────────────────────────────────

export type ChatState =
  | 'idle'
  | 'thinking'
  | 'compacting'
  | 'tool_executing'
  | 'streaming'
  | 'permission_pending'

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

export type ServerMessage =
  | { type: 'connected'; sessionId: string }
  | { type: 'content_start'; blockType: 'text' | 'tool_use'; toolName?: string; toolUseId?: string }
  | { type: 'content_delta'; text?: string; toolInput?: string }
  | { type: 'tool_use_complete'; toolName: string; toolUseId: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'permission_request'; requestId: string; toolName: string; input: Record<string, unknown>; description?: string }
  | { type: 'message_complete'; usage: TokenUsage }
  | { type: 'thinking'; text: string }
  | { type: 'status'; state: ChatState; verb?: string }
  | { type: 'error'; message: string; code: string; retryable?: boolean }
  | { type: 'api_retry'; attempt: number; maxRetries: number; retryDelayMs: number }
  | { type: 'streaming_fallback'; cause: string }
  | { type: 'session_title_updated'; sessionId: string; title: string }

// ──────────────────────────────────────────────────────────────────────────
// Session binding
// ──────────────────────────────────────────────────────────────────────────

export interface SessionBinding {
  sessionId: string
  workDir: string
}

// ──────────────────────────────────────────────────────────────────────────
// WS connection states
// ──────────────────────────────────────────────────────────────────────────

export type WsConnectionState = 'connecting' | 'open' | 'closed' | 'reconnecting'

export interface WsSession {
  sessionId: string
  ws: WebSocket
  state: WsConnectionState
}

// ──────────────────────────────────────────────────────────────────────────
// Message handler
// ──────────────────────────────────────────────────────────────────────────

export type MessageHandler = (msg: ServerMessage) => void | Promise<void>
