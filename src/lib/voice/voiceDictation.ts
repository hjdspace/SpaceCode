/**
 * 渲染层录音会话状态机 —— idle → preparing → requesting-permission → recording
 * → finalizing → idle，任一步可转入 failed。
 *
 * 它不认识 Vue、DOM 或 Electron：采音、主进程会话与目标输入框都是注入的。
 * 对外只有三类可观察结果 —— 状态、实时转写文本、终稿/取消/失败的收口结果。
 */
import {
  VOICE_SAMPLE_RATE,
  type VoiceCancelSessionResult,
  type VoicePartialPayload,
  type VoiceSessionErrorCode,
  type VoiceSessionStatePayload,
  type VoiceStartSessionResult,
  type VoiceStopSessionResult,
} from '@/shared/channels/voice'
import type { CaretSnapshot } from './caretSnapshot'
import { VoiceSilenceTracker } from './silenceTracker'

export type VoiceInputState =
  | 'idle'
  | 'preparing'
  | 'requesting-permission'
  | 'recording'
  | 'finalizing'
  | 'failed'

export type VoiceCaptureFailureCode =
  | 'permission-denied'
  | 'device-unavailable'
  | 'unsupported'
  | 'sample-rate-mismatch'

export type VoiceFailureCode = VoiceCaptureFailureCode | VoiceSessionErrorCode | 'capture-failed'

export class VoiceCaptureError extends Error {
  constructor(readonly code: VoiceCaptureFailureCode, message?: string) {
    super(message ?? code)
    this.name = 'VoiceCaptureError'
  }
}

export interface VoiceCaptureHandlers {
  onChunk(samples: Int16Array): void
  onError(error: VoiceCaptureError): void
  /** 逐帧 RMS（0..1），只用于录音电平动画，不参与识别。 */
  onLevel?(level: number): void
}

export interface VoiceCapturePort {
  /** 打开系统默认输入设备；实际采样率不是 16k 时必须抛 sample-rate-mismatch。 */
  start(handlers: VoiceCaptureHandlers): Promise<{ sampleRate: number }>
  stop(): void
}

export interface VoiceSessionPort {
  startSession(sessionId: string): Promise<VoiceStartSessionResult>
  sendAudio(sessionId: string, samples: Int16Array): void
  stopSession(sessionId: string): Promise<VoiceStopSessionResult>
  cancelSession(sessionId: string): Promise<VoiceCancelSessionResult>
  onPartial(handler: (payload: VoicePartialPayload) => void): () => void
  onSessionState(handler: (payload: VoiceSessionStatePayload) => void): () => void
}

/** 录音前冻结的输入框状态：内容、光标与焦点。 */
export interface VoiceSnapshot {
  html: string
  text: string
  focused: boolean
  caret?: CaretSnapshot | null
}

export interface VoiceComposerTarget {
  captureSnapshot(): VoiceSnapshot
  /** 录音开始：把编辑器置为只读，草稿原地保留。 */
  freeze(snapshot: VoiceSnapshot): void
  /** 停止：快照内容 + 终稿合并写入、恢复可编辑、光标置尾并聚焦。 */
  commit(snapshot: VoiceSnapshot, finalText: string): void
  /** 取消/失败/无语音：原样恢复快照。 */
  restore(snapshot: VoiceSnapshot): void
}

export type VoiceOutcome =
  | { kind: 'committed'; text: string }
  | { kind: 'canceled' }
  | { kind: 'no-speech' }
  | { kind: 'failed'; code: VoiceFailureCode; message?: string }

export interface VoiceDictationOptions {
  capture: VoiceCapturePort
  session: VoiceSessionPort
  /** 延迟取目标：ChatInput 的编辑器 ref 在 setup 之后才就绪。 */
  target: () => VoiceComposerTarget
  createSessionId?: () => string
  silence?: VoiceSilenceTracker
  /** 输入框自身不可提交（已发送/优化中/禁用）时不允许开始。 */
  canStart?: () => boolean
  onStateChange?: (state: VoiceInputState) => void
  onLiveTranscript?: (text: string) => void
  onLevel?: (level: number) => void
  onOutcome?: (outcome: VoiceOutcome) => void
}

export const VOICE_ACTIVE_STATES: readonly VoiceInputState[] = [
  'preparing',
  'requesting-permission',
  'recording',
  'finalizing',
]

export class VoiceDictation {
  private readonly capture: VoiceCapturePort
  private readonly silence: VoiceSilenceTracker
  private readonly unsubscribers: Array<() => void> = []

  private stateValue: VoiceInputState = 'idle'
  private sessionId: string | null = null
  private snapshot: VoiceSnapshot | null = null
  private live = ''
  private stopPromise: Promise<void> | null = null
  private disposed = false

  constructor(private readonly options: VoiceDictationOptions) {
    this.capture = options.capture
    this.silence = options.silence ?? new VoiceSilenceTracker()
    this.unsubscribers.push(options.session.onPartial(this.handlePartial))
    this.unsubscribers.push(options.session.onSessionState(this.handleSessionState))
  }

  get state(): VoiceInputState {
    return this.stateValue
  }

  get liveTranscript(): string {
    return this.live
  }

  get isActive(): boolean {
    return VOICE_ACTIVE_STATES.includes(this.stateValue)
  }

  async start(): Promise<void> {
    if (this.disposed) return
    if (this.stateValue !== 'idle' && this.stateValue !== 'failed') return
    if (this.options.canStart && !this.options.canStart()) return

    const sessionId = this.options.createSessionId?.() ?? crypto.randomUUID()
    this.sessionId = sessionId
    this.live = ''
    this.silence.reset()
    this.snapshot = this.options.target().captureSnapshot()

    // 先冻结再加载模型：等待期间草稿不可被键盘改动，快照才与显示一致。
    this.setState('preparing')
    this.options.target().freeze(this.snapshot)

    let started: VoiceStartSessionResult
    try {
      started = await this.options.session.startSession(sessionId)
    } catch (error) {
      if (this.sessionId !== sessionId) return
      this.fail('engine-failed', errorMessage(error))
      return
    }
    if (this.sessionId !== sessionId) {
      // 取消发生在 startSession 落地之前：主进程可能刚刚建好会话，
      // 之前的 cancelSession 只是空操作，这里补一次把引擎释放掉。
      if (started.ok) await this.options.session.cancelSession(sessionId).catch(() => {})
      return
    }

    if (!started.ok) {
      this.fail(mapSessionError(started.errorCode), started.error)
      return
    }

    this.setState('requesting-permission')
    try {
      const { sampleRate } = await this.capture.start({
        onChunk: this.handleChunk,
        onError: this.handleCaptureError,
        onLevel: this.options.onLevel,
      })
      // 等权限期间被取消/卸载：把已经打开的麦克风关掉。
      if (this.sessionId !== sessionId) {
        this.capture.stop()
        return
      }
      if (sampleRate !== VOICE_SAMPLE_RATE) {
        this.fail('sample-rate-mismatch')
        return
      }
    } catch (error) {
      if (this.sessionId !== sessionId) return
      this.fail(mapCaptureError(error), errorMessage(error))
      return
    }

    if (this.sessionId !== sessionId) {
      this.capture.stop()
      return
    }
    this.setState('recording')
  }

  stop(): Promise<void> {
    // 同一个收口过程只跑一次；失败后重开的新会话不能被旧的请求吞掉。
    if (this.stopPromise && this.stateValue === 'finalizing') return this.stopPromise
    const promise = this.stopInternal().finally(() => {
      if (this.stopPromise === promise) this.stopPromise = null
    })
    this.stopPromise = promise
    return promise
  }

  async cancel(): Promise<void> {
    const sessionId = this.sessionId
    if (!sessionId) return

    // 先同步作废会话与恢复编辑器，再异步通知主进程：
    // 调用方（切换会话/卸载）拿到的 DOM 必须立刻是录音前的样子。
    this.sessionId = null
    this.live = ''
    this.silence.reset()
    this.capture.stop()
    const snapshot = this.snapshot
    this.snapshot = null
    if (snapshot) this.options.target().restore(snapshot)
    this.setState('idle')

    try {
      await this.options.session.cancelSession(sessionId)
    } catch {
      // 主进程会话可能已结束；取消是尽力而为，本地状态已经收口。
    }
    this.options.onOutcome?.({ kind: 'canceled' })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe()
    if (this.sessionId) void this.cancel()
  }

  private async stopInternal(): Promise<void> {
    const sessionId = this.sessionId
    if (!sessionId) return

    // 还没进入录音就点停止：没有可提交的内容，按取消处理。
    if (this.stateValue === 'preparing' || this.stateValue === 'requesting-permission') {
      await this.cancel()
      return
    }
    if (this.stateValue !== 'recording') return

    this.setState('finalizing')
    this.capture.stop()

    let result: VoiceStopSessionResult
    try {
      result = await this.options.session.stopSession(sessionId)
    } catch (error) {
      if (this.sessionId !== sessionId) return
      this.fail('engine-failed', errorMessage(error))
      return
    }
    // 收口期间被取消：终稿丢弃，编辑器已由 cancel 恢复。
    if (this.sessionId !== sessionId) return

    if (!result.success) {
      this.fail(mapSessionError(result.errorCode), result.error)
      return
    }

    const finalText = result.text ?? ''
    const snapshot = this.snapshot
    this.finish()

    if (!finalText.trim()) {
      if (snapshot) this.options.target().restore(snapshot)
      this.setState('idle')
      this.options.onOutcome?.({ kind: 'no-speech' })
      return
    }

    if (snapshot) this.options.target().commit(snapshot, finalText)
    this.setState('idle')
    this.options.onOutcome?.({ kind: 'committed', text: finalText })
  }

  private handleChunk = (samples: Int16Array): void => {
    const sessionId = this.sessionId
    if (!sessionId || this.stateValue !== 'recording') return

    this.options.session.sendAudio(sessionId, samples)
    if (this.silence.push(samples).shouldAutoStop) void this.stop()
  }

  private handleCaptureError = (error: VoiceCaptureError): void => {
    if (!this.sessionId) return
    this.fail(error.code, error.message)
  }

  private handlePartial = (payload: VoicePartialPayload): void => {
    if (!this.sessionId || payload.sessionId !== this.sessionId) return
    if (
      this.stateValue !== 'preparing' &&
      this.stateValue !== 'recording' &&
      this.stateValue !== 'finalizing'
    ) {
      return
    }
    this.live = payload.text
    this.options.onLiveTranscript?.(payload.text)
  }

  private handleSessionState = (payload: VoiceSessionStatePayload): void => {
    if (!this.sessionId || payload.sessionId !== this.sessionId) return
    if (payload.state === 'failed') {
      this.fail(mapSessionError(payload.errorCode), payload.error)
    }
  }

  private fail(code: VoiceFailureCode, message?: string): void {
    const sessionId = this.sessionId
    this.sessionId = null
    this.live = ''
    this.silence.reset()
    this.capture.stop()

    const snapshot = this.snapshot
    this.snapshot = null
    if (snapshot) this.options.target().restore(snapshot)

    this.setState('failed')
    if (sessionId) {
      void this.options.session.cancelSession(sessionId).catch(() => {
        // 失败收口时主进程会话多半已经没了；这里只保证本地资源释放。
      })
    }

    const outcome: VoiceOutcome = { kind: 'failed', code }
    if (message !== undefined) outcome.message = message
    this.options.onOutcome?.(outcome)
  }

  private finish(): void {
    this.sessionId = null
    this.snapshot = null
    this.live = ''
    this.silence.reset()
  }

  private setState(next: VoiceInputState): void {
    this.stateValue = next
    this.options.onStateChange?.(next)
  }
}

function mapSessionError(code: VoiceSessionErrorCode | undefined): VoiceFailureCode {
  switch (code) {
    case 'model-missing':
    case 'model-corrupted':
    case 'engine-failed':
      return code
    default:
      return 'engine-failed'
  }
}

function mapCaptureError(error: unknown): VoiceFailureCode {
  if (error instanceof VoiceCaptureError) return error.code
  return 'capture-failed'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
