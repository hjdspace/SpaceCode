/**
 * turnCheckpointUtils tests.
 */
import { describe, it } from 'vitest'
import assert from 'node:assert/strict'
import {
  assignTurnCardsToGroups,
  findTurnCheckpointForMessage,
  getCompletedTurnTargets,
  isTurnResponseMessage,
  type TurnGroupAnchor,
} from '../../src/utils/turnCheckpointUtils.ts'
import type {
  Message,
  SessionTurnCheckpoint,
  TurnChangeCardData,
} from '../../src/types/index.ts'

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

function makeCard(
  targetUserMessageId: string,
  userMessageIndex: number,
  turnStartedAt?: number
): TurnChangeCardData {
  const checkpoint = makeCheckpoint(targetUserMessageId, userMessageIndex, [`${userMessageIndex}.ts`])
  if (turnStartedAt !== undefined) checkpoint.target.turnStartedAt = turnStartedAt
  return {
    checkpoint,
    workDir: null,
    isLatest: false,
    targetUserMessageId,
  }
}

function makeGroup(groupIndex: number, messageId: string, timestamp: number): TurnGroupAnchor {
  return { groupIndex, messageId, timestamp }
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

describe('assignTurnCardsToGroups', () => {
  const T0 = Date.parse('2026-09-27T10:00:00.000Z')
  const MINUTE = 60_000

  it('anchors cards to turns by timestamp instead of positional index', () => {
    // engine 记录时刻只比前端发送晚几毫秒
    const groups = [makeGroup(0, 'u1', T0), makeGroup(1, 'u2', T0 + MINUTE)]
    const cards = [makeCard('engine-1', 0, T0 + 4), makeCard('engine-2', 1, T0 + MINUTE + 4)]

    const assigned = assignTurnCardsToGroups(groups, cards)

    assert.equal(assigned.get(0)?.checkpoint.target.targetUserMessageId, 'engine-1')
    assert.equal(assigned.get(1)?.checkpoint.target.targetUserMessageId, 'engine-2')
  })

  it('drops the card whose turn was trimmed from the frontend instead of shifting it down', () => {
    // 回归用例：前端因 500 条上限 / 编辑重发丢掉了第一轮，旧的位置匹配会把
    // 第一轮卡片挂到第二轮下面（engine index 0 == 前端 groupIndex 0 == u2）
    const groups = [makeGroup(0, 'u2', T0 + MINUTE), makeGroup(1, 'u3', T0 + 2 * MINUTE)]
    const cards = [
      makeCard('engine-1', 0, T0 + 4),
      makeCard('engine-2', 1, T0 + MINUTE + 4),
      makeCard('engine-3', 2, T0 + 2 * MINUTE + 4),
    ]

    const assigned = assignTurnCardsToGroups(groups, cards)

    assert.equal(assigned.has(0), true)
    assert.equal(assigned.get(0)?.checkpoint.target.targetUserMessageId, 'engine-2')
    assert.equal(assigned.get(1)?.checkpoint.target.targetUserMessageId, 'engine-3')
    assert.equal(assigned.size, 2)
  })

  it('matches a turn whose message was queued and recorded late by the engine', () => {
    const groups = [makeGroup(0, 'u1', T0), makeGroup(1, 'u2', T0 + 10_000)]
    // u2 在 u1 的运行中被发送，engine 直到 3 分钟后才把它写进 JSONL
    const cards = [makeCard('engine-1', 0, T0 + 4), makeCard('engine-2', 1, T0 + 3 * MINUTE)]

    const assigned = assignTurnCardsToGroups(groups, cards)

    assert.equal(assigned.get(1)?.checkpoint.target.targetUserMessageId, 'engine-2')
  })

  it('never assigns two cards to the same turn', () => {
    const groups = [makeGroup(0, 'u1', T0), makeGroup(1, 'u2', T0 + 10 * MINUTE)]
    // engine 注入的 isMeta 用户条目也带快照，锚点落在第一轮内
    const cards = [
      makeCard('engine-1', 0, T0 + 4),
      makeCard('engine-meta', 1, T0 + 30_000),
      makeCard('engine-2', 2, T0 + 10 * MINUTE + 4),
    ]

    const assigned = assignTurnCardsToGroups(groups, cards)

    assert.equal(assigned.get(0)?.checkpoint.target.targetUserMessageId, 'engine-1')
    assert.equal(assigned.get(1)?.checkpoint.target.targetUserMessageId, 'engine-2')
    assert.equal(assigned.size, 2)
  })

  it('falls back to id and index matching when a card has no timestamp anchor', () => {
    const groups = [makeGroup(0, 'u1', T0), makeGroup(1, 'u2', T0 + MINUTE)]
    const cards = [makeCard('u1', 0), makeCard('engine-2', 1)]

    const assigned = assignTurnCardsToGroups(groups, cards)

    assert.equal(assigned.get(0)?.checkpoint.target.targetUserMessageId, 'u1')
    assert.equal(assigned.get(1)?.checkpoint.target.targetUserMessageId, 'engine-2')
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
