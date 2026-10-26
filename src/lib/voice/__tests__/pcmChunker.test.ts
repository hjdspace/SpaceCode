import { describe, expect, it } from 'vitest'
import { Pcm16Chunker, floatToPcm16, VOICE_CHUNK_SAMPLES } from '../pcmChunker'

function frames(length: number, value = 0): Float32Array {
  return new Float32Array(length).fill(value)
}

describe('floatToPcm16', () => {
  it('把 -1..1 映射到 Int16 并做四舍五入', () => {
    const out = floatToPcm16(new Float32Array([0, 1, -1, 0.5, -0.5]))
    expect(Array.from(out)).toEqual([0, 32767, -32768, 16384, -16384])
  })

  it('越界值被裁剪', () => {
    const out = floatToPcm16(new Float32Array([2, -2]))
    expect(Array.from(out)).toEqual([32767, -32768])
  })
})

describe('Pcm16Chunker', () => {
  it('累加到 100ms（1600 样本）才输出一块', () => {
    const chunker = new Pcm16Chunker()
    // AudioWorklet 每帧 128 个样本，12 帧 = 1536，不足一块
    for (let i = 0; i < 12; i++) {
      expect(chunker.push(frames(128, 0.5))).toHaveLength(0)
    }
    const out = chunker.push(frames(64, 0.5))
    expect(out).toHaveLength(1)
    expect(out[0]).toHaveLength(VOICE_CHUNK_SAMPLES)
    expect(out[0][0]).toBe(16384)
  })

  it('余量跨块保留，不丢样本', () => {
    const chunker = new Pcm16Chunker()
    chunker.push(frames(1000, 0.1))
    const out = chunker.push(frames(1000, 0.1))
    expect(out).toHaveLength(1)
    expect(out[0]).toHaveLength(VOICE_CHUNK_SAMPLES)

    // 剩余 400 个样本，再补 1200 个刚好凑成第二块
    const second = chunker.push(frames(1200, 0.1))
    expect(second).toHaveLength(1)
    expect(second[0]).toHaveLength(VOICE_CHUNK_SAMPLES)
  })

  it('一次推入多块时按边界切分', () => {
    const chunker = new Pcm16Chunker()
    const out = chunker.push(frames(VOICE_CHUNK_SAMPLES * 2 + 10, 0.25))
    expect(out).toHaveLength(2)
    expect(chunker.push(frames(VOICE_CHUNK_SAMPLES - 10, 0.25))).toHaveLength(1)
  })

  it('reset 丢弃余量', () => {
    const chunker = new Pcm16Chunker()
    chunker.push(frames(1000, 0.1))
    chunker.reset()
    expect(chunker.push(frames(VOICE_CHUNK_SAMPLES - 1, 0.1))).toHaveLength(0)
  })
})
