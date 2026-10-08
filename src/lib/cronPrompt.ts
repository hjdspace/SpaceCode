/**
 * 定时任务提示词 → 引擎可执行文本。
 *
 * 编辑器把图片与技能存成 UI 标记（@image:"id" / /cmd:"name":kind:source），引擎只认
 * 原生的 @"path" 与 /name。图片额外带一份落盘清单，在这里还原成路径引用。
 * @file:"path" / @folder:"path" 保持原样 —— 主聊天链路就是这么发给引擎的。
 */

export interface CronPromptAttachment {
  id: string
  name: string
  path: string
}

const IMAGE_MARKER_RE = /@image:"([^"]+)"/g
const CMD_MARKER_RE = /\/cmd:"([^"]+)":\w+:\w+/g

export function buildExecutionPrompt(
  prompt: string,
  attachments?: CronPromptAttachment[],
): string {
  const pathById = new Map((attachments ?? []).map(a => [a.id, a.path]))
  return prompt
    .replace(IMAGE_MARKER_RE, (_match, id: string) => {
      const path = pathById.get(id)
      return path ? `@"${path}"` : ''
    })
    .replace(CMD_MARKER_RE, (_match, name: string) => `/${name}`)
    .trim()
}
