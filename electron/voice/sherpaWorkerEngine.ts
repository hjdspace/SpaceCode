/**
 * sherpa-onnx 引擎的 worker_threads 适配器。
 *
 * 一个实例对应一个常驻 worker：首个 start 拉起线程并加载模型，之后 stop /
 * cancel 复用同一个 worker。worker 出错或异常退出时把失败上报给会话服务，
 * 服务会 dispose 本实例；下一次 start 创建新实例重新拉起。
 */
import { Worker } from 'worker_threads'
import { join } from 'path'
import type { AsrWorkerRequest, AsrWorkerResponse } from './asrProtocol'
import type { VoiceEngine, VoiceEngineFactory, VoiceEngineHandlers } from './voiceEngine'

export class SherpaWorkerEngine implements VoiceEngine {
  private worker: Worker | null = null
  private requestedDir: string | null = null
  private loadedDir: string | null = null
  private startPromise: Promise<void> | null = null
  private resolveStart: (() => void) | null = null
  private rejectStart: ((error: Error) => void) | null = null
  private resolveStop: ((text: string) => void) | null = null
  private rejectStop: ((error: Error) => void) | null = null
  private disposed = false
  private failed = false

  constructor(private readonly handlers: VoiceEngineHandlers) {}

  start(modelDir: string): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('The speech engine has been disposed'))
    if (this.loadedDir === modelDir && this.worker) return Promise.resolve()
    if (this.startPromise) return this.startPromise

    this.requestedDir = modelDir
    const worker = this.ensureWorker()
    this.startPromise = new Promise<void>((resolve, reject) => {
      this.resolveStart = resolve
      this.rejectStart = reject
      worker.postMessage({ type: 'start', modelDir } satisfies AsrWorkerRequest)
    })
    return this.startPromise
  }

  sendAudio(samples: Int16Array): void {
    this.worker?.postMessage({ type: 'audio', samples } satisfies AsrWorkerRequest)
  }

  stop(): Promise<string> {
    const worker = this.worker
    if (!worker) return Promise.reject(new Error('The speech engine is not running'))
    return new Promise<string>((resolve, reject) => {
      this.resolveStop = resolve
      this.rejectStop = reject
      worker.postMessage({ type: 'stop' } satisfies AsrWorkerRequest)
    })
  }

  cancel(): void {
    const resolveStop = this.resolveStop
    this.resolveStop = null
    this.rejectStop = null
    resolveStop?.('')
    this.worker?.postMessage({ type: 'cancel' } satisfies AsrWorkerRequest)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const disposedError = new Error('The speech engine has been disposed')
    this.settleStart(disposedError, false)
    this.settleStop(disposedError, false)
    const worker = this.worker
    this.worker = null
    this.loadedDir = null
    void worker?.terminate()
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    // dist-electron/voice/asrWorker.js —— 与主进程 bundle 同级的独立入口。
    const worker = new Worker(join(__dirname, 'voice', 'asrWorker.js'))
    // 每个监听器都绑定它自己的 worker：旧 worker 的迟到消息不能冒充当前实例。
    worker.on('message', (message: AsrWorkerResponse) => {
      if (this.worker === worker) this.handleMessage(message)
    })
    worker.on('error', (error) => {
      if (this.worker === worker) {
        this.fail(error instanceof Error ? error : new Error(String(error)))
      }
    })
    worker.on('exit', (code) => {
      if (this.disposed || this.failed || this.worker !== worker) return
      this.fail(new Error(`The speech worker exited with code ${code}`))
    })
    this.worker = worker
    return worker
  }

  private handleMessage(message: AsrWorkerResponse): void {
    switch (message.type) {
      case 'ready':
        this.loadedDir = this.requestedDir
        this.settleStart(null, true)
        break
      case 'partial':
        this.handlers.onPartial(message.text)
        break
      case 'final':
        this.settleStop(null, true, message.text)
        break
      case 'error':
        this.fail(new Error(message.message))
        break
    }
  }

  private fail(error: Error): void {
    if (this.disposed || this.failed) return
    this.failed = true
    const worker = this.worker
    this.worker = null
    this.loadedDir = null
    this.settleStart(error, false)
    this.settleStop(error, false)
    this.handlers.onFailure(error)
    void worker?.terminate()
  }

  private settleStart(error: Error | null, ok: boolean): void {
    const resolve = this.resolveStart
    const reject = this.rejectStart
    this.resolveStart = null
    this.rejectStart = null
    this.startPromise = null
    if (ok) resolve?.()
    else reject?.(error ?? new Error('The speech engine failed to start'))
  }

  private settleStop(error: Error | null, ok: boolean, text = ''): void {
    const resolve = this.resolveStop
    const reject = this.rejectStop
    this.resolveStop = null
    this.rejectStop = null
    if (ok) resolve?.(text)
    else reject?.(error ?? new Error('The speech engine failed to finalize'))
  }
}

export function createSherpaWorkerEngineFactory(): VoiceEngineFactory {
  return {
    create: (handlers) => new SherpaWorkerEngine(handlers),
  }
}
