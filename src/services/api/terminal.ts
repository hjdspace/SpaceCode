/**
 * Terminal renderer API — invoke/send channels 与事件订阅均从 channel 定义
 * 表驱动生成，取代逐个手写 null-check 转发的模式。
 */
import { terminalNamespace } from '@/shared/channels/terminal'
import type { TerminalRendererApi, TerminalEventApi } from '@/shared/channels/terminal'
import { createRendererApi, createEventApi } from '@/shared/rendererApi'
import type { AnyElectronAPI } from '@/shared/rendererApi'
import { electronAPI } from './_context'

const invokeApi = createRendererApi(
  terminalNamespace.channels,
  'terminal',
  electronAPI as unknown as AnyElectronAPI,
  {
    create: () => ({ id: null, error: 'Terminal API not available' }),
    write: () => undefined,
    resize: () => undefined,
    kill: () => undefined,
    runCommand: () => undefined,
  },
)

const eventApi = createEventApi(terminalNamespace.events, 'terminal', electronAPI as unknown as AnyElectronAPI)

export const terminal: TerminalRendererApi & TerminalEventApi = {
  ...invokeApi,
  ...eventApi,
}
