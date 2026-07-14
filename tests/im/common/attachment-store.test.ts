import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { AttachmentStore } from '@electron/im/adapters/common/attachment/attachment-store'

describe('AttachmentStore', () => {
  let tmpDir: string
  let store: AttachmentStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-attach-'))
    store = new AttachmentStore({ rootDir: tmpDir })
  })

  afterEach(() => {
    store.stopGcTimer()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should save a file and return its path', () => {
    const filePath = store.save('test.png', Buffer.from('data'), 'sess1')
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath).toString()).toBe('data')
  })

  it('should avoid filename collisions', () => {
    const path1 = store.save('test.png', Buffer.from('data1'), 'sess1')
    const path2 = store.save('test.png', Buffer.from('data2'), 'sess1')
    expect(path1).not.toBe(path2)
    expect(fs.readFileSync(path1).toString()).toBe('data1')
    expect(fs.readFileSync(path2).toString()).toBe('data2')
  })

  it('should sanitize dangerous filenames', () => {
    const filePath = store.save('../../etc/passwd', Buffer.from('evil'), 'sess1')
    // The file should be stored within the session directory, not escape rootDir
    const relative = path.relative(tmpDir, filePath)
    expect(relative.startsWith('..')).toBe(false)
  })

  it('resolve() should reject path traversal attempts', () => {
    const resolved = store.resolve('sess1', '../../etc/passwd')
    // Should either return null or return a path within rootDir
    if (resolved !== null) {
      const relative = path.relative(tmpDir, resolved)
      expect(relative.startsWith('..')).toBe(false)
    }
  })

  it('resolve() should return valid path for safe filenames', () => {
    const resolved = store.resolve('sess1', 'test.png')
    expect(resolved).not.toBeNull()
    const relative = path.relative(tmpDir, resolved!)
    expect(relative.startsWith('..')).toBe(false)
  })

  it('delete() should remove files within rootDir', () => {
    const filePath = store.save('test.png', Buffer.from('data'), 'sess1')
    expect(store.delete(filePath)).toBe(true)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('delete() should reject files outside rootDir', () => {
    const outside = path.join(os.tmpdir(), 'outside-test.txt')
    fs.writeFileSync(outside, 'data')
    expect(store.delete(outside)).toBe(false)
    expect(fs.existsSync(outside)).toBe(true)
    fs.unlinkSync(outside)
  })

  it('gc() should remove expired files', () => {
    const filePath = store.save('old.png', Buffer.from('old'), 'sess1')

    // Backdate the file mtime to 25 hours ago
    const oldTime = new Date(Date.now() - 25 * 60 * 60 * 1000)
    fs.utimesSync(filePath, oldTime, oldTime)

    const result = store.gc()
    expect(result.removed).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('gc() should remove .part orphans more aggressively', () => {
    // Create a .part file
    const sessionDir = path.join(tmpDir, 'sess1')
    fs.mkdirSync(sessionDir, { recursive: true })
    const partFile = path.join(sessionDir, 'incomplete.part')
    fs.writeFileSync(partFile, 'partial')

    // Backdate to 11 minutes ago
    const oldTime = new Date(Date.now() - 11 * 60 * 1000)
    fs.utimesSync(partFile, oldTime, oldTime)

    const result = store.gc()
    expect(result.removed).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(partFile)).toBe(false)
  })

  it('gc() should not remove fresh files', () => {
    const filePath = store.save('fresh.png', Buffer.from('fresh'), 'sess1')
    const result = store.gc()
    expect(result.removed).toBe(0)
    expect(fs.existsSync(filePath)).toBe(true)
  })
})
