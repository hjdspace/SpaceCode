/**
 * pi「错误收场」中间态的桥接层。
 *
 * pi 的 auto-retry 在每个可重试的 LLM 失败（429/5xx/网络抖动）上都会把回合先以
 * `agent_end(stopReason='error')` 收场，紧接着才 `auto_retry_start` → 退避 → 续跑
 * （见 pi dist/core/agent-session.js `_processAgentEvent`：agent_end 事件里检查
 * `_isRetryableError` 并 await `_handleRetryableError`）；重试预算耗尽时则是
 * `auto_retry_end(success:false)` → `agent_end(error)`，之后不再续跑。
 *
 * 于是 `agent_end(error)` 对宿主有两副面孔：
 *  - 「正在重试，别结算」—— 此时结算会把加载中的回合打成错误卡片，而 pi 随后
 *    自己恢复并继续输出（用户看到卡片下面接着推理）；
 *  - 「彻底失败，落卡片」—— 预算耗尽，这才是 claude-code「重试 10 次都失败才报错」
 *    的对齐点。
 *
 * pi 自己不区分（帧序固定，但语义只有下一拍才知道），所以这里在 mapPiEvent 之后、
 * 派发之前把错误 result 扣住，按下一拍分诊：
 *  - `system/api_retry`（auto_retry_start）→ 引擎在重试：放行 banner 事件，回合保持
 *    loading，扣住的错误继续扣着；
 *  - `system/auto_retry_end(true)` → 恢复成功：丢弃扣住的错误，后续成功 result 正常结算；
 *  - `system/auto_retry_end(false)` → 预算耗尽：放行扣住的错误 result → 渲染层落错误卡片；
 *  - 短窗口内没有任何重试事件 → 这版 pi 不会重试（老版本 / retry 被禁 / 不可重试错误）：
 *    定时器兜底放行，行为与未桥接时一致。
 */

/** agent_end(error) 与重试帧同拍发出，几百毫秒足够覆盖帧序差；超时说明 pi 根本不打算重试。 */
const RETRY_DISAMBIGUATION_WINDOW_MS = 300

/** mapPiEvent 产出的统一事件（池派发与桥接共用同一形状）。 */
export interface RoutedEngineEvent {
  type: string
  data: any
}

export class PiRetryBridge {
  private retrying = false
  private held: RoutedEngineEvent | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly emitLate: (event: RoutedEngineEvent) => void) {}

  /**
   * 输入一条映射后的统一事件，返回应当立刻派发的事件（0 到多条）。
   * 错误 result 可能被扣住，超时后经 `emitLate` 异步补发。
   */
  feed(event: RoutedEngineEvent): RoutedEngineEvent[] {
    if (event.type === 'system') {
      const subtype = event.data?.subtype
      if (subtype === 'api_retry') {
        // 引擎确认在重试：撤销「不会重试」的兜底定时器，扣住的错误继续等结局。
        this.retrying = true
        this.clearTimer()
        return [event]
      }
      if (subtype === 'auto_retry_end') {
        const held = this.takeHeld()
        const recovered = event.data?.success === true
        this.retrying = false
        if (recovered) return [event]
        // 预算耗尽（或用户取消）：先让渲染层收掉重试横幅，再放行错误 result 落卡片。
        return held ? [event, held] : [event]
      }
      return [event]
    }

    if (event.type === 'result') {
      if (event.data?.stop_reason !== 'error') {
        // 成功收场：重试期间恢复的最终结果，重试状态一并清掉。
        this.reset()
        return [event]
      }
      this.hold(event)
      return []
    }

    if (event.type === 'exit' || event.type === 'error') {
      // 进程退出/引擎级错误有自己的结算路径；扣住的中间态错误作废，避免双报。
      this.reset()
      return [event]
    }

    return [event]
  }

  /**
   * 丢弃未决状态（会话 detach / 驱逐 / kill）。扣住的错误一并作废：
   * 非最终失败不该在会话生命周期收尾时补一张错误卡片。
   */
  dispose(): void {
    this.clearTimer()
    this.held = null
    this.retrying = false
  }

  private hold(event: RoutedEngineEvent): void {
    this.clearTimer()
    this.held = event
    // 已确认在重试（auto_retry_start 先于 agent_end 的帧序）：纯事件驱动，不设兜底。
    if (this.retrying) return
    this.timer = setTimeout(() => {
      this.timer = null
      const held = this.takeHeld()
      if (held) this.emitLate(held)
    }, RETRY_DISAMBIGUATION_WINDOW_MS)
  }

  private takeHeld(): RoutedEngineEvent | null {
    this.clearTimer()
    const held = this.held
    this.held = null
    return held
  }

  private reset(): void {
    this.clearTimer()
    this.held = null
    this.retrying = false
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
