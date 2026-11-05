/**
 * 测试用的引擎接缝（不 import 被测模块之外的东西，也不打真 CLI —— 设计 §13.1）。
 *
 * 记录每次 startSession/sendMessage/abort/stop 与推送的气泡，并把 route 事件
 * 的监听器留在手里，让用例自己「发一帧 result」模拟引擎回话。
 */
import type { EngineSessionConfig } from '../../engine/engines/types'
import type {
  SuperAgentEngineBridge,
  SuperAgentRouteListener,
  SuperAgentUserPush,
} from '../engineBridge'

export interface FakeBridgeCall {
  sessionId: string
  config?: EngineSessionConfig
  content?: string
  images?: unknown[]
}

export interface FakeBridge {
  bridge: SuperAgentEngineBridge
  started: FakeBridgeCall[]
  sent: FakeBridgeCall[]
  aborted: string[]
  stopped: string[]
  models: FakeBridgeCall[]
  pushed: SuperAgentUserPush[]
  /** startSession 的失败注入：一次性的，用完即清。 */
  failNextStart: Error | null
  failNextSend: Error | null
  /** setModel 的失败注入（一次性）：用来验"控制请求失败就重启"这条回退。 */
  failNextSetModel: Error | null
  emit(sessionId: string, eventType: string, data?: unknown): void
}

export function createFakeBridge(): FakeBridge {
  const listeners: SuperAgentRouteListener[] = []
  const fake: FakeBridge = {
    bridge: {
      loadConfig: (cwd) => ({ cwd, model: 'sonnet' }),
      startSession: async (sessionId, config) => {
        if (fake.failNextStart) {
          const err = fake.failNextStart
          fake.failNextStart = null
          throw err
        }
        fake.started.push({ sessionId, config })
        return null
      },
      sendMessage: async (sessionId, content, images) => {
        if (fake.failNextSend) {
          const err = fake.failNextSend
          fake.failNextSend = null
          throw err
        }
        fake.sent.push({ sessionId, content, images })
      },
      abort: async (sessionId) => {
        fake.aborted.push(sessionId)
      },
      stop: async (sessionId) => {
        fake.stopped.push(sessionId)
      },
      setModel: async (sessionId, model) => {
        if (fake.failNextSetModel) {
          const err = fake.failNextSetModel
          fake.failNextSetModel = null
          throw err
        }
        fake.models.push({ sessionId, config: { cwd: '', model } })
      },
      resolveModelAlias: (modelValue) => modelValue,
      onRouteEvent: (listener) => {
        listeners.push(listener)
        return () => {
          const index = listeners.indexOf(listener)
          if (index >= 0) listeners.splice(index, 1)
        }
      },
      pushUserMessage: (push) => {
        fake.pushed.push(push)
      },
    },
    started: [],
    sent: [],
    aborted: [],
    stopped: [],
    models: [],
    pushed: [],
    failNextStart: null,
    failNextSend: null,
    failNextSetModel: null,
    emit(sessionId, eventType, data) {
      for (const listener of [...listeners]) listener(sessionId, eventType, data)
    },
  }
  return fake
}

/** Worker Report 围栏文本（与 reportParser 的严格协议同一形状）。 */
export function reportFence(
  fields: Record<string, unknown>,
): string {
  return ['```super-agent:report', JSON.stringify(fields), '```'].join('\n')
}

/** Router 路由指令围栏文本（version 2：kind + title/ticketId/note）。 */
export function routeFence(routes: unknown[]): string {
  return ['```super-agent:route', JSON.stringify({ version: 2, routes }), '```'].join('\n')
}
