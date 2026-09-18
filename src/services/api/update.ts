/**
 * Update renderer API — invoke channels 与事件订阅均从 channel 定义
 * 表驱动生成，取代逐个手写 null-check 转发的模式。
 */
import { updateNamespace } from '@/shared/channels/update'
import type { UpdateRendererApi, UpdateEventApi } from '@/shared/channels/update'
import { createRendererApi, createEventApi } from '@/shared/rendererApi'
import type { AnyElectronAPI } from '@/shared/rendererApi'
import { electronAPI } from './_context'

const invokeApi = createRendererApi(
  updateNamespace.channels,
  'update',
  electronAPI as unknown as AnyElectronAPI,
  {
    check: () => ({ success: false, error: 'Update API not available' }),
    download: () => ({ success: false, error: 'Update API not available' }),
    installAndRestart: () => undefined,
  },
)

const eventApi = createEventApi(updateNamespace.events, 'update', electronAPI as unknown as AnyElectronAPI)

export const update: UpdateRendererApi & UpdateEventApi = {
  ...invokeApi,
  ...eventApi,
}
