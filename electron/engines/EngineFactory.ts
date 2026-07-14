import type { BrowserWindow } from 'electron'
import type { EngineType, IEngine } from './types'
import { ClaudeCodeEngine } from './ClaudeCodeEngine'
import { PiEngine } from './PiEngine'
import { info, warn } from '../logger'

export class EngineFactory {
  private static engines: Map<EngineType, IEngine> = new Map()
  private static mainWindow: BrowserWindow | null = null
  private static engineCreatedListeners: Set<(engine: IEngine) => void> = new Set()

  static setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
    for (const engine of this.engines.values()) {
      engine.setMainWindow(window)
    }
  }

  static getEngine(type: EngineType): IEngine {
    if (!this.engines.has(type)) {
      switch (type) {
        case 'claude-code':
          this.engines.set(type, new ClaudeCodeEngine())
          break
        case 'pi':
          this.engines.set(type, new PiEngine())
          break
        default:
          throw new Error(`Unknown engine type: ${type}`)
      }
      info('EngineFactory', `Created engine instance | type=${type}`)
      if (this.mainWindow) {
        this.engines.get(type)!.setMainWindow(this.mainWindow)
      }
      this.notifyEngineCreated(this.engines.get(type)!)
    }
    return this.engines.get(type)!
  }

  static getAllEngines(): IEngine[] {
    return Array.from(this.engines.values())
  }

  static onEngineCreated(listener: (engine: IEngine) => void): () => void {
    this.engineCreatedListeners.add(listener)
    return () => {
      this.engineCreatedListeners.delete(listener)
    }
  }

  /**
   * 订阅所有引擎（当前 + 未来创建）的事件路由。
   * 返回取消订阅函数。
   */
  static onRouteEvent(listener: (sessionId: string, eventType: string, data: any) => void): () => void {
    const unsubs: Array<() => void> = []
    const subscribed = new WeakSet<IEngine>()

    const subscribeEngine = (engine: IEngine) => {
      if (subscribed.has(engine)) return
      subscribed.add(engine)
      if (typeof engine.onRouteEvent === 'function') {
        unsubs.push(engine.onRouteEvent(listener))
      }
    }

    for (const engine of this.engines.values()) {
      subscribeEngine(engine)
    }

    const unsubscribeEngineCreated = this.onEngineCreated(subscribeEngine)

    return () => {
      unsubscribeEngineCreated()
      unsubs.splice(0).forEach(fn => fn())
    }
  }

  private static notifyEngineCreated(engine: IEngine): void {
    for (const listener of this.engineCreatedListeners) {
      try {
        listener(engine)
      } catch {
        // Engine creation should not fail because an observer threw.
      }
    }
  }

  static isEngineAvailable(type: EngineType): boolean {
    if (type === 'pi') return PiEngine.isAvailable()
    return true
  }

  static async isEngineAvailableAsync(type: EngineType): Promise<boolean> {
    if (type === 'pi') return PiEngine.isAvailableAsync()
    return true
  }

  static killAll(): void {
    for (const engine of this.engines.values()) {
      const sessions = engine.getActiveSessions()
      for (const session of sessions) {
        engine.stop(session.sessionId).catch(() => {})
      }
    }
  }
}
