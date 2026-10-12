/**
 * callCache — trace call 详情的进程内缓存。
 * 验证终态缓存、pending 不缓存、API 失败兜底、缓存 key 隔离、清空语义。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchTraceCallDetail, clearTraceCallCache } from '@/lib/trace/callCache'
import type { TraceCallRecord } from '@/types/trace'

const mocks = vi.hoisted(() => ({
  getTraceCall: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: { trace: { getTraceCall: mocks.getTraceCall } },
}))

function makeCall(partial: Partial<TraceCallRecord>): TraceCallRecord {
  return {
    id: 'call-1',
    sessionId: 'sess-1',
    source: 'anthropic',
    startedAt: '2024-01-01T00:00:00Z',
    request: { method: 'POST', url: 'https://api.anthropic.com', headers: {}, body: {} as any },
    ...partial,
  }
}

describe('fetchTraceCallDetail', () => {
  beforeEach(() => {
    clearTraceCallCache()
    mocks.getTraceCall.mockReset()
  })

  it('API 返回的 call 为 null / undefined 时回 null', async () => {
    mocks.getTraceCall.mockResolvedValueOnce({ call: null })
    expect(await fetchTraceCallDetail('s1', 'c1')).toBeNull()

    mocks.getTraceCall.mockResolvedValueOnce(undefined)
    expect(await fetchTraceCallDetail('s1', 'c1')).toBeNull()
  })

  it('API 抛错时吞掉并返回 null', async () => {
    mocks.getTraceCall.mockRejectedValueOnce(new Error('network down'))
    expect(await fetchTraceCallDetail('s1', 'c1')).toBeNull()
  })

  it('status=ok 视为终态并缓存（第二次调用不再请求 API）', async () => {
    const call = makeCall({ status: 'ok' })
    mocks.getTraceCall.mockResolvedValueOnce({ call })

    expect(await fetchTraceCallDetail('s1', 'c1')).toBe(call)
    expect(await fetchTraceCallDetail('s1', 'c1')).toBe(call)
    expect(mocks.getTraceCall).toHaveBeenCalledTimes(1)
  })

  it('status=error 视为终态并缓存', async () => {
    const call = makeCall({ status: 'error' })
    mocks.getTraceCall.mockResolvedValueOnce({ call })

    await fetchTraceCallDetail('s1', 'c1')
    await fetchTraceCallDetail('s1', 'c1')
    expect(mocks.getTraceCall).toHaveBeenCalledTimes(1)
  })

  it('status=pending 不缓存（每次调用都重新拉取）', async () => {
    const pending = makeCall({ status: 'pending' })
    mocks.getTraceCall.mockResolvedValue({ call: pending })

    await fetchTraceCallDetail('s1', 'c1')
    await fetchTraceCallDetail('s1', 'c1')
    expect(mocks.getTraceCall).toHaveBeenCalledTimes(2)
  })

  it('status 缺失但有 response 视为终态并缓存', async () => {
    const call = makeCall({
      response: { status: 200, headers: {}, body: {} as any },
    })
    mocks.getTraceCall.mockResolvedValueOnce({ call })

    await fetchTraceCallDetail('s1', 'c1')
    await fetchTraceCallDetail('s1', 'c1')
    expect(mocks.getTraceCall).toHaveBeenCalledTimes(1)
  })

  it('status 缺失但有 error 视为终态并缓存', async () => {
    const call = makeCall({
      error: { name: 'Error', message: 'boom' },
    })
    mocks.getTraceCall.mockResolvedValueOnce({ call })

    await fetchTraceCallDetail('s1', 'c1')
    await fetchTraceCallDetail('s1', 'c1')
    expect(mocks.getTraceCall).toHaveBeenCalledTimes(1)
  })

  it('status 缺失且无 response / error 视为非终态，不缓存', async () => {
    const call = makeCall({})
    mocks.getTraceCall.mockResolvedValue({ call })

    await fetchTraceCallDetail('s1', 'c1')
    await fetchTraceCallDetail('s1', 'c1')
    expect(mocks.getTraceCall).toHaveBeenCalledTimes(2)
  })

  it('不同 sessionId / callId 缓存隔离', async () => {
    const callA = makeCall({ id: 'c1', sessionId: 's1', status: 'ok' })
    const callB = makeCall({ id: 'c2', sessionId: 's1', status: 'ok' })
    const callC = makeCall({ id: 'c1', sessionId: 's2', status: 'ok' })
    mocks.getTraceCall
      .mockResolvedValueOnce({ call: callA })
      .mockResolvedValueOnce({ call: callB })
      .mockResolvedValueOnce({ call: callC })

    expect(await fetchTraceCallDetail('s1', 'c1')).toBe(callA)
    expect(await fetchTraceCallDetail('s1', 'c2')).toBe(callB)
    expect(await fetchTraceCallDetail('s2', 'c1')).toBe(callC)
    expect(mocks.getTraceCall).toHaveBeenCalledTimes(3)
  })

  it('clearTraceCallCache 清空后重新拉取', async () => {
    const call = makeCall({ status: 'ok' })
    mocks.getTraceCall.mockResolvedValue({ call })

    await fetchTraceCallDetail('s1', 'c1')
    expect(mocks.getTraceCall).toHaveBeenCalledTimes(1)

    clearTraceCallCache()

    await fetchTraceCallDetail('s1', 'c1')
    expect(mocks.getTraceCall).toHaveBeenCalledTimes(2)
  })
})
