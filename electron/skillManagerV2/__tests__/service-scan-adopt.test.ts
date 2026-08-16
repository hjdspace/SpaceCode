/**
 * Skill Manager V2 — Agent Scan & Adopt Tests
 *
 * Tests for scanAgentInventory, listUnmanaged, previewAdopt, executeAdopt, executeAdoptBatch.
 * TDD: written before implementation.
 *
 * Seam: SkillManagerService public methods.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SkillManagerService } from '../service'
import { setHomeOverride } from '../fsutil'
import type { AdoptBatchItem } from '@/types/skillManagerV2'

// ── Test helpers ───────────────────────────────────────────────────

let tmpDir: string
let centerPath: string
let dbPath: string
let service: SkillManagerService
let externalDir: string
let agentDir: string

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-slice5-test-'))
}

/** Create a skill dir with SKILL.md and import into center library. */
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
    { sourcePath: dir, sourceType: 'local_folder', sourceUri: dir },
    []
  )
  return dirName
}

/** Create an unmanaged skill dir directly in the agent dir. */
function createAgentSkill(
  dirName: string,
  skillName?: string,
  content?: string
): string {
  const dir = path.join(agentDir, dirName)
  const name = skillName ?? dirName
  const body = content ?? `# ${name}`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\n---\n${body}`
  )
  return dir
}

// ── Tests ──────────────────────────────────────────────────────────

describe('SkillManagerService — Agent Scan & Adopt', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir()
    setHomeOverride(path.join(tmpDir, 'home'))
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
    setHomeOverride(null)
    service.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── scanAgentInventory ──────────────────────────────────────────

  describe('scanAgentInventory', () => {
    it('returns empty arrays when agent dir is empty', () => {
      const result = service.scanAgentInventory('test-agent')
      expect(result.agentId).toBe('test-agent')
      expect(result.managed.length).toBe(0)
      expect(result.unmanaged.length).toBe(0)
      expect(result.conflicts.length).toBe(0)
    })

    it('detects unmanaged skill in agent dir', () => {
      createAgentSkill('unmanaged-skill')

      const result = service.scanAgentInventory('test-agent')

      expect(result.unmanaged.length).toBe(1)
      expect(result.unmanaged[0].inferredSkillId).toBe('unmanaged-skill')
      expect(result.unmanaged[0].agentId).toBe('test-agent')
      expect(result.unmanaged[0].hash).toBeTruthy()
    })

    it('detects managed skill (existing target in DB)', () => {
      // Import to center + distribute
      const skillId = createAndImportSkill('managed-skill')
      const preview = service.previewDistribute([skillId], ['test-agent'], 'link')
      service.executeDistribute(preview)

      const result = service.scanAgentInventory('test-agent')

      expect(result.managed.length).toBe(1)
      expect(result.managed[0].skillId).toBe('managed-skill')
      expect(result.unmanaged.length).toBe(0)
    })

    it('classifies as conflict when same-name skill exists in center but hash differs', () => {
      // Import a skill to center
      createAndImportSkill('conflict-skill', undefined, 'center version')

      // Create a different version in agent dir
      createAgentSkill('conflict-skill', undefined, '# agent modified')

      const result = service.scanAgentInventory('test-agent')

      // Should be classified as conflict (not unmanaged, not managed)
      expect(result.conflicts.length).toBe(1)
      expect(result.conflicts[0].inferredSkillId).toBe('conflict-skill')
      expect(result.unmanaged.length).toBe(0)
    })

    it('throws when agent ID not found', () => {
      expect(() => service.scanAgentInventory('nonexistent-agent')).toThrow()
    })

    it('detects multiple unmanaged skills', () => {
      createAgentSkill('skill-alpha')
      createAgentSkill('skill-beta')
      createAgentSkill('skill-gamma')

      const result = service.scanAgentInventory('test-agent')

      expect(result.unmanaged.length).toBe(3)
      const ids = result.unmanaged.map((u) => u.inferredSkillId).sort()
      expect(ids).toEqual(['skill-alpha', 'skill-beta', 'skill-gamma'])
    })

    it('detects a symlinked skill directory', () => {
      const sourceDir = path.join(externalDir, 'linked-skill')
      fs.mkdirSync(sourceDir, { recursive: true })
      fs.writeFileSync(path.join(sourceDir, 'SKILL.md'), '---\nname: linked-skill\n---\n# linked')

      const linkPath = path.join(agentDir, 'linked-skill')
      fs.symlinkSync(sourceDir, linkPath, 'junction')

      const result = service.scanAgentInventory('test-agent')
      expect(result.unmanaged.some((item) => item.path === linkPath)).toBe(true)
    })

    it('deduplicates a skill directory and a symlink to the same directory', () => {
      const sourceDir = createAgentSkill('shared-skill')
      const linkPath = path.join(agentDir, 'shared-skill-link')
      fs.symlinkSync(sourceDir, linkPath, 'junction')

      const result = service.scanAgentInventory('test-agent')
      expect(result.unmanaged).toHaveLength(1)
    })

    it('derives the skill id from frontmatter name over directory name', () => {
      const dir = path.join(agentDir, 'dir-name')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: Frontmatter Name\n---\n# skill')

      const result = service.scanAgentInventory('test-agent')

      expect(result.unmanaged.length).toBe(1)
      expect(result.unmanaged[0].inferredSkillId).toBe('Frontmatter-Name')
    })

    it('skips skills nested inside hidden directories', () => {
      const dir = path.join(agentDir, '.codex', 'skills', 'nested-skill')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: nested-skill\n---\n# skill')

      const result = service.scanAgentInventory('test-agent')

      expect(result.unmanaged.length).toBe(0)
    })

    it('does not recurse into non-skill subdirectories for regular agents', () => {
      const dir = path.join(agentDir, 'group', 'nested-skill')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: nested-skill\n---\n# skill')

      const result = service.scanAgentInventory('test-agent')

      expect(result.unmanaged.length).toBe(0)
    })

    it('stores AgentBro reason codes on unmanaged rows', () => {
      createAgentSkill('plain-skill')
      createAndImportSkill('center-skill', undefined, 'center version')
      createAgentSkill('center-skill', undefined, '# agent modified')

      service.scanAgentInventory('test-agent')
      const items = service.listUnmanaged().filter((item) => item.agentId === 'test-agent')

      expect(items.find((item) => item.inferredSkillId === 'plain-skill')?.reason).toBe('not_in_center_library')
      expect(items.find((item) => item.inferredSkillId === 'center-skill')?.reason).toBe('same_name_as_center_skill')
    })

    it('classifies a same-name same-content skill as unmanaged (reusable, adoptable)', () => {
      const importedDir = path.join(externalDir, 'reuse-skill')
      fs.mkdirSync(importedDir, { recursive: true })
      fs.writeFileSync(
        path.join(importedDir, 'SKILL.md'),
        '---\nname: reuse-skill\ndescription: identical\n---\n# identical body'
      )
      service.executeAddCenterSkill(
        { sourcePath: importedDir, sourceType: 'local_folder', sourceUri: importedDir },
        []
      )
      // Copy the exact same directory into the agent dir — identical content.
      fs.cpSync(importedDir, path.join(agentDir, 'reuse-skill'), { recursive: true })

      const result = service.scanAgentInventory('test-agent')

      expect(result.unmanaged.length).toBe(1)
      expect(result.conflicts.length).toBe(0)
      expect(result.unmanaged[0].inferredSkillId).toBe('reuse-skill')
    })

    it('refresh() drops unmanaged rows whose directories no longer exist', () => {
      createAgentSkill('stale-skill')
      service.scanAgentInventory('test-agent')
      expect(
        service.listUnmanaged().some((item) => item.agentId === 'test-agent')
      ).toBe(true)

      fs.rmSync(path.join(agentDir, 'stale-skill'), { recursive: true, force: true })
      service.refresh()

      expect(
        service.listUnmanaged().some((item) => item.agentId === 'test-agent')
      ).toBe(false)
    })
  })

  // ── listAgentSkillInventory ─────────────────────────────────────

  describe('listAgentSkillInventory', () => {
    it('classifies items as managed / adoptable / reusable / conflict', () => {
      // Adoptable: not in center
      createAgentSkill('inv-plain')
      // Reusable: same id + same content in center
      const importedDir = path.join(externalDir, 'inv-reuse')
      fs.mkdirSync(importedDir, { recursive: true })
      fs.writeFileSync(
        path.join(importedDir, 'SKILL.md'),
        '---\nname: inv-reuse\ndescription: identical\n---\n# identical body'
      )
      service.executeAddCenterSkill(
        { sourcePath: importedDir, sourceType: 'local_folder', sourceUri: importedDir },
        []
      )
      fs.cpSync(importedDir, path.join(agentDir, 'inv-reuse'), { recursive: true })
      // Conflict: same id + different content
      createAndImportSkill('inv-conflict', undefined, 'center version')
      createAgentSkill('inv-conflict', undefined, '# agent modified')
      // Managed: distributed to the agent
      const managedId = createAndImportSkill('inv-managed')
      const preview = service.previewDistribute([managedId], ['test-agent'], 'link')
      service.executeDistribute(preview)

      service.scanAgentInventory('test-agent')
      const inventory = service.listAgentSkillInventory()
      const agent = inventory.find((entry) => entry.agentId === 'test-agent')

      expect(agent).toBeDefined()
      expect(agent!.managedCount).toBe(1)
      expect(agent!.importableCount).toBe(2)
      expect(agent!.items.find((item) => item.skillId === 'inv-plain')).toMatchObject({
        status: 'unmanaged',
        canImport: true,
        managed: false,
      })
      expect(agent!.items.find((item) => item.skillId === 'inv-reuse')).toMatchObject({
        status: 'unmanaged_reusable',
        canImport: true,
        managed: false,
      })
      expect(agent!.items.find((item) => item.skillId === 'inv-conflict')).toMatchObject({
        status: 'conflict',
        canImport: false,
        managed: false,
      })
      expect(agent!.items.find((item) => item.skillId === 'inv-managed')).toMatchObject({
        managed: true,
        canImport: false,
      })
    })
  })

  // ── listUnmanaged ───────────────────────────────────────────────

  describe('listUnmanaged', () => {
    it('returns empty when no unmanaged items', () => {
      const items = service.listUnmanaged()
      expect(items.length).toBe(0)
    })

    it('returns unmanaged items after scanning', () => {
      createAgentSkill('unmanaged-1')
      createAgentSkill('unmanaged-2')

      service.scanAgentInventory('test-agent')
      const items = service.listUnmanaged()

      expect(items.length).toBe(2)
    })

    it('returns unmanaged items from multiple agents', () => {
      // Set up second agent
      const agent2Dir = path.join(tmpDir, 'agent2-skills')
      fs.mkdirSync(agent2Dir, { recursive: true })
      service.getDb().conn
        .prepare(
          `INSERT OR REPLACE INTO agents (id, display_name, skills_dir, config_path, enabled, last_scanned_at)
           VALUES ('test-agent-2', 'Test Agent 2', ?, NULL, 1, ?)`
        )
        .run(agent2Dir, new Date().toISOString())

      createAgentSkill('skill-from-agent-1')
      fs.mkdirSync(path.join(agent2Dir, 'skill-from-agent-2'), { recursive: true })
      fs.writeFileSync(
        path.join(agent2Dir, 'skill-from-agent-2', 'SKILL.md'),
        '---\nname: skill-from-agent-2\n---\n# test'
      )

      service.scanAgentInventory('test-agent')
      service.scanAgentInventory('test-agent-2')

      const items = service.listUnmanaged()
      expect(items.length).toBe(2)
    })
  })

  // ── previewAdopt ───────────────────────────────────────────────

  describe('previewAdopt', () => {
    it('returns preview with all three options when center has no same-name skill', () => {
      createAgentSkill('adoptable-skill')
      const scanResult = service.scanAgentInventory('test-agent')
      const unmanagedId = scanResult.unmanaged[0].id

      const preview = service.previewAdopt('test-agent', unmanagedId)

      expect(preview.agentId).toBe('test-agent')
      expect(preview.unmanagedId).toBe(unmanagedId)
      expect(preview.inferredSkillId).toBe('adoptable-skill')
      expect(preview.centerHasSameName).toBe(false)
      expect(preview.centerSkillId).toBeNull()
      expect(preview.options).toContain('import_to_center')
      expect(preview.options).toContain('replace_with_link')
      expect(preview.options).toContain('replace_with_copy')
      expect(preview.conflictReason).toBeNull()
    })

    it('returns preview with centerHasSameName=true when center has same-name skill', () => {
      createAndImportSkill('existing-skill')
      createAgentSkill('existing-skill', undefined, '# different content')
      const scanResult = service.scanAgentInventory('test-agent')
      // Should be in conflicts
      expect(scanResult.conflicts.length).toBe(1)
      const unmanagedId = scanResult.conflicts[0].id

      const preview = service.previewAdopt('test-agent', unmanagedId)

      expect(preview.centerHasSameName).toBe(true)
      expect(preview.centerSkillId).toBe('existing-skill')
      expect(preview.conflictReason).toBeTruthy()
    })

    it('throws when unmanaged ID not found', () => {
      expect(() => service.previewAdopt('test-agent', 'nonexistent')).toThrow()
    })
  })

  // ── executeAdopt ───────────────────────────────────────────────

  describe('executeAdopt', () => {
    it('import_to_center: copies to center library, keeps agent file unchanged', () => {
      createAgentSkill('import-test')
      const scanResult = service.scanAgentInventory('test-agent')
      const unmanagedId = scanResult.unmanaged[0].id

      service.executeAdopt('test-agent', unmanagedId, 'import_to_center')

      // Center library should now have the skill
      const skills = service.listCenterSkills()
      expect(skills.some((s) => s.id === 'import-test')).toBe(true)

      // Agent dir should still have the original files (not a link)
      const agentSkillDir = path.join(agentDir, 'import-test')
      const stat = fs.lstatSync(agentSkillDir)
      expect(stat.isSymbolicLink()).toBe(false)
    })

    it('import_keep: reuses the center copy when content is identical (reusable item)', () => {
      const importedDir = path.join(externalDir, 'keep-reuse')
      fs.mkdirSync(importedDir, { recursive: true })
      fs.writeFileSync(
        path.join(importedDir, 'SKILL.md'),
        '---\nname: keep-reuse\ndescription: identical\n---\n# identical body'
      )
      service.executeAddCenterSkill(
        { sourcePath: importedDir, sourceType: 'local_folder', sourceUri: importedDir },
        []
      )
      fs.cpSync(importedDir, path.join(agentDir, 'keep-reuse'), { recursive: true })

      const scanResult = service.scanAgentInventory('test-agent')
      expect(scanResult.unmanaged).toHaveLength(1)
      const unmanagedId = scanResult.unmanaged[0].id

      // Same id + same content: import_keep must succeed without a rename.
      expect(() => service.executeAdopt('test-agent', unmanagedId, 'import_keep')).not.toThrow()
      expect(service.listUnmanaged()).toHaveLength(0)
    })

    it('replace_with_link: replaces agent file with symlink, creates target record', () => {
      createAgentSkill('link-test')
      const scanResult = service.scanAgentInventory('test-agent')
      const unmanagedId = scanResult.unmanaged[0].id

      service.executeAdopt('test-agent', unmanagedId, 'replace_with_link')

      // Center library should have the skill
      const skills = service.listCenterSkills()
      expect(skills.some((s) => s.id === 'link-test')).toBe(true)

      // Agent dir should now be a symlink to center
      const agentSkillDir = path.join(agentDir, 'link-test')
      const stat = fs.lstatSync(agentSkillDir)
      // On Windows this might fallback to copy — check if link or if it's a regular dir (copy fallback)
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(agentSkillDir)
        expect(target).toContain('link-test')
      }

      // DB should have a target record
      const detail = service.getSkillDetail('link-test')
      expect(detail).not.toBeNull()
      expect(detail!.targets.length).toBe(1)
      expect(detail!.targets[0].agentId).toBe('test-agent')
      expect(detail!.targets[0].installMode).toBe('link')
    })

    it('replace_with_copy: replaces agent file with copy, creates target record', () => {
      createAgentSkill('copy-test')
      const scanResult = service.scanAgentInventory('test-agent')
      const unmanagedId = scanResult.unmanaged[0].id

      service.executeAdopt('test-agent', unmanagedId, 'replace_with_copy')

      // Center library should have the skill
      const skills = service.listCenterSkills()
      expect(skills.some((s) => s.id === 'copy-test')).toBe(true)

      // Agent dir should still exist as a regular directory (copy)
      const agentSkillDir = path.join(agentDir, 'copy-test')
      const stat = fs.lstatSync(agentSkillDir)
      expect(stat.isSymbolicLink()).toBe(false)

      // DB should have a target record with copy mode
      const detail = service.getSkillDetail('copy-test')
      expect(detail).not.toBeNull()
      expect(detail!.targets.length).toBe(1)
      expect(detail!.targets[0].installMode).toBe('copy')
      expect(detail!.targets[0].actualMode).toBe('copy')
    })

    it('removes unmanaged item from DB after adoption', () => {
      createAgentSkill('remove-test')
      const scanResult = service.scanAgentInventory('test-agent')
      expect(service.listUnmanaged().length).toBe(1)

      const unmanagedId = scanResult.unmanaged[0].id

      service.executeAdopt('test-agent', unmanagedId, 'import_to_center')

      // Should no longer be unmanaged
      expect(service.listUnmanaged().length).toBe(0)
    })

    it('throws when unmanaged ID not found', () => {
      expect(() =>
        service.executeAdopt('test-agent', 'nonexistent', 'import_to_center')
      ).toThrow()
    })
  })

  // ── executeAdoptBatch ──────────────────────────────────────────

  describe('executeAdoptBatch', () => {
    it('adopts multiple unmanaged skills in batch', () => {
      createAgentSkill('batch-1')
      createAgentSkill('batch-2')
      createAgentSkill('batch-3')

      const scanResult = service.scanAgentInventory('test-agent')
      expect(scanResult.unmanaged.length).toBe(3)

      const items: AdoptBatchItem[] = scanResult.unmanaged.map((u) => ({
        agentId: 'test-agent',
        unmanagedId: u.id,
        option: 'import_to_center' as const,
      }))

      const result = service.executeAdoptBatch(items)

      expect(result.successCount).toBe(3)
      expect(result.failureCount).toBe(0)

      // All should be in center library now
      const skills = service.listCenterSkills()
      expect(skills.some((s) => s.id === 'batch-1')).toBe(true)
      expect(skills.some((s) => s.id === 'batch-2')).toBe(true)
      expect(skills.some((s) => s.id === 'batch-3')).toBe(true)

      // No more unmanaged
      expect(service.listUnmanaged().length).toBe(0)
    })

    it('handles partial failures gracefully', () => {
      createAgentSkill('ok-skill')

      const scanResult = service.scanAgentInventory('test-agent')

      const items: AdoptBatchItem[] = [
        {
          agentId: 'test-agent',
          unmanagedId: scanResult.unmanaged[0].id,
          option: 'import_to_center' as const,
        },
        {
          agentId: 'test-agent',
          unmanagedId: 'nonexistent-id',
          option: 'import_to_center' as const,
        },
      ]

      const result = service.executeAdoptBatch(items)

      expect(result.successCount).toBe(1)
      expect(result.failureCount).toBe(1)
    })

    it('returns empty result for empty batch', () => {
      const result = service.executeAdoptBatch([])

      expect(result.successCount).toBe(0)
      expect(result.failureCount).toBe(0)
      expect(result.results.length).toBe(0)
    })

    it('batch adopt with replace_with_link creates targets for all', () => {
      createAgentSkill('link-batch-1')
      createAgentSkill('link-batch-2')

      const scanResult = service.scanAgentInventory('test-agent')

      const items: AdoptBatchItem[] = scanResult.unmanaged.map((u) => ({
        agentId: 'test-agent',
        unmanagedId: u.id,
        option: 'replace_with_link' as const,
      }))

      const result = service.executeAdoptBatch(items)

      expect(result.successCount).toBe(2)

      // Verify targets exist
      const detail1 = service.getSkillDetail('link-batch-1')
      expect(detail1!.targets.length).toBe(1)
      const detail2 = service.getSkillDetail('link-batch-2')
      expect(detail2!.targets.length).toBe(1)
    })
  })
})
