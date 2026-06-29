/**
 * turnCheckpointUtils tests - run with:
 *   node --experimental-strip-types --test tests/utils/turnCheckpointUtils.test.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  findTurnCheckpointForMessage,
  getCompletedTurnTargets,
  isTurnResponseMessage,
} from '../../src/utils/turnCheckpointUtils.ts'
import type { Message, SessionTurnCheckpoint } from '../../src/types/index.ts'

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

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: overrides.id || crypto.randomUUID(),
    role: overrides.role || 'assistant',
    content: overrides.content ?? '',
    timestamp: overrides.timestamp ?? Date.now(),
    ...overrides,
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

describe('isTurnResponseMessage', () => {
  it('treats assistant text as a turn response', () => {
    const message = makeMessage({ content: 'done' })

    assert.equal(isTurnResponseMessage(message), true)
  })

  it('treats assistant tool calls as a turn response even without text', () => {
    const message = makeMessage({
      content: '',
      toolCalls: [{
        id: 'tool-1',
        name: 'Edit',
        input: { file_path: 'README.md' },
        status: 'completed',
      }],
    })

    assert.equal(isTurnResponseMessage(message), true)
  })

  it('treats completed assistant metadata as a turn response even without text', () => {
    const message = makeMessage({
      content: '',
      metadata: { model: 'test-model', duration: 100 },
    })

    assert.equal(isTurnResponseMessage(message), true)
  })

  it('ignores empty assistant placeholders', () => {
    const message = makeMessage({ content: '' })

    assert.equal(isTurnResponseMessage(message), false)
  })

  it('ignores user messages with content', () => {
    const message = makeMessage({ role: 'user', content: 'hello' })

    assert.equal(isTurnResponseMessage(message), false)
  })
})

describe('getCompletedTurnTargets', () => {
  it('marks a turn completed when the assistant only used tools', () => {
    const messages = [
      makeMessage({ id: 'user-1', role: 'user', content: 'edit file' }),
      makeMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        toolCalls: [{
          id: 'tool-1',
          name: 'Edit',
          input: { file_path: 'README.md' },
          status: 'completed',
        }],
      }),
    ]

    const targets = getCompletedTurnTargets(messages)

    assert.equal(targets.length, 1)
    assert.equal(targets[0].messageId, 'user-1')
    assert.equal(targets[0].userMessageIndex, 0)
  })

  it('changes from incomplete to completed when an assistant placeholder receives metadata', () => {
    const messages = [
      makeMessage({ id: 'user-1', role: 'user', content: 'edit file' }),
      makeMessage({ id: 'assistant-1', role: 'assistant', content: '' }),
    ]

    assert.equal(getCompletedTurnTargets(messages).length, 0)

    messages[1].metadata = { model: 'test-model', duration: 100 }

    const targets = getCompletedTurnTargets(messages)
    assert.equal(targets.length, 1)
    assert.equal(targets[0].messageId, 'user-1')
  })
})
