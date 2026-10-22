// @vitest-environment node
/**
 * 两条引擎的 updateThinkingLevel 契约（issue #49）。
 *
 * 修复前 ClaudeCodeEngine 把进程池的 'now' | 'next-turn' 丢掉、只回 Promise<void>，
 * PiEngine 成功与失败都只回 void —— 上层无论怎么判都只能猜。渲染层需要这两个信息才能
 * 决定「提示本轮跑完才生效」还是「把开关退回点击前的状态」，所以失败必须抛出、时机必须回传。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app/root', getPath: () => '/home/u' },
  BrowserWindow: class {},
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

import { ClaudeCodeEngine } from '../ClaudeCodeEngine'
import { PiEngine } from '../PiEngine'

describe('ClaudeCodeEngine.updateThinkingLevel', () => {
  it('原样回传进程池的生效时机', async () => {
    const engine = new ClaudeCodeEngine()
    const pool = { updateThinkingLevel: vi.fn(() => 'next-turn') }
    ;(engine as unknown as { pool: unknown }).pool = pool

    await expect(engine.updateThinkingLevel('s1', true)).resolves.toBe('next-turn')
    expect(pool.updateThinkingLevel).toHaveBeenCalledWith('s1', true)
  })

  it('进程池抛错时不吞', async () => {
    const engine = new ClaudeCodeEngine()
    ;(engine as unknown as { pool: unknown }).pool = {
      updateThinkingLevel: vi.fn(() => { throw new Error('suspend refused: pending tools') }),
    }

    await expect(engine.updateThinkingLevel('s1', false)).rejects.toThrow('suspend refused: pending tools')
  })

  it('深度切换同样原样回传进程池的生效时机与异常', async () => {
    const engine = new ClaudeCodeEngine()
    const pool = { updateEffortLevel: vi.fn(() => 'next-turn') }
    ;(engine as unknown as { pool: unknown }).pool = pool

    await expect(engine.updateEffortLevel('s1', 'xhigh')).resolves.toBe('next-turn')
    expect(pool.updateEffortLevel).toHaveBeenCalledWith('s1', 'xhigh')

    ;(engine as unknown as { pool: unknown }).pool = {
      updateEffortLevel: vi.fn(() => { throw new Error('no process') }),
    }
    await expect(engine.updateEffortLevel('s1', 'max')).rejects.toThrow('no process')
  })
})

describe('PiEngine.updateThinkingLevel', () => {
  function engineWithProcess(
    setThinkingLevel: ReturnType<typeof vi.fn> | undefined,
    config: Record<string, unknown> = {},
  ) {
    const engine = new PiEngine()
    // 真实 PiSessionProcess 一定持有 config，池 suspend/resume 就是按它重拼 spawn 参数的。
    const proc: Record<string, unknown> = { setThinkingLevel, config: { cwd: '/w', ...config } }
    ;(engine as unknown as { pool: unknown }).pool = {
      getProcess: vi.fn(() => (setThinkingLevel ? proc : undefined)),
    }
    return { engine, proc }
  }

  it('RPC 写成功后答 now —— pi 是即时下发，没有"下一轮"这一说', async () => {
    const setThinkingLevel = vi.fn(async () => {})

    await expect(engineWithProcess(setThinkingLevel).engine.updateThinkingLevel('s1', true)).resolves.toBe('now')
    expect(setThinkingLevel).toHaveBeenCalledWith('medium')
  })

  it('把会话选定的深度带给 pi，不再一律写死 medium', async () => {
    const setThinkingLevel = vi.fn(async () => {})

    await engineWithProcess(setThinkingLevel, { effortLevel: 'high' }).engine.updateThinkingLevel('s1', true)
    expect(setThinkingLevel).toHaveBeenCalledWith('high')
  })

  /**
   * 这条以前断言 max → xhigh，依据是「pi 的枚举没有 max」。pi 1.3.0 的
   * `dist/cli/args.js` 里 VALID_THINKING_LEVELS 含 max，那个前提已经随版本失效 ——
   * 照旧折价等于把用户选的最高档静默降一级，界面显示的和引擎按的又不是同一个。
   */
  it('max 原样下发：pi 认 max，折成 xhigh 是把最高档偷偷降一级', async () => {
    const setThinkingLevel = vi.fn(async () => {})

    await engineWithProcess(setThinkingLevel, { effortLevel: 'max' }).engine.updateThinkingLevel('s1', true)
    expect(setThinkingLevel).toHaveBeenCalledWith('max')
  })

  it('关掉思考就是 off，深度不再参与', async () => {
    const setThinkingLevel = vi.fn(async () => {})

    await engineWithProcess(setThinkingLevel, { effortLevel: 'max' }).engine.updateThinkingLevel('s1', false)
    expect(setThinkingLevel).toHaveBeenCalledWith('off')
  })

  it('下发的配置同时写回 proc.config —— 只发 stdin 不写 config 的话，一次重启就退回旧值', async () => {
    const { engine, proc } = engineWithProcess(vi.fn(async () => {}), { thinkingEnabled: true, effortLevel: 'low' })

    await engine.updateThinkingLevel('s1', false)
    expect(proc.config).toMatchObject({ thinkingEnabled: false })
  })

  it('RPC 失败时抛出，界面才能把开关退回点击前', async () => {
    const setThinkingLevel = vi.fn(async () => { throw new Error('pi process gone') })

    await expect(engineWithProcess(setThinkingLevel).engine.updateThinkingLevel('s1', false)).rejects.toThrow('pi process gone')
  })

  it('会话还没起进程时按已生效答：没有正在跑的轮次会被旧参数卡住', async () => {
    const { engine } = engineWithProcess(undefined)
    await expect(engine.updateThinkingLevel('s1', true)).resolves.toBe('now')
  })
})

describe('PiEngine.updateEffortLevel', () => {
  function engineWithProcess(config: Record<string, unknown>) {
    const engine = new PiEngine()
    const setThinkingLevel = vi.fn(async () => {})
    const proc = { setThinkingLevel, config: { cwd: '/w', ...config } }
    ;(engine as unknown as { pool: unknown }).pool = { getProcess: vi.fn(() => proc) }
    return { engine, proc, setThinkingLevel }
  }

  it('思考开着时改深度会立刻按新深度下发', async () => {
    const { engine, setThinkingLevel, proc } = engineWithProcess({ thinkingEnabled: true, effortLevel: 'low' })

    await expect(engine.updateEffortLevel('s1', 'xhigh')).resolves.toBe('now')
    expect(setThinkingLevel).toHaveBeenCalledWith('xhigh')
    expect(proc.config).toMatchObject({ effortLevel: 'xhigh' })
  })

  it('思考关着时只记配置，不把思考顺手打开', async () => {
    const { engine, setThinkingLevel } = engineWithProcess({ thinkingEnabled: false, effortLevel: 'low' })

    await engine.updateEffortLevel('s1', 'high')
    expect(setThinkingLevel).toHaveBeenCalledWith('off')
  })
})

/**
 * 换模型与思考档位的联动。
 *
 * pi 的 `set_model` 内部会按**新模型**重算 thinking（回到 settings 默认），所以宿主换完
 * 必须把用户选的档位补发回去，否则「换个模型，推理深度自己变了」。补发本身失败只告警：
 * 模型确实已经切过去了，把整次切换判成失败会让上层去做没必要的重启。
 */
describe('PiEngine.setModel', () => {
  function engineWithPool({ setModel, setThinkingLevel, config = {} }: {
    setModel?: ReturnType<typeof vi.fn>
    setThinkingLevel?: ReturnType<typeof vi.fn>
    config?: Record<string, unknown>
  }) {
    const engine = new PiEngine()
    const proc = { setThinkingLevel, config: { cwd: '/w', ...config } }
    ;(engine as unknown as { pool: unknown }).pool = {
      setModel: setModel ?? vi.fn(async () => {}),
      getProcess: vi.fn(() => proc),
    }
    return { engine, proc }
  }

  it('切换成功后按会话原本的意图补发一次思考档位', async () => {
    const setModel = vi.fn(async () => {})
    const setThinkingLevel = vi.fn(async () => {})

    await engineWithPool({ setModel, setThinkingLevel, config: { thinkingEnabled: true, effortLevel: 'xhigh' } })
      .engine.setModel('s1', 'kimi-k3')

    expect(setModel).toHaveBeenCalledWith('s1', 'kimi-k3')
    expect(setThinkingLevel).toHaveBeenCalledWith('xhigh')
  })

  it('思考本来就关着时，换模型不会把它打开', async () => {
    const setThinkingLevel = vi.fn(async () => {})

    await engineWithPool({ setThinkingLevel, config: { thinkingEnabled: false, effortLevel: 'high' } })
      .engine.setModel('s1', 'kimi-k3')

    expect(setThinkingLevel).toHaveBeenCalledWith('off')
  })

  it('池里的切换失败原样抛出 —— 上层据此才晓得要回落重启', async () => {
    const setModel = vi.fn(async () => { throw new Error('Model not found: openai-compat/nope') })

    await expect(engineWithPool({ setModel }).engine.setModel('s1', 'nope'))
      .rejects.toThrow('Model not found: openai-compat/nope')
  })

  it('补发档位失败时不算整次切换失败', async () => {
    const setThinkingLevel = vi.fn(async () => { throw new Error('stdin EPIPE') })

    await expect(engineWithPool({ setThinkingLevel }).engine.setModel('s1', 'kimi-k3')).resolves.toBeUndefined()
  })
})
