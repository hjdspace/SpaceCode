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
      review: { reminded: 0 },
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
    workerTakeover: () => {
      // 非桌面环境没有 Worker 可接管；交还幂等成功，接管不可用
      throw new Error('worker takeover is only available in desktop')
    },
    workerRelease: () => {
      // 非桌面环境没有接管态可交还；幂等成功
      return true as const
    },
    workerMessage: () => {
      // 非桌面环境没有引擎投递链路；拒绝而不是假装成功
      throw new Error('worker message is only available in desktop')
    },
    attentions: () => ({
      // 非桌面环境没有 Attention 运行时：空看板、待处理 0，与主进程初始状态一致
      repoRoot: '',
      attentions: [],
      pendingTickets: 0,
    }),
    attentionAnswer: () => {
      // 回答依赖主进程领域落库与投递链路，非桌面环境明确拒绝
      throw new Error('attention answer is only available in desktop')
    },
    ticketAccept: () => {
      // 验收依赖主进程领域落库，非桌面环境明确拒绝而不是假装成功
      throw new Error('ticket accept is only available in desktop')
    },
    ticketStop: () => {
      throw new Error('ticket stop is only available in desktop')
    },
    ticketMessage: () => {
      // 追问依赖引擎投递链路（与 workerMessage 同一套对账），非桌面环境拒绝
      throw new Error('ticket message is only available in desktop')
    },
    ticketRetry: () => {
      throw new Error('ticket retry is only available in desktop')
    },
    pause: () => {
      // 暂停依赖主进程领域运行时与持久化状态，非桌面环境明确拒绝
      throw new Error('pause is only available in desktop')
    },
    resume: () => {
      throw new Error('resume is only available in desktop')
    },
  },
)

const eventApi = createEventApi(superAgentNamespace.events, 'superAgent', electronAPI as unknown as AnyElectronAPI)

export const superAgent: SuperAgentRendererApi & SuperAgentEventApi = {
  ...invokeApi,
  ...eventApi,
}
