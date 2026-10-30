// @vitest-environment node
/**
 * IPC handler 注册器：参数透传、同步/异步返回值，以及抛错时先落主进程日志再原样 reject。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { defineChannels } from '../channelMap'

const logError = vi.fn()
vi.mock('@electron/infra/logger', () => ({ error: (...args: unknown[]) => logError(...args) }))

import { registerHandlers } from '../handlerRegistry'

const channels = defineChannels({
  echo: { req: [] as unknown as [value: string], res: null as unknown as string },
  boom: { req: [] as unknown as [], res: null as unknown as number },
})

type Handler = (event: unknown, ...args: unknown[]) => unknown

function fakeIpcMain(): { ipcMain: Parameters<typeof registerHandlers>[0]; handlers: Map<string, Handler> } {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    },
  }
  return { ipcMain: ipcMain as unknown as Parameters<typeof registerHandlers>[0], handlers }
}

describe('registerHandlers', () => {
  beforeEach(() => {
    logError.mockClear()
  })

  it('passes arguments through and returns the handler result', async () => {
    const { ipcMain, handlers } = fakeIpcMain()
    registerHandlers(ipcMain, channels, 'demo:', {
      echo: (value: string) => `echo:${value}`,
      boom: () => 1,
    })

    await expect(handlers.get('demo:echo')!({}, 'a')).resolves.toBe('echo:a')
    expect(logError).not.toHaveBeenCalled()
  })

  it('logs the channel and error before rejecting to the renderer', async () => {
    const { ipcMain, handlers } = fakeIpcMain()
    const failure = new Error('disk on fire')
    registerHandlers(ipcMain, channels, 'demo:', {
      echo: () => '',
      boom: async () => {
        throw failure
      },
    })

    await expect(handlers.get('demo:boom')!({})).rejects.toBe(failure)
    expect(logError).toHaveBeenCalledWith('IPC', 'demo:boom failed', failure)
  })
})
