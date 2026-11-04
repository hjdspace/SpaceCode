// @vitest-environment node
/**
 * Schema 迁移：同版本直读、低版本转换、过旧拒绝、未知字段保留。
 * 迁移只转换记录形状，不重写领域事实，也不重置 seq。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXECUTION_POLICY,
  DEFAULT_REVIEW_REMINDER_HOURS,
  SUPER_AGENT_SCHEMA_VERSION,
  migrateProjectFile,
  migrateStateFile,
} from '../migration'

const context = {
  projectKey: '0123456789abcdef',
  repoRoot: '/repo/space-code',
  name: 'space-code',
  now: () => new Date('2026-01-01T00:00:00.000Z'),
}

function legacyProject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectKey: context.projectKey,
    repoRoot: context.repoRoot,
    name: context.name,
    lastOpenedAt: '2025-12-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('migrateProjectFile', () => {
  it('loads the current schema unchanged and keeps unknown fields', () => {
    const raw = {
      ...legacyProject(),
      schemaVersion: SUPER_AGENT_SCHEMA_VERSION,
      executionPolicy: { mode: 'parallel', maxConcurrency: 2, worktree: true },
      reviewReminderHours: 8,
      custom: { keep: true },
    }

    const result = migrateProjectFile(raw, context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
    expect(result.from).toBe(SUPER_AGENT_SCHEMA_VERSION)
    expect(result.project.schemaVersion).toBe(SUPER_AGENT_SCHEMA_VERSION)
    expect(result.project.executionPolicy).toEqual({ mode: 'parallel', maxConcurrency: 2, worktree: true })
    expect(result.project.reviewReminderHours).toBe(8)
    expect(result.project.custom).toEqual({ keep: true })
  })

  it('upgrades v1 by filling policy defaults and keeps existing settings', () => {
    const result = migrateProjectFile(legacyProject({ reviewReminderHours: 12, custom: 'keep' }), context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)
    expect(result.from).toBe(1)
    expect(result.to).toBe(SUPER_AGENT_SCHEMA_VERSION)
    expect(result.project.schemaVersion).toBe(SUPER_AGENT_SCHEMA_VERSION)
    expect(result.project.executionPolicy).toEqual(DEFAULT_EXECUTION_POLICY)
    expect(result.project.reviewReminderHours).toBe(12)
    expect(result.project.custom).toBe('keep')
    expect(result.project.lastOpenedAt).toBe('2025-12-01T00:00:00.000Z')
  })

  it('fills the review reminder default when v1 never persisted it', () => {
    const result = migrateProjectFile(legacyProject(), context)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project.reviewReminderHours).toBe(DEFAULT_REVIEW_REMINDER_HOURS)
  })

  it('refuses schema versions below the minimum supported version', () => {
    const result = migrateProjectFile(legacyProject({ schemaVersion: 0 }), context)

    expect(result).toMatchObject({ ok: false, error: 'tooOld' })
  })

  it('refuses schema versions newer than this build', () => {
    const result = migrateProjectFile(
      legacyProject({ schemaVersion: SUPER_AGENT_SCHEMA_VERSION + 1 }),
      context,
    )

    expect(result).toMatchObject({ ok: false, error: 'schemaAhead' })
  })

  it('reports corrupt project files instead of guessing', () => {
    expect(migrateProjectFile(null, context)).toMatchObject({ ok: false, error: 'corrupt' })
    expect(migrateProjectFile({ schemaVersion: 'two' }, context)).toMatchObject({
      ok: false,
      error: 'corrupt',
    })
    expect(
      migrateProjectFile(legacyProject({ repoRoot: 42 }), context),
    ).toMatchObject({ ok: false, error: 'corrupt' })
  })
})

describe('migrateStateFile', () => {
  it('keeps the current snapshot as-is', () => {
    const raw = {
      schemaVersion: SUPER_AGENT_SCHEMA_VERSION,
      lastSeq: 3,
      state: { events: ['a', 'b', 'c'] },
    }

    const result = migrateStateFile(raw)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(false)
    expect(result.file).toEqual(raw)
  })

  it('upgrades a v1 snapshot without touching lastSeq or state', () => {
    const result = migrateStateFile({ schemaVersion: 1, lastSeq: 4, state: { events: ['seed'] } })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.changed).toBe(true)
    expect(result.from).toBe(1)
    expect(result.file).toEqual({
      schemaVersion: SUPER_AGENT_SCHEMA_VERSION,
      lastSeq: 4,
      state: { events: ['seed'] },
    })
  })

  it('rejects snapshots with an invalid seq watermark', () => {
    expect(migrateStateFile({ schemaVersion: 1, lastSeq: -1, state: {} })).toMatchObject({
      ok: false,
      error: 'corrupt',
    })
    expect(migrateStateFile({ schemaVersion: 1, lastSeq: 1.5, state: {} })).toMatchObject({
      ok: false,
      error: 'corrupt',
    })
    expect(migrateStateFile({ schemaVersion: 0, lastSeq: 0, state: {} })).toMatchObject({
      ok: false,
      error: 'tooOld',
    })
  })
})
