/**
 * Super Agent 的引擎接缝（Executor 与 RouterRunner 共用）。
 *
 * 编排真相在主进程，引擎进程仍由既有 engineGateway 承载，这里只转换「谁拥有
 * 会话」：Super Agent 自己 startSession/sendMessage，事件既回灌主进程推进领域
 * 状态，也按 sessionId 广播到渲染端做只读镜像 —— 与定时任务、流水线走同一条
 * 通路（见 docs/adr/0004-engine-gateway-deep-module.md）。
 *
 * 引擎不会把宿主发出去的人消息回显成事件，所以发送前要先用
 * `__h5RemoteUserMessage` 把气泡推给渲染端；否则 IM 视图里只有答复没有提问。
 */
import { BrowserWindow } from 'electron'
import { claudeCodeNamespace } from '@/shared/channels/claudeCode'
import type { SuperAgentSessionKind } from '@/shared/channels/superAgent'
import { eventChannels } from '@/shared/channelMap'
import type { H5RemoteUserMessagePayload } from '../h5/h5Types'
import { engineGateway } from '../engine/engineGateway'
import { EngineFactory } from '../engine/engines/EngineFactory'
import { loadEngineSessionConfig, resolveEngineModelAlias } from '../engine/engineSessionConfig'
import type {
  EngineSessionConfig,
  EngineSessionStatus,
  EngineType,
  PermissionMode,
} from '../engine/engines/types'

const ENGINE_EVENTS = eventChannels(claudeCodeNamespace.events, 'claude-code:')

export interface SuperAgentUserPush {
  sessionId: string
  content: string
  title: string
  projectPath: string
  /**
   * 这条会话属于谁：Router 还是 Worker。渲染层建行时直接落成会话类型，
   * 缺了它这两类会话会以普通聊天的身份出现在侧边栏列表里。
   */
  sessionType: SuperAgentSessionKind
  /**
   * 会话起始权限模式。渲染端的会话记录必须记同一档：权限对账会拿全局默认值
   * 下发，漏记就把这条正在跑的会话就地降级。
   */
  permissionMode?: PermissionMode
  model?: string
}

export type SuperAgentRouteListener = (
  sessionId: string,
  eventType: string,
  data: unknown,
) => void

export interface SuperAgentEngineBridge {
  loadConfig(cwd: string): EngineSessionConfig
  startSession(sessionId: string, config: EngineSessionConfig): Promise<EngineSessionStatus | null>
  sendMessage(sessionId: string, content: string, images?: unknown[]): Promise<void>
  abort(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>
  /**
   * 拒绝一次权限请求（Router 工具面守卫，#95）。
   *
   * 与 `allowedTools: []` 互补：即使引擎没按启动参数裁剪工具池，Router 轮次里的
   * 写/执行请求也会在这里被代码拒绝，理由随 message 回给模型。
   */
  denyPermission(
    sessionId: string,
    requestId: string,
    message: string,
    options?: { interrupt?: boolean },
  ): Promise<void>
  /**
   * 放行一次权限请求（Worker 权限 Attention，#94）。
   *
   * 不传 updatedInput：保持模型原始工具入参，避免空对象覆盖原请求。
   */
  allowPermission(sessionId: string, requestId: string): Promise<void>
  /**
   * 把输入框选的模型名解析成该引擎认的值。
   *
   * 与主聊天同一套规则（src/utils/engineModel）：claude-code 要 haiku/sonnet/opus
   * 槽位别名，直接传真名等于没传；pi 要真名。
   */
  resolveModelAlias(modelValue: string, engineType?: EngineType): string
  onRouteEvent(listener: SuperAgentRouteListener): () => void
  pushUserMessage(push: SuperAgentUserPush): void
}

function pushUserMessageToRenderer(push: SuperAgentUserPush): void {
  const payload: H5RemoteUserMessagePayload = {
    __h5RemoteUserMessage: true,
    messageId: null,
    content: push.content,
    projectPath: push.projectPath,
    title: push.title,
    sessionType: push.sessionType,
    timestamp: Date.now(),
    // Super Agent 的 Router/Worker 会话不由这条通路抢视图：中置聊天区与右侧
    // 面板都按 sessionId 直接寻址，切换由 app store 负责。
    activate: false,
    ...(push.permissionMode ? { permissionMode: push.permissionMode } : {}),
    ...(push.model ? { model: push.model } : {}),
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(ENGINE_EVENTS.onUser, { sessionId: push.sessionId, data: payload })
    }
  }
}

export const defaultSuperAgentEngineBridge: SuperAgentEngineBridge = {
  loadConfig: loadEngineSessionConfig,
  startSession: (sessionId, config) => engineGateway.startSession(sessionId, config),
  // 通道 DTO 里 images 是 unknown[]（沿用 claudeCode sendMessage 的既有口径），
  // 引擎侧的结构校验在它自己的边界里做。
  sendMessage: (sessionId, content, images) =>
    engineGateway.sendMessage(sessionId, content, images as never),
  abort: (sessionId) => engineGateway.abort(sessionId),
  stop: (sessionId) => engineGateway.stop(sessionId),
  denyPermission: (sessionId, requestId, message, options) =>
    engineGateway.denyPermission(sessionId, requestId, message, options),
  allowPermission: (sessionId, requestId) =>
    engineGateway.allowPermission(sessionId, requestId),
  resolveModelAlias: (modelValue, engineType) => resolveEngineModelAlias(modelValue, engineType),
  onRouteEvent: (listener) => EngineFactory.onRouteEvent(listener),
  pushUserMessage: pushUserMessageToRenderer,
}
