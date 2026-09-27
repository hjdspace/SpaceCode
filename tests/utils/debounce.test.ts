import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { debounce, throttle, debounceWithImmediate } from '@/utils/debounce'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('debounce — 防抖', () => {
  it('delay 内只保留最后一次调用', () => {
    const fn = vi.fn()
    const wrapped = debounce(fn, 100)

    wrapped('a')
    wrapped('b')
    wrapped('c')
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })

  it('delay 之前再次调用会重置计时', () => {
    const fn = vi.fn()
    const wrapped = debounce(fn, 100)

    wrapped('a')
    vi.advanceTimersByTime(99)
    wrapped('b') // 重置计时
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
  })

  it('delay 到达后 fn 可再次触发新周期', () => {
    const fn = vi.fn()
    const wrapped = debounce(fn, 100)

    wrapped('a')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)

    wrapped('b')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('b')
  })

  it('透传多个参数', () => {
    const fn = vi.fn()
    const wrapped = debounce(fn, 50)
    wrapped(1, 'two', { three: 3 })
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledWith(1, 'two', { three: 3 })
  })
})

describe('throttle — 节流', () => {
  it('首次调用立即执行，limit 内后续调用被丢弃', () => {
    const fn = vi.fn()
    const wrapped = throttle(fn, 100)

    wrapped('a')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('a')

    wrapped('b')
    wrapped('c')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('limit 之后可再次立即执行', () => {
    const fn = vi.fn()
    const wrapped = throttle(fn, 100)

    wrapped('a')
    vi.advanceTimersByTime(100)
    wrapped('b')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('b')
  })

  it('limit 边界前 1ms 调用仍被丢弃', () => {
    const fn = vi.fn()
    const wrapped = throttle(fn, 100)

    wrapped('a')
    vi.advanceTimersByTime(99)
    wrapped('b')
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    wrapped('c')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('c')
  })

  it('throttle 不会延迟执行 trailing 调用（与 debounce 区分）', () => {
    const fn = vi.fn()
    const wrapped = throttle(fn, 100)

    wrapped('a')
    wrapped('b') // 被丢弃
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1) // 不会在 limit 结束补发 b
  })
})

describe('debounceWithImmediate — 带立即执行选项的防抖', () => {
  it('immediate=false 行为等同 debounce', () => {
    const fn = vi.fn()
    const wrapped = debounceWithImmediate(fn, 100, false)

    wrapped('a')
    wrapped('b')
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('b')
  })

  it('immediate=true 首次调用立即执行', () => {
    const fn = vi.fn()
    const wrapped = debounceWithImmediate(fn, 100, true)

    wrapped('a')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('a')
  })

  it('immediate=true 在计时窗口内再次调用不重复触发，计时到期不补发', () => {
    const fn = vi.fn()
    const wrapped = debounceWithImmediate(fn, 100, true)

    wrapped('a') // 立即执行
    wrapped('b') // 仅重置计时，不调用 fn
    wrapped('c')
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100)
    // immediate 模式下到期不再调用 fn
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('immediate=true 上一轮计时结束后再次调用重新立即执行', () => {
    const fn = vi.fn()
    const wrapped = debounceWithImmediate(fn, 100, true)

    wrapped('a')
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(100) // timeoutId 被清空
    wrapped('b')
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('b')
  })

  it('默认参数 immediate 等价于 false', () => {
    const fn = vi.fn()
    const wrapped = debounceWithImmediate(fn, 50)

    wrapped('a')
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
