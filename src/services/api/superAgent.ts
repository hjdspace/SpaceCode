/**
 * Super Agent renderer API — invoke channels 与事件从 shared 定义表驱动生成。
 * 非桌面桥接（H5 等）没有 Router 运行时：state/queue 返回空投影，bind 与 dispatch
 * 明确拒绝，health.changed / queue-changed 订阅退化为 noop。
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
    dispatch: () => {
      // 显式派工依赖主进程 Router/Worker 运行时，非桌面环境明确拒绝而非假排队
      throw new Error('Super Agent is only available in the desktop app')
    },
    queue: () => ({
      repoRoot: '',
      maxWorkers: 1,
      running: [],
      queued: [],
    }),
    tickets: () => ({
      // 非桌面环境没有工单运行时：空看板、seq 0，与主进程初始状态一致
      repoRoot: '',
      seq: 0,
      tickets: [],
    }),
    workerBind: () => {
      // Worker 镜像依赖主进程编排运行时，非桌面环境明确拒绝而非假镜像
      throw new Error('Super Agent is only available in the desktop app')
    },
    workerUnbind: () => {
      // 非桌面环境没有已启动的镜像可停；幂等成功
      return true as const
    },
  },
)

const eventApi = createEventApi(superAgentNamespace.events, 'superAgent', electronAPI as unknown as AnyElectronAPI)

export const superAgent: SuperAgentRendererApi & SuperAgentEventApi = {
  ...invokeApi,
  ...eventApi,
}
