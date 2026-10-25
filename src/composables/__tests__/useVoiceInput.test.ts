/**
 * useVoiceInput —— Vue 包装层：响应式状态/转写/hint，模型门禁与安装进度。
 */
import { describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import type {
  VoiceCaptureHandlers,
  VoiceCapturePort,
  VoiceComposerTarget,
  VoiceSessionPort,
  VoiceSnapshot,
} from '@/lib/voice/voiceDictation'
import { VoiceCaptureError } from '@/lib/voice/voiceDictation'
import type {
  VoiceInstallResult,
  VoiceModelInstallInfo,
  VoiceModelProgress,
  VoiceModelStatus,
  VoicePartialPayload,
  VoiceSessionStatePayload,
} from '@/shared/channels/voice'
import { isVoiceInputSupported, useVoiceInput, type VoiceModelPort } from '../useVoiceInput'

vi.mock('@/services/electronAPI', () => ({ api: { voice: {} } }))

const h5Mock = vi.hoisted(() => ({ mode: false }))
vi.mock('@/services/h5ApiClient', () => ({ isH5Mode: () => h5Mock.mode }))

function status(state: VoiceModelStatus['state']): VoiceModelStatus {
  return {
    state,
    version: null,
    installedBytes: 0,
    diskUsageBytes: 0,
    partialBytes: 0,
    archiveBytes: 0,
    archiveReady: false,
    installedTotalBytes: 0,
    installedAt: null,
  }
}

function createFakeModel(initial: VoiceModelStatus['state'] = 'installed') {
  let progressHandler: ((progress: VoiceModelProgress) => void) | null = null
  const install = vi.fn<() => Promise<VoiceInstallResult>>()
  const port: VoiceModelPort = {
    getStatus: vi.fn(async () => status(initial)),
    getInstallInfo: vi.fn(async (): Promise<VoiceModelInstallInfo> => ({
      version: '1.0.0',
      archiveBytes: 100,
      installedBytes: 200,
      archiveName: 'model.tar.bz2',
      sources: [],
    })),
    install,
    onProgress: vi.fn((handler) => {
      progressHandler = handler
      return () => {
        progressHandler = null
      }
    }),
  }
  return {
    port,
    install,
    emitProgress: (percent: number) => {
      progressHandler?.({ phase: 'downloading', transferred: percent, total: 100, percent })
    },
  }
}

function createFakeSession() {
  let partial: ((payload: VoicePartialPayload) => void) | null = null
  let sessionState: ((payload: VoiceSessionStatePayload) => void) | null = null
  const stopSession = vi.fn(async () => ({ success: true, text: '你好世界' }))
  const port: VoiceSessionPort = {
    startSession: vi.fn(async () => ({ ok: true, sampleRate: 16_000 })),
    sendAudio: vi.fn(),
    stopSession,
    cancelSession: vi.fn(async () => ({ success: true })),
    onPartial: (handler) => {
      partial = handler
      return () => {
        partial = null
      }
    },
    onSessionState: (handler) => {
      sessionState = handler
      return () => {
        sessionState = null
      }
    },
  }
  return {
    port,
    stopSession,
    emitPartial: (text: string, sessionId = 's1') => partial?.({ sessionId, text }),
    emitState: (payload: VoiceSessionStatePayload) => sessionState?.(payload),
  }
}

function createFakeCapture(
  behaviour: { startError?: VoiceCaptureError; sampleRate?: number } = {},
) {
  let handlers: VoiceCaptureHandlers | null = null
  const port: VoiceCapturePort = {
    start: vi.fn(async (next: VoiceCaptureHandlers) => {
      if (behaviour.startError) throw behaviour.startError
      handlers = next
      return { sampleRate: behaviour.sampleRate ?? 16_000 }
    }),
    stop: vi.fn(() => {
      handlers = null
    }),
  }
  return {
    port,
    push: (samples: Int16Array) => handlers?.onChunk(samples),
  }
}

const SNAPSHOT: VoiceSnapshot = {
  html: '<p>草稿</p>',
  text: '草稿',
  focused: true,
  caret: { path: [0], offset: 2 },
}

function createFakeTarget() {
  const target: VoiceComposerTarget = {
    captureSnapshot: vi.fn(() => SNAPSHOT),
    freeze: vi.fn(),
    commit: vi.fn(),
    restore: vi.fn(),
  }
  return target
}

function setup(overrides: {
  model?: ReturnType<typeof createFakeModel>
  session?: ReturnType<typeof createFakeSession>
  capture?: ReturnType<typeof createFakeCapture>
} = {}) {
  const scope = effectScope()
  const model = overrides.model ?? createFakeModel()
  const session = overrides.session ?? createFakeSession()
  const capture = overrides.capture ?? createFakeCapture()
  const target = createFakeTarget()
  const voice = scope.run(() =>
    useVoiceInput({
      target: () => target,
      capture: capture.port,
      session: session.port,
      model: model.port,
      createSessionId: () => 's1',
      supported: () => true,
    }),
  )!
  return { voice, scope, model, session, capture, target }
}

describe('useVoiceInput', () => {
  it('reports model readiness before recording', async () => {
    const installed = setup()
    await expect(installed.voice.prepare()).resolves.toBe('ready')

    const missing = setup({ model: createFakeModel('missing') })
    await expect(missing.voice.prepare()).resolves.toBe('needs-install')

    const corrupted = setup({ model: createFakeModel('corrupted') })
    await expect(corrupted.voice.prepare()).resolves.toBe('needs-install')

    const busy = setup({ model: createFakeModel('downloading') })
    await expect(busy.voice.prepare()).resolves.toBe('busy')
  })

  it('installs the model with live progress and clears the hint on success', async () => {
    const { voice, model } = setup({ model: createFakeModel('missing') })
    let resolveInstall: (result: VoiceInstallResult) => void = () => {}
    model.install.mockReturnValue(
      new Promise<VoiceInstallResult>((resolve) => {
        resolveInstall = resolve
      }),
    )

    const pending = voice.install()
    expect(voice.installing.value).toBe(true)
    expect(voice.hint.value).toMatchObject({ kind: 'info', code: 'installing' })

    model.emitProgress(42)
    expect(voice.hint.value?.progress).toBe(42)

    resolveInstall({ success: true, status: status('installed') })
    await expect(pending).resolves.toBe(true)
    expect(voice.installing.value).toBe(false)
    expect(voice.hint.value).toBeNull()
  })

  it('turns an install rejected as busy into a model-busy hint', async () => {
    const { voice, model } = setup({ model: createFakeModel('missing') })
    model.install.mockResolvedValue({
      success: false,
      errorCode: 'busy',
      status: status('downloading'),
    })

    await expect(voice.install()).resolves.toBe(false)
    expect(voice.hint.value).toMatchObject({ kind: 'error', code: 'model-busy' })
  })

  it('records, streams partials and commits the final transcript once', async () => {
    const { voice, session, capture, target } = setup()

    await voice.start()
    expect(voice.state.value).toBe('recording')
    expect(target.freeze).toHaveBeenCalledWith(SNAPSHOT)

    session.emitPartial('你好')
    expect(voice.liveTranscript.value).toBe('你好')

    capture.push(new Int16Array(1600))
    expect(session.port.sendAudio).toHaveBeenCalledTimes(1)

    await voice.stop()
    expect(target.commit).toHaveBeenCalledTimes(1)
    expect(target.commit).toHaveBeenCalledWith(SNAPSHOT, '你好世界')
    expect(voice.state.value).toBe('idle')
    expect(voice.liveTranscript.value).toBe('')
  })

  it('drops partials from a previous session', async () => {
    const { voice, session } = setup()
    await voice.start()
    session.emitPartial('迟到的', 'older-session')
    expect(voice.liveTranscript.value).toBe('')
  })

  it('maps capture failures to an actionable error hint and restores the draft', async () => {
    const capture = createFakeCapture({
      startError: new VoiceCaptureError('permission-denied', 'denied'),
    })
    const { voice, target } = setup({ capture })

    await voice.start()
    expect(voice.state.value).toBe('failed')
    expect(voice.hint.value).toMatchObject({ kind: 'error', code: 'permission-denied' })
    expect(target.restore).toHaveBeenCalledWith(SNAPSHOT)
  })

  it('ends with a no-speech hint when the final transcript is blank', async () => {
    const session = createFakeSession()
    session.stopSession.mockResolvedValue({ success: true, text: '   ' })
    const { voice, target } = setup({ session })

    await voice.start()
    await voice.stop()

    expect(target.commit).not.toHaveBeenCalled()
    expect(target.restore).toHaveBeenCalledWith(SNAPSHOT)
    expect(voice.hint.value).toMatchObject({ kind: 'info', code: 'no-speech' })
  })

  it('cancels and releases resources when the scope is disposed mid-recording', async () => {
    const { voice, scope, capture, session } = setup()
    await voice.start()

    scope.stop()

    expect(capture.port.stop).toHaveBeenCalled()
    expect(session.port.cancelSession).toHaveBeenCalledWith('s1')
    expect(voice.state.value).toBe('idle')
  })

  it('does not start when unsupported', async () => {
    const scope = effectScope()
    const session = createFakeSession()
    const voice = scope.run(() =>
      useVoiceInput({
        target: createFakeTarget,
        session: session.port,
        model: createFakeModel().port,
        supported: () => false,
      }),
    )!

    await voice.start()
    expect(voice.state.value).toBe('idle')
    expect(session.port.startSession).not.toHaveBeenCalled()
    scope.stop()
  })
})

describe('isVoiceInputSupported', () => {
  it('requires the Electron bridge and excludes H5 mode', () => {
    const scope = window as unknown as { electronAPI?: unknown }
    delete scope.electronAPI
    h5Mock.mode = false
    expect(isVoiceInputSupported()).toBe(false)

    scope.electronAPI = {}
    expect(isVoiceInputSupported()).toBe(true)

    h5Mock.mode = true
    expect(isVoiceInputSupported()).toBe(false)
    h5Mock.mode = false
    delete scope.electronAPI
  })
})
