// src/lib/petAnimation.test.ts
import { describe, expect, it } from 'vitest'
import {
  PET_ACTIVE_BURST_LOOPS,
  PET_AMBIENT_GESTURE_LOOPS,
  PET_AMBIENT_IDLE_LOOPS,
  PET_ANIMATION_DEFINITIONS,
  PET_ANIMATION_STATES,
  PET_ATLAS_V2,
  PET_IDLE_DURATION_MULTIPLIER,
  PET_LOOK_DIRECTIONS,
  PET_NEUTRAL_LOOK_FRAME,
  getNextPetAnimationPlaybackIndex,
  getPetAnimationDurationMs,
  getPetAnimationFrames,
  getPetAnimationPlaybackFrames,
  getPetAnimationPlaybackLoopStartIndex,
  getPetAnimationPlaybackStep,
  getPetAnimationPlaybackTickAtElapsedMs,
  getPetAtlasFrame,
  getPetLookFrame,
  quantizePetLookDirection,
  resolvePetLookFrame,
  type PetAnimationState,
} from './petAnimation'

describe('getPetAtlasFrame', () => {
  it('computes atlas coordinates from row and column', () => {
    expect(getPetAtlasFrame(0, 0)).toEqual({
      rowIndex: 0,
      columnIndex: 0,
      x: 0,
      y: 0,
      width: PET_ATLAS_V2.cellWidth,
      height: PET_ATLAS_V2.cellHeight,
    })
    expect(getPetAtlasFrame(1, 3)).toMatchObject({ x: 3 * 192, y: 1 * 208 })
  })

  it('accepts the maximum valid row and column', () => {
    const frame = getPetAtlasFrame(PET_ATLAS_V2.rows - 1, PET_ATLAS_V2.columns - 1)
    expect(frame.x).toBe((PET_ATLAS_V2.columns - 1) * PET_ATLAS_V2.cellWidth)
    expect(frame.y).toBe((PET_ATLAS_V2.rows - 1) * PET_ATLAS_V2.cellHeight)
  })

  it.each([-1, PET_ATLAS_V2.rows, 1.5, Number.NaN])(
    'rejects invalid rowIndex %s',
    (rowIndex) => {
      expect(() => getPetAtlasFrame(rowIndex, 0)).toThrow(RangeError)
    },
  )

  it.each([-1, PET_ATLAS_V2.columns, 2.5, Number.NaN])(
    'rejects invalid columnIndex %s',
    (columnIndex) => {
      expect(() => getPetAtlasFrame(0, columnIndex)).toThrow(RangeError)
    },
  )
})

describe('getPetAnimationFrames', () => {
  it('maps every state to its definition row with sequential frame indices', () => {
    for (const state of PET_ANIMATION_STATES) {
      const definition = PET_ANIMATION_DEFINITIONS[state]
      const frames = getPetAnimationFrames(state)
      expect(frames).toHaveLength(definition.frameDurationsMs.length)
      frames.forEach((frame, index) => {
        expect(frame.frameIndex).toBe(index)
        expect(frame.rowIndex).toBe(definition.rowIndex)
        expect(frame.columnIndex).toBe(index)
        expect(frame.durationMs).toBe(definition.frameDurationsMs[index])
      })
    }
  })
})

describe('getPetAnimationPlaybackFrames', () => {
  it('builds action bursts followed by a slowed idle tail for active states', () => {
    const state: PetAnimationState = 'running'
    const actionFrames = getPetAnimationFrames(state)
    const idleFrames = getPetAnimationFrames('idle')
    const playback = getPetAnimationPlaybackFrames(state)

    const expectedLength =
      actionFrames.length * PET_ACTIVE_BURST_LOOPS + idleFrames.length
    expect(playback).toHaveLength(expectedLength)

    const actionPart = playback.slice(0, actionFrames.length * PET_ACTIVE_BURST_LOOPS)
    expect(actionPart.every((f) => f.phase === 'action' && f.motionState === state)).toBe(true)

    const idlePart = playback.slice(actionFrames.length * PET_ACTIVE_BURST_LOOPS)
    expect(idlePart.every((f) => f.phase === 'idle' && f.motionState === 'idle')).toBe(true)
    expect(idlePart[0]!.durationMs).toBe(idleFrames[0]!.durationMs * PET_IDLE_DURATION_MULTIPLIER)
  })

  it('marks cycleBoundaryAfter only on the last frame of each loop', () => {
    const playback = getPetAnimationPlaybackFrames('running')
    const actionFrames = getPetAnimationFrames('running')
    for (let loop = 0; loop < PET_ACTIVE_BURST_LOOPS; loop++) {
      const start = loop * actionFrames.length
      expect(playback[start + actionFrames.length - 1]!.cycleBoundaryAfter).toBe(true)
      expect(playback[start]!.cycleBoundaryAfter).toBe(false)
    }
  })

  it('composes idle playback from ambient idle and gesture loops', () => {
    const idleFrames = getPetAnimationFrames('idle')
    const wavingFrames = getPetAnimationFrames('waving')
    const jumpingFrames = getPetAnimationFrames('jumping')
    const playback = getPetAnimationPlaybackFrames('idle')

    const expectedLength =
      idleFrames.length * PET_AMBIENT_IDLE_LOOPS * 2 +
      wavingFrames.length * PET_AMBIENT_GESTURE_LOOPS +
      jumpingFrames.length * PET_AMBIENT_GESTURE_LOOPS
    expect(playback).toHaveLength(expectedLength)
    expect(playback.some((f) => f.motionState === 'waving' && f.phase === 'action')).toBe(true)
    expect(playback.some((f) => f.motionState === 'jumping' && f.phase === 'action')).toBe(true)
  })

  it('caches playback frames per state', () => {
    expect(getPetAnimationPlaybackFrames('waving')).toBe(getPetAnimationPlaybackFrames('waving'))
  })
})

describe('getNextPetAnimationPlaybackIndex', () => {
  it('advances to the next index', () => {
    expect(getNextPetAnimationPlaybackIndex('running', 0)).toBe(1)
  })

  it('wraps back to the loop start after the last frame', () => {
    const length = getPetAnimationPlaybackFrames('running').length
    expect(getNextPetAnimationPlaybackIndex('running', length - 1)).toBe(
      getPetAnimationPlaybackLoopStartIndex('running'),
    )
  })

  it('normalizes indices beyond the playback length', () => {
    const length = getPetAnimationPlaybackFrames('running').length
    expect(getNextPetAnimationPlaybackIndex('running', length)).toBe(1)
  })

  it.each([-1, 0.5, Number.NaN])('rejects invalid playbackIndex %s', (index) => {
    expect(() => getNextPetAnimationPlaybackIndex('running', index)).toThrow(RangeError)
  })
})

describe('getPetAnimationPlaybackStep', () => {
  it('returns the step at the normalized index', () => {
    const playback = getPetAnimationPlaybackFrames('running')
    const step = getPetAnimationPlaybackStep('running', 0)
    expect(step.frame).toEqual(playback[0])
    expect(step.phase).toBe(playback[0]!.phase)
    expect(step.motionState).toBe(playback[0]!.motionState)
    expect(step.cycleBoundaryAfter).toBe(playback[0]!.cycleBoundaryAfter)
  })

  it('normalizes indices beyond the playback length', () => {
    const length = getPetAnimationPlaybackFrames('running').length
    expect(getPetAnimationPlaybackStep('running', length).frame).toEqual(
      getPetAnimationPlaybackStep('running', 0).frame,
    )
  })

  it.each([-2, 1.25])('rejects invalid playbackIndex %s', (index) => {
    expect(() => getPetAnimationPlaybackStep('running', index)).toThrow(RangeError)
  })
})

describe('getPetAnimationPlaybackTickAtElapsedMs', () => {
  it('returns the first frame at elapsed 0', () => {
    const tick = getPetAnimationPlaybackTickAtElapsedMs('running', 0)
    expect(tick.playbackIndex).toBe(0)
    expect(tick.remainingDurationMs).toBe(tick.frame.durationMs)
  })

  it('lands on the next frame at an exact frame boundary', () => {
    const first = getPetAnimationPlaybackFrames('running')[0]!
    const tick = getPetAnimationPlaybackTickAtElapsedMs('running', first.durationMs)
    expect(tick.playbackIndex).toBe(1)
    expect(tick.remainingDurationMs).toBe(tick.frame.durationMs)
  })

  it('tracks remaining time within a frame', () => {
    const tick = getPetAnimationPlaybackTickAtElapsedMs('running', 50)
    expect(tick.playbackIndex).toBe(0)
    expect(tick.remainingDurationMs).toBe(tick.frame.durationMs - 50)
  })

  it('wraps around when elapsed exceeds the full loop duration', () => {
    const total = getPetAnimationPlaybackFrames('running').reduce(
      (sum, frame) => sum + frame.durationMs,
      0,
    )
    const wrapped = getPetAnimationPlaybackTickAtElapsedMs('running', total)
    expect(wrapped.playbackIndex).toBe(0)

    const offset = getPetAnimationPlaybackTickAtElapsedMs('running', total + 50)
    expect(offset.playbackIndex).toBe(0)
    expect(offset.remainingDurationMs).toBe(offset.frame.durationMs - 50)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid elapsedMs %s',
    (elapsed) => {
      expect(() => getPetAnimationPlaybackTickAtElapsedMs('running', elapsed)).toThrow(RangeError)
    },
  )
})

describe('getPetAnimationDurationMs', () => {
  it('sums the frame durations of a state', () => {
    const expected = PET_ANIMATION_DEFINITIONS.waving.frameDurationsMs.reduce(
      (sum, ms) => sum + ms,
      0,
    )
    expect(getPetAnimationDurationMs('waving')).toBe(expected)
  })
})

describe('getPetLookFrame', () => {
  it('returns the neutral frame for a null direction', () => {
    const frame = getPetLookFrame(null)
    expect(frame.directionDegrees).toBeNull()
    expect(frame.rowIndex).toBe(PET_NEUTRAL_LOOK_FRAME.rowIndex)
    expect(frame.columnIndex).toBe(PET_NEUTRAL_LOOK_FRAME.columnIndex)
  })

  it('uses row 9 for the first 8 directions', () => {
    expect(getPetLookFrame(0)).toMatchObject({ rowIndex: 9, columnIndex: 0 })
    expect(getPetLookFrame(157.5)).toMatchObject({ rowIndex: 9, columnIndex: 7 })
  })

  it('uses row 10 for the last 8 directions', () => {
    expect(getPetLookFrame(180)).toMatchObject({ rowIndex: 10, columnIndex: 0 })
    expect(getPetLookFrame(337.5)).toMatchObject({ rowIndex: 10, columnIndex: 7 })
  })

  it('rejects unsupported directions', () => {
    expect(() => getPetLookFrame(10 as never)).toThrow(RangeError)
  })
})

describe('quantizePetLookDirection', () => {
  it('returns null for a zero vector', () => {
    expect(quantizePetLookDirection(0, 0)).toBeNull()
  })

  it('returns null inside the deadzone', () => {
    expect(quantizePetLookDirection(3, 4, 5)).toBeNull()
    expect(quantizePetLookDirection(3, 4, 6)).toBeNull()
  })

  it('leaves the direction unchanged outside the deadzone', () => {
    expect(quantizePetLookDirection(3, 4, 4.9)).not.toBeNull()
  })

  it.each([
    [0, -1, 0],       // up
    [1, -1, 45],      // up-right
    [1, 0, 90],       // right
    [1, 1, 135],      // down-right
    [0, 1, 180],      // down
    [-1, 1, 225],     // down-left
    [-1, 0, 270],     // left
    [-1, -1, 315],    // up-left
  ])('maps vector (%s, %s) to %s degrees', (dx, dy, expected) => {
    expect(quantizePetLookDirection(dx, dy)).toBe(expected)
  })

  it('rounds to the nearest 22.5-degree step and wraps past 360', () => {
    // ~354° is closer to 0° than to 337.5°
    const value = quantizePetLookDirection(Math.sin((354 * Math.PI) / 180), -Math.cos((354 * Math.PI) / 180))
    expect(value).toBe(0)
    expect(PET_LOOK_DIRECTIONS).toContain(value)
  })

  it.each([
    [Number.NaN, 0],
    [0, Number.POSITIVE_INFINITY],
  ])('rejects non-finite vectors (%s, %s)', (dx, dy) => {
    expect(() => quantizePetLookDirection(dx, dy)).toThrow(RangeError)
  })

  it('rejects a negative deadzone', () => {
    expect(() => quantizePetLookDirection(1, 1, -1)).toThrow(RangeError)
  })
})

describe('resolvePetLookFrame', () => {
  it('resolves the neutral frame for a zero vector', () => {
    const frame = resolvePetLookFrame(0, 0)
    expect(frame.directionDegrees).toBeNull()
    expect(frame.rowIndex).toBe(PET_NEUTRAL_LOOK_FRAME.rowIndex)
  })

  it('resolves a directional frame for a non-zero vector', () => {
    expect(resolvePetLookFrame(1, 0)).toMatchObject({
      directionDegrees: 90,
      rowIndex: 9,
      columnIndex: 4,
    })
  })
})
