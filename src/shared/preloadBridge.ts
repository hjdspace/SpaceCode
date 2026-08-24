/**
 * Preload Bridge 生成器 — 从 ChannelMap 定义表驱动生成 ipcRenderer.invoke 桥。
 *
 * 取代 preload.ts 中逐个手写 `ipcRenderer.invoke('git:isRepo', cwd)` 的模式。
 * channel 名即对象属性名，编译期拼写检查。
 *
 * @example
 * import { ipcRenderer } from 'electron'
 * import { gitChannels } from '@/shared/channels/git'
 * import { createPreloadBridge } from '@/shared/preloadBridge'
 *
 * const gitBridge = createPreloadBridge(gitChannels, ipcRenderer, 'git:')
 * // → { isRepo: (cwd) => ipcRenderer.invoke('git:isRepo', cwd), ... }
 */
import type { ChannelNamespace, DeriveRendererApi } from './channelMap'

/**
 * 从 channel 定义生成 preload bridge。
 *
 * @param channels - defineChannels() 返回的定义对象
 * @param ipcRenderer - Electron 的 ipcRenderer 模块
 * @param prefix - channel 名前缀（如 'git:'），会与属性名拼接
 * @returns 桥对象，每个方法是 `(...args) => ipcRenderer.invoke(prefix + methodName, ...args)`
 */
export function createPreloadBridge<N extends ChannelNamespace>(
  channels: N,
  ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> },
  prefix: string,
): DeriveRendererApi<N> {
  const bridge = {} as Record<string, (...args: unknown[]) => Promise<unknown>>
  for (const methodName of Object.keys(channels)) {
    bridge[methodName] = (...args: unknown[]) =>
      ipcRenderer.invoke(prefix + methodName, ...args)
  }
  return bridge as DeriveRendererApi<N>
}
