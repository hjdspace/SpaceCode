/**
 * 从 Agent 输出文本中识别「可在右侧工作台打开」的目标。
 * 目前覆盖两类:
 *  - http(s) URL(含 localhost / 127.0.0.1) -> 微型浏览器
 *  - 本地 .html / .htm / .md / .markdown 文件路径 -> 文件预览
 *
 * 仅做轻量正则扫描, 与 MarkdownRenderer 的链接点击逻辑互补:
 * MarkdownRenderer 负责行内链接可点击, 本工具负责在消息底部聚合出醒目的入口按钮。
 */

export interface WorkbenchTarget {
  kind: 'url' | 'file'
  /** 用于打开的值: url 或文件路径 */
  value: string
  /** 按钮展示文本 */
  label: string
}

const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/gi
const FILE_REGEX = /(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])[\w.\-\\/]+\.(?:html?|md|markdown)\b/gi

function stripTrailingPunctuation(s: string): string {
  return s.replace(/[.,;:!?)]+$/, '')
}

export function detectWorkbenchTargets(content: string): WorkbenchTarget[] {
  if (!content) return []

  const seen = new Set<string>()
  const targets: WorkbenchTarget[] = []

  const urlMatches = content.match(URL_REGEX) || []
  for (const raw of urlMatches) {
    const url = stripTrailingPunctuation(raw)
    if (seen.has(url)) continue
    seen.add(url)
    let label = url
    try {
      const u = new URL(url)
      label = u.host + (u.pathname !== '/' ? u.pathname : '')
    } catch { /* keep raw */ }
    targets.push({ kind: 'url', value: url, label })
  }

  const fileMatches = content.match(FILE_REGEX) || []
  for (const raw of fileMatches) {
    const path = stripTrailingPunctuation(raw)
    if (seen.has(path)) continue
    seen.add(path)
    const name = path.split(/[\\/]/).pop() || path
    targets.push({ kind: 'file', value: path, label: name })
  }

  return targets
}
