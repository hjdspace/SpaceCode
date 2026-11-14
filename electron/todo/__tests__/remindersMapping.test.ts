// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  contentToNativeWrite,
  endOfLocalDay,
  isEndOfLocalDay,
  nativeContentHash,
  nativePriorityToTodo,
  nativeToContent,
  roundToMinute,
  todoContentHash,
  todoPriorityToNative,
  type NativeReminder,
} from '../remindersMapping'

function native(overrides: Partial<NativeReminder> = {}): NativeReminder {
  return { id: 'n1', title: '交周报', completed: false, priority: 0, ...overrides }
}

describe('priority mapping', () => {
  it('maps the 0..9 scale onto three buckets both ways', () => {
    expect([0, 1, 4, 5, 6, 9].map(nativePriorityToTodo)).toEqual(['medium', 'high', 'high', 'medium', 'low', 'low'])
    expect([todoPriorityToNative('high'), todoPriorityToNative('medium'), todoPriorityToNative('low')]).toEqual([1, 5, 9])
  })
})

describe('date normalization', () => {
  it('rounds to the minute because Reminders drops seconds', () => {
    const at = new Date(2026, 10, 13, 9, 30, 45, 500).getTime()
    expect(roundToMinute(at)).toBe(new Date(2026, 10, 13, 9, 30).getTime())
  })

  it('recognizes the date-only sentinel at local 23:59', () => {
    const dayOnly = endOfLocalDay(new Date(2026, 10, 13, 8, 0).getTime())
    expect(isEndOfLocalDay(dayOnly)).toBe(true)
    expect(isEndOfLocalDay(new Date(2026, 10, 13, 9, 30).getTime())).toBe(false)
  })
})

describe('content hashes', () => {
  it('agree across both sides for the same content', () => {
    const dueAt = new Date(2026, 10, 13, 14, 0, 30).getTime()
    const local = { title: ' 交周报 ', notes: '细节\r\n第二行 ', status: 'open' as const, priority: 'high' as const, dueAt }
    const fromNative = native({ title: '交周报', notes: '细节\n第二行', priority: 1, dueAt })
    expect(todoContentHash(local)).toBe(nativeContentHash(fromNative))
  })

  it('changes when any synced field changes', () => {
    const base = { title: 'a', status: 'open' as const, priority: 'medium' as const }
    const hash = todoContentHash(base)
    expect(todoContentHash({ ...base, title: 'b' })).not.toBe(hash)
    expect(todoContentHash({ ...base, notes: 'n' })).not.toBe(hash)
    expect(todoContentHash({ ...base, status: 'completed' })).not.toBe(hash)
    expect(todoContentHash({ ...base, priority: 'low' })).not.toBe(hash)
    expect(todoContentHash({ ...base, dueAt: 60_000 })).not.toBe(hash)
  })

  it('ignores sub-minute differences', () => {
    const base = { title: 'a', status: 'open' as const, priority: 'medium' as const }
    expect(todoContentHash({ ...base, dueAt: 60_000 })).toBe(todoContentHash({ ...base, dueAt: 60_001 }))
  })
})

describe('nativeToContent', () => {
  it('maps completion, notes and date-only due dates', () => {
    const day = new Date(2026, 10, 13, 0, 0).getTime()
    const content = nativeToContent(native({ completed: true, notes: ' x ', dueAt: day, dueDateOnly: true, priority: 9 }))
    expect(content.status).toBe('completed')
    expect(content.priority).toBe('low')
    expect(content.notes).toBe('x')
    expect(content.dueAt).toBe(endOfLocalDay(day))
  })

  it('omits absent notes and invalid dates', () => {
    const content = nativeToContent(native({ notes: '   ', dueAt: Number.NaN }))
    expect(content.notes).toBeUndefined()
    expect(content.dueAt).toBeUndefined()
  })
})

describe('contentToNativeWrite', () => {
  it('marks a 23:59 due time as date-only and clears empty notes', () => {
    const dueAt = endOfLocalDay(Date.now())
    const write = contentToNativeWrite({ title: ' a ', status: 'completed', priority: 'low', dueAt })
    expect(write).toEqual({ title: 'a', notes: '', completed: true, dueAt: roundToMinute(dueAt), dueDateOnly: true, priority: 9 })
  })

  it('writes null for an unset due date', () => {
    const write = contentToNativeWrite({ title: 'a', status: 'open', priority: 'medium' })
    expect(write.dueAt).toBeNull()
    expect(write.dueDateOnly).toBe(false)
    expect(write.priority).toBe(5)
  })
})