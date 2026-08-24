/**
 * Handler 注册器 — 从 ChannelMap 定义生成类型安全的 handler 注册。
 *
 * 取代 gitService.ts 中逐个手写 `ipcMain.handle('git:isRepo', async (_event, cwd) => ...)` 的模式。
 * channel 名从定义对象派生，编译期拼写检查；handler 参数类型自动推断。
 *
 * @example
 * import { ipcMain } from 'electron'
 * import { gitChannels } from '@/shared/channels/git'
 * import { registerHandlers } from '@/shared/handlerRegistry'
 *
 * registerHandlers(ipcMain, gitChannels, 'git:', {
 *   isRepo: async (cwd: string) => isGitRepo(cwd),
 *   getStatus: async (cwd: string) => getStatus(cwd),
 *   ...
 * })
 */
import type { IpcMain } from 'electron'
import type { ChannelNamespace, DeriveHandler } from './channelMap'

/**
 * 注册一组 IPC handler。
 *
 * @param ipcMain - Electron 的 ipcMain 模块
 * @param channels - defineChannels() 返回的定义对象（仅用于类型推断和 channel 名枚举）
 * @param prefix - channel 名前缀（如 'git:'）
 * @param handlers - handler 映射对象，每个方法的参数类型自动推断
 */
export function registerHandlers<N extends ChannelNamespace>(
  ipcMain: IpcMain,
  _channels: N,
  prefix: string,
  handlers: DeriveHandler<N>,
): void {
  for (const methodName of Object.keys(_channels)) {
    const handler = (handlers as Record<string, (...a: unknown[]) => unknown>)[methodName]
    if (typeof handler === 'function') {
      ipcMain.handle(prefix + methodName, (_event, ...args) => handler(...args))
    }
  }
}
