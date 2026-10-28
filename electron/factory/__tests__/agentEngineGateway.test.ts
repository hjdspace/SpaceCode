// @vitest-environment node
/**
 * AgentPort 的引擎适配：一个任务一个会话，config.cwd 指向工作树；
 * 模型按引擎解析别名，权限模式来自运行配置；result/error/exit 收口，
 * stop 会等待会话退出并让在飞的回合立即结束。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createEngineAgentPort, type EngineAgentDeps } from '../agentEngineGateway'
import type { EngineSessionConfig } from '../../engine/engines/types'

type RouteEvent = (sessionId: string, eventType: string, data: unknown) => void

let route: RouteEvent
let deps: EngineAgentDeps
let started: Array<{ sessionId: string; config: EngineSessionConfig }>
let sent: Array<{ sessionId: string; content: string }>
let stopped: string[]

beforeEach(() => {
  started = []
  sent = []
  stopped = []
  deps = {
    loadSessionConfig: (cwd) => ({ cwd, engineType: 'claude-code', model: 'base-model' }),
    resolveModelAlias: (model, engineType) => `${engineType ?? 'claude-code'}:${model}`,
    startSession: async (sessionId, config) => {
      started.push({ sessionId, config })
      return null
    },
    sendMessage: async (sessionId, content) => {
      sent.push({ sessionId, content })
    },
    stop: async (sessionId) => {
      stopped.push(sessionId)
    },
    onRouteEvent: (listener) => {
      route = listener
      return () => {}
    },
  }
})

const options = { cwd: '/repo/.spacecode/worktrees/bl-1', model: 'deepseek', permissionMode: 'acceptEdits' as const }

describe('createEngineAgentPort', () => {
  it('starts the session with the worktree cwd, model alias and permission mode', async () => {
    deps.sendMessage = async (sessionId, content) => {
      sent.push({ sessionId, content })
      route(sessionId, 'result', {
        result: 'done <promise>COMPLETE</promise>',
        usage: { input_tokens: 30, output_tokens: 8 },
      })
    }
    const port = createEngineAgentPort(deps)
    const turn = await port.run('fac-run-bl-1-impl', 'implement', options)

    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({
      sessionId: 'fac-run-bl-1-impl',
      config: { cwd: options.cwd, model: 'claude-code:deepseek', permissionMode: 'acceptEdits' },
    })
    expect(sent).toEqual([{ sessionId: 'fac-run-bl-1-impl', content: 'implement' }])
    expect(turn).toEqual({
      text: 'done <promise>COMPLETE</promise>',
      isError: false,
      inputTokens: 30,
      outputTokens: 8,
    })
  })

  it('reuses the session for later iterations but still sends the new prompt', async () => {
    deps.sendMessage = async (sessionId, content) => {
      sent.push({ sessionId, content })
      route(sessionId, 'result', { result: 'ok' })
    }
    const port = createEngineAgentPort(deps)
    await port.run('fac-1', 'first', options)
    await port.run('fac-1', 'second', options)
    expect(started).toHaveLength(1)
    expect(sent.map((item) => item.content)).toEqual(['first', 'second'])
  })

  it('treats error and exit events as failed turns', async () => {
    deps.sendMessage = async (sessionId) => route(sessionId, 'error', { message: 'boom' })
    const port = createEngineAgentPort(deps)
    const failed = await port.run('fac-a', 'x', options)
    expect(failed).toMatchObject({ isError: true, text: 'boom', inputTokens: 0, outputTokens: 0 })

    deps.sendMessage = async (sessionId) => route(sessionId, 'exit', { exitCode: 2, error: 'crashed' })
    const port2 = createEngineAgentPort(deps)
    const exited = await port2.run('fac-b', 'x', options)
    expect(exited).toMatchObject({ isError: true, text: 'crashed' })
  })

  it('stop waits for the session to exit and settles in-flight turns', async () => {
    const port = createEngineAgentPort(deps)
    const pending = port.run('fac-stop', 'x', options)
    const stopping = port.stop('fac-stop')
    await stopping
    expect(stopped).toEqual(['fac-stop'])
    expect(await pending).toMatchObject({ isError: true, text: 'stopped' })
    await port.stop('fac-stop')
    expect(stopped).toEqual(['fac-stop'])
  })

  it('forwards raw route events for projection', async () => {
    const port = createEngineAgentPort(deps)
    const seen: Array<{ sessionId: string; eventType: string }> = []
    const unsubscribe = port.onEvent((sessionId, eventType) => seen.push({ sessionId, eventType }))
    route('fac-1', 'tool_use', { name: 'Read' })
    expect(seen).toEqual([{ sessionId: 'fac-1', eventType: 'tool_use' }])
    unsubscribe()
    route('fac-1', 'tool_use', { name: 'Edit' })
    expect(seen).toHaveLength(1)
  })
})
