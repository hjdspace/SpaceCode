import { BrowserWindow } from 'electron'
import { engineGateway } from '../engine/engineGateway'
import { loadEngineSessionConfig, resolveEngineModelAlias } from '../engine/engineSessionConfig'
import { EngineFactory } from '../engine/engines/EngineFactory'
import { claudeCodeNamespace } from '@/shared/channels/claudeCode'
import { eventChannels } from '@/shared/channelMap'
import type { EngineSessionConfig, PermissionMode } from '../engine/engines/types'
import type { H5RemoteUserMessagePayload } from '../h5/h5Types'
import type { CronExecOptions, CronRunContext, CronRunResult } from './cronScheduler'

const ENGINE_EVENTS = eventChannels(claudeCodeNamespace.events, 'claude-code:')

/** 引擎会话能接受的权限模式；任务 JSON 里的手写值（如 dontAsk）落到默认档 */
const SUPPORTED_PERMISSION_MODES: PermissionMode[] = ['default', 'plan', 'acceptEdits', 'bypassPermissions']

/**
 * 任务级配置映射到引擎会话。
 *
 * permissionMode 必须显式给值：sessionProcess 一律带 --dangerously-skip-permissions
 * 启动（让运行时能切到 bypass），再由进程池按 config.permissionMode 切回。
 * 留空就等于让无人值守的任务跑在全放行模式，比改走引擎会话之前的行为更危险。
 *
 * 任务里存的模型是设置槽位的实际名（如 deepseek-v4-flash），引擎会话要的是别名：
 * 代理模式下真名会落回 sonnet 路由，任务选的模型被静默丢弃。resolveModelAlias
 * 由调用方注入（生产用 engineSessionConfig.resolveEngineModelAlias）。
 */
export function buildCronEngineConfig(
  base: EngineSessionConfig,
  options: CronExecOptions | undefined,
  resolveModelAlias: (model: string) => string,
): EngineSessionConfig {
  const config: EngineSessionConfig = { ...base }
  if (options?.model) {
    const alias = resolveModelAlias(options.model)
    config.model = alias
    // modelContextWindows 以实际模型名为键，别名查不到会让 [1m] 后缀与
    // CLAUDE_CODE_AUTO_COMPACT_WINDOW 失效（同 chatSession 的 initClaudeCodeSession 处理）
    const ctx = alias === options.model ? undefined : base.modelContextWindows?.[options.model]
    if (ctx !== undefined) {
      config.modelContextWindows = { ...base.modelContextWindows, [alias]: ctx }
    }
  }
  if (options?.effort) config.effortLevel = options.effort
  if (options?.agent) config.agent = options.agent
  const mode = options?.permissionMode as PermissionMode | undefined
  config.permissionMode = mode && SUPPORTED_PERMISSION_MODES.includes(mode) ? mode : 'default'
  return config
}

export interface CronSessionPush {
  sessionId: string
  content: string
  title: string
  projectPath: string
  activate: boolean
  /** 任务指定的模型（实际模型名），让会话页输入框显示它而不是全局默认 */
  model?: string
}

export interface CronSessionRunnerDeps {
  loadConfig: (cwd: string) => EngineSessionConfig
  resolveModelAlias: (model: string) => string
  startSession: (sessionId: string, config: EngineSessionConfig) => Promise<unknown>
  sendMessage: (sessionId: string, content: string) => Promise<void>
  stop: (sessionId: string) => Promise<void>
  onRouteEvent: (listener: (sessionId: string, eventType: string, data: any) => void) => () => void
  pushSession: (push: CronSessionPush) => void
}

/** 把这次执行落成侧边栏里可见的会话（与手机端发消息走同一条渲染进程通道） */
function pushSessionToRenderer(push: CronSessionPush): void {
  const payload: H5RemoteUserMessagePayload = {
    __h5RemoteUserMessage: true,
    messageId: null,
    content: push.content,
    projectPath: push.projectPath,
    title: push.title,
    timestamp: Date.now(),
    activate: push.activate,
    ...(push.model ? { model: push.model } : {}),
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(ENGINE_EVENTS.onUser, { sessionId: push.sessionId, data: payload })
    }
  }
}

export const defaultCronSessionRunnerDeps: CronSessionRunnerDeps = {
  loadConfig: loadEngineSessionConfig,
  resolveModelAlias: resolveEngineModelAlias,
  startSession: (sessionId, config) => engineGateway.startSession(sessionId, config),
  sendMessage: (sessionId, content) => engineGateway.sendMessage(sessionId, content),
  stop: (sessionId) => engineGateway.stop(sessionId),
  onRouteEvent: (listener) => EngineFactory.onRouteEvent(listener),
  pushSession: pushSessionToRenderer,
}

/**
 * 定时任务的执行器：跑在一个真正的引擎会话上。
 *
 * 之前的实现是另起一个 `--print` 子进程把 stdout 攒成字符串，执行过程对渲染进程
 * 完全不可见，用户只能在执行记录里看到截断后的输出。改走 engineGateway 后，
 * 事件按 sessionId 进 claude-code:* 通道，会话与聊天页共用同一套渲染链路。
 */
export function createCronSessionRunner(
  deps: CronSessionRunnerDeps = defaultCronSessionRunnerDeps,
): (
  prompt: string,
  cwd: string,
  context: CronRunContext,
  options?: CronExecOptions,
) => Promise<CronRunResult> {
  return (prompt, cwd, context, options) => new Promise<CronRunResult>((resolve) => {
    const { sessionId, taskName, activate, signal } = context
    let settled = false

    function finish(exitCode: number | null, stdout: string, stderr: string): void {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
      // 跑完即让子进程退场；用户在会话里再发消息时引擎会按 --resume 续上历史
      void Promise.resolve(deps.stop(sessionId)).catch(() => {})
      resolve({ exitCode, stdout, stderr })
    }

    function onAbort(): void {
      finish(null, '', 'Execution timeout')
    }

    const unsubscribe = deps.onRouteEvent((sid, eventType, data) => {
      if (sid !== sessionId || settled) return
      if (eventType === 'result') {
        const text = typeof data?.result === 'string' ? data.result : ''
        const isError = !!data?.is_error
        finish(isError ? 1 : 0, text, isError ? (text || 'Engine reported an error') : '')
      } else if (eventType === 'error') {
        finish(1, '', String(data?.message ?? 'Engine error'))
      } else if (eventType === 'exit') {
        finish(
          typeof data?.exitCode === 'number' ? data.exitCode : 1,
          '',
          String(data?.error ?? 'Engine process exited before result'),
        )
      }
    })

    signal.addEventListener('abort', onAbort, { once: true })

    deps.pushSession({
      sessionId,
      content: prompt,
      title: taskName || prompt.slice(0, 50),
      projectPath: cwd,
      activate,
      ...(options?.model ? { model: options.model } : {}),
    })

    void (async () => {
      const config = buildCronEngineConfig(deps.loadConfig(cwd), options, deps.resolveModelAlias)
      await deps.startSession(sessionId, config)
      // 收口可能落在 startSession 期间（超时中断）。此时再把 prompt 喂进去，
      // 就会留下一个已经无人等待、却仍在跑的引擎进程。
      if (settled) {
        void Promise.resolve(deps.stop(sessionId)).catch(() => {})
        return
      }
      await deps.sendMessage(sessionId, prompt)
    })().catch((err: any) => finish(1, '', err?.message || String(err)))
  })
}
