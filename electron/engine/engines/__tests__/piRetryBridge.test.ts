// @vitest-environment node
/**
 * PiRetryBridge：pi「错误收场」中间态的分诊。
 *
 * pi 的 auto-retry 在每个可重试失败上都先发 agent_end(stopReason='error') 再
 * auto_retry_start（见 dist/core/agent-session.js），预算耗尽才是
 * auto_retry_end(false) → agent_end(error)。桥扣住错误 result 等下一拍：
 *   - api_retry（auto_retry_start）→ 放行 banner，错误继续扣（回合保持 loading）；
 *   - auto_retry_end(true) → 恢复成功，丢弃扣住的错误；
 *   - auto_retry_end(false) → 预算耗尽，先 banner 后错误 result（渲染层收横幅、落卡片）；
 *   - 300ms 内没有重试事件 → 这版 pi 不打算重试，兜底放行，行为与未桥接一致。
 *
 * 用 fake timers 驱动兜底窗口；事件工厂集中定义，断言只看 type/关键 data。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PiRetryBridge, type RoutedEngineEvent } from '../piRetryBridge'

const errorResult = (): RoutedEngineEvent => ({
  type: 'result',
  data: { stop_reason: 'error', is_error: true, result: 'API 返回 429 速率限制错误' },
})

const okResult = (): RoutedEngineEvent => ({
  type: 'result',
  data: { stop_reason: 'end_turn', is_error: false, result: 'done' },
})

const apiRetry = (attempt = 1): RoutedEngineEvent => ({
  type: 'system',
  data: { subtype: 'api_retry', attempt, maxRetries: 10, retryInMs: 500 },
})

const retryEnd = (success: boolean): RoutedEngineEvent => ({
  type: 'system',
  data: { subtype: 'auto_retry_end', success },
})

function setup() {
  const late: RoutedEngineEvent[] = []
  const bridge = new PiRetryBridge(event => late.push(event))
  return { bridge, late }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PiRetryBridge 分诊', () => {
  it('agent_end(error) 先到：错误扣住，auto_retry_start 放行 banner 后错误继续扣', () => {
    const { bridge, late } = setup()

    expect(bridge.feed(errorResult())).toEqual([])
    expect(bridge.feed(apiRetry(1))).toEqual([apiRetry(1)])

    // 越过 300ms 兜底窗口：已确认在重试，扣住的错误等结局，不得兜底放行
    vi.advanceTimersByTime(400)
    expect(late).toEqual([])
  })

  it('auto_retry_end(true) 恢复成功：丢弃扣住的错误，后续成功 result 正常结算', () => {
    const { bridge, late } = setup()

    bridge.feed(errorResult())
    bridge.feed(apiRetry(1))
    expect(bridge.feed(retryEnd(true))).toEqual([retryEnd(true)])
    expect(late).toEqual([])

    expect(bridge.feed(okResult())).toEqual([okResult()])
  })

  it('auto_retry_end(false) 预算耗尽：先 banner 事件再放行扣住的错误 result', () => {
    const { bridge, late } = setup()

    bridge.feed(errorResult())
    bridge.feed(apiRetry(2))
    // 横幅先收，错误卡片后落 —— 渲染层才能按这个顺序清 banner
    expect(bridge.feed(retryEnd(false))).toEqual([retryEnd(false), errorResult()])
    expect(late).toEqual([])
  })

  it('无重试事件：300ms 兜底窗口到点后放行错误 result', () => {
    const { bridge, late } = setup()

    expect(bridge.feed(errorResult())).toEqual([])

    vi.advanceTimersByTime(299)
    expect(late).toEqual([])

    vi.advanceTimersByTime(1)
    expect(late).toEqual([errorResult()])
  })

  it('成功 result 直接放行并清理重试状态', () => {
    const { bridge, late } = setup()

    bridge.feed(apiRetry(1))
    expect(bridge.feed(okResult())).toEqual([okResult()])
    expect(late).toEqual([])

    // 重试状态已清：下一个错误 result 回到「无重试 → 兜底放行」的路径
    bridge.feed(errorResult())
    vi.advanceTimersByTime(300)
    expect(late).toEqual([errorResult()])
  })

  it('dispose 丢弃扣住的错误且兜底定时器不再触发', () => {
    const { bridge, late } = setup()

    bridge.feed(errorResult())
    bridge.dispose()

    vi.advanceTimersByTime(1000)
    expect(late).toEqual([])

    // 扣住的错误已作废：之后的 auto_retry_end(false) 只放 banner，不补发错误
    expect(bridge.feed(retryEnd(false))).toEqual([retryEnd(false)])
  })

  it('api_retry 先到的帧序：扣住的错误不设兜底，等 auto_retry_end 分诊', () => {
    const { bridge, late } = setup()

    expect(bridge.feed(apiRetry(1))).toEqual([apiRetry(1)])
    expect(bridge.feed(errorResult())).toEqual([])

    vi.advanceTimersByTime(1000)
    expect(late).toEqual([])

    expect(bridge.feed(retryEnd(false))).toEqual([retryEnd(false), errorResult()])
  })

  it('exit/error 引擎级事件作废扣住的错误，避免双报', () => {
    const { bridge, late } = setup()

    bridge.feed(errorResult())
    const exit: RoutedEngineEvent = { type: 'exit', data: { code: 0 } }
    expect(bridge.feed(exit)).toEqual([exit])

    vi.advanceTimersByTime(1000)
    expect(late).toEqual([])
    expect(bridge.feed(retryEnd(false))).toEqual([retryEnd(false)])
  })

  it('auto_retry_end(false) 到达时无扣住的错误：只放 banner 事件', () => {
    const { bridge } = setup()

    expect(bridge.feed(retryEnd(false))).toEqual([retryEnd(false)])
  })
})
