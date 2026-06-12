import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import type { IEngine, EngineType, EngineSessionConfig, EngineSessionStatus, AgentInfo, ImageAttachment } from './types'
import { PiProcessPool } from './PiProcessPool'
import { info, warn, error } from '../logger'

export class PiEngine implements IEngine {
  readonly type: EngineType = 'pi'

  private pool: PiProcessPool
  private _mainWindow: BrowserWindow | null = null

  constructor() {
    this.pool = new PiProcessPool()
  }

  setMainWindow(window: BrowserWindow): void {
    this._mainWindow = window
    this.pool.setMainWindow(window)
    info('PiEngine', 'Main window set')
  }

  async startSession(sessionId: string, config: EngineSessionConfig): Promise<void> {
    info('PiEngine', `startSession | sessionId=${sessionId.slice(0, 8)} | cwd=${config.cwd} | provider=${config.provider} | model=${config.model}`)

    const existingStatus = this.pool.getSessionStatus(sessionId)
    if (existingStatus?.isRunning) {
      info('PiEngine', `[${sessionId.slice(0, 8)}] Session already active, reusing`)
      return
    }

    try {
      await this.pool.startSession(sessionId, config)
      const status = this.pool.getSessionStatus(sessionId)
      info('PiEngine', `[${sessionId.slice(0, 8)}] Session started | status=${status?.status}`)
    } catch (err) {
      error('PiEngine', `[${sessionId.slice(0, 8)}] Failed to start session`, err)
      throw err
    }
  }

  async sendMessage(sessionId: string, content: string, images?: ImageAttachment[]): Promise<void> {
    info('PiEngine', `sendMessage | sessionId=${sessionId.slice(0, 8)} | contentLen=${content.length} | images=${images?.length || 0}`)

    try {
      await this.pool.sendMessage(sessionId, content, images)
    } catch (err) {
      error('PiEngine', `sendMessage failed | sessionId=${sessionId.slice(0, 8)}`, err)
      throw err
    }
  }

  async updateThinkingLevel(sessionId: string, enabled: boolean): Promise<void> {
    const proc = this.pool.getProcess(sessionId)
    if (!proc) {
      warn('PiEngine', `updateThinkingLevel: session not found | sessionId=${sessionId.slice(0, 8)}`)
      return
    }

    info('PiEngine', `updateThinkingLevel | sessionId=${sessionId.slice(0, 8)} | enabled=${enabled}`)

    try {
      await proc.setThinkingLevel(enabled ? 'medium' : 'off')
    } catch (err) {
      error('PiEngine', `updateThinkingLevel failed | sessionId=${sessionId.slice(0, 8)}`, err)
      throw err
    }
  }

  async abort(sessionId: string): Promise<void> {
    info('PiEngine', `abort | sessionId=${sessionId.slice(0, 8)}`)
    this.pool.abortSession(sessionId)
  }

  async stop(sessionId: string): Promise<void> {
    info('PiEngine', `stop | sessionId=${sessionId.slice(0, 8)}`)
    this.pool.killSession(sessionId)
  }

  suspendSession(sessionId: string): void {
    info('PiEngine', `suspendSession | sessionId=${sessionId.slice(0, 8)}`)
    this.pool.suspendSession(sessionId)
  }

  async resumeSession(sessionId: string): Promise<void> {
    info('PiEngine', `resumeSession | sessionId=${sessionId.slice(0, 8)}`)
    await this.pool.resumeSession(sessionId)
  }

  getSessionStatus(sessionId: string): EngineSessionStatus | null {
    return this.pool.getSessionStatus(sessionId)
  }

  getActiveSessions(): EngineSessionStatus[] {
    return this.pool.getActiveSessions()
  }

  async listAgents(cwd?: string): Promise<AgentInfo[]> {
    return [
      {
        agentType: 'general-purpose',
        description: 'Pi coding agent - full-featured coding assistant with compaction, extensions, and multi-provider support',
        source: 'built-in',
      },
    ]
  }

  /**
   * Collect all candidate paths where pi-coding-agent CLI might be found.
   * Uses multiple strategies: __dirname-relative, app-path-relative, local pi-engine.
   */
  private static getCliCandidatePaths(): string[] {
    const paths: string[] = []

    // Strategy 1: __dirname-relative (works in both dev and packaged modes)
    // In dev: __dirname = dist-electron/ → ../../ = project root
    // In packaged: __dirname = app.asar/dist-electron/ → ../../ = app root
    paths.push(
      path.resolve(__dirname, '../../node_modules/@mariozechner/pi-coding-agent/dist/cli.js'),
      path.resolve(__dirname, '../../../node_modules/@mariozechner/pi-coding-agent/dist/cli.js'),
    )

    // Strategy 2: app.getAppPath()-relative (reliable in Electron dev mode)
    try {
      const appPath = app.getAppPath()
      // appPath in dev = project root, in packaged = app.asar
      const appRoot = appPath.endsWith('.asar') ? path.dirname(appPath) : appPath
      paths.push(
        path.join(appRoot, 'node_modules/@mariozechner/pi-coding-agent/dist/cli.js'),
      )
    } catch {
      // app might not be ready yet
    }

    // Strategy 3: process.cwd()-relative (fallback for unusual setups)
    paths.push(
      path.join(process.cwd(), 'node_modules/@mariozechner/pi-coding-agent/dist/cli.js'),
    )

    // Strategy 4: Local pi-engine monorepo (sibling directory)
    try {
      const appPath = app.getAppPath()
      const appRoot = appPath.endsWith('.asar') ? path.dirname(appPath) : appPath
      paths.push(
        path.join(appRoot, 'pi-engine/packages/coding-agent/dist/cli.js'),
      )
    } catch {
      // ignore
    }

    // Strategy 5: Packaged app resources
    paths.push(
      path.join(process.resourcesPath || '', 'node_modules/@mariozechner/pi-coding-agent/dist/cli.js'),
      path.join(process.resourcesPath || '', 'pi-engine/dist/cli.js'),
    )

    return paths
  }

  /**
   * Check if we have a runtime (bun or ELECTRON_RUN_AS_NODE) available to execute
   * the Pi CLI. Since PiSessionProcess now uses bundled bun or process.execPath
   * with ELECTRON_RUN_AS_NODE, the SDK is considered available as long as cli.js
   * exists on disk — we no longer depend on a system-installed `node`.
   */
  static async isAvailableAsync(): Promise<boolean> {
    const candidatePaths = PiEngine.getCliCandidatePaths()

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          info('PiEngine', `pi-coding-agent found at ${p}`)
          return true
        }
      } catch {
        // ignore
      }
    }

    // Strategy 6: Check if `pi` CLI is available globally
    // Verify the actual path exists (where/which can return stale entries)
    try {
      const { execSync } = await import('child_process')
      const cmd = process.platform === 'win32' ? 'where pi' : 'which pi'
      const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim()
      const piPath = output.split(/\r?\n/)[0]?.trim()
      if (piPath && fs.existsSync(piPath)) {
        info('PiEngine', `pi-coding-agent found via global 'pi' command: ${piPath}`)
        return true
      }
    } catch {
      // pi not available globally
    }

    warn('PiEngine', 'pi-coding-agent SDK not found in any known location')
    return false
  }

  static isAvailable(): boolean {
    const candidatePaths = PiEngine.getCliCandidatePaths()

    for (const p of candidatePaths) {
      try {
        if (fs.existsSync(p)) {
          info('PiEngine', `pi-coding-agent found at ${p}`)
          return true
        }
      } catch {
        // ignore
      }
    }

    // Check if `pi` CLI is available globally
    // Verify the actual path exists (where/which can return stale entries)
    try {
      const { execSync } = require('child_process')
      const cmd = process.platform === 'win32' ? 'where pi' : 'which pi'
      const output = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }).trim()
      const piPath = output.split(/\r?\n/)[0]?.trim()
      if (piPath && fs.existsSync(piPath)) {
        info('PiEngine', `pi-coding-agent found via global 'pi' command: ${piPath}`)
        return true
      }
    } catch {
      // pi not available globally
    }

    warn('PiEngine', 'pi-coding-agent SDK not found in any known location')
    return false
  }
}
