/**
 * 系统提醒事项 ↔ 本地待办的字段映射与内容指纹。
 *
 * 两侧要能判断「谁改了」，就必须对同一份内容算出同一个指纹，因此这里集中处理
 * 三处系统侧的规范化：
 *  - 提醒事项的日期只保留到分钟（EventKit 不存秒），指纹与回填都按分钟取整；
 *  - 备注里的 CRLF 会被系统改成 LF；
 *  - 优先级是 0..9 的数字（0 未设置、1-4 高、5 中、6-9 低），与三档枚举互转。
 *
 * 纯函数，不碰 osascript，也不碰 store。
 */
import { createHash } from 'crypto'
import type { TodoPriority, TodoStatus } from '@/shared/channels/todo'

/** osascript 回读的一条系统提醒事项（已 JSON 化） */
export interface NativeReminder {
  id: string
  title: string
  notes?: string
  completed: boolean
  dueAt?: number
  dueDateOnly?: boolean
  priority: number
}

export interface TodoContent {
  title: string
  notes?: string
  status: TodoStatus
  priority: TodoPriority
  dueAt?: number
}

export const MINUTE_MS = 60_000

/** 系统只存到分钟；不取整会导致每次同步都判成「双方都改了」。 */
export function roundToMinute(at: number): number {
  return Math.floor(at / MINUTE_MS) * MINUTE_MS
}

/** 系统侧「只设了日期」的待办，本地统一落在当天 23:59（与 Proma 的口径一致）。 */
export function endOfLocalDay(at: number): number {
  const d = new Date(at)
  d.setHours(23, 59, 0, 0)
  return d.getTime()
}

export function isEndOfLocalDay(at: number): boolean {
  const d = new Date(at)
  return d.getHours() === 23 && d.getMinutes() === 59
}

export function nativePriorityToTodo(priority: number): TodoPriority {
  if (priority >= 1 && priority <= 4) return 'high'
  if (priority >= 6) return 'low'
  return 'medium'
}

export function todoPriorityToNative(priority: TodoPriority): number {
  if (priority === 'high') return 1
  if (priority === 'low') return 9
  return 5
}

function normalizeNotes(notes: string | undefined): string {
  return (notes ?? '').replace(/\r\n/g, '\n').trim()
}

export function normalizeContent(content: TodoContent): Required<Pick<TodoContent, 'title' | 'notes' | 'status' | 'priority'>> & { dueAt: number | null } {
  return {
    title: content.title.trim(),
    notes: normalizeNotes(content.notes),
    status: content.status,
    priority: content.priority,
    dueAt: content.dueAt === undefined ? null : roundToMinute(content.dueAt),
  }
}

/** 内容指纹：只覆盖会被同步的字段，提醒/分组/标签是本地独有的，不参与比较。 */
export function todoContentHash(content: TodoContent): string {
  const n = normalizeContent(content)
  return createHash('sha1')
    .update(JSON.stringify([n.title, n.notes, n.status, n.priority, n.dueAt]))
    .digest('hex')
}

export function nativeContentHash(native: NativeReminder): string {
  return todoContentHash(nativeToContent(native))
}

export function nativeToContent(native: NativeReminder): TodoContent {
  const content: TodoContent = {
    title: native.title.trim(),
    status: native.completed ? 'completed' : 'open',
    priority: nativePriorityToTodo(native.priority),
  }
  const notes = normalizeNotes(native.notes)
  if (notes) content.notes = notes
  if (native.dueAt !== undefined && Number.isFinite(native.dueAt)) {
    content.dueAt = native.dueDateOnly ? endOfLocalDay(native.dueAt) : roundToMinute(native.dueAt)
  }
  return content
}

/** 本地待办推给系统时的形态；date-only 由本地时间是否落在 23:59 推断。 */
export interface NativeWrite {
  title: string
  notes: string
  completed: boolean
  dueAt: number | null
  dueDateOnly: boolean
  priority: number
}

export function contentToNativeWrite(content: TodoContent): NativeWrite {
  const n = normalizeContent(content)
  return {
    title: n.title,
    notes: n.notes,
    completed: n.status === 'completed',
    dueAt: n.dueAt,
    dueDateOnly: n.dueAt !== null && isEndOfLocalDay(n.dueAt),
    priority: todoPriorityToNative(n.priority),
  }
}