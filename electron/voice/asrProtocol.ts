/**
 * 主进程 ↔ ASR worker 的消息协议。
 *
 * 协议刻意只有四个请求与四个响应：worker 是常驻的，模型只在首个 start
 * 消息里加载；stop / cancel 之后 worker 保留模型，供下一次会话复用。
 */
export type AsrWorkerRequest =
  | { type: 'start'; modelDir: string }
  | { type: 'audio'; samples: Int16Array }
  | { type: 'stop' }
  | { type: 'cancel' }

export type AsrWorkerResponse =
  | { type: 'ready' }
  | { type: 'partial'; text: string }
  | { type: 'final'; text: string }
  | { type: 'error'; message: string }
