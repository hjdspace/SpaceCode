import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { Db, SCHEMA_VERSION } from '../db'

// ── Test helpers ───────────────────────────────────────────────────

let tmpDir: string
let dbPath: string
let db: Db

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-db-test-'))
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Db', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir()
    dbPath = path.join(tmpDir, 'test.db')
    db = Db.open(dbPath)
  })

  afterEach(() => {
    db.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('open', () => {
    it('creates the database file', () => {
      expect(fs.existsSync(dbPath)).toBe(true)
    })

    it('creates parent directory if it does not exist', () => {
      db.close()
      const nestedPath = path.join(tmpDir, 'nested', 'dir', 'test.db')
      db = Db.open(nestedPath)
      expect(fs.existsSync(nestedPath)).toBe(true)
    })
  })

  describe('schema', () => {
    it('creates all 10 core tables', () => {
      const tables = db.listTables()
      // Filter out sqlite internal tables
      const userTables = tables.filter((t) => !t.startsWith('sqlite_'))
      expect(userTables).toContain('skills')
      expect(userTables).toContain('skill_sources')
      expect(userTables).toContain('agents')
      expect(userTables).toContain('skill_targets')
      expect(userTables).toContain('skill_target_claims')
      expect(userTables).toContain('skill_packs')
      expect(userTables).toContain('skill_pack_members')
      expect(userTables).toContain('unmanaged_items')
      expect(userTables).toContain('diagnosis_issues')
      expect(userTables).toContain('settings')
      expect(userTables).toContain('schema_migrations')
      expect(userTables.length).toBeGreaterThanOrEqual(11)
    })

    it('records schema version 4 in schema_migrations', () => {
      expect(db.appliedVersion()).toBe(SCHEMA_VERSION)
      expect(SCHEMA_VERSION).toBe(4)
    })

    it('enables foreign keys', () => {
      const result = db.conn.pragma('foreign_keys', { simple: true })
      expect(result).toBe(1)
    })
  })

  describe('settings', () => {
    it('returns empty object when no settings saved', () => {
      const settings = db.loadSettingsJson()
      expect(Object.keys(settings).length).toBe(0)
    })

    it('saves and loads settings', () => {
      db.saveSettingsJson({ defaultInstallMode: 'link', linkFailPolicy: 'copy' })
      const settings = db.loadSettingsJson()
      expect(settings['defaultInstallMode']).toBe('link')
      expect(settings['linkFailPolicy']).toBe('copy')
    })

    it('overwrites settings on re-save', () => {
      db.saveSettingsJson({ defaultInstallMode: 'link' })
      db.saveSettingsJson({ defaultInstallMode: 'copy' })
      const settings = db.loadSettingsJson()
      expect(settings['defaultInstallMode']).toBe('copy')
    })
  })

  describe('transaction', () => {
    it('commits changes on success', () => {
      db.transaction((tx) => {
        tx.prepare(
          "INSERT INTO settings(key, value) VALUES('test-key', 'test-value')"
        ).run()
      })
      const row = db.conn.prepare("SELECT value FROM settings WHERE key = 'test-key'").get() as { value: string }
      expect(row.value).toBe('test-value')
    })

    it('rolls back on error', () => {
      expect(() => {
        db.transaction((tx) => {
          tx.prepare(
            "INSERT INTO settings(key, value) VALUES('rollback-test', 'value1')"
          ).run()
          throw new Error('intentional error')
        })
      }).toThrow()

      const row = db.conn.prepare("SELECT value FROM settings WHERE key = 'rollback-test'").get() as { value: string } | undefined
      expect(row).toBeUndefined()
    })
  })

  describe('idempotent migrations', () => {
    it('does not error when opening an already-migrated database', () => {
      db.close()
      // Reopen the same database
      db = Db.open(dbPath)
      expect(db.appliedVersion()).toBe(SCHEMA_VERSION)
    })
  })
})
