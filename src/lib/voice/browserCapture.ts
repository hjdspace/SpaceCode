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
 * 以 inline source + Blob URL 注册 AudioWorklet：避免为一小段处理器
 * 增加一个需要按打包路径解析的静态资源。
 */
const PROCESSOR_SOURCE = `
class SpaceCodeVoiceInputProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel) {
      const copy = new Float32Array(channel)
      this.port.postMessage(copy.buffer, [copy.buffer])
    }
    return true
  }
}
registerProcessor('${PROCESSOR_NAME}', SpaceCodeVoiceInputProcessor)
`

export function createBrowserVoiceCapture(): VoiceCapturePort {
  let context: AudioContext | null = null
  let stream: MediaStream | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let node: AudioWorkletNode | null = null
  let workletUrl: string | null = null
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
    if (workletUrl) {
      URL.revokeObjectURL(workletUrl)
      workletUrl = null
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
      workletUrl = URL.createObjectURL(new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' }))
      await context.audioWorklet.addModule(workletUrl)
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
