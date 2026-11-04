/**
 * Super Agent IPC 入口（T01 #71、T13 #83、T05 #75）：把 shared 定义的命令挂到 ipcMain 上。
 * 只做入口校验与转发；领域规则在 service。
 *
 * T13：
 *  - 注册 health 只读通道；
 *  - 健康变化经 health.changed 事件广播到所有窗口（窗口刷新不中断主进程状态）；
 *  - 命令抛出的未知错误码经 noteError 计入健康后再原样抛出，
 *    校验错误（缺 repoRoot）不计入健康，避免刷屏。
 *
 * T05：
 *  - 注册 dispatch（显式派工）与 queue（队列只读拉取）通道；
 *  - 队列变化经 queue-changed 事件广播到所有窗口，Renderer 无需轮询。
 *
 * T07 #77：
 *  - 注册 workerBind / workerUnbind（Worker 只读镜像）通道；
 *  - workerBind 幂等返回稳定 sessionId 与代次分段快照，workerUnbind 只停镜像。
 *
 * T06 #76：
 *  - 注册 tickets（全量卡片看板只读拉取）通道；
 *  - 卡片投影经 ticket-updated / ticket-progress 事件广播到所有窗口；
 *    ticket.updated 携带领域 seq 水位，Renderer 断档时全量重拉 tickets。
 */
import { BrowserWindow, ipcMain } from 'electron'
import { eventChannels } from '@/shared/channelMap'
import { registerHandlers } from '@/shared/handlerRegistry'
import {
  SUPER_AGENT_PREFIX,
  superAgentNamespace,
  type SuperAgentDispatchCommand,
  type SuperAgentHealthReport,
  type SuperAgentQueueSnapshot,
  type SuperAgentTicketProgress,
  type SuperAgentTicketUpdateEvent,
} from '@/shared/channels/superAgent'
import { createSuperAgentService, type SuperAgentService } from './service'

const SUPER_AGENT_EVENTS = eventChannels(superAgentNamespace.events, SUPER_AGENT_PREFIX)

function requireRepoRoot(repoRoot: unknown): string {
  if (typeof repoRoot !== 'string' || repoRoot.trim() === '') {
    throw new Error('repoRoot is required')
  }
  return repoRoot
}

/** Worker 镜像命令入口校验：ticketId 必须是非空字符串。 */
function requireTicketId(ticketId: unknown): string {
  if (typeof ticketId !== 'string' || ticketId.trim() === '') {
    throw new Error('ticketId is required')
  }
  return ticketId
}

/** 派工命令入口校验：requestId/title/text 必须是非空字符串（领域层兜底同样校验）。 */
function requireDispatchCommand(input: unknown): SuperAgentDispatchCommand {
  if (typeof input !== 'object' || input === null) {
    throw new Error('dispatch command is required')
  }
  const command = input as Record<string, unknown>
  if (
    typeof command.requestId !== 'string' ||
    command.requestId.trim() === '' ||
    typeof command.title !== 'string' ||
    typeof command.text !== 'string'
  ) {
    throw new Error('invalid dispatch command')
  }
  return input as SuperAgentDispatchCommand
}

/** health.changed 广播：所有未销毁窗口都能收到，Renderer 无需轮询。 */
function broadcastHealthChanged(repoRoot: string, report: SuperAgentHealthReport): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(SUPER_AGENT_EVENTS.onHealthChanged, repoRoot, report)
    }
  }
}

/** queue-changed 广播：队列现状对所有窗口可见（后到的工单排队与否一目了然）。 */
function broadcastQueueChanged(repoRoot: string, snapshot: SuperAgentQueueSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(SUPER_AGENT_EVENTS.onQueueChanged, repoRoot, snapshot)
    }
  }
}

/** ticket-updated 广播：领域事实变化即时推卡片（含 fromSeq/toSeq 水位）。 */
function broadcastTicketUpdated(repoRoot: string, event: SuperAgentTicketUpdateEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(SUPER_AGENT_EVENTS.onTicketUpdated, repoRoot, event)
    }
  }
}

/** ticket-progress 广播：1 秒节流后的轻量进度，所有窗口可见。 */
function broadcastTicketProgress(repoRoot: string, progress: SuperAgentTicketProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(SUPER_AGENT_EVENTS.onTicketProgress, repoRoot, progress)
    }
  }
}

/** 创建接好 health.changed / queue-changed 广播的服务；独立导出以便测试广播链路。 */
export function createBroadcastingSuperAgentService(): SuperAgentService {
  return createSuperAgentService({
    onHealthChanged: broadcastHealthChanged,
    onQueueChanged: broadcastQueueChanged,
    onTicketUpdated: broadcastTicketUpdated,
    onTicketProgress: broadcastTicketProgress,
  })
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
    dispatch: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireDispatchCommand(command)
      return runNoted(service, root, () => service.dispatch(root, req))
    },
    queue: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.queue(root))
    },
    tickets: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.tickets(root))
    },
    workerBind: (repoRoot: unknown, ticketId: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const ticket = requireTicketId(ticketId)
      return runNoted(service, root, () => service.workerBind(root, ticket))
    },
    workerUnbind: (repoRoot: unknown, ticketId: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const ticket = requireTicketId(ticketId)
      return runNoted(service, root, () => service.workerUnbind(root, ticket))
    },
  })
}
