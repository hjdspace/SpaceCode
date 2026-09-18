/**
 * Update Channel 定义 — update 命名空间 IPC 的单一真相源。
 *
 * 本文件定义了所有 `update:*` channel 的三要素（名、参数类型、返回类型）
 * 与事件订阅（channel 后缀 + 回调参数元组），preload bridge、renderer API 类型、
 * handler 注册均从此派生。
 *
 * 迁移自：
 *   - preload.ts 中 update: {...} 的手写 invoke/on（8 个成员）
 *   - electron.d.ts 中 ElectronUpdateAPI 接口的手写签名
 *   - api/update.ts 中 null-check 转发的手写签名
 *   - autoUpdaterService.ts 中内联字符串 channel 名
 */
import { defineNamespace } from '@/shared/channelMap'
import type { DeriveRendererApi, DeriveEventApi } from '@/shared/channelMap'

export interface UpdateProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

export interface UpdateAvailableInfo {
  version: string
  releaseDate: string
  releaseNotes: string
  releaseName?: string
}

export interface UpdateOperationResult {
  success: boolean
  error?: string
}

export const updateNamespace = defineNamespace({
  channels: {
    check: {
      req: [] as unknown as [],
      res: null as unknown as UpdateOperationResult,
    },
    download: {
      req: [] as unknown as [],
      res: null as unknown as UpdateOperationResult,
    },
    installAndRestart: {
      req: [] as unknown as [],
      res: null as unknown as void,
    },
  },
  events: {
    onAvailable: { channel: 'available', args: [] as unknown as [info: UpdateAvailableInfo] },
    onNotAvailable: { channel: 'not-available', args: [] as unknown as [] },
    onDownloadProgress: { channel: 'download-progress', args: [] as unknown as [progress: UpdateProgress] },
    onDownloaded: { channel: 'downloaded', args: [] as unknown as [info: { version: string }] },
    onError: { channel: 'error', args: [] as unknown as [error: string] },
  },
})

export type UpdateChannelMap = typeof updateNamespace.channels
export type UpdateEventMap = typeof updateNamespace.events
export type UpdateRendererApi = DeriveRendererApi<UpdateChannelMap>
export type UpdateEventApi = DeriveEventApi<UpdateEventMap>
