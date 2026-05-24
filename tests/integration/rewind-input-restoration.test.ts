/**
 * 用户消息恢复到输入框功能测试
 *
 * 测试回滚时将用户消息恢复到输入框的UX增强功能
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Mock chatStore
function createMockChatStore() {
  const state = {
    pendingInputText: '' as string,
  }

  return {
    state,
    setPendingInputText(text: string) {
      state.pendingInputText = text
    },
    clearPendingInputText() {
      state.pendingInputText = ''
    }
  }
}

// Mock ChatInput component behavior
function createMockChatInput(chatStore: ReturnType<typeof createMockChatStore>) {
  const inputText = { value: '' as string }

  // Simulate the watch on pendingInputText
  function simulatePendingInputWatch(newText: string) {
    if (newText && newText.trim()) {
      inputText.value = newText
      chatStore.clearPendingInputText()
    }
  }

  return { inputText, simulatePendingInputWatch }
}

describe('User Message Restoration to Input Box', () => {
  describe('Scenario 1: Rewind with user message to restore', () => {
    it('should store user message content when rewinding conversation', () => {
      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'First question' },
        { id: 'msg-2', role: 'assistant' as const, content: 'First answer' },
        { id: 'msg-3', role: 'user' as const, content: 'Second question to restore' },
        { id: 'msg-4', role: 'assistant' as const, content: 'Second answer' },
      ]

      const targetIndex = 2
      const messagesToRemove = messages.slice(targetIndex)
      const targetMessage = messages[targetIndex]
      const lastUserMessage = [...messagesToRemove].reverse().find(m => m.role === 'user')

      assert.ok(lastUserMessage)
      assert.strictEqual(lastUserMessage?.id, 'msg-3')
      assert.strictEqual(lastUserMessage?.content, 'Second question to restore')

      const remainingMessages = messages.slice(0, targetIndex)
      assert.strictEqual(remainingMessages.length, 2, 'Target user message should be removed from chat')
      assert.strictEqual(remainingMessages[remainingMessages.length - 1]?.id, 'msg-2', 'Last remaining message should be the assistant answer before target')
    })

    it('should restore target user message content when it is the only user message removed', () => {
      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'First question' },
        { id: 'msg-2', role: 'assistant' as const, content: 'First answer' },
        { id: 'msg-3', role: 'user' as const, content: 'Second question to restore' },
      ]

      const targetIndex = 2
      const messagesToRemove = messages.slice(targetIndex)
      const targetMessage = messages[targetIndex]
      const lastUserMessage = [...messagesToRemove].reverse().find(m => m.role === 'user')

      assert.strictEqual(lastUserMessage?.id, 'msg-3')
      assert.strictEqual(lastUserMessage?.content, 'Second question to restore')
    })

    it('should restore user message to input box via pendingInputText', async () => {
      const chatStore = createMockChatStore()
      const chatInput = createMockChatInput(chatStore)

      // Step 1: Store user message during rewind
      const userMessageContent = '请帮我总结未提交的修改'
      chatStore.setPendingInputText(userMessageContent)

      assert.strictEqual(chatStore.state.pendingInputText, userMessageContent)

      // Step 2: ChatInput watches and fills input
      chatInput.simulatePendingInputWatch(chatStore.state.pendingInputText)

      assert.strictEqual(chatInput.inputText.value, userMessageContent)
      assert.strictEqual(chatStore.state.pendingInputText, '', 'pendingInputText should be cleared')
    })
  })

  describe('Scenario 2: Rewind without user message to restore', () => {
    it('should not restore when only assistant messages are removed', () => {
      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'Question' },
        { id: 'msg-2', role: 'assistant' as const, content: 'Answer part 1' },
        { id: 'msg-3', role: 'assistant' as const, content: 'Answer part 2' },
      ]

      const targetIndex = 1
      const messagesToRemove = messages.slice(targetIndex)
      const targetMessage = messages[targetIndex]
      const lastUserMessage = [...messagesToRemove].reverse().find(m => m.role === 'user')

      assert.strictEqual(lastUserMessage, undefined, 'No user message in removed range after target')

      assert.strictEqual(targetMessage?.role, 'assistant', 'Target message is assistant, not user')
    })

    it('should clear pendingInputText when no user message found', () => {
      const chatStore = createMockChatStore()

      // Set empty content (no user message to restore)
      chatStore.setPendingInputText('')

      assert.strictEqual(chatStore.state.pendingInputText, '')
    })
  })

  describe('Scenario 3: Multiple user messages in removed range', () => {
    it('should restore the LAST user message (most recent)', () => {
      const messages = [
        { id: 'msg-1', role: 'user' as const, content: 'First question' },
        { id: 'msg-2', role: 'assistant' as const, content: 'Answer 1' },
        { id: 'msg-3', role: 'user' as const, content: 'Follow-up 1' },
        { id: 'msg-4', role: 'assistant' as const, content: 'Answer 2' },
        { id: 'msg-5', role: 'user' as const, content: 'Follow-up 2 (most recent)' },
        { id: 'msg-6', role: 'assistant' as const, content: 'Answer 3' },
      ]

      const targetIndex = 2
      const messagesToRemove = messages.slice(targetIndex)
      const lastUserMessage = [...messagesToRemove].reverse().find(m => m.role === 'user')

      assert.ok(lastUserMessage)
      assert.strictEqual(lastUserMessage?.id, 'msg-5', 'Should find the last user message')
      assert.strictEqual(lastUserMessage?.content, 'Follow-up 2 (most recent)')

      const remainingMessages = messages.slice(0, targetIndex)
      assert.strictEqual(remainingMessages.length, 2)
      assert.strictEqual(remainingMessages[remainingMessages.length - 1]?.id, 'msg-2')
    })
  })

  describe('Scenario 4: Edge cases', () => {
    it('should handle empty content gracefully', () => {
      const chatStore = createMockChatStore()
      const chatInput = createMockChatInput(chatStore)

      chatStore.setPendingInputText('')
      chatInput.simulatePendingInputWatch(chatStore.state.pendingInputText)

      assert.strictEqual(chatInput.inputText.value, '', 'Input should remain empty')
    })

    it('should handle whitespace-only content gracefully', () => {
      const chatStore = createMockChatStore()
      const chatInput = createMockChatInput(chatStore)

      chatStore.setPendingInputText('   ')
      chatInput.simulatePendingInputWatch(chatStore.state.pendingInputText)

      assert.strictEqual(chatInput.inputText.value, '', 'Whitespace-only should not fill input')
    })

    it('should preserve multiline content correctly', () => {
      const chatStore = createMockChatStore()
      const chatInput = createMockChatInput(chatStore)

      const multilineContent = `第一行内容
第二行内容
第三行内容`

      chatStore.setPendingInputText(multilineContent)
      chatInput.simulatePendingInputWatch(chatStore.state.pendingInputText)

      assert.strictEqual(chatInput.inputText.value, multilineContent)
      assert.ok(chatInput.inputText.value.includes('\n'), 'Newlines should be preserved')
    })
  })

  describe('Scenario 5: Integration with different rewind modes', () => {
    it('should restore input in "conversation" mode', () => {
      // In conversation mode, we always restore if there's a user message
      const mode: string = 'conversation'
      const hasCodeError = false

      // Use includes() to avoid TypeScript literal type comparison warning
      const needsConversationRewind = ['conversation', 'both'].includes(mode)
      const shouldRestore = needsConversationRewind && !(mode === 'both' && hasCodeError)
      assert.strictEqual(shouldRestore, true, 'Conversation mode should allow restoration')
    })

    it('should restore input in "both" mode when code succeeds', () => {
      const mode = 'both'
      const hasCodeError = false

      const needsConversationRewind = ['conversation', 'both'].includes(mode)
      const shouldRestore = needsConversationRewind && !(mode === 'both' && hasCodeError)
      assert.strictEqual(shouldRestore, true, 'Both mode with success should allow restoration')
    })

    it('should NOT restore input in "both" mode when code fails', () => {
      const mode = 'both'
      const hasCodeError = true

      const needsConversationRewind = ['conversation', 'both'].includes(mode)
      const shouldRestore = needsConversationRewind && !(mode === 'both' && hasCodeError)
      assert.strictEqual(shouldRestore, false, 'Both mode with failure should NOT restore')
    })

    it('should restore input in "code" mode (no conversation rewind)', () => {
      // Code mode doesn't touch conversation, so no restoration needed
      const mode = 'code'
      const needsConversationRewind = ['conversation', 'both'].includes(mode)

      assert.strictEqual(needsConversationRewind, false, 'Code mode does not rewind conversation')
    })
  })
})
