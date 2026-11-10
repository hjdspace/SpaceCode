/**
 * Super Agent 项目状态的 schema 版本与迁移。
 *
 * 迁移只转换记录形状（补齐字段、升级版本号），不重写已落盘的领域事实；
 * 未知字段一律原样保留，保证前向兼容。当前版本 2，支持从 1 升级；
 * 低于最低支持版本或高于本版本的文件都拒绝启动，交给上层报成可见错误。
 */

import type { SuperAgentSourcesConfig } from './sources/config'

export const SUPER_AGENT_SCHEMA_VERSION = 2
export const SUPER_AGENT_MIN_SCHEMA_VERSION = 1

export interface SuperAgentExecutionPolicy {
  mode: 'serial' | 'parallel'
  maxConcurrency: number
  worktree: boolean
}

export const DEFAULT_EXECUTION_POLICY: SuperAgentExecutionPolicy = Object.freeze({
  mode: 'serial',
  maxConcurrency: 1,
  worktree: false,
})

export const DEFAULT_REVIEW_REMINDER_HOURS = 24

/** project.json。未知字段通过索引签名原样保留。 */
export interface SuperAgentProjectConfig {
  schemaVersion: number
  projectKey: string
  repoRoot: string
  name: string
  executionPolicy: SuperAgentExecutionPolicy
  reviewReminderHours: number
  lastOpenedAt: string
  /** T24 #93：项目级 Source 接入配置（未知字段保留，无需提升 schemaVersion）。 */
  sources?: SuperAgentSourcesConfig
  [key: string]: unknown
}

/** state.json。state 是调用方 reducer 产生的可重建投影。 */
export interface SuperAgentStateFile {
  schemaVersion: number
  lastSeq: number
  state: unknown
  [key: string]: unknown
}

export interface ProjectMigrationContext {
  projectKey: string
  repoRoot: string
  name: string
  now: () => Date
}

export type SchemaMigrationError = 'corrupt' | 'tooOld' | 'schemaAhead'

export type ProjectMigrationResult =
  | {
      ok: true
      project: SuperAgentProjectConfig
      from: number
      to: number
      changed: boolean
    }
  | { ok: false; error: SchemaMigrationError }

export type StateMigrationResult =
  | {
      ok: true
      file: SuperAgentStateFile
      from: number
      to: number
      changed: boolean
    }
  | { ok: false; error: SchemaMigrationError }

type RawRecord = Record<string, unknown>

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSuperAgentExecutionPolicy(value: unknown): value is SuperAgentExecutionPolicy {
  if (!isRecord(value)) return false
  if (value.mode !== 'serial' && value.mode !== 'parallel') return false
  if (
    typeof value.maxConcurrency !== 'number' ||
    !Number.isInteger(value.maxConcurrency) ||
    value.maxConcurrency < 1
  ) {
    return false
  }
  return typeof value.worktree === 'boolean'
}

function readVersion(raw: unknown): number | SchemaMigrationError {
  if (!isRecord(raw)) return 'corrupt'
  const version = raw.schemaVersion
  if (typeof version !== 'number' || !Number.isInteger(version)) return 'corrupt'
  if (version < SUPER_AGENT_MIN_SCHEMA_VERSION) return 'tooOld'
  if (version > SUPER_AGENT_SCHEMA_VERSION) return 'schemaAhead'
  return version
}

function isValidReviewReminderHours(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function isValidLastOpenedAt(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

/**
 * v1 只有身份与最末打开时间；v2 增加执行策略与 review 提醒配置。
 * 缺失时补默认值，已有合法值保持不变。
 */
function upgradeProjectV1(raw: RawRecord, context: ProjectMigrationContext): RawRecord {
  return {
    ...raw,
    schemaVersion: 2,
    executionPolicy: isSuperAgentExecutionPolicy(raw.executionPolicy)
      ? raw.executionPolicy
      : DEFAULT_EXECUTION_POLICY,
    reviewReminderHours: isValidReviewReminderHours(raw.reviewReminderHours)
      ? raw.reviewReminderHours
      : DEFAULT_REVIEW_REMINDER_HOURS,
    lastOpenedAt: isValidLastOpenedAt(raw.lastOpenedAt)
      ? raw.lastOpenedAt
      : context.now().toISOString(),
  }
}

const PROJECT_MIGRATIONS: Record<number, (raw: RawRecord, context: ProjectMigrationContext) => RawRecord> = {
  1: upgradeProjectV1,
}

/** 字段缺失时用创建上下文补齐；显式写错类型则视为损坏，不静默改写。 */
function pickIdentity(
  raw: RawRecord,
  key: 'projectKey' | 'repoRoot' | 'name',
  fallback: string,
): string | null {
  const value = raw[key]
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !value) return null
  return value
}

function normalizeProject(
  raw: RawRecord,
  context: ProjectMigrationContext,
): SuperAgentProjectConfig | null {
  const projectKey = pickIdentity(raw, 'projectKey', context.projectKey)
  const repoRoot = pickIdentity(raw, 'repoRoot', context.repoRoot)
  const name = pickIdentity(raw, 'name', context.name)
  if (projectKey === null || repoRoot === null || name === null) return null
  if (!isSuperAgentExecutionPolicy(raw.executionPolicy)) return null
  if (!isValidReviewReminderHours(raw.reviewReminderHours)) return null
  if (!isValidLastOpenedAt(raw.lastOpenedAt)) return null
  return {
    ...raw,
    schemaVersion: SUPER_AGENT_SCHEMA_VERSION,
    projectKey,
    repoRoot,
    name,
    executionPolicy: raw.executionPolicy,
    reviewReminderHours: raw.reviewReminderHours,
    lastOpenedAt: raw.lastOpenedAt,
  }
}

export function migrateProjectFile(
  raw: unknown,
  context: ProjectMigrationContext,
): ProjectMigrationResult {
  const version = readVersion(raw)
  if (typeof version === 'string') return { ok: false, error: version }

  let current = { ...(raw as RawRecord) }
  let from = version
  while ((current.schemaVersion as number) < SUPER_AGENT_SCHEMA_VERSION) {
    const step = PROJECT_MIGRATIONS[current.schemaVersion as number]
    if (!step) return { ok: false, error: 'corrupt' }
    current = step(current, context)
  }

  const project = normalizeProject(current, context)
  if (!project) return { ok: false, error: 'corrupt' }
  return {
    ok: true,
    project,
    from,
    to: SUPER_AGENT_SCHEMA_VERSION,
    changed: from !== SUPER_AGENT_SCHEMA_VERSION,
  }
}

/** v1 的 snapshot 形状与 v2 相同，只差版本号。 */
function upgradeStateV1(raw: RawRecord): RawRecord {
  return { ...raw, schemaVersion: 2 }
}

const STATE_MIGRATIONS: Record<number, (raw: RawRecord) => RawRecord> = {
  1: upgradeStateV1,
}

function normalizeState(raw: RawRecord): SuperAgentStateFile | null {
  const lastSeq = raw.lastSeq
  if (typeof lastSeq !== 'number' || !Number.isInteger(lastSeq) || lastSeq < 0) return null
  if (!('state' in raw)) return null
  return {
    ...raw,
    schemaVersion: SUPER_AGENT_SCHEMA_VERSION,
    lastSeq,
    state: raw.state,
  }
}

export function migrateStateFile(raw: unknown): StateMigrationResult {
  const version = readVersion(raw)
  if (typeof version === 'string') return { ok: false, error: version }

  let current = { ...(raw as RawRecord) }
  let from = version
  while ((current.schemaVersion as number) < SUPER_AGENT_SCHEMA_VERSION) {
    const step = STATE_MIGRATIONS[current.schemaVersion as number]
    if (!step) return { ok: false, error: 'corrupt' }
    current = step(current)
  }

  const file = normalizeState(current)
  if (!file) return { ok: false, error: 'corrupt' }
  return {
    ok: true,
    file,
    from,
    to: SUPER_AGENT_SCHEMA_VERSION,
    changed: from !== SUPER_AGENT_SCHEMA_VERSION,
  }
}
