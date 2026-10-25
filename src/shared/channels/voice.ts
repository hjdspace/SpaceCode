/**
 * Voice Input Channel 定义 — voice 命名空间 IPC 的单一真相源。
 *
 * 01 只包含识别模型的管理面；录音会话调用面在后续票据里扩展。
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
  },
  events: {
    onModelProgress: {
      channel: 'model-progress',
      args: [] as unknown as [progress: VoiceModelProgress],
    },
  },
})

export type VoiceChannelMap = typeof voiceNamespace.channels
export type VoiceEventMap = typeof voiceNamespace.events
export type VoiceRendererApi = DeriveRendererApi<VoiceChannelMap>
export type VoiceEventApi = DeriveEventApi<VoiceEventMap>
