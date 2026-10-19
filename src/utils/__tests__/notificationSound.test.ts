/**
 * playTaskCompleteSound 的分支覆盖：HTMLAudioElement 主路径（成功/播放被拒/
 * 构造抛错）、Web Audio 回退（可用/不可用）、非 window 环境的静默退出。
 * Audio 与 AudioContext 均为 mock，断言分发逻辑而非真实发声。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { playTaskCompleteSound } from '@/utils/notificationSound'

type EndedListener = () => void

class MockAudio {
  static instances: MockAudio[] = []
  static playResult: 'resolve' | 'reject' | 'throw-on-play' = 'resolve'
  volume = 1
  src: string
  private endedListeners: EndedListener[] = []

  constructor(src: string) {
    this.src = src
    MockAudio.instances.push(this)
  }

  play(): Promise<void> {
    if (MockAudio.playResult === 'throw-on-play') throw new Error('no audio device')
    return MockAudio.playResult === 'resolve'
      ? Promise.resolve()
      : Promise.reject(new Error('autoplay blocked'))
  }

  addEventListener(event: string, listener: EndedListener, _opts?: { once?: boolean }): void {
    if (event === 'ended') this.endedListeners.push(listener)
  }

  emitEnded(): void {
    for (const l of this.endedListeners) l()
  }
}

function makeMockAudioContext() {
  return {
    currentTime: 0,
    destination: {},
    createGain: vi.fn(() => ({
      gain: {
        value: 0,
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    })),
    createOscillator: vi.fn(() => ({
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
    close: vi.fn(() => Promise.resolve()),
  }
}

describe('playTaskCompleteSound', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    MockAudio.instances = []
    MockAudio.playResult = 'resolve'
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('Audio', MockAudio)
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('plays the generated WAV data URI through an Audio element at fixed volume', () => {
    playTaskCompleteSound()
    expect(MockAudio.instances).toHaveLength(1)
    const audio = MockAudio.instances[0]
    expect(audio.src).toMatch(/^data:audio\/wav;base64,/)
    expect(audio.volume).toBe(0.3)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('clears the audio src once playback ends, releasing the data URI', () => {
    playTaskCompleteSound()
    const audio = MockAudio.instances[0]
    audio.emitEnded()
    expect(audio.src).toBe('')
  })

  it('falls back to Web Audio when HTMLAudioElement playback is rejected', async () => {
    MockAudio.playResult = 'reject'
    const ctx = makeMockAudioContext()
    // 源码用 `new Ctor()`，vitest 要求可用作构造器的实现，不能用箭头函数
    const AudioContextCtor = vi.fn(function () { return ctx })
    vi.stubGlobal('AudioContext', AudioContextCtor)

    playTaskCompleteSound()
    await vi.waitFor(() => expect(AudioContextCtor).toHaveBeenCalled())
    // Two oscillators: E5 then A5
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('HTMLAudioElement play failed'),
      expect.anything()
    )
  })

  it('falls back to Web Audio when the Audio constructor itself throws', () => {
    vi.stubGlobal('Audio', class { constructor() { throw new Error('no media stack') } })
    const ctx = makeMockAudioContext()
    const AudioContextCtor = vi.fn(function () { return ctx })
    vi.stubGlobal('AudioContext', AudioContextCtor)

    playTaskCompleteSound()
    expect(AudioContextCtor).toHaveBeenCalled()
  })

  it('gives up quietly when neither Audio playback nor Web Audio is available', async () => {
    MockAudio.playResult = 'reject'
    vi.stubGlobal('AudioContext', undefined)
    ;(window as { webkitAudioContext?: unknown }).webkitAudioContext = undefined

    playTaskCompleteSound()
    // Let the rejected play promise propagate; nothing should throw.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(MockAudio.instances).toHaveLength(1)
  })

  it('does nothing outside a window environment', () => {
    vi.stubGlobal('window', undefined)
    expect(() => playTaskCompleteSound()).not.toThrow()
    expect(MockAudio.instances).toHaveLength(0)
  })
})
