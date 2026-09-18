/**
 * Typed Channel Map — IPC channel 的单一真相源。
 *
 * 每个 channel 定义三要素：名（字符串）、请求参数类型、响应类型。
 * 事件订阅（onXxx）用 events 段声明：channel 后缀 + 回调参数元组。
 * 从这份定义自动派生：
 *   - preload bridge（表驱动注册，取代手写 ipcRenderer.invoke / send / on）
 *   - renderer API 类型（取代 electron.d.ts 中的手写子接口）
 *   - handler 注册时的编译期拼写检查
 *
 * 设计原则（codebase-design / deep module）：
 *   - Interface 小：defineNamespace + createPreloadBridge + createRendererApi
 *   - Implementation 深：吸收 channel 名拼写检查、类型跨边界一致性、preload 表驱动注册
 *   - Seam 在 preload ↔ handler ↔ renderer 三方交汇点
 *   - 渐进迁移：按命名空间逐步迁移，不破坏现有未迁移的 channel
 */

// ── 核心类型 ────────────────────────────────────────────────────

/**
 * 一个 invoke channel 的定义：方法名 → { req: 参数元组, res: 返回类型 }
 */
export interface InvokeDefinition {
  req: readonly unknown[]
  res: unknown
  kind?: 'invoke'
  /** channel 名覆盖（默认 = 前缀 + 方法名）。用于方法名与 wire 上的 channel 名不一致的历史遗留。 */
  channel?: string
}

/**
 * 一个 fire-and-forget channel 的定义（ipcRenderer.send，无返回值）。
 * res 对 send 无意义，省略。
 */
export interface SendDefinition {
  kind: 'send'
  req: readonly unknown[]
  res?: unknown
  channel?: string
}

/**
 * 一个 channel 的定义：invoke（默认）或 send。
 */
export type ChannelDefinition = InvokeDefinition | SendDefinition

/**
 * Channel 命名空间定义：方法名 → ChannelDefinition
 */
export type ChannelNamespace = Record<string, ChannelDefinition>

/**
 * 一个事件订阅的定义：方法名 → { channel: 后缀, args: 回调参数元组 }。
 * 完整 channel 名 = 前缀（如 'terminal:'）+ channel 后缀（如 'data'）。
 * 回调收到的参数 = main 侧 webContents.send 发出的参数列表，原样透传。
 */
export interface EventDefinition {
  channel: string
  args: readonly unknown[]
}

/**
 * Event 命名空间定义：方法名（onXxx）→ EventDefinition
 */
export type EventNamespace = Record<string, EventDefinition>

/**
 * 一个命名空间的完整定义：invoke/send channels + events 订阅。
 * 每个命名空间一份定义文件，是 preload、类型、renderer api、handler 四方的真相源。
 */
export interface NamespaceDefinition {
  channels: ChannelNamespace
  events: EventNamespace
}

/**
 * 从 ChannelNamespace 派生出 renderer 端 API 的类型。
 * invoke → `(...args) => Promise<res>`；send → `(...args) => void`
 */
export type DeriveRendererApi<N extends ChannelNamespace> = {
  [K in keyof N]: N[K] extends { kind: 'send' }
    ? (...args: N[K]['req']) => void
    : (...args: N[K]['req']) => Promise<N[K]['res']>
}

/**
 * 从 EventNamespace 派生出事件订阅 API 的类型。
 * 每个 onXxx → `(callback: (...payload: args) => void) => () => void`。
 * args 元组描述 callback 收到的 payload（main 侧 send 的参数列表）。
 */
export type DeriveEventApi<E extends EventNamespace> = {
  [K in keyof E]: (callback: (...args: E[K]['args']) => void) => () => void
}

/**
 * 从 ChannelNamespace 派生出 handler 的类型。
 * handler 接收去掉第一个 IpcEvent 后的参数，返回 res。
 */
export type DeriveHandler<N extends ChannelNamespace> = {
  [K in keyof N]: N[K] extends { kind: 'send' }
    ? (...args: N[K]['req']) => void
    : (...args: N[K]['req']) => Promise<N[K]['res']> | N[K]['res']
}

// ── 工具函数 ────────────────────────────────────────────────────

/**
 * 定义一组 channel。运行时返回原对象（仅用于类型推断），零运行时开销。
 *
 * @example
 * const gitChannels = defineChannels({
 *   isRepo: { req: [String] as const, res: Boolean as unknown as boolean },
 *   getStatus: { req: [String] as const, res: null as unknown as GitStatus },
 * })
 */
export function defineChannels<N extends ChannelNamespace>(channels: N): N {
  return channels
}

/**
 * 定义一个完整命名空间（channels + events）。运行时返回原对象，零运行时开销。
 *
 * @example
 * export const terminalNamespace = defineNamespace({
 *   channels: { create: { req: ..., res: ... }, write: { kind: 'send', req: ... } },
 *   events: { onData: { channel: 'data', args: [] as unknown as [id: string, data: string] } },
 * })
 */
export function defineNamespace<N extends NamespaceDefinition>(def: N): N {
  return def
}

/**
 * 从 channel 定义派生出 wire channel 名的常量对象。
 * 用于 handler 端 `ipcMain.handle(CHANNELS.isRepo, ...)`。
 * 派生名 = 前缀 + (channel 覆盖 ?? 方法名)，与 preload bridge 的 wire 名一致 ——
 * 两边共享同一真相源，任一侧拼写漂移都在编译期暴露。
 *
 * @example
 * const GIT_CHANNELS = defineChannels({ isRepo: { ... } })
 * const GIT_CHANNEL_NAMES = channelNames(GIT_CHANNELS, 'git:')
 * ipcMain.handle(GIT_CHANNEL_NAMES.isRepo, ...)
 */
export function channelNames<N extends ChannelNamespace>(channels: N, prefix: string): { [K in keyof N]: string } {
  const result = {} as { [K in keyof N]: string }
  for (const key of Object.keys(channels)) {
    const def = channels[key] as { channel?: string }
    result[key as keyof N] = prefix + (def.channel ?? key)
  }
  return result
}

/**
 * 从 event 定义派生出完整事件 channel 名的常量对象。
 * 用于 handler 端 `webContents.send(EVENTS.onData, ...)` 取代内联字符串。
 */
export function eventChannels<E extends EventNamespace>(events: E, prefix: string): { [K in keyof E]: string } {
  const result = {} as { [K in keyof E]: string }
  for (const key of Object.keys(events)) {
    result[key as keyof E] = prefix + (events[key as keyof E] as EventDefinition).channel
  }
  return result
}

/**
 * 从 event 定义派生出「channel 后缀 → 完整 channel 名」的反查表。
 * 用于 main 侧按事件类型动态派发的场景（如引擎事件路由
 * `send(EVENT_BY_SUFFIX[eventType], ...)` 取代 `send(\`prefix:${eventType}\`)`）。
 * 后缀不在表内 → undefined，动态派发处据此发现表外事件类型。
 */
export function eventChannelsBySuffix<E extends EventNamespace>(events: E, prefix: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of Object.keys(events)) {
    const def = events[key as keyof E] as EventDefinition
    result[def.channel] = prefix + def.channel
  }
  return result
}
