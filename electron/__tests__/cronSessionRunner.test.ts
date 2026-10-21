// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// 执行器模块会连带加载引擎进程池，而它在模块期就要读 app 路径
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/spacecode-cron-test' },
  BrowserWindow: { getAllWindows: () => [] },
}))

import {
  buildCronEngineConfig,
  createCronSessionRunner,
  type CronSessionRunnerDeps,
} from '../cron/cronSessionRunner'
import { loadEngineSessionConfig, resolveEngineModelAlias } from '../engine/engineSessionConfig'
import type { CronRunContext } from '../cron/cronScheduler'
import type { EngineSessionStatus } from '../engine/engines/types'

function sessionStatus(patch: Partial<EngineSessionStatus> = {}): EngineSessionStatus {
  return {
    sessionId: 'sid-1',
    engineSessionId: null,
    status: 'idle',
    isRunning: true,
    ...patch,
  }
}

type Listener = (sessionId: string, eventType: string, data: any) => void

function fakeDeps(overrides: Partial<CronSessionRunnerDeps> = {}) {
  const listeners = new Set<Listener>()
  const recorder = {
    loadConfig: vi.fn((cwd: string) => ({ cwd })),
    resolveModelAlias: vi.fn((model: string) => model),
    startSession: vi.fn(async () => null),
    sendMessage: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    onRouteEvent: vi.fn((listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    pushSession: vi.fn(),
  }
  const deps: CronSessionRunnerDeps = { ...recorder, ...overrides }

  return {
    deps,
    recorder,
    emit: (sessionId: string, eventType: string, data: any) => {
      Array.from(listeners).forEach((l) => l(sessionId, eventType, data))
    },
    listenerCount: () => listeners.size,
  }
}

function testContext(patch: Partial<CronRunContext> = {}): CronRunContext {
  const controller = new AbortController()
  return {
    runId: 'r1',
    taskId: 't1',
    taskName: 'nightly',
    sessionId: 'sid-1',
    activate: false,
    signal: controller.signal,
    ...patch,
  }
}

describe('buildCronEngineConfig', () => {
  const asAlias = (model: string) => (model === 'deepseek-v4-flash' ? 'sonnet' : model)

  it('任务级的模型/推理档/agent 覆盖设置文件里的取值', () => {
    const base = buildCronEngineConfig(
      { cwd: '/w', model: 'sonnet', provider: 'anthropic', effortLevel: 'low' },
      { model: 'opus', effort: 'high', agent: 'reviewer', permissionMode: 'plan' },
      (m) => m,
    )
    expect(base).toMatchObject({
      cwd: '/w',
      provider: 'anthropic',
      model: 'opus',
      effortLevel: 'high',
      agent: 'reviewer',
      permissionMode: 'plan',
    })
  })

  it('任务里的实际模型名反查成引擎别名，否则代理会把它落回 sonnet 路由', () => {
    const config = buildCronEngineConfig({ cwd: '/w' }, { model: 'deepseek-v4-flash' }, asAlias)
    expect(config.model).toBe('sonnet')
  })

  it('别名拿不到 modelContextWindows：为别名补一份同值键，[1m] 与压缩窗口才生效', () => {
    const config = buildCronEngineConfig(
      { cwd: '/w', modelContextWindows: { 'deepseek-v4-flash': 400_000 } },
      { model: 'deepseek-v4-flash' },
      asAlias,
    )
    expect(config.modelContextWindows).toMatchObject({
      'deepseek-v4-flash': 400_000,
      sonnet: 400_000,
    })
  })

  it('权限模式缺省或不可识别时落到 default，绝不留空', () => {
    // 留空会让进程池跳过"切回用户模式"，引擎于是停在 --dangerously-skip-permissions 的放行态
    expect(buildCronEngineConfig({ cwd: '/w' }, undefined, (m) => m).permissionMode).toBe('default')
    expect(buildCronEngineConfig({ cwd: '/w' }, { permissionMode: 'dontAsk' }, (m) => m).permissionMode).toBe('default')
    expect(buildCronEngineConfig({ cwd: '/w' }, { permissionMode: 'bypassPermissions' }, (m) => m).permissionMode)
      .toBe('bypassPermissions')
  })

  it('把任务运行时的 engineType 交给解析器，别名规则只有一处', () => {
    const resolve = vi.fn((model: string) => model)
    buildCronEngineConfig({ cwd: '/w', engineType: 'pi' }, { model: 'qwen-model' }, resolve)
    expect(resolve).toHaveBeenCalledWith('qwen-model', 'pi')

    const asAlias = vi.fn((model: string) => (model === 'deepseek-v4-flash' ? 'sonnet' : model))
    buildCronEngineConfig({ cwd: '/w', engineType: 'claude-code' }, { model: 'deepseek-v4-flash' }, asAlias)
    expect(asAlias).toHaveBeenCalledWith('deepseek-v4-flash', 'claude-code')
  })

  // 生产依赖注入的就是 engineSessionConfig.resolveEngineModelAlias，用它跑一遍才钉得住
  // 「pi 任务指定模型」这条真实链路：别名对 Pi 是个不存在的模型，真名才该落到 --model。
  describe('按引擎分派真实解析器', () => {
    let configDir: string
    let homeDir: string
    const prevEnv: Record<string, string | undefined> = {}

    beforeEach(() => {
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-cron-settings-'))
      homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-cron-home-'))
      for (const key of ['CLAUDE_CONFIG_DIR', 'HOME', 'USERPROFILE']) prevEnv[key] = process.env[key]
      process.env.CLAUDE_CONFIG_DIR = configDir
      process.env.HOME = homeDir
      process.env.USERPROFILE = homeDir
      fs.writeFileSync(path.join(configDir, 'gui-settings.json'), JSON.stringify({
        authMethod: 'openai_compatible',
        openaiConfig: { sonnetModel: 'qwen-model' },
        modelCapabilities: { 'qwen-model': { contextWindow: 200_000 } },
      }), 'utf-8')
    })

    afterEach(() => {
      for (const [key, value] of Object.entries(prevEnv)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      fs.rmSync(configDir, { recursive: true, force: true })
      fs.rmSync(homeDir, { recursive: true, force: true })
    })

    it('pi：任务里的真实模型名直达引擎，不被换成 sonnet 别名', () => {
      const base = loadEngineSessionConfig('/w')
      base.engineType = 'pi'
      const config = buildCronEngineConfig(base, { model: 'qwen-model' }, resolveEngineModelAlias)

      expect(config.model).toBe('qwen-model')
      // 真名本来就是 modelContextWindows 的键，无需补别名键
      expect(config.modelContextWindows).toEqual({ 'qwen-model': 200_000 })
    })

    it('claude-code：同一份设置仍反查成槽位别名并补上下文窗口', () => {
      const base = loadEngineSessionConfig('/w')
      base.engineType = 'claude-code'
      const config = buildCronEngineConfig(base, { model: 'qwen-model' }, resolveEngineModelAlias)

      expect(config.model).toBe('sonnet')
      expect(config.modelContextWindows).toMatchObject({ 'qwen-model': 200_000, sonnet: 200_000 })
    })
  })
})

describe('createCronSessionRunner', () => {
  it('先把会话交给渲染进程，再在同一 sessionId 上起引擎并投递提示词', async () => {
    const f = fakeDeps()
    const run = createCronSessionRunner(f.deps)('p', '/w', testContext())

    expect(f.recorder.pushSession).toHaveBeenCalledWith({
      sessionId: 'sid-1',
      content: 'p',
      title: 'nightly',
      projectPath: '/w',
      activate: false,
    })
    expect(f.recorder.startSession).toHaveBeenCalledWith('sid-1', { cwd: '/w', permissionMode: 'default' })

    f.emit('sid-1', 'result', { result: 'done' })
    await expect(run).resolves.toEqual({ exitCode: 0, stdout: 'done', stderr: '' })
  })

  it('任务模型以实际名交给渲染进程，以引擎别名起会话', async () => {
    const f = fakeDeps({
      resolveModelAlias: vi.fn((m: string) => (m === 'deepseek-v4-flash' ? 'sonnet' : m)),
    })
    const run = createCronSessionRunner(f.deps)('p', '/w', testContext(), { model: 'deepseek-v4-flash' })

    expect(f.recorder.pushSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'deepseek-v4-flash' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(f.recorder.startSession).toHaveBeenCalledWith('sid-1', expect.objectContaining({ model: 'sonnet' }))

    f.emit('sid-1', 'result', { result: 'done' })
    await run
  })

  it('pi 任务起会话时模型仍是真实模型 id', async () => {
    const f = fakeDeps({
      loadConfig: vi.fn((cwd: string) => ({ cwd, engineType: 'pi' as const })),
      resolveModelAlias: vi.fn((m: string, engineType?: string) => (engineType === 'claude-code' ? 'sonnet' : m)),
    })
    const run = createCronSessionRunner(f.deps)('p', '/w', testContext(), { model: 'qwen-model' })

    expect(f.recorder.pushSession).toHaveBeenCalledWith(expect.objectContaining({ model: 'qwen-model' }))
    await new Promise((r) => setTimeout(r, 0))
    expect(f.recorder.startSession).toHaveBeenCalledWith('sid-1', expect.objectContaining({ model: 'qwen-model' }))

    f.emit('sid-1', 'result', { result: 'done' })
    await run
  })

  it('提示词在引擎会话就绪后才发出', async () => {
    let resolveStart: (v: null) => void = () => {}
    const f = fakeDeps({ startSession: () => new Promise<null>((r) => { resolveStart = r }) })
    const run = createCronSessionRunner(f.deps)('p', '/w', testContext())

    await new Promise((r) => setTimeout(r, 0))
    expect(f.recorder.sendMessage).not.toHaveBeenCalled()

    resolveStart(null)
    await new Promise((r) => setTimeout(r, 0))
    expect(f.recorder.sendMessage).toHaveBeenCalledWith('sid-1', 'p')

    f.emit('sid-1', 'result', { result: 'ready' })
    await expect(run).resolves.toEqual({ exitCode: 0, stdout: 'ready', stderr: '' })
  })

  it('result.is_error 记为失败并保留错误文本', async () => {
    const f = fakeDeps()
    const run = createCronSessionRunner(f.deps)('p', '/w', testContext())

    f.emit('sid-1', 'result', { result: 'upstream exploded', is_error: true })
    await expect(run).resolves.toEqual({
      exitCode: 1,
      stdout: 'upstream exploded',
      stderr: 'upstream exploded',
    })
  })

  it('收口后结束引擎进程并退订事件', async () => {
    const f = fakeDeps()
    const run = createCronSessionRunner(f.deps)('p', '/w', testContext())
    expect(f.listenerCount()).toBe(1)

    f.emit('sid-1', 'result', { result: 'done' })
    await run

    expect(f.recorder.stop).toHaveBeenCalledWith('sid-1')
    expect(f.listenerCount()).toBe(0)
  })

  it('传进来的 signal 已经取消时，不拉起引擎、不投递提示词、不记成功', async () => {
    const f = fakeDeps()
    const controller = new AbortController()
    controller.abort()

    const run = createCronSessionRunner(f.deps)('p', '/w', testContext({ signal: controller.signal }))

    // 已取消的 signal 不会重放 abort 回调，收口只能靠进来时那一次判读
    await expect(run).resolves.toEqual({ exitCode: null, stdout: '', stderr: 'Execution cancelled' })
    expect(f.recorder.pushSession).not.toHaveBeenCalled()
    expect(f.recorder.startSession).not.toHaveBeenCalled()
    expect(f.recorder.sendMessage).not.toHaveBeenCalled()
    expect(f.listenerCount()).toBe(0)
  })

  it('超时中断不再投递提示词，并结束已拉起的引擎进程', async () => {
    let resolveStart: (v: null) => void = () => {}
    const f = fakeDeps({ startSession: () => new Promise<null>((r) => { resolveStart = r }) })
    const controller = new AbortController()

    const run = createCronSessionRunner(f.deps)('p', '/w', testContext({ signal: controller.signal }))
    controller.abort()
    resolveStart(null)

    await expect(run).resolves.toEqual({ exitCode: null, stdout: '', stderr: 'Execution timeout' })
    expect(f.recorder.sendMessage).not.toHaveBeenCalled()
    expect(f.recorder.stop).toHaveBeenCalledWith('sid-1')
  })

  it('startSession 回报 agent 未生效时，把回执带进任务结局', async () => {
    const f = fakeDeps({
      startSession: vi.fn(async () => sessionStatus({ agentApplied: false, agentExtensionLoaded: false })),
    })
    const run = createCronSessionRunner(f.deps)('p', '/w', testContext(), { agent: 'reviewer' })

    await new Promise((r) => setTimeout(r, 0))
    f.emit('sid-1', 'result', { result: 'done' })

    await expect(run).resolves.toEqual({
      exitCode: 0,
      stdout: 'done',
      stderr: '',
      agent: { agent: 'reviewer', applied: false, extensionLoaded: false },
    })
  })

  it('没有选 agent 时不编造回执', async () => {
    const f = fakeDeps({
      startSession: vi.fn(async () => sessionStatus({ agentApplied: null })),
    })
    const run = createCronSessionRunner(f.deps)('p', '/w', testContext())

    await new Promise((r) => setTimeout(r, 0))
    f.emit('sid-1', 'result', { result: 'done' })

    const result = await run
    expect(result).not.toHaveProperty('agent')
  })

  it('只消费自己 sessionId 的事件', async () => {
    const f = fakeDeps()
    const run = createCronSessionRunner(f.deps)('p', '/w', testContext())
    let settled = false
    void run.then(() => { settled = true })

    f.emit('other-session', 'result', { result: 'not mine' })
    await Promise.resolve()
    expect(settled).toBe(false)

    f.emit('sid-1', 'error', { message: 'boom' })
    await expect(run).resolves.toEqual({ exitCode: 1, stdout: '', stderr: 'boom' })
  })

  it('引擎会话起不来时按失败收口', async () => {
    const f = fakeDeps({ startSession: () => Promise.reject(new Error('no cli')) })
    await expect(createCronSessionRunner(f.deps)('p', '/w', testContext())).resolves.toEqual({
      exitCode: 1,
      stdout: '',
      stderr: 'no cli',
    })
    expect(f.recorder.stop).toHaveBeenCalledWith('sid-1')
  })
})
