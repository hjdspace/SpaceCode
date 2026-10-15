import type { Session } from '@/types'

/**
 * 产物发现位置。
 *
 * 曾经的口径：work 助手约定写入 `<工作目录>/outputs/`，design / code 会话才额外
 * 扫工作区根目录。但 officecli 技能族（xlsx / docx / pptx 助手）并没有 outputs/
 * 约定 —— LLM 按用户语义把表格写在工作目录任意位置（issue #40 问题 4 复测时
 * 表格就落在了工作目录根），turn 结束的收集因此扫不到，自动预览从不触发。
 *
 * 现在所有模式都扫工作区根：根扫描只收交付物扩展名（DELIVERABLE_EXTS，见
 * artifactsService），不会把整棵项目树报成本轮产物。
 */
export function needsWorkspaceRootScan(_mode?: Session['mode']): boolean {
  return true
}
