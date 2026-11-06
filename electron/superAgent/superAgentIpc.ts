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
 *
 * T09 #79：
 *  - 注册 workerTakeover / workerRelease / workerMessage（接管与交还）通道；
 *  - 接管/交还经 takeover-changed 事件广播到所有窗口，多面板不互抢；
 *    workerMessage 只做入口校验，先落库再投递的对账规则在 service。
 *
 * T08 #78：
 *  - 注册 attentions（气泡看板只读拉取）与 attentionAnswer（就地回答）通道；
 *  - Attention 变化经 attention-asked / attention-answered / attention-withdrawn
 *    事件广播到所有窗口；payload 携带全量视图，Renderer 直接应用即幂等。
 *
 * T10 #80：
 *  - 注册 ticketAccept / ticketStop / ticketMessage / ticketRetry 通道（review
 *    工单的三个显式出口 + 只对 delivery/blocked/failed 开放的重试）；
 *  - review 超时提醒不新增事件：水位随既有 ticket-updated 卡片广播，
 *    徽章/状态条按去重后的工单数计（snapshot.review.reminded）。
 */
import { BrowserWindow, ipcMain } from 'electron'
import { eventChannels } from '@/shared/channelMap'
import { registerHandlers } from '@/shared/handlerRegistry'
import {
  SUPER_AGENT_PREFIX,
  superAgentNamespace,
  type SuperAgentAttentionAnswerCommand,
  type SuperAgentAttentionEvent,
  type SuperAgentDispatchCommand,
  type SuperAgentCheckpointRollbackCommand,
  type SuperAgentEvalReevaluateCommand,
  type SuperAgentHealthReport,
  type SuperAgentProblemDismissCommand,
  type SuperAgentHealthRetryCommand,
  type SuperAgentQueueSnapshot,
  type SuperAgentRouterMessageCommand,
  type SuperAgentRouterState,
  type SuperAgentTakeoverChangedEvent,
  type SuperAgentPolicySetCommand,
  type SuperAgentTicketMessageCommand,
  type SuperAgentTicketProgress,
  type SuperAgentTicketUpdateEvent,
  type SuperAgentWorkerMessageCommand,
} from '@/shared/channels/superAgent'
import { createSuperAgentService, type SuperAgentService } from './service'
import type { SuperAgentEngineBridge } from './engineBridge'

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

/**
 * Router 对话命令入口校验（T21）：requestId 是 UI 幂等键，text 必须非空。
 * 空文本不进领域 —— 起一轮 Router 会真花钱。
 */
function requireRouterMessageCommand(input: unknown): SuperAgentRouterMessageCommand {
  if (typeof input !== 'object' || input === null) {
    throw new Error('router message command is required')
  }
  const command = input as Record<string, unknown>
  if (
    typeof command.requestId !== 'string' ||
    command.requestId.trim() === '' ||
    typeof command.text !== 'string' ||
    command.text.trim() === ''
  ) {
    throw new Error('invalid router message command')
  }
  // model 是可选的输入框选择：给了就必须是可用值，否则一路带到引擎只会变成静默回退
  if (command.model !== undefined && (typeof command.model !== 'string' || command.model.trim() === '')) {
    throw new Error('invalid router message command')
  }
  return input as SuperAgentRouterMessageCommand
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

/** 接管输入命令入口校验（T09 #79）：requestId/ticketId/text 必须是非空字符串。 */
function requireWorkerMessageCommand(input: unknown): SuperAgentWorkerMessageCommand {
  if (typeof input !== 'object' || input === null) {
    throw new Error('worker message command is required')
  }
  const command = input as Record<string, unknown>
  if (
    typeof command.requestId !== 'string' ||
    command.requestId.trim() === '' ||
    typeof command.ticketId !== 'string' ||
    command.ticketId.trim() === '' ||
    typeof command.text !== 'string' ||
    command.text.trim() === ''
  ) {
    throw new Error('invalid worker message command')
  }
  return input as SuperAgentWorkerMessageCommand
}

/**
 * 就地回答命令入口校验（T08 #78 / T23 #94）：requestId/attentionId 必须是非空字符串；
 * 问题类要求非空 text；权限类要求 decision=allow|deny，text 仅作拒绝理由。
 * 具体类型的缺省校验由 service 抛 invalidAnswer。
 */
function requireAttentionAnswerCommand(input: unknown): SuperAgentAttentionAnswerCommand {
  if (typeof input !== 'object' || input === null) {
    throw new Error('attention answer command is required')
  }
  const command = input as Record<string, unknown>
  const hasText = typeof command.text === 'string' && command.text.trim() !== ''
  const hasDecision = command.decision === 'allow' || command.decision === 'deny'
  if (
    typeof command.requestId !== 'string' ||
    command.requestId.trim() === '' ||
    typeof command.attentionId !== 'string' ||
    command.attentionId.trim() === '' ||
    (!hasText && !hasDecision) ||
    (command.decision !== undefined && !hasDecision) ||
    (command.text !== undefined && typeof command.text !== 'string')
  ) {
    throw new Error('invalid attention answer command')
  }
  return input as SuperAgentAttentionAnswerCommand
}

/** 验收/停止命令入口校验（T10 #80）：ticketId 必须是非空字符串。 */
function requireTicketActionCommand(input: unknown): { ticketId: string } {
  if (typeof input !== 'object' || input === null) {
    throw new Error('ticket action command is required')
  }
  return { ticketId: requireTicketId((input as Record<string, unknown>).ticketId) }
}

/**
 * 继续追问命令入口校验（T10 #80）：requestId/ticketId/text 必须是非空字符串
 * （领域层 invalidTicketMessage 兜底同样校验）。
 */
function requireTicketMessageCommand(input: unknown): SuperAgentTicketMessageCommand {
  if (typeof input !== 'object' || input === null) {
    throw new Error('ticket message command is required')
  }
  const command = input as Record<string, unknown>
  if (
    typeof command.requestId !== 'string' ||
    command.requestId.trim() === '' ||
    typeof command.ticketId !== 'string' ||
    command.ticketId.trim() === '' ||
    typeof command.text !== 'string' ||
    command.text.trim() === ''
  ) {
    throw new Error('invalid ticket message command')
  }
  return input as SuperAgentTicketMessageCommand
}

/** T12 #82：策略变更命令 —— mode 必填且合法；maxWorkers/confirmed 可选。 */
function requirePolicySetCommand(input: unknown): SuperAgentPolicySetCommand {
  if (typeof input !== 'object' || input === null) {
    throw new Error('policy set command is required')
  }
  const command = input as Record<string, unknown>
  if (command.mode !== 'serial' && command.mode !== 'parallel') {
    throw new Error('invalid policy set command: mode must be serial or parallel')
  }
  if (command.maxWorkers !== undefined && typeof command.maxWorkers !== 'number') {
    throw new Error('invalid policy set command: maxWorkers must be a number')
  }
  if (command.confirmed !== undefined && typeof command.confirmed !== 'boolean') {
    throw new Error('invalid policy set command: confirmed must be a boolean')
  }
  return input as SuperAgentPolicySetCommand
}

/** T12 #82：按文件回退命令 —— files 必须是非空字符串数组（逐文件语义拒绝整批回退之外的形态）。 */
function requireCheckpointRollbackCommand(input: unknown): SuperAgentCheckpointRollbackCommand {
  if (typeof input !== 'object' || input === null) {
    throw new Error('checkpoint rollback command is required')
  }
  const command = input as Record<string, unknown>
  if (
    !Array.isArray(command.files) ||
    command.files.length === 0 ||
    command.files.some((file) => typeof file !== 'string' || file.trim() === '')
  ) {
    throw new Error('invalid checkpoint rollback command: files must be a non-empty string array')
  }
  return input as SuperAgentCheckpointRollbackCommand
}

/** T20 #90：重新评估命令入口校验 —— evalId 必须是非空字符串。 */
function requireEvalReevaluateCommand(input: unknown): SuperAgentEvalReevaluateCommand {
  if (typeof input !== 'object' || input === null) {
    throw new Error('eval reevaluate command is required')
  }
  const evalId = (input as Record<string, unknown>).evalId
  if (typeof evalId !== 'string' || evalId.trim() === '') {
    throw new Error('invalid eval reevaluate command: evalId is required')
  }
  return input as SuperAgentEvalReevaluateCommand
}

/**
 * T20 #90：健康处置命令入口校验 —— category 必须是非空字符串；
 * subjectId 可选（null/缺省表示系统级问题，提供时必须是非空字符串）。
 */
function requireHealthDisposeCommand<
  T extends { category: unknown; subjectId?: unknown },
>(input: unknown, label: string): T {
  if (typeof input !== 'object' || input === null) {
    throw new Error(`${label} command is required`)
  }
  const command = input as Record<string, unknown>
  if (typeof command.category !== 'string' || command.category.trim() === '') {
    throw new Error(`invalid ${label} command: category is required`)
  }
  if (
    command.subjectId !== undefined &&
    command.subjectId !== null &&
    (typeof command.subjectId !== 'string' || command.subjectId.trim() === '')
  ) {
    throw new Error(`invalid ${label} command: subjectId must be a non-empty string`)
  }
  return input as T
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

/** takeover-changed 广播（T09 #79）：接管/交还对所有窗口可见，多面板不互抢。 */
function broadcastTakeoverChanged(repoRoot: string, event: SuperAgentTakeoverChangedEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(SUPER_AGENT_EVENTS.onTakeoverChanged, repoRoot, event)
    }
  }
}

/**
 * Attention 变化广播（T08 #78）：asked/answered/withdrawn 共用同一载荷结构
 * （全量视图 + 按工单去重的待处理数），所有窗口直接应用即幂等。
 */
function broadcastAttentionEvent(repoRoot: string, event: SuperAgentAttentionEvent): void {
  const channel =
    event.reason === 'answered'
      ? SUPER_AGENT_EVENTS.onAttentionAnswered
      : event.reason === 'withdrawn'
        ? SUPER_AGENT_EVENTS.onAttentionWithdrawn
        : SUPER_AGENT_EVENTS.onAttentionAsked
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, repoRoot, event)
    }
  }
}

/**
 * Router 轮次起止广播（T21）：载荷就是快照里的 router 投影，所有窗口直接应用
 * 即幂等 —— IM 视图的 typing/计时与 Composer 停止按钮都跟着它，不看本地 turn。
 */
function broadcastRouterStatus(repoRoot: string, router: SuperAgentRouterState): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(SUPER_AGENT_EVENTS.onRouterStatus, repoRoot, router)
    }
  }
}

/**
 * 创建接好广播的服务；独立导出以便测试广播链路。
 *
 * 引擎接缝由调用方（main.ts 的 composition root）注入：本模块刻意不在顶层
 * import engineBridge —— 那会把整条引擎链（sessionProcess → mcpConfigStore →
 * 模块级 `app.getPath`）拖进 `super-agent:*` 通道的加载路径，领域与 IPC 用例
 * 都不需要它。未注入 bridge 时没有运行时：工单如实停在排队，不假装启动。
 */
export function createBroadcastingSuperAgentService(
  options: { userDataDir?: string; bridge?: SuperAgentEngineBridge } = {},
): SuperAgentService {
  return createSuperAgentService({
    // T11 #81：提供 userDataDir 后启用每项目持久化与重启恢复
    userDataDir: options.userDataDir,
    bridge: options.bridge,
    onHealthChanged: broadcastHealthChanged,
    onRouterStatusChanged: broadcastRouterStatus,
    onQueueChanged: broadcastQueueChanged,
    onTicketUpdated: broadcastTicketUpdated,
    onTicketProgress: broadcastTicketProgress,
    onTakeoverChanged: broadcastTakeoverChanged,
    onAttentionEvent: broadcastAttentionEvent,
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
    routerMessage: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireRouterMessageCommand(command)
      return runNoted(service, root, () => service.routerMessage(root, req))
    },
    routerAbort: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.routerAbort(root))
    },
    health: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.health(root))
    },
    evalReevaluate: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireEvalReevaluateCommand(command)
      return runNoted(service, root, () => service.evalReevaluate(root, req))
    },
    problemDismiss: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireHealthDisposeCommand<SuperAgentProblemDismissCommand>(
        command,
        'problem dismiss',
      )
      return runNoted(service, root, () => service.problemDismiss(root, req))
    },
    healthRetry: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireHealthDisposeCommand<SuperAgentHealthRetryCommand>(
        command,
        'health retry',
      )
      return runNoted(service, root, () => service.healthRetry(root, req))
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
    workerTakeover: (repoRoot: unknown, ticketId: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const ticket = requireTicketId(ticketId)
      return runNoted(service, root, () => service.workerTakeover(root, ticket))
    },
    workerRelease: (repoRoot: unknown, ticketId: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const ticket = requireTicketId(ticketId)
      return runNoted(service, root, () => service.workerRelease(root, ticket))
    },
    workerMessage: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireWorkerMessageCommand(command)
      return runNoted(service, root, () => service.workerMessage(root, req))
    },
    attentions: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.attentions(root))
    },
    attentionAnswer: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireAttentionAnswerCommand(command)
      return runNoted(service, root, () => service.attentionAnswer(root, req))
    },
    ticketAccept: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireTicketActionCommand(command)
      return runNoted(service, root, () => service.ticketAccept(root, req))
    },
    ticketStop: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireTicketActionCommand(command)
      return runNoted(service, root, () => service.ticketStop(root, req))
    },
    ticketMessage: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireTicketMessageCommand(command)
      return runNoted(service, root, () => service.ticketMessage(root, req))
    },
    ticketRetry: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireTicketActionCommand(command)
      return runNoted(service, root, () => service.ticketRetry(root, req))
    },
    pause: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.pause(root))
    },
    resume: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.resume(root))
    },
    executionPolicy: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.executionPolicy(root))
    },
    executionPolicySet: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requirePolicySetCommand(command)
      return runNoted(service, root, () => service.setExecutionPolicy(root, req))
    },
    checkpoint: (repoRoot: unknown) => {
      const root = requireRepoRoot(repoRoot)
      return runNoted(service, root, () => service.checkpoint(root))
    },
    checkpointRollback: (repoRoot: unknown, command: unknown) => {
      const root = requireRepoRoot(repoRoot)
      const req = requireCheckpointRollbackCommand(command)
      return runNoted(service, root, () => service.checkpointRollback(root, req))
    },
  })
}
