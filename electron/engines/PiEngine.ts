import type { BrowserWindow } from 'electron'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, AgentInfo } from './types'
import { info } from '../logger'

export class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'
  private mainWindow: BrowserWindow | null = null

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    info('PiEngine', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd}`)
    throw new Error('PiEngine not yet implemented')
  }

  async sendMessage(sessionId: string, content: string): Promise<void> {
    throw new Error('PiEngine not yet implemented')
  }

  async abort(sessionId: string): Promise<void> {
    throw new Error('PiEngine not yet implemented')
  }

  async stop(sessionId: string): Promise<void> {
    throw new Error('PiEngine not yet implemented')
  }

  getSessionStatus(sessionId: string): EngineSessionStatus | null {
    return null
  }

  getActiveSessions(): EngineSessionStatus[] {
    return []
  }

  async listAgents(cwd?: string): Promise<AgentInfo[]> {
    return []
  }
}
