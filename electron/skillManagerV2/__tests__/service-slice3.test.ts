/**
 * Skill Manager V2 — Slice 3 Tests
 *
 * Tests for previewAddCenterSkill and executeAddCenterSkill.
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
  AddCenterSkillInput,
  AddCenterSkillDecision,
} from '@/types/skillManagerV2'

// ── Test helpers ───────────────────────────────────────────────────

let tmpDir: string
let centerPath: string
let dbPath: string
let service: SkillManagerService
let externalDir: string

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-slice3-test-'))
}

/**
 * Create a skill directory with SKILL.md.
 * By default the frontmatter name matches the directory name, so inferSkillId returns the dir name.
 * Pass skillName to set a different frontmatter name (which changes the inferred ID).
 */
function createSkillDir(
  parentDir: string,
  dirName: string,
  skillName?: string,
  description?: string
): string {
  const dir = path.join(parentDir, dirName)
  const desc = description ?? 'A test skill'
  const name = skillName ?? dirName
  const content = `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}`
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content)
  return dir
}

/** Create a skill directory with raw SKILL.md content (for custom frontmatter). */
function createSkillDirRaw(parentDir: string, dirName: string, skillMdContent: string): string {
  const dir = path.join(parentDir, dirName)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skillMdContent)
  return dir
}

function makeInput(sourcePath: string, overrides: Partial<AddCenterSkillInput> = {}): AddCenterSkillInput {
  return {
    sourcePath,
    sourceType: 'local_folder',
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('SkillManagerService — Slice 3: Import to Center Library', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir()
    centerPath = path.join(tmpDir, 'skills')
    dbPath = path.join(tmpDir, 'skill-manager', 'test.db')
    externalDir = path.join(tmpDir, 'external')
    fs.mkdirSync(externalDir, { recursive: true })
    service = SkillManagerService.bootstrap(dbPath, centerPath)
  })

  afterEach(() => {
    service.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── previewAddCenterSkill ───────────────────────────────────────

  describe('previewAddCenterSkill', () => {
    it('returns candidate with action "create" for a valid skill folder', () => {
      const skillDir = createSkillDir(externalDir, 'my-skill', undefined, 'A description')

      const preview = service.previewAddCenterSkill(makeInput(skillDir))

      expect(preview.candidates.length).toBe(1)
      expect(preview.blockers.length).toBe(0)
      const cand = preview.candidates[0]
      expect(cand.action).toBe('create')
      expect(cand.skillId).toBe('my-skill')
      expect(cand.proposedSkillId).toBe('my-skill')
      expect(cand.name).toBe('my-skill')
      expect(cand.description).toBe('A description')
      expect(cand.hash).toBeTruthy()
      expect(cand.sourceDir).toBe(skillDir)
      expect(cand.reason).toBeNull()
      expect(cand.existingSourceType).toBeNull()
    })

    it('returns centerPath in the preview', () => {
      const skillDir = createSkillDir(externalDir, 'path-test')

      const preview = service.previewAddCenterSkill(makeInput(skillDir))

      expect(preview.centerPath).toBe(centerPath)
    })

    it('throws when source path does not contain SKILL.md', () => {
      const notSkillDir = path.join(externalDir, 'not-a-skill')
      fs.mkdirSync(notSkillDir, { recursive: true })
      fs.writeFileSync(path.join(notSkillDir, 'README.md'), '# Not a skill')

      expect(() => service.previewAddCenterSkill(makeInput(notSkillDir))).toThrow()
    })

    it('throws when source path does not exist', () => {
      const ghost = path.join(externalDir, 'ghost')

      expect(() => service.previewAddCenterSkill(makeInput(ghost))).toThrow()
    })

    it('returns candidate with action "update" for same-name same-source skill', () => {
      // First, import a skill into the center
      const skillDir1 = createSkillDir(externalDir, 'shared-skill', undefined, 'v1')
      const input1 = makeInput(skillDir1, { sourceType: 'local_folder', sourceUri: skillDir1 })
      service.executeAddCenterSkill(input1, [])

      // Now create a modified version at the same source path
      fs.writeFileSync(
        path.join(skillDir1, 'SKILL.md'),
        '---\nname: shared-skill\ndescription: v2\n---\n# shared-skill v2'
      )

      const preview = service.previewAddCenterSkill(makeInput(skillDir1, { sourceUri: skillDir1 }))

      expect(preview.candidates.length).toBe(1)
      const cand = preview.candidates[0]
      expect(cand.action).toBe('update')
      expect(cand.skillId).toBe('shared-skill')
    })

    it('returns blocker with action "blocked" for same-name different-source skill', () => {
      // First, import a skill from one source
      const skillDir1 = createSkillDir(externalDir, 'conflict-skill', undefined, 'from source A')
      const input1 = makeInput(skillDir1, { sourceType: 'local_folder', sourceUri: '/source/A' })
      service.executeAddCenterSkill(input1, [])

      // Now try to import a different skill with the same inferred ID from a different source
      const skillDir2 = createSkillDirRaw(
        externalDir,
        'conflict-skill-v2',
        '---\nname: conflict-skill\ndescription: from source B\n---\n# Different content'
      )

      const preview = service.previewAddCenterSkill(
        makeInput(skillDir2, { sourceType: 'github', sourceUri: 'https://github.com/example/repo' })
      )

      // The blocker should be in the blockers array
      expect(preview.blockers.length).toBe(1)
      const blocker = preview.blockers[0]
      expect(blocker.action).toBe('blocked')
      expect(blocker.skillId).toBe('conflict-skill')
      expect(blocker.reason).toBeTruthy()
      expect(blocker.reason).toContain('conflict-skill')
    })

    it('detects multiple skills when source is a parent directory (multi mode)', () => {
      const parentDir = path.join(externalDir, 'multi-source')
      fs.mkdirSync(parentDir, { recursive: true })
      createSkillDir(parentDir, 'skill-a')
      createSkillDir(parentDir, 'skill-b')
      // Add a non-skill directory that should be ignored
      fs.mkdirSync(path.join(parentDir, 'not-a-skill'), { recursive: true })
      fs.writeFileSync(path.join(parentDir, 'not-a-skill', 'README.md'), '# Not a skill')

      const preview = service.previewAddCenterSkill(makeInput(parentDir, { multi: true }))

      expect(preview.candidates.length).toBe(2)
      const ids = preview.candidates.map((c) => c.skillId).sort()
      expect(ids).toEqual(['skill-a', 'skill-b'])
    })

    it('increments unchangedCount when source hash matches existing center hash', () => {
      // Import a skill
      const skillDir = createSkillDir(externalDir, 'unchanged-skill')
      const input = makeInput(skillDir, { sourceUri: skillDir })
      service.executeAddCenterSkill(input, [])

      // Preview the same source again (content unchanged)
      const preview = service.previewAddCenterSkill(input)

      expect(preview.unchangedCount).toBe(1)
      expect(preview.candidates.length).toBe(0)
      expect(preview.blockers.length).toBe(0)
    })

    it('parses frontmatter name as skillId when present', () => {
      const skillDir = createSkillDirRaw(
        externalDir,
        'dir-name',
        '---\nname: Frontmatter Name\ndescription: Test\n---\n# Content'
      )

      const preview = service.previewAddCenterSkill(makeInput(skillDir))

      expect(preview.candidates.length).toBe(1)
      // The ID should be derived from the frontmatter name, sanitized
      expect(preview.candidates[0].skillId).toBe('Frontmatter-Name')
      expect(preview.candidates[0].name).toBe('Frontmatter Name')
    })
  })

  // ── executeAddCenterSkill ───────────────────────────────────────

  describe('executeAddCenterSkill', () => {
    it('copies skill to center library directory on create', () => {
      const skillDir = createSkillDir(externalDir, 'new-skill', undefined, 'Fresh')

      const result = service.executeAddCenterSkill(makeInput(skillDir), [])

      expect(result.skillIds).toContain('new-skill')
      expect(result.updated).toEqual([])
      expect(result.skipped).toEqual([])

      // Verify directory exists in center library
      const centerSkillDir = path.join(centerPath, 'new-skill')
      expect(fs.existsSync(centerSkillDir)).toBe(true)
      expect(fs.existsSync(path.join(centerSkillDir, 'SKILL.md'))).toBe(true)
    })

    it('writes skill record to DB on create', () => {
      const skillDir = createSkillDir(externalDir, 'db-skill')

      service.executeAddCenterSkill(makeInput(skillDir), [])

      const skills = service.listCenterSkills()
      expect(skills.some((s) => s.id === 'db-skill')).toBe(true)
    })

    it('writes skill_source record to DB on create', () => {
      const skillDir = createSkillDir(externalDir, 'sourced-skill')

      service.executeAddCenterSkill(
        makeInput(skillDir, { sourceType: 'local_folder', sourceUri: skillDir })
      , [])

      const detail = service.getSkillDetail('sourced-skill')
      expect(detail).not.toBeNull()
      expect(detail!.source).not.toBeNull()
      expect(detail!.source!.sourceType).toBe('local_folder')
      expect(detail!.source!.sourceUri).toBe(skillDir)
    })

    it('updates existing skill on update action', () => {
      const skillDir = createSkillDir(externalDir, 'update-skill', undefined, 'v1')
      const input = makeInput(skillDir, { sourceUri: skillDir })

      // First import
      service.executeAddCenterSkill(input, [])

      // Modify source
      fs.writeFileSync(
        path.join(skillDir, 'SKILL.md'),
        '---\nname: update-skill\ndescription: v2\n---\n# Updated'
      )

      // Preview to get update action
      const preview = service.previewAddCenterSkill(input)
      expect(preview.candidates[0].action).toBe('update')

      // Execute update
      const result = service.executeAddCenterSkill(input, [])

      expect(result.updated).toContain('update-skill')
      expect(result.skillIds).toEqual([])

      // Verify content was updated in center
      const detail = service.getSkillDetail('update-skill')
      expect(detail).not.toBeNull()
      expect(detail!.description).toBe('v2')
    })

    it('creates skill with new ID when decision resolution is "create" (rename)', () => {
      // First, import a skill
      const skillDir1 = createSkillDir(externalDir, 'rename-skill', undefined, 'original')
      service.executeAddCenterSkill(
        makeInput(skillDir1, { sourceType: 'local_folder', sourceUri: '/source/A' })
      , [])

      // Now create a different skill with the same inferred ID from a different source
      const skillDir2 = createSkillDirRaw(
        externalDir,
        'rename-skill-v2',
        '---\nname: rename-skill\ndescription: different\n---\n# Different'
      )

      const input2 = makeInput(skillDir2, { sourceType: 'github', sourceUri: 'https://github.com/example/repo' })

      // Preview to get blocker
      const preview = service.previewAddCenterSkill(input2)
      expect(preview.blockers.length).toBe(1)
      expect(preview.blockers[0].skillId).toBe('rename-skill')

      // Execute with rename decision
      const decisions: AddCenterSkillDecision[] = [
        { skillId: 'rename-skill', proposedSkillId: 'rename-skill-imported', resolution: 'create' },
      ]
      const result = service.executeAddCenterSkill(input2, decisions)

      expect(result.skillIds).toContain('rename-skill-imported')

      // Both should exist in center
      expect(fs.existsSync(path.join(centerPath, 'rename-skill'))).toBe(true)
      expect(fs.existsSync(path.join(centerPath, 'rename-skill-imported'))).toBe(true)
    })

    it('skips skill when decision resolution is "skip"', () => {
      // First, import a skill
      const skillDir1 = createSkillDir(externalDir, 'skip-skill', undefined, 'original')
      service.executeAddCenterSkill(
        makeInput(skillDir1, { sourceType: 'local_folder', sourceUri: '/source/A' })
      , [])

      // Try to import a different skill with the same name
      const skillDir2 = createSkillDirRaw(
        externalDir,
        'skip-skill-v2',
        '---\nname: skip-skill\ndescription: different\n---\n# Different'
      )

      const input2 = makeInput(skillDir2, { sourceType: 'github', sourceUri: 'https://github.com/example/repo' })

      const decisions: AddCenterSkillDecision[] = [
        { skillId: 'skip-skill', resolution: 'skip' },
      ]
      const result = service.executeAddCenterSkill(input2, decisions)

      expect(result.skipped).toContain('skip-skill')
      expect(result.skillIds).toEqual([])

      // Center library should only have the original
      const skills = service.listCenterSkills()
      expect(skills.filter((s) => s.id === 'skip-skill').length).toBe(1)
    })

    it('overwrites existing skill when blocked and decision is "update"', () => {
      // First, import a skill
      const skillDir1 = createSkillDir(externalDir, 'overwrite-skill', undefined, 'original')
      service.executeAddCenterSkill(
        makeInput(skillDir1, { sourceType: 'local_folder', sourceUri: '/source/A' })
      , [])

      // Create a different skill with the same name from a different source
      const skillDir2 = createSkillDirRaw(
        externalDir,
        'overwrite-skill-v2',
        '---\nname: overwrite-skill\ndescription: overwritten\n---\n# New content'
      )

      const input2 = makeInput(skillDir2, { sourceType: 'github', sourceUri: 'https://github.com/example/repo' })

      const decisions: AddCenterSkillDecision[] = [
        { skillId: 'overwrite-skill', resolution: 'update' },
      ]
      const result = service.executeAddCenterSkill(input2, decisions)

      expect(result.updated).toContain('overwrite-skill')

      // Verify content was overwritten
      const detail = service.getSkillDetail('overwrite-skill')
      expect(detail).not.toBeNull()
      expect(detail!.description).toBe('overwritten')
    })

    it('throws when blocked skill has no explicit decision', () => {
      // First, import a skill
      const skillDir1 = createSkillDir(externalDir, 'no-decision-skill', undefined, 'original')
      service.executeAddCenterSkill(
        makeInput(skillDir1, { sourceType: 'local_folder', sourceUri: '/source/A' })
      , [])

      // Create a conflicting skill
      const skillDir2 = createSkillDirRaw(
        externalDir,
        'no-decision-v2',
        '---\nname: no-decision-skill\ndescription: different\n---\n# Different'
      )

      const input2 = makeInput(skillDir2, { sourceType: 'github', sourceUri: '/source/B' })

      // No decisions provided for the blocker
      expect(() => service.executeAddCenterSkill(input2, [])).toThrow()
    })

    it('supports multi-import from parent directory', () => {
      const parentDir = path.join(externalDir, 'multi-import')
      fs.mkdirSync(parentDir, { recursive: true })
      createSkillDir(parentDir, 'multi-a', undefined, 'Skill A')
      createSkillDir(parentDir, 'multi-b', undefined, 'Skill B')

      const result = service.executeAddCenterSkill(
        makeInput(parentDir, { multi: true })
      , [])

      expect(result.skillIds).toContain('multi-a')
      expect(result.skillIds).toContain('multi-b')

      // Verify both exist in center
      expect(fs.existsSync(path.join(centerPath, 'multi-a'))).toBe(true)
      expect(fs.existsSync(path.join(centerPath, 'multi-b'))).toBe(true)
    })

    it('auto-scans center library after execute, making new skills appear in list', () => {
      const skillDir = createSkillDir(externalDir, 'scan-after-import')

      service.executeAddCenterSkill(makeInput(skillDir), [])

      const skills = service.listCenterSkills()
      expect(skills.some((s) => s.id === 'scan-after-import')).toBe(true)
    })
  })
})
