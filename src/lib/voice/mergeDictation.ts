/**
 * 终稿合并规则 —— 快照草稿 + 终稿，只追加不覆盖。
 *
 * 草稿已有内容时换行接上新的一行：输入框里 Enter 是发送，追加一行
 * 让用户先看再决定；草稿本身以空白结尾时则直接接续。
 */
export function buildDictationAppend(snapshotText: string, finalText: string): string {
  const final = finalText.trim()
  if (!final) return ''
  if (!snapshotText) return final
  return /\s$/.test(snapshotText) ? final : `\n${final}`
}

export function mergeDictationText(snapshotText: string, finalText: string): string {
  return snapshotText + buildDictationAppend(snapshotText, finalText)
}
