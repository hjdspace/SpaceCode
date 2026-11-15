/**
 * 在途生图工作的会话级登记表。
 *
 * 生图是计费的网络出口：用户点停止、会话进程没了、应用退出，都不能让请求继续在后台烧钱。
 * 每次调用自持一个中止控制器，变体扇出与批量的子请求继承同一信号；取消入口按会话找到它们。
 *
 * 鉴权失败止血与用户取消共用这套机制，只是原因不同 —— 原因决定逐图结果标 cancelled 还是 failed。
 *
 * 零 fs、零 electron：授权卡的关卡委托给 imageGenAuthorization 的宿主登记表。
 */
import { cancelImageGenDialogs } from './imageGenAuthorization'

/**
 * `user` = 中止 / 停止 / 挂起；`auth` = 401/403 就地止血；`shutdown` = 进程退出或应用退出序列。
 */
export type ImageGenStopReason = 'user' | 'auth' | 'shutdown'

export interface ImageGenWork {
  readonly signal: AbortSignal
  /** 未被中止时为 null。第一个原因说了算，后来的取消不改写它。 */
  readonly stopReason: ImageGenStopReason | null
  stop: (reason: ImageGenStopReason) => void
  /** 调用结束（成功、失败或取消）后摘出登记表，之后的会话级取消不再波及它。 */
  release: () => void
}

const registry = new Map<string, Set<ImageGenWork>>()

export function beginImageGenWork(sessionId: string | null): ImageGenWork {
  const controller = new AbortController()
  let reason: ImageGenStopReason | null = null

  const work: ImageGenWork = {
    get signal() {
      return controller.signal
    },
    get stopReason() {
      return reason
    },
    stop(next) {
      if (reason) return
      reason = next
      controller.abort(next)
    },
    release() {
      if (!sessionId) return
      const works = registry.get(sessionId)
      if (!works) return
      works.delete(work)
      if (works.size === 0) registry.delete(sessionId)
    },
  }

  // 没有会话就没有能取消它的入口，但调用内部止血仍然可用。
  if (sessionId) {
    const works = registry.get(sessionId) ?? new Set<ImageGenWork>()
    works.add(work)
    registry.set(sessionId, works)
  }
  return work
}

/** 取消该会话的在途工作，并关掉它待应答的授权卡。 */
export function cancelImageGenWork(sessionId: string, reason: ImageGenStopReason): void {
  for (const work of registry.get(sessionId) ?? []) work.stop(reason)
  cancelImageGenDialogs(sessionId)
}

/** 应用退出序列：所有会话的在途工作与待应答卡一并收掉。 */
export function cancelAllImageGenWork(reason: ImageGenStopReason): void {
  for (const works of registry.values()) {
    for (const work of works) work.stop(reason)
  }
  cancelImageGenDialogs(null)
}