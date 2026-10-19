/**
 * 文件树行内重命名的名称校验（纯字符串判定，无副作用）。
 *
 * 必须在调用 fs:rename 之前跑：主进程用 renameSync，POSIX 上目标存在会静默覆盖，
 * 非法名称则把 EINVAL 这类原始报错抛给用户。返回 i18n 键由调用方翻译。
 *
 * 字符集与保留名取 Windows 侧（比 POSIX 严）：在 Linux 上改出的名字日后同步到
 * Windows 也不会炸。空名返回 null —— 清空输入框语义上是"取消"，不是错误。
 */

export type NodeNameError = 'invalidChars' | 'reservedName' | 'tooLong'

const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001F]/
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_NAME_LENGTH = 255

export function validateNodeName(rawName: string): NodeNameError | null {
  const name = rawName.trim()
  if (!name) return null

  if (ILLEGAL_CHARS.test(name) || name.endsWith('.')) return 'invalidChars'

  // Windows 把带扩展名的设备名同样视为保留名：CON.txt 非法，CONFIG.sys 合法。
  const base = name.split('.')[0]
  if (WINDOWS_RESERVED.test(base)) return 'reservedName'

  if (name.length > MAX_NAME_LENGTH) return 'tooLong'

  return null
}
