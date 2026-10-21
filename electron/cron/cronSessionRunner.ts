import { BrowserWindow } from 'electron'
import { engineGateway } from '../engine/engineGateway'
import { loadEngineSessionConfig, resolveEngineModelAlias } from '../engine/engineSessionConfig'
import { EngineFactory } from '../engine/engines/EngineFactory'
import { claudeCodeNamespace } from '@/shared/channels/claudeCode'
import { isEffortLevel } from '@/shared/effort'
import { eventChannels } from '@/shared/channelMap'
import type { EngineSessionConfig, EngineSessionStatus, EngineType, PermissionMode } from '../engine/engines/types'
import type { H5RemoteUserMessagePayload } from '../h5/h5Types'
import type { CronAgentVerdict, CronExecOptions, CronRunContext, CronRunResult } from './cronScheduler'

const ENGINE_EVENTS = eventChannels(claudeCodeNamespace.events, 'claude-code:')

/** 引擎会话能接受的权限模式；任务 JSON 里的手写值（如 dontAsk）落到默认档 */
const SUPPORTED_PERMISSION_MODES: PermissionMode[] = ['default', 'plan', 'acceptEdits', 'bypassPermissions']

/**
 * 任务级配置映射到引擎会话。
 *
 * permissionMode 必须显式给值：sessionProcess 现在按 config.permissionMode 原样启动
 * （只有 bypassPermissions 才带 --dangerously-skip-permissions），留空会落到 default，
 * 无人值守的任务于是卡在没人应答的权限确认上。显式给值 = 任务自己声明要不要全放行。
 *
 * 任务里存的模型是设置槽位的实际名（如 deepseek-v4-flash），按引擎分派：
 * claude-code 要换成别名（真名会落回 sonnet 路由，任务选的模型被静默丢弃），
 * pi 要保留真名（别名对它是个不存在的模型）。规则与聊天路径同源，
 * resolveModelAlias 由调用方注入（生产用 engineSessionConfig.resolveEngineModelAlias）。
 */
export function buildCronEngineConfig(
  base: EngineSessionConfig,
  options: CronExecOptions | undefined,
  resolveModelAlias: (model: string, engineType?: EngineType) => string,
): EngineSessionConfig {
  const config: EngineSessionConfig = { ...base }
  if (options?.model) {
    const alias = resolveModelAlias(options.model, base.engineType)
    config.model = alias
    // modelContextWindows 以实际模型名为键，别名查不到会让 [1m] 后缀与
    // CLAUDE_CODE_AUTO_COMPACT_WINDOW 失效（同 chatSession 的 initClaudeCodeSession 处理）
    const ctx = alias === options.model ? undefined : base.modelContextWindows?.[options.model]
    if (ctx !== undefined) {
      config.modelContextWindows = { ...base.modelContextWindows, [alias]: ctx }
    }
  }
  // cron 任务里的 effort 来自用户可写的任务定义，非法值 CLI 只 warn 后静默退默认，
  // 认不出来就不下发，让引擎按自己的默认走。
  if (isEffortLevel(options?.effort)) config.effortLevel = options.effort
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
  resolveModelAlias: (model: string, engineType?: EngineType) => string
  startSession: (sessionId: string, config: EngineSessionConfig) => Promise<EngineSessionStatus | null>
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
    // 引擎在 spawn 时就定了 agent 落到没有；startSession 的返回值是唯一回执 (#56)
    let agentVerdict: CronAgentVerdict | undefined

    function finish(exitCode: number | null, stdout: string, stderr: string): void {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
      // 跑完即让子进程退场；用户在会话里再发消息时引擎会按 --resume 续上历史
      void Promise.resolve(deps.stop(sessionId)).catch(() => {})
      resolve({ exitCode, stdout, stderr, ...(agentVerdict ? { agent: agentVerdict } : {}) })
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

    // 已经取消的 signal 不会再叫第二次 abort 回调（AbortSignal 不重放），所以只能
    // 在这里收口：下面到 startSession 之间没有 await，漏过这一句就会照旧拉起引擎
    // 进程、投递提示词，最后被 result 记成 completed。
    if (signal.aborted) {
      finish(null, '', 'Execution cancelled')
      return
    }

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
      const status = await deps.startSession(sessionId, config)
      if (config.agent) {
        agentVerdict = {
          agent: config.agent,
          applied: status?.agentApplied ?? null,
          extensionLoaded: status?.agentExtensionLoaded,
        }
      }
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
