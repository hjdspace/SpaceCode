/**
 * 命令是否把输出交给了会攒到 EOF 才吐出的管道/重定向。
 *
 * 只用于界面提示：`... | tail -60`、`... > log` 这类命令在执行结束前
 * 本身就没有字节可流，Bash 卡片再实时也看不到输出。判定刻意保持窄，
 * `2>&1` / `2>/dev/null` 这类只改 stderr 的写法不算，避免提示噪音。
 */
export function hasBufferingOutputPipe(command: string | undefined | null): boolean {
  if (!command) return false
  if (/\|\s*(?:tail|head)(?=\s|$)/m.test(command)) return true
  if (/(?:^|\s)&>\s*[^\s|;&]+/m.test(command)) return true
  return /(?:^|[^0-9&>])>{1,2}\s*(?!&)[^\s|;&]+/m.test(command)
}
