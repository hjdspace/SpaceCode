// @vitest-environment node
/**
 * sherpa 引擎 worker 适配器 —— worker 异常退出与构造失败都必须上报给会话服务，
 * 让上层把会话转 failed、释放麦克风并允许下一次重新拉起 worker。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsrWorkerResponse } from '../asrProtocol'

const probe = vi.hoisted(() => ({ workers: [] as FakeWorker[] }))

/**
 * worker_threads 在模块加载时就被替换；被测模块必须在 mock 生效之后再动态导入，
 * 否则工厂会在 FakeWorker 初始化之前执行。
 */
class FakeWorker {
  posts: unknown[] = []
  terminated = false
  handlers: Record<string, (payload: unknown) => void> = {}

  constructor(readonly url: string) {
    probe.workers.push(this)
  }

  emit(type: string, payload?: unknown): void {
    this.handlers[type]?.(payload)
  }

  on(type: string, handler: (payload: unknown) => void): this {
    this.handlers[type] = handler
    return this
  }

  postMessage(message: unknown): void {
    this.posts.push(message)
  }

  terminate(): Promise<number> {
    this.terminated = true
    return Promise.resolve(0)
  }
}

vi.mock('worker_threads', () => ({ Worker: FakeWorker }))

let SherpaWorkerEngine: typeof import('../sherpaWorkerEngine').SherpaWorkerEngine

const MODEL_DIR = 'C:/voice/model'

function createEngine() {
  const onPartial = vi.fn<(text: string) => void>()
  const onFailure = vi.fn<(error: Error) => void>()
  const engine = new SherpaWorkerEngine({ onPartial, onFailure })
  return { engine, onPartial, onFailure }
}

function lastWorker(): FakeWorker {
  const worker = probe.workers[probe.workers.length - 1]
  if (!worker) throw new Error('no worker was created')
  return worker
}

function emitMessage(worker: FakeWorker, message: AsrWorkerResponse): void {
  worker.emit('message', message)
}

describe('SherpaWorkerEngine', () => {
  beforeEach(async () => {
    probe.workers = []
    ;({ SherpaWorkerEngine } = await import('../sherpaWorkerEngine'))
  })

  it('loads the model in a fresh worker and forwards the final transcript', async () => {
    const { engine } = createEngine()

    const starting = engine.start(MODEL_DIR)
    const worker = lastWorker()
    expect(worker.posts).toEqual([{ type: 'start', modelDir: MODEL_DIR }])

    emitMessage(worker, { type: 'ready' })
    await expect(starting).resolves.toBeUndefined()

    const samples = Int16Array.from([1, 2, 3])
    engine.sendAudio(samples)
    expect(worker.posts[1]).toEqual({ type: 'audio', samples })

    const stopping = engine.stop()
    expect(worker.posts[2]).toEqual({ type: 'stop' })
    emitMessage(worker, { type: 'final', text: '你好' })
    await expect(stopping).resolves.toBe('你好')
  })

  it('reports a worker error to the session and terminates the worker', async () => {
    const { engine, onFailure } = createEngine()

    const starting = engine.start(MODEL_DIR)
    const worker = lastWorker()

    worker.emit('error', new Error('native model crashed'))

    await expect(starting).rejects.toThrow('native model crashed')
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure.mock.calls[0][0].message).toBe('native model crashed')
    expect(worker.terminated).toBe(true)
  })

  it('reports an unexpected worker exit as a failure', async () => {
    const { engine, onFailure } = createEngine()
    const starting = engine.start(MODEL_DIR)
    const worker = lastWorker()
    emitMessage(worker, { type: 'ready' })
    await starting

    worker.emit('exit', 3)

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure.mock.calls[0][0].message).toBe('The speech worker exited with code 3')
  })

  it('rejects a pending stop when the worker dies mid-finalize', async () => {
    const { engine, onFailure } = createEngine()
    const starting = engine.start(MODEL_DIR)
    const worker = lastWorker()
    emitMessage(worker, { type: 'ready' })
    await starting

    const stopping = engine.stop()
    worker.emit('exit', 1)

    await expect(stopping).rejects.toThrow('exited with code 1')
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  it('reports a worker error only once and ignores late messages', async () => {
    const { engine, onFailure, onPartial } = createEngine()
    const starting = engine.start(MODEL_DIR)
    const worker = lastWorker()
    emitMessage(worker, { type: 'ready' })
    await starting

    worker.emit('error', new Error('boom'))
    worker.emit('error', new Error('boom again'))
    emitMessage(worker, { type: 'partial', text: '迟到的转写' })

    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onPartial).not.toHaveBeenCalled()
  })

  it('does not report a failure after dispose and refuses to start again', async () => {
    const { engine, onFailure } = createEngine()
    const starting = engine.start(MODEL_DIR)
    const worker = lastWorker()
    emitMessage(worker, { type: 'ready' })
    await starting

    engine.dispose()
    worker.emit('exit', 0)

    expect(onFailure).not.toHaveBeenCalled()
    expect(worker.terminated).toBe(true)
    await expect(engine.start(MODEL_DIR)).rejects.toThrow('disposed')
  })
})
