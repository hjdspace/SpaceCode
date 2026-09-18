/**
 * Terminal Channel 定义 — terminal 命名空间 IPC 的单一真相源。
 *
 * 本文件定义了所有 `terminal:*` channel 的三要素（名、参数类型、返回类型）
 * 与事件订阅（channel 后缀 + 回调参数元组），preload bridge、renderer API 类型、
 * handler 注册均从此派生。
 *
 * 迁移自：
 *   - preload.ts 中 terminal: {...} 的手写 invoke/send/on（7 个成员）
 *   - electron.d.ts 中 ElectronTerminalAPI 接口的手写签名
 *   - api/terminal.ts 中 null-check 转发的手写签名
 *   - main.ts 中内联字符串 channel 名
 */
import { defineNamespace } from '@/shared/channelMap'
import type { DeriveRendererApi, DeriveEventApi } from '@/shared/channelMap'

export interface TerminalCreateOptions {
  cwd?: string
  command?: string
  env?: Record<string, string>
}

export interface TerminalCreateResult {
  id: string | null
  shell?: string
  error?: string
}

export const terminalNamespace = defineNamespace({
  channels: {
    create: {
      req: [] as unknown as [options?: TerminalCreateOptions],
      res: null as unknown as TerminalCreateResult,
    },
    write: { kind: 'send', req: [] as unknown as [id: string, data: string] },
    resize: { kind: 'send', req: [] as unknown as [id: string, cols: number, rows: number] },
    kill: { kind: 'send', req: [] as unknown as [id: string] },
    runCommand: { kind: 'send', req: [] as unknown as [id: string, command: string] },
  },
  events: {
    onData: { channel: 'data', args: [] as unknown as [id: string, data: string] },
    onExit: { channel: 'exit', args: [] as unknown as [id: string, exitCode: number] },
  },
})

export type TerminalChannelMap = typeof terminalNamespace.channels
export type TerminalEventMap = typeof terminalNamespace.events
export type TerminalRendererApi = DeriveRendererApi<TerminalChannelMap>
export type TerminalEventApi = DeriveEventApi<TerminalEventMap>
