// @vitest-environment node
/**
 * 项目持久化 Store：原子提交、seq 重放、坏记录隔离、项目锁与 schema 迁移。
 *
 * 测试只通过公开行为验证：磁盘文件内容、重开后的投影、诊断列表与错误码。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeJsonAtomic as realWriteJsonAtomic } from '../../factory/atomic'
import {
  DEFAULT_EXECUTION_POLICY,
  DEFAULT_REVIEW_REMINDER_HOURS,
  type SuperAgentExecutionPolicy,
} from '../migration'
import {
  ProjectStoreError,
  openProjectStore,
  projectKeyOf,
  type ProjectStore,
  type StoreTransactionRecord,
} from '../store'

interface TestState {
  events: unknown[]
  effects: unknown[]
  outbox: unknown[]
}

const INITIAL_STATE: TestState = { events: [], effects: [], outbox: [] }

function reduce(state: TestState, tx: StoreTransactionRecord): TestState {
  return {
    events: [...state.events, ...tx.events],
    effects: [...state.effects, ...tx.effects],
    outbox: [...state.outbox, ...tx.outbox],
  }
}

let roots: string[] = []
let stores: ProjectStore<TestState>[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

interface ExtraOptions {
  name?: string
  executionPolicy?: SuperAgentExecutionPolicy
  reviewReminderHours?: number
  reduce?: (state: TestState, tx: StoreTransactionRecord) => TestState
  deps?: {
    now?: () => Date
    isProcessAlive?: (pid: number) => boolean
    writeJsonAtomic?: (path: string, value: unknown) => void
  }
}

function open(
  userDataDir: string,
  repoRoot: string,
  extra: ExtraOptions = {},
): ProjectStore<TestState> {
  const { reduce: customReduce, ...rest } = extra
  const store = openProjectStore<TestState>({
    userDataDir,
    repoRoot,
    initialState: INITIAL_STATE,
    reduce: customReduce ?? reduce,
    ...rest,
  })
  stores.push(store)
  return store
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
}

function readWal(path: string): Record<string, unknown>[] {
  return readFileSync(path, 'utf-8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
}

afterEach(() => {
  for (const store of stores) {
    try {
      store.close()
    } catch {
      // 清理失败由下一个用例的临时目录清理兜底
    }
  }
  stores = []
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('project key and layout', () => {
  it('derives a stable 16-char key from the repo realpath and stores state under userData', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')

    const key = projectKeyOf(repo)
    expect(key).toMatch(/^[0-9a-f]{16}$/)
    expect(projectKeyOf(repo)).toBe(key)

    const store = open(userData, repo)
    expect(store.projectKey).toBe(key)
    expect(store.dir).toBe(join(userData, 'super-agent', 'projects', key))
    expect(existsSync(store.paths.project)).toBe(true)
    expect(existsSync(store.paths.lock)).toBe(true)
  })

  it('writes project.json with schema version, execution policy and review reminder defaults', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')

    const store = open(userData, repo)
    const project = readJson(store.paths.project)

    expect(project).toMatchObject({
      schemaVersion: 2,
      projectKey: store.projectKey,
      repoRoot: realpathSync(repo),
      executionPolicy: DEFAULT_EXECUTION_POLICY,
      reviewReminderHours: DEFAULT_REVIEW_REMINDER_HOURS,
    })
    expect(project.name).toBeTruthy()
    expect(store.state).toEqual(INITIAL_STATE)
    expect(store.lastSeq).toBe(0)
  })

  it('keeps configured policy/name and unknown project fields across reopen', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const policy = { mode: 'parallel', maxConcurrency: 3, worktree: true } as const

    const first = open(userData, repo, {
      name: 'My Agent',
      executionPolicy: policy,
      reviewReminderHours: 6,
    })
    first.close()

    const raw = readJson(first.paths.project)
    writeFileSync(first.paths.project, JSON.stringify({ ...raw, customPreserved: 'yes' }))

    const again = open(userData, repo)
    expect(again.project.name).toBe('My Agent')
    expect(again.project.executionPolicy).toEqual(policy)
    expect(again.project.reviewReminderHours).toBe(6)
    expect(readJson(first.paths.project).customPreserved).toBe('yes')
  })

  it('updates lastOpenedAt on open without resetting the seq watermark', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    let clock = Date.parse('2026-01-01T00:00:00.000Z')
    const now = () => new Date(clock)

    const first = open(userData, repo, { deps: { now } })
    first.commit({ events: ['a'] })
    expect(first.project.lastOpenedAt).toBe('2026-01-01T00:00:00.000Z')
    first.close()

    clock += 1000
    const again = open(userData, repo, { deps: { now } })
    expect(again.project.lastOpenedAt).toBe('2026-01-01T00:00:01.000Z')
    expect(again.lastSeq).toBe(1)
  })
})

describe('atomic commit and replay', () => {
  it('appends one WAL record per transaction and snapshots lastSeq', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const store = open(userData, repo)

    const first = store.commit({ events: ['a'], effects: ['e1'] })
    expect(first.seq).toBe(1)
    expect(store.state).toEqual({ events: ['a'], effects: ['e1'], outbox: [] })

    const second = store.commit({ events: ['b'], outbox: ['o1'] })
    expect(second.seq).toBe(2)
    expect(store.lastSeq).toBe(2)

    const snapshot = readJson(store.paths.state)
    expect(snapshot.schemaVersion).toBe(2)
    expect(snapshot.lastSeq).toBe(2)
    expect(snapshot.state).toEqual(store.state)

    const wal = readWal(store.paths.events)
    expect(wal.map((record) => record.seq)).toEqual([1, 2])
    expect(wal[0]).toMatchObject({ events: ['a'], effects: ['e1'], outbox: [] })
    expect(wal[1]).toMatchObject({ events: ['b'], effects: [], outbox: ['o1'] })
    expect(readdirSync(store.dir).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('replays the WAL on reopen and keeps state/seq consistent', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')

    const first = open(userData, repo)
    first.commit({ events: ['a'], effects: ['e1'] })
    first.commit({ events: ['b'], outbox: ['o1'] })
    first.close()

    const again = open(userData, repo)
    expect(again.state).toEqual({ events: ['a', 'b'], effects: ['e1'], outbox: ['o1'] })
    expect(again.lastSeq).toBe(2)
    expect(again.diagnostics.quarantined).toEqual([])
  })

  it('recovers a transaction whose WAL record landed but the snapshot did not', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')

    const store = open(userData, repo)
    store.commit({ events: ['a'] })
    const staleSnapshot = readFileSync(store.paths.state, 'utf-8')
    store.commit({ events: ['b'] })
    // 模拟崩溃窗口：WAL 已提交，state.json 仍是上一笔
    writeFileSync(store.paths.state, staleSnapshot)
    store.close()

    const again = open(userData, repo)
    expect(again.state.events).toEqual(['a', 'b'])
    expect(again.lastSeq).toBe(2)
    expect(again.diagnostics.quarantined).toEqual([])
  })

  it('quarantines a corrupted snapshot and replays the whole WAL', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')

    const store = open(userData, repo)
    store.commit({ events: ['a'], effects: ['e1'] })
    store.close()
    writeFileSync(store.paths.state, '{"schemaVersion":2,"lastSeq":1,"state":')

    const again = open(userData, repo)
    expect(again.state).toEqual({ events: ['a'], effects: ['e1'], outbox: [] })
    expect(again.lastSeq).toBe(1)
    expect(again.diagnostics.quarantined.map((item) => item.source)).toContain('state')
    expect(readFileSync(again.paths.quarantine, 'utf-8')).toContain('state')
  })

  it('truncates a half-written WAL tail so the next commit starts on a clean line', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')

    const store = open(userData, repo)
    store.commit({ events: ['a'] })
    store.commit({ events: ['b'] })
    store.close()
    // 模拟崩溃在写事务中间：WAL 尾部只有半行，没有换行
    appendFileSync(store.paths.events, '{"seq":3,"at":"2026-01-01","events":["partial"]')

    const recovered = open(userData, repo)
    expect(recovered.state.events).toEqual(['a', 'b'])
    expect(recovered.lastSeq).toBe(2)
    expect(recovered.diagnostics.quarantined).toHaveLength(1)
    expect(recovered.diagnostics.quarantined[0].reason).toBe('partial-record')

    const result = recovered.commit({ events: ['c'] })
    expect(result.seq).toBe(3)
    recovered.close()

    const again = open(userData, repo)
    expect(again.state.events).toEqual(['a', 'b', 'c'])
    expect(again.lastSeq).toBe(3)
    expect(again.diagnostics.quarantined).toEqual([])
  })

  it('advances the seq watermark past a record the reducer rejects', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')

    const store = open(userData, repo)
    store.commit({ events: ['a'] })
    store.commit({ events: ['b'] })
    store.close()
    appendFileSync(
      store.paths.events,
      `${JSON.stringify({ seq: 3, at: '2026-01-01', events: ['boom'], effects: [], outbox: [] })}\n`,
    )

    const strictReduce = (state: TestState, tx: StoreTransactionRecord): TestState => {
      if (tx.events.includes('boom')) throw new Error('boom')
      return reduce(state, tx)
    }
    const again = open(userData, repo, { reduce: strictReduce })

    expect(again.state.events).toEqual(['a', 'b'])
    expect(again.lastSeq).toBe(3)
    expect(again.diagnostics.quarantined).toHaveLength(1)
    expect(again.diagnostics.quarantined[0].reason).toBe('reduce-failed')
    expect(again.commit({ events: ['c'] }).seq).toBe(4)
  })
})

describe('bad WAL records', () => {
  function seedTwoCommits(repo: string, userData: string): ProjectStore<TestState> {
    const store = open(userData, repo)
    store.commit({ events: ['a'] })
    store.commit({ events: ['b'] })
    store.close()
    return store
  }

  it('quarantines unparseable and malformed records but keeps valid ones replayable', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const store = seedTwoCommits(repo, userData)

    appendFileSync(store.paths.events, '{not json\n')
    appendFileSync(store.paths.events, `${JSON.stringify({ at: '2026-01-01', events: ['broken'] })}\n`)
    appendFileSync(
      store.paths.events,
      `${JSON.stringify({ seq: 4, at: '2026-01-01', events: ['d'], effects: [], outbox: [] })}\n`,
    )

    const again = open(userData, repo)
    expect(again.state.events).toEqual(['a', 'b', 'd'])
    expect(again.lastSeq).toBe(4)
    expect(again.diagnostics.quarantined).toHaveLength(2)
    expect(again.diagnostics.quarantined.every((item) => item.source === 'events')).toBe(true)
    expect(again.diagnostics.seqGaps).toEqual([{ expected: 3, actual: 4 }])

    const quarantine = readFileSync(again.paths.quarantine, 'utf-8')
    expect(quarantine).toContain('{not json')
    expect(quarantine).toContain('events')
  })

  it('does not quarantine records that only carry unknown future fields', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const store = seedTwoCommits(repo, userData)

    appendFileSync(
      store.paths.events,
      `${JSON.stringify({
        seq: 3,
        at: '2026-01-01',
        events: ['c'],
        effects: [],
        outbox: [],
        future: { note: 'unknown field' },
      })}\n`,
    )

    const again = open(userData, repo)
    expect(again.state.events).toEqual(['a', 'b', 'c'])
    expect(again.lastSeq).toBe(3)
    expect(again.diagnostics.quarantined).toEqual([])
  })

  it('quarantines duplicate seq records so an event is not applied twice', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const store = seedTwoCommits(repo, userData)

    const duplicate = JSON.stringify({ seq: 3, at: '2026-01-01', events: ['c'], effects: [], outbox: [] })
    appendFileSync(store.paths.events, `${duplicate}\n${duplicate}\n`)

    const again = open(userData, repo)
    expect(again.state.events).toEqual(['a', 'b', 'c'])
    expect(again.lastSeq).toBe(3)
    expect(again.diagnostics.quarantined).toHaveLength(1)
    expect(again.diagnostics.quarantined[0].reason).toContain('duplicate')
  })
})

describe('project lock', () => {
  it('rejects a second store for the same project and allows reopen after close', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')

    const first = open(userData, repo)
    expect(() => open(userData, repo)).toThrowError(ProjectStoreError)

    let error: unknown
    try {
      open(userData, repo)
    } catch (err) {
      error = err
    }
    expect((error as ProjectStoreError).code).toBe('locked')
    expect((error as ProjectStoreError).detail?.pid).toBe(process.pid)

    first.close()
    const second = open(userData, repo)
    expect(second.lastSeq).toBe(0)
  })

  it('takes over a lock whose owner process is gone', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')

    const first = open(userData, repo)
    first.close()
    writeFileSync(
      first.paths.lock,
      JSON.stringify({ pid: 424242, at: '2026-01-01T00:00:00.000Z', token: 'stale' }),
    )

    const again = open(userData, repo, { deps: { isProcessAlive: () => false } })
    expect(again.lastSeq).toBe(0)
    expect(readJson(again.paths.lock).pid).toBe(process.pid)
  })

  it('rejects a lock held by another live process', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const dir = join(userData, 'super-agent', 'projects', projectKeyOf(repo))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'project.lock'),
      JSON.stringify({ pid: 999999, at: '2026-01-01T00:00:00.000Z', token: 'foreign' }),
    )

    let error: unknown
    try {
      open(userData, repo, { deps: { isProcessAlive: () => true } })
    } catch (err) {
      error = err
    }

    expect((error as ProjectStoreError).code).toBe('locked')
    expect((error as ProjectStoreError).detail?.pid).toBe(999999)
  })

  it('does not remove a lock replaced by another owner while the store is open', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const store = open(userData, repo)

    writeFileSync(
      store.paths.lock,
      JSON.stringify({ pid: process.pid, at: '2026-01-01T00:00:00.000Z', token: 'foreign' }),
    )
    store.close()

    expect(existsSync(store.paths.lock)).toBe(true)
  })

  it('reopens after a store closes and does not resurrect its old lock', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')

    const first = open(userData, repo)
    first.close()
    const second = open(userData, repo)

    expect(existsSync(second.paths.lock)).toBe(true)
    second.commit({ events: ['a'] })
  })
})

describe('schema migration on open', () => {
  function seedLegacyProject(repo: string, userData: string): { dir: string; projectPath: string; statePath: string } {
    const key = projectKeyOf(repo)
    const dir = join(userData, 'super-agent', 'projects', key)
    mkdirSync(dir, { recursive: true })
    const projectPath = join(dir, 'project.json')
    const statePath = join(dir, 'state.json')
    writeFileSync(
      projectPath,
      JSON.stringify({
        schemaVersion: 1,
        projectKey: key,
        repoRoot: realpathSync(repo),
        name: 'legacy',
        lastOpenedAt: '2025-12-01T00:00:00.000Z',
        custom: 'keep',
      }),
    )
    writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, lastSeq: 0, state: INITIAL_STATE }))
    return { dir, projectPath, statePath }
  }

  it('migrates v1 files in one transaction and preserves unknown fields', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const legacy = seedLegacyProject(repo, userData)

    const store = open(userData, repo)
    const project = readJson(legacy.projectPath)

    expect(project.schemaVersion).toBe(2)
    expect(project.executionPolicy).toEqual(DEFAULT_EXECUTION_POLICY)
    expect(project.reviewReminderHours).toBe(DEFAULT_REVIEW_REMINDER_HOURS)
    expect(project.custom).toBe('keep')
    expect(readJson(legacy.statePath).schemaVersion).toBe(2)
    expect(store.diagnostics.migration).toEqual({ from: 1, to: 2 })
    expect(existsSync(`${legacy.projectPath}.bak`)).toBe(true)
    expect(readJson(`${legacy.projectPath}.bak`).schemaVersion).toBe(1)
  })

  it('restores the original files when any migration write fails', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const legacy = seedLegacyProject(repo, userData)
    const originalProject = readFileSync(legacy.projectPath, 'utf-8')

    let error: unknown
    try {
      open(userData, repo, {
        deps: {
          writeJsonAtomic: (path, value) => {
            if (path.endsWith('state.json')) throw new Error('disk full')
            realWriteJsonAtomic(path, value)
          },
        },
      })
    } catch (err) {
      error = err
    }

    expect((error as ProjectStoreError).code).toBe('migrationFailed')
    expect(readFileSync(legacy.projectPath, 'utf-8')).toBe(originalProject)
    expect(existsSync(`${legacy.projectPath}.bak`)).toBe(true)

    // 锁必须释放，后续正常启动仍能完成迁移
    const again = open(userData, repo)
    expect(again.lastSeq).toBe(0)
    expect(readJson(legacy.projectPath).schemaVersion).toBe(2)
  })

  it('refuses to start a project whose schema is too old', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const legacy = seedLegacyProject(repo, userData)
    const raw = readJson(legacy.projectPath)
    writeFileSync(legacy.projectPath, JSON.stringify({ ...raw, schemaVersion: 0 }))
    const before = readFileSync(legacy.projectPath, 'utf-8')

    let error: unknown
    try {
      open(userData, repo)
    } catch (err) {
      error = err
    }

    expect((error as ProjectStoreError).code).toBe('tooOld')
    expect(readFileSync(legacy.projectPath, 'utf-8')).toBe(before)
    expect(existsSync(legacy.statePath)).toBe(true)
  })

  it('refuses to start a project whose schema is newer than this build', () => {
    const repo = tempDir('sa-repo-')
    const userData = tempDir('sa-user-')
    const legacy = seedLegacyProject(repo, userData)
    const raw = readJson(legacy.projectPath)
    writeFileSync(legacy.projectPath, JSON.stringify({ ...raw, schemaVersion: 3 }))
    const before = readFileSync(legacy.projectPath, 'utf-8')

    let error: unknown
    try {
      open(userData, repo)
    } catch (err) {
      error = err
    }

    expect((error as ProjectStoreError).code).toBe('schemaAhead')
    expect(readFileSync(legacy.projectPath, 'utf-8')).toBe(before)
  })
})
