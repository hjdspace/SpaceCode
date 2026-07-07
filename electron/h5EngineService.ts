// electron/h5EngineService.ts
// 引擎调用封装 — H5 Server 通过此模块直接访问引擎，不经过渲染进程中继

import { EngineFactory } from './engines/EngineFactory'
import type { IEngine, EngineSessionConfig, ImageAttachment, PermissionDecision, PermissionMode } from './engines/types'
import { SessionHistoryManager } from './sessionHistoryManager'
import { info, warn } from './logger'

/** 查找拥有指定 session 活跃进程的引擎（复制自 claudeCodeIPC.ts 的 findEngineForSession） */
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

export const h5EngineService = {
  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    const engineType = config.engineType || 'claude-code'
    const engine = EngineFactory.getEngine(engineType)
    await engine.startSession(sessionId, config)
  },

  async sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    const engine = findEngineForSession(sessionId)
    await engine.sendMessage(sessionId, content, images)
  },

  async abort(sessionId: string): Promise<void> {
    const engine = findEngineForSession(sessionId)
    await engine.abort(sessionId)
  },

  async stop(sessionId: string): Promise<void> {
    const engine = findEngineForSession(sessionId)
    await engine.stop(sessionId)
  },

  async submitToolAnswer(sessionId: string, toolCallId: string, answers: Record<string, string>): Promise<void> {
    const engine = findEngineForSession(sessionId)
    if (typeof engine.submitToolAnswer === 'function') {
      await engine.submitToolAnswer(sessionId, toolCallId, answers)
    } else {
      warn('H5EngineService', `submitToolAnswer not implemented in engine=${engine.type}`)
    }
  },

  async skipToolAnswer(sessionId: string, toolCallId: string): Promise<void> {
    const engine = findEngineForSession(sessionId)
    if (typeof engine.skipToolAnswer === 'function') {
      await engine.skipToolAnswer(sessionId, toolCallId)
    } else {
      warn('H5EngineService', `skipToolAnswer not implemented in engine=${engine.type}`)
    }
  },

  async allowPermission(
    sessionId: string,
    requestId: string,
    updatedInput?: Record<string, unknown>,
    decisionClassification?: 'user_temporary' | 'user_permanent',
  ): Promise<void> {
    const engine = findEngineForSession(sessionId)
    if (typeof engine.allowPermission === 'function') {
      await engine.allowPermission(sessionId, requestId, updatedInput, decisionClassification)
    } else {
      warn('H5EngineService', `allowPermission not implemented in engine=${engine.type}`)
    }
  },

  async denyPermission(
    sessionId: string,
    requestId: string,
    message: string = 'User denied',
    options?: { interrupt?: boolean },
  ): Promise<void> {
    const engine = findEngineForSession(sessionId)
    if (typeof engine.denyPermission === 'function') {
      await engine.denyPermission(sessionId, requestId, message, options)
    } else {
      warn('H5EngineService', `denyPermission not implemented in engine=${engine.type}`)
    }
  },

  async setPermissionMode(sessionId: string, mode: PermissionMode): Promise<void> {
    const engine = findEngineForSession(sessionId)
    if (typeof engine.setPermissionMode === 'function') {
      await engine.setPermissionMode(sessionId, mode)
    }
  },

  getSessionStatus(sessionId: string) {
    return findEngineForSession(sessionId).getSessionStatus(sessionId)
  },

  getActiveSessions() {
    const all = []
    for (const engine of EngineFactory.getAllEngines()) {
      all.push(...engine.getActiveSessions())
    }
    return all
  },

  async listProjectSessions(cwd: string) {
    const sessions = await SessionHistoryManager.listProjectSessions(cwd)
    return sessions.map((s: any) => ({
      ...s,
      title: SessionHistoryManager.getSessionTitle(s),
      displayTime: SessionHistoryManager.formatTimestamp(s.lastMessageTimestamp),
    }))
  },

  async restoreSession(projectPath: string, sessionId: string) {
    return await SessionHistoryManager.getFullSession(projectPath, sessionId)
  },

  /** 注册引擎事件路由监听器（仅 ClaudeCodeEngine 支持） */
  onRouteEvent(listener: (sessionId: string, eventType: string, data: any) => void): () => void {
    const unsubs: Array<() => void> = []
    for (const engine of EngineFactory.getAllEngines()) {
      if ('onRouteEvent' in engine && typeof (engine as any).onRouteEvent === 'function') {
        unsubs.push((engine as any).onRouteEvent(listener))
      }
    }
    // 也监听未来创建的引擎
    // (EngineFactory 按需创建，主进程启动后通常都已创建)
    return () => unsubs.forEach(fn => fn())
  },
}
