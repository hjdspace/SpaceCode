/**
 * 录音会话状态机 —— 注入假采音与假 IPC 会话，只断言外部可观察结果：
 * 状态序列、发给主进程的音频、终稿/取消对编辑器的写入、迟到的会话事件。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VOICE_SAMPLE_RATE } from '@/shared/channels/voice'
import type {
  VoiceCancelSessionResult,
  VoicePartialPayload,
  VoiceSessionStatePayload,
  VoiceStartSessionResult,
  VoiceStopSessionResult,
} from '@/shared/channels/voice'
import {
  VoiceCaptureError,
  VoiceDictation,
  type VoiceCaptureHandlers,
  type VoiceCapturePort,
  type VoiceComposerTarget,
  type VoiceInputState,
  type VoiceOutcome,
  type VoiceSessionPort,
  type VoiceSnapshot,
} from '../voiceDictation'
import { VOICE_CHUNK_SAMPLES } from '../silenceTracker'

class FakeCapture implements VoiceCapturePort {
  handlers: VoiceCaptureHandlers | null = null
  startCalls = 0
  stopCalls = 0
  sampleRate = VOICE_SAMPLE_RATE
  startError: unknown = null

  async start(handlers: VoiceCaptureHandlers): Promise<{ sampleRate: number }> {
    this.startCalls++
    if (this.startError) throw this.startError
    this.handlers = handlers
    return { sampleRate: this.sampleRate }
  }

  stop(): void {
    this.stopCalls++
    this.handlers = null
  }

  emit(samples: Int16Array): void {
    this.handlers?.onChunk(samples)
  }

  fail(error: VoiceCaptureError): void {
    this.handlers?.onError(error)
  }
}

class FakeSession implements VoiceSessionPort {
  startResult: VoiceStartSessionResult = { ok: true, sampleRate: VOICE_SAMPLE_RATE }
  stopResult: VoiceStopSessionResult = { success: true, text: '' }
  startError: unknown = null
  started: string[] = []
  stopped: string[] = []
  canceled: string[] = []
  audio: Array<{ sessionId: string; samples: Int16Array }> = []

  private partialHandler: ((payload: VoicePartialPayload) => void) | null = null
  private stateHandler: ((payload: VoiceSessionStatePayload) => void) | null = null

  async startSession(sessionId: string): Promise<VoiceStartSessionResult> {
    this.started.push(sessionId)
    if (this.startError) throw this.startError
    return this.startResult
  }

  sendAudio(sessionId: string, samples: Int16Array): void {
    this.audio.push({ sessionId, samples })
  }

  async stopSession(sessionId: string): Promise<VoiceStopSessionResult> {
    this.stopped.push(sessionId)
    return this.stopResult
  }

  async cancelSession(sessionId: string): Promise<VoiceCancelSessionResult> {
    this.canceled.push(sessionId)
    return { success: true }
  }

  onPartial(handler: (payload: VoicePartialPayload) => void): () => void {
    this.partialHandler = handler
    return () => {
      if (this.partialHandler === handler) this.partialHandler = null
    }
  }

  onSessionState(handler: (payload: VoiceSessionStatePayload) => void): () => void {
    this.stateHandler = handler
    return () => {
      if (this.stateHandler === handler) this.stateHandler = null
    }
  }

  emitPartial(payload: VoicePartialPayload): void {
    this.partialHandler?.(payload)
  }

  emitState(payload: VoiceSessionStatePayload): void {
    this.stateHandler?.(payload)
  }
}

class FakeTarget implements VoiceComposerTarget {
  snapshot: VoiceSnapshot = {
    html: '<div>draft</div>',
    text: 'draft',
    focused: true,
    caret: { path: [0, 0], offset: 2 },
  }
  captures = 0
  frozen: VoiceSnapshot[] = []
  committed: Array<{ snapshot: VoiceSnapshot; finalText: string }> = []
  restored: VoiceSnapshot[] = []

  captureSnapshot(): VoiceSnapshot {
    this.captures++
    return { ...this.snapshot }
  }

  freeze(snapshot: VoiceSnapshot): void {
    this.frozen.push(snapshot)
  }

  commit(snapshot: VoiceSnapshot, finalText: string): void {
    this.committed.push({ snapshot, finalText })
  }

  restore(snapshot: VoiceSnapshot): void {
    this.restored.push(snapshot)
  }
}

const SESSION_ID = 'sid-1'

function silence(amplitude = 10): Int16Array {
  return new Int16Array(VOICE_CHUNK_SAMPLES).fill(amplitude)
}

function speech(): Int16Array {
  return new Int16Array(VOICE_CHUNK_SAMPLES).fill(2000)
}

function setup() {
  const capture = new FakeCapture()
  const session = new FakeSession()
  const target = new FakeTarget()
  const states: VoiceInputState[] = []
  const outcomes: VoiceOutcome[] = []
  const live: string[] = []

  const dictation = new VoiceDictation({
    capture,
    session,
    target: () => target,
    createSessionId: () => SESSION_ID,
    onStateChange: (state) => states.push(state),
    onLiveTranscript: (text) => live.push(text),
    onOutcome: (outcome) => outcomes.push(outcome),
  })

  return { dictation, capture, session, target, states, outcomes, live }
}

async function startRecording(context: ReturnType<typeof setup>) {
  await context.dictation.start()
  expect(context.dictation.state).toBe('recording')
}

describe('VoiceDictation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('开始录音：快照冻结 → 准备 → 请求权限 → 录音', async () => {
    const ctx = setup()
    await ctx.dictation.start()

    expect(ctx.states).toEqual(['preparing', 'requesting-permission', 'recording'])
    expect(ctx.target.captures).toBe(1)
    expect(ctx.target.frozen).toHaveLength(1)
    expect(ctx.session.started).toEqual([SESSION_ID])
  })

  it('录音中的 PCM 块送到主进程会话', async () => {
    const ctx = setup()
    await startRecording(ctx)

    const chunk = speech()
    ctx.capture.emit(chunk)

    expect(ctx.session.audio).toHaveLength(1)
    expect(ctx.session.audio[0].sessionId).toBe(SESSION_ID)
    expect(ctx.session.audio[0].samples).toBe(chunk)
  })

  it('重复 start 不会开启第二个会话', async () => {
    const ctx = setup()
    await startRecording(ctx)
    await ctx.dictation.start()

    expect(ctx.session.started).toHaveLength(1)
  })

  it('模型缺失时直接失败并恢复快照，不打开麦克风', async () => {
    const ctx = setup()
    ctx.session.startResult = {
      ok: false,
      sampleRate: VOICE_SAMPLE_RATE,
      errorCode: 'model-missing',
      error: 'missing',
    }

    await ctx.dictation.start()

    expect(ctx.dictation.state).toBe('failed')
    expect(ctx.outcomes).toEqual([{ kind: 'failed', code: 'model-missing', message: 'missing' }])
    expect(ctx.target.restored).toHaveLength(1)
    expect(ctx.capture.startCalls).toBe(0)
  })

  it('麦克风权限被拒：失败、取消会话并恢复草稿', async () => {
    const ctx = setup()
    ctx.capture.startError = new VoiceCaptureError('permission-denied')

    await ctx.dictation.start()

    expect(ctx.dictation.state).toBe('failed')
    expect(ctx.outcomes[0]).toMatchObject({ kind: 'failed', code: 'permission-denied' })
    expect(ctx.session.canceled).toEqual([SESSION_ID])
    expect(ctx.target.restored).toHaveLength(1)
  })

  it('实际采样率不是 16k：明确失败并释放采音', async () => {
    const ctx = setup()
    ctx.capture.sampleRate = 48_000

    await ctx.dictation.start()

    expect(ctx.outcomes[0]).toMatchObject({ kind: 'failed', code: 'sample-rate-mismatch' })
    expect(ctx.capture.stopCalls).toBe(1)
    expect(ctx.session.canceled).toEqual([SESSION_ID])
  })

  it('实时转写按会话 id 过滤，迟到的旧会话事件被丢弃', async () => {
    const ctx = setup()
    await startRecording(ctx)

    ctx.session.emitPartial({ sessionId: SESSION_ID, text: '你好' })
    ctx.session.emitPartial({ sessionId: 'stale', text: '旧会话' })
    expect(ctx.live).toEqual(['你好'])

    await ctx.dictation.cancel()
    ctx.session.emitPartial({ sessionId: SESSION_ID, text: '取消之后' })
    expect(ctx.live).toEqual(['你好'])
  })

  it('收口阶段仍接受当前会话的慢速 partial', async () => {
    const ctx = setup()
    await startRecording(ctx)

    const stopping = ctx.dictation.stop()
    ctx.session.emitPartial({ sessionId: SESSION_ID, text: '最后一版' })
    await stopping

    expect(ctx.live).toContain('最后一版')
  })

  it('停止只提交一次终稿，并把状态收回到 idle', async () => {
    const ctx = setup()
    await startRecording(ctx)
    ctx.session.stopResult = { success: true, text: '最终文本' }

    await Promise.all([ctx.dictation.stop(), ctx.dictation.stop()])

    expect(ctx.session.stopped).toEqual([SESSION_ID])
    expect(ctx.states).toContain('finalizing')
    expect(ctx.target.committed).toEqual([
      { snapshot: expect.objectContaining({ text: 'draft' }), finalText: '最终文本' },
    ])
    expect(ctx.outcomes).toEqual([{ kind: 'committed', text: '最终文本' }])
    expect(ctx.capture.stopCalls).toBe(1)
    expect(ctx.dictation.state).toBe('idle')
  })

  it('终稿为空时按未识别到语音收口，恢复到录音前的草稿', async () => {
    const ctx = setup()
    await startRecording(ctx)
    ctx.session.stopResult = { success: true, text: '' }

    await ctx.dictation.stop()

    expect(ctx.target.committed).toHaveLength(0)
    expect(ctx.target.restored).toHaveLength(1)
    expect(ctx.outcomes).toEqual([{ kind: 'no-speech' }])
    expect(ctx.dictation.state).toBe('idle')
  })

  it('连续 5 秒静音自动停止', async () => {
    const ctx = setup()
    await startRecording(ctx)
    ctx.session.stopResult = { success: true, text: '说完了' }

    for (let i = 0; i < 49; i++) ctx.capture.emit(silence())
    expect(ctx.session.stopped).toHaveLength(0)

    ctx.capture.emit(silence())
    await vi.waitFor(() => expect(ctx.session.stopped).toEqual([SESSION_ID]))
    await vi.waitFor(() => expect(ctx.target.committed).toHaveLength(1))
  })

  it('中途说话会让 5 秒静音计时重新开始', async () => {
    const ctx = setup()
    await startRecording(ctx)

    for (let i = 0; i < 49; i++) ctx.capture.emit(silence())
    ctx.capture.emit(speech())
    for (let i = 0; i < 49; i++) ctx.capture.emit(silence())
    expect(ctx.session.stopped).toHaveLength(0)

    ctx.capture.emit(silence())
    await vi.waitFor(() => expect(ctx.session.stopped).toEqual([SESSION_ID]))
  })

  it('取消恢复快照、不提交终稿，并释放会话', async () => {
    const ctx = setup()
    await startRecording(ctx)
    ctx.session.emitPartial({ sessionId: SESSION_ID, text: '说到一半' })

    await ctx.dictation.cancel()

    expect(ctx.target.committed).toHaveLength(0)
    expect(ctx.target.restored).toHaveLength(1)
    expect(ctx.session.canceled).toEqual([SESSION_ID])
    expect(ctx.capture.stopCalls).toBe(1)
    expect(ctx.outcomes).toEqual([{ kind: 'canceled' }])
    expect(ctx.dictation.state).toBe('idle')
  })

  it('准备期间取消：startSession 迟到完成后补发取消，释放主进程会话', async () => {
    const ctx = setup()
    let resolveStart!: (result: VoiceStartSessionResult) => void
    ctx.session.startSession = (sessionId) => {
      ctx.session.started.push(sessionId)
      return new Promise<VoiceStartSessionResult>((resolve) => {
        resolveStart = resolve
      })
    }

    const starting = ctx.dictation.start()
    expect(ctx.session.started).toEqual([SESSION_ID])

    // 取消先到：主进程会话尚未建立，这一次 cancelSession 只是空操作。
    await ctx.dictation.cancel()
    expect(ctx.session.canceled).toEqual([SESSION_ID])

    resolveStart({ ok: true, sampleRate: VOICE_SAMPLE_RATE })
    await starting

    // startSession 在取消之后才落地：不补发取消，引擎会常驻并挡住模型移除。
    expect(ctx.session.canceled).toEqual([SESSION_ID, SESSION_ID])
    expect(ctx.capture.startCalls).toBe(0)
    expect(ctx.dictation.state).toBe('idle')
  })

  it('主进程会话 failed 事件按 id 匹配后转入失败并恢复草稿', async () => {
    const ctx = setup()
    await startRecording(ctx)

    ctx.session.emitState({ sessionId: 'other', state: 'failed', errorCode: 'engine-failed' })
    expect(ctx.dictation.state).toBe('recording')

    ctx.session.emitState({
      sessionId: SESSION_ID,
      state: 'failed',
      errorCode: 'engine-failed',
      error: 'worker crashed',
    })

    expect(ctx.dictation.state).toBe('failed')
    expect(ctx.outcomes[0]).toMatchObject({ kind: 'failed', code: 'engine-failed' })
    expect(ctx.target.restored).toHaveLength(1)
  })

  it('录音中麦克风丢失：失败收口而不是卡在录音态', async () => {
    const ctx = setup()
    await startRecording(ctx)

    ctx.capture.fail(new VoiceCaptureError('device-unavailable'))

    expect(ctx.dictation.state).toBe('failed')
    expect(ctx.outcomes[0]).toMatchObject({ kind: 'failed', code: 'device-unavailable' })
    expect(ctx.session.canceled).toEqual([SESSION_ID])
    expect(ctx.target.restored).toHaveLength(1)
  })

  it('收口中主进程会话失败：丢弃将到的终稿并恢复快照', async () => {
    const ctx = setup()
    await startRecording(ctx)

    let resolveStop!: (result: VoiceStopSessionResult) => void
    ctx.session.stopSession = () =>
      new Promise<VoiceStopSessionResult>((resolve) => {
        resolveStop = resolve
      })

    const stopping = ctx.dictation.stop()
    expect(ctx.dictation.state).toBe('finalizing')

    ctx.session.emitState({
      sessionId: SESSION_ID,
      state: 'failed',
      errorCode: 'engine-failed',
      error: 'worker crashed',
    })
    expect(ctx.dictation.state).toBe('failed')
    expect(ctx.outcomes[0]).toMatchObject({ kind: 'failed', code: 'engine-failed' })
    expect(ctx.target.restored).toHaveLength(1)
    expect(ctx.dictation.liveTranscript).toBe('')

    // 收口请求在失败之后才落地：终稿必须被丢弃，不写回编辑器。
    resolveStop({ success: true, text: '不该提交' })
    await stopping

    expect(ctx.target.committed).toHaveLength(0)
    expect(ctx.dictation.state).toBe('failed')
  })

  it('失败后重复收口不会再产生第二份结果', async () => {
    const ctx = setup()
    ctx.capture.startError = new VoiceCaptureError('permission-denied')

    await ctx.dictation.start()
    await ctx.dictation.stop()
    await ctx.dictation.cancel()

    expect(ctx.outcomes).toHaveLength(1)
    expect(ctx.session.canceled).toEqual([SESSION_ID])
    expect(ctx.target.restored).toHaveLength(1)
  })

  it('失败后可以重新开始录音，无需重启应用', async () => {
    const ctx = setup()
    ctx.capture.startError = new VoiceCaptureError('device-unavailable')

    await ctx.dictation.start()
    expect(ctx.dictation.state).toBe('failed')

    ctx.capture.startError = null
    ctx.session.stopResult = { success: true, text: '第二段' }
    await startRecording(ctx)

    expect(ctx.session.started).toEqual([SESSION_ID, SESSION_ID])
    expect(ctx.target.frozen).toHaveLength(2)

    await ctx.dictation.stop()
    expect(ctx.target.committed).toEqual([
      { snapshot: expect.objectContaining({ text: 'draft' }), finalText: '第二段' },
    ])
    expect(ctx.dictation.state).toBe('idle')
  })

  it('失败后重新开始时，上一次未落地的收口不会吞掉新的停止', async () => {
    const capture = new FakeCapture()
    const session = new FakeSession()
    const target = new FakeTarget()
    let sequence = 0
    const dictation = new VoiceDictation({
      capture,
      session,
      target: () => target,
      createSessionId: () => `sid-${++sequence}`,
    })

    await dictation.start()
    expect(dictation.state).toBe('recording')

    let resolveFirstStop!: (result: VoiceStopSessionResult) => void
    session.stopSession = () =>
      new Promise<VoiceStopSessionResult>((resolve) => {
        resolveFirstStop = resolve
      })
    const firstStop = dictation.stop()

    // worker 在收口中失败：会话转为失败态，旧收口请求仍在路上。
    session.emitState({
      sessionId: 'sid-1',
      state: 'failed',
      errorCode: 'engine-failed',
      error: 'worker crashed',
    })
    expect(dictation.state).toBe('failed')

    // 立刻重试并停止：必须走新的收口，而不是复用旧会话的 promise。
    session.stopSession = async (sessionId: string) => {
      session.stopped.push(sessionId)
      return { success: true, text: '新终稿' }
    }
    await dictation.start()
    expect(dictation.state).toBe('recording')
    await dictation.stop()

    expect(session.stopped).toEqual(['sid-2'])
    expect(target.committed).toEqual([
      { snapshot: expect.objectContaining({ text: 'draft' }), finalText: '新终稿' },
    ])

    resolveFirstStop({ success: true, text: '旧终稿' })
    await firstStop
    expect(target.committed).toHaveLength(1)
  })

  it('未知会话的新音频在停止后不再发送', async () => {
    const ctx = setup()
    await startRecording(ctx)
    await ctx.dictation.stop()

    ctx.capture.emit(speech())
    expect(ctx.session.audio).toHaveLength(0)
  })

  it('dispose 会取消进行中的录音并解除订阅', async () => {
    const ctx = setup()
    await startRecording(ctx)

    ctx.dictation.dispose()

    expect(ctx.session.canceled).toEqual([SESSION_ID])
    expect(ctx.capture.stopCalls).toBe(1)
    expect(ctx.target.restored).toHaveLength(1)

    ctx.session.emitPartial({ sessionId: SESSION_ID, text: '销毁之后' })
    expect(ctx.live).toHaveLength(0)
  })

  it('canStart 返回 false 时不开始会话', async () => {
    const capture = new FakeCapture()
    const session = new FakeSession()
    const target = new FakeTarget()
    const dictation = new VoiceDictation({
      capture,
      session,
      target: () => target,
      createSessionId: () => SESSION_ID,
      canStart: () => false,
    })

    await dictation.start()

    expect(dictation.state).toBe('idle')
    expect(session.started).toHaveLength(0)
    expect(target.captures).toBe(0)
  })
})
