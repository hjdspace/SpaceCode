/**
 * turnCheckpointUtils tests - run with:
 *   node --experimental-strip-types --test tests/utils/turnCheckpointUtils.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { findTurnCheckpointForMessage } from '../../src/utils/turnCheckpointUtils.ts'
import type { SessionTurnCheckpoint } from '../../src/types/turnCheckpoint.ts'

function makeCheckpoint(
  targetUserMessageId: string,
  userMessageIndex: number,
  paths: string[]
): SessionTurnCheckpoint {
  return {
    target: {
      targetUserMessageId,
      userMessageIndex,
      userMessageCount: 3,
    },
    code: {
      available: true,
      filesChanged: paths.map(path => ({ path, insertions: 1, deletions: 0 })),
      insertions: paths.length,
      deletions: 0,
    },
  }
}

describe('findTurnCheckpointForMessage', () => {
  const checkpoints = [
    makeCheckpoint('engine-uuid-0', 0, ['a.ts']),
    makeCheckpoint('engine-uuid-1', 1, ['b.ts', 'c.ts']),
  ]

  it('finds checkpoint by exact targetUserMessageId', () => {
    const result = findTurnCheckpointForMessage(checkpoints, 'engine-uuid-1', 99)
    assert.strictEqual(result?.target.targetUserMessageId, 'engine-uuid-1')
    assert.deepStrictEqual(result?.code.filesChanged.map(f => f.path), ['b.ts', 'c.ts'])
  })

  it('falls back to userMessageIndex when frontend ID differs from engine UUID', () => {
    const result = findTurnCheckpointForMessage(checkpoints, 'frontend-uuid-abc', 1)
    assert.strictEqual(result?.target.targetUserMessageId, 'engine-uuid-1')
    assert.deepStrictEqual(result?.code.filesChanged.map(f => f.path), ['b.ts', 'c.ts'])
  })

  it('returns undefined when no match is found', () => {
    const result = findTurnCheckpointForMessage(checkpoints, 'unknown-id', -1)
    assert.strictEqual(result, undefined)
  })
})
