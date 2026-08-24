/**
 * Typed Channel Map — IPC channel 的单一真相源。
 *
 * 每个 channel 定义三要素：名（字符串）、请求参数类型、响应类型。
 * 从这份定义自动派生：
 *   - preload bridge（表驱动注册，取代手写 ipcRenderer.invoke）
 *   - renderer API 类型（取代 electron.d.ts 中的手写子接口）
 *   - handler 注册时的编译期拼写检查
 *
 * 设计原则（codebase-design / deep module）：
 *   - Interface 小：defineChannels + createPreloadBridge + createRendererApi
 *   - Implementation 深：吸收 channel 名拼写检查、类型跨边界一致性、preload 表驱动注册
 *   - Seam 在 preload ↔ handler ↔ renderer 三方交汇点
 *   - 渐进迁移：按命名空间逐步迁移，不破坏现有未迁移的 channel
 */

// ── 核心类型 ────────────────────────────────────────────────────

/**
 * 一个 channel 的定义：方法名 → { req: 参数元组, res: 返回类型 }
 */
export interface ChannelDefinition {
  req: readonly unknown[]
  res: unknown
}

/**
 * Channel 命名空间定义：方法名 → ChannelDefinition
 */
export type ChannelNamespace = Record<string, ChannelDefinition>

/**
 * 从 ChannelNamespace 派生出 renderer 端 API 的类型。
 * 每个方法变成 `(...args: D['req']) => Promise<D['res']>`
 */
export type DeriveRendererApi<N extends ChannelNamespace> = {
  [K in keyof N]: (...args: N[K]['req']) => Promise<N[K]['res']>
}

/**
 * 从 ChannelNamespace 派生出 handler 的类型。
 * handler 接收去掉第一个 IpcEvent 后的参数，返回 res。
 */
export type DeriveHandler<N extends ChannelNamespace> = {
  [K in keyof N]: (...args: N[K]['req']) => Promise<N[K]['res']> | N[K]['res']
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
 * 从 channel 定义派生出 channel 名的常量对象。
 * 用于 handler 端 `ipcMain.handle(CHANNELS.isRepo, ...)`。
 *
 * @example
 * const GIT_CHANNELS = defineChannels({ isRepo: { ... } })
 * const GIT_CHANNEL_NAMES = channelNames(GIT_CHANNELS)
 * ipcMain.handle(GIT_CHANNEL_NAMES.isRepo, ...)
 */
export function channelNames<N extends ChannelNamespace>(channels: N): { [K in keyof N]: string } {
  const result = {} as { [K in keyof N]: string }
  for (const key of Object.keys(channels)) {
    result[key as keyof N] = key as string
  }
  return result
}
