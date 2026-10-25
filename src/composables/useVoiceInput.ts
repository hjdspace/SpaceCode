/**
 * useVoiceInput —— 把无框架的 VoiceDictation 接到 Vue 与默认适配器上。
 *
 * 组合式只做三件事：把状态机的结果变成 ref、把 IPC/采音/模型的默认实现接好、
 * 在组件作用域结束时释放麦克风与会话。文案不进这里，由调用方按 hint.code 翻译。
 */
import { computed, onScopeDispose, ref } from 'vue'
import { api } from '@/services/electronAPI'
import { isH5Mode } from '@/services/h5ApiClient'
import { createBrowserVoiceCapture } from '@/lib/voice/browserCapture'
import {
  VOICE_ACTIVE_STATES,
  VoiceDictation,
  type VoiceCapturePort,
  type VoiceComposerTarget,
  type VoiceFailureCode,
  type VoiceInputState,
  type VoiceOutcome,
  type VoiceSessionPort,
} from '@/lib/voice/voiceDictation'
import type { VoiceSilenceTracker } from '@/lib/voice/silenceTracker'
import type {
  VoiceInstallResult,
  VoiceModelInstallInfo,
  VoiceModelProgress,
  VoiceModelStatus,
} from '@/shared/channels/voice'

/** 无语音这类"没有发生错误但需要告知"的提示多留一会儿。 */
export const VOICE_NOTICE_HINT_MS = 5_000
export const VOICE_ERROR_HINT_MS = 6_000

/** 点击麦克风后模型是否可以直接开始录音。 */
export type VoiceModelReadiness = 'ready' | 'needs-install' | 'busy' | 'failed'

export type VoiceInputHintCode = VoiceFailureCode | 'no-speech' | 'model-busy' | 'installing' | 'install-failed'

export interface VoiceInputHint {
  kind: 'info' | 'error'
  code: VoiceInputHintCode
  /** 安装进度百分比；仅 code === 'installing' 时存在。 */
  progress?: number
  /** 引擎或采音返回的原始消息，供兜底展示。 */
  detail?: string
}

export interface VoiceModelPort {
  getStatus(): Promise<VoiceModelStatus>
  getInstallInfo(): Promise<VoiceModelInstallInfo>
  install(): Promise<VoiceInstallResult>
  onProgress(handler: (progress: VoiceModelProgress) => void): () => void
}

/** H5 与移动端没有 Electron 桥，也没有主进程识别会话，因此不提供录音。 */
export function isVoiceInputSupported(): boolean {
  if (typeof window === 'undefined') return false
  if (isH5Mode()) return false
  return !!window.electronAPI
}

export function createRendererVoiceSessionPort(): VoiceSessionPort {
  return {
    startSession: (sessionId) => api.voice.startSession({ sessionId }),
    sendAudio: (sessionId, samples) => {
      const pcm = samples.buffer.slice(
        samples.byteOffset,
        samples.byteOffset + samples.byteLength,
      ) as ArrayBuffer
      api.voice.sendAudio({ sessionId, pcm })
    },
    stopSession: (sessionId) => api.voice.stopSession({ sessionId }),
    cancelSession: (sessionId) => api.voice.cancelSession({ sessionId }),
    onPartial: (handler) => api.voice.onPartial(handler),
    onSessionState: (handler) => api.voice.onSessionState(handler),
  }
}

export function createRendererVoiceModelPort(): VoiceModelPort {
  return {
    getStatus: () => api.voice.getModelStatus(),
    getInstallInfo: () => api.voice.getInstallInfo(),
    install: () => api.voice.installModel(),
    onProgress: (handler) => api.voice.onModelProgress(handler),
  }
}

export interface UseVoiceInputOptions {
  target: () => VoiceComposerTarget
  capture?: VoiceCapturePort
  session?: VoiceSessionPort
  model?: VoiceModelPort
  createSessionId?: () => string
  /** 输入框已发送/优化中/禁用时不允许开始。 */
  canStart?: () => boolean
  supported?: () => boolean
  silence?: VoiceSilenceTracker
}

export function useVoiceInput(options: UseVoiceInputOptions) {
  const supported = computed(() => (options.supported ?? isVoiceInputSupported)())
  const model = options.model ?? createRendererVoiceModelPort()

  const state = ref<VoiceInputState>('idle')
  const liveTranscript = ref('')
  const hint = ref<VoiceInputHint | null>(null)
  const installing = ref(false)

  let disposed = false
  let hintTimer: ReturnType<typeof setTimeout> | undefined

  function clearHintTimer() {
    if (!hintTimer) return
    clearTimeout(hintTimer)
    hintTimer = undefined
  }

  function clearHint() {
    clearHintTimer()
    hint.value = null
  }

  function setHint(next: VoiceInputHint, autoClearMs = 0) {
    clearHintTimer()
    hint.value = next
    if (autoClearMs > 0) {
      hintTimer = setTimeout(() => {
        hintTimer = undefined
        hint.value = null
      }, autoClearMs)
    }
  }

  const dictation = new VoiceDictation({
    capture: options.capture ?? createBrowserVoiceCapture(),
    session: options.session ?? createRendererVoiceSessionPort(),
    target: options.target,
    createSessionId: options.createSessionId,
    canStart: options.canStart,
    silence: options.silence,
    onStateChange: (next) => {
      state.value = next
      if (next === 'idle' || next === 'failed') liveTranscript.value = ''
    },
    onLiveTranscript: (text) => {
      liveTranscript.value = text
    },
    onOutcome: (outcome) => {
      if (disposed) return
      if (outcome.kind === 'failed') {
        setHint({ kind: 'error', code: outcome.code, detail: outcome.message }, VOICE_ERROR_HINT_MS)
        return
      }
      if (outcome.kind === 'no-speech') {
        setHint({ kind: 'info', code: 'no-speech' }, VOICE_NOTICE_HINT_MS)
        return
      }
      clearHint()
    },
  })

  const isActive = computed(() => VOICE_ACTIVE_STATES.includes(state.value))

  async function prepare(): Promise<VoiceModelReadiness> {
    if (!supported.value) return 'failed'
    try {
      const status = await model.getStatus()
      if (status.state === 'installed') return 'ready'
      if (
        status.state === 'downloading' ||
        status.state === 'verifying' ||
        status.state === 'extracting'
      ) {
        return 'busy'
      }
      return 'needs-install'
    } catch (error) {
      if (!disposed) {
        setHint({ kind: 'error', code: 'engine-failed', detail: errorMessage(error) }, VOICE_ERROR_HINT_MS)
      }
      return 'failed'
    }
  }

  function getInstallInfo(): Promise<VoiceModelInstallInfo> {
    return model.getInstallInfo()
  }

  async function install(): Promise<boolean> {
    if (installing.value) return false
    installing.value = true
    setHint({ kind: 'info', code: 'installing', progress: 0 })

    const unsubscribe = model.onProgress((progress) => {
      if (disposed) return
      setHint({ kind: 'info', code: 'installing', progress: progress.percent })
    })

    try {
      const result = await model.install()
      if (disposed) return result.success
      if (!result.success) {
        setHint(
          {
            kind: 'error',
            code: result.errorCode === 'busy' ? 'model-busy' : 'install-failed',
            detail: result.error,
          },
          VOICE_ERROR_HINT_MS,
        )
        return false
      }
      clearHint()
      return true
    } catch (error) {
      if (!disposed) {
        setHint({ kind: 'error', code: 'install-failed', detail: errorMessage(error) }, VOICE_ERROR_HINT_MS)
      }
      return false
    } finally {
      unsubscribe()
      installing.value = false
    }
  }

  async function start(): Promise<void> {
    if (disposed || !supported.value) return
    await dictation.start()
  }

  function stop(): Promise<void> {
    return dictation.stop()
  }

  function cancel(): Promise<void> {
    return dictation.cancel()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    clearHintTimer()
    dictation.dispose()
  }

  onScopeDispose(dispose)

  return {
    supported,
    state,
    isActive,
    liveTranscript,
    hint,
    installing,
    setHint,
    clearHint,
    prepare,
    getInstallInfo,
    install,
    start,
    stop,
    cancel,
    dispose,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
