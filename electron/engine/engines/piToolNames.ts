/**
 * pi 的内置工具用小写名（bash/read/write/edit/grep/find），而渲染层的组件、
 * 图标、标签与 trace 分类表一律按 Claude Code 的 PascalCase 名精确匹配。
 * 实时事件映射（PiEventMapper）与历史恢复（piSessionHistory）必须用同一张表，
 * 否则同一份 JSONL 在实时和重开后会长成两种工具卡片。
 */
const PI_TOOL_NAME_ALIASES: Record<string, string> = {
  bash: 'Bash',
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  grep: 'Grep',
  find: 'Glob',
}

export function mapPiToolName(name: unknown): string | undefined {
  if (typeof name !== 'string' || !name) return undefined
  return PI_TOOL_NAME_ALIASES[name] ?? name
}
