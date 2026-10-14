// @vitest-environment node
/**
 * 退出流程守卫 — macOS「点了退出，图标还在转」的两道保险。
 *
 *   1. 关窗判定：darwin 下红叉只隐藏窗口，但退出流程里的关闭必须真关，
 *      否则 window-all-closed 永不触发，app.quit() 无从发生。
 *   2. 进程异常：stdio 管道写坏时 console.log 抛 write EIO，这个异常若走
 *      Electron 默认处理会弹原生异常框并打断 before-quit 的清理链。只有这类
 *      写入失败可以吞；其余异常记完日志交回默认处理，免得真 bug 被静默掩盖。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const logs = vi.hoisted(() => ({
  warn: [] as unknown[][],
  error: [] as unknown[][],
}))

vi.mock('../../infra/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: (...args: unknown[]) => logs.warn.push(args),
  error: (...args: unknown[]) => logs.error.push(args),
}))

const dockHide = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    dock: { hide: dockHide },
  },
}))

import {
  shouldHideOnWindowClose,
  isSurvivableIoFailure,
  installProcessErrorGuards,
  hideDockIcon,
} from '../appLifecycle'

function ioError(code: string): Error {
  return Object.assign(new Error(`write ${code}`), { code })
}

/** 真正挂上监听（这样 process.emit 能触发），同时记下以便 afterEach 摘掉。 */
function withGuardsInstalled(run: (events: Record<string, (err: unknown) => void>) => void): void {
  const added: Array<{ event: string; listener: (err: unknown) => void }> = []
  const realOn = process.on.bind(process)
  const spy = vi.spyOn(process, 'on').mockImplementation(((event: string, listener: (err: unknown) => void) => {
    added.push({ event, listener })
    return realOn(event as never, listener as never)
  }) as never)
  installProcessErrorGuards()
  spy.mockRestore()
  try {
    run(Object.fromEntries(added.map(a => [a.event, a.listener])))
  } finally {
    for (const a of added) process.removeListener(a.event as never, a.listener as never)
  }
}

afterEach(() => {
  logs.warn.length = 0
  logs.error.length = 0
  dockHide.mockReset()
})

describe('shouldHideOnWindowClose', () => {
  it('darwin 日常关窗只隐藏到 Dock', () => {
    expect(shouldHideOnWindowClose('darwin', false)).toBe(true)
  })

  it('退出流程里的关闭必须真关，否则进程卡在 Dock', () => {
    expect(shouldHideOnWindowClose('darwin', true)).toBe(false)
  })

  it('其他平台关窗就是关窗', () => {
    expect(shouldHideOnWindowClose('win32', false)).toBe(false)
    expect(shouldHideOnWindowClose('linux', false)).toBe(false)
  })
})

describe('isSurvivableIoFailure', () => {
  it('认得管道/描述符一类的写入失败', () => {
    for (const code of ['EIO', 'EPIPE', 'EBADF', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END']) {
      expect(isSurvivableIoFailure(ioError(code))).toBe(true)
    }
  })

  it('真 bug 不算可存活', () => {
    expect(isSurvivableIoFailure(new TypeError('cannot read properties of undefined'))).toBe(false)
    expect(isSurvivableIoFailure(undefined)).toBe(false)
    expect(isSurvivableIoFailure('write EIO')).toBe(false)
  })
})

describe('installProcessErrorGuards', () => {
  it('吞掉 stdio 写入失败，只记日志，监听留在链上', () => {
    withGuardsInstalled(events => {
      const before = process.listenerCount('uncaughtException')
      expect(() => events.uncaughtException(ioError('EIO'))).not.toThrow()
      expect(process.listenerCount('uncaughtException')).toBe(before)
      expect(logs.error.length).toBe(0)
      expect(String(logs.warn[0]?.[1])).toContain('write failure')
    })
  })

  it('其他异常记完日志交回默认处理（原样抛出并摘掉自己）', () => {
    withGuardsInstalled(events => {
      const before = process.listenerCount('uncaughtException')
      const boom = new Error('real bug')
      expect(() => events.uncaughtException(boom)).toThrow(boom)
      expect(logs.error[0]?.[1]).toBe('Uncaught exception')
      // 交回默认处理 = 自己已经不在监听链上
      expect(process.listenerCount('uncaughtException')).toBe(before - 1)
    })
  })

  it('未处理的 Promise 拒绝只记日志，不打断进程', () => {
    withGuardsInstalled(events => {
      expect(() => events.unhandledRejection(ioError('EPIPE'))).not.toThrow()
      expect(logs.error[0]?.[1]).toBe('Unhandled rejection')
    })
  })
})

describe('hideDockIcon', () => {
  it('macOS 退出时隐藏 Dock 图标', async () => {
    await expect(hideDockIcon()).resolves.toBeUndefined()
    expect(dockHide).toHaveBeenCalledTimes(1)
  })

  it('隐藏失败不影响退出流程', async () => {
    dockHide.mockRejectedValue(new Error('dock gone'))
    await expect(hideDockIcon()).resolves.toBeUndefined()
    expect(String(logs.warn[0]?.[1])).toContain('hide dock icon')
  })
})
