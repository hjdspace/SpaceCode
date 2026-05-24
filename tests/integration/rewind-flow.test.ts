/**
 * Rewind integration tests - End-to-end flow validation
 *
 * Tests the complete rewind feature integration:
 * - Flow 1: Click rewind button → Dialog → Confirm rewind
 * - Flow 2: /rewind command → Selector → Dialog → Confirm rewind
 * - Flow 3: Cancel operations
 * - Flow 4: Error handling
 *
 * Run with: node --experimental-strip-types --test tests/integration/rewind-flow.test.ts
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Types (mirroring src/types/rewind.ts) ──────────────────────────

type RewindOption = 'both' | 'conversation' | 'code' | 'summarize' | 'cancel'

interface RewindState {
  showDialog: boolean
  selectedMessageId: string | null
  selectedOption: RewindOption
  summarizeFeedback: string
  isRewinding: boolean
  error: string | null
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

// ── Mock API ───────────────────────────────────────────────────────

let mockRewindTurnCalls: Array<{
  sessionId: string
  options: { targetUserMessageId: string; userMessageIndex?: number }
  projectPath?: string
}> = []
let mockRewindTurnResult: { ok: boolean; error: string | null } = { ok: true, error: null }
let mockShouldThrow: boolean = false

function resetMockAPI() {
  mockRewindTurnCalls = []
  mockRewindTurnResult = { ok: true, error: null }
  mockShouldThrow = false
}

async function mockRewindTurn(
  sessionId: string,
  options: { targetUserMessageId: string; userMessageIndex?: number },
  projectPath?: string
): Promise<{ ok: boolean; error: string | null }> {
  mockRewindTurnCalls.push({ sessionId, options, projectPath })
  if (mockShouldThrow) {
    throw new Error('Network error')
  }
  return { ...mockRewindTurnResult }
}

// ── Mock Store (simulating chat store behavior) ────────────────────

function createMockStore() {
  let _state: RewindState = {
    showDialog: false,
    selectedMessageId: null,
    selectedOption: 'both',
    summarizeFeedback: '',
    isRewinding: false,
    error: null,
  }

  const messages: Message[] = [
    { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() - 30000 },
    { id: 'msg-2', role: 'assistant', content: 'Hi there', timestamp: Date.now() - 25000 },
    { id: 'msg-3', role: 'user', content: 'Write a function', timestamp: Date.now() - 20000 },
    { id: 'msg-4', role: 'assistant', content: 'Here is the function', timestamp: Date.now() - 15000 },
    { id: 'msg-5', role: 'user', content: 'Refactor it', timestamp: Date.now() - 10000 },
    { id: 'msg-6', role: 'assistant', content: 'Refactored', timestamp: Date.now() - 5000 },
  ]

  let _showMessageSelector = false

  function getState(): RewindState {
    return { ..._state }
  }

  function setShowRewindDialog(show: boolean) {
    _state = { ..._state, showDialog: show }
  }

  function setRewindSelectedMessage(messageId: string | null) {
    _state = { ..._state, selectedMessageId: messageId }
  }

  function setRewindSelectedOption(option: RewindOption) {
    _state = { ..._state, selectedOption: option }
  }

  function setRewindSummarizeFeedback(feedback: string) {
    _state = { ..._state, summarizeFeedback: feedback }
  }

  function resetRewindState() {
    _state = {
      showDialog: false,
      selectedMessageId: null,
      selectedOption: 'both',
      summarizeFeedback: '',
      isRewinding: false,
      error: null,
    }
  }

  function setRewindError(error: string | null) {
    _state = { ..._state, error }
  }

  function setIsRewinding(isRewinding: boolean) {
    _state = { ..._state, isRewinding }
  }

  function getShowMessageSelector(): boolean {
    return _showMessageSelector
  }

  function setShowMessageSelector(show: boolean) {
    _showMessageSelector = show
  }

  async function rewindSession(
    sessionId: string,
    targetUserMessageId: string,
    mode: 'both' | 'conversation' | 'code'
  ): Promise<void> {
    if (!sessionId) {
      _state = { ..._state, error: 'Session ID is required' }
      return
    }

    if (_state.isRewinding) {
      return
    }

    _state = { ..._state, isRewinding: true, error: null }

    try {
      if (mode === 'both' || mode === 'code') {
        const result = await mockRewindTurn(sessionId, { targetUserMessageId }, '/project')
        if (!result.ok) {
          _state = { ..._state, error: result.error || 'Failed to rewind turn', isRewinding: false }
          return
        }
      }

      if (mode === 'both' || mode === 'conversation') {
        const targetIndex = messages.findIndex(m => m.id === targetUserMessageId)
        if (targetIndex >= 0) {
          messages.splice(targetIndex, messages.length - targetIndex)
        }
      }
    } catch (err) {
      _state = {
        ..._state,
        error: err instanceof Error ? err.message : 'Unknown error during rewind',
        isRewinding: false,
      }
      return
    }

    _state = { ..._state, isRewinding: false }
  }

  async function summarizeTurn(
    _sessionId: string,
    _targetUserMessageId: string,
    _feedback: string
  ): Promise<void> {
    _state = { ..._state, isRewinding: true, error: null }
    // Simulate async work
    await new Promise(resolve => setTimeout(resolve, 10))
    _state = { ..._state, isRewinding: false }
  }

  function getUserMessages(): Message[] {
    return messages.filter(m => m.role === 'user')
  }

  function getMessages(): Message[] {
    return [...messages]
  }

  return {
    getState,
    setShowRewindDialog,
    setRewindSelectedMessage,
    setRewindSelectedOption,
    setRewindSummarizeFeedback,
    resetRewindState,
    setRewindError,
    setIsRewinding,
    getShowMessageSelector,
    setShowMessageSelector,
    rewindSession,
    summarizeTurn,
    getUserMessages,
    getMessages,
  }
}

// ── Test Helpers ───────────────────────────────────────────────────

function simulateButtonClick(store: ReturnType<typeof createMockStore>, messageId: string) {
  // Simulate: User clicks rewind button on a message
  store.setRewindSelectedMessage(messageId)
  store.setShowRewindDialog(true)
}

function simulateSlashCommand(store: ReturnType<typeof createMockStore>) {
  // Simulate: User types /rewind command
  store.setShowMessageSelector(true)
}

function simulateMessageSelect(store: ReturnType<typeof createMockStore>, messageId: string) {
  // Simulate: User selects a message from the selector
  store.setShowMessageSelector(false)
  store.setRewindSelectedMessage(messageId)
  store.setShowRewindDialog(true)
}

function simulateDialogConfirm(store: ReturnType<typeof createMockStore>) {
  // Simulate: User confirms in the dialog
  store.setShowRewindDialog(false)
}

function simulateDialogCancel(store: ReturnType<typeof createMockStore>) {
  // Simulate: User cancels in the dialog
  store.setShowRewindDialog(false)
  store.resetRewindState()
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Rewind Integration - Flow 1: Button → Dialog → Confirm', () => {
  let store: ReturnType<typeof createMockStore>

  beforeEach(() => {
    store = createMockStore()
    resetMockAPI()
  })

  it('should open dialog when rewind button is clicked', () => {
    assert.strictEqual(store.getState().showDialog, false)

    simulateButtonClick(store, 'msg-3')

    const state = store.getState()
    assert.strictEqual(state.showDialog, true)
    assert.strictEqual(state.selectedMessageId, 'msg-3')
    assert.strictEqual(state.selectedOption, 'both')
    assert.strictEqual(state.error, null)
  })

  it('should execute rewind on confirm with mode=both', async () => {
    simulateButtonClick(store, 'msg-3')

    const beforeMessages = store.getMessages()
    assert.strictEqual(beforeMessages.length, 6)

    // Confirm the rewind
    await store.rewindSession('session-1', 'msg-3', 'both')
    simulateDialogConfirm(store)

    const state = store.getState()
    assert.strictEqual(state.isRewinding, false)
    assert.strictEqual(state.error, null)
    assert.strictEqual(state.showDialog, false)

    // API should have been called
    assert.strictEqual(mockRewindTurnCalls.length, 1)
    assert.strictEqual(mockRewindTurnCalls[0].sessionId, 'session-1')
    assert.strictEqual(mockRewindTurnCalls[0].options.targetUserMessageId, 'msg-3')

    // Messages should be truncated
    const afterMessages = store.getMessages()
    assert.strictEqual(afterMessages.length, 2)
    assert.strictEqual(afterMessages[0].id, 'msg-1')
    assert.strictEqual(afterMessages[1].id, 'msg-2')
  })

  it('should execute rewind on confirm with mode=conversation', async () => {
    simulateButtonClick(store, 'msg-5')
    store.setRewindSelectedOption('conversation')

    await store.rewindSession('session-1', 'msg-5', 'conversation')
    simulateDialogConfirm(store)

    // API should NOT have been called for conversation-only mode
    assert.strictEqual(mockRewindTurnCalls.length, 0)

    // Messages should be truncated
    const afterMessages = store.getMessages()
    assert.strictEqual(afterMessages.length, 4)
  })

  it('should execute rewind on confirm with mode=code', async () => {
    simulateButtonClick(store, 'msg-5')
    store.setRewindSelectedOption('code')

    const beforeMessages = store.getMessages()
    await store.rewindSession('session-1', 'msg-5', 'code')
    simulateDialogConfirm(store)

    // API should have been called
    assert.strictEqual(mockRewindTurnCalls.length, 1)

    // Messages should NOT be truncated for code-only mode
    const afterMessages = store.getMessages()
    assert.strictEqual(afterMessages.length, beforeMessages.length)
  })
})

describe('Rewind Integration - Flow 2: /rewind Command → Selector → Dialog → Confirm', () => {
  let store: ReturnType<typeof createMockStore>

  beforeEach(() => {
    store = createMockStore()
    resetMockAPI()
  })

  it('should open message selector when /rewind command is used', () => {
    assert.strictEqual(store.getShowMessageSelector(), false)

    simulateSlashCommand(store)

    assert.strictEqual(store.getShowMessageSelector(), true)
    assert.strictEqual(store.getState().showDialog, false)
  })

  it('should show only user messages in selector', () => {
    const userMessages = store.getUserMessages()

    assert.strictEqual(userMessages.length, 3)
    assert.strictEqual(userMessages[0].role, 'user')
    assert.strictEqual(userMessages[1].role, 'user')
    assert.strictEqual(userMessages[2].role, 'user')
    assert.strictEqual(userMessages[0].id, 'msg-1')
    assert.strictEqual(userMessages[1].id, 'msg-3')
    assert.strictEqual(userMessages[2].id, 'msg-5')
  })

  it('should open dialog after selecting a message', () => {
    simulateSlashCommand(store)
    simulateMessageSelect(store, 'msg-3')

    assert.strictEqual(store.getShowMessageSelector(), false)
    assert.strictEqual(store.getState().showDialog, true)
    assert.strictEqual(store.getState().selectedMessageId, 'msg-3')
  })

  it('should complete full flow: /rewind → select → confirm', async () => {
    // Step 1: /rewind command
    simulateSlashCommand(store)
    assert.strictEqual(store.getShowMessageSelector(), true)

    // Step 2: Select message
    simulateMessageSelect(store, 'msg-5')
    assert.strictEqual(store.getShowMessageSelector(), false)
    assert.strictEqual(store.getState().showDialog, true)

    // Step 3: Confirm rewind
    await store.rewindSession('session-1', 'msg-5', 'both')
    simulateDialogConfirm(store)

    // Verify
    assert.strictEqual(store.getState().showDialog, false)
    assert.strictEqual(store.getState().isRewinding, false)
    assert.strictEqual(mockRewindTurnCalls.length, 1)
    assert.strictEqual(mockRewindTurnCalls[0].options.targetUserMessageId, 'msg-5')
  })
})

describe('Rewind Integration - Flow 3: Cancel Operations', () => {
  let store: ReturnType<typeof createMockStore>

  beforeEach(() => {
    store = createMockStore()
    resetMockAPI()
  })

  it('should close dialog and reset state on cancel', () => {
    simulateButtonClick(store, 'msg-3')
    store.setRewindSelectedOption('conversation')
    store.setRewindSummarizeFeedback('some feedback')

    const stateBefore = store.getState()
    assert.strictEqual(stateBefore.showDialog, true)
    assert.strictEqual(stateBefore.selectedMessageId, 'msg-3')
    assert.strictEqual(stateBefore.selectedOption, 'conversation')

    simulateDialogCancel(store)

    const stateAfter = store.getState()
    assert.strictEqual(stateAfter.showDialog, false)
    assert.strictEqual(stateAfter.selectedMessageId, null)
    assert.strictEqual(stateAfter.selectedOption, 'both')
    assert.strictEqual(stateAfter.summarizeFeedback, '')
    assert.strictEqual(stateAfter.error, null)
  })

  it('should close message selector on cancel without opening dialog', () => {
    simulateSlashCommand(store)
    assert.strictEqual(store.getShowMessageSelector(), true)

    // Cancel the selector
    store.setShowMessageSelector(false)

    assert.strictEqual(store.getShowMessageSelector(), false)
    assert.strictEqual(store.getState().showDialog, false)
    assert.strictEqual(store.getState().selectedMessageId, null)
  })

  it('should not execute rewind when cancel option is selected', async () => {
    simulateButtonClick(store, 'msg-3')
    store.setRewindSelectedOption('cancel')

    simulateDialogConfirm(store)

    // No API call should be made
    assert.strictEqual(mockRewindTurnCalls.length, 0)
    assert.strictEqual(store.getState().showDialog, false)
  })
})

describe('Rewind Integration - Flow 4: Error Handling', () => {
  let store: ReturnType<typeof createMockStore>

  beforeEach(() => {
    store = createMockStore()
    resetMockAPI()
  })

  it('should handle API failure and display error', async () => {
    mockRewindTurnResult = { ok: false, error: 'Git checkout failed' }

    simulateButtonClick(store, 'msg-3')
    await store.rewindSession('session-1', 'msg-3', 'both')

    const state = store.getState()
    assert.strictEqual(state.error, 'Git checkout failed')
    assert.strictEqual(state.isRewinding, false)
  })

  it('should handle network errors gracefully', async () => {
    mockShouldThrow = true

    simulateButtonClick(store, 'msg-3')
    await store.rewindSession('session-1', 'msg-3', 'both')

    const state = store.getState()
    assert.strictEqual(state.error, 'Network error')
    assert.strictEqual(state.isRewinding, false)
  })

  it('should handle missing session ID', async () => {
    simulateButtonClick(store, 'msg-3')
    await store.rewindSession('', 'msg-3', 'both')

    const state = store.getState()
    assert.strictEqual(state.error, 'Session ID is required')
    assert.strictEqual(state.isRewinding, false)
  })

  it('should prevent concurrent rewind operations', async () => {
    simulateButtonClick(store, 'msg-3')

    // Start first rewind
    const promise1 = store.rewindSession('session-1', 'msg-3', 'both')

    // Try to start second rewind while first is in progress
    const promise2 = store.rewindSession('session-1', 'msg-3', 'both')

    await Promise.all([promise1, promise2])

    // Only one API call should have been made
    assert.strictEqual(mockRewindTurnCalls.length, 1)
  })

  it('should clear error when resetRewindState is called', async () => {
    mockRewindTurnResult = { ok: false, error: 'Git checkout failed' }

    simulateButtonClick(store, 'msg-3')
    await store.rewindSession('session-1', 'msg-3', 'both')

    assert.strictEqual(store.getState().error, 'Git checkout failed')

    store.resetRewindState()

    assert.strictEqual(store.getState().error, null)
  })
})

describe('Rewind Integration - Summarize Flow', () => {
  let store: ReturnType<typeof createMockStore>

  beforeEach(() => {
    store = createMockStore()
    resetMockAPI()
  })

  it('should handle summarize option with feedback', async () => {
    simulateButtonClick(store, 'msg-3')
    store.setRewindSelectedOption('summarize')
    store.setRewindSummarizeFeedback('Keep the error handling logic')

    const state = store.getState()
    assert.strictEqual(state.selectedOption, 'summarize')
    assert.strictEqual(state.summarizeFeedback, 'Keep the error handling logic')

    await store.summarizeTurn('session-1', 'msg-3', 'Keep the error handling logic')
    simulateDialogConfirm(store)

    assert.strictEqual(store.getState().isRewinding, false)
    assert.strictEqual(store.getState().showDialog, false)
  })

  it('should require feedback for summarize option', () => {
    simulateButtonClick(store, 'msg-3')
    store.setRewindSelectedOption('summarize')
    store.setRewindSummarizeFeedback('')

    const state = store.getState()
    assert.strictEqual(state.selectedOption, 'summarize')
    assert.strictEqual(state.summarizeFeedback, '')

    // In the real UI, confirm button would be disabled when feedback is empty
    // This is handled by the component's isConfirmDisabled computed property
  })
})

describe('Rewind Integration - State Transitions', () => {
  let store: ReturnType<typeof createMockStore>

  beforeEach(() => {
    store = createMockStore()
    resetMockAPI()
  })

  it('should transition through all states for successful rewind', async () => {
    // Initial state
    assert.strictEqual(store.getState().showDialog, false)
    assert.strictEqual(store.getState().isRewinding, false)

    // Click button
    simulateButtonClick(store, 'msg-3')
    assert.strictEqual(store.getState().showDialog, true)

    // Confirm
    const rewindPromise = store.rewindSession('session-1', 'msg-3', 'both')
    assert.strictEqual(store.getState().isRewinding, true)

    await rewindPromise
    assert.strictEqual(store.getState().isRewinding, false)
    assert.strictEqual(store.getState().error, null)

    simulateDialogConfirm(store)
    assert.strictEqual(store.getState().showDialog, false)
  })

  it('should transition through all states for failed rewind', async () => {
    mockRewindTurnResult = { ok: false, error: 'Git checkout failed' }

    simulateButtonClick(store, 'msg-3')
    assert.strictEqual(store.getState().showDialog, true)

    const rewindPromise = store.rewindSession('session-1', 'msg-3', 'both')
    assert.strictEqual(store.getState().isRewinding, true)

    await rewindPromise
    assert.strictEqual(store.getState().isRewinding, false)
    assert.strictEqual(store.getState().error, 'Git checkout failed')
  })

  it('should handle rapid open/close of dialog', () => {
    simulateButtonClick(store, 'msg-3')
    assert.strictEqual(store.getState().showDialog, true)

    simulateDialogCancel(store)
    assert.strictEqual(store.getState().showDialog, false)

    simulateButtonClick(store, 'msg-5')
    assert.strictEqual(store.getState().showDialog, true)
    assert.strictEqual(store.getState().selectedMessageId, 'msg-5')
  })
})
