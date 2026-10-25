/**
 * sherpa-onnx 识别 worker —— 常驻线程，懒加载模型，流式解码。
 *
 * worker 只做三件事：把 PCM16 转成 Float32 喂给 OnlineRecognizer、在每个
 * endpoint 提交分段并重置流、在 stop 时收口并返回拼接后的终稿。
 * 主进程通过 asrProtocol 的四个消息驱动它。
 */
import { parentPort } from 'worker_threads'
import type { MessagePort as WorkerMessagePort } from 'worker_threads'
import { join } from 'path'
import { OnlineRecognizer, type OnlineStream } from 'sherpa-onnx-node'
import type { AsrWorkerRequest, AsrWorkerResponse } from './asrProtocol'
import { composeTranscript } from './transcriptAssembler'

const SAMPLE_RATE = 16_000

const port = parentPort
if (!port) throw new Error('The ASR worker must run inside a worker thread')
const workerPort: WorkerMessagePort = port

let recognizer: OnlineRecognizer | null = null
let stream: OnlineStream | null = null
let segments: string[] = []
let lastPartial = ''

workerPort.on('message', (request: AsrWorkerRequest) => {
  try {
    switch (request.type) {
      case 'start':
        handleStart(request.modelDir)
        break
      case 'audio':
        handleAudio(request.samples)
        break
      case 'stop':
        handleStop()
        break
      case 'cancel':
        handleCancel()
        break
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})

function post(message: AsrWorkerResponse): void {
  workerPort.postMessage(message)
}

function handleStart(modelDir: string): void {
  if (!recognizer) {
    // 配置锁定 streaming zipformer transducer 与模型内标点；endpoint 让长语音
    // 不会让活动路径无限增长（见 docs/adr/0014-local-voice-input.md）。
    recognizer = new OnlineRecognizer({
      featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(modelDir, 'encoder.int8.onnx'),
          decoder: join(modelDir, 'decoder.onnx'),
          joiner: join(modelDir, 'joiner.int8.onnx'),
        },
        tokens: join(modelDir, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
      decodingMethod: 'greedy_search',
      enableEndpoint: true,
      rule1MinTrailingSilence: 2.4,
      rule2MinTrailingSilence: 1.2,
      rule3MinUtteranceLength: 20,
    })
  }
  resetSession()
  post({ type: 'ready' })
}

function handleAudio(samples: Int16Array): void {
  if (!recognizer || !stream) throw new Error('The speech recognizer is not ready')
  stream.acceptWaveform({ samples: toFloat32(samples), sampleRate: SAMPLE_RATE })
  decodeAndEmit()
}

function handleStop(): void {
  if (!recognizer || !stream) {
    post({ type: 'final', text: '' })
    return
  }

  stream.inputFinished()
  while (recognizer.isReady(stream)) recognizer.decode(stream)

  const tail = recognizer.getResult(stream).text.trim()
  if (tail) segments.push(tail)
  const text = composeTranscript(segments, '')

  resetSession()
  post({ type: 'final', text })
}

function handleCancel(): void {
  resetSession()
}

function decodeAndEmit(): void {
  if (!recognizer || !stream) return

  while (recognizer.isReady(stream)) recognizer.decode(stream)

  if (recognizer.isEndpoint(stream)) {
    const text = recognizer.getResult(stream).text.trim()
    if (text) segments.push(text)
    recognizer.reset(stream)
  }

  emitPartial()
}

function emitPartial(): void {
  if (!recognizer || !stream) return
  const text = composeTranscript(segments, recognizer.getResult(stream).text)
  if (text === lastPartial) return
  lastPartial = text
  post({ type: 'partial', text })
}

function resetSession(): void {
  segments = []
  lastPartial = ''
  stream = recognizer ? recognizer.createStream() : null
}

function toFloat32(samples: Int16Array): Float32Array {
  const output = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i += 1) output[i] = samples[i] / 32768
  return output
}
