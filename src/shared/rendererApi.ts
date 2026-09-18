/**
 * Renderer API 生成器 — 从 ChannelMap 定义表驱动生成 renderer 端 API 包装。
 *
 * 取代 api/git.ts 中逐个手写 `electronAPI?.git?.isRepo(cwd) || Promise.resolve(false)` 的模式。
 * 统一的 null-check + 默认值策略，类型从 channel 定义自动派生。
 *
 * createEventApi 从 events 段生成事件订阅包装（null-check 转发 + noop unsubscribe 默认值）。
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
import type { ChannelNamespace, EventNamespace, DeriveRendererApi, DeriveEventApi } from './channelMap'

/**
 * 默认值工厂映射：每个方法名 → 返回默认值的函数。
 */
export type DefaultFactories<N extends ChannelNamespace> = {
  [K in keyof N]: () => N[K]['res']
}

export type AnyElectronAPI = Record<
  string,
  Record<string, ((...a: unknown[]) => unknown) | undefined> | undefined
> | null | undefined

/**
 * 从 channel 定义生成 renderer 端 API。
 *
 * 返回一个普通对象（非 Proxy），每个方法做 null-check 转发。
 * 使用普通对象而非 Proxy 的原因：
 * 当消费者通过 `{ ...invokeApi, onStatusChanged }` spread 合并时，
 * Proxy 的 [[OwnPropertyKeys]] trap 会返回 target（空对象 {}）的 own keys，
 * 导致 spread 后丢失所有方法。普通对象的 own keys 可被正确枚举。
 *
 * @param channels - defineNamespace()/defineChannels() 的 channels 段
 * @param namespace - window.electronAPI 上的命名空间名（如 'git'）
 * @param electronAPI - window.electronAPI 引用（可能为 null）
 * @param defaults - 每个方法的默认值工厂（当 electronAPI 不可用时返回）
 * @returns API 对象，每个方法做 null-check 转发
 */
export function createRendererApi<N extends ChannelNamespace>(
  channels: N,
  namespace: string,
  electronAPI: AnyElectronAPI,
  defaults: DefaultFactories<N>,
): DeriveRendererApi<N> {
  const api = {} as Record<string, (...args: unknown[]) => unknown>
  for (const methodName of Object.keys(channels)) {
    const def = channels[methodName]
    if ('kind' in def && def.kind === 'send') {
      api[methodName] = (...args: unknown[]): void => {
        const method = electronAPI?.[namespace]?.[methodName]
        if (method) {
          (method as (...a: unknown[]) => void)(...args)
        }
      }
    } else {
      api[methodName] = (...args: unknown[]): Promise<unknown> => {
        const method = electronAPI?.[namespace]?.[methodName]
        if (method) {
          return method(...args) as Promise<unknown>
        }
        return Promise.resolve((defaults as Record<string, () => unknown>)[methodName]?.())
      }
    }
  }
  return api as DeriveRendererApi<N>
}

/**
 * 从 event 定义生成 renderer 端事件订阅 API。
 * null-check 转发到 electronAPI[namespace][onXxx]，不可用时返回 noop unsubscribe。
 *
 * @param events - defineNamespace() 的 events 段
 * @param namespace - window.electronAPI 上的命名空间名（如 'terminal'）
 * @param electronAPI - window.electronAPI 引用（可能为 null）
 * @returns 订阅对象：每个 onXxx 是 `(callback) => unsubscribe`
 */
export function createEventApi<E extends EventNamespace>(
  events: E,
  namespace: string,
  electronAPI: AnyElectronAPI,
): DeriveEventApi<E> {
  const api = {} as Record<string, (...args: unknown[]) => () => void>
  for (const eventName of Object.keys(events)) {
    api[eventName] = (...args: unknown[]): (() => void) => {
      const method = electronAPI?.[namespace]?.[eventName]
      if (method) {
        return (method as (...a: unknown[]) => () => void)(...args)
      }
      return () => {}
    }
  }
  return api as DeriveEventApi<E>
}
