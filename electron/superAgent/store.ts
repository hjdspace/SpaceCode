/**
 * Super Agent 项目级持久化 Store（T02 #72）。
 *
 * 状态目录：`<userData>/super-agent/projects/<projectKey>/`
 *   project.json   — schema 版本、执行策略、reviewReminderHours、最后打开时间
 *   state.json     — 可重建快照：调用方 reducer 产生的 state + lastSeq
 *   events.jsonl   — 权威 WAL：每条事务含领域事件、Effect 与 Outbox，单调 seq 追加
 *
 * 提交顺序遵循「先持久化事实，再广播」：事务先追加 WAL 并 fsync（提交点），
 * 随后原子替换 state.json 快照。快照写失败不撤销已提交的 WAL，重开时按 seq 重放补齐。
 * 坏记录不静默丢弃：隔离进 quarantine.jsonl，并在 diagnostics 中报告。
 */
import { createHash, randomUUID } from 'crypto'
import {
  closeSync,
  copyFileSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'fs'
import { basename, dirname, join } from 'path'
import { writeJsonAtomic as defaultWriteJsonAtomic } from '../factory/atomic'
import {
  DEFAULT_EXECUTION_POLICY,
  DEFAULT_REVIEW_REMINDER_HOURS,
  SUPER_AGENT_SCHEMA_VERSION,
  migrateProjectFile,
  migrateStateFile,
  type SchemaMigrationError,
  type SuperAgentExecutionPolicy,
  type SuperAgentProjectConfig,
  type SuperAgentStateFile,
} from './migration'

export const SUPER_AGENT_PROJECTS_DIR = 'super-agent/projects'
export const PROJECT_STATE_LOCK = 'project.lock'
export const PROJECT_STATE_FILE = 'state.json'
export const PROJECT_FILE = 'project.json'
export const PROJECT_EVENTS_FILE = 'events.jsonl'
export const PROJECT_QUARANTINE_FILE = 'quarantine.jsonl'

/** 一条 WAL 事务：事件、Effect 与 Outbox 同时落盘，作为同一个提交点。 */
export interface StoreTransactionRecord {
  seq: number
  at: string
  events: unknown[]
  effects: unknown[]
  outbox: unknown[]
}

export interface StoreTransactionInput {
  events?: unknown[]
  effects?: unknown[]
  outbox?: unknown[]
}

export interface StoreQuarantineEntry {
  source: 'events' | 'state'
  reason: string
  raw: string
}

export interface StoreSeqGap {
  expected: number
  actual: number
}

export interface ProjectStoreDiagnostics {
  quarantined: StoreQuarantineEntry[]
  seqGaps: StoreSeqGap[]
  migration: { from: number; to: number } | null
}

export interface ProjectStorePaths {
  project: string
  state: string
  events: string
  lock: string
  quarantine: string
}

export type ProjectStoreErrorCode =
  | 'locked'
  | 'tooOld'
  | 'schemaAhead'
  | 'corrupt'
  | 'migrationFailed'
  | 'io'

export interface ProjectStoreErrorDetail {
  pid?: number
  path?: string
  reason?: string
}

export class ProjectStoreError extends Error {
  constructor(
    readonly code: ProjectStoreErrorCode,
    message: string,
    readonly detail: ProjectStoreErrorDetail = {},
  ) {
    super(message)
    this.name = 'ProjectStoreError'
  }
}

export interface ProjectStoreDeps {
  now?: () => Date
  isProcessAlive?: (pid: number) => boolean
  /**
   * T11 #81：锁持有者是否仍在本进程内活跃（默认查 ACTIVE_LOCKS）。
   * 测试注入 () => false 可模拟「本进程已崩溃、换新进程接管陈旧锁」的重启。
   */
  isLockHeldInProcess?: (holder: { pid: number; token: string }) => boolean
  writeJsonAtomic?: (path: string, value: unknown) => void
  appendFile?: (path: string, data: string) => void
}

export interface OpenProjectStoreOptions<TState> {
  /** `<userData>` 根目录，项目状态落在其下 `super-agent/projects/<projectKey>/`。 */
  userDataDir: string
  repoRoot: string
  initialState: TState
  reduce: (state: TState, tx: StoreTransactionRecord) => TState
  name?: string
  executionPolicy?: SuperAgentExecutionPolicy
  reviewReminderHours?: number
  deps?: ProjectStoreDeps
}

export interface CommitResult<TState> {
  seq: number
  at: string
  state: TState
}

export interface ProjectStore<TState> {
  readonly projectKey: string
  readonly dir: string
  readonly paths: ProjectStorePaths
  readonly project: SuperAgentProjectConfig
  readonly state: TState
  readonly lastSeq: number
  readonly diagnostics: ProjectStoreDiagnostics
  commit(input?: StoreTransactionInput): CommitResult<TState>
  close(): void
}

interface LockFile {
  pid: number
  at: string
  token: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 以仓库 realpath 的哈希前 16 位作为 projectKey，仓库移动后不会串项目。 */
export function projectKeyOf(repoRoot: string): string {
  const resolved = realpathSync(repoRoot)
  return createHash('sha256').update(resolved).digest('hex').slice(0, 16)
}

export function projectDirOf(userDataDir: string, projectKey: string): string {
  return join(userDataDir, ...SUPER_AGENT_PROJECTS_DIR.split('/'), projectKey)
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH 才是进程不存在；EPERM 说明进程活着但无权探测。
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** 只有 ENOENT 才算“文件不存在”；其他读取错误必须冒泡，避免把可读文件当缺失而覆盖。 */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new ProjectStoreError('io', `failed to read ${path}`, {
      path,
      reason: err instanceof Error ? err.message : String(err),
    })
  }
}

/** WAL 是纯文本，截断半写尾行时需要原子替换（先写临时文件再 rename）。 */
function writeTextAtomic(path: string, text: string): void {
  const temp = `${path}.tmp-${randomUUID()}`
  writeFileSync(temp, text)
  renameSync(temp, path)
}

/** WAL 追加必须落盘后才算提交；appendFile 注入仅用于测试。 */
function appendDurable(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const fd = openSync(path, 'a')
  try {
    writeSync(fd, data)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** 本进程当前持有的锁 token。用于区分“自己已打开”和同 PID 的历史锁。 */
const ACTIVE_LOCKS = new Set<string>()

function lockKey(path: string, token: string): string {
  return `${path}\u0000${token}`
}

type LockReadResult =
  | { kind: 'missing' }
  | { kind: 'unreadable' }
  | { kind: 'lock'; lock: LockFile }

function readLock(path: string): LockReadResult {
  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'unreadable' }
  }
  try {
    const raw = JSON.parse(text) as unknown
    if (!isRecord(raw)) return { kind: 'unreadable' }
    if (typeof raw.pid !== 'number' || !Number.isInteger(raw.pid)) return { kind: 'unreadable' }
    return {
      kind: 'lock',
      lock: {
        pid: raw.pid,
        at: typeof raw.at === 'string' ? raw.at : '',
        token: typeof raw.token === 'string' ? raw.token : '',
      },
    }
  } catch {
    return { kind: 'unreadable' }
  }
}

function tryCreateLock(path: string, lock: LockFile): boolean {
  try {
    const fd = openSync(path, 'wx')
    try {
      writeSync(fd, JSON.stringify(lock))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    return true
  } catch {
    return false
  }
}

/**
 * 项目互斥锁：同一项目同一时间只允许一个主进程打开，包括同进程重复打开。
 * 陈旧锁通过 rename 原子接管，避免两个实例同时 unlink 后各自创建成功而双开。
 */
function acquireProjectLock(
  path: string,
  isProcessAlive: (pid: number) => boolean,
  now: () => Date,
  isLockHeldInProcess: (holder: { pid: number; token: string }) => boolean = (holder) =>
    ACTIVE_LOCKS.has(lockKey(path, holder.token)),
): string {
  mkdirSync(dirname(path), { recursive: true })
  const token = randomUUID()
  const lock: LockFile = { pid: process.pid, at: now().toISOString(), token }

  if (tryCreateLock(path, lock)) {
    ACTIVE_LOCKS.add(lockKey(path, token))
    return token
  }

  const existing = readLock(path)
  if (existing.kind === 'unreadable') {
    throw new ProjectStoreError('locked', 'project lock file is unreadable', { path })
  }
  if (existing.kind === 'lock') {
    const holder = existing.lock
    if (isLockHeldInProcess(holder) || isProcessAlive(holder.pid)) {
      throw new ProjectStoreError('locked', `project is locked by pid ${holder.pid}`, {
        pid: holder.pid,
        path,
      })
    }
  }

  // 陈旧锁：rename 原子摘除，只有一方能成功。
  const stalePath = `${path}.stale-${token}`
  try {
    renameSync(path, stalePath)
  } catch {
    throw new ProjectStoreError('locked', 'project lock is held', { path })
  }
  try {
    unlinkSync(stalePath)
  } catch {
    // 清理失败不影响接管
  }
  if (tryCreateLock(path, lock)) {
    ACTIVE_LOCKS.add(lockKey(path, token))
    return token
  }
  throw new ProjectStoreError('locked', 'project lock is held', { path })
}

/** 只释放自己创建的锁，避免误删后来者的锁。 */
function releaseProjectLock(path: string, token: string): void {
  ACTIVE_LOCKS.delete(lockKey(path, token))
  const existing = readLock(path)
  if (existing.kind !== 'lock' || existing.lock.token !== token) return
  try {
    unlinkSync(path)
  } catch {
    // 释放失败不影响退出，下次启动按陈旧锁处理
  }
}

function parseTransaction(raw: unknown): StoreTransactionRecord | null {
  if (!isRecord(raw)) return null
  if (typeof raw.seq !== 'number' || !Number.isInteger(raw.seq) || raw.seq <= 0) return null
  if (typeof raw.at !== 'string') return null
  if (!Array.isArray(raw.events)) return null
  if (raw.effects !== undefined && !Array.isArray(raw.effects)) return null
  if (raw.outbox !== undefined && !Array.isArray(raw.outbox)) return null
  return {
    seq: raw.seq,
    at: raw.at,
    events: raw.events,
    effects: Array.isArray(raw.effects) ? raw.effects : [],
    outbox: Array.isArray(raw.outbox) ? raw.outbox : [],
  }
}

function extractSnapshotExtras(file: SuperAgentStateFile): Record<string, unknown> {
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(file)) {
    if (key === 'schemaVersion' || key === 'lastSeq' || key === 'state') continue
    extras[key] = value
  }
  return extras
}

function buildFreshProject(
  projectKey: string,
  repoRoot: string,
  name: string | undefined,
  executionPolicy: SuperAgentExecutionPolicy | undefined,
  reviewReminderHours: number | undefined,
  openedAt: string,
): SuperAgentProjectConfig {
  return {
    schemaVersion: SUPER_AGENT_SCHEMA_VERSION,
    projectKey,
    repoRoot,
    name: name?.trim() || basename(repoRoot),
    executionPolicy: executionPolicy ?? DEFAULT_EXECUTION_POLICY,
    reviewReminderHours: reviewReminderHours ?? DEFAULT_REVIEW_REMINDER_HOURS,
    lastOpenedAt: openedAt,
  }
}

function migrationErrorToStoreError(error: SchemaMigrationError, path: string): ProjectStoreError {
  const message = {
    corrupt: 'project state file is corrupt',
    tooOld: 'project schema version is below the minimum supported version',
    schemaAhead: 'project schema version is newer than this build',
  }[error]
  return new ProjectStoreError(error, message, { path, reason: error })
}

export function openProjectStore<TState>(options: OpenProjectStoreOptions<TState>): ProjectStore<TState> {
  const deps = options.deps ?? {}
  const now = deps.now ?? (() => new Date())
  const isProcessAlive = deps.isProcessAlive ?? defaultIsProcessAlive
  const writeJsonAtomic = deps.writeJsonAtomic ?? defaultWriteJsonAtomic
  const appendFile = deps.appendFile ?? appendDurable

  const openedAt = now().toISOString()
  const repoRoot = realpathSync(options.repoRoot)
  const projectKey = projectKeyOf(repoRoot)
  const dir = projectDirOf(options.userDataDir, projectKey)
  mkdirSync(dir, { recursive: true })
  const paths: ProjectStorePaths = {
    project: join(dir, PROJECT_FILE),
    state: join(dir, PROJECT_STATE_FILE),
    events: join(dir, PROJECT_EVENTS_FILE),
    lock: join(dir, PROJECT_STATE_LOCK),
    quarantine: join(dir, PROJECT_QUARANTINE_FILE),
  }

  const token = acquireProjectLock(
    paths.lock,
    isProcessAlive,
    now,
    deps.isLockHeldInProcess,
  )

  const quarantined: StoreQuarantineEntry[] = []
  const seqGaps: StoreSeqGap[] = []
  let migrated: { from: number; to: number } | null = null

  try {
    const projectText = readText(paths.project)
    let projectRaw: unknown = null
    if (projectText !== null) {
      try {
        projectRaw = JSON.parse(projectText)
      } catch {
        throw new ProjectStoreError('corrupt', 'project.json is not valid JSON', {
          path: paths.project,
        })
      }
    }

    const stateText = readText(paths.state)
    let stateRaw: unknown = null
    if (stateText !== null) {
      try {
        stateRaw = JSON.parse(stateText)
      } catch {
        quarantined.push({ source: 'state', reason: 'invalid-json', raw: stateText })
      }
    }

    const projectMigration = projectRaw === null
      ? null
      : migrateProjectFile(projectRaw, {
          projectKey,
          repoRoot,
          name: options.name?.trim() || basename(repoRoot),
          now: () => new Date(openedAt),
        })
    if (projectMigration && !projectMigration.ok) {
      throw migrationErrorToStoreError(projectMigration.error, paths.project)
    }

    const stateMigration = stateRaw === null
      ? null
      : migrateStateFile(stateRaw)
    if (stateMigration && !stateMigration.ok) {
      if (stateMigration.error === 'corrupt') {
        // 快照形状损坏：隔离后从空投影完整重放，不静默清空 WAL。
        quarantined.push({ source: 'state', reason: 'invalid-shape', raw: stateText ?? '' })
      } else {
        throw migrationErrorToStoreError(stateMigration.error, paths.state)
      }
    }

    const project: SuperAgentProjectConfig = projectMigration?.ok
      ? { ...projectMigration.project, lastOpenedAt: openedAt }
      : buildFreshProject(
          projectKey,
          repoRoot,
          options.name,
          options.executionPolicy,
          options.reviewReminderHours,
          openedAt,
        )

    const projectChanged = projectMigration?.ok ? projectMigration.changed : projectRaw === null
    const stateChanged = stateMigration?.ok ? stateMigration.changed : false
    if (projectMigration?.ok && projectMigration.changed) {
      migrated = { from: projectMigration.from, to: projectMigration.to }
    } else if (stateMigration?.ok && stateMigration.changed) {
      migrated = { from: stateMigration.from, to: stateMigration.to }
    }

    if (projectChanged || stateChanged) {
      applyMigrationTransaction({
        projectPath: paths.project,
        statePath: paths.state,
        project,
        stateFile: stateMigration?.ok
          ? { ...stateMigration.file, schemaVersion: SUPER_AGENT_SCHEMA_VERSION }
          : null,
        projectExisted: projectRaw !== null,
        stateExisted: stateRaw !== null && stateMigration?.ok === true,
        writeJsonAtomic,
      })
    } else {
      // 每次打开更新最后打开时间；未知字段随 project 对象原样写回。
      writeJsonAtomic(paths.project, { ...project, lastOpenedAt: openedAt })
    }

    // ── 重放：只应用 seq > 快照水位的 WAL 事务 ─────────────────────
    const snapshot = stateMigration?.ok ? stateMigration.file : null
    const snapshotExtras = snapshot ? extractSnapshotExtras(snapshot) : {}
    let state = (snapshot ? snapshot.state : options.initialState) as TState
    let lastSeq = snapshot ? snapshot.lastSeq : 0
    let dirty = snapshot === null || quarantined.some((item) => item.source === 'state')

    const walText = readText(paths.events)
    let walBody = walText ?? ''
    if (walText && !walText.endsWith('\n')) {
      // 崩溃在写事务中间：尾行没有换行，不是完整提交。隔离后截断，
      // 否则下一次 append 会把新记录粘到半行后面，合法事务永久不可解析。
      const lastBreak = walText.lastIndexOf('\n')
      const partial = walText.slice(lastBreak + 1)
      walBody = walText.slice(0, lastBreak + 1)
      if (partial.trim()) {
        quarantined.push({ source: 'events', reason: 'partial-record', raw: partial })
        writeTextAtomic(paths.events, walBody)
      }
    }

    if (walBody) {
      const snapshotSeq = lastSeq
      const appliedSeqs = new Set<number>()
      for (const line of walBody.split(/\r?\n/)) {
        if (!line.trim()) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(line)
        } catch {
          quarantined.push({ source: 'events', reason: 'invalid-json', raw: line })
          continue
        }
        const record = parseTransaction(parsed)
        if (!record) {
          quarantined.push({ source: 'events', reason: 'invalid-record', raw: line })
          continue
        }
        // 快照水位以内的事务已经合并进 snapshot，跳过不算坏记录。
        if (record.seq <= snapshotSeq) continue
        if (appliedSeqs.has(record.seq)) {
          quarantined.push({ source: 'events', reason: 'duplicate-seq', raw: line })
          continue
        }
        if (record.seq < lastSeq + 1) {
          quarantined.push({ source: 'events', reason: 'out-of-order', raw: line })
          continue
        }
        if (record.seq !== lastSeq + 1) {
          seqGaps.push({ expected: lastSeq + 1, actual: record.seq })
        }
        try {
          state = options.reduce(state, record)
        } catch {
          // 坏事务被隔离，但水位照常前进，避免下一次提交复用到同一个 seq。
          quarantined.push({ source: 'events', reason: 'reduce-failed', raw: line })
        }
        appliedSeqs.add(record.seq)
        lastSeq = record.seq
        dirty = true
      }
    }

    if (quarantined.length > 0) {
      const lines = quarantined
        .map((entry) =>
          JSON.stringify({ at: now().toISOString(), source: entry.source, reason: entry.reason, raw: entry.raw }),
        )
        .join('\n')
      appendFile(paths.quarantine, `${lines}\n`)
    }

    // 快照缺失/损坏或 WAL 有未合并事务：重放后修复快照。
    if (dirty) {
      writeJsonAtomic(paths.state, {
        ...snapshotExtras,
        schemaVersion: SUPER_AGENT_SCHEMA_VERSION,
        lastSeq,
        state,
      })
    }

    let closed = false
    return {
      projectKey,
      dir,
      paths,
      project,
      get state() {
        return state
      },
      get lastSeq() {
        return lastSeq
      },
      diagnostics: { quarantined, seqGaps, migration: migrated },
      commit(input = {}) {
        if (closed) throw new ProjectStoreError('io', 'project store is closed', { path: dir })
        const seq = lastSeq + 1
        const at = now().toISOString()
        const record: StoreTransactionRecord = {
          seq,
          at,
          events: input.events ?? [],
          effects: input.effects ?? [],
          outbox: input.outbox ?? [],
        }
        // 先算新投影：reducer 抛出时不产生任何落盘。
        const nextState = options.reduce(state, record)
        appendFile(paths.events, `${JSON.stringify(record)}\n`)
        // 内存水位先推进，保证快照写失败后本进程不会复用 seq。
        state = nextState
        lastSeq = seq
        try {
          writeJsonAtomic(paths.state, {
            ...snapshotExtras,
            schemaVersion: SUPER_AGENT_SCHEMA_VERSION,
            lastSeq,
            state,
          })
        } catch (err) {
          throw new ProjectStoreError(
            'io',
            'transaction committed to WAL but the snapshot write failed',
            { path: paths.state, reason: err instanceof Error ? err.message : String(err) },
          )
        }
        return { seq, at, state: nextState }
      },
      close() {
        if (closed) return
        closed = true
        releaseProjectLock(paths.lock, token)
      },
    }
  } catch (err) {
    releaseProjectLock(paths.lock, token)
    throw err
  }
}

interface ApplyMigrationOptions {
  projectPath: string
  statePath: string
  project: SuperAgentProjectConfig
  stateFile: { schemaVersion: number; lastSeq: number; state: unknown } | null
  projectExisted: boolean
  stateExisted: boolean
  writeJsonAtomic: (path: string, value: unknown) => void
}

/**
 * 迁移单事务：先把原文件复制成 `.bak`，再原子替换；任一步失败就回滚全部原文件。
 */
function applyMigrationTransaction(options: ApplyMigrationOptions): void {
  const backups: { target: string; backup: string }[] = []
  if (options.projectExisted) backups.push({ target: options.projectPath, backup: `${options.projectPath}.bak` })
  if (options.stateExisted && options.stateFile) {
    backups.push({ target: options.statePath, backup: `${options.statePath}.bak` })
  }
  for (const item of backups) {
    try {
      copyFileSync(item.target, item.backup)
    } catch {
      // 备份失败时直接中止，不进入替换
      throw new ProjectStoreError('migrationFailed', 'failed to back up project state', {
        path: item.target,
      })
    }
  }

  try {
    options.writeJsonAtomic(options.projectPath, options.project)
    if (options.stateFile) options.writeJsonAtomic(options.statePath, options.stateFile)
  } catch (err) {
    const rollbackFailures: string[] = []
    for (const item of backups) {
      try {
        copyFileSync(item.backup, item.target)
      } catch (rollbackErr) {
        rollbackFailures.push(rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr))
      }
    }
    throw new ProjectStoreError('migrationFailed', 'schema migration failed and was rolled back', {
      path: options.projectPath,
      reason: [err instanceof Error ? err.message : String(err), ...rollbackFailures].join('; '),
    })
  }
}
