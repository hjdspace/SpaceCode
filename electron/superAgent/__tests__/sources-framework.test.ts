// @vitest-environment node
/**
 * Source 框架基础件：游标持久化、坏事件隔离与事件校验（T15 #85）。
 *
 * 只通过公开行为验证：磁盘文件、重启后的游标续读、隔离列表与校验结果。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createSourceCursorStore,
  SOURCE_CURSORS_FILE,
} from '../sources/cursorStore'
import {
  createSourceQuarantine,
  SOURCE_QUARANTINE_FILE,
} from '../sources/quarantine'
import { parseSourceEvent } from '../sources/types'

let roots: string[] = []

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('source cursor store', () => {
  it('returns null for unknown sources and persists cursor across reopen', () => {
    const dir = tempDir('sa-cursor-')
    const store = createSourceCursorStore(dir)
    expect(store.load('feishu-im')).toBeNull()

    store.save('feishu-im', 'cursor-42')
    expect(store.load('feishu-im')).toBe('cursor-42')

    // 重启：新实例从磁盘读回同一游标，续读不重复消费。
    const reopened = createSourceCursorStore(dir)
    expect(reopened.load('feishu-im')).toBe('cursor-42')
  })

  it('overwrites cursors atomically and keeps sources independent', () => {
    const dir = tempDir('sa-cursor-')
    const store = createSourceCursorStore(dir)
    store.save('feishu-im', 'a')
    store.save('github', 'b')
    store.save('feishu-im', 'c')
    expect(store.load('feishu-im')).toBe('c')
    expect(store.load('github')).toBe('b')

    const raw = JSON.parse(readFileSync(join(dir, SOURCE_CURSORS_FILE), 'utf-8'))
    expect(raw.cursors['feishu-im'].cursor).toBe('c')
    expect(raw.cursors['github'].cursor).toBe('b')
  })

  it('survives a corrupt cursor file by starting from the beginning', () => {
    const dir = tempDir('sa-cursor-')
    const store = createSourceCursorStore(dir)
    store.save('feishu-im', 'cursor-1')
    // 模拟半写：手工写入损坏 JSON 后重开。
    writeFileSync(join(dir, SOURCE_CURSORS_FILE), '{broken', 'utf-8')
    const reopened = createSourceCursorStore(dir)
    // 游标文件损坏时从头重读是安全的：事件键幂等保证不会重复建单。
    expect(reopened.load('feishu-im')).toBeNull()
  })
})

describe('source quarantine', () => {
  it('records bad events with source, reason and raw, persists to jsonl and reports them', () => {
    const dir = tempDir('sa-quarantine-')
    const quarantine = createSourceQuarantine(dir)
    quarantine.record('feishu-im', 'missing-key', '{"oops":1}')
    quarantine.record('feishu-im', 'invalid-text', '{"key":"k"}')

    const report = quarantine.report()
    expect(report).toHaveLength(2)
    expect(report[0]).toMatchObject({
      sourceId: 'feishu-im',
      reason: 'missing-key',
      raw: '{"oops":1}',
    })
    expect(typeof report[0].at).toBe('string')

    const lines = readFileSync(join(dir, SOURCE_QUARANTINE_FILE), 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line))
    expect(lines).toHaveLength(2)
    expect(lines[1].reason).toBe('invalid-text')

    // 重启后仍可报告历史隔离项。
    const reopened = createSourceQuarantine(dir)
    expect(reopened.report()).toHaveLength(2)
  })

  it('caps the in-memory report without losing persisted history', () => {
    const dir = tempDir('sa-quarantine-')
    const quarantine = createSourceQuarantine(dir, { reportCap: 3 })
    for (let i = 0; i < 5; i += 1) quarantine.record('feishu-im', 'r', `raw-${i}`)
    const report = quarantine.report()
    expect(report).toHaveLength(3)
    expect(report[0].raw).toBe('raw-2')
    const persisted = readFileSync(join(dir, SOURCE_QUARANTINE_FILE), 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
    expect(persisted).toHaveLength(5)
  })
})

describe('parseSourceEvent', () => {
  const validEvent = {
    key: 'feishu:message:m1',
    source: 'feishu-im',
    threadIds: ['feishu:group:c1'],
    actor: 'feishu:user:u1',
    human: true,
    addressed: null,
    channel: 'feishu:chat:c1',
    url: null,
    text: 'hello',
    at: '2026-01-01T00:00:00.000Z',
    meta: {},
  }

  it('accepts a well-formed event and fills optional defaults', () => {
    const parsed = parseSourceEvent(validEvent)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.event.key).toBe('feishu:message:m1')
      expect(parsed.event.addressed).toBeNull()
      expect(parsed.event.meta).toEqual({})
    }
  })

  it('rejects non-objects, missing or blank keys, blank sources, wrong thread ids', () => {
    expect(parseSourceEvent(null).ok).toBe(false)
    expect(parseSourceEvent('x').ok).toBe(false)
    expect(parseSourceEvent({ ...validEvent, key: '  ' }).ok).toBe(false)
    expect(parseSourceEvent({ ...validEvent, source: '' }).ok).toBe(false)
    expect(parseSourceEvent({ ...validEvent, threadIds: [] }).ok).toBe(false)
    expect(parseSourceEvent({ ...validEvent, threadIds: 'nope' }).ok).toBe(false)
    expect(parseSourceEvent({ ...validEvent, threadIds: [''] }).ok).toBe(false)
  })

  it('rejects bad actor, text, human and addressed fields', () => {
    expect(parseSourceEvent({ ...validEvent, actor: '' }).ok).toBe(false)
    expect(parseSourceEvent({ ...validEvent, text: 42 }).ok).toBe(false)
    expect(parseSourceEvent({ ...validEvent, human: 'yes' }).ok).toBe(false)
    expect(parseSourceEvent({ ...validEvent, addressed: 'shouted' }).ok).toBe(false)
  })

  it('accepts mention/direct addressed and rejects bad timestamps', () => {
    expect(parseSourceEvent({ ...validEvent, addressed: 'mention' }).ok).toBe(true)
    expect(parseSourceEvent({ ...validEvent, addressed: 'direct' }).ok).toBe(true)
    expect(parseSourceEvent({ ...validEvent, meta: { chatType: 'group' } }).ok).toBe(true)
    expect(parseSourceEvent({ ...validEvent, at: 'not-a-date' }).ok).toBe(false)
  })
})
