import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SkillManagerService } from '../service'
import { setHomeOverride } from '../fsutil'
import { SCHEMA_VERSION } from '../db'

// ── Test helpers ───────────────────────────────────────────────────

let tmpDir: string
let centerPath: string
let dbPath: string
let service: SkillManagerService

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-svc-test-'))
}

function createSkillDir(parentDir: string, name: string, skillName?: string): string {
  const dir = path.join(parentDir, name)
  const content = skillName
    ? `---\nname: ${skillName}\ndescription: A test skill\n---\n# ${skillName}`
    : `---\nname: ${name}\ndescription: A test skill\n---\n# ${name}`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content)
  return dir
}

// ── Tests ──────────────────────────────────────────────────────────

describe('SkillManagerService', () => {
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

  // ── bootstrap ───────────────────────────────────────────────────

  describe('bootstrap', () => {
    it('creates the center library directory', () => {
      expect(fs.existsSync(centerPath)).toBe(true)
      expect(fs.statSync(centerPath).isDirectory()).toBe(true)
    })

    it('creates the skill-manager directory', () => {
      expect(fs.existsSync(path.dirname(dbPath))).toBe(true)
    })

    it('creates the SQLite database file', () => {
      expect(fs.existsSync(dbPath)).toBe(true)
    })

    it('records schema version 4', () => {
      expect(service.getSchemaVersion()).toBe(SCHEMA_VERSION)
      expect(SCHEMA_VERSION).toBe(4)
    })
  })

  // ── agent registry ──────────────────────────────────────────────

  describe('listAgents', () => {
    it('returns the built-in agents', () => {
      const agents = service.listAgents()
      expect(agents.length).toBeGreaterThanOrEqual(20)
    })

    it('includes the major local skill agents', () => {
      const agents = service.listAgents()
      const ids = agents.map((a) => a.id)
      expect(ids).toContain('claude-code')
      expect(ids).toContain('codex')
      expect(ids).toContain('cursor')
      expect(ids).toContain('trae')
    })

    it('each agent has non-null skillsDir', () => {
      const agents = service.listAgents()
      for (const agent of agents) {
        expect(agent.skillsDir).not.toBeNull()
        expect(agent.enabled).toBe(true)
      }
    })
  })

  // ── settings ────────────────────────────────────────────────────

  describe('getSettings', () => {
    it('returns default settings on first run', () => {
      const settings = service.getSettings()
      expect(settings.centerLibraryPath).toBe(centerPath)
      expect(settings.defaultInstallMode).toBe('link')
      expect(settings.linkFailPolicy).toBe('copy')
      expect(settings.startupScan).toBe(true)
      expect(settings.showUnmanaged).toBe(true)
    })
  })

  describe('updateSettings', () => {
    it('updates defaultInstallMode', () => {
      const updated = service.updateSettings({ defaultInstallMode: 'copy' })
      expect(updated.defaultInstallMode).toBe('copy')
      // Verify persistence
      const settings = service.getSettings()
      expect(settings.defaultInstallMode).toBe('copy')
    })

    it('updates linkFailPolicy', () => {
      const updated = service.updateSettings({ linkFailPolicy: 'ask' })
      expect(updated.linkFailPolicy).toBe('ask')
    })

    it('updates startupScan', () => {
      const updated = service.updateSettings({ startupScan: false })
      expect(updated.startupScan).toBe(false)
    })

    it('preserves other settings when updating one', () => {
      service.updateSettings({ defaultInstallMode: 'copy' })
      const updated = service.updateSettings({ linkFailPolicy: 'ask' })
      expect(updated.defaultInstallMode).toBe('copy')
      expect(updated.linkFailPolicy).toBe('ask')
    })
  })

  // ── overview ────────────────────────────────────────────────────

  describe('getOverview', () => {
    it('returns overview with metrics', () => {
      const overview = service.getOverview()
      expect(overview.metrics).toBeDefined()
      expect(overview.metrics.centerSkillCount).toBe(0)
      expect(overview.metrics.agentTargetCount).toBe(0)
      expect(overview.metrics.unmanagedCount).toBe(0)
      expect(overview.metrics.diagnosisIssueCount).toBe(0)
    })

    it('returns overview with registered agents', () => {
      const overview = service.getOverview()
      expect(overview.agents.length).toBeGreaterThanOrEqual(20)
    })

    it('returns overview with settings', () => {
      const overview = service.getOverview()
      expect(overview.settings).toBeDefined()
      expect(overview.settings.centerLibraryPath).toBe(centerPath)
    })

    it('returns empty skills/packs/issues arrays on fresh init', () => {
      const overview = service.getOverview()
      expect(overview.skills.length).toBe(0)
      expect(overview.packs.length).toBe(0)
      expect(overview.issues.length).toBe(0)
      expect(overview.unmanaged.length).toBe(0)
    })
  })

  // ── refresh / scan ──────────────────────────────────────────────

  describe('refresh', () => {
    it('discovers skills in the center library', () => {
      // Create a skill in the center library
      createSkillDir(centerPath, 'my-skill', 'My Skill')

      const overview = service.refresh()
      expect(overview.skills.length).toBe(1)
      expect(overview.skills[0].id).toBe('my-skill')
      expect(overview.skills[0].name).toBe('My Skill')
      expect(overview.metrics.centerSkillCount).toBe(1)
    })

    it('discovers multiple skills', () => {
      createSkillDir(centerPath, 'skill-a', 'Skill A')
      createSkillDir(centerPath, 'skill-b', 'Skill B')
      createSkillDir(centerPath, 'skill-c', 'Skill C')

      const overview = service.refresh()
      expect(overview.skills.length).toBe(3)
      expect(overview.metrics.centerSkillCount).toBe(3)
    })

    it('ignores directories without SKILL.md', () => {
      createSkillDir(centerPath, 'real-skill', 'Real Skill')
      // Create a non-skill directory
      fs.mkdirSync(path.join(centerPath, 'not-a-skill'), { recursive: true })
      fs.writeFileSync(path.join(centerPath, 'not-a-skill', 'README.md'), 'not a skill')

      const overview = service.refresh()
      expect(overview.skills.length).toBe(1)
      expect(overview.skills[0].id).toBe('real-skill')
    })

    it('ignores ignored entries like node_modules', () => {
      createSkillDir(centerPath, 'real-skill', 'Real Skill')
      // Create a node_modules directory with a fake skill
      createSkillDir(path.join(centerPath, 'node_modules'), 'fake-skill', 'Fake Skill')

      const overview = service.refresh()
      expect(overview.skills.length).toBe(1)
    })

    it('updates skill hash when content changes', () => {
      createSkillDir(centerPath, 'my-skill', 'My Skill')
      let overview = service.refresh()
      const originalHash = overview.skills[0].currentHash

      // Modify the skill
      fs.writeFileSync(
        path.join(centerPath, 'my-skill', 'SKILL.md'),
        '---\nname: My Skill\ndescription: Updated description\n---\n# My Skill\nNew content'
      )

      overview = service.refresh()
      const newHash = overview.skills[0].currentHash
      expect(newHash).not.toBe(originalHash)
    })

    it('returns overview after refresh', () => {
      createSkillDir(centerPath, 'test-skill', 'Test')
      const overview = service.refresh()
      expect(overview).toBeDefined()
      expect(overview.skills).toBeDefined()
      expect(overview.agents).toBeDefined()
      expect(overview.settings).toBeDefined()
    })
  })

  // ── database info ───────────────────────────────────────────────

  describe('getDbPath', () => {
    it('returns the database file path', () => {
      expect(service.getDbPath()).toBe(dbPath)
    })
  })

  describe('getCenterPath', () => {
    it('returns the center library path', () => {
      expect(service.getCenterPath()).toBe(centerPath)
    })
  })

  describe('getTableNames', () => {
    it('returns all table names including core tables', () => {
      const tables = service.getTableNames()
      expect(tables).toContain('skills')
      expect(tables).toContain('agents')
      expect(tables).toContain('settings')
      expect(tables).toContain('schema_migrations')
    })
  })
})
