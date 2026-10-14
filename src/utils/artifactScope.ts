import type { Session } from '@/types'

/**
 * 产物发现位置。
 *
 * work 助手被约定写入 `<工作目录>/outputs/`，那里的每个文件都是交付物；
 * design / code 会话的 agent 直接写在工作区里，所以这些模式要额外扫工作区根目录
 * （主进程对根目录扫描只收交付物扩展名，避免把整棵项目树报成本轮产物）。
 */
export function needsWorkspaceRootScan(mode?: Session['mode']): boolean {
  return mode !== 'work'
}
