/**
 * 录音会话协调器 —— 单会话互斥、音频排队、启停取消与失败收口都在这里。
 *
 * 它不认识 sherpa-onnx，也不认识 Electron：引擎与模型探测都是注入的接缝。
 * 所有对外可观察行为只有两类 —— 返回给 IPC 调用方的结果，以及
 * `partial` / `state` 两个事件。
 */
import { EventEmitter } from 'events'
import {
  VOICE_SAMPLE_RATE,
  type VoicePartialPayload,
  type VoiceSessionErrorCode,
  type VoiceSessionState,
  type VoiceSessionStatePayload,
  type VoiceStartSessionResult,
  type VoiceStopSessionResult,
} from '@/shared/channels/voice'
import type { VoiceEngine, VoiceEngineFactory } from './voiceEngine'

export type VoiceModelAvailability = 'installed' | 'missing' | 'corrupted'

export interface VoiceModelInspection {
  state: VoiceModelAvailability
  /** 已安装模型的绝对目录，供引擎加载四个模型文件。 */
  modelDir: string
}

/** 运行期只核对「已安装 / 缺失 / 损坏」，不重复计算哈希。 */
export interface VoiceModelProbe {
  inspect(): Promise<VoiceModelInspection>
}

export interface VoiceSessionServiceOptions {
  probe: VoiceModelProbe
  engineFactory: VoiceEngineFactory
}

interface Session {
  id: string
  state: VoiceSessionState
  engine: VoiceEngine
  startPromise: Promise<void>
  /** 模型加载完成前收到的音频，ready 后按序补发。 */
  pending: Int16Array[]
  stopPromise: Promise<VoiceStopSessionResult> | null
  failed: boolean
}

export class VoiceSessionService extends EventEmitter {
  private readonly probe: VoiceModelProbe
  private readonly engineFactory: VoiceEngineFactory
  private engine: VoiceEngine | null = null
  private active: Session | null = null

  constructor(options: VoiceSessionServiceOptions) {
    super()
    this.probe = options.probe
    this.engineFactory = options.engineFactory
  }

  /** 模型移除等操作据此拒绝在录音期间执行。 */
  isRecording(): boolean {
    return this.active !== null
  }

  async startSession(sessionId: string): Promise<VoiceStartSessionResult> {
    // 新的开始请求本身就意味着旧会话结束；先于任何可能失败的探测执行。
    if (this.active) this.cancelSession(this.active.id)

    let inspection: VoiceModelInspection
    try {
      inspection = await this.probe.inspect()
    } catch (err) {
      const error = errorMessage(err)
      this.emitState(sessionId, 'failed', error, 'engine-failed')
      return { ok: false, sampleRate: VOICE_SAMPLE_RATE, error, errorCode: 'engine-failed' }
    }

    if (inspection.state !== 'installed') {
      const errorCode: VoiceSessionErrorCode =
        inspection.state === 'corrupted' ? 'model-corrupted' : 'model-missing'
      const error =
        inspection.state === 'corrupted'
          ? 'The speech model is corrupted; reinstall it before recording'
          : 'The speech model is not installed'
      this.emitState(sessionId, 'failed', error, errorCode)
      return { ok: false, sampleRate: VOICE_SAMPLE_RATE, error, errorCode }
    }

    const engine = this.ensureEngine()
    const session: Session = {
      id: sessionId,
      state: 'loading',
      engine,
      startPromise: Promise.resolve(),
      pending: [],
      stopPromise: null,
      failed: false,
    }
    this.active = session
    this.emitState(sessionId, 'loading')

    try {
      // engine.start 的同步抛错（如 worker 构造失败）也必须走失败收口，
      // 否则会话会卡在 loading，isRecording() 一直挡住模型移除。
      const startPromise = engine.start(inspection.modelDir)
      session.startPromise = startPromise
      await startPromise
    } catch (err) {
      const error = errorMessage(err)
      this.failSession(session, err)
      return { ok: false, sampleRate: VOICE_SAMPLE_RATE, error, errorCode: 'engine-failed' }
    }

    if (this.active !== session) {
      return {
        ok: false,
        sampleRate: VOICE_SAMPLE_RATE,
        error: 'The session was canceled',
        errorCode: 'canceled',
      }
    }

    // stop 可能在模型加载期间就到达（状态已置 finalizing），此时不要再报 recording。
    if (session.state === 'loading') {
      session.state = 'recording'
      this.emitState(sessionId, 'recording')
    }
    this.flushPending(session)
    return { ok: true, sampleRate: VOICE_SAMPLE_RATE }
  }

  sendAudio(sessionId: string, pcm: ArrayBuffer | ArrayBufferView | Int16Array): void {
    const session = this.active
    if (!session || session.id !== sessionId) return
    if (session.state !== 'loading' && session.state !== 'recording') return

    const samples = toInt16Samples(pcm)
    if (!samples || samples.length === 0) return

    if (session.state === 'recording') session.engine.sendAudio(samples)
    else session.pending.push(samples)
  }

  async stopSession(sessionId: string): Promise<VoiceStopSessionResult> {
    const session = this.active
    if (!session || session.id !== sessionId) return { success: true, text: '' }
    if (session.stopPromise) return session.stopPromise

    // 同步进入 finalizing，后续到达的音频不再被接收 —— finishSession 的第一个
    // await 之前必须先关闸，否则同一 tick 里送进来的音频会漏进终稿。
    session.state = 'finalizing'
    this.emitState(session.id, 'finalizing')
    session.stopPromise = this.finishSession(session)
    return session.stopPromise
  }

  cancelSession(sessionId: string): { success: boolean } {
    const session = this.active
    if (!session || session.id !== sessionId) return { success: true }

    this.active = null
    session.pending = []
    session.state = 'ended'
    this.emitState(session.id, 'ended')
    session.engine.cancel()
    return { success: true }
  }

  private async finishSession(session: Session): Promise<VoiceStopSessionResult> {
    try {
      await session.startPromise
    } catch (err) {
      return { success: false, text: '', error: errorMessage(err), errorCode: 'engine-failed' }
    }

    if (this.active !== session) {
      return { success: false, text: '', error: 'The session was canceled', errorCode: 'canceled' }
    }

    this.flushPending(session)

    try {
      const text = await session.engine.stop()
      // stop 与 cancel 撞上时，音频已被丢弃，终稿不存在 —— 不能把空串当成成功。
      if (this.active !== session) {
        return { success: false, text: '', error: 'The session was canceled', errorCode: 'canceled' }
      }
      this.active = null
      session.state = 'ended'
      this.emitState(session.id, 'ended')
      return { success: true, text }
    } catch (err) {
      this.failSession(session, err)
      return { success: false, text: '', error: errorMessage(err), errorCode: 'engine-failed' }
    }
  }

  private flushPending(session: Session): void {
    const queued = session.pending
    session.pending = []
    for (const samples of queued) session.engine.sendAudio(samples)
  }

  private ensureEngine(): VoiceEngine {
    if (!this.engine) {
      this.engine = this.engineFactory.create({
        onPartial: (text) => {
          const session = this.active
          if (!session) return
          if (session.state !== 'recording' && session.state !== 'finalizing') return
          const payload: VoicePartialPayload = { sessionId: session.id, text }
          this.emit('partial', payload)
        },
        onFailure: (error) => {
          const session = this.active
          if (session) this.failSession(session, error)
          else this.disposeEngine()
        },
      })
    }
    return this.engine
  }

  private failSession(session: Session, error: unknown): void {
    if (session.failed) return
    session.failed = true
    session.state = 'failed'
    if (this.active === session) this.active = null
    this.disposeEngine()
    this.emitState(session.id, 'failed', errorMessage(error), 'engine-failed')
  }

  private disposeEngine(): void {
    this.engine?.dispose()
    this.engine = null
  }

  private emitState(
    sessionId: string,
    state: VoiceSessionState,
    error?: string,
    errorCode?: VoiceSessionErrorCode,
  ): void {
    const payload: VoiceSessionStatePayload = { sessionId, state }
    if (error !== undefined) payload.error = error
    if (errorCode !== undefined) payload.errorCode = errorCode
    this.emit('state', payload)
  }
}

function toInt16Samples(pcm: ArrayBuffer | ArrayBufferView | Int16Array): Int16Array | null {
  // 通道契约是 PCM16：只有 Int16Array 或单字节视图可以按字节重解释。
  // Float32Array 等视图必须拒收，否则会把浮点字节当成采样点送进模型。
  if (pcm instanceof Int16Array) return pcm
  if (pcm instanceof Uint8Array) return bytesToInt16(pcm.buffer, pcm.byteOffset, pcm.byteLength)
  if (pcm instanceof ArrayBuffer) return bytesToInt16(pcm, 0, pcm.byteLength)
  return null
}

function bytesToInt16(buffer: ArrayBufferLike, byteOffset: number, byteLength: number): Int16Array | null {
  if (byteLength < 2 || byteLength % 2 !== 0) return null
  return new Int16Array(buffer, byteOffset, byteLength / 2)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
