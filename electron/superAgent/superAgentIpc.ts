/**
 * Super Agent IPC 入口（T01 #71、T13 #83）：把 shared 定义的命令挂到 ipcMain 上。
 * 只做入口校验与转发；领域规则在 service。
 *
 * T13：
 *  - 注册 health 只读通道；
 *  - 健康变化经 health.changed 事件广播到所有窗口（窗口刷新不中断主进程状态）；
 *  - 命令抛出的未知错误码经 noteError 计入健康后再原样抛出，
 *    校验错误（缺 repoRoot）不计入健康，避免刷屏。
 */
import { BrowserWindow, ipcMain } from 'electron'
import { eventChannels } from '@/shared/channelMap'
import { registerHandlers } from '@/shared/handlerRegistry'
import {
  SUPER_AGENT_PREFIX,
  superAgentNamespace,
  type SuperAgentHealthReport,
} from '@/shared/channels/superAgent'
import { createSuperAgentService, type SuperAgentService } from './service'

const SUPER_AGENT_EVENTS = eventChannels(superAgentNamespace.events, SUPER_AGENT_PREFIX)

function requireRepoRoot(repoRoot: unknown): string {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') {
    throw new Error('repoRoot is required')
  }
  return repoRoot
}

/** health.changed 广播：所有未销毁窗口都能收到，Renderer 无需轮询。 */
function broadcastHealthChanged(repoRoot: string, report: SuperAgentHealthReport): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(SUPER_AGENT_EVENTS.onHealthChanged, repoRoot, report)
    }
  }
}

/** 创建接好 health.changed 广播的服务；独立导出以便测试广播链路。 */
export function createBroadcastingSuperAgentService(): SuperAgentService {
  return createSuperAgentService({ onHealthChanged: broadcastHealthChanged })
}

/**
 * 命令抛错先经 noteError（未知 code 计入健康）再原样抛出；
 * handlerRegistry 仍负责日志，Renderer 收到的错误语义不变。
 */
function runNoted<T>(service: SuperAgentService, repoRoot: string, run: () => T): T {
  try {
    return run()
  } catch (err) {
    service.noteError(repoRoot, err)
    throw err
  }
}

export function registerSuperAgentIPCHandlers(
  service: SuperAgentService = createBroadcastingSuperAgentService(),
): void {
  registerHandlers(ipcMain, superAgentNamespace.channels, SUPER_AGENT_PREFIX, {
    state: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.state(root))
    },
    routerBind: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.routerBind(root))
    },
    health: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.health(root))
    },
  })
}
