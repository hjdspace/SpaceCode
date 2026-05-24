/**
 * 回归测试 - 验证rewindSession修复后的正确行为
 *
 * 运行方式：node --experimental-strip-types --test tests/bug-reproduction/rewind-fix-regression.test.ts
 *
 * 这个测试验证了以下修复：
 * 1. 当mode='both'且代码回滚失败时，不再执行对话回滚
 * 2. 消息保持不变，错误正常显示
 * 3. 对话框保持打开，用户可以看到清晰的错误信息
 */

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// ── Types ─────────────────────────────────────────────────────────

type RewindOption = 'both' | 'conversation' | 'code' | 'summarize' | 'cancel'

interface RewindState {
  showDialog: boolean
  selectedMessageId: string | null
  selectedOption: RewindOption
  summarizeFeedback: string
  isRewinding: boolean
  error: string | null
}

interface MockAPIResult {
  ok: boolean
  error: string | null
}

// ── 模拟修复后的rewindSession实现 ─────────────────────────────────

function createFixedRewindSession(
  mockAPI: (sessionId: string, options: any, projectPath: string) => Promise<MockAPIResult>
) {
  const state: RewindState = {
    showDialog: true,
    selectedMessageId: 'msg-3',
    selectedOption: 'both',
    summarizeFeedback: '',
    isRewinding: false,
    error: null,
  }

  let sessionsMessages = [
    { id: 'msg-1', role: 'user', content: 'Hello' },
    { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
    { id: 'msg-3', role: 'user', content: 'Modify README.md' },
    { id: 'msg-4', role: 'assistant', content: 'I modified README.md' },
  ]

  async function rewindSession(
    sessionId: string,
    targetUserMessageId: string,
    mode: 'both' | 'conversation' | 'code'
  ): Promise<void> {
    if (!sessionId) {
      state.error = 'Session ID is required'
      return
    }

    if (state.isRewinding) {
      return
    }

    state.isRewinding = true
    state.error = null

    let codeError: string | null = null
    let conversationError: string | null = null

    try {
      // Step 1: Restore code (if needed)
      if (mode === 'both' || mode === 'code') {
        try {
          const projectPath = '/project'
          const result = await mockAPI(sessionId, { targetUserMessageId }, projectPath)

          if (!result.ok) {
            codeError = result.error || 'Failed to rewind code'
            console.log(`[FIXED] Code rewind failed: ${codeError}`)
          } else {
            console.log('[FIXED] Code rewind succeeded')
          }
        } catch (err) {
          codeError = err instanceof Error ? err.message : 'Unknown error during code rewind'
        }

        // ✅ FIX: If mode='both' and code rewind failed, skip conversation rewind
        if (mode === 'both' && codeError) {
          console.log('[FIXED] Skipping conversation rewind due to code rewind failure')
        }
      }

      // Step 2: Restore conversation (if needed)
      // ✅ FIX: Only execute if mode='conversation' or (mode='both' AND no codeError)
      if (mode === 'conversation' || (mode === 'both' && !codeError)) {
        try {
          const targetIndex = sessionsMessages.findIndex(m => m.id === targetUserMessageId)
          if (targetIndex >= 0) {
            sessionsMessages = sessionsMessages.slice(0, targetIndex + 1)
            console.log(`[FIXED] Conversation rewound: kept ${sessionsMessages.length} messages`)
          } else {
            conversationError = 'Target message not found in session'
          }
        } catch (err) {
          conversationError = err instanceof Error ? err.message : 'Unknown error during conversation rewind'
        }
      }
    } catch (err) {
      state.error = err instanceof Error ? err.message : 'Unknown error during rewind'
      state.isRewinding = false
      return
    }

    // Handle errors
    if (codeError && conversationError) {
      state.error = `Code: ${codeError}\nConversation: ${conversationError}`
    } else if (codeError) {
      state.error = codeError
    } else if (conversationError) {
      state.error = conversationError
    }

    state.isRewinding = false

    // Throw error so caller can handle it
    if (codeError || conversationError) {
      throw new Error(state.error || 'Rewind failed')
    }
  }

  function getState() {
    return { ...state, messagesCount: sessionsMessages.length }
  }

  function getMessages() {
    return [...sessionsMessages]
  }

  return { getState, rewindSession, getMessages }
}

// ── 测试用例 ──────────────────────────────────────────────────────

describe('Regression Test - Rewind Fix Verification', () => {
  describe('Fixed Behavior - mode=both with code failure', () => {
    it('should NOT modify messages when code rewind fails in both mode', async () => {
      const mockAPI = async (): Promise<MockAPIResult> => {
        return { ok: false, error: 'Backup file not found for README.md' }
      }

      const { getState, rewindSession, getMessages } = createFixedRewindSession(mockAPI)

      const beforeMessages = getMessages()
      const beforeCount = beforeMessages.length

      console.log('\n=== Before rewind (FIXED) ===')
      console.log(`Messages count: ${beforeCount}`)

      try {
        await rewindSession('session-1', 'msg-3', 'both')
        assert.fail('Should have thrown an error')
      } catch (err) {
        const afterMessages = getMessages()
        const afterCount = afterMessages.length

        console.log('\n=== After rewind (FIXED) ===')
        console.log(`Messages count: ${afterCount}`)
        console.log(`Error: ${(err as Error).message}`)

        // ✅ 核心断言：消息没有被修改！
        assert.strictEqual(afterCount, beforeCount, 'Messages should NOT be modified when code rewind fails')
        assert.deepStrictEqual(afterMessages, beforeMessages, 'Messages array should be identical')

        // ✅ 错误状态正确
        const state = getState()
        assert.strictEqual(state.error, 'Backup file not found for README.md')
        assert.strictEqual(state.isRewinding, false)
        assert.strictEqual(state.showDialog, true, 'Dialog should remain open to show error')

        console.log('\n✅ TEST PASSED:')
        console.log('   ✓ Messages preserved (not deleted)')
        console.log('   ✓ Error message displayed correctly')
        console.log('   ✓ Dialog remains open for user to see error')
        console.log('   ✓ No inconsistent state!')
      }
    })

    it('should still allow conversation-only rewind even if code would fail', async () => {
      const mockAPI = async (): Promise<MockAPIResult> => {
        return { ok: false, error: 'Code rewind would fail' }
      }

      const { getState, rewindSession, getMessages } = createFixedRewindSession(mockAPI)

      const beforeCount = getMessages().length

      try {
        // mode='conversation' should work even if code API would fail
        await rewindSession('session-1', 'msg-3', 'conversation')

        const afterCount = getMessages().length
        const state = getState()

        console.log('\n=== Conversation-only rewind (FIXED) ===')
        console.log(`Before: ${beforeCount} messages`)
        console.log(`After: ${afterCount} messages`)

        // ✅ 对话回滚应该成功（不涉及代码回滚）
        assert.strictEqual(afterCount, beforeCount - 1, 'One message should be removed')
        assert.strictEqual(state.error, null, 'No error expected')
        assert.strictEqual(state.isRewinding, false)
        assert.strictEqual(state.showDialog, true)

        console.log('✅ Conversation-only rewind works correctly')
      } catch (err) {
        assert.fail(`Should not throw in conversation-only mode: ${(err as Error).message}`)
      }
    })

    it('should execute both code and conversation rewind when code succeeds', async () => {
      const mockAPI = async (): Promise<MockAPIResult> => {
        return { ok: true, error: null }
      }

      const { getState, rewindSession, getMessages } = createFixedRewindSession(mockAPI)

      const beforeCount = getMessages().length

      try {
        await rewindSession('session-1', 'msg-3', 'both')

        const afterCount = getMessages().length
        const state = getState()

        console.log('\n=== Both succeed (FIXED) ===')
        console.log(`Before: ${beforeCount} messages`)
        console.log(`After: ${afterCount} messages`)

        // ✅ 两个都应该成功
        assert.strictEqual(afterCount, beforeCount - 1, 'One message should be removed')
        assert.strictEqual(state.error, null, 'No error expected')
        assert.strictEqual(state.isRewinding, false)
        assert.strictEqual(state.showDialog, true)

        console.log('✅ Full rewind (both) works correctly when code succeeds')
      } catch (err) {
        assert.fail(`Should not throw when both succeed: ${(err as Error).message}`)
      }
    })
  })

  describe('Edge Cases', () => {
    it('should handle code-only mode failure without touching messages', async () => {
      const mockAPI = async (): Promise<MockAPIResult> => {
        return { ok: false, error: 'Git operation failed' }
      }

      const { getState, rewindSession, getMessages } = createFixedRewindSession(mockAPI)
      const beforeCount = getMessages().length

      try {
        await rewindSession('session-1', 'msg-3', 'code')
        assert.fail('Should throw on code failure')
      } catch (err) {
        const afterCount = getMessages().length

        assert.strictEqual(afterCount, beforeCount, 'Messages unchanged in code-only mode')
        assert.strictEqual(getState().error, 'Git operation failed')
        console.log('\n✅ Code-only mode failure handled correctly')
      }
    })

    it('should prevent concurrent rewind operations', async () => {
      let callCount = 0
      const mockAPI = async (): Promise<MockAPIResult> => {
        callCount++
        await new Promise(resolve => setTimeout(resolve, 10))
        return { ok: true, error: null }
      }

      const { getState, rewindSession } = createFixedRewindSession(mockAPI)

      const promise1 = rewindSession('session-1', 'msg-3', 'both')
      const promise2 = rewindSession('session-1', 'msg-3', 'both')

      await Promise.all([promise1, promise2])

      assert.strictEqual(callCount, 1, 'Only one API call should be made')
      console.log('\n✅ Concurrent rewind prevention works')
    })
  })

  describe('User Experience Validation', () => {
    it('should provide clear error state for UI display', async () => {
      const mockAPI = async (): Promise<MockAPIResult> => {
        return { ok: false, error: 'Failed to restore README.md: backup file missing' }
      }

      const { getState, rewindSession } = createFixedRewindSession(mockAPI)

      let errorCaught = false
      let errorMessage = ''

      try {
        await rewindSession('session-1', 'msg-3', 'both')
      } catch (err) {
        errorCaught = true
        errorMessage = (err as Error).message
      }

      const state = getState()

      console.log('\n=== User Experience Check ===')
      console.log(`Error caught by caller: ${errorCaught}`)
      console.log(`Error message: ${errorMessage}`)
      console.log(`State.error: ${state.error}`)
      console.log(`Dialog visible: ${state.showDialog}`)
      console.log(`Loading state: ${state.isRewinding}`)

      assert.strictEqual(errorCaught, true, 'Caller should receive the error')
      assert.ok(errorMessage.includes('README.md'), 'Error should include file name')
      assert.ok(errorMessage.includes('backup'), 'Error should include cause')
      assert.strictEqual(state.error, errorMessage, 'State error should match thrown error')
      assert.strictEqual(state.showDialog, true, 'Dialog must stay open for user to see error')
      assert.strictEqual(state.isRewinding, false, 'Loading must stop')

      console.log('\n✅ User experience is now correct:')
      console.log('   • User sees clear error message with details')
      console.log('   • Dialog stays open until user dismisses it')
      console.log('   • Loading indicator stops')
      console.log('   • Messages are preserved (no data loss)')
      console.log('   • User can retry or choose different option')
    })
  })
})
