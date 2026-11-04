/**
 * Super Agent renderer API — invoke channels 与事件从 shared 定义表驱动生成。
 * 非桌面桥接（H5 等）没有 Router 运行时：state/health 返回空投影，bind 明确拒绝，
 * health.changed 订阅退化为 noop。
 */
import { superAgentNamespace } from '@/shared/channels/superAgent'
import type { SuperAgentRendererApi, SuperAgentEventApi } from '@/shared/channels/superAgent'
import { createRendererApi, createEventApi, type AnyElectronAPI } from '@/shared/rendererApi'
import { electronAPI } from './_context'

const invokeApi = createRendererApi(
  superAgentNamespace.channels,
  'superAgent',
  electronAPI as unknown as AnyElectronAPI,
  {
    state: () => ({
      repoRoot: '',
      seq: 0,
      asOf: Date.now(),
      staleAfterMs: 5000,
      router: null,
      attention: { unanswered: 0 },
    }),
    routerBind: () => {
      throw new Error('Super Agent is only available in the desktop app')
    },
    health: () => ({
      repoRoot: '',
      problemCount: 0,
      degradedCount: 0,
      items: [],
      updatedAt: new Date(0).toISOString(),
    }),
  },
)

const eventApi = createEventApi(superAgentNamespace.events, 'superAgent', electronAPI as unknown as AnyElectronAPI)

export const superAgent: SuperAgentRendererApi & SuperAgentEventApi = {
  ...invokeApi,
  ...eventApi,
}
