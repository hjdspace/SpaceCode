/**
 * Skill Manager V2 — Slice 4 Tests
 *
 * Tests for previewDistribute, executeDistribute, deleteTarget.
 * TDD: written before implementation.
 *
 * Seam: SkillManagerService public methods.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SkillManagerService } from '../service'
import type {
  DistributionPreview,
  DistributionChange,
  DistributionBlocker,
} from '@/types/skillManagerV2'

// ── Test helpers ───────────────────────────────────────────────────

let tmpDir: string
let centerPath: string
let dbPath: string
let service: SkillManagerService
let externalDir: string
let agentDir: string

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-slice4-test-'))
}

/**
 * Create a skill directory with SKILL.md in the external dir
 * and import it into the center library.
 * Returns the skill ID.
 */
function createAndImportSkill(
  dirName: string,
  skillName?: string,
  description?: string
): string {
  const dir = path.join(externalDir, dirName)
  const name = skillName ?? dirName
  const desc = description ?? 'A test skill'
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}`
  )

  service.executeAddCenterSkill(
    {
      sourcePath: dir,
      sourceType: 'local_folder',
      sourceUri: dir,
    },
    []
  )
  return dirName
}

/** Create an unmanaged skill directory directly in the agent dir. */
function createAgentSkill(dirName: string, content: string = '# Test'): string {
  const dir = path.join(agentDir, dirName)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${dirName}\n---\n${content}`)
  return dir
}

// ── Tests ──────────────────────────────────────────────────────────

describe('SkillManagerService — Slice 4: Distribute to Agent', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir()
    centerPath = path.join(tmpDir, 'skills')
    dbPath = path.join(tmpDir, 'skill-manager', 'test.db')
    externalDir = path.join(tmpDir, 'external')
    agentDir = path.join(tmpDir, 'agent-skills')
    fs.mkdirSync(externalDir, { recursive: true })
    fs.mkdirSync(agentDir, { recursive: true })

    service = SkillManagerService.bootstrap(dbPath, centerPath)

    // Register a test agent with a custom skills dir
    service.getDb().conn
      .prepare(
        `INSERT OR REPLACE INTO agents (id, display_name, skills_dir, config_path, enabled, last_scanned_at)
         VALUES ('test-agent', 'Test Agent', ?, NULL, 1, ?)`
      )
      .run(agentDir, new Date().toISOString())
  })

  afterEach(() => {
    service.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── previewDistribute ───────────────────────────────────────────

  describe('previewDistribute', () => {
    it('returns create change for new skill to new agent', () => {
      const skillId = createAndImportSkill('dist-skill')

      const preview = service.previewDistribute(
        [skillId],
        ['test-agent'],
        'link'
      )

      expect(preview.changes.length).toBe(1)
      expect(preview.blockers.length).toBe(0)

      const change = preview.changes[0]
      expect(change.action).toBe('create')
      expect(change.skillId).toBe('dist-skill')
      expect(change.agentId).toBe('test-agent')
      expect(change.mode).toBe('link')
      expect(change.reason).toBeNull()
    })

    it('returns create for multiple skills x multiple agents', () => {
      const skillA = createAndImportSkill('skill-a')
      const skillB = createAndImportSkill('skill-b')

      const preview = service.previewDistribute(
        [skillA, skillB],
        ['test-agent'],
        'copy'
      )

      expect(preview.changes.length).toBe(2)
      expect(preview.changes.every((c) => c.action === 'create')).toBe(true)
    })

    it('returns reuse for already-distributed skill to same agent', () => {
      const skillId = createAndImportSkill('reuse-skill')

      // First distribute
      const preview1 = service.previewDistribute([skillId], ['test-agent'], 'link')
      service.executeDistribute(preview1)

      // Preview again
      const preview2 = service.previewDistribute([skillId], ['test-agent'], 'link')

      expect(preview2.changes.length).toBe(1)
      expect(preview2.changes[0].action).toBe('reuse')
    })

    it('returns blocked when agent dir has unmanaged same-name skill', () => {
      const skillId = createAndImportSkill('blocked-skill')
      createAgentSkill('blocked-skill', '# existing unmanaged')

      const preview = service.previewDistribute(
        [skillId],
        ['test-agent'],
        'link'
      )

      expect(preview.blockers.length).toBe(1)
      const blocker = preview.blockers[0]
      expect(blocker.skillId).toBe('blocked-skill')
      expect(blocker.agentId).toBe('test-agent')
      expect(blocker.reason).toBeTruthy()
    })

    it('returns empty preview for empty skillIds', () => {
      const preview = service.previewDistribute([], ['test-agent'], 'link')
      expect(preview.changes.length).toBe(0)
      expect(preview.blockers.length).toBe(0)
    })

    it('throws when skill ID not found in center library', () => {
      expect(() =>
        service.previewDistribute(['nonexistent'], ['test-agent'], 'link')
      ).toThrow()
    })
  })

  // ── executeDistribute ───────────────────────────────────────────

  describe('executeDistribute', () => {
    it('creates link target and writes DB record with actualMode=link', () => {
      const skillId = createAndImportSkill('link-skill')

      const preview = service.previewDistribute([skillId], ['test-agent'], 'link')
      const result = service.executeDistribute(preview)

      expect(result.success).toBe(true)
      expect(result.created).toBe(1)
      expect(result.reused).toBe(0)
      expect(result.failed).toBe(0)

      // Verify DB has a target record
      const detail = service.getSkillDetail(skillId)
      expect(detail).not.toBeNull()
      expect(detail!.targets.length).toBe(1)
      expect(detail!.targets[0].agentId).toBe('test-agent')
      expect(detail!.targets[0].installMode).toBe('link')
    })

    it('creates copy target and writes DB record with actualMode=copy', () => {
      const skillId = createAndImportSkill('copy-skill')

      const preview = service.previewDistribute([skillId], ['test-agent'], 'copy')
      const result = service.executeDistribute(preview)

      expect(result.success).toBe(true)
      expect(result.created).toBe(1)

      // Verify the copy exists in the agent dir
      const agentSkillDir = path.join(agentDir, 'copy-skill')
      expect(fs.existsSync(agentSkillDir)).toBe(true)
      expect(fs.existsSync(path.join(agentSkillDir, 'SKILL.md'))).toBe(true)

      // It should NOT be a symlink
      const stat = fs.lstatSync(agentSkillDir)
      expect(stat.isSymbolicLink()).toBe(false)

      // Verify DB records actualMode = copy
      const detail = service.getSkillDetail(skillId)
      expect(detail!.targets[0].actualMode).toBe('copy')
      expect(detail!.targets[0].installMode).toBe('copy')
    })

    it('writes direct claim for distributed target', () => {
      const skillId = createAndImportSkill('claim-skill')

      const preview = service.previewDistribute([skillId], ['test-agent'], 'link')
      service.executeDistribute(preview)

      const detail = service.getSkillDetail(skillId)
      expect(detail!.claims.length).toBe(1)
      expect(detail!.claims[0].claimType).toBe('direct')
      expect(detail!.claims[0].packId).toBeNull()
    })

    it('does not duplicate target or claim on repeated distribute (reuse)', () => {
      const skillId = createAndImportSkill('reuse-dup')

      const preview1 = service.previewDistribute([skillId], ['test-agent'], 'link')
      service.executeDistribute(preview1)

      // Distribute again
      const preview2 = service.previewDistribute([skillId], ['test-agent'], 'link')
      const result2 = service.executeDistribute(preview2)

      expect(result2.created).toBe(0)
      expect(result2.reused).toBe(1)

      // Still only 1 target and 1 claim
      const detail = service.getSkillDetail(skillId)
      expect(detail!.targets.length).toBe(1)
      expect(detail!.claims.length).toBe(1)
    })

    it('records sourceHash from center library hash', () => {
      const skillId = createAndImportSkill('hash-skill')

      const preview = service.previewDistribute([skillId], ['test-agent'], 'copy')
      service.executeDistribute(preview)

      const detail = service.getSkillDetail(skillId)
      expect(detail!.targets[0].sourceHash).toBe(detail!.currentHash)
    })

    it('skips blocked changes without creating targets', () => {
      const skillId = createAndImportSkill('blocked-exec')
      createAgentSkill('blocked-exec', '# unmanaged')

      const preview = service.previewDistribute([skillId], ['test-agent'], 'link')
      const result = service.executeDistribute(preview)

      expect(result.success).toBe(true)
      expect(result.created).toBe(0)
      expect(result.failed).toBe(0)

      // No target should be created
      const detail = service.getSkillDetail(skillId)
      expect(detail!.targets.length).toBe(0)
    })

    it('distributes multiple skills to multiple agents', () => {
      const skillA = createAndImportSkill('multi-a')
      const skillB = createAndImportSkill('multi-b')

      // Register a second agent
      const agent2Dir = path.join(tmpDir, 'agent2-skills')
      fs.mkdirSync(agent2Dir, { recursive: true })
      service.getDb().conn
        .prepare(
          `INSERT OR REPLACE INTO agents (id, display_name, skills_dir, config_path, enabled, last_scanned_at)
           VALUES ('test-agent-2', 'Test Agent 2', ?, NULL, 1, ?)`
        )
        .run(agent2Dir, new Date().toISOString())

      const preview = service.previewDistribute(
        [skillA, skillB],
        ['test-agent', 'test-agent-2'],
        'copy'
      )

      expect(preview.changes.length).toBe(4)
      expect(preview.changes.every((c) => c.action === 'create')).toBe(true)

      const result = service.executeDistribute(preview)
      expect(result.created).toBe(4)
    })
  })

  // ── deleteTarget ────────────────────────────────────────────────

  describe('deleteTarget', () => {
    it('removes target file/link and DB records', () => {
      const skillId = createAndImportSkill('del-skill')

      const preview = service.previewDistribute([skillId], ['test-agent'], 'copy')
      service.executeDistribute(preview)

      // Verify it exists
      const detail = service.getSkillDetail(skillId)
      expect(detail!.targets.length).toBe(1)
      const targetId = detail!.targets[0].id

      // Verify file exists
      const agentSkillDir = path.join(agentDir, 'del-skill')
      expect(fs.existsSync(agentSkillDir)).toBe(true)

      // Delete
      service.deleteTarget(targetId)

      // DB record gone
      const detail2 = service.getSkillDetail(skillId)
      expect(detail2!.targets.length).toBe(0)

      // File gone
      expect(fs.existsSync(agentSkillDir)).toBe(false)
    })

    it('removes claims when deleting target', () => {
      const skillId = createAndImportSkill('del-claim-skill')

      const preview = service.previewDistribute([skillId], ['test-agent'], 'copy')
      service.executeDistribute(preview)

      const detail = service.getSkillDetail(skillId)
      expect(detail!.claims.length).toBe(1)
      const targetId = detail!.targets[0].id

      service.deleteTarget(targetId)

      const detail2 = service.getSkillDetail(skillId)
      expect(detail2!.claims.length).toBe(0)
    })

    it('throws when target ID not found', () => {
      expect(() => service.deleteTarget('nonexistent-target')).toThrow()
    })
  })

  // ── Agent badges on SkillSummary ─────────────────────────────────

  describe('Agent badges', () => {
    it('SkillSummary shows agentBadge after distribution', () => {
      const skillId = createAndImportSkill('badge-skill')

      const preview = service.previewDistribute([skillId], ['test-agent'], 'copy')
      service.executeDistribute(preview)

      const skills = service.listCenterSkills()
      const skill = skills.find((s) => s.id === 'badge-skill')
      expect(skill).toBeTruthy()
      expect(skill!.agentBadges.length).toBe(1)
      expect(skill!.agentBadges[0].agentId).toBe('test-agent')
      expect(skill!.agentBadges[0].agentName).toBe('Test Agent')
    })
  })
})
