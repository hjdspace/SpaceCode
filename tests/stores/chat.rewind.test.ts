/**
 * ChatStore rewind logic tests - run with:
 *   node --experimental-strip-types --test tests/stores/chat.rewind.test.ts
 *
 * These tests verify the rewind state management and rewindSession behavior
 * by extracting and testing the pure logic that will be integrated into chatStore.
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

// ── Mock API ───────────────────────────────────────────────────────

let mockRewindTurnCalls: Array<{
  sessionId: string
  options: { targetUserMessageId: string; userMessageIndex?: number }
  projectPath?: string
}> = []
let mockRewindTurnResult: { ok: boolean; error: string | null } = { ok: true, error: null }
let mockShouldThrow: boolean = false
let mockThrowError: Error = new Error('Network error')

function resetMockAPI() {
  mockRewindTurnCalls = []
  mockRewindTurnResult = { ok: true, error: null }
  mockShouldThrow = false
  mockThrowError = new Error('Network error')
}

function setMockRewindTurnResult(result: { ok: boolean; error: string | null }) {
  mockRewindTurnResult = result
}

function setMockShouldThrow(shouldThrow: boolean, error?: Error) {
  mockShouldThrow = shouldThrow
  if (error) mockThrowError = error
}

async function mockRewindTurn(
  sessionId: string,
  options: { targetUserMessageId: string; userMessageIndex?: number },
  projectPath?: string
): Promise<{ ok: boolean; error: string | null }> {
  mockRewindTurnCalls.push({ sessionId, options, projectPath })
  if (mockShouldThrow) {
    throw mockThrowError
  }
  return { ...mockRewindTurnResult }
}

// ── Rewind Logic (to be integrated into chatStore) ─────────────────

function createRewindLogic() {
  let _state: RewindState = {
    showDialog: false,
    selectedMessageId: null,
    selectedOption: 'both',
    summarizeFeedback: '',
    isRewinding: false,
    error: null,
  }

  function getRewindState(): RewindState {
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

  async function rewindSession(
    sessionId: string,
    targetUserMessageId: string,
    mode: 'both' | 'conversation' | 'code',
    projectPath: string,
    messages: Array<{ id: string; role: string; content: string }>
  ): Promise<Array<{ id: string; role: string; content: string }>> {
    if (!sessionId) {
      _state = { ..._state, error: 'Session ID is required' }
      return messages
    }

    if (_state.isRewinding) {
      return messages
    }

    _state = { ..._state, isRewinding: true, error: null }

    try {
      if (mode === 'both' || mode === 'code') {
        const result = await mockRewindTurn(sessionId, { targetUserMessageId }, projectPath)
        if (!result.ok) {
          _state = { ..._state, error: result.error || 'Failed to rewind turn', isRewinding: false }
          return messages
        }
      }

      let truncatedMessages = messages
      if (mode === 'both' || mode === 'conversation') {
        const targetIndex = messages.findIndex(m => m.id === targetUserMessageId)
        if (targetIndex >= 0) {
          truncatedMessages = messages.slice(0, targetIndex)
        }
      }

      _state = { ..._state, isRewinding: false }
      return truncatedMessages
    } catch (err) {
      _state = {
        ..._state,
        error: err instanceof Error ? err.message : 'Unknown error during rewind',
        isRewinding: false,
      }
      return messages
    }
  }

  async function summarizeTurn(
    _sessionId: string,
    _targetUserMessageId: string,
    _feedback: string
  ): Promise<void> {
    // Placeholder implementation
    return Promise.resolve()
  }

  return {
    getRewindState,
    setShowRewindDialog,
    setRewindSelectedMessage,
    setRewindSelectedOption,
    setRewindSummarizeFeedback,
    resetRewindState,
    setRewindError,
    rewindSession,
    summarizeTurn,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('ChatStore Rewind - Initial State', () => {
  it('should have correct initial state', () => {
    const store = createRewindLogic()
    const state = store.getRewindState()

    assert.strictEqual(state.showDialog, false)
    assert.strictEqual(state.selectedMessageId, null)
    assert.strictEqual(state.selectedOption, 'both')
    assert.strictEqual(state.summarizeFeedback, '')
    assert.strictEqual(state.isRewinding, false)
    assert.strictEqual(state.error, null)
  })
})

describe('ChatStore Rewind - State Management Methods', () => {
  let store: ReturnType<typeof createRewindLogic>

  beforeEach(() => {
    store = createRewindLogic()
  })

  it('setShowRewindDialog should update showDialog', () => {
    store.setShowRewindDialog(true)
    assert.strictEqual(store.getRewindState().showDialog, true)

    store.setShowRewindDialog(false)
    assert.strictEqual(store.getRewindState().showDialog, false)
  })

  it('setRewindSelectedMessage should update selectedMessageId', () => {
    store.setRewindSelectedMessage('msg-123')
    assert.strictEqual(store.getRewindState().selectedMessageId, 'msg-123')

    store.setRewindSelectedMessage(null)
    assert.strictEqual(store.getRewindState().selectedMessageId, null)
  })

  it('setRewindSelectedOption should update selectedOption', () => {
    store.setRewindSelectedOption('conversation')
    assert.strictEqual(store.getRewindState().selectedOption, 'conversation')

    store.setRewindSelectedOption('code')
    assert.strictEqual(store.getRewindState().selectedOption, 'code')

    store.setRewindSelectedOption('summarize')
    assert.strictEqual(store.getRewindState().selectedOption, 'summarize')
  })

  it('setRewindSummarizeFeedback should update summarizeFeedback', () => {
    store.setRewindSummarizeFeedback('Keep the auth changes')
    assert.strictEqual(store.getRewindState().summarizeFeedback, 'Keep the auth changes')
  })

  it('resetRewindState should reset all state to initial values', () => {
    store.setShowRewindDialog(true)
    store.setRewindSelectedMessage('msg-123')
    store.setRewindSelectedOption('conversation')
    store.setRewindSummarizeFeedback('some feedback')
    store.setRewindError('some error')

    store.resetRewindState()

    const state = store.getRewindState()
    assert.strictEqual(state.showDialog, false)
    assert.strictEqual(state.selectedMessageId, null)
    assert.strictEqual(state.selectedOption, 'both')
    assert.strictEqual(state.summarizeFeedback, '')
    assert.strictEqual(state.isRewinding, false)
    assert.strictEqual(state.error, null)
  })

  it('setRewindError should update error', () => {
    store.setRewindError('Something went wrong')
    assert.strictEqual(store.getRewindState().error, 'Something went wrong')

    store.setRewindError(null)
    assert.strictEqual(store.getRewindState().error, null)
  })
})

describe('ChatStore Rewind - rewindSession', () => {
  let store: ReturnType<typeof createRewindLogic>
  const testMessages = [
    { id: 'msg-1', role: 'user', content: 'Hello' },
    { id: 'msg-2', role: 'assistant', content: 'Hi' },
    { id: 'msg-3', role: 'user', content: 'Do something' },
    { id: 'msg-4', role: 'assistant', content: 'Done' },
  ]

  beforeEach(() => {
    store = createRewindLogic()
    resetMockAPI()
  })

  it('should call API and truncate messages for mode=both', async () => {
    const result = await store.rewindSession('session-1', 'msg-3', 'both', '/project', testMessages)

    assert.strictEqual(store.getRewindState().isRewinding, false)
    assert.strictEqual(store.getRewindState().error, null)
    assert.strictEqual(mockRewindTurnCalls.length, 1)
    assert.strictEqual(mockRewindTurnCalls[0].sessionId, 'session-1')
    assert.strictEqual(mockRewindTurnCalls[0].options.targetUserMessageId, 'msg-3')
    assert.strictEqual(mockRewindTurnCalls[0].projectPath, '/project')

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].id, 'msg-1')
    assert.strictEqual(result[1].id, 'msg-2')
  })

  it('should only truncate messages for mode=conversation', async () => {
    const result = await store.rewindSession('session-1', 'msg-3', 'conversation', '/project', testMessages)

    assert.strictEqual(store.getRewindState().isRewinding, false)
    assert.strictEqual(store.getRewindState().error, null)
    assert.strictEqual(mockRewindTurnCalls.length, 0)

    assert.strictEqual(result.length, 2)
    assert.strictEqual(result[0].id, 'msg-1')
    assert.strictEqual(result[1].id, 'msg-2')
  })

  it('should only call API for mode=code', async () => {
    const result = await store.rewindSession('session-1', 'msg-3', 'code', '/project', testMessages)

    assert.strictEqual(store.getRewindState().isRewinding, false)
    assert.strictEqual(store.getRewindState().error, null)
    assert.strictEqual(mockRewindTurnCalls.length, 1)

    assert.strictEqual(result.length, 4)
    assert.deepStrictEqual(result.map(m => m.id), ['msg-1', 'msg-2', 'msg-3', 'msg-4'])
  })

  it('should handle API errors and set error state', async () => {
    setMockRewindTurnResult({ ok: false, error: 'Git checkout failed' })

    const result = await store.rewindSession('session-1', 'msg-2', 'both', '/project', testMessages)

    assert.strictEqual(store.getRewindState().isRewinding, false)
    assert.strictEqual(store.getRewindState().error, 'Git checkout failed')

    // Messages should NOT be truncated when API fails
    assert.strictEqual(result.length, 4)
  })

  it('should handle API errors with null error message', async () => {
    setMockRewindTurnResult({ ok: false, error: null })

    await store.rewindSession('session-1', 'msg-1', 'both', '/project', testMessages)

    assert.strictEqual(store.getRewindState().error, 'Failed to rewind turn')
  })

  it('should not truncate if target message not found', async () => {
    const result = await store.rewindSession('session-1', 'nonexistent', 'both', '/project', testMessages)

    assert.strictEqual(store.getRewindState().isRewinding, false)
    assert.strictEqual(store.getRewindState().error, null)
    assert.strictEqual(result.length, 4)
  })
})

describe('ChatStore Rewind - Boundary Cases', () => {
  let store: ReturnType<typeof createRewindLogic>
  const testMessages = [
    { id: 'msg-1', role: 'user', content: 'Hello' },
    { id: 'msg-2', role: 'assistant', content: 'Hi' },
  ]

  beforeEach(() => {
    store = createRewindLogic()
    resetMockAPI()
  })

  it('should reject empty sessionId', async () => {
    const result = await store.rewindSession('', 'msg-1', 'both', '/project', testMessages)

    assert.strictEqual(store.getRewindState().error, 'Session ID is required')
    assert.strictEqual(store.getRewindState().isRewinding, false)
    assert.strictEqual(mockRewindTurnCalls.length, 0)
    assert.strictEqual(result.length, 2)
  })

  it('should prevent duplicate calls when already rewinding', async () => {
    // First call - start a rewind
    const promise1 = store.rewindSession('session-1', 'msg-1', 'both', '/project', testMessages)

    // Second call - should be blocked because isRewinding is true
    const promise2 = store.rewindSession('session-1', 'msg-1', 'both', '/project', testMessages)

    await Promise.all([promise1, promise2])

    // Only one API call should have been made
    assert.strictEqual(mockRewindTurnCalls.length, 1)
    assert.strictEqual(store.getRewindState().isRewinding, false)
  })

  it('should handle exceptions during rewind', async () => {
    setMockShouldThrow(true, new Error('Network error'))

    const result = await store.rewindSession('session-1', 'msg-1', 'both', '/project', testMessages)

    assert.strictEqual(store.getRewindState().error, 'Network error')
    assert.strictEqual(store.getRewindState().isRewinding, false)
    assert.strictEqual(result.length, 2)
  })

  it('should handle empty messages array', async () => {
    const result = await store.rewindSession('session-1', 'msg-1', 'both', '/project', [])

    assert.strictEqual(store.getRewindState().isRewinding, false)
    assert.strictEqual(result.length, 0)
  })

  it('should handle target at index 0', async () => {
    const result = await store.rewindSession('session-1', 'msg-1', 'both', '/project', testMessages)

    assert.strictEqual(result.length, 0)
  })
})

describe('ChatStore Rewind - summarizeTurn', () => {
  it('should be a placeholder that resolves', async () => {
    const store = createRewindLogic()

    await assert.doesNotReject(
      store.summarizeTurn('session-1', 'msg-1', 'Good changes')
    )
  })
})
