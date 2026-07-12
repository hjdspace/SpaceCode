/**
 * API 模块共享上下文 — 在所有按领域拆分的 api/ 子模块间共享的运行时状态。
 *
 * - electronAPI：preload.ts 通过 contextBridge 暴露的 window.electronAPI 引用
 * - _isH5Mode：H5 远程访问模式标志（URL 含 token 参数且非 Electron 环境）
 * - h5ApiClient：H5 模式下的 HTTP API 客户端
 * - h5Adapter：H5 模式下替代 IPC 桥接的 ElectronClaudeCodeAPI 适配器
 */
import { isH5Mode, initH5Connection } from '../h5ApiClient'
import { createH5Adapter } from '../h5Adapter'
import type { ElectronClaudeCodeAPI } from '@/types/electron'

export const electronAPI = typeof window !== 'undefined' ? window.electronAPI : null
export const _isH5Mode = typeof window !== 'undefined' && isH5Mode()
export let h5Adapter: ElectronClaudeCodeAPI | null = null

if (_isH5Mode) {
  initH5Connection()
  h5Adapter = createH5Adapter()
}
