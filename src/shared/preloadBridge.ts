/**
 * Preload Bridge 生成器 — 从 ChannelMap 定义表驱动生成 ipcRenderer 桥。
 *
 * 取代 preload.ts 中逐个手写 `ipcRenderer.invoke('git:isRepo', cwd)` 的模式。
 * channel 名即对象属性名，编译期拼写检查。
 *
 * invoke channel → `(...args) => ipcRenderer.invoke(prefix + name, ...args)`
 * send channel   → `(...args) => ipcRenderer.send(prefix + name, ...args)`
 *
 * createEventBridge 从 events 段生成事件订阅桥：
 * 订阅 `prefix + channel`，payload 参数原样透传给 callback，返回 unsubscribe。
 *
 * @example
 * import { ipcRenderer } from 'electron'
 * import { terminalNamespace } from '@/shared/channels/terminal'
 * import { createPreloadBridge, createEventBridge } from '@/shared/preloadBridge'
 *
 * const bridge = {
 *   ...createPreloadBridge(terminalNamespace.channels, ipcRenderer, 'terminal:'),
 *   ...createEventBridge(terminalNamespace.events, ipcRenderer, 'terminal:'),
 * }
 */
import type { ChannelNamespace, EventNamespace, DeriveRendererApi, DeriveEventApi } from './channelMap'

/**
 * 从 channel 定义生成 preload bridge。
 *
 * @param channels - defineNamespace()/defineChannels() 的 channels 段
 * @param ipcRenderer - Electron 的 ipcRenderer 模块
 * @param prefix - channel 名前缀（如 'git:'），会与属性名拼接
 * @returns 桥对象：invoke 方法返回 Promise，send 方法返回 void
 */
export function createPreloadBridge<N extends ChannelNamespace>(
  channels: N,
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    send: (channel: string, ...args: unknown[]) => void
  },
  prefix: string,
): DeriveRendererApi<N> {
  const bridge = {} as Record<string, (...args: unknown[]) => unknown>
  for (const methodName of Object.keys(channels)) {
    const def = channels[methodName]
    const channelName = prefix + (def.channel ?? methodName)
    if ('kind' in def && def.kind === 'send') {
      bridge[methodName] = (...args: unknown[]) => {
        ipcRenderer.send(channelName, ...args)
      }
    } else {
      bridge[methodName] = (...args: unknown[]) =>
        ipcRenderer.invoke(channelName, ...args)
    }
  }
  return bridge as DeriveRendererApi<N>
}

/**
 * 从 event 定义生成 preload 事件订阅桥。
 *
 * @param events - defineNamespace() 的 events 段
 * @param ipcRenderer - Electron 的 ipcRenderer 模块
 * @param prefix - channel 名前缀（如 'terminal:'），与 event 的 channel 后缀拼接
 * @returns 订阅对象：每个 onXxx 是 `(callback) => unsubscribe`
 */
export function createEventBridge<E extends EventNamespace>(
  events: E,
  ipcRenderer: {
    on: (channel: string, listener: (...args: unknown[]) => void) => unknown
    removeListener: (channel: string, listener: (...args: unknown[]) => void) => unknown
  },
  prefix: string,
): DeriveEventApi<E> {
  const bridge = {} as Record<string, (...args: unknown[]) => () => void>
  for (const eventName of Object.keys(events)) {
    const channel = prefix + events[eventName].channel
    bridge[eventName] = (...args: unknown[]) => {
      const callback = args[0] as (...payload: unknown[]) => void
      const wrapper = (_event: unknown, ...payload: unknown[]) => callback(...payload)
      ipcRenderer.on(channel, wrapper)
      return () => {
        ipcRenderer.removeListener(channel, wrapper)
      }
    }
  }
  return bridge as DeriveEventApi<E>
}
