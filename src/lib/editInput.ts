/**
 * Edit 工具入参的 old/new 归一化 —— 两家引擎的字段名与形态都不同：
 * - Claude Code：顶层 `old_string`/`new_string`（MultiEdit 则是 `edits[]` 元素上同名）
 * - pi：`{ path, edits: [{ oldText, newText }] }`（批量形态 + 驼峰字段名）
 *
 * 渲染层（EditToolCard 的 diff、AgentTimeline 的 diff chips）共用这一份提取，
 * 字段名口径只写一遍 —— 漏一处就会出现"编辑成功但卡片显示 +0 / 无变更"。
 */
export interface EditPart {
  old: string
  new: string
}

function stringAt(obj: unknown, keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

/**
 * 从 Edit 工具入参提取 old/new 文本对，按请求顺序返回。
 *
 * 兼容三种形状：
 * - Claude Edit：顶层 `old_string`/`new_string`
 * - Claude MultiEdit：`edits[]` 元素上的 `old_string`/`new_string`
 * - pi edit：`edits[]` 元素上的 `oldText`/`newText`（`old_string` 等作为兜底别名）
 *
 * old/new 全空的段不产出 —— 对 diff 毫无意义，留着只会让调用方多做一次过滤。
 * 只关心字段的调用方无需区分引擎 —— 拿到空数组即"没有可渲染的编辑内容"。
 */
export function extractEditParts(input: Record<string, unknown> | undefined | null): EditPart[] {
  if (!input) return []
  const parts: EditPart[] = []

  const oldString = stringAt(input, ['old_string'])
  const newString = stringAt(input, ['new_string'])
  if (oldString || newString) {
    parts.push({ old: oldString ?? '', new: newString ?? '' })
  }

  const edits = input.edits
  if (Array.isArray(edits)) {
    for (const edit of edits) {
      const oldText = stringAt(edit, ['oldText', 'old_string'])
      const newText = stringAt(edit, ['newText', 'new_string'])
      if (oldText || newText) {
        parts.push({ old: oldText ?? '', new: newText ?? '' })
      }
    }
  }

  return parts
}

/** 是否存在至少一段非空的编辑内容 —— 两端都是空串的请求渲染不出 diff。 */
export function hasEditableParts(parts: EditPart[]): boolean {
  return parts.some(part => part.old || part.new)
}
