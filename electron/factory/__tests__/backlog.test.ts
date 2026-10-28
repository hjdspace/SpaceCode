// @vitest-environment node
/**
 * 本地待办：增、改、调序、删除与持久化。
 * 用真实临时仓库验证「写入后重新读取仍在」，而不是复述内存数组。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  backlogFilePath,
  createBacklogItem,
  deleteBacklogItem,
  moveBacklogItem,
  readBacklog,
  updateBacklogItem,
} from '../backlog'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-backlog-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function fixedDeps() {
  let counter = 0
  return {
    now: () => new Date('2026-10-28T10:00:00.000Z'),
    genId: () => `bl-${++counter}`,
  }
}

describe('readBacklog', () => {
  it('returns [] when the file is missing or corrupt', () => {
    expect(readBacklog(dir)).toEqual([])
    mkdirSync(join(dir, '.spacecode/factory'), { recursive: true })
    writeFileSync(backlogFilePath(dir), '{not json', 'utf-8')
    expect(readBacklog(dir)).toEqual([])
  })

  it('ignores malformed entries and sorts by order', () => {
    mkdirSync(join(dir, '.spacecode/factory'), { recursive: true })
    writeFileSync(
      backlogFilePath(dir),
      JSON.stringify([
        { id: 'b', title: 'B', goal: '', createdAt: '2026-01-02T00:00:00Z', order: 1 },
        { nope: true },
        { id: 'a', title: 'A', goal: 'g', createdAt: '2026-01-01T00:00:00Z', order: 0 },
      ]),
      'utf-8',
    )
    expect(readBacklog(dir).map((item) => item.id)).toEqual(['a', 'b'])
  })
})

describe('backlog CRUD', () => {
  it('creates items in order and keeps them after re-reading', () => {
    const deps = fixedDeps()
    createBacklogItem(dir, { title: '第一件事', goal: '目标一' }, deps)
    const result = createBacklogItem(dir, { title: '第二件事' }, deps)

    expect(result.ok).toBe(true)
    expect(result.items.map((item) => item.title)).toEqual(['第一件事', '第二件事'])
    expect(result.items.map((item) => item.order)).toEqual([0, 1])
    expect(result.items[0]).toMatchObject({ goal: '目标一', createdAt: '2026-10-28T10:00:00.000Z' })

    expect(readBacklog(dir)).toEqual(result.items)
    expect(existsSync(backlogFilePath(dir))).toBe(true)
    expect(JSON.parse(readFileSync(backlogFilePath(dir), 'utf-8'))).toHaveLength(2)
  })

  it('rejects an empty title without touching the file', () => {
    const deps = fixedDeps()
    const before = createBacklogItem(dir, { title: '保留我' }, deps)
    const result = createBacklogItem(dir, { title: '   ' }, deps)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toBe('title-required')
    expect(result.items).toEqual(before.ok ? before.items : [])
    expect(readBacklog(dir)).toHaveLength(1)
  })

  it('edits title and goal, and reports a missing id', () => {
    const created = createBacklogItem(dir, { title: '原标题', goal: '原目标' }, fixedDeps())
    if (!created.ok) throw new Error('fixture invalid')
    const id = created.items[0].id

    const updated = updateBacklogItem(dir, { id, title: '新标题', goal: '新目标' })
    expect(updated.ok).toBe(true)
    expect(updated.items[0]).toMatchObject({ id, title: '新标题', goal: '新目标' })

    const missing = updateBacklogItem(dir, { id: 'nope', title: 'x' })
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('expected failure')
    expect(missing.error).toBe('not-found')
    expect(missing.items).toHaveLength(1)
  })

  it('rejects an empty title when editing', () => {
    const created = createBacklogItem(dir, { title: '标题' }, fixedDeps())
    if (!created.ok) throw new Error('fixture invalid')
    const result = updateBacklogItem(dir, { id: created.items[0].id, title: ' ' })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.error).toBe('title-required')
    expect(readBacklog(dir)[0].title).toBe('标题')
  })

  it('moves items up and down and normalizes order', () => {
    const deps = fixedDeps()
    for (const title of ['A', 'B', 'C']) createBacklogItem(dir, { title }, deps)

    const up = moveBacklogItem(dir, 'bl-3', 'up')
    expect(up.items.map((item) => item.title)).toEqual(['A', 'C', 'B'])
    expect(up.items.map((item) => item.order)).toEqual([0, 1, 2])

    const down = moveBacklogItem(dir, 'bl-3', 'down')
    expect(down.items.map((item) => item.title)).toEqual(['A', 'B', 'C'])

    // 边界处移动不报错，也不会改变顺序
    expect(moveBacklogItem(dir, 'bl-1', 'up').items.map((item) => item.title)).toEqual(['A', 'B', 'C'])
    expect(moveBacklogItem(dir, 'bl-3', 'down').items.map((item) => item.title)).toEqual(['A', 'B', 'C'])
  })

  it('deletes items and closes the order gap', () => {
    const deps = fixedDeps()
    for (const title of ['A', 'B', 'C']) createBacklogItem(dir, { title }, deps)

    const result = deleteBacklogItem(dir, 'bl-2')
    expect(result.ok).toBe(true)
    expect(result.items.map((item) => item.title)).toEqual(['A', 'C'])
    expect(result.items.map((item) => item.order)).toEqual([0, 1])
    expect(readBacklog(dir).map((item) => item.id)).toEqual(['bl-1', 'bl-3'])

    const missing = deleteBacklogItem(dir, 'bl-9')
    expect(missing.ok).toBe(false)
    if (missing.ok) throw new Error('expected failure')
    expect(missing.error).toBe('not-found')
  })

  it('persists across a new read after each mutation (restart simulation)', () => {
    const deps = fixedDeps()
    createBacklogItem(dir, { title: '一' }, deps)
    createBacklogItem(dir, { title: '二' }, deps)
    const first = readBacklog(dir)
    updateBacklogItem(dir, { id: first[1].id, title: '二改' })
    moveBacklogItem(dir, first[1].id, 'up')
    expect(readBacklog(dir).map((item) => item.title)).toEqual(['二改', '一'])
  })
})
