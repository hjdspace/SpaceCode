/**
 * 端点到分段文本的纯函数 —— 直播文本与终稿共用同一套拼接规则。
 *
 * 识别器开启 endpoint 后，每到一个端点就重置流；已提交的分段按空格拼接，
 * 正在解码的一段追加在末尾。端点提交前后字符串完全相同，所以 live 文本
 * 不会在端点处“跳一下”。
 */
export function composeTranscript(segments: readonly string[], partial: string): string {
  const parts = segments.filter((segment) => segment.trim().length > 0)
  const tail = partial.trim()
  if (tail) parts.push(tail)
  return parts.join(' ')
}
