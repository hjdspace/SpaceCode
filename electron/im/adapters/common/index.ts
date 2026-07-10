/**
 * IM Adapter Common Layer — Module Index
 *
 * Re-exports all common modules for convenient imports.
 */

// Core modules
export { WsBridge } from './ws-bridge'
export type { WsBridgeOptions } from './ws-bridge'
export { ChatQueue } from './chat-queue'
export { SessionStore } from './session-store'
export type { SessionStoreData, SessionStoreOptions } from './session-store'
export { SessionRecovery } from './session-recovery'
export type {
  RecoverySessionStore,
  RecoveryBridge,
  RecoveryHttpClient,
  SessionRecoveryDeps,
} from './session-recovery'
export { MessageBuffer } from './message-buffer'
export type { MessageBufferOptions, MessageBufferCallbacks } from './message-buffer'
export { MessageDedup } from './message-dedup'
export type { MessageDedupOptions } from './message-dedup'

// Support modules
export {
  parsePermissionCommand,
  buildPermissionCallback,
} from './permission'
export type { PermissionAction, ParsedPermission } from './permission'
export { Pairing } from './pairing'
export type {
  PairedUser,
  PairingState,
  PairingConfig,
  PairingResult,
} from './pairing'
export {
  loadConfig,
  saveConfig,
  getDefaultConfig,
  desensitizeConfig,
  getClaudeConfigDir,
  getAdaptersConfigPath,
  resolveUserDefaultWorkDir,
} from './config'
export type {
  AdapterConfig,
  PlatformConfig,
  PlatformName,
  TelegramConfig,
  FeishuConfig,
  DingTalkConfig,
  WeChatConfig,
  WhatsAppConfig,
} from './config'
export { HttpClient, HttpError } from './http-client'
export type {
  HttpClientOptions,
  SessionInfo,
  ProjectInfo,
  GitInfo,
  ProviderInfo,
  ModelInfo,
  SkillInfo,
} from './http-client'
export {
  splitMessage,
  convertMarkdownTablesToBullets,
  formatToolUse,
  formatPermissionRequest,
  formatImHelp,
  formatImStatus,
} from './format'
export type { ImCommand } from './format'
export { ImLogger, createLogger } from './logger'
export type { LogLevel } from './logger'
export { HealthServer } from './health'
export type { HealthStatus, HealthReport, HealthServerOptions } from './health'

// Attachment subsystem
export type {
  AttachmentType,
  IncomingAttachment,
  StoredAttachment,
  AttachmentRef as StoredAttachmentRef,
  PendingUpload,
} from './attachment/attachment-types'
export {
  validateAttachment,
  IMAGE_MAX_BYTES,
  FILE_MAX_BYTES,
  IMAGE_MIME_WHITELIST,
  IMAGE_MIME_BLACKLIST,
} from './attachment/attachment-limits'
export type { ValidationResult } from './attachment/attachment-limits'
export { AttachmentStore } from './attachment/attachment-store'
export type { AttachmentStoreOptions, GcResult } from './attachment/attachment-store'
export { ImageBlockWatcher } from './attachment/image-block-watcher'

// Shared types
export type {
  ClientMessage,
  ServerMessage,
  ChatState,
  TokenUsage,
  SessionBinding,
  WsConnectionState,
  WsSession,
  MessageHandler,
  AttachmentRef,
} from './types'
