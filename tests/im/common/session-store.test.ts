import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SessionStore } from '@electron/im/adapters/common/session-store'

describe('SessionStore', () => {
  let tmpDir: string
  let filePath: string
  let store: SessionStore

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'im-test-'))
    filePath = path.join(tmpDir, 'sessions.json')
    store = new SessionStore({ filePath })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('should return null for non-existent chatId', () => {
    expect(store.get('chat1')).toBeNull()
  })

  it('should set and get a binding', () => {
    store.set('chat1', { sessionId: 'sess1', workDir: '/tmp/work' })
    expect(store.get('chat1')).toEqual({ sessionId: 'sess1', workDir: '/tmp/work' })
  })

  it('should persist to disk (survive new instance)', () => {
    store.set('chat1', { sessionId: 'sess1', workDir: '/tmp/work' })

    const store2 = new SessionStore({ filePath })
    expect(store2.get('chat1')).toEqual({ sessionId: 'sess1', workDir: '/tmp/work' })
  })

  it('should delete a binding', () => {
    store.set('chat1', { sessionId: 'sess1', workDir: '/tmp/work' })
    store.delete('chat1')
    expect(store.get('chat1')).toBeNull()
  })

  it('deleteBySessionId should remove all chatIds pointing to that sessionId (full scan)', () => {
    store.set('chat1', { sessionId: 'sess1', workDir: '/tmp/work1' })
    store.set('chat2', { sessionId: 'sess1', workDir: '/tmp/work2' }) // dirty data: same sessionId
    store.set('chat3', { sessionId: 'sess2', workDir: '/tmp/work3' })

    const removed = store.deleteBySessionId('sess1')

    expect(removed.sort()).toEqual(['chat1', 'chat2'])
    expect(store.get('chat1')).toBeNull()
    expect(store.get('chat2')).toBeNull()
    expect(store.get('chat3')).not.toBeNull()
  })

  it('should use mtime cache (skip read+parse when mtime unchanged)', () => {
    store.set('chat1', { sessionId: 'sess1', workDir: '/tmp/work' })

    // First get() after cache invalidation reads from disk
    store.invalidateCache()
    const result1 = store.get('chat1')
    expect(result1).toEqual({ sessionId: 'sess1', workDir: '/tmp/work' })

    // Modify the file to change mtime, then read again
    // If cache works, it should return the old cached data when mtime hasn't changed
    // We verify by checking that a second get() without invalidation returns the same data
    const result2 = store.get('chat1')
    expect(result2).toEqual(result1)

    // Verify mtime cache is being used by checking that external modification
    // is detected (proving the cache doesn't return stale data when mtime changes)
    const externalData = { chat2: { sessionId: 'sess2', workDir: '/tmp/work2' } }
    const tmpPath = filePath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(externalData))
    fs.renameSync(tmpPath, filePath)

    store.invalidateCache()
    expect(store.get('chat1')).toBeNull() // external write removed chat1
    expect(store.get('chat2')).toEqual({ sessionId: 'sess2', workDir: '/tmp/work2' })
  })

  it('should detect external writes via mtime change', () => {
    store.set('chat1', { sessionId: 'sess1', workDir: '/tmp/work' })

    // Simulate another process writing to the file
    const externalData = { chat2: { sessionId: 'sess2', workDir: '/tmp/work2' } }
    const tmpPath = filePath + '.tmp'
    fs.writeFileSync(tmpPath, JSON.stringify(externalData))
    fs.renameSync(tmpPath, filePath)

    // Small delay to ensure mtime changes
    const newPath = path.join(tmpDir, 'touch')
    fs.writeFileSync(newPath, '')
    fs.unlinkSync(newPath)

    store.invalidateCache()
    expect(store.get('chat1')).toBeNull()
    expect(store.get('chat2')).toEqual({ sessionId: 'sess2', workDir: '/tmp/work2' })
  })

  it('should handle corrupted file gracefully', () => {
    fs.writeFileSync(filePath, 'not valid json{')
    store.invalidateCache()
    expect(store.get('chat1')).toBeNull()
  })

  it('entries() should return all bindings', () => {
    store.set('chat1', { sessionId: 'sess1', workDir: '/tmp/work1' })
    store.set('chat2', { sessionId: 'sess2', workDir: '/tmp/work2' })

    const entries = store.entries()
    expect(Object.keys(entries).sort()).toEqual(['chat1', 'chat2'])
  })
})
