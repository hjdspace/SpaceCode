/**
 * 分组色 → CSS 变量。存的是 token 名（见 TODO_GROUP_COLORS），
 * 未知值回落到 teal，避免用户手改 JSON 后渲染出 `var(--todo-hue-undefined)`。
 */
import { TODO_GROUP_COLORS } from '@/shared/channels/todo'
import type { TodoGroupColor } from '@/shared/channels/todo'

export function todoGroupHue(color: string | undefined): string {
  const name: TodoGroupColor = TODO_GROUP_COLORS.includes(color as TodoGroupColor)
    ? (color as TodoGroupColor)
    : 'teal'
  return `var(--todo-hue-${name})`
}