/**
 * Super Agent renderer API — invoke channels 从 shared 定义表驱动生成。
 * 非桌面桥接（H5 等）没有 Router 运行时：state 返回空快照，bind 明确拒绝。
 */
import { superAgentNamespace } from '@/shared/channels/superAgent'
import type { SuperAgentRendererApi } from '@/shared/channels/superAgent'
import { createRendererApi, type AnyElectronAPI } from '@/shared/rendererApi'
import { electronAPI } from './_context'

export const superAgent: SuperAgentRendererApi = createRendererApi(
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
  },
)
