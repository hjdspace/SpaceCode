// @vitest-environment node
/**
 * 检查点（T12 #82）：每轮启动前保存 HEAD/status/untracked/diff，
 * 只支持人工按文件显式回退（不是隔离边界）。
 *
 * 覆盖验收：
 *  - 保存检查点（head、porcelain 清单、diff patch）并按 repoRoot 保留最新一份；
 *  - 按文件回退：worker 新增的 untracked 文件 → 删除；改动/删除的 tracked 文件 → 还原到检查点 HEAD；
 *  - 检查点前已脏的文件（用户自己的改动）拒绝回退（dirty-at-checkpoint）；
 *  - 当前已干净的文件跳过（clean）；
 *  - 无检查点 → checkpointUnavailable；路径越界/非法 → checkpointInvalidFile；
 *  - git 失败 → checkpointRollbackFailed。
 */
import { describe, expect, it } from 'vitest'
import { createCheckpointStore } from '../checkpoint'
import type { GitCommandRunner } from '../workspace'
import type { SuperAgentWorkspaceStatus } from '../workspace'

const AT = '2026-01-01T00:00:00.000Z'

function makeWorkspace(overrides: Partial<SuperAgentWorkspaceStatus> = {}): SuperAgentWorkspaceStatus {
  return {
    dirty: true,
    statusText: '',
    head: 'abc123',
    entries: [],
    ...overrides,
  }
}

interface Harness {
  store: ReturnType<typeof createCheckpointStore>
  commands: { cwd: string; args: string[] }[]
  existing: Set<string>
}

/** git 命令假实现：记录命令，模拟 status/diff/checkout 行为。 */
function makeHarness(initialStatus: string, options: { patch?: string } = {}): Harness {
  const commands: { cwd: string; args: string[] }[] = []
  const deleted = new Set<string>()
  const run: GitCommandRunner = async (args, cwd) => {
    commands.push({ args, cwd })
    if (args[0] === 'status') return initialStatus
    if (args[0] === 'diff') return options.patch ?? ''
    if (args[0] === 'checkout') {
      // git checkout <head> -- <file>：模拟还原 tracked 文件
      const file = args[3]
      deleted.delete(file)
      return ''
    }
    return ''
  }
  const existing = new Set<string>(['D:/repo/src/keep.ts'])
  const store = createCheckpointStore({
    run,
    now: () => new Date(AT),
    removeFile: async (p) => {
      deleted.add(p)
    },
    fileExists: async (p) => existing.has(p) && !deleted.has(p),
  })
  return { store, commands, existing }
}

describe('checkpoint save', () => {
  it('saves head, porcelain entries and diff patch per repoRoot (latest wins)', async () => {
    const h = makeHarness(' M src/a.ts\n?? src/new.ts\n', { patch: 'diff --git a/src/a.ts …' })
    await h.store.save('D:/repo', makeWorkspace({ statusText: ' M src/a.ts\n?? src/new.ts\n' }))
    const cp = h.store.latest('D:/repo')
    expect(cp).toMatchObject({
      repoRoot: 'D:/repo',
      savedAt: AT,
      head: 'abc123',
      entries: ['src/a.ts', 'src/new.ts'],
      statusText: ' M src/a.ts\n?? src/new.ts\n',
      patch: 'diff --git a/src/a.ts …',
    })
  })

  it('parses rename entries to the destination path', async () => {
    const h = makeHarness('R  src/old.ts -> src/new.ts\n')
    await h.store.save('D:/repo', makeWorkspace({ statusText: 'R  src/old.ts -> src/new.ts\n' }))
    expect(h.store.latest('D:/repo')?.entries).toEqual(['src/new.ts'])
  })
})

describe('checkpoint rollbackFiles', () => {
  it('deletes files the worker added (untracked now) and restores modified tracked files', async () => {
    // 检查点时干净；现在 worker 新增 src/new.ts、修改 src/a.ts、删除 src/gone.ts
    const h = makeHarness(' M src/a.ts\n?? src/new.ts\n D src/gone.ts\n')
    await h.store.save('D:/repo', makeWorkspace({ statusText: '' }))

    const result = await h.store.rollbackFiles('D:/repo', ['src/new.ts', 'src/a.ts', 'src/gone.ts'])
    expect(result.rolled.sort()).toEqual(['src/a.ts', 'src/gone.ts', 'src/new.ts'])
    expect(result.skipped).toEqual([])
    // untracked → 删除；tracked → checkout 检查点 HEAD
    const checkout = h.commands.filter((c) => c.args[0] === 'checkout')
    expect(checkout.map((c) => c.args[3]).sort()).toEqual(['src/a.ts', 'src/gone.ts'])
  })

  it('refuses rollback for files that were already dirty at checkpoint time', async () => {
    const h = makeHarness(' M src/a.ts\n')
    await h.store.save('D:/repo', makeWorkspace({ statusText: ' M src/a.ts\n' }))
    const result = await h.store.rollbackFiles('D:/repo', ['src/a.ts'])
    expect(result.rolled).toEqual([])
    expect(result.skipped).toEqual([{ file: 'src/a.ts', reason: 'dirty-at-checkpoint' }])
  })

  it('skips files that are currently clean (nothing to roll back)', async () => {
    const h = makeHarness('')
    await h.store.save('D:/repo', makeWorkspace({ statusText: '' }))
    const result = await h.store.rollbackFiles('D:/repo', ['src/a.ts'])
    expect(result).toEqual({ rolled: [], skipped: [{ file: 'src/a.ts', reason: 'clean' }] })
  })

  it('throws checkpointUnavailable when no checkpoint exists for the repoRoot', async () => {
    const h = makeHarness('')
    await expect(h.store.rollbackFiles('D:/repo', ['src/a.ts'])).rejects.toThrowError(
      expect.objectContaining({ code: 'checkpointUnavailable' }),
    )
  })

  it('throws checkpointInvalidFile for empty, absolute or traversing paths', async () => {
    const h = makeHarness('')
    await h.store.save('D:/repo', makeWorkspace({ statusText: '' }))
    for (const bad of ['', '/abs/path.ts', 'C:/x.ts', '../escape.ts', 'a/../b.ts']) {
      await expect(h.store.rollbackFiles('D:/repo', [bad])).rejects.toThrowError(
        expect.objectContaining({ code: 'checkpointInvalidFile' }),
      )
    }
  })

  it('throws checkpointRollbackFailed when git checkout fails', async () => {
    const commands: { cwd: string; args: string[] }[] = []
    const run: GitCommandRunner = async (args, cwd) => {
      commands.push({ args, cwd })
      if (args[0] === 'checkout') throw new Error('boom')
      if (args[0] === 'status') return ' M src/a.ts\n'
      return ''
    }
    const store = createCheckpointStore({ run, now: () => new Date(AT), removeFile: async () => {} })
    await store.save('D:/repo', makeWorkspace({ statusText: '' }))
    await expect(store.rollbackFiles('D:/repo', ['src/a.ts'])).rejects.toThrowError(
      expect.objectContaining({ code: 'checkpointRollbackFailed' }),
    )
  })
})
