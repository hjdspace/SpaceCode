/**
 * 外链协议闸门 — 沙箱桥与主进程 IPC 共用同一口径。
 *
 * 只放行绝对 `http:` / `https:`；相对地址、`javascript:`、`file:`、`data:`、
 * 自定义 scheme 一律拒绝。`shell.openExternal` 在 Windows 上会把 `file:` 交给
 * ShellExecute，等于执行本地程序，所以这条闸门必须落在真正调用它的那一侧。
 */
export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== ''
}
