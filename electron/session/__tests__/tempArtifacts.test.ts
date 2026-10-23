// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  removeSessionArtifacts,
  removeTempFiles,
  sessionTempDir,
  STALE_TEMP_ARTIFACT_MAX_AGE_MS,
  sweepStaleTempArtifacts,
  writeSessionTempFile,
} from '../tempArtifacts'

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-temp-artifacts-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('writeSessionTempFile', () => {
  it('把会话产物写进注入的根目录，每次 spawn 唯一命名', () => {
    const filePath = writeSessionTempFile('sess-1', 'system-prompt', 'PROMPT', root)

    expect(path.dirname(filePath)).toBe(root)
    expect(path.basename(filePath)).toMatch(/^system-prompt-sess-1-\d+-[a-z0-9]+\.txt$/)
    expect(fs.readFileSync(filePath, 'utf8')).toBe('PROMPT')
  })

  it('sessionId 不会逃出临时目录', () => {
    const filePath = writeSessionTempFile('../evil', 'pi-agent', 'body', root)

    expect(path.dirname(filePath)).toBe(root)
    expect(path.basename(filePath)).toMatch(/^pi-agent-___evil-\d+-[a-z0-9]+\.md$/)
  })

  it('settings / mcp 沿用带时间戳的命名', () => {
    const settings = writeSessionTempFile('sess-1', 'settings', '{}', root)
    const mcp = writeSessionTempFile('sess-1', 'mcp', '{}', root)

    expect(path.basename(settings)).toMatch(/^settings-\d+-[a-z0-9]+\.json$/)
    expect(path.basename(mcp)).toMatch(/^mcp-sess-1-\d+-[a-z0-9]+\.json$/)
  })
})

describe('removeTempFiles', () => {
  it('重复删除或不存在的路径都不抛', () => {
    const filePath = writeSessionTempFile('sess-1', 'pi-agent', 'body', root)

    removeTempFiles([filePath])
    expect(fs.existsSync(filePath)).toBe(false)
    expect(() => removeTempFiles([filePath, path.join(root, 'missing.txt')])).not.toThrow()
  })
})

describe('removeSessionArtifacts', () => {
  it('只删该会话的产物，保留 per-spawn 的 settings/mcp 与其它会话', () => {
    const fixed = [
      writeSessionTempFile('sess-1', 'system-prompt', 'p', root),
      writeSessionTempFile('sess-1', 'pi-agent', 'p', root),
      writeSessionTempFile('sess-1', 'side-task-context', 'p', root),
    ]
    const settings = writeSessionTempFile('sess-1', 'settings', '{}', root)
    const otherSession = writeSessionTempFile('sess-2', 'system-prompt', 'p', root)
    const legacy = path.join(root, 'system-prompt-sess-1.txt')
    fs.writeFileSync(legacy, 'old')

    removeSessionArtifacts('sess-1', root)

    for (const filePath of fixed) expect(fs.existsSync(filePath)).toBe(false)
    expect(fs.existsSync(legacy)).toBe(false)
    expect(fs.existsSync(settings)).toBe(true)
    expect(fs.existsSync(otherSession)).toBe(true)
  })
})

describe('sweepStaleTempArtifacts', () => {
  it('只删超龄的已知前缀文件，保留新文件、未知文件与目录', () => {
    const old = writeSessionTempFile('sess-old', 'system-prompt', 'x', root)
    const fresh = writeSessionTempFile('sess-fresh', 'pi-agent', 'x', root)
    const unknown = path.join(root, 'notes.txt')
    const dirWithKnownPrefix = path.join(root, 'settings-not-a-file')
    fs.writeFileSync(unknown, 'keep')
    fs.mkdirSync(dirWithKnownPrefix)

    const oldTime = new Date(Date.now() - STALE_TEMP_ARTIFACT_MAX_AGE_MS - 60_000)
    fs.utimesSync(old, oldTime, oldTime)

    expect(sweepStaleTempArtifacts(STALE_TEMP_ARTIFACT_MAX_AGE_MS, root)).toEqual({
      removed: 1,
      failed: 0,
    })
    expect(fs.existsSync(old)).toBe(false)
    expect(fs.existsSync(fresh)).toBe(true)
    expect(fs.existsSync(unknown)).toBe(true)
    expect(fs.existsSync(dirWithKnownPrefix)).toBe(true)
  })

  it('目录不存在时静默返回空结果', () => {
    expect(sweepStaleTempArtifacts(1000, path.join(root, 'missing'))).toEqual({
      removed: 0,
      failed: 0,
    })
  })
})

describe('sessionTempDir', () => {
  it('固定落在系统临时目录下，并按 uid 分目录', () => {
    const uid = typeof process.getuid === 'function' ? process.getuid() : null
    const expected = path.join(os.tmpdir(), uid === null ? 'SpaceCode' : `SpaceCode-${uid}`)
    expect(sessionTempDir()).toBe(expected)
  })
})
