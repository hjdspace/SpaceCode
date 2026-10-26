/**
 * 浏览器/Electron 渲染层采音适配器 —— getUserMedia + AudioWorklet → PCM16。
 *
 * 渲染层只负责把麦克风音频按 100ms 块送出去：不加载 WASM、不读模型文件。
 * 采样率不符、权限被拒、设备消失都在这里映射成 VoiceCaptureError。
 */
import { VOICE_SAMPLE_RATE } from '@/shared/channels/voice'
import { Pcm16Chunker } from './pcmChunker'
import {
  VoiceCaptureError,
  type VoiceCaptureHandlers,
  type VoiceCapturePort,
} from './voiceDictation'

const PROCESSOR_NAME = 'spacecode-voice-input'

/**
 * audioWorklet.addModule() 受 CSP 的 `script-src` 约束，Blob URL 会被 'self' 拦掉，
 * 所以处理器由 `public/voice/pcm-processor.js` 以第一方脚本提供。相对 document.baseURI
 * 解析：dev 命中 Vite publicDir 根，打包（file:// 的 dist/index.html）与 h5（dist 静态根）
 * 都命中 dist 下的同名文件。此处的名字必须与该文件里 registerProcessor 的入参一致。
 */
const PROCESSOR_PATH = 'voice/pcm-processor.js'

export function createBrowserVoiceCapture(): VoiceCapturePort {
  let context: AudioContext | null = null
  let stream: MediaStream | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let node: AudioWorkletNode | null = null
  let track: MediaStreamTrack | null = null
  const chunker = new Pcm16Chunker()

  let handlersRef: VoiceCaptureHandlers | null = null

  function onTrackEnded(): void {
    handlersRef?.onError(new VoiceCaptureError('device-unavailable', 'The microphone was disconnected'))
  }

  function cleanup(): void {
    handlersRef = null
    track?.removeEventListener('ended', onTrackEnded)
    track = null
    if (node) {
      node.port.onmessage = null
      node.disconnect()
      node = null
    }
    source?.disconnect()
    source = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    if (context) {
      void context.close().catch(() => {})
      context = null
    }
    chunker.reset()
  }

  async function start(handlers: VoiceCaptureHandlers): Promise<{ sampleRate: number }> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new VoiceCaptureError('unsupported', 'Audio capture is not available')
    }

    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      })
    } catch (error) {
      throw mapGetUserMediaError(error)
    }
    stream = media

    const audioTrack = media.getAudioTracks()[0]
    if (!audioTrack) {
      cleanup()
      throw new VoiceCaptureError('device-unavailable', 'No audio track was provided')
    }
    track = audioTrack
    track.addEventListener('ended', onTrackEnded)

    const Ctor =
      typeof window !== 'undefined'
        ? window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined
    if (!Ctor) {
      cleanup()
      throw new VoiceCaptureError('unsupported', 'AudioContext is not available')
    }

    try {
      context = new Ctor({ sampleRate: VOICE_SAMPLE_RATE })
    } catch {
      cleanup()
      throw new VoiceCaptureError('sample-rate-mismatch', 'The audio backend rejected 16kHz')
    }

    if (context.sampleRate !== VOICE_SAMPLE_RATE) {
      cleanup()
      throw new VoiceCaptureError(
        'sample-rate-mismatch',
        `Expected ${VOICE_SAMPLE_RATE}Hz but got ${context.sampleRate}Hz`,
      )
    }

    try {
      if (!context.audioWorklet) throw new Error('AudioWorklet is not available')
      await context.audioWorklet.addModule(new URL(PROCESSOR_PATH, document.baseURI).href)
      node = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: 'explicit',
      })
    } catch (error) {
      cleanup()
      throw new VoiceCaptureError('unsupported', errorMessage(error))
    }

    handlersRef = handlers
    node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const frames = new Float32Array(event.data)
      for (const chunk of chunker.push(frames)) handlers.onChunk(chunk)
    }
    source = context.createMediaStreamSource(media)
    source.connect(node)

    return { sampleRate: context!.sampleRate }
  }

  return { start, stop: () => cleanup() }
}

function mapGetUserMediaError(error: unknown): VoiceCaptureError {
  const name = error instanceof DOMException || error instanceof Error ? error.name : ''
  const message = errorMessage(error)
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return new VoiceCaptureError('permission-denied', message)
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
    case 'NotReadableError':
    case 'TrackStartError':
      return new VoiceCaptureError('device-unavailable', message)
    default:
      return new VoiceCaptureError('unsupported', message)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
