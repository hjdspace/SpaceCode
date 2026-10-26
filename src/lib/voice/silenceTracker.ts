/**
 * 静音判定 —— 连续低于能量阈值达到上限即自动停止录音。
 *
 * 计时按音频样本数换算而不是墙钟：采样点全部来自同一条 16kHz 流，
 * 丢块或延迟不会让“说了一句就被判定静音”发生。
 */
import { VOICE_CHUNK_SAMPLES } from './pcmChunker'

export { VOICE_CHUNK_SAMPLES }

export const VOICE_SAMPLE_RATE = 16_000
/** PCM16 归一化后的 RMS 阈值：约 0.01 ≈ -40dBFS，高于房间底噪、低于轻声说话。 */
export const VOICE_SILENCE_RMS_THRESHOLD = 0.01
/** 连续静音上限；达到即认为用户说完了。 */
export const VOICE_SILENCE_DURATION_MS = 5_000

export interface SilenceSample {
  rms: number
  /** 本块是否被判定为语音。 */
  speech: boolean
  /** 当前连续静音时长（毫秒）；本块有语音时为 0。 */
  silentMs: number
  shouldAutoStop: boolean
}

export interface VoiceSilenceOptions {
  threshold?: number
  durationMs?: number
  sampleRate?: number
}

/** 归一化到 0..1 的 PCM16 均方根。 */
export function pcm16Rms(samples: Int16Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) {
    const normalized = samples[i] / 32768
    sum += normalized * normalized
  }
  return Math.sqrt(sum / samples.length)
}

export class VoiceSilenceTracker {
  private readonly threshold: number
  private readonly durationMs: number
  private readonly sampleRate: number
  private silentMs = 0
  private everSpeech = false

  constructor(options: VoiceSilenceOptions = {}) {
    this.threshold = options.threshold ?? VOICE_SILENCE_RMS_THRESHOLD
    this.durationMs = options.durationMs ?? VOICE_SILENCE_DURATION_MS
    this.sampleRate = options.sampleRate ?? VOICE_SAMPLE_RATE
  }

  /** 整段录音期间是否出现过语音。 */
  get speechDetected(): boolean {
    return this.everSpeech
  }

  push(samples: Int16Array): SilenceSample {
    const rms = pcm16Rms(samples)
    const speech = rms >= this.threshold
    if (speech) {
      this.everSpeech = true
      this.silentMs = 0
    } else if (samples.length > 0) {
      this.silentMs += (samples.length / this.sampleRate) * 1000
    }
    return {
      rms,
      speech,
      silentMs: this.silentMs,
      shouldAutoStop: this.silentMs >= this.durationMs,
    }
  }

  reset(): void {
    this.silentMs = 0
    this.everSpeech = false
  }
}
