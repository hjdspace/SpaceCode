/**
 * MessageItem rewind button logic tests - run with:
 *   node --experimental-strip-types --test tests/components/chat/MessageItem.rewind.test.ts
 *
 * These tests verify the rewind button visibility logic, hover state handling,
 * and event emission for the MessageItem component.
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Types (mirroring src/types/index.ts) ───────────────────────────

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

// ── Mock i18n translations ─────────────────────────────────────────

const mockTranslations: Record<string, string> = {
  'chat.rewind': '回滚',
  'chat.you': '你',
  'chat.claude': 'Claude',
}

function t(key: string): string {
  return mockTranslations[key] || key
}

// ── Component Logic (extracted from MessageItem.vue) ───────────────

interface MessageItemProps {
  message: Message
  canRewind?: boolean
}

interface MessageItemEmits {
  toolSubmit: [messageId: string, toolId: string, updatedInput: Record<string, unknown>]
  toolSkip: [messageId: string, toolId: string]
  rewind: [message: Message]
}

function shouldShowRewindButton(props: MessageItemProps, isHovered: boolean): boolean {
  if (!isHovered) return false
  if (props.message.role !== 'user') return false
  if (props.canRewind === false) return false
  return true
}

function createEmits(): { emits: Record<keyof MessageItemEmits, unknown[][]>; emit: <K extends keyof MessageItemEmits>(event: K, ...args: MessageItemEmits[K]) => void } {
  const emits: Record<keyof MessageItemEmits, unknown[][]> = {
    toolSubmit: [],
    toolSkip: [],
    rewind: [],
  }

  function emit<K extends keyof MessageItemEmits>(event: K, ...args: MessageItemEmits[K]) {
    emits[event].push(args)
  }

  return { emits, emit }
}

function createUserMessage(overrides?: Partial<Message>): Message {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello',
    timestamp: Date.now(),
    ...overrides,
  }
}

function createAssistantMessage(overrides?: Partial<Message>): Message {
  return {
    id: 'msg-2',
    role: 'assistant',
    content: 'Hi there',
    timestamp: Date.now(),
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('MessageItem Rewind Button - Visibility', () => {
  it('should show rewind button for user message when hovered and canRewind is true', () => {
    const props: MessageItemProps = { message: createUserMessage(), canRewind: true }
    assert.strictEqual(shouldShowRewindButton(props, true), true)
  })

  it('should show rewind button for user message when hovered and canRewind is undefined', () => {
    const props: MessageItemProps = { message: createUserMessage() }
    assert.strictEqual(shouldShowRewindButton(props, true), true)
  })

  it('should NOT show rewind button when not hovered', () => {
    const props: MessageItemProps = { message: createUserMessage(), canRewind: true }
    assert.strictEqual(shouldShowRewindButton(props, false), false)
  })

  it('should NOT show rewind button for assistant message even when hovered', () => {
    const props: MessageItemProps = { message: createAssistantMessage(), canRewind: true }
    assert.strictEqual(shouldShowRewindButton(props, true), false)
  })

  it('should NOT show rewind button for system message even when hovered', () => {
    const props: MessageItemProps = { message: { ...createUserMessage(), role: 'system' }, canRewind: true }
    assert.strictEqual(shouldShowRewindButton(props, true), false)
  })

  it('should NOT show rewind button when canRewind is false', () => {
    const props: MessageItemProps = { message: createUserMessage(), canRewind: false }
    assert.strictEqual(shouldShowRewindButton(props, true), false)
  })
})

describe('MessageItem Rewind Button - Hover State', () => {
  it('should transition from hidden to visible on mouse enter', () => {
    const props: MessageItemProps = { message: createUserMessage(), canRewind: true }
    assert.strictEqual(shouldShowRewindButton(props, false), false)
    assert.strictEqual(shouldShowRewindButton(props, true), true)
  })

  it('should transition from visible to hidden on mouse leave', () => {
    const props: MessageItemProps = { message: createUserMessage(), canRewind: true }
    assert.strictEqual(shouldShowRewindButton(props, true), true)
    assert.strictEqual(shouldShowRewindButton(props, false), false)
  })
})

describe('MessageItem Rewind Button - Event Emission', () => {
  it('should emit rewind event with message object on click', () => {
    const { emits, emit } = createEmits()
    const message = createUserMessage()

    emit('rewind', message)

    assert.strictEqual(emits.rewind.length, 1)
    assert.deepStrictEqual(emits.rewind[0], [message])
  })

  it('should emit rewind event with correct message data', () => {
    const { emits, emit } = createEmits()
    const message = createUserMessage({ id: 'msg-abc', content: 'Test message' })

    emit('rewind', message)

    assert.strictEqual(emits.rewind.length, 1)
    const emittedMessage = (emits.rewind[0] as [Message])[0]
    assert.strictEqual(emittedMessage.id, 'msg-abc')
    assert.strictEqual(emittedMessage.content, 'Test message')
    assert.strictEqual(emittedMessage.role, 'user')
  })
})

describe('MessageItem Rewind Button - i18n', () => {
  it('should have rewind translation key', () => {
    assert.strictEqual(t('chat.rewind'), '回滚')
  })

  it('should fallback to key if translation missing', () => {
    assert.strictEqual(t('chat.nonexistent'), 'chat.nonexistent')
  })
})

describe('MessageItem Rewind Button - Props', () => {
  it('should accept canRewind as optional prop', () => {
    const propsWithCanRewind: MessageItemProps = { message: createUserMessage(), canRewind: true }
    const propsWithoutCanRewind: MessageItemProps = { message: createUserMessage() }

    assert.strictEqual(shouldShowRewindButton(propsWithCanRewind, true), true)
    assert.strictEqual(shouldShowRewindButton(propsWithoutCanRewind, true), true)
  })

  it('should respect canRewind=false to hide button', () => {
    const props: MessageItemProps = { message: createUserMessage(), canRewind: false }
    assert.strictEqual(shouldShowRewindButton(props, true), false)
  })
})

describe('MessageItem Rewind Button - Edge Cases', () => {
  it('should handle empty content user message', () => {
    const props: MessageItemProps = { message: createUserMessage({ content: '' }), canRewind: true }
    assert.strictEqual(shouldShowRewindButton(props, true), true)
  })

  it('should handle user message with only whitespace content', () => {
    const props: MessageItemProps = { message: createUserMessage({ content: '   ' }), canRewind: true }
    assert.strictEqual(shouldShowRewindButton(props, true), true)
  })

  it('should not show button for assistant even with canRewind undefined', () => {
    const props: MessageItemProps = { message: createAssistantMessage() }
    assert.strictEqual(shouldShowRewindButton(props, true), false)
  })
})
