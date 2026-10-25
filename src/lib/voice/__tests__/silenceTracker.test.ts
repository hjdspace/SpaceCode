import { describe, expect, it } from 'vitest'
import {
  VOICE_CHUNK_SAMPLES,
  VOICE_SILENCE_DURATION_MS,
  VoiceSilenceTracker,
} from '../silenceTracker'

/** 直流电平样本：amplitude / 32768 就是 RMS。 */
function chunk(amplitude: number, length = VOICE_CHUNK_SAMPLES): Int16Array {
  return new Int16Array(length).fill(amplitude)
}

const SPEECH = 2000 // ≈ 0.061 RMS，高于阈值
const SILENCE = 100 // ≈ 0.003 RMS，低于阈值

describe('VoiceSilenceTracker', () => {
  it('默认 5 秒静音才触发自动停止', () => {
    const tracker = new VoiceSilenceTracker()
    for (let i = 0; i < 49; i++) {
      expect(tracker.push(chunk(SILENCE)).shouldAutoStop).toBe(false)
    }
    const last = tracker.push(chunk(SILENCE))
    expect(last.silentMs).toBe(VOICE_SILENCE_DURATION_MS)
    expect(last.shouldAutoStop).toBe(true)
  })

  it('检测到语音后静音计时归零', () => {
    const tracker = new VoiceSilenceTracker()
    for (let i = 0; i < 40; i++) tracker.push(chunk(SILENCE))
    expect(tracker.push(chunk(SPEECH)).silentMs).toBe(0)

    for (let i = 0; i < 49; i++) {
      expect(tracker.push(chunk(SILENCE)).shouldAutoStop).toBe(false)
    }
    expect(tracker.push(chunk(SILENCE)).shouldAutoStop).toBe(true)
  })

  it('按音频时长而不是块数量计时（非 100ms 块）', () => {
    const tracker = new VoiceSilenceTracker({ sampleRate: 8000, durationMs: 200 })
    // 8000Hz 下 800 个样本 = 100ms
    expect(tracker.push(chunk(SILENCE, 800)).silentMs).toBe(100)
    expect(tracker.push(chunk(SILENCE, 800)).shouldAutoStop).toBe(true)
  })

  it('空块不推进计时', () => {
    const tracker = new VoiceSilenceTracker()
    tracker.push(chunk(SILENCE))
    expect(tracker.push(new Int16Array(0)).silentMs).toBe(100)
  })

  it('自定义阈值决定语音与静音', () => {
    const tracker = new VoiceSilenceTracker({ threshold: 0.1 })
    expect(tracker.push(chunk(SPEECH)).speech).toBe(false)
    expect(tracker.push(chunk(4000)).speech).toBe(true)
  })

  it('reset 清空累计静音与语音标记', () => {
    const tracker = new VoiceSilenceTracker()
    tracker.push(chunk(SILENCE))
    tracker.push(chunk(SPEECH))
    tracker.reset()
    expect(tracker.push(chunk(SILENCE)).silentMs).toBe(100)
    expect(tracker.speechDetected).toBe(false)
  })

  it('记录整段会话是否出现过语音', () => {
    const tracker = new VoiceSilenceTracker()
    tracker.push(chunk(SILENCE))
    expect(tracker.speechDetected).toBe(false)
    tracker.push(chunk(SPEECH))
    expect(tracker.speechDetected).toBe(true)
  })
})
