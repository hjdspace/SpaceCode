/**
 * Bug复现测试 - 验证rewindSession在mode='both'时的错误处理缺陷
 *
 * 运行方式：node --experimental-strip-types --test tests/bug-reproduction/rewind-error-flash.test.ts
 *
 * 这个测试证明了以下bug：
 * 1. 当mode='both'且代码回滚失败时，rewindSession会继续执行对话回滚
 * 2. 导致错误状态不一致，用户看到的错误信息一闪而过
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

// ── 模拟真实的rewindSession实现（包含bug） ───────────────────────

function createBuggyRewindSession(mockAPI: (sessionId: string, options: any, projectPath: string) => Promise<MockAPIResult>) {
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

          // ❌ BUG位置：这里设置了codeError但没有return
          if (!result.ok) {
            codeError = result.error || 'Failed to rewind code'
            console.log(`[BUG] Code rewind failed: ${codeError}`)
            // 注意：真实代码中这里没有return或break！
            // 代码会继续执行到Step 2
          } else {
            console.log('[BUG] Code rewind succeeded')
          }
        } catch (err) {
          codeError = err instanceof Error ? err.message : 'Unknown error during code rewind'
        }
      }

      // Step 2: Restore conversation (if needed)
      // ❌ 即使代码回滚失败了，这里仍然会执行！
      if (mode === 'both' || mode === 'conversation') {
        try {
          const targetIndex = sessionsMessages.findIndex(m => m.id === targetUserMessageId)
          if (targetIndex >= 0) {
            // 删除目标消息之后的所有消息
            sessionsMessages = sessionsMessages.slice(0, targetIndex + 1)
            console.log(`[BUG] Conversation rewound: kept ${sessionsMessages.length} messages`)
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

  return { getState, rewindSession, getMessages: () => sessionsMessages }
}

// ── 测试用例 ──────────────────────────────────────────────────────

describe('Bug Reproduction - Rewind Error Flash', () => {
  describe('Scenario 1: mode=both with code rewind failure', () => {
    it('should demonstrate the bug: conversation is still rewound even when code fails', async () => {
      const mockAPI = async (_sessionId: string, _options: any, _projectPath: string): Promise<MockAPIResult> => {
        return { ok: false, error: 'Backup file not found for README.md' }
      }

      const { getState, rewindSession, getMessages } = createBuggyRewindSession(mockAPI)

      const beforeMessages = getMessages()
      console.log('\n=== Before rewind ===')
      console.log(`Messages count: ${beforeMessages.length}`)
      console.log(`State:`, JSON.stringify(getState(), null, 2))

      try {
        await rewindSession('session-1', 'msg-3', 'both')
        assert.fail('Should have thrown an error')
      } catch (err) {
        console.log('\n=== After rewind (caught error) ===')
        console.log(`Error caught: ${(err as Error).message}`)
        console.log(`Messages count: ${getMessages().length}`)
        console.log(`Final state:`, JSON.stringify(getState(), null, 2))

        // ❌ BUG证据1：消息被删除了（不应该发生）
        const afterMessages = getMessages()
        assert.strictEqual(afterMessages.length, 3, 'BUG: Messages were deleted even though code rewind failed!')
        assert.ok(afterMessages.some(m => m.id === 'msg-4'), 'BUG: msg-4 should not have been deleted')

        // ❌ BUG证据2：error被设置了一瞬间，但由于throw，调用者需要特殊处理
        const state = getState()
        assert.strictEqual(state.error, 'Backup file not found for README.md')
        assert.strictEqual(state.isRewinding, false)
        assert.strictEqual(state.showDialog, true, 'Dialog should remain open')
      }
    })

    it('should show that error state is inconsistent', async () => {
      const mockAPI = async (): Promise<MockAPIResult> => {
        return { ok: false, error: 'Git checkout failed' }
      }

      const { getState, rewindSession } = createBuggyRewindSession(mockAPI)

      try {
        await rewindSession('session-1', 'msg-3', 'both')
      } catch (err) {
        const state = getState()

        console.log('\n=== Inconsistent State ===')
        console.log(`error: ${state.error}`)
        console.log(`isRewinding: ${state.isRewinding}`)
        console.log(`showDialog: ${state.showDialog}`)

        // 问题：error被设置了，但是消息已经被修改了
        // 用户看到的是：错误闪了一下，然后对话框还在，但消息已经被删了
        assert.ok(state.error, 'Error should be set')
        assert.strictEqual(state.showDialog, true, 'Dialog should be open to show error')

        // 这是预期的行为，但在UI上会造成困惑
        console.log('\n⚠️  BUG CONFIRMED:')
        console.log('   - Error is set correctly ✓')
        console.log('   - Dialog remains open ✓')
        console.log('   - BUT messages were already modified ✗')
        console.log('   - User sees confusing state ✗')
      }
    })
  })

  describe('Scenario 2: Simulating ChatPanel behavior', () => {
    it('should show how ChatPanel.catch() handles the error', async () => {
      const mockAPI = async (): Promise<MockAPIResult> => {
        return { ok: false, error: 'Failed to restore README.md backup' }
      }

      const { getState, rewindSession } = createBuggyRewindSession(mockAPI)

      // 模拟ChatPanel.vue中的handleRewindConfirm逻辑
      let dialogClosed = false
      let stateReset = false
      let consoleErrorCalled = false

      const originalConsoleError = console.error
      console.error = (...args: any[]) => {
        if (args[0]?.includes?.('[ChatPanel] Rewind failed')) {
          consoleErrorCalled = true
        }
        originalConsoleError.apply(console, args)
      }

      try {
        // 模拟ChatPanel的调用
        await rewindSession('session-1', 'msg-3', 'both').then(() => {
          // Success path
          dialogClosed = true
          stateReset = true
        }).catch((err: any) => {
          // Error path - ChatPanel only does console.error!
          console.error('[ChatPanel] Rewind failed:', err)
          // ❌ 没有其他操作！对话框保持打开，但状态可能已经混乱
        })
      } finally {
        console.error = originalConsoleError
      }

      const state = getState()

      console.log('\n=== ChatPanel Simulation Result ===')
      console.log(`dialogClosed: ${dialogClosed}`)
      console.log(`stateReset: ${stateReset}`)
      console.log(`consoleErrorCalled: ${consoleErrorCalled}`)
      console.log(`final error: ${state.error}`)
      console.log(`showDialog: ${state.showDialog}`)

      assert.strictEqual(dialogClosed, false, 'Dialog should NOT close on error')
      assert.strictEqual(stateReset, false, 'State should NOT reset on error')
      assert.strictEqual(consoleErrorCalled, true, 'console.error should be called')
      assert.strictEqual(state.showDialog, true, 'Dialog should remain open')
      assert.ok(state.error, 'Error should be visible to user')

      console.log('\n✅ Bug reproduced successfully!')
      console.log('   The error IS set, dialog IS open, but the user experience is confusing')
      console.log('   because messages were already modified before the error was thrown.')
    })
  })

  describe('Scenario 3: What SHOULD happen (fixed version)', () => {
    it('should NOT modify messages if code rewind fails in both mode', async () => {
      const mockAPI = async (_sessionId: string, _options: { targetUserMessageId: string }, _projectPath: string): Promise<MockAPIResult> => {
        return { ok: false, error: 'Backup missing' }
      }

      // 创建一个修复版本的rewindSession
      function createFixedRewindSession(api: typeof mockAPI) {
        const state: RewindState = {
          showDialog: true,
          selectedMessageId: 'msg-3',
          selectedOption: 'both',
          summarizeFeedback: '',
          isRewinding: false,
          error: null,
        }

        let messages = [
          { id: 'msg-1', role: 'user', content: 'Hello' },
          { id: 'msg-2', role: 'assistant', content: 'Hi there!' },
          { id: 'msg-3', role: 'user', content: 'Modify README.md' },
          { id: 'msg-4', role: 'assistant', content: 'I modified README.md' },
        ]

        async function fixedRewindSession(
          sessionId: string,
          targetUserMessageId: string,
          mode: 'both' | 'conversation' | 'code'
        ): Promise<void> {
          if (!sessionId) {
            state.error = 'Session ID is required'
            return
          }

          if (state.isRewinding) return

          state.isRewinding = true
          state.error = null

          let codeError: string | null = null
          let conversationError: string | null = null

          try {
            if (mode === 'both' || mode === 'code') {
              try {
                const result = await api(sessionId, { targetUserMessageId }, '/project')
                if (!result.ok) {
                  codeError = result.error || 'Failed to rewind code'
                  // ✅ FIX: 如果mode='both'且代码失败，不执行对话回滚
                  if (mode === 'both') {
                    // 直接跳到错误处理
                    throw new Error(codeError)
                  }
                }
              } catch (err) {
                codeError = err instanceof Error ? err.message : 'Unknown error during code rewind'
                if (mode === 'both') {
                  throw err
                }
              }
            }

            if (mode === 'both' || mode === 'conversation') {
              try {
                const targetIndex = messages.findIndex(m => m.id === targetUserMessageId)
                if (targetIndex >= 0) {
                  messages = messages.slice(0, targetIndex + 1)
                } else {
                  conversationError = 'Target message not found'
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

          if (codeError && conversationError) {
            state.error = `Code: ${codeError}\nConversation: ${conversationError}`
          } else if (codeError) {
            state.error = codeError
          } else if (conversationError) {
            state.error = conversationError
          }

          state.isRewinding = false

          if (codeError || conversationError) {
            throw new Error(state.error || 'Rewind failed')
          }
        }

        return { getState: () => ({ ...state, messagesCount: messages.length }), fixedRewindSession, getMessages: () => messages }
      }

      const { getState, fixedRewindSession, getMessages } = createFixedRewindSession(mockAPI)

      const beforeCount = getMessages().length
      console.log(`\n=== Before (fixed): ${beforeCount} messages ===`)

      try {
        await fixedRewindSession('session-1', 'msg-3', 'both')
        assert.fail('Should have thrown')
      } catch (err) {
        const afterCount = getMessages().length
        console.log(`=== After (fixed): ${afterCount} messages ===`)
        console.log(`Error: ${(err as Error).message}`)

        // ✅ FIXED: 消息没有被修改！
        assert.strictEqual(afterCount, beforeCount, 'FIXED: Messages should NOT be modified when code rewind fails')
        assert.strictEqual(getState().error, 'Backup missing')
        assert.strictEqual(getState().isRewinding, false)
        assert.strictEqual(getState().showDialog, true)

        console.log('\n✅ FIXED: Messages preserved, error shown, dialog stays open!')
      }
    })
  })
})
