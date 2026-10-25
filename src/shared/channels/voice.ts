/**
 * Voice Input Channel 定义 — voice 命名空间 IPC 的单一真相源。
 *
 * 模型管理面（01）与录音会话面（02）共用同一命名空间：preload bridge、
 * renderer API 类型、handler 注册全部从这份定义派生。
 */
import { defineNamespace } from '@/shared/channelMap'
import type { DeriveRendererApi, DeriveEventApi } from '@/shared/channelMap'

export type VoiceModelState =
  | 'missing'
  | 'downloading'
  | 'verifying'
  | 'extracting'
  | 'installed'
  | 'corrupted'

export type VoiceModelPhase = 'downloading' | 'verifying' | 'extracting'

export type VoiceModelSourceKind = 'github' | 'mirror' | 'custom'

export interface VoiceModelSource {
  kind: VoiceModelSourceKind
  url: string
}

export interface VoiceModelProgress {
  phase: VoiceModelPhase
  transferred: number
  total: number
  percent: number
  source?: VoiceModelSource
}

export interface VoiceModelStatus {
  state: VoiceModelState
  version: string | null
  /** Sum of the four installed model files. */
  installedBytes: number
  /** Everything the remove action would reclaim right now (model + archive + .part). */
  diskUsageBytes: number
  /** Bytes retained in the `.part` file, resumable on the next install. */
  partialBytes: number
  archiveBytes: number
  /** A verified archive is on disk and will be reused by the next install. */
  archiveReady: boolean
  /** Expected sum of the four model files once installed. */
  installedTotalBytes: number
  installedAt: string | null
  progress?: VoiceModelProgress
  error?: string
  errorCode?: VoiceModelErrorCode
}

export interface VoiceModelInstallInfo {
  version: string
  archiveBytes: number
  installedBytes: number
  archiveName: string
  sources: VoiceModelSource[]
}

export type VoiceModelErrorCode =
  | 'busy'
  | 'network'
  | 'hash-mismatch'
  | 'tar-unavailable'
  | 'extract-failed'
  | 'file-system'
  | 'recording'
  | 'canceled'

export interface VoiceInstallResult {
  success: boolean
  canceled?: boolean
  error?: string
  errorCode?: VoiceModelErrorCode
  status: VoiceModelStatus
}

export interface VoiceCancelResult {
  success: boolean
  error?: string
}

export interface VoiceRemoveResult {
  success: boolean
  error?: string
  errorCode?: VoiceModelErrorCode
  status: VoiceModelStatus
}

// ── Recording session ──────────────────────────────────────────

/** 渲染层必须按这个采样率送 PCM；主进程不接受其它采样率。 */
export const VOICE_SAMPLE_RATE = 16_000

export type VoiceSessionState = 'loading' | 'recording' | 'finalizing' | 'ended' | 'failed'

export type VoiceSessionErrorCode =
  | 'model-missing'
  | 'model-corrupted'
  | 'engine-failed'
  | 'canceled'

export interface VoiceStartSessionRequest {
  sessionId: string
}

export interface VoiceStartSessionResult {
  ok: boolean
  /** 渲染层据此构造 AudioContext；恒为 VOICE_SAMPLE_RATE。 */
  sampleRate: number
  error?: string
  errorCode?: VoiceSessionErrorCode
}

export interface VoiceAudioRequest {
  sessionId: string
  /** 100ms 的 16kHz 单声道 PCM16：1600 samples / 3200 bytes。 */
  pcm: ArrayBuffer
}

export interface VoiceStopSessionRequest {
  sessionId: string
}

export interface VoiceStopSessionResult {
  success: boolean
  /** 终稿；停止一个未知或已结束的会话时为空字符串。 */
  text: string
  error?: string
  errorCode?: VoiceSessionErrorCode
}

export interface VoiceCancelSessionRequest {
  sessionId: string
}

export interface VoiceCancelSessionResult {
  success: boolean
}

export interface VoicePartialPayload {
  sessionId: string
  text: string
}

export interface VoiceSessionStatePayload {
  sessionId: string
  state: VoiceSessionState
  error?: string
  errorCode?: VoiceSessionErrorCode
}

export const voiceNamespace = defineNamespace({
  channels: {
    getModelStatus: {
      req: [] as unknown as [],
      res: null as unknown as VoiceModelStatus,
    },
    getInstallInfo: {
      req: [] as unknown as [],
      res: null as unknown as VoiceModelInstallInfo,
    },
    installModel: {
      req: [] as unknown as [],
      res: null as unknown as VoiceInstallResult,
    },
    cancelInstall: {
      req: [] as unknown as [],
      res: null as unknown as VoiceCancelResult,
    },
    removeModel: {
      req: [] as unknown as [],
      res: null as unknown as VoiceRemoveResult,
    },
    startSession: {
      req: [] as unknown as [request: VoiceStartSessionRequest],
      res: null as unknown as VoiceStartSessionResult,
    },
    sendAudio: {
      kind: 'send',
      req: [] as unknown as [request: VoiceAudioRequest],
    },
    stopSession: {
      req: [] as unknown as [request: VoiceStopSessionRequest],
      res: null as unknown as VoiceStopSessionResult,
    },
    cancelSession: {
      req: [] as unknown as [request: VoiceCancelSessionRequest],
      res: null as unknown as VoiceCancelSessionResult,
    },
  },
  events: {
    onModelProgress: {
      channel: 'model-progress',
      args: [] as unknown as [progress: VoiceModelProgress],
    },
    onPartial: {
      channel: 'partial',
      args: [] as unknown as [payload: VoicePartialPayload],
    },
    onSessionState: {
      channel: 'session-state',
      args: [] as unknown as [payload: VoiceSessionStatePayload],
    },
  },
})

export type VoiceChannelMap = typeof voiceNamespace.channels
export type VoiceEventMap = typeof voiceNamespace.events
export type VoiceRendererApi = DeriveRendererApi<VoiceChannelMap>
export type VoiceEventApi = DeriveEventApi<VoiceEventMap>
