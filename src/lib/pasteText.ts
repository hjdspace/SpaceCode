/**
 * 长文本粘贴的判定与摘要。
 *
 * 粘贴原文超过阈值时不再塞进 contenteditable，而是落盘成 .txt 附件：
 * 输入框、消息气泡和会话存储里只留一张卡片。阈值按字符数算，
 * 十几 KB 的日志/堆栈一次就能命中。
 */

/** 超过这个字符数的粘贴文本改走附件；阈值以内仍按普通文本插入 */
export const PASTED_TEXT_CHAR_THRESHOLD = 4000

/** 卡片标题取首行，过长时截断，避免消息里出现一整段正文 */
export const PASTED_TEXT_TITLE_MAX_LENGTH = 60

export function shouldExternalizePaste(text: string): boolean {
  return text.length > PASTED_TEXT_CHAR_THRESHOLD
}

export function summarizePastedText(
  text: string,
  maxLength: number = PASTED_TEXT_TITLE_MAX_LENGTH,
): string {
  const firstLine = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0) || ''

  if (firstLine.length <= maxLength) return firstLine
  return `${firstLine.slice(0, maxLength).trimEnd()}…`
}
