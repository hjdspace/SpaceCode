/**
 * 路径边界判定 — 被预览服务器与导出打包共用的同一套闸门。
 *
 * 这两条链路的授权范围必须是同一个口径（用户在预览里能看到什么，导出才能打包什么），
 * 所以规则集中在这里，不再各写一份：
 *  - canonicalize：路径存在时按 realpath 算（符号链接按目标判定），不存在时退回 resolve，
 *    于是"还没写出来但位于允许根下"的目标保持"读不到"的行为而不是抛错。
 *  - inside：归一化后的前缀归属判定。
 *  - isFileSystemRoot：把文件系统根当工作区等于放开整盘，必须拒绝。
 */
import { realpathSync } from 'fs'
import { parse, resolve, sep } from 'path'

const IS_WIN = process.platform === 'win32'

/** Windows 路径大小写不敏感，末尾分隔符也不影响归属，比较前先归一。 */
export function compareForm(path: string): string {
  const stripped = path.replace(/[\\/]+$/, '')
  const value = stripped === '' ? path : stripped
  return IS_WIN ? value.toLowerCase() : value
}

export function canonicalize(candidate: string): string {
  try {
    return realpathSync(candidate)
  } catch {
    return resolve(candidate)
  }
}

/** 归一（大小写 + 末尾分隔符）后判归属；调用方不必记得自己先归一。 */
export function inside(child: string, root: string): boolean {
  const normalizedRoot = compareForm(root)
  const normalizedChild = compareForm(child)
  const prefix = normalizedRoot === '' ? root : normalizedRoot + sep
  return normalizedChild === normalizedRoot || normalizedChild.startsWith(prefix)
}

/** `C:\` 与 `/` 这类文件系统根：把它们当根等于放开整个盘，必须拒绝。 */
export function isFileSystemRoot(absPath: string): boolean {
  return compareForm(parse(absPath).root) === compareForm(absPath)
}
