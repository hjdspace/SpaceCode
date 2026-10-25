/**
 * PCM16 分块与 Float32 → Int16 转换 —— AudioWorklet 的原始帧按 100ms 聚合。
 *
 * AudioWorklet 每帧是 128 个采样点，16000Hz 下 100ms 是 1600 个样本
 * （12.5 帧），所以必须在主线程侧跨帧累积，不能按整帧切。
 */
export const VOICE_CHUNK_SAMPLES = 1600

/** 把 -1..1 的浮点采样映射到 PCM16，越界裁剪。 */
export function floatToPcm16(frames: Float32Array): Int16Array {
  const out = new Int16Array(frames.length)
  for (let i = 0; i < frames.length; i++) {
    const clamped = Math.max(-1, Math.min(1, frames[i]))
    out[i] = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
  }
  return out
}

export class Pcm16Chunker {
  private pending: Float32Array = new Float32Array(0)

  /** 推入一帧浮点采样，返回凑满 1600 样本的 PCM16 块（可能为空）。 */
  push(frames: Float32Array): Int16Array[] {
    if (frames.length === 0) return []

    const merged = new Float32Array(this.pending.length + frames.length)
    merged.set(this.pending, 0)
    merged.set(frames, this.pending.length)

    const chunks: Int16Array[] = []
    let offset = 0
    while (merged.length - offset >= VOICE_CHUNK_SAMPLES) {
      chunks.push(floatToPcm16(merged.subarray(offset, offset + VOICE_CHUNK_SAMPLES)))
      offset += VOICE_CHUNK_SAMPLES
    }
    this.pending = merged.slice(offset)
    return chunks
  }

  reset(): void {
    this.pending = new Float32Array(0)
  }
}
