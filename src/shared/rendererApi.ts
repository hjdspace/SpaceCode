/**
 * Renderer API 生成器 — 从 ChannelMap 定义表驱动生成 renderer 端 API 包装。
 *
 * 取代 api/git.ts 中逐个手写 `electronAPI?.git?.isRepo(cwd) || Promise.resolve(false)` 的模式。
 * 统一的 null-check + 默认值策略，类型从 channel 定义自动派生。
 *
 * @example
 * import { gitChannels } from '@/shared/channels/git'
 * import { createRendererApi } from '@/shared/rendererApi'
 * import { electronAPI } from '@/services/api/_context'
 *
 * export const git = createRendererApi(gitChannels, 'git', electronAPI, {
 *   isRepo: () => false,
 *   getRoot: () => null,
 *   ...
 * })
 */
import type { ChannelNamespace, DeriveRendererApi } from './channelMap'

/**
 * 默认值工厂映射：每个方法名 → 返回默认值的函数。
 */
export type DefaultFactories<N extends ChannelNamespace> = {
  [K in keyof N]: () => N[K]['res']
}

/**
 * 从 channel 定义生成 renderer 端 API。
 *
 * 返回一个普通对象（非 Proxy），每个方法做 null-check 转发。
 * 使用普通对象而非 Proxy 的原因：
 * 当消费者通过 `{ ...invokeApi, onStatusChanged }` spread 合并时，
 * Proxy 的 [[OwnPropertyKeys]] trap 会返回 target（空对象 {}）的 own keys，
 * 导致 spread 后丢失所有方法。普通对象的 own keys 可被正确枚举。
 *
 * @param channels - defineChannels() 返回的定义对象
 * @param namespace - window.electronAPI 上的命名空间名（如 'git'）
 * @param electronAPI - window.electronAPI 引用（可能为 null）
 * @param defaults - 每个方法的默认值工厂（当 electronAPI 不可用时返回）
 * @returns API 对象，每个方法做 null-check 转发
 */
export function createRendererApi<N extends ChannelNamespace>(
  channels: N,
  namespace: string,
  electronAPI: Record<string, Record<string, ((...a: unknown[]) => Promise<unknown>) | undefined> | undefined> | null | undefined,
  defaults: DefaultFactories<N>,
): DeriveRendererApi<N> {
  const api = {} as Record<string, (...args: unknown[]) => Promise<unknown>>
  for (const methodName of Object.keys(channels)) {
    api[methodName] = (...args: unknown[]): Promise<unknown> => {
      const ns = electronAPI?.[namespace]
      const method = ns?.[methodName]
      if (method) {
        return method(...args)
      }
      return Promise.resolve((defaults as Record<string, () => unknown>)[methodName]?.())
    }
  }
  return api as DeriveRendererApi<N>
}
