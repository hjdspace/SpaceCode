export type HookEventType =
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostCustomToolCall'
  | 'Notification'
  | 'UserPromptSubmit'
  | 'Stop'
  | 'SubagentStop'
  | 'PreCompact'
  | 'SessionStart'
  | 'SessionEnd'

export type HookType = 'command' | 'prompt'

export type HookScope = 'user' | 'project' | 'local'

export interface HookEntry {
  id: string
  type: HookType
  command?: string
  prompt?: string
  timeout?: number
  disabled?: boolean
}

export interface HookMatcher {
  matcher: string
  hooks: HookEntry[]
}

export interface HookGroup {
  event: HookEventType
  matchers: HookMatcher[]
}

export interface HookFlatItem {
  id: string
  name: string
  event: HookEventType
  matcher: string
  type: HookType
  command: string
  timeout: number
  scope: HookScope
  disabled: boolean
}

export const HOOK_EVENTS: { value: HookEventType; label: string; description: string; hasMatcher: boolean }[] = [
  { value: 'PreToolUse', label: 'PreToolUse', description: '工具执行前', hasMatcher: true },
  { value: 'PostToolUse', label: 'PostToolUse', description: '工具执行后', hasMatcher: true },
  { value: 'PostCustomToolCall', label: 'PostCustomToolCall', description: 'MCP 工具完成后', hasMatcher: true },
  { value: 'Notification', label: 'Notification', description: '通知时', hasMatcher: false },
  { value: 'UserPromptSubmit', label: 'UserPromptSubmit', description: '用户提交提示时', hasMatcher: false },
  { value: 'Stop', label: 'Stop', description: 'Agent 完成时', hasMatcher: false },
  { value: 'SubagentStop', label: 'SubagentStop', description: '子 Agent 完成时', hasMatcher: false },
  { value: 'PreCompact', label: 'PreCompact', description: '上下文压缩前', hasMatcher: false },
  { value: 'SessionStart', label: 'SessionStart', description: '会话启动时', hasMatcher: false },
  { value: 'SessionEnd', label: 'SessionEnd', description: '会话结束时', hasMatcher: false },
]

export const HOOK_TOOL_MATCHERS: { value: string; label: string }[] = [
  { value: 'Bash', label: 'Bash' },
  { value: 'Read', label: 'Read' },
  { value: 'Write', label: 'Write' },
  { value: 'Edit', label: 'Edit' },
  { value: 'MultiEdit', label: 'MultiEdit' },
  { value: 'Glob', label: 'Glob' },
  { value: 'Grep', label: 'Grep' },
  { value: 'Task', label: 'Task' },
  { value: 'WebFetch', label: 'WebFetch' },
  { value: 'WebSearch', label: 'WebSearch' },
  { value: 'Write|Edit', label: 'Write|Edit' },
  { value: '*', label: '*（所有工具）' },
]

export const SCOPE_LABELS: Record<HookScope, { label: string; path: string }> = {
  user: { label: '用户级', path: '~/.claude/settings.json' },
  project: { label: '项目级', path: '.claude/settings.json' },
  local: { label: '本地级', path: '.claude/settings.local.json' },
}

export function getEventDescription(event: HookEventType): string {
  const found = HOOK_EVENTS.find(e => e.value === event)
  return found?.description ?? event
}

export function eventHasMatcher(event: HookEventType): boolean {
  const found = HOOK_EVENTS.find(e => e.value === event)
  return found?.hasMatcher ?? false
}
