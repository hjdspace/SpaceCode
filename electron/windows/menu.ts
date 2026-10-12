/**
 * Application menu bar configuration.
 */
import { Menu, dialog, app } from 'electron'
import { isDebugMode } from '../infra/logger'
import { getMainWindow } from './mainWindow'

export function createMenu(): void {
  const debugMode = isDebugMode()

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => getMainWindow()?.webContents.send('menu:newChat') },
        { type: 'separator' },
        {
          label: 'Open Folder...',
          accelerator: 'Ctrl+K Ctrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(getMainWindow()!, {
              properties: ['openDirectory'],
              title: 'Open Folder'
            })
            if (!result.canceled && result.filePaths.length > 0) {
              getMainWindow()?.webContents.send('menu:openFolder', result.filePaths[0])
            }
          }
        },
        { type: 'separator' },
        { label: 'Close Folder', click: () => getMainWindow()?.webContents.send('menu:closeFolder') },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(!app.isPackaged || debugMode ? [
          { type: 'separator' as const },
          { role: 'toggleDevTools' as const }
        ] : [])
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
