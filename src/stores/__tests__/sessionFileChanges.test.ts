/**
 * sessionFileChanges store 测试。
 *
 * 两条外部依赖都用 mock 隔开：scm 只提供 git 的 +/- 数字（真实实现要在主进程跑
 * git），app 只提供项目根。账本用真实 store —— "本会话归属 × 谁最后写入"这两套
 * 信息如何互相裁决，正是这个 store 的行为核心，mock 掉它就测不到东西了。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import type { Message, ToolCall } from '@/types'

const mocks = vi.hoisted(() => ({
  fileStats: {} as Record<string, { additions: number | null; deletions: number | null }>,
}))

vi.mock('@/stores/scm', () => ({
  useScmStore: () => ({ fileStats: mocks.fileStats }),
}))
vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ projectRoot: 'D:/repo' }),
}))

import { useSessionFileChangesStore } from '@/stores/sessionFileChanges'
import { useFileWriteLedgerStore } from '@/stores/fileWriteLedger'

const ROOT = 'D:/repo'

function assistant(toolCalls: ToolCall[], extra: Partial<Message> = {}): Message {
  return { id: `m-${toolCalls.length}-${Math.random()}`, role: 'assistant', content: '', timestamp: 1, toolCalls, ...extra } as unknown as Message
}

function call(name: string, path: string, overrides: Partial<ToolCall> = {}): ToolCall {
  return { id: `${name}-${path}`, name, input: { file_path: path }, status: 'completed', ...overrides }
}

function commandMessage(paths: string[], at: number): Message {
  return assistant([], { metadata: { commandFiles: paths.map(path => ({ path, at })) } })
}

describe('sessionFileChanges store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    for (const key of Object.keys(mocks.fileStats)) delete mocks.fileStats[key]
  })

  it('按 sessionId 键控：一个会话的同步不影响另一个会话', () => {
    const store = useSessionFileChangesStore()

    store.syncSession('s1', [assistant([call('Edit', `${ROOT}/a.ts`)])], { projectRoot: ROOT })
    store.syncSession('s2', [assistant([call('Write', `${ROOT}/b.ts`)])], { projectRoot: ROOT })

    expect(store.summaryFor('s1').files.map(f => f.path)).toEqual(['a.ts'])
    expect(store.summaryFor('s2').files.map(f => f.path)).toEqual(['b.ts'])

    store.clearSession('s1')
    expect(store.summaryFor('s1').sessionCount).toBe(0)
    expect(store.summaryFor('s2').sessionCount).toBe(1)
  })

  it('从 git 数字合并 +/-，未提交集合里查不到的标为 not dirty', () => {
    const store = useSessionFileChangesStore()
    mocks.fileStats['a.ts'] = { additions: 12, deletions: 3 }

    store.syncSession('s1', [
      assistant([call('Edit', `${ROOT}/a.ts`), call('Write', `${ROOT}/gone.ts`)]),
    ], { projectRoot: ROOT })

    const summary = store.summaryFor('s1')
    const a = summary.files.find(f => f.path === 'a.ts')!
    const gone = summary.files.find(f => f.path === 'gone.ts')!

    expect(a.insertions).toBe(12)
    expect(a.deletions).toBe(3)
    expect(a.stillDirty).toBe(true)
    expect(gone.insertions).toBe(0)
    expect(gone.stillDirty).toBe(false)
  })

  it('悬浮条口径：turn 给最近一轮，session 给累计', () => {
    const store = useSessionFileChangesStore()
    mocks.fileStats['a.ts'] = { additions: 1, deletions: 0 }
    mocks.fileStats['b.ts'] = { additions: 2, deletions: 4 }

    store.syncSession('s1', [
      assistant([call('Edit', `${ROOT}/a.ts`)]),
      assistant([call('Edit', `${ROOT}/b.ts`)]),
    ], { projectRoot: ROOT })

    const summary = store.summaryFor('s1')
    expect(summary.turn).toBe(2)
    expect(summary.turnCount).toBe(1)
    expect(summary.turnAdditions).toBe(2)
    expect(summary.turnDeletions).toBe(4)
    expect(summary.sessionCount).toBe(2)
    expect(summary.sessionAdditions).toBe(3)
    expect(summary.sessionDeletions).toBe(4)
  })

  it('groupedFor 把最近一轮与更早轮次分开，同一文件不重复出现在两组', () => {
    const store = useSessionFileChangesStore()
    store.syncSession('s1', [
      assistant([call('Edit', `${ROOT}/old.ts`)]),
      assistant([call('Edit', `${ROOT}/new.ts`), call('Edit', `${ROOT}/old.ts`)]),
    ], { projectRoot: ROOT })

    const groups = store.groupedFor('s1')
    expect(groups.current.map(f => f.path).sort()).toEqual(['new.ts', 'old.ts'])
    expect(groups.earlier).toHaveLength(0)
    expect(store.summaryFor('s1').sessionCount).toBe(2)
  })

  it('回合窗口观测到的文件按 command 归属列出', () => {
    const store = useSessionFileChangesStore()
    mocks.fileStats['generated/report.xlsx'] = { additions: 40, deletions: 0 }

    store.syncSession('s1', [
      assistant([call('Bash', `${ROOT}/ignored.ts`)]),
      commandMessage(['generated/report.xlsx'], 5000),
    ], { projectRoot: ROOT })

    const row = store.summaryFor('s1').files.find(f => f.path === 'generated/report.xlsx')!
    expect(row.origin).toBe('command')
    expect(row.insertions).toBe(40)
  })

  it('工具事件点名的文件优先于窗口观测，不会因为观测顺序掉置信度', () => {
    const store = useSessionFileChangesStore()

    store.syncSession('s1', [
      commandMessage(['a.ts'], 2000),
      assistant([call('Edit', `${ROOT}/a.ts`)], { timestamp: 3000 }),
    ], { projectRoot: ROOT })

    const files = store.summaryFor('s1').files
    expect(files).toHaveLength(1)
    expect(files[0].origin).toBe('direct')
  })

  it('别的会话在我之后写过：direct 行保留并标记，command 行剔除', () => {
    const store = useSessionFileChangesStore()
    const ledger = useFileWriteLedgerStore()
    const messages = [
      assistant([call('Edit', `${ROOT}/mine.ts`)]),
      commandMessage(['theirs.ts'], 5000),
    ]

    // 本会话写过 mine.ts，随后另一个会话又写了这两个文件
    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's1', toolName: 'Edit', input: { file_path: `${ROOT}/mine.ts` } }, 1000)
    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's2', toolName: 'Edit', input: { file_path: `${ROOT}/mine.ts` } }, 9000)
    ledger.recordToolWrite({ projectRoot: ROOT, sessionId: 's2', toolName: 'Edit', input: { file_path: `${ROOT}/theirs.ts` } }, 9000)

    store.syncSession('s1', messages, { projectRoot: ROOT })

    const paths = store.summaryFor('s1').files.map(f => f.path)
    expect(paths).toContain('mine.ts')
    expect(paths).not.toContain('theirs.ts')

    const mine = store.summaryFor('s1').files.find(f => f.path === 'mine.ts')!
    // s2 的 9000 晚于我这次的写入时间，但账本里我的记录已被覆盖 → 只作为提示标记
    expect(mine.external).toBe(true)
  })

  it('空历史与未知会话都返回空摘要而不是抛错', () => {
    const store = useSessionFileChangesStore()
    expect(store.summaryFor('nope')).toEqual({
      files: [],
      sessionCount: 0,
      sessionAdditions: 0,
      sessionDeletions: 0,
      turn: 0,
      turnCount: 0,
      turnAdditions: 0,
      turnDeletions: 0,
    })
    store.syncSession('s1', [], { projectRoot: ROOT })
    expect(store.summaryFor('s1').sessionCount).toBe(0)
  })
})
