/**
 * 归一化绝对路径：统一分隔符、折叠重复分隔符、去除尾部冗余。
 *
 * 用于修复历史数据中出现的形如 `D:\\AI\SpaceCode` 的坏路径——这类路径
 * 会导致侧边栏按 workingDirectory 分组时出现重复项目，且"打开文件夹"
 * 因路径非法而失败。坏路径来源：Claude Code JSONL 历史里的 cwd 字段
 * （见 sessionHistoryManager.readSessionLite 的 realProjectPath）。
 *
 * 规则：
 *  - Windows 盘符路径（D:\… / D:/…）：统一为反斜杠，折叠重复分隔符，
 *    保留盘符根（D:\）；UNC 路径（\\server\share）的前导双反斜杠保留。
 *  - POSIX 绝对路径（/work/…）：保持正斜杠，仅折叠重复分隔符。
 */
export function normalizeAbsolutePath(input: string): string {
  if (!input) return input

  const trimmed = input.trim()
  if (!trimmed) return trimmed

  // POSIX 绝对路径：不以盘符开头且以 / 起始（UNC 已被下方 Windows 分支覆盖）
  const isDrivePath = /^[A-Za-z]:[/\\]/.test(trimmed)
  if (!isDrivePath && trimmed.startsWith('/')) {
    return trimmed.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/'
  }

  // Windows 路径（盘符 / UNC / 反斜杠形式）：统一为反斜杠
  let p = trimmed.replace(/\//g, '\\')

  // 保留 UNC 前导双反斜杠，其余连续分隔符折叠为单个
  const isUNC = p.startsWith('\\\\')
  const prefix = isUNC ? '\\\\' : ''
  const body = isUNC ? p.slice(2) : p
  p = prefix + body.replace(/\\{2,}/g, '\\')

  // 去除尾部分隔符（保留 D:\ 这类盘符根的最小形式）
  if (p.length > 3 && p.endsWith('\\')) {
    p = p.slice(0, -1)
  }

  return p
}
