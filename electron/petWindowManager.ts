// electron/petWindowManager.ts
import { BrowserWindow } from 'electron'
import { join } from 'path'
import { info, warn } from './logger'
import type { PetConfig, PetSyncPayload, PetWindowEvent } from '../src/types/pet'

export class PetWindowManager {
  private window: BrowserWindow | null = null
  private config: PetConfig | null = null

  async create(config: PetConfig): Promise<void> {
    if (this.window) {
      warn('PetWindowManager', 'Window already exists')
      return
    }

    this.config = config
    const { desktopWindow, settings } = config

    this.window = new BrowserWindow({
      x: desktopWindow.x,
      y: desktopWindow.y,
      width: desktopWindow.width,
      height: desktopWindow.height,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: settings.alwaysOnTopDesktop,
      skipTaskbar: true,
      hasShadow: false,
      focusable: !settings.clickThrough,
      webPreferences: {
        preload: join(__dirname, 'petPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      }
    })

    this.window.setIgnoreMouseEvents(settings.clickThrough)

    if (process.env.NODE_ENV === 'development') {
      await this.window.loadURL('http://127.0.0.1:5173/pet-window.html')
    } else {
      await this.window.loadFile(join(__dirname, '../dist/pet-window.html'))
    }

    this.window.on('closed', () => {
      this.window = null
      info('PetWindowManager', 'Window closed')
    })

    info('PetWindowManager', 'Window created')
  }

  async destroy(): Promise<void> {
    if (this.window) {
      this.window.close()
      this.window = null
    }
  }

  async updateBounds(bounds: { x: number; y: number; width: number; height: number }): Promise<void> {
    this.window?.setBounds(bounds)
  }

  syncPetState(state: PetSyncPayload): void {
    if (!this.window) return
    this.window.webContents.send('petWindow:stateUpdate', state)
  }

  setIgnoreMouseEvents(ignore: boolean): void {
    this.window?.setIgnoreMouseEvents(ignore)
  }

  setAlwaysOnTop(onTop: boolean): void {
    this.window?.setAlwaysOnTop(onTop)
  }

  handleWindowEvent(event: PetWindowEvent): void {
    if (!this.window || !this.config) return

    if (event.type === 'drag') {
      const [x, y] = this.window.getPosition()
      this.window.setPosition(x + event.deltaX, y + event.deltaY)
    } else if (event.type === 'drag-end') {
      const [x, y] = this.window.getPosition()
      this.config.desktopWindow.x = x
      this.config.desktopWindow.y = y
    }
  }

  isAlive(): boolean {
    return this.window !== null
  }
}
