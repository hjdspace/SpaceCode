import { app } from 'electron'
import { error, warn } from './logger'

// ============================================================
// 进程生命周期守卫 — 退出状态 + 不让主进程被一次写日志失败卡死
// ============================================================

let _quitting = false

export function markQuitting(): void {
  _quitting = true
}

export function isQuitting(): boolean {
  return _quitting
}

/**
 * macOS 点红叉是「隐藏到 Dock」而不是关窗，但退出流程里的关闭必须真关：
 * 只隐藏会让 window-all-closed 永不触发，于是 `app.quit()` 无从发生，
 * 进程留在 Dock 里退不出去。
 */
export function shouldHideOnWindowClose(platform: NodeJS.Platform, quitting: boolean): boolean {
  return platform === 'darwin' && !quitting
}

/** 管道/描述符一类的写入失败：换掉 stdio 就会遇到，重发同样会失败。 */
const SURVIVABLE_IO_CODES = new Set([
  'EIO',
  'EPIPE',
  'EBADF',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_WRITE_AFTER_END',
])

export function isSurvivableIoFailure(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' && SURVIVABLE_IO_CODES.has(code)
}

/**
 * stdio 写坏时 `console.log` 会抛 `write EIO`。日志器在 before-quit 的清理链上被
 * 调用，而这个异常没人接就走 Electron 默认处理 —— 弹原生异常框并把退出流程停在
 * 半路。这里只吞掉这类写入失败；其余异常记录后交回默认处理，避免真 bug 被静默掩盖。
 */
export function installProcessErrorGuards(): void {
  const onUncaughtException = (err: unknown): void => {
    if (isSurvivableIoFailure(err)) {
      warn('Process', `ignored stdio write failure | code=${(err as NodeJS.ErrnoException).code} | ${String(err)}`)
      return
    }
    error('Process', 'Uncaught exception', err)
    process.removeListener('uncaughtException', onUncaughtException)
    throw err
  }
  process.on('uncaughtException', onUncaughtException)

  // 未 await 的 Promise 拒绝在 Node 15+ 默认按未捕获异常处理，同样会打断退出；
  // 主进程不该因为一条后台链路失败就崩，所以记日志后继续运行。
  process.on('unhandledRejection', (reason) => {
    error('Process', 'Unhandled rejection', reason)
  })
}

/**
 * 退出时立刻隐藏 Dock 图标：清理链要等子进程退出，没有反馈时用户只会看到
 * 「点了退出，图标还在转」。
 */
export async function hideDockIcon(): Promise<void> {
  try {
    await app.dock?.hide()
  } catch (err) {
    warn('App', `Failed to hide dock icon | ${String(err)}`)
  }
}
