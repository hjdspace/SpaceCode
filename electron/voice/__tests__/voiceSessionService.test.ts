// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  VoicePartialPayload,
  VoiceSessionState,
  VoiceSessionStatePayload,
} from '@/shared/channels/voice'
import type { VoiceEngine, VoiceEngineHandlers } from '../voiceEngine'
import { VoiceSessionService, type VoiceModelAvailability } from '../voiceSessionService'

/**
 * The session service is the only owner of recording lifecycle in the main
 * process. Everything asserted here is visible through the injected engine and
 * the emitted wire events:
 *
 *   - one session at a time: starting a new one cancels the old;
 *   - model state is checked before the engine is ever created;
 *   - audio is delivered to the engine in arrival order, including audio that
 *     arrived while the model was still loading;
 *   - stop waits for every accepted chunk before it asks for the final
 *     transcript; cancel never asks for one;
 *   - unknown or already-finished session ids are silently ignored;
 *   - an engine failure fails the current session, resolves any pending stop,
 *     and the next start creates a fresh engine.
 */

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

class FakeEngine implements VoiceEngine {
  readonly startCalls: string[] = []
  readonly sent: Int16Array[] = []
  stopCalls = 0
  cancelCalls = 0
  disposeCalls = 0
  throwOnStart: Error | null = null

  private readonly startDeferred = deferred<void>()
  private stopDeferred: ReturnType<typeof deferred<string>> | null = null

  constructor(private readonly handlers: VoiceEngineHandlers) {}

  start(modelDir: string): Promise<void> {
    this.startCalls.push(modelDir)
    if (this.throwOnStart) throw this.throwOnStart
    return this.startDeferred.promise
  }

  ready(): void {
    this.startDeferred.resolve()
  }

  failStart(error: Error): void {
    this.startDeferred.reject(error)
  }

  sendAudio(samples: Int16Array): void {
    this.sent.push(samples)
  }

  stop(): Promise<string> {
    this.stopCalls += 1
    this.stopDeferred = deferred<string>()
    return this.stopDeferred.promise
  }

  finish(text: string): void {
    this.stopDeferred?.resolve(text)
  }

  cancel(): void {
    this.cancelCalls += 1
    // 真实 worker 适配器用空串 resolve 在途的 stop；这里保持同样的形状。
    const pendingStop = this.stopDeferred
    this.stopDeferred = null
    pendingStop?.resolve('')
  }

  dispose(): void {
    this.disposeCalls += 1
  }

  emitPartial(text: string): void {
    this.handlers.onPartial(text)
  }

  emitFailure(error: Error): void {
    this.stopDeferred?.reject(error)
    this.handlers.onFailure(error)
  }
}

function chunk(...values: number[]): Int16Array {
  return Int16Array.from(values)
}

function makeHarness(modelState: VoiceModelAvailability = 'installed') {
  const engines: FakeEngine[] = []
  let currentState = modelState
  let probeFailure: Error | null = null
  let nextStartThrow: Error | null = null
  const service = new VoiceSessionService({
    probe: {
      inspect: async () => {
        if (probeFailure) throw probeFailure
        return { state: currentState, modelDir: `C:/voice/model` }
      },
    },
    engineFactory: {
      create(handlers) {
        const engine = new FakeEngine(handlers)
        engine.throwOnStart = nextStartThrow
        nextStartThrow = null
        engines.push(engine)
        return engine
      },
    },
  })
  const states: VoiceSessionStatePayload[] = []
  const partials: VoicePartialPayload[] = []
  service.on('state', (payload: VoiceSessionStatePayload) => states.push(payload))
  service.on('partial', (payload: VoicePartialPayload) => partials.push(payload))
  return {
    service,
    engines,
    states,
    partials,
    setModelState(next: VoiceModelAvailability): void {
      currentState = next
    },
    failProbe(error: Error): void {
      probeFailure = error
    },
    throwNextStart(error: Error): void {
      nextStartThrow = error
    },
  }
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timeout waiting for condition')
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function startRecording(
  harness: ReturnType<typeof makeHarness>,
  sessionId: string,
): Promise<FakeEngine> {
  const starting = harness.service.startSession(sessionId)
  await waitFor(() => harness.engines.length > 0)
  const engine = harness.engines[harness.engines.length - 1]
  engine.ready()
  await expect(starting).resolves.toMatchObject({ ok: true, sampleRate: 16_000 })
  return engine
}

function statesOf(states: VoiceSessionStatePayload[], sessionId: string): VoiceSessionState[] {
  return states.filter((payload) => payload.sessionId === sessionId).map((payload) => payload.state)
}

describe('VoiceSessionService', () => {
  beforeEach(() => {
    // Every assertion works against a fresh service; nothing is shared.
  })

  it('loads the model, emits loading then recording, and reports the PCM sample rate', async () => {
    const harness = makeHarness()
    const engine = await startRecording(harness, 's1')

    expect(engine.startCalls).toEqual(['C:/voice/model'])
    expect(statesOf(harness.states, 's1')).toEqual(['loading', 'recording'])
    expect(harness.service.isRecording()).toBe(true)
  })

  it.each([
    ['missing', 'model-missing'],
    ['corrupted', 'model-corrupted'],
  ] as const)(
    'refuses to start on a %s model without creating an engine',
    async (modelState, errorCode) => {
      const harness = makeHarness(modelState)

      const result = await harness.service.startSession('s1')

      expect(result).toMatchObject({ ok: false, errorCode })
      expect(result.error).toBeTruthy()
      expect(harness.engines).toHaveLength(0)
      expect(harness.states).toEqual([
        expect.objectContaining({ sessionId: 's1', state: 'failed', errorCode }),
      ])
      expect(harness.service.isRecording()).toBe(false)
    },
  )

  it('delivers audio chunks in arrival order and forwards partials for the active session', async () => {
    const harness = makeHarness()
    const engine = await startRecording(harness, 's1')

    harness.service.sendAudio('s1', chunk(1, 2, 3))
    harness.service.sendAudio('s1', chunk(4, 5))
    engine.emitPartial('你')
    engine.emitPartial('你好')

    expect(engine.sent.map((samples) => Array.from(samples))).toEqual([
      [1, 2, 3],
      [4, 5],
    ])
    expect(harness.partials).toEqual([
      { sessionId: 's1', text: '你' },
      { sessionId: 's1', text: '你好' },
    ])
  })

  it('waits for the model to load before forwarding audio, keeping it queued in order', async () => {
    const harness = makeHarness()
    const starting = harness.service.startSession('s1')
    await waitFor(() => harness.engines.length === 1)
    const engine = harness.engines[0]

    harness.service.sendAudio('s1', chunk(1, 2))
    harness.service.sendAudio('s1', chunk(3, 4))
    expect(engine.sent).toHaveLength(0)

    engine.ready()
    await starting

    expect(engine.sent.map((samples) => Array.from(samples))).toEqual([
      [1, 2],
      [3, 4],
    ])
  })

  it('feeds every accepted chunk before finalizing and returns the engine transcript', async () => {
    const harness = makeHarness()
    const engine = await startRecording(harness, 's1')

    harness.service.sendAudio('s1', chunk(1))
    harness.service.sendAudio('s1', chunk(2))

    const stopping = harness.service.stopSession('s1')
    await waitFor(() => engine.stopCalls === 1)
    expect(engine.sent).toHaveLength(2)

    engine.finish('你好 world')

    await expect(stopping).resolves.toEqual({ success: true, text: '你好 world' })
    expect(statesOf(harness.states, 's1')).toEqual([
      'loading',
      'recording',
      'finalizing',
      'ended',
    ])
    expect(harness.service.isRecording()).toBe(false)
  })

  it('never returns a transcript when the session is canceled and drops all audio', async () => {
    const harness = makeHarness()
    const engine = await startRecording(harness, 's1')

    harness.service.sendAudio('s1', chunk(1))
    const canceled = harness.service.cancelSession('s1')

    expect(canceled).toEqual({ success: true })
    expect(engine.cancelCalls).toBe(1)
    expect(engine.stopCalls).toBe(0)
    expect(statesOf(harness.states, 's1')).toEqual(['loading', 'recording', 'ended'])
    expect(harness.service.isRecording()).toBe(false)

    engine.emitPartial('late text')
    harness.service.sendAudio('s1', chunk(2))
    expect(harness.partials).toEqual([])
    expect(engine.sent).toHaveLength(1)
  })

  it('silently ignores audio and stop for unknown or finished sessions', async () => {
    const harness = makeHarness()

    expect(() => harness.service.sendAudio('ghost', chunk(1))).not.toThrow()
    await expect(harness.service.stopSession('ghost')).resolves.toEqual({
      success: true,
      text: '',
    })
    expect(harness.engines).toHaveLength(0)

    const engine = await startRecording(harness, 's1')
    const stopping = harness.service.stopSession('s1')
    harness.service.sendAudio('s1', chunk(2))
    await waitFor(() => engine.stopCalls === 1)
    engine.finish('done')
    await stopping

    expect(engine.sent).toHaveLength(0)
    expect(() => harness.service.sendAudio('s1', chunk(3))).not.toThrow()
    await expect(harness.service.stopSession('s1')).resolves.toEqual({
      success: true,
      text: '',
    })
  })

  it('cancels the previous session when a new one starts and keeps one engine', async () => {
    const harness = makeHarness()
    const first = await startRecording(harness, 's1')
    harness.service.sendAudio('s1', chunk(1))

    const engine = harness.engines[0]
    await expect(harness.service.startSession('s2')).resolves.toMatchObject({ ok: true })
    expect(harness.engines).toHaveLength(1)
    expect(engine).toBe(first)
    expect(first.cancelCalls).toBe(1)
    expect(statesOf(harness.states, 's1')).toEqual(['loading', 'recording', 'ended'])
    expect(statesOf(harness.states, 's2')).toEqual(['loading', 'recording'])

    harness.service.sendAudio('s1', chunk(2))
    harness.service.sendAudio('s2', chunk(3))
    expect(first.sent.map((samples) => Array.from(samples))).toEqual([[1], [3]])
  })

  it('fails the active session on engine failure and relaunches on the next start', async () => {
    const harness = makeHarness()
    const first = await startRecording(harness, 's1')

    first.emitFailure(new Error('worker exited'))

    expect(statesOf(harness.states, 's1')).toEqual(['loading', 'recording', 'failed'])
    expect(harness.states[harness.states.length - 1]).toMatchObject({
      sessionId: 's1',
      state: 'failed',
      error: 'worker exited',
      errorCode: 'engine-failed',
    })
    expect(first.disposeCalls).toBe(1)
    expect(harness.service.isRecording()).toBe(false)
    await expect(harness.service.stopSession('s1')).resolves.toEqual({
      success: true,
      text: '',
    })

    const second = await startRecording(harness, 's2')
    expect(harness.engines).toHaveLength(2)
    expect(second).not.toBe(first)
    expect(second.startCalls).toEqual(['C:/voice/model'])
  })

  it('reports a load failure, disposes the engine, and recovers on the next start', async () => {
    const harness = makeHarness()
    const starting = harness.service.startSession('s1')
    await waitFor(() => harness.engines.length === 1)
    const engine = harness.engines[0]

    engine.failStart(new Error('model aborted'))

    await expect(starting).resolves.toMatchObject({
      ok: false,
      errorCode: 'engine-failed',
      error: 'model aborted',
    })
    expect(statesOf(harness.states, 's1')).toEqual(['loading', 'failed'])
    expect(engine.disposeCalls).toBe(1)

    const retry = await startRecording(harness, 's2')
    expect(harness.engines).toHaveLength(2)
    expect(retry).not.toBe(engine)
  })

  it('resolves a pending stop with failure when the engine dies mid-finalize', async () => {
    const harness = makeHarness()
    const engine = await startRecording(harness, 's1')

    const stopping = harness.service.stopSession('s1')
    await waitFor(() => engine.stopCalls === 1)

    engine.emitFailure(new Error('worker crashed'))

    await expect(stopping).resolves.toMatchObject({
      success: false,
      text: '',
      errorCode: 'engine-failed',
    })
    expect(statesOf(harness.states, 's1')).toEqual([
      'loading',
      'recording',
      'finalizing',
      'failed',
    ])
  })

  it('reports a probe failure as a failed session instead of rejecting the IPC call', async () => {
    const harness = makeHarness()
    harness.failProbe(new Error('model directory unreadable'))

    const result = await harness.service.startSession('s1')

    expect(result).toMatchObject({
      ok: false,
      error: 'model directory unreadable',
      errorCode: 'engine-failed',
    })
    expect(statesOf(harness.states, 's1')).toEqual(['failed'])
    expect(harness.engines).toHaveLength(0)
  })

  it('cancels the previous session before probing the model for a new session', async () => {
    const harness = makeHarness()
    const engine = await startRecording(harness, 's1')
    harness.setModelState('missing')

    const result = await harness.service.startSession('s2')

    expect(result).toMatchObject({ ok: false, errorCode: 'model-missing' })
    expect(engine.cancelCalls).toBe(1)
    expect(statesOf(harness.states, 's1')).toEqual(['loading', 'recording', 'ended'])
    expect(harness.service.isRecording()).toBe(false)
  })

  it('fails the session when the engine throws synchronously while starting', async () => {
    const harness = makeHarness()
    harness.throwNextStart(new Error('worker spawn failed'))

    const result = await harness.service.startSession('s1')

    expect(result).toMatchObject({ ok: false, errorCode: 'engine-failed' })
    expect(statesOf(harness.states, 's1')).toEqual(['loading', 'failed'])
    expect(harness.engines[0].disposeCalls).toBe(1)
    expect(harness.service.isRecording()).toBe(false)
  })

  it('rejects non-Int16 audio payloads instead of reinterpreting their bytes', async () => {
    const harness = makeHarness()
    const engine = await startRecording(harness, 's1')

    harness.service.sendAudio('s1', new Float32Array([1, 2]))
    harness.service.sendAudio('s1', new Uint8Array([1, 2, 3]))
    harness.service.sendAudio('s1', new Uint8Array([1, 0, 2, 0]).buffer)

    expect(engine.sent.map((samples) => Array.from(samples))).toEqual([[1, 2]])
  })

  it('treats a stop that races a cancel as canceled rather than an empty transcript', async () => {
    const harness = makeHarness()
    const engine = await startRecording(harness, 's1')

    const stopping = harness.service.stopSession('s1')
    await waitFor(() => engine.stopCalls === 1)
    harness.service.cancelSession('s1')

    await expect(stopping).resolves.toMatchObject({
      success: false,
      text: '',
      errorCode: 'canceled',
    })
  })
})
