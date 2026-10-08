// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

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
import type { CronRunContext } from '../cron/cronScheduler'

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

  it('提示词在引擎会话就绪后才发出', async () => {    let resolveStart: (v: null) => void = () => {}
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
