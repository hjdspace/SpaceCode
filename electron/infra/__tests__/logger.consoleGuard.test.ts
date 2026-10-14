// @vitest-environment node
/**
 * 日志器的 stdio 契约 — writeLog 绝不能因为写 console 失败而抛。
 *
 * macOS 从 Finder 启动、或退出阶段管道先于进程关闭时，`console.log` 抛
 * `write EIO`；日志器在 before-quit 的清理链上被调用，一抛就打断整条链，
 * 用户看到的就是「退不出去 + 原生异常框」。文件写入本来就有 try/catch，
 * console 镜像没有 —— 这里把它补上，并验证坏了之后仍继续落盘。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const fsProbe = vi.hoisted(() => ({ appended: [] as string[] }))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/home/tester',
    commandLine: { hasSwitch: () => false },
    isPackaged: false,
  },
}))

vi.mock('fs', () => ({
  existsSync: () => true,
  mkdirSync: () => {},
  appendFileSync: (_path: string, line: string) => { fsProbe.appended.push(line) },
  readdirSync: () => [],
  unlinkSync: () => {},
  statSync: () => ({ mtime: { getTime: () => Date.now() }, size: 0 }),
  readFileSync: () => '',
}))

vi.mock('fs/promises', () => ({
  readFile: async () => '',
  readdir: async () => [],
  stat: async () => ({ size: 0, mtime: new Date() }),
}))

/** 每个用例要一份干净的模块状态（consoleMirrorBroken 是模块级开关）。 */
async function freshLogger() {
  vi.resetModules()
  const logger = await import('../logger')
  logger.initLogger()
  fsProbe.appended.length = 0
  return logger
}

function brokenConsole(method: 'log' | 'warn' | 'error') {
  return vi.spyOn(console, method).mockImplementation(() => {
    throw Object.assign(new Error('write EIO'), { code: 'EIO' })
  })
}

beforeEach(() => {
  fsProbe.appended.length = 0
})

describe('writeLog 的 console 镜像', () => {
  it('stdio 写坏时不抛，且这一行仍然落盘', async () => {
    const logger = await freshLogger()
    const spy = brokenConsole('log')

    expect(() => logger.info('App', 'App quitting')).not.toThrow()
    expect(fsProbe.appended.join('')).toContain('App quitting')
    spy.mockRestore()
  })

  it('写坏一次就停用 console 镜像，后续日志继续写文件', async () => {
    const logger = await freshLogger()
    const spy = brokenConsole('log')

    logger.info('App', 'first')
    logger.info('App', 'second')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(fsProbe.appended).toHaveLength(2)
    expect(fsProbe.appended.join('')).toContain('second')
    spy.mockRestore()
  })

  it('ERROR/WARN 级别各自走对应的 console 方法', async () => {
    const logger = await freshLogger()
    const errorSpy = brokenConsole('error')
    const warnSpy = brokenConsole('warn')

    logger.error('App', 'boom')
    logger.warn('App', 'careful')

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('initLogger 接住 stdout/stderr 的 error 事件，管道坏了就停用镜像', async () => {
    vi.resetModules()
    const logger = await import('../logger')

    const handlers: Array<(err: Error) => void> = []
    const realStream = process.stdout
    const spies = [process.stdout, process.stderr].map(stream =>
      vi.spyOn(stream, 'on').mockImplementation(((_event: string, cb: (err: Error) => void) => {
        handlers.push(cb)
        return realStream
      }) as never),
    )
    logger.initLogger()
    spies.forEach(s => s.mockRestore())
    fsProbe.appended.length = 0

    expect(handlers.length).toBe(2)

    const logSpy = brokenConsole('log')
    handlers[0](Object.assign(new Error('write EIO'), { code: 'EIO' }))
    logger.info('App', 'after stdio failure')

    expect(logSpy).not.toHaveBeenCalled()
    expect(fsProbe.appended.join('')).toContain('after stdio failure')
    logSpy.mockRestore()
  })
})
