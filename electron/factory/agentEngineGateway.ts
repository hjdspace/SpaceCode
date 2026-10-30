/**
 * AgentPort：把「一个任务一个阶段」的回合映射到现有引擎会话。
 *
 * 会话 id 由调用方（实现阶段 `fac-<run>-<task>-impl`）生成；同一会话内的
 * 迭代复用上下文，只重复 sendMessage。config.cwd 固定为任务工作树，
 * 模型按引擎解析别名，权限模式来自运行配置。
 */
import type { FactoryPermissionMode } from '@/shared/factory'
import type { EngineSessionConfig, EngineType } from '../engine/engines/types'

export interface AgentRunOptions {
  /** 任务工作树；会话 cwd 与命令展开都以它为准。 */
  cwd: string
  model?: string
  permissionMode: FactoryPermissionMode
  agent?: string
}

export interface AgentTurn {
  text: string
  isError: boolean
  inputTokens: number
  outputTokens: number
}

export type AgentEventListener = (sessionId: string, eventType: string, data: unknown) => void

export interface AgentPort {
  run(sessionId: string, prompt: string, options: AgentRunOptions): Promise<AgentTurn>
  stop(sessionId: string): Promise<void>
  onEvent(listener: AgentEventListener): () => void
}

export interface EngineAgentDeps {
  loadSessionConfig: (cwd: string) => EngineSessionConfig
  resolveModelAlias: (model: string, engineType?: EngineType) => string
  startSession: (sessionId: string, config: EngineSessionConfig) => Promise<unknown>
  sendMessage: (sessionId: string, content: string) => Promise<void>
  stop: (sessionId: string) => Promise<void>
  onRouteEvent: (listener: (sessionId: string, eventType: string, data: unknown) => void) => () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenCount(usage: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (typeof usage[key] === 'number') return usage[key] as number
  }
  return 0
}

/** 与 cron 的 buildCronEngineConfig 同源：claude-code 要别名，pi 要真名。 */
function buildConfig(options: AgentRunOptions, deps: EngineAgentDeps): EngineSessionConfig {
  const base = deps.loadSessionConfig(options.cwd)
  const config: EngineSessionConfig = {
    ...base,
    cwd: options.cwd,
    permissionMode: options.permissionMode,
  }

  if (options.model) {
    const alias = deps.resolveModelAlias(options.model, base.engineType)
    config.model = alias
    // modelContextWindows 以真实模型名为键；别名替换后要同步补上窗口，否则 [1m] 失效。
    const contextWindow = alias === options.model ? undefined : base.modelContextWindows?.[options.model]
    if (contextWindow !== undefined) {
      config.modelContextWindows = { ...base.modelContextWindows, [alias]: contextWindow }
    }
  }
  if (options.agent) config.agent = options.agent
  return config
}

/**
 * 生产环境的 AgentPort：延迟加载引擎模块，避免主进程启动时就初始化引擎。
 * 工厂实现/审查/修复与规划阶段共用同一套入口。
 */
export async function createDefaultAgentPort(): Promise<AgentPort> {
  const [engine, factory, sessionConfig] = await Promise.all([
    import('../engine/engineGateway'),
    import('../engine/engines/EngineFactory'),
    import('../engine/engineSessionConfig'),
  ])
  return createEngineAgentPort({
    loadSessionConfig: sessionConfig.loadEngineSessionConfig,
    resolveModelAlias: sessionConfig.resolveEngineModelAlias,
    startSession: (sessionId, config) => engine.engineGateway.startSession(sessionId, config),
    sendMessage: (sessionId, content) => engine.engineGateway.sendMessage(sessionId, content),
    stop: (sessionId) => engine.engineGateway.stop(sessionId),
    onRouteEvent: (listener) => factory.EngineFactory.onRouteEvent(listener),
  })
}

export function createEngineAgentPort(deps: EngineAgentDeps): AgentPort {
  const listeners = new Set<AgentEventListener>()
  const sessions = new Set<string>()
  const started = new Set<string>()
  const pending = new Map<string, (turn: AgentTurn) => void>()

  deps.onRouteEvent((sessionId, eventType, data) => {
    for (const listener of listeners) listener(sessionId, eventType, data)
    const settle = pending.get(sessionId)
    if (!settle) return
    const record = isRecord(data) ? data : {}
    const usage = isRecord(record.usage) ? record.usage : {}

    if (eventType === 'result') {
      pending.delete(sessionId)
      settle({
        text: typeof record.result === 'string' ? record.result : '',
        isError: record.is_error === true,
        inputTokens: tokenCount(usage, 'input_tokens', 'input', 'prompt_tokens'),
        outputTokens: tokenCount(usage, 'output_tokens', 'output', 'completion_tokens'),
      })
    } else if (eventType === 'error') {
      pending.delete(sessionId)
      const text = String(record.message ?? record.detail ?? 'Engine error')
      settle({ text, isError: true, inputTokens: 0, outputTokens: 0 })
    } else if (eventType === 'exit') {
      pending.delete(sessionId)
      const text = String(record.error ?? 'Engine process exited before result')
      settle({ text, isError: true, inputTokens: 0, outputTokens: 0 })
    }
  })

  return {
    async run(sessionId, prompt, options) {
      sessions.add(sessionId)
      if (!started.has(sessionId)) {
        const config = buildConfig(options, deps)
        await deps.startSession(sessionId, config)
        started.add(sessionId)
      }

      let settle: (turn: AgentTurn) => void = () => {}
      const promise = new Promise<AgentTurn>((resolve) => {
        settle = resolve
      })
      pending.set(sessionId, settle)
      await deps.sendMessage(sessionId, prompt)
      return await promise
    },

    async stop(sessionId) {
      if (!sessions.has(sessionId)) return
      await deps.stop(sessionId)
      sessions.delete(sessionId)
      started.delete(sessionId)
      const settle = pending.get(sessionId)
      if (settle) {
        pending.delete(sessionId)
        settle({ text: 'stopped', isError: true, inputTokens: 0, outputTokens: 0 })
      }
    },

    onEvent(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
