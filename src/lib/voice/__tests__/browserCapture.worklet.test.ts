/**
 * 采音适配器注册 AudioWorklet 的方式 —— CSP 的 `script-src 'self'` 会拦掉 Blob URL
 * （语音输入曾在 `addModule` 处必现失败），所以处理器必须以第一方同源脚本加载。
 * 注册名分处 TS 常量与 public/ 静态文件两处，编译器管不到，这里钉住不漂移。
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VOICE_SAMPLE_RATE } from '@/shared/channels/voice'
import { createBrowserVoiceCapture } from '../browserCapture'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  sampleRate = VOICE_SAMPLE_RATE
  addModule = vi.fn(async (_url: string) => {})
  audioWorklet = { addModule: this.addModule }
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
  close = vi.fn(async () => {})

  constructor() {
    FakeAudioContext.instances.push(this)
  }
}

const constructedNodes: string[] = []

class FakeWorkletNode {
  port: { onmessage: ((event: MessageEvent) => void) | null } = { onmessage: null }
  disconnect = vi.fn()

  constructor(_context: unknown, name: string) {
    constructedNodes.push(name)
  }
}

function installCaptureEnv(): void {
  const track = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    stop: vi.fn(),
  }
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] })) },
  })
  Object.defineProperty(window, 'AudioContext', { configurable: true, value: FakeAudioContext })
  Object.defineProperty(window, 'AudioWorkletNode', { configurable: true, value: FakeWorkletNode })
}

function lastContext(): FakeAudioContext {
  const context = FakeAudioContext.instances[FakeAudioContext.instances.length - 1]
  if (!context) throw new Error('采音未创建 AudioContext')
  return context
}

describe('browserCapture 的 AudioWorklet 注册', () => {
  beforeEach(() => {
    constructedNodes.length = 0
    FakeAudioContext.instances.length = 0
  })

  it('以同源第一方脚本加载处理器，而不是 Blob/Data URL', async () => {
    installCaptureEnv()
    const capture = createBrowserVoiceCapture()

    await expect(capture.start({ onChunk: vi.fn(), onError: vi.fn() })).resolves.toEqual({
      sampleRate: VOICE_SAMPLE_RATE,
    })

    const url = lastContext().addModule.mock.calls[0]?.[0] as string
    expect(url.startsWith('blob:')).toBe(false)
    expect(url.startsWith('data:')).toBe(false)
    const moduleUrl = new URL(url)
    expect(moduleUrl.origin).toBe(new URL(document.baseURI).origin)
    expect(decodeURIComponent(moduleUrl.pathname)).toMatch(/\/voice\/pcm-processor\.js$/)
    capture.stop()
  })

  it('静态处理器文件注册的处理器名与节点构造使用同一个名字', async () => {
    installCaptureEnv()
    const capture = createBrowserVoiceCapture()
    await capture.start({ onChunk: vi.fn(), onError: vi.fn() })

    const source = readFileSync(resolve(process.cwd(), 'public/voice/pcm-processor.js'), 'utf-8')
    expect(source).toContain(`registerProcessor('${constructedNodes[0]}'`)
    capture.stop()
  })
})
