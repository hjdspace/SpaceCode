import type { BrowserWindow } from 'electron'
import type { EngineType, IEngine } from './types'
import { ClaudeCodeEngine } from './ClaudeCodeEngine'
import { PiEngine } from './PiEngine'
import { info, warn } from '../logger'

export class EngineFactory {
  private static engines: Map<EngineType, IEngine> = new Map()
  private static mainWindow: BrowserWindow | null = null

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
          if (!PiEngine.isAvailable()) {
            warn('EngineFactory', 'pi-coding-agent SDK is not installed. The Pi engine will fail on session start.')
          }
          this.engines.set(type, new PiEngine())
          break
        default:
          throw new Error(`Unknown engine type: ${type}`)
      }
      info('EngineFactory', `Created engine instance | type=${type}`)
      if (this.mainWindow) {
        this.engines.get(type)!.setMainWindow(this.mainWindow)
      }
    }
    return this.engines.get(type)!
  }

  static getAllEngines(): IEngine[] {
    return Array.from(this.engines.values())
  }

  static isEngineAvailable(type: EngineType): boolean {
    if (type === 'pi') return PiEngine.isAvailable()
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
