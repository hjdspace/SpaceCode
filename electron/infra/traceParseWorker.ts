/**
 * Trace 文件解析 worker —— 把「全文读取 → split → JSON.parse」挪出主进程事件循环。
 *
 * 大 trace 文件（数十 MB / 数万行）的 split + JSON.parse 是秒级同步 CPU，此前跑在
 * 主进程会阻塞所有 IPC 与渲染进程的 file:// 静态资源请求。worker 化后主进程只做调度。
 *
 * worker 源码以 eval 方式内联：electron 主进程 bundle 是单文件（dist-electron/main.js），
 * 独立 worker 入口文件容易被打包链路丢掉；eval worker 随 bundle 走，零打包配置。
 * spawn 失败（极端环境）或未来 Node 缺 worker_threads 时回退主线程解析，功能不损失。
 */
import { Worker } from 'worker_threads'
import { readFile } from 'fs/promises'

type ParseRequest = { id: number; filePath: string; maxEvents: number }
type ParseResult =
  | { success: true; events: unknown[]; totalLines: number }
  | { success: false; error: string }

/**
 * maxEvents > 0 → 取最新 N 条；maxEvents === 0 → 全量（侧车冷启动回填用）。
 * 行级容错与旧实现一致：解析失败的行跳过，不整体报错。
 */
const WORKER_SOURCE = `
'use strict';
const { parentPort } = require('worker_threads');
const fs = require('fs');
parentPort.on('message', (req) => {
  try {
    const content = fs.readFileSync(req.filePath, 'utf8');
    const lines = content.split(/\\r?\\n/).filter(Boolean);
    const start = req.maxEvents > 0 ? Math.max(0, lines.length - req.maxEvents) : 0;
    const events = [];
    for (let i = start; i < lines.length; i++) {
      try { events.push(JSON.parse(lines[i])); } catch {}
    }
    parentPort.postMessage({ id: req.id, success: true, events, totalLines: lines.length });
  } catch (err) {
    parentPort.postMessage({ id: req.id, success: false, error: String(err) });
  }
});
`

const REQUEST_TIMEOUT_MS = 30_000

let worker: Worker | null = null
let spawnBroken = false
let seq = 0
const pending = new Map<number, { resolve: (r: ParseResult) => void; timer: ReturnType<typeof setTimeout> }>()

function failAll(err: Error): void {
  for (const [, p] of pending) {
    clearTimeout(p.timer)
    p.resolve({ success: false, error: err.message })
  }
  pending.clear()
}

function ensureWorker(): Worker | null {
  if (worker) return worker
  if (spawnBroken) return null
  try {
    const w = new Worker(WORKER_SOURCE, { eval: true })
    w.unref()
    w.on('message', (msg: { id: number } & ParseResult) => {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      clearTimeout(p.timer)
      p.resolve(msg)
    })
    w.on('error', (err) => {
      worker = null
      failAll(err instanceof Error ? err : new Error(String(err)))
    })
    w.on('exit', () => { worker = null; failAll(new Error('trace parse worker exited unexpectedly')) })
    worker = w
    return w
  } catch {
    spawnBroken = true
    return null
  }
}

async function parseOnMainThread(filePath: string, maxEvents: number): Promise<ParseResult> {
  try {
    const content = await readFile(filePath, 'utf8')
    const lines = content.split(/\r?\n/).filter(Boolean)
    const start = maxEvents > 0 ? Math.max(0, lines.length - maxEvents) : 0
    const events: unknown[] = []
    for (let i = start; i < lines.length; i++) {
      try { events.push(JSON.parse(lines[i])) } catch {}
    }
    return { success: true, events, totalLines: lines.length }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

/** 单测隔离用：销毁 worker 实例。 */
export function disposeTraceParseWorker(): void {
  failAll(new Error('disposed'))
  worker?.terminate()
  worker = null
}

export async function parseTraceFile(filePath: string, maxEvents: number): Promise<ParseResult> {
  const w = ensureWorker()
  if (!w) return parseOnMainThread(filePath, maxEvents)

  const id = ++seq
  return new Promise<ParseResult>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      // worker 超时视为可疑（文件极大或卡死）：销毁重建，下次请求走新实例。
      // 不回退主线程解析 —— 主线程解析大文件正是本模块要消灭的卡顿。
      disposeTraceParseWorker()
      resolve({ success: false, error: 'trace parse worker timed out' })
    }, REQUEST_TIMEOUT_MS)
    timer.unref?.()
    pending.set(id, { resolve, timer })
    w.postMessage({ id, filePath, maxEvents } satisfies ParseRequest)
  })
}
