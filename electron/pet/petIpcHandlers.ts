// electron/petIpcHandlers.ts
// 宠物 IPC handlers。对齐 cc-haha 通道命名风格，移除旧的 LLM 反应/资源管理通道。
import { ipcMain, BrowserWindow } from 'electron'
import { info, warn } from './logger'
import { PetFileService } from './petFileService'
import { PetWindowController } from './petWindowManager'
import type {
  PetConfig,
  PetPreferences,
  PetSyncPayload,
  PetWindowEvent,
} from '../src/types/pet'

export interface PetIpcDeps {
  petFileService: PetFileService
  petWindowManager: PetWindowController
  getMainWindow: () => BrowserWindow | null
  getLocale: () => 'zh-CN' | 'en-US'
}

/** 显示并聚焦主窗口（会话跳转/点击宠物时调用） */
function showMainWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function registerPetIpcHandlers(deps: PetIpcDeps): void {
  info('PetIpcHandlers', 'Registering pet IPC handlers')

  // ── 配置读写 ──

  ipcMain.handle('pet:readConfig', async () => {
    return await deps.petFileService.read()
  })

  ipcMain.handle('pet:writeConfig', async (_e, config: PetConfig) => {
    await deps.petFileService.write(config)
    deps.petWindowManager.setConfig(config)
  })

  // ── 桌面窗口控制 ──

  ipcMain.handle('pet:createDesktopWindow', async () => {
    const config = deps.petFileService.getCachedConfig()
    if (!config) {
      warn('PetIpcHandlers', 'No cached config, cannot create desktop window')
      return
    }
    await deps.petWindowManager.create(config)
    // 通知主应用宠物窗口已可见
    deps
      .getMainWindow()
      ?.webContents.send('petMainWindow:event', { type: 'visibilityChanged', visible: true })
  })

  ipcMain.handle('pet:destroyDesktopWindow', async () => {
    await deps.petWindowManager.destroy()
    deps
      .getMainWindow()
      ?.webContents.send('petMainWindow:event', { type: 'visibilityChanged', visible: false })
  })

  // ── 状态同步（主应用 → 宠物窗口） ──

  ipcMain.on('pet:syncPetState', (_e, payload: PetSyncPayload) => {
    deps.petWindowManager.syncPetState(payload)
  })

  // ── 偏好变更（主应用 → 主进程，转发给宠物窗口） ──

  ipcMain.on('pet:preferencesChanged', (_e, patch: Partial<PetPreferences>) => {
    deps.petWindowManager.syncPreferences(patch)
  })

  // ── 宠物窗口事件（宠物窗口 → 主进程） ──

  ipcMain.on('petWindow:event', (_e, event: PetWindowEvent) => {
    void handlePetWindowEvent(event, deps)
  })

  // ── 宠物窗口专用 invoke ──

  ipcMain.handle('petWindow:getInitialState', () => {
    // 宠物窗口 mount 完成后来拉初始状态。此时主应用的首次 syncPetState 可能
    // 在窗口 listener 注册前就已发送（时序竞态），状态丢失导致 state.pet 为 null。
    // 这里通知主应用立即重新推送一次完整状态，确保窗口收到。
    deps
      .getMainWindow()
      ?.webContents.send('pet:resyncRequest')
    return null
  })

  ipcMain.handle('petWindow:getLocale', () => {
    return deps.getLocale()
  })

  ipcMain.handle('petWindow:close', async () => {
    await deps.petWindowManager.destroy()
    // 通知主应用更新偏好 enabled=false（关闭宠物开关）
    deps
      .getMainWindow()
      ?.webContents.send('pet:preferencesChanged', { enabled: false } satisfies Partial<PetPreferences>)
  })
}

async function handlePetWindowEvent(event: PetWindowEvent, deps: PetIpcDeps): Promise<void> {
  switch (event.type) {
    case 'drag':
      deps.petWindowManager.handleDrag(event)
      // drag-end 时把最终位置持久化
      if (event.phase === 'end') {
        const config = deps.petWindowManager.getConfig()
        if (config) await deps.petFileService.write(config)
      }
      return

    case 'click':
      // 点击宠物 → 显示主窗口
      showMainWindow(deps.getMainWindow())
      return

    case 'contextMenu': {
      // 右键 → 原生菜单，点击关闭则销毁窗口并通知主应用
      const shouldClose = await deps.petWindowManager.showContextMenu(deps.getLocale())
      if (shouldClose) {
        await deps.petWindowManager.destroy()
        deps
          .getMainWindow()
          ?.webContents.send('pet:preferencesChanged', { enabled: false } satisfies Partial<PetPreferences>)
      }
      return
    }

    case 'focusMain':
      showMainWindow(deps.getMainWindow())
      return

    case 'focusSession': {
      // 会话跳转：显示主窗口 + 通知主应用切换会话
      showMainWindow(deps.getMainWindow())
      deps
        .getMainWindow()
        ?.webContents.send('petMainWindow:navigateSession', event.sessionId)
      return
    }

    case 'setIgnoreMouseEvents':
      deps.petWindowManager.setIgnoreMouseEvents(event.ignore)
      return

    case 'setInteractiveRegions':
      deps.petWindowManager.setInteractiveRegions(event.regions)
      return

    case 'panelPlacementChanged':
      // 渲染进程主动报告 placement 变更，更新 config 并持久化
      deps.petWindowManager.updatePanelPlacement(event.placement)
      {
        const config = deps.petWindowManager.getConfig()
        if (config) await deps.petFileService.write(config)
      }
      return

    case 'preferencesChanged': {
      // 宠物窗口偏好变更 → 合并到 config + 持久化 + 转发给主应用
      const patch = event.preferences
      deps.petWindowManager.syncPreferences(patch)
      const config = deps.petWindowManager.getConfig()
      if (config) await deps.petFileService.write(config)
      deps.getMainWindow()?.webContents.send('pet:preferencesChanged', patch)
      return
    }

    default: {
      // 穷尽检查：新增事件类型未处理时编译报错
      const _exhaustive: never = event
      void _exhaustive
      return
    }
  }
}
