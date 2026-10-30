// @vitest-environment node
/**
 * 原子写：Windows 上 rename 会被杀软/索引器瞬时占锁并返回 EPERM，
 * 必须退避重试而不是让整次运行写盘直接失败。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeJsonAtomic } from '../atomic'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-atomic-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function tmpLeftovers(): string[] {
  return readdirSync(dir).filter((name) => name.includes('.tmp-'))
}

function codedError(code: string): NodeJS.ErrnoException {
  const err = new Error(`${code}: mock failure`) as NodeJS.ErrnoException
  err.code = code
  return err
}

describe('writeJsonAtomic', () => {
  it('writes the JSON and leaves no temp file behind', () => {
    const path = join(dir, 'nested', 'run.json')

    writeJsonAtomic(path, { id: 'run-1', status: 'pending' })

    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ id: 'run-1', status: 'pending' })
    expect(tmpLeftovers()).toEqual([])
  })

  it('retries rename after a transient EPERM and succeeds', () => {
    const path = join(dir, 'run.json')
    const delays: number[] = []
    let calls = 0

    writeJsonAtomic(path, { ok: true }, {
      rename: (from, to) => {
        calls += 1
        if (calls < 3) throw codedError('EPERM')
        renameSync(from, to)
      },
      sleep: (ms) => delays.push(ms),
    })

    expect(calls).toBe(3)
    expect(delays).toEqual([10, 20])
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ ok: true })
    expect(tmpLeftovers()).toEqual([])
  })

  it('does not retry errors that cannot be transient', () => {
    const path = join(dir, 'run.json')
    let calls = 0

    expect(() =>
      writeJsonAtomic(path, { ok: true }, {
        rename: () => {
          calls += 1
          throw codedError('ENOENT')
        },
        sleep: () => {},
      }),
    ).toThrow(/ENOENT/)

    expect(calls).toBe(1)
    expect(tmpLeftovers()).toEqual([])
  })

  it('gives up after the retry budget and cleans the temp file', () => {
    const path = join(dir, 'run.json')
    let calls = 0

    expect(() =>
      writeJsonAtomic(path, { ok: true }, {
        rename: () => {
          calls += 1
          throw codedError('EPERM')
        },
        sleep: () => {},
      }),
    ).toThrow(/EPERM/)

    expect(calls).toBe(6)
    expect(readdirSync(dir)).toEqual([])
  })
})
