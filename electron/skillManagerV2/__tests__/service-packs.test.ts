/**
 * Skill Manager V2 — Skill Pack Tests
 *
 * Tests for upsertPack, getPackDetail, deletePack, previewApplyPack,
 * executeApplyPack, previewRemovePackFromAgent, removePackFromAgent.
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
  UpsertPackInput,
  SkillPackDetail,
  RemovePackFromAgentPreview,
  DeletePackPreview,
} from '@/types/skillManagerV2'

// ── Test helpers ───────────────────────────────────────────────────

let tmpDir: string
let centerPath: string
let dbPath: string
let service: SkillManagerService
let externalDir: string
let agentDir: string

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-pack-test-'))
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

/** Register a test agent with a custom skills dir. */
function registerAgent(agentId: string, displayName: string, skillsDir: string): void {
  service.getDb().conn
    .prepare(
      `INSERT OR REPLACE INTO agents (id, display_name, skills_dir, config_path, enabled, last_scanned_at)
       VALUES (?, ?, ?, NULL, 1, ?)`
    )
    .run(agentId, displayName, skillsDir, new Date().toISOString())
}

// ── Tests ──────────────────────────────────────────────────────────

describe('SkillManagerService — Skill Packs', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir()
    centerPath = path.join(tmpDir, 'skills')
    dbPath = path.join(tmpDir, 'skill-manager', 'test.db')
    externalDir = path.join(tmpDir, 'external')
    agentDir = path.join(tmpDir, 'agent-skills')
    fs.mkdirSync(externalDir, { recursive: true })
    fs.mkdirSync(agentDir, { recursive: true })

    service = SkillManagerService.bootstrap(dbPath, centerPath)
    registerAgent('test-agent', 'Test Agent', agentDir)
  })

  afterEach(() => {
    service.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── upsertPack ──────────────────────────────────────────────────

  describe('upsertPack', () => {
    it('creates a new pack with members', () => {
      const skillA = createAndImportSkill('pack-skill-a')
      const skillB = createAndImportSkill('pack-skill-b')
      const skillC = createAndImportSkill('pack-skill-c')

      const input: UpsertPackInput = {
        name: 'Test Pack',
        description: 'A test pack',
        tags: ['test'],
        memberSkillIds: [skillA, skillB, skillC],
      }

      const detail = service.upsertPack(input)

      expect(detail.id).toBeTruthy()
      expect(detail.name).toBe('Test Pack')
      expect(detail.description).toBe('A test pack')
      expect(detail.members.length).toBe(3)
      expect(detail.tags).toEqual(['test'])
    })

    it('throws on empty name', () => {
      const input: UpsertPackInput = {
        name: '',
        memberSkillIds: [],
      }

      expect(() => service.upsertPack(input)).toThrow()
    })

    it('throws when a member skill does not exist', () => {
      const input: UpsertPackInput = {
        name: 'Bad Pack',
        memberSkillIds: ['nonexistent-skill'],
      }

      expect(() => service.upsertPack(input)).toThrow()
    })

    it('updates an existing pack by id', () => {
      const skillA = createAndImportSkill('update-skill-a')
      const skillB = createAndImportSkill('update-skill-b')

      const created = service.upsertPack({
        name: 'Original',
        memberSkillIds: [skillA],
      })

      const updated = service.upsertPack({
        id: created.id,
        name: 'Updated',
        description: 'Changed description',
        memberSkillIds: [skillA, skillB],
      })

      expect(updated.id).toBe(created.id)
      expect(updated.name).toBe('Updated')
      expect(updated.description).toBe('Changed description')
      expect(updated.members.length).toBe(2)
    })
  })

  // ── getPackDetail ───────────────────────────────────────────────

  describe('getPackDetail', () => {
    it('returns pack detail with members and empty applied agents', () => {
      const skillA = createAndImportSkill('detail-skill-a')
      const skillB = createAndImportSkill('detail-skill-b')

      const created = service.upsertPack({
        name: 'Detail Pack',
        memberSkillIds: [skillA, skillB],
      })

      const detail = service.getPackDetail(created.id)

      expect(detail).not.toBeNull()
      expect(detail!.name).toBe('Detail Pack')
      expect(detail!.members.length).toBe(2)
      expect(detail!.appliedAgents.length).toBe(0)
    })

    it('returns null for nonexistent pack', () => {
      const detail = service.getPackDetail('nonexistent-pack')
      expect(detail).toBeNull()
    })

    it('members include skillName and missing flag', () => {
      const skillA = createAndImportSkill('member-skill-a')

      const created = service.upsertPack({
        name: 'Member Pack',
        memberSkillIds: [skillA],
      })

      const detail = service.getPackDetail(created.id)
      expect(detail!.members[0].skillName).toBe('member-skill-a')
      expect(detail!.members[0].missing).toBe(false)
    })
  })

  // ── listPacks ───────────────────────────────────────────────────

  describe('listPacks', () => {
    it('returns empty array when no packs exist', () => {
      const packs = service.listPacks()
      expect(packs.length).toBe(0)
    })

    it('returns created packs with member count', () => {
      const skillA = createAndImportSkill('list-skill-a')
      const skillB = createAndImportSkill('list-skill-b')

      service.upsertPack({
        name: 'Pack One',
        memberSkillIds: [skillA],
      })
      service.upsertPack({
        name: 'Pack Two',
        memberSkillIds: [skillA, skillB],
      })

      const packs = service.listPacks()
      expect(packs.length).toBe(2)
      const packTwo = packs.find((p) => p.name === 'Pack Two')
      expect(packTwo!.memberCount).toBe(2)
    })
  })

  // ── previewApplyPack & executeApplyPack ─────────────────────────

  describe('applyPack', () => {
    it('previewApplyPack returns distribution preview for all members', () => {
      const skillA = createAndImportSkill('apply-skill-a')
      const skillB = createAndImportSkill('apply-skill-b')

      const pack = service.upsertPack({
        name: 'Apply Pack',
        memberSkillIds: [skillA, skillB],
      })

      const preview = service.previewApplyPack(pack.id, ['test-agent'], 'link')

      expect(preview.changes.length).toBe(2)
      expect(preview.changes.every((c) => c.action === 'create')).toBe(true)
      expect(preview.blockers.length).toBe(0)
    })

    it('executeApplyPack creates targets with pack claims', () => {
      const skillA = createAndImportSkill('exec-apply-a')
      const skillB = createAndImportSkill('exec-apply-b')

      const pack = service.upsertPack({
        name: 'Exec Apply Pack',
        memberSkillIds: [skillA, skillB],
      })

      const result = service.executeApplyPack(pack.id, ['test-agent'], 'copy')

      expect(result.success).toBe(true)
      expect(result.created).toBe(2)

      // Verify targets exist
      const detailA = service.getSkillDetail(skillA)
      expect(detailA!.targets.length).toBe(1)
      expect(detailA!.targets[0].agentId).toBe('test-agent')

      // Verify pack claims exist
      const claimsA = detailA!.claims
      expect(claimsA.length).toBe(1)
      expect(claimsA[0].claimType).toBe('pack')
      expect(claimsA[0].packId).toBe(pack.id)
    })

    it('repeated apply does not produce duplicate claims (idempotent)', () => {
      const skillA = createAndImportSkill('idempotent-a')

      const pack = service.upsertPack({
        name: 'Idempotent Pack',
        memberSkillIds: [skillA],
      })

      service.executeApplyPack(pack.id, ['test-agent'], 'copy')
      service.executeApplyPack(pack.id, ['test-agent'], 'copy')

      const detail = service.getSkillDetail(skillA)
      expect(detail!.targets.length).toBe(1)
      // Should have exactly 1 pack claim (UNIQUE constraint)
      const packClaims = detail!.claims.filter((c) => c.claimType === 'pack')
      expect(packClaims.length).toBe(1)
    })

    it('two packs with same skill applied to same agent: target has 2 pack claims, 1 file', () => {
      const skillA = createAndImportSkill('shared-skill')

      const pack1 = service.upsertPack({
        name: 'Pack One',
        memberSkillIds: [skillA],
      })
      const pack2 = service.upsertPack({
        name: 'Pack Two',
        memberSkillIds: [skillA],
      })

      service.executeApplyPack(pack1.id, ['test-agent'], 'copy')
      service.executeApplyPack(pack2.id, ['test-agent'], 'copy')

      const detail = service.getSkillDetail(skillA)
      expect(detail!.targets.length).toBe(1) // Only 1 file on disk
      const packClaims = detail!.claims.filter((c) => c.claimType === 'pack')
      expect(packClaims.length).toBe(2) // 2 pack claims
    })
  })

  // ── previewRemovePackFromAgent & removePackFromAgent ────────────

  describe('removePackFromAgent', () => {
    it('previewRemovePackFromAgent shows which targets will be removed vs preserved', () => {
      const skillA = createAndImportSkill('rm-skill-a')
      const skillB = createAndImportSkill('rm-skill-b')

      const pack1 = service.upsertPack({
        name: 'Pack 1',
        memberSkillIds: [skillA, skillB],
      })
      const pack2 = service.upsertPack({
        name: 'Pack 2',
        memberSkillIds: [skillA],
      })

      service.executeApplyPack(pack1.id, ['test-agent'], 'copy')
      service.executeApplyPack(pack2.id, ['test-agent'], 'copy')

      const preview: RemovePackFromAgentPreview = service.previewRemovePackFromAgent(
        pack1.id,
        'test-agent'
      )

      // skillA has 2 pack claims (pack1 + pack2), skillB has 1 pack claim (pack1)
      expect(preview.affectedTargets.length).toBe(2)
      const targetA = preview.affectedTargets.find(
        (t) => t.targetPath.includes('rm-skill-a')
      )
      const targetB = preview.affectedTargets.find(
        (t) => t.targetPath.includes('rm-skill-b')
      )

      expect(targetA).toBeTruthy()
      expect(targetA!.claimCount).toBe(2) // pack1 + pack2
      expect(targetB).toBeTruthy()
      expect(targetB!.claimCount).toBe(1) // only pack1

      // skillB will be removed (1 claim), skillA will be preserved (2 claims)
      expect(preview.willRemoveTargets).toBe(1)
      expect(preview.willPreserveTargets).toBe(1)
    })

    it('removePackFromAgent removes only the pack claim, preserves file when other claims exist', () => {
      const skillA = createAndImportSkill('preserve-skill')

      const pack1 = service.upsertPack({
        name: 'Preserve Pack 1',
        memberSkillIds: [skillA],
      })
      const pack2 = service.upsertPack({
        name: 'Preserve Pack 2',
        memberSkillIds: [skillA],
      })

      service.executeApplyPack(pack1.id, ['test-agent'], 'copy')
      service.executeApplyPack(pack2.id, ['test-agent'], 'copy')

      const result = service.removePackFromAgent(pack1.id, 'test-agent')

      expect(result.removedClaims).toBe(1)
      expect(result.removedTargets).toBe(0) // File preserved because pack2 claim remains
      expect(result.preservedTargets).toBe(1)

      // File should still exist
      const agentSkillDir = path.join(agentDir, 'preserve-skill')
      expect(fs.existsSync(agentSkillDir)).toBe(true)

      // Target should still exist in DB
      const detail = service.getSkillDetail(skillA)
      expect(detail!.targets.length).toBe(1)

      // Only pack2's claim should remain
      const packClaims = detail!.claims.filter((c) => c.claimType === 'pack')
      expect(packClaims.length).toBe(1)
      expect(packClaims[0].packId).toBe(pack2.id)
    })

    it('removePackFromAgent deletes file when last claim is removed', () => {
      const skillA = createAndImportSkill('last-claim-skill')

      const pack1 = service.upsertPack({
        name: 'Last Claim Pack',
        memberSkillIds: [skillA],
      })

      service.executeApplyPack(pack1.id, ['test-agent'], 'copy')

      const result = service.removePackFromAgent(pack1.id, 'test-agent')

      expect(result.removedClaims).toBe(1)
      expect(result.removedTargets).toBe(1) // File removed
      expect(result.preservedTargets).toBe(0)

      // File should be gone
      const agentSkillDir = path.join(agentDir, 'last-claim-skill')
      expect(fs.existsSync(agentSkillDir)).toBe(false)

      // Target should be gone from DB
      const detail = service.getSkillDetail(skillA)
      expect(detail!.targets.length).toBe(0)
    })
  })

  // ── deletePack ──────────────────────────────────────────────────

  describe('deletePack', () => {
    it('previewDeletePack returns affected agents and removable flag', () => {
      const skillA = createAndImportSkill('del-pack-skill')

      const pack = service.upsertPack({
        name: 'Delete Me',
        memberSkillIds: [skillA],
      })

      service.executeApplyPack(pack.id, ['test-agent'], 'copy')

      const preview: DeletePackPreview = service.previewDeletePack(pack.id)

      expect(preview.packId).toBe(pack.id)
      expect(preview.packName).toBe('Delete Me')
      expect(preview.removable).toBe(false) // Applied to agent
      expect(preview.warnings.length).toBeGreaterThan(0)
    })

    it('previewDeletePack shows removable when not applied to any agent', () => {
      const skillA = createAndImportSkill('removable-pack-skill')

      const pack = service.upsertPack({
        name: 'Removable Pack',
        memberSkillIds: [skillA],
      })

      const preview = service.previewDeletePack(pack.id)

      expect(preview.removable).toBe(true)
      expect(preview.warnings.length).toBe(0)
    })

    it('deletePack removes the pack and its members', () => {
      const skillA = createAndImportSkill('gone-pack-skill')

      const pack = service.upsertPack({
        name: 'Gone Pack',
        memberSkillIds: [skillA],
      })

      service.deletePack(pack.id)

      const detail = service.getPackDetail(pack.id)
      expect(detail).toBeNull()

      const packs = service.listPacks()
      expect(packs.find((p) => p.id === pack.id)).toBeUndefined()
    })

    it('deletePack throws when pack is still applied to agents', () => {
      const skillA = createAndImportSkill('applied-pack-skill')

      const pack = service.upsertPack({
        name: 'Applied Pack',
        memberSkillIds: [skillA],
      })

      service.executeApplyPack(pack.id, ['test-agent'], 'copy')

      expect(() => service.deletePack(pack.id)).toThrow()
    })
  })
})
