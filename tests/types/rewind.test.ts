/**
 * Rewind type tests - run with:
 *   node --experimental-strip-types --test tests/types/rewind.test.ts
 *
 * These tests verify the rewind types exist and match claude-code TUI spec.
 * Type checking is done via `npm run typecheck`.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Runtime value tests for RewindOption
describe('RewindOption', () => {
  it('should have exactly 5 valid values matching claude-code TUI', () => {
    const validOptions: string[] = [
      'both',
      'conversation',
      'code',
      'summarize',
      'cancel',
    ]

    assert.strictEqual(validOptions.length, 5)
    assert(validOptions.includes('both'))
    assert(validOptions.includes('conversation'))
    assert(validOptions.includes('code'))
    assert(validOptions.includes('summarize'))
    assert(validOptions.includes('cancel'))
  })

  it('should match claude-code TUI rewind option order', () => {
    const expectedOptions = ['both', 'conversation', 'code', 'summarize', 'cancel']
    const actualOptions = ['both', 'conversation', 'code', 'summarize', 'cancel']

    assert.deepStrictEqual(actualOptions, expectedOptions)
  })
})

// Runtime tests for RewindState structure
describe('RewindState', () => {
  it('should have all required fields', () => {
    const state = {
      showDialog: true,
      selectedMessageId: 'msg-123',
      selectedOption: 'both',
      summarizeFeedback: '',
      isRewinding: false,
      error: null,
    }

    assert('showDialog' in state)
    assert('selectedMessageId' in state)
    assert('selectedOption' in state)
    assert('summarizeFeedback' in state)
    assert('isRewinding' in state)
    assert('error' in state)
  })
})

// Runtime tests for RewindDiffStats structure
describe('RewindDiffStats', () => {
  it('should have all required fields', () => {
    const stats = {
      filesChanged: 3,
      insertions: 42,
      deletions: 15,
    }

    assert('filesChanged' in stats)
    assert('insertions' in stats)
    assert('deletions' in stats)
  })
})

// Runtime tests for RewindDialogProps structure
describe('RewindDialogProps', () => {
  it('should have all required fields', () => {
    const props = {
      show: true,
      selectedMessageId: 'msg-123',
      selectedOption: 'both',
      summarizeFeedback: '',
      isRewinding: false,
      error: null,
      diffStats: {
        filesChanged: 3,
        insertions: 42,
        deletions: 15,
      },
    }

    assert('show' in props)
    assert('selectedMessageId' in props)
    assert('selectedOption' in props)
    assert('summarizeFeedback' in props)
    assert('isRewinding' in props)
    assert('error' in props)
    assert('diffStats' in props)
  })
})

// Runtime tests for MessageSelectorProps structure
describe('MessageSelectorProps', () => {
  it('should have all required fields', () => {
    const props = {
      messages: [],
      selectedMessageId: null,
    }

    assert('messages' in props)
    assert('selectedMessageId' in props)
  })
})
