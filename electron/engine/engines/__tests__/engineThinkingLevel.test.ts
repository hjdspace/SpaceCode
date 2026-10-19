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
})

describe('PiEngine.updateThinkingLevel', () => {
  function engineWithProcess(setThinkingLevel: ReturnType<typeof vi.fn> | undefined) {
    const engine = new PiEngine()
    ;(engine as unknown as { pool: unknown }).pool = {
      getProcess: vi.fn(() => (setThinkingLevel ? { setThinkingLevel } : undefined)),
    }
    return engine
  }

  it('RPC 写成功后答 now —— pi 是即时下发，没有"下一轮"这一说', async () => {
    const setThinkingLevel = vi.fn(async () => {})

    await expect(engineWithProcess(setThinkingLevel).updateThinkingLevel('s1', true)).resolves.toBe('now')
    expect(setThinkingLevel).toHaveBeenCalledWith('medium')
  })

  it('RPC 失败时抛出，界面才能把开关退回点击前', async () => {
    const setThinkingLevel = vi.fn(async () => { throw new Error('pi process gone') })

    await expect(engineWithProcess(setThinkingLevel).updateThinkingLevel('s1', false)).rejects.toThrow('pi process gone')
  })

  it('会话还没起进程时按已生效答：没有正在跑的轮次会被旧参数卡住', async () => {
    await expect(engineWithProcess(undefined).updateThinkingLevel('s1', true)).resolves.toBe('now')
  })
})
