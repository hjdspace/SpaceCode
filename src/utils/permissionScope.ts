import type { PermissionUpdate } from '@/shared/channels/claudeCode'

/** 会写进 settings 文件的落点。'session' 只进内存，'cliArg' 不由应答产生。 */
const PERSISTABLE_DESTINATIONS: readonly string[] = ['userSettings', 'projectSettings', 'localSettings']

/**
 * 这批授权在引擎进程重启后是否仍然有效。
 *
 * destination 为 'session' 的更新只改内存里的权限上下文，进程一挂就没了；只有落盘
 * 到 settings 的才是真的"始终"。按钮文案用它避免对会话级授权过度承诺 —— 否则修好
 * "点了没反应"之后，会立刻变成"点了但下次开机又问了"。
 */
export function isPermissionGrantPermanent(updates: PermissionUpdate[] | undefined): boolean {
  if (!updates || updates.length === 0) return false
  return updates.some(update => PERSISTABLE_DESTINATIONS.includes(update.destination))
}
