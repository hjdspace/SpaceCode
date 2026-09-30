// src/lib/petSessionModel.test.ts
import { describe, expect, it } from 'vitest'
import {
  buildPetSessionActivities,
  buildPetSessionPreview,
  petStatusAnimation,
  pickPrimaryPetActivity,
  resolvePetSessionStatus,
  type PetSessionActivity,
  type PetSessionInput,
} from './petSessionModel'

function makeInput(overrides: Partial<PetSessionInput> = {}): PetSessionInput {
  return {
    sessionId: 'session-1',
    title: 'Test Session',
    updatedAt: 1000,
    processStatus: 'idle',
    isLoading: false,
    streamingText: '',
    hasPendingPermission: false,
    lastMessage: null,
    runningTeammatesCount: 0,
    ...overrides,
  }
}

function makeActivity(overrides: Partial<PetSessionActivity> = {}): PetSessionActivity {
  return {
    sessionId: 'session-1',
    title: 'Test Session',
    status: 'idle',
    preview: '',
    updatedAt: 1000,
    ...overrides,
  }
}

describe('resolvePetSessionStatus', () => {
  it('returns waiting when a permission approval is pending', () => {
    expect(resolvePetSessionStatus(makeInput({ hasPendingPermission: true }))).toBe('waiting')
  })

  it('prioritizes waiting over loading, running process and errors', () => {
    const input = makeInput({
      hasPendingPermission: true,
      isLoading: true,
      processStatus: 'active',
      runningTeammatesCount: 2,
      lastMessage: { role: 'assistant', content: 'boom', hasError: true },
    })
    expect(resolvePetSessionStatus(input)).toBe('waiting')
  })

  it('returns running while the turn is loading', () => {
    expect(resolvePetSessionStatus(makeInput({ isLoading: true }))).toBe('running')
  })

  it.each(['active', 'starting'])('returns running for processStatus %s', (processStatus) => {
    expect(resolvePetSessionStatus(makeInput({ processStatus }))).toBe('running')
  })

  it('returns running when background teammates are active', () => {
    expect(resolvePetSessionStatus(makeInput({ runningTeammatesCount: 1 }))).toBe('running')
  })

  it('prefers loading over an exited process', () => {
    const input = makeInput({ isLoading: true, processStatus: 'exited' })
    expect(resolvePetSessionStatus(input)).toBe('running')
  })

  it('returns failed when the last message has an error', () => {
    const input = makeInput({
      lastMessage: { role: 'assistant', content: 'something broke', hasError: true },
    })
    expect(resolvePetSessionStatus(input)).toBe('failed')
  })

  it('returns failed when the process exited abnormally', () => {
    expect(resolvePetSessionStatus(makeInput({ processStatus: 'exited' }))).toBe('failed')
  })

  it.each(['none', 'idle', 'suspended'])('returns idle for processStatus %s', (processStatus) => {
    expect(resolvePetSessionStatus(makeInput({ processStatus }))).toBe('idle')
  })

  it('ignores non-error last messages', () => {
    const input = makeInput({
      lastMessage: { role: 'assistant', content: 'all good', hasError: false },
    })
    expect(resolvePetSessionStatus(input)).toBe('idle')
  })
})

describe('petStatusAnimation', () => {
  it.each([
    ['waiting', 'waiting'],
    ['failed', 'failed'],
    ['running', 'running'],
    ['idle', 'idle'],
  ] as const)('maps %s to %s', (status, animation) => {
    expect(petStatusAnimation(status)).toBe(animation)
  })
})

describe('buildPetSessionPreview', () => {
  it('normalizes whitespace in streaming text', () => {
    const input = makeInput({ streamingText: 'hello\n\n  world\t!' })
    expect(buildPetSessionPreview(input)).toBe('hello world !')
  })

  it('truncates streaming text beyond maxLength with an ellipsis', () => {
    const input = makeInput({ streamingText: 'x'.repeat(200) })
    const preview = buildPetSessionPreview(input)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview.length).toBe(120)
  })

  it('respects a custom maxLength', () => {
    const input = makeInput({ streamingText: 'a'.repeat(50) })
    const preview = buildPetSessionPreview(input, 10)
    expect(preview).toBe(`${'a'.repeat(9)}…`)
  })

  it('keeps short streaming text unchanged', () => {
    const input = makeInput({ streamingText: 'short reply' })
    expect(buildPetSessionPreview(input)).toBe('short reply')
  })

  it('falls back to the last assistant message when streaming text is blank', () => {
    const input = makeInput({
      streamingText: '   ',
      lastMessage: { role: 'assistant', content: 'final\nanswer', hasError: false },
    })
    expect(buildPetSessionPreview(input)).toBe('final answer')
  })

  it('truncates the assistant fallback message', () => {
    const input = makeInput({
      lastMessage: { role: 'assistant', content: 'b'.repeat(200), hasError: false },
    })
    const preview = buildPetSessionPreview(input)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview.length).toBe(120)
  })

  it('returns an empty string when the last message is not from the assistant', () => {
    const input = makeInput({
      lastMessage: { role: 'user', content: 'question', hasError: false },
    })
    expect(buildPetSessionPreview(input)).toBe('')
  })

  it('returns an empty string when there is no content at all', () => {
    expect(buildPetSessionPreview(makeInput())).toBe('')
  })
})

describe('buildPetSessionActivities', () => {
  it('maps inputs to activities with derived status and preview', () => {
    const activities = buildPetSessionActivities([
      makeInput({ sessionId: 'a', streamingText: 'working', isLoading: true }),
    ])
    expect(activities).toHaveLength(1)
    expect(activities[0]).toMatchObject({
      sessionId: 'a',
      status: 'running',
      preview: 'working',
      updatedAt: 1000,
    })
  })

  it('sorts by status priority first (waiting before failed before running before idle)', () => {
    const activities = buildPetSessionActivities([
      makeInput({ sessionId: 'idle' }),
      makeInput({ sessionId: 'running', isLoading: true }),
      makeInput({ sessionId: 'failed', processStatus: 'exited' }),
      makeInput({ sessionId: 'waiting', hasPendingPermission: true }),
    ])
    expect(activities.map((a) => a.sessionId)).toEqual(['waiting', 'failed', 'running', 'idle'])
  })

  it('breaks priority ties by most recent updatedAt', () => {
    const activities = buildPetSessionActivities([
      makeInput({ sessionId: 'older', isLoading: true, updatedAt: 100 }),
      makeInput({ sessionId: 'newer', isLoading: true, updatedAt: 200 }),
    ])
    expect(activities.map((a) => a.sessionId)).toEqual(['newer', 'older'])
  })

  it('limits the number of activities', () => {
    const inputs = Array.from({ length: 12 }, (_, i) =>
      makeInput({ sessionId: `s${i}`, updatedAt: i }))
    const activities = buildPetSessionActivities(inputs)
    expect(activities).toHaveLength(9)
  })

  it('supports a custom limit and clamps negative limits to zero', () => {
    const inputs = Array.from({ length: 3 }, (_, i) => makeInput({ sessionId: `s${i}` }))
    expect(buildPetSessionActivities(inputs, 2)).toHaveLength(2)
    expect(buildPetSessionActivities(inputs, 0)).toHaveLength(0)
    expect(buildPetSessionActivities(inputs, -5)).toHaveLength(0)
  })

  it('returns an empty list for no inputs', () => {
    expect(buildPetSessionActivities([])).toEqual([])
  })
})

describe('pickPrimaryPetActivity', () => {
  it('returns the first non-idle activity', () => {
    const activities = [
      makeActivity({ sessionId: 'a', status: 'waiting' }),
      makeActivity({ sessionId: 'b', status: 'running' }),
    ]
    expect(pickPrimaryPetActivity(activities)?.sessionId).toBe('a')
  })

  it('skips leading idle activities', () => {
    const activities = [
      makeActivity({ sessionId: 'a', status: 'idle' }),
      makeActivity({ sessionId: 'b', status: 'failed' }),
    ]
    expect(pickPrimaryPetActivity(activities)?.sessionId).toBe('b')
  })

  it('returns null when every activity is idle', () => {
    const activities = [makeActivity({ status: 'idle' }), makeActivity({ status: 'idle' })]
    expect(pickPrimaryPetActivity(activities)).toBeNull()
  })

  it('returns null for an empty list', () => {
    expect(pickPrimaryPetActivity([])).toBeNull()
  })
})
