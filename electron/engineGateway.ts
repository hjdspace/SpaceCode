// electron/engineGateway.ts
// Engine Gateway — 调用侧到 Engine 的统一深模块。
// 三个 adapter（claudeCodeIPC.ts / h5Server.ts / imServer.ts）的引擎派发调用全部委托到这里。
// 详见 ADR-0004。

import { EngineFactory } from './engines/EngineFactory'
import type {
  IEngine,
  EngineSessionConfig,
  EngineSessionStatus,
  ImageAttachment,
  PermissionDecision,
  PermissionMode,
  AgentInfo,
  EngineType,
} from './engines/types'
import { info, warn, error } from './logger'

const TAG = 'EngineGateway'

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotImplementedError'
  }
}

export function findEngineForSession(sessionId: string): IEngine {
  let fallback: IEngine | null = null
  for (const engine of EngineFactory.getAllEngines()) {
    const status = engine.getSessionStatus(sessionId)
    if (!status) continue
    if (status.isRunning) return engine
    if (!fallback) fallback = engine
  }
  if (fallback) return fallback
  return EngineFactory.getEngine('claude-code')
}

type AnyFn = (...args: any[]) => any

function withLogging<T extends AnyFn>(
  methodName: string,
  fn: T,
  sidExtractor?: (args: Parameters<T>) => string,
): T {
  return ((...args: Parameters<T>) => {
    const sid = sidExtractor ? sidExtractor(args) : (typeof args[0] === 'string' ? args[0] : '(none)')
    const shortSid = sid === '(none)' ? '(none)' : sid.slice(0, 8)
    info(TAG, `→ ${methodName} | sid=${shortSid}`)
    const startMs = Date.now()
    try {
      const result = fn(...args)
      if (result instanceof Promise) {
        return result.then(
          (r) => {
            info(TAG, `← ${methodName} | sid=${shortSid} | elapsed=${Date.now() - startMs}ms`)
            return r
          },
          (err) => {
            error(TAG, `✗ ${methodName} | sid=${shortSid} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
            throw err
          },
        )
      }
      info(TAG, `← ${methodName} | sid=${shortSid} | elapsed=${Date.now() - startMs}ms`)
      return result
    } catch (err) {
      error(TAG, `✗ ${methodName} | sid=${shortSid} | elapsed=${Date.now() - startMs}ms`, { error: String(err) })
      throw err
    }
  }) as T
}

function requireAction<T extends AnyFn>(engine: IEngine, methodName: string): T {
  const fn = (engine as any)[methodName]
  if (typeof fn !== 'function') {
    throw new NotImplementedError(`${methodName} not implemented in engine=${engine.type}`)
  }
  return fn.bind(engine) as T
}

export const engineGateway = {
  findEngineForSession,

  startSession: withLogging('startSession', async (sessionId: string, config: EngineSessionConfig): Promise<EngineSessionStatus | null> => {
    let engineType = config.engineType || 'claude-code'
    if (engineType !== 'claude-code' && !(await EngineFactory.isEngineAvailableAsync(engineType))) {
      warn(TAG, `Engine "${engineType}" not available, falling back to claude-code | sid=${sessionId.slice(0, 8)}`)
      engineType = 'claude-code'
    }
    const engine = EngineFactory.getEngine(engineType)
    await engine.startSession(sessionId, config)
    return engine.getSessionStatus(sessionId)
  }),

  sendMessage: withLogging('sendMessage', async (sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> => {
    const engine = findEngineForSession(sessionId)
    await engine.sendMessage(sessionId, content, images)
  }),

  abort: withLogging('abort', async (sessionId: string): Promise<void> => {
    const engine = findEngineForSession(sessionId)
    await engine.abort(sessionId)
  }),

  stop: withLogging('stop', async (sessionId: string): Promise<void> => {
    for (const engine of EngineFactory.getAllEngines()) {
      if (engine.getSessionStatus(sessionId)) {
        try {
          await engine.stop(sessionId)
        } catch (err) {
          warn(TAG, `stop failed on engine=${engine.type} | sid=${sessionId.slice(0, 8)}`, { error: String(err) })
        }
      }
    }
  }),

  suspendSession: withLogging('suspendSession', (sessionId: string): void => {
    const engine = findEngineForSession(sessionId)
    const fn = requireAction<(sid: string) => void>(engine, 'suspendSession')
    fn(sessionId)
  }),

  resumeSession: withLogging('resumeSession', async (sessionId: string): Promise<EngineSessionStatus | null> => {
    const engine = findEngineForSession(sessionId)
    const fn = requireAction<(sid: string) => Promise<void>>(engine, 'resumeSession')
    await fn(sessionId)
    return engine.getSessionStatus(sessionId)
  }),

  getSessionStatus: withLogging('getSessionStatus', (sessionId: string): EngineSessionStatus | null => {
    const engine = findEngineForSession(sessionId)
    return engine.getSessionStatus(sessionId)
  }),

  getActiveSessions: withLogging('getActiveSessions', (): EngineSessionStatus[] => {
    const all: EngineSessionStatus[] = []
    for (const engine of EngineFactory.getAllEngines()) {
      all.push(...engine.getActiveSessions())
    }
    return all
  }, () => '(none)'),

  isSessionActive: withLogging('isSessionActive', (sessionId?: string): boolean => {
    if (sessionId) {
      const engine = findEngineForSession(sessionId)
      const status = engine.getSessionStatus(sessionId)
      return status?.isRunning ?? false
    }
    for (const engine of EngineFactory.getAllEngines()) {
      if (engine.getActiveSessions().length > 0) return true
    }
    return false
  }),

  allowPermission: withLogging('allowPermission', async (
    sessionId: string,
    requestId: string,
    updatedInput?: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
  ): Promise<void> => {
    const engine = findEngineForSession(sessionId)
    const fn = requireAction<(sid: string, rid: string, input?: Record<string, unknown>, cls?: 'user_temporary' | 'user_permanent') => Promise<void>>(engine, 'allowPermission')
    await fn(sessionId, requestId, updatedInput, decisionClassification)
  }),

  denyPermission: withLogging('denyPermission', async (
    sessionId: string,
    requestId: string,
    message: string = 'User denied',
    options?: { interrupt?: boolean },
  ): Promise<void> => {
    const engine = findEngineForSession(sessionId)
    const fn = requireAction<(sid: string, rid: string, msg?: string, opts?: { interrupt?: boolean }) => Promise<void>>(engine, 'denyPermission')
    await fn(sessionId, requestId, message, options)
  }),

  respondPermission: withLogging('respondPermission', async (
    sessionId: string,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<void> => {
    const engine = findEngineForSession(sessionId)
    const fn = requireAction<(sid: string, rid: string, d: PermissionDecision) => Promise<void>>(engine, 'respondPermission')
    await fn(sessionId, requestId, decision)
  }),

  setPermissionMode: withLogging('setPermissionMode', async (sessionId: string, mode: PermissionMode): Promise<void> => {
    const engine = findEngineForSession(sessionId)
    const fn = requireAction<(sid: string, m: PermissionMode) => Promise<void>>(engine, 'setPermissionMode')
    await fn(sessionId, mode)
  }),

  submitToolAnswer: withLogging('submitToolAnswer', async (sessionId: string, toolCallId: string, answers: Record<string, string>): Promise<void> => {
    const engine = findEngineForSession(sessionId)
    const fn = requireAction<(sid: string, tid: string, a: Record<string, string>) => Promise<void>>(engine, 'submitToolAnswer')
    await fn(sessionId, toolCallId, answers)
  }),

  skipToolAnswer: withLogging('skipToolAnswer', async (sessionId: string, toolCallId: string): Promise<void> => {
    const engine = findEngineForSession(sessionId)
    const fn = requireAction<(sid: string, tid: string) => Promise<void>>(engine, 'skipToolAnswer')
    await fn(sessionId, toolCallId)
  }),

  listAgents: withLogging('listAgents', async (cwd?: string, engineType?: EngineType): Promise<AgentInfo[]> => {
    const type = engineType || 'claude-code'
    const engine = EngineFactory.getEngine(type)
    if (typeof engine.listAgents === 'function') {
      return engine.listAgents(cwd)
    }
    return []
  }, () => '(none)'),

  setModel: withLogging('setModel', async (sessionId: string, model: string | undefined): Promise<void> => {
    const engine = findEngineForSession(sessionId)
    const fn = requireAction<(sid: string, m: string | undefined) => Promise<void>>(engine, 'setModel')
    await fn(sessionId, model)
  }),

  getMcpStatus: withLogging('getMcpStatus', async (sessionId: string): Promise<Record<string, unknown> | null> => {
    const engine = findEngineForSession(sessionId)
    if (typeof engine.getMcpStatus === 'function') {
      return (await engine.getMcpStatus(sessionId)) ?? null
    }
    return null
  }),

  getContextUsage: withLogging('getContextUsage', async (sessionId: string): Promise<Record<string, unknown> | null> => {
    const engine = findEngineForSession(sessionId)
    if (typeof engine.getContextUsage === 'function') {
      return (await engine.getContextUsage(sessionId)) ?? null
    }
    return null
  }),

  getSettings: withLogging('getSettings', async (sessionId: string): Promise<Record<string, unknown> | null> => {
    const engine = findEngineForSession(sessionId)
    if (typeof engine.getSettings === 'function') {
      return (await engine.getSettings(sessionId)) ?? null
    }
    return null
  }),

  stopEngineTask: withLogging('stopEngineTask', async (sessionId: string, taskId: string): Promise<void> => {
    const engine = findEngineForSession(sessionId)
    const fn = requireAction<(sid: string, tid: string) => Promise<void>>(engine, 'stopEngineTask')
    await fn(sessionId, taskId)
  }),

  getPendingPermissionRequestIds: withLogging('getPendingPermissionRequestIds', (sessionId: string): string[] => {
    const engine = findEngineForSession(sessionId)
    if (typeof engine.getPendingPermissionRequestIds === 'function') {
      return engine.getPendingPermissionRequestIds(sessionId)
    }
    return []
  }),
}
