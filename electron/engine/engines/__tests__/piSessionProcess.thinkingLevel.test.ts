// @vitest-environment node
/**
 * PiSessionProcess.setThinkingLevel 的失败可见性（issue #49）。
 *
 * 曾经这里是整条链路上最隐蔽的一处吞：`if (!this._process) return` 加一个只 warn 的
 * catch，于是 PiEngine 那句「老实 throw err」的 try/catch 永远等不到异常 —— 子进程已经
 * 没了或 stdin 写不进去时，上层照样收到 resolve，界面停在一条从没送出的设置上。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => '/app/root', getPath: () => '/home/u' },
  BrowserWindow: class {},
}))

vi.mock('../../../infra/logger', () => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
}))

import { PiSessionProcess } from '../PiSessionProcess'
import type { EngineSessionConfig } from '../types'

const BASE: EngineSessionConfig = { cwd: '/ws', provider: 'anthropic', model: 'claude-sonnet-4' }

function newProc(): PiSessionProcess {
  return new PiSessionProcess('pi-thinking-0001', BASE)
}

/** 装一个只够写字节的外壳：本用例只关心这一帧写得出去还是写不出去。 */
function withStdin(proc: PiSessionProcess, write: ReturnType<typeof vi.fn>) {
  ;(proc as unknown as { _process: unknown })._process = { stdin: { write } }
  return proc
}

describe('setThinkingLevel', () => {
  it('进程在时把 set_thinking_level 写进 stdin', async () => {
    const write = vi.fn()

    await withStdin(newProc(), write).setThinkingLevel('medium')

    expect(JSON.parse(write.mock.calls[0][0] as string)).toEqual({ type: 'set_thinking_level', level: 'medium' })
  })

  it('子进程已经没了时抛出，不再静默 return', async () => {
    // 修复前这里 return undefined，上层读成「已下发」。
    await expect(newProc().setThinkingLevel('off')).rejects.toThrow(/no running process/)
  })

  it('stdin 写失败时把原因带出去', async () => {
    const write = vi.fn(() => { throw new Error('EPIPE') })

    await expect(withStdin(newProc(), write).setThinkingLevel('medium')).rejects.toThrow('EPIPE')
  })
})
