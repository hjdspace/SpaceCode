/**
 * Skill Manager V2 — Slice 2 Tests
 *
 * Tests for getSkillDetail, previewDeleteCenterSkill, executeDeleteCenterSkill.
 * TDD: written before implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SkillManagerService } from '../service'
import { setHomeOverride } from '../fsutil'

// ── Test helpers ───────────────────────────────────────────────────

let tmpDir: string
let centerPath: string
let dbPath: string
let service: SkillManagerService

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-slice2-test-'))
}

function createSkillDir(parentDir: string, name: string, skillName?: string, description?: string): string {
  const dir = path.join(parentDir, name)
  const desc = description ?? 'A test skill'
  const content = skillName
    ? `---\nname: ${skillName}\ndescription: ${desc}\n---\n# ${skillName}`
    : `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content)
  return dir
}

// ── Tests ──────────────────────────────────────────────────────────

describe('SkillManagerService — Slice 2', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir()
    setHomeOverride(path.join(tmpDir, 'home'))
    centerPath = path.join(tmpDir, 'skills')
    dbPath = path.join(tmpDir, 'skill-manager', 'test.db')
    service = SkillManagerService.bootstrap(dbPath, centerPath)
  })

  afterEach(() => {
    setHomeOverride(null)
    service.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── getSkillDetail ──────────────────────────────────────────────

  describe('getSkillDetail', () => {
    it('returns full detail for a known skill', () => {
      createSkillDir(centerPath, 'my-skill', 'My Skill', 'Test description')
      service.refresh()

      const detail = service.getSkillDetail('my-skill')
      expect(detail).not.toBeNull()
      expect(detail!.id).toBe('my-skill')
      expect(detail!.name).toBe('My Skill')
      expect(detail!.description).toBe('Test description')
      expect(detail!.centerPath).toBe(path.join(centerPath, 'my-skill'))
      expect(detail!.currentHash).toBeTruthy()
      expect(detail!.frontmatterJson).toContain('My Skill')
    })

    it('returns null for unknown skill id', () => {
      const detail = service.getSkillDetail('non-existent')
      expect(detail).toBeNull()
    })

    it('includes source when present', () => {
      createSkillDir(centerPath, 'sourced-skill', 'Sourced Skill')
      service.refresh()

      // Manually insert a source record
      const db = service.getDb()
      const now = new Date().toISOString()
      db.conn.prepare(`
        INSERT INTO skill_sources (skill_id, source_type, source_uri, source_ref, imported_from_agent, imported_from_path, installed_via, created_at, updated_at)
        VALUES (?, 'local_folder', ?, NULL, NULL, ?, 'manual', ?, ?)
      `).run('sourced-skill', '/some/path', '/some/path', now, now)

      const detail = service.getSkillDetail('sourced-skill')
      expect(detail).not.toBeNull()
      expect(detail!.source).not.toBeNull()
      expect(detail!.source!.sourceType).toBe('local_folder')
      expect(detail!.source!.sourceUri).toBe('/some/path')
    })

    it('returns null source when no source record exists', () => {
      createSkillDir(centerPath, 'no-source-skill', 'No Source Skill')
      service.refresh()

      const detail = service.getSkillDetail('no-source-skill')
      expect(detail).not.toBeNull()
      expect(detail!.source).toBeNull()
    })

    it('includes empty targets array when no targets exist', () => {
      createSkillDir(centerPath, 'no-targets-skill', 'No Targets Skill')
      service.refresh()

      const detail = service.getSkillDetail('no-targets-skill')
      expect(detail).not.toBeNull()
      expect(detail!.targets).toEqual([])
    })

    it('includes empty claims array when no claims exist', () => {
      createSkillDir(centerPath, 'no-claims-skill', 'No Claims Skill')
      service.refresh()

      const detail = service.getSkillDetail('no-claims-skill')
      expect(detail).not.toBeNull()
      expect(detail!.claims).toEqual([])
    })

    it('includes file tree from center path', () => {
      const skillDir = createSkillDir(centerPath, 'tree-skill', 'Tree Skill')
      fs.writeFileSync(path.join(skillDir, 'extra.md'), '# Extra')
      fs.mkdirSync(path.join(skillDir, 'subdir'), { recursive: true })
      fs.writeFileSync(path.join(skillDir, 'subdir', 'nested.md'), '# Nested')
      service.refresh()

      const detail = service.getSkillDetail('tree-skill')
      expect(detail).not.toBeNull()
      expect(detail!.files).not.toBeNull()
      expect(detail!.files!.nodeType).toBe('dir')
      // Should contain SKILL.md, extra.md, and subdir
      const childNames = detail!.files!.children!.map((c) => c.name)
      expect(childNames).toContain('SKILL.md')
      expect(childNames).toContain('extra.md')
      expect(childNames).toContain('subdir')
    })

    it('includes lastScannedAt', () => {
      createSkillDir(centerPath, 'scanned-skill', 'Scanned Skill')
      service.refresh()

      const detail = service.getSkillDetail('scanned-skill')
      expect(detail).not.toBeNull()
      expect(detail!.lastScannedAt).not.toBeNull()
    })
  })

  // ── previewDeleteCenterSkill ────────────────────────────────────

  describe('previewDeleteCenterSkill', () => {
    it('returns preview with skill info and no affected targets', () => {
      createSkillDir(centerPath, 'delete-me', 'Delete Me')
      service.refresh()

      const preview = service.previewDeleteCenterSkill('delete-me')
      expect(preview).not.toBeNull()
      expect(preview!.skillId).toBe('delete-me')
      expect(preview!.skillName).toBe('Delete Me')
      expect(preview!.affectedTargets).toEqual([])
    })

    it('returns null for unknown skill id', () => {
      const preview = service.previewDeleteCenterSkill('non-existent')
      expect(preview).toBeNull()
    })

    it('includes affected targets when skill has targets', () => {
      createSkillDir(centerPath, 'with-targets', 'With Targets')
      service.refresh()

      // Manually insert a target
      const db = service.getDb()
      const now = new Date().toISOString()
      db.conn.prepare(`
        INSERT INTO skill_targets (id, skill_id, agent_id, target_path, install_mode, actual_mode, source_hash, current_hash, status, created_at, updated_at)
        VALUES (?, 'with-targets', 'claude-code', ?, 'link', 'link', 'fake-hash', NULL, 'ok', ?, ?)
      `).run('target-1', '/fake/target/path', now, now)

      const preview = service.previewDeleteCenterSkill('with-targets')
      expect(preview).not.toBeNull()
      expect(preview!.affectedTargets.length).toBe(1)
      expect(preview!.affectedTargets[0].agentId).toBe('claude-code')
      expect(preview!.affectedTargets[0].targetPath).toBe('/fake/target/path')
    })
  })

  // ── executeDeleteCenterSkill ────────────────────────────────────

  describe('executeDeleteCenterSkill', () => {
    it('removes skill from DB', () => {
      createSkillDir(centerPath, 'delete-db', 'Delete DB')
      service.refresh()

      // Verify it exists
      expect(service.listCenterSkills().some((s) => s.id === 'delete-db')).toBe(true)

      service.executeDeleteCenterSkill('delete-db')

      // Verify it's gone
      expect(service.listCenterSkills().some((s) => s.id === 'delete-db')).toBe(false)
    })

    it('removes skill directory from filesystem', () => {
      const skillDir = createSkillDir(centerPath, 'delete-fs', 'Delete FS')
      service.refresh()

      expect(fs.existsSync(skillDir)).toBe(true)

      service.executeDeleteCenterSkill('delete-fs')

      expect(fs.existsSync(skillDir)).toBe(false)
    })

    it('removes associated skill_sources record', () => {
      createSkillDir(centerPath, 'delete-source', 'Delete Source')
      service.refresh()

      // Add a source record
      const db = service.getDb()
      const now = new Date().toISOString()
      db.conn.prepare(`
        INSERT INTO skill_sources (skill_id, source_type, source_uri, source_ref, imported_from_agent, imported_from_path, installed_via, created_at, updated_at)
        VALUES (?, 'manual_center', NULL, NULL, NULL, NULL, 'manual', ?, ?)
      `).run('delete-source', now, now)

      service.executeDeleteCenterSkill('delete-source')

      const sources = db.conn.prepare('SELECT * FROM skill_sources WHERE skill_id = ?').all('delete-source')
      expect(sources.length).toBe(0)
    })

    it('removes associated skill_targets records', () => {
      createSkillDir(centerPath, 'delete-targets', 'Delete Targets')
      service.refresh()

      // Add a target
      const db = service.getDb()
      const now = new Date().toISOString()
      db.conn.prepare(`
        INSERT INTO skill_targets (id, skill_id, agent_id, target_path, install_mode, actual_mode, source_hash, current_hash, status, created_at, updated_at)
        VALUES (?, 'delete-targets', 'claude-code', ?, 'link', 'link', 'hash', NULL, 'ok', ?, ?)
      `).run('target-1', '/fake/path', now, now)

      service.executeDeleteCenterSkill('delete-targets')

      const targets = db.conn.prepare('SELECT * FROM skill_targets WHERE skill_id = ?').all('delete-targets')
      expect(targets.length).toBe(0)
    })

    it('throws on unknown skill id', () => {
      expect(() => service.executeDeleteCenterSkill('non-existent')).toThrow()
    })
  })
})
