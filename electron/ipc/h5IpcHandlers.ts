/**
 * H5 WebUI Server IPC handlers.
 *
 * Manages H5 server lifecycle and access settings via ipcMain.
 */
import { ipcMain } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { info } from '../infra/logger'
import { H5Server } from '../h5/h5Server'
import { H5AuthService } from '../h5/h5AuthService'
import type { H5ServerStatus, H5AccessSettings } from '../h5/h5Types'

let h5Server: H5Server | null = null

/** 桌面端最近打开过的项目 — 可信根的唯一来源，服务器实例更换时重放。 */
let lastKnownProjectPath: string | null = null

function applyProjectRoot(server: H5Server | null): void {
  if (server) server.registerProjectRoot(lastKnownProjectPath)
}

export function getH5Server(): H5Server | null {
  return h5Server
}

export function setH5Server(server: H5Server | null): void {
  h5Server = server
  applyProjectRoot(server)
}

export function getH5AuthService(): H5AuthService {
  return h5AuthService
}

// Singleton — created at module load time to match original main.ts behavior
const h5AuthService = new H5AuthService()

export function registerH5AccessIPCHandlers(): void {
  ipcMain.handle('h5:enable', async (): Promise<{ status: H5ServerStatus; token: string }> => {
    const { settings, token } = h5AuthService.enable()
    if (!h5Server) {
      h5Server = new H5Server(h5AuthService)
    }
    applyProjectRoot(h5Server)
    const status = await h5Server.start(settings.fixedPort ?? undefined)
    info('H5Access', `H5 server enabled | port=${status.port} | ip=${status.ip} | url=${status.publicUrl}`)
    return { status, token }
  })

  ipcMain.handle('h5:disable', async (): Promise<void> => {
    if (h5Server) {
      h5Server.stop()
    }
    h5AuthService.disable()
    info('H5Access', 'H5 server disabled')
  })

  ipcMain.handle('h5:regenerateToken', async (): Promise<{ status: H5ServerStatus; token: string }> => {
    const { settings, token } = h5AuthService.regenerateToken()
    if (h5Server) {
      h5Server.stop()
      h5Server = new H5Server(h5AuthService)
      applyProjectRoot(h5Server)
      const status = await h5Server.start(settings.fixedPort ?? undefined)
      return { status, token }
    }
    return {
      status: { running: false, port: 0, ip: '', publicUrl: null, connectedClients: 0, sandboxPort: 0, sandboxRunning: false },
      token,
    }
  })

  ipcMain.handle('h5:getStatus', (): H5ServerStatus => {
    if (h5Server) return h5Server.getStatus()
    return { running: false, port: 0, ip: '', publicUrl: null, connectedClients: 0, sandboxPort: 0, sandboxRunning: false }
  })

  ipcMain.handle('h5:getSettings', (): H5AccessSettings => {
    return h5AuthService.getSettings()
  })

  ipcMain.handle(
    'h5:updateSettings',
    async (_, input: Partial<Pick<H5AccessSettings, 'publicBaseUrl' | 'fixedPort' | 'sandboxPort'>>) => {
      return h5AuthService.updateSettings(input)
    },
  )

  ipcMain.handle('h5:setMirrorSession', (_, sessionId: string | null, projectPath: string | null) => {
    if (projectPath) lastKnownProjectPath = projectPath
    if (h5Server) {
      h5Server.setMirrorSession(sessionId, projectPath)
      applyProjectRoot(h5Server)
    }
  })

  ipcMain.handle('h5:checkBuild', (): { built: boolean; path: string } => {
    const distRoot = join(__dirname, '..', 'dist')
    const indexPath = join(distRoot, 'index.html')
    return { built: existsSync(indexPath), path: distRoot }
  })
}
