/**
 * System tray creation and destruction.
 */
import { Tray, Menu, nativeImage, app } from 'electron'
import { debug, warn, error } from '../infra/logger'
import { existsSync } from 'fs'
import { getIconPath, loadIconImage } from './iconUtils'
import { getMainWindow, showMainWindow } from './mainWindow'

let tray: Tray | null = null

export function createTray(): void {
  const iconPath = getIconPath()

  debug('Tray', `Loading icon from: ${iconPath} | exists: ${existsSync(iconPath)}`)

  let icon: Electron.NativeImage

  try {
    icon = loadIconImage()
    if (!icon.isEmpty()) {
      const trayIconSize = process.platform === 'darwin' ? 18 : 16
      icon = icon.resize({ width: trayIconSize, height: trayIconSize })
      debug('Tray', `Icon loaded and resized to ${trayIconSize}x${trayIconSize}`)
    } else {
      warn('Tray', 'Icon is empty after loadIconImage() — tray will show default icon')
    }
  } catch (err) {
    error('Tray', 'Error loading icon', err)
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show SpaceCode', click: () => { showMainWindow() } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setToolTip('SpaceCode')
  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    showMainWindow()
  })
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
