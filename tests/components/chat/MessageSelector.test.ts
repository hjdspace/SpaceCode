/**
 * MessageSelector component logic tests - run with:
 *   node --experimental-strip-types --test tests/components/chat/MessageSelector.test.ts
 *
 * These tests verify the MessageSelector component's logic layer including
 * message filtering, formatting, relative time display, and event emission.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Types (mirroring src/types/rewind.ts) ──────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface MessageSelectorProps {
  show: boolean
  messages: Message[]
  selectedMessageId: string | null
}

interface MessageSelectorEmits {
  'update:show': [value: boolean]
  select: [messageId: string]
  cancel: []
}

// ── Mock i18n translations ─────────────────────────────────────────

const mockTranslations: Record<string, string> = {
  'chat.rewindSelectMessage': '选择要回滚到的消息',
  'chat.rewindCurrentPrompt': '当前提示',
  'chat.rewindNoMessages': '没有可回滚的消息',
  'common.cancel': '取消',
}

function t(key: string): string {
  return mockTranslations[key] || key
}

// ── Component Logic (extracted from MessageSelector.vue) ───────────

const MAX_PREVIEW_LENGTH = 80

function filterUserMessages(messages: Message[]): Message[] {
  return messages.filter((m) => m.role === 'user')
}

function formatMessagePreview(content: string): string {
  if (content.length <= MAX_PREVIEW_LENGTH) {
    return content
  }
  return content.slice(0, MAX_PREVIEW_LENGTH) + '...'
}

function formatRelativeTime(timestamp: number, now: number): string {
  const diffMs = now - timestamp
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) {
    return 'just now'
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`
  }
  if (diffHour < 24) {
    return `${diffHour}h ago`
  }
  if (diffDay < 30) {
    return `${diffDay}d ago`
  }
  return 'long ago'
}

function createEmits(): {
  emits: Record<keyof MessageSelectorEmits, unknown[][]>
  emit: <K extends keyof MessageSelectorEmits>(event: K, ...args: MessageSelectorEmits[K]) => void
} {
  const emits: Record<keyof MessageSelectorEmits, unknown[][]> = {
    'update:show': [],
    select: [],
    cancel: [],
  }

  function emit<K extends keyof MessageSelectorEmits>(event: K, ...args: MessageSelectorEmits[K]) {
    emits[event].push(args)
  }

  return { emits, emit }
}

function createDefaultProps(): MessageSelectorProps {
  return {
    show: false,
    messages: [],
    selectedMessageId: null,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('MessageSelector - Message Filtering', () => {
  it('should filter only user messages', () => {
    const messages: Message[] = [
      { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: 'msg-2', role: 'assistant', content: 'Hi', timestamp: Date.now() },
      { id: 'msg-3', role: 'user', content: 'Do something', timestamp: Date.now() },
    ]

    const filtered = filterUserMessages(messages)
    assert.strictEqual(filtered.length, 2)
    assert.strictEqual(filtered[0].id, 'msg-1')
    assert.strictEqual(filtered[1].id, 'msg-3')
  })

  it('should return empty array when no user messages', () => {
    const messages: Message[] = [
      { id: 'msg-1', role: 'assistant', content: 'Hi', timestamp: Date.now() },
      { id: 'msg-2', role: 'assistant', content: 'Bye', timestamp: Date.now() },
    ]

    const filtered = filterUserMessages(messages)
    assert.strictEqual(filtered.length, 0)
  })

  it('should return empty array for empty messages', () => {
    const filtered = filterUserMessages([])
    assert.strictEqual(filtered.length, 0)
  })

  it('should preserve message order', () => {
    const messages: Message[] = [
      { id: 'msg-1', role: 'user', content: 'First', timestamp: 1000 },
      { id: 'msg-2', role: 'assistant', content: 'Second', timestamp: 2000 },
      { id: 'msg-3', role: 'user', content: 'Third', timestamp: 3000 },
      { id: 'msg-4', role: 'user', content: 'Fourth', timestamp: 4000 },
    ]

    const filtered = filterUserMessages(messages)
    assert.deepStrictEqual(
      filtered.map((m) => m.id),
      ['msg-1', 'msg-3', 'msg-4']
    )
  })
})

describe('MessageSelector - Message Preview Formatting', () => {
  it('should return full content when under max length', () => {
    const content = 'Short message'
    assert.strictEqual(formatMessagePreview(content), 'Short message')
  })

  it('should truncate content over 80 characters', () => {
    const content = 'a'.repeat(100)
    const result = formatMessagePreview(content)
    assert.strictEqual(result.length, 83) // 80 + '...'
    assert.ok(result.endsWith('...'))
  })

  it('should truncate exactly at 80 characters', () => {
    const content = 'a'.repeat(80)
    assert.strictEqual(formatMessagePreview(content), content)
  })

  it('should handle empty content', () => {
    assert.strictEqual(formatMessagePreview(''), '')
  })

  it('should handle content with 81 characters', () => {
    const content = 'a'.repeat(81)
    const result = formatMessagePreview(content)
    assert.strictEqual(result.length, 83)
    assert.ok(result.endsWith('...'))
  })
})

describe('MessageSelector - Relative Time Formatting', () => {
  const now = 1700000000000

  it('should format just now for less than 60 seconds', () => {
    assert.strictEqual(formatRelativeTime(now - 30000, now), 'just now')
    assert.strictEqual(formatRelativeTime(now - 59000, now), 'just now')
  })

  it('should format minutes ago', () => {
    assert.strictEqual(formatRelativeTime(now - 60000, now), '1m ago')
    assert.strictEqual(formatRelativeTime(now - 300000, now), '5m ago')
    assert.strictEqual(formatRelativeTime(now - 3540000, now), '59m ago')
  })

  it('should format hours ago', () => {
    assert.strictEqual(formatRelativeTime(now - 3600000, now), '1h ago')
    assert.strictEqual(formatRelativeTime(now - 7200000, now), '2h ago')
    assert.strictEqual(formatRelativeTime(now - 82800000, now), '23h ago')
  })

  it('should format days ago', () => {
    assert.strictEqual(formatRelativeTime(now - 86400000, now), '1d ago')
    assert.strictEqual(formatRelativeTime(now - 172800000, now), '2d ago')
    assert.strictEqual(formatRelativeTime(now - 2505600000, now), '29d ago')
  })

  it('should format long ago for over 30 days', () => {
    assert.strictEqual(formatRelativeTime(now - 2592000001, now), 'long ago')
  })
})

describe('MessageSelector - Event Emission', () => {
  it('should emit select event with message id', () => {
    const { emits, emit } = createEmits()

    emit('select', 'msg-123')

    assert.strictEqual(emits.select.length, 1)
    assert.deepStrictEqual(emits.select[0], ['msg-123'])
  })

  it('should emit cancel event', () => {
    const { emits, emit } = createEmits()

    emit('cancel')

    assert.strictEqual(emits.cancel.length, 1)
    assert.deepStrictEqual(emits.cancel[0], [])
  })

  it('should emit update:show event', () => {
    const { emits, emit } = createEmits()

    emit('update:show', false)

    assert.strictEqual(emits['update:show'].length, 1)
    assert.deepStrictEqual(emits['update:show'][0], [false])
  })

  it('should emit multiple select events', () => {
    const { emits, emit } = createEmits()

    emit('select', 'msg-1')
    emit('select', 'msg-2')

    assert.strictEqual(emits.select.length, 2)
    assert.deepStrictEqual(emits.select[0], ['msg-1'])
    assert.deepStrictEqual(emits.select[1], ['msg-2'])
  })
})

describe('MessageSelector - Props', () => {
  it('should have correct default props', () => {
    const props = createDefaultProps()

    assert.strictEqual(props.show, false)
    assert.deepStrictEqual(props.messages, [])
    assert.strictEqual(props.selectedMessageId, null)
  })

  it('should accept show as true', () => {
    const props = createDefaultProps()
    props.show = true
    assert.strictEqual(props.show, true)
  })

  it('should accept messages array', () => {
    const props = createDefaultProps()
    props.messages = [
      { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
    ]
    assert.strictEqual(props.messages.length, 1)
  })

  it('should accept selectedMessageId', () => {
    const props = createDefaultProps()
    props.selectedMessageId = 'msg-1'
    assert.strictEqual(props.selectedMessageId, 'msg-1')
  })
})

describe('MessageSelector - i18n', () => {
  it('should have rewindSelectMessage translation', () => {
    assert.strictEqual(t('chat.rewindSelectMessage'), '选择要回滚到的消息')
  })

  it('should have rewindCurrentPrompt translation', () => {
    assert.strictEqual(t('chat.rewindCurrentPrompt'), '当前提示')
  })

  it('should have rewindNoMessages translation', () => {
    assert.strictEqual(t('chat.rewindNoMessages'), '没有可回滚的消息')
  })

  it('should have common.cancel translation', () => {
    assert.strictEqual(t('common.cancel'), '取消')
  })

  it('should fallback to key if translation missing', () => {
    assert.strictEqual(t('chat.nonexistent'), 'chat.nonexistent')
  })
})

describe('MessageSelector - Edge Cases', () => {
  it('should handle message with exactly 80 characters', () => {
    const content = 'x'.repeat(80)
    const result = formatMessagePreview(content)
    assert.strictEqual(result, content)
    assert.strictEqual(result.length, 80)
  })

  it('should handle message with newline characters', () => {
    const content = 'Line 1\nLine 2\nLine 3'
    const result = formatMessagePreview(content)
    assert.strictEqual(result, content)
  })

  it('should handle message with unicode characters', () => {
    const content = '你好世界'.repeat(20)
    const result = formatMessagePreview(content)
    assert.ok(result.length <= 83)
    assert.ok(result.endsWith('...') || result === content)
  })

  it('should handle zero timestamp', () => {
    const now = 1700000000000
    assert.strictEqual(formatRelativeTime(0, now), 'long ago')
  })

  it('should handle future timestamp', () => {
    const now = 1700000000000
    // Future time should still produce some output without error
    const result = formatRelativeTime(now + 60000, now)
    assert.strictEqual(result, 'just now')
  })
})
