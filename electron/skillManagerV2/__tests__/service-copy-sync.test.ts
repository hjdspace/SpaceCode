/**
 * Skill Manager V2 — Copy Sync Tests
 *
 * Tests for previewSyncCopy, executeSyncCopy, previewCopyTargetDiff.
 * TDD: written to verify the implementation.
 *
 * Seam: SkillManagerService public methods.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SkillManagerService } from '../service'
import type {
  CopySyncPreview,
  CopySyncResult,
  CopyTargetDiffPreview,
  DistributionPreview,
} from '@/types/skillManagerV2'

// ── Test helpers ───────────────────────────────────────────────────

let tmpDir: string
let centerPath: string
let dbPath: string
let service: SkillManagerService
let externalDir: string
let agentDir: string

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-copysync-test-'))
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

/**
 * Distribute a skill as a copy to an agent and return the target ID.
 */
function distributeCopyAndGetTargetId(skillId: string, agentId: string): string {
  const preview: DistributionPreview = service.previewDistribute(
    [skillId],
    [agentId],
    'copy'
  )
  service.executeDistribute(preview)
  return `${skillId}__${agentId}`
}

/** Write content to a file inside a skill directory. */
function writeSkillFile(skillDir: string, fileName: string, content: string): void {
  fs.writeFileSync(path.join(skillDir, fileName), content)
}

/** Read content from a file inside a skill directory. */
function readSkillFile(skillDir: string, fileName: string): string {
  return fs.readFileSync(path.join(skillDir, fileName), 'utf-8')
}

// ── Tests ──────────────────────────────────────────────────────────

describe('SkillManagerService — Copy Sync', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir()
    centerPath = path.join(tmpDir, 'skills')
    dbPath = path.join(tmpDir, 'skill-manager', 'test.db')
    externalDir = path.join(tmpDir, 'external')
    agentDir = path.join(tmpDir, 'agent-skills')
    fs.mkdirSync(externalDir, { recursive: true })
    fs.mkdirSync(agentDir, { recursive: true })

    service = SkillManagerService.bootstrap(dbPath, centerPath)
    registerAgent('sync-agent', 'Sync Agent', agentDir)
  })

  afterEach(() => {
    service.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── previewSyncCopy ─────────────────────────────────────────────

  describe('previewSyncCopy', () => {
    it('returns status ok when both center and agent match source hash', () => {
      const skillId = createAndImportSkill('sync-ok-skill')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      const preview: CopySyncPreview = service.previewSyncCopy(targetId)

      expect(preview.targetId).toBe(targetId)
      expect(preview.skillId).toBe(skillId)
      expect(preview.status).toBe('ok')
      expect(preview.suggested).toBe('none')
      expect(preview.centerHash).toBe(preview.sourceHash)
      expect(preview.agentHash).toBe(preview.sourceHash)
    })

    it('returns copy_outdated when center changed but agent copy did not', () => {
      const skillId = createAndImportSkill('sync-outdated-skill')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Modify the center library copy
      const centerSkillDir = path.join(centerPath, skillId)
      writeSkillFile(centerSkillDir, 'SKILL.md',
        '---\nname: sync-outdated-skill\ndescription: Updated\n---\n# Updated'
      )

      const preview = service.previewSyncCopy(targetId)

      expect(preview.status).toBe('copy_outdated')
      expect(preview.suggested).toBe('center_over_agent')
      expect(preview.centerHash).not.toBe(preview.sourceHash)
    })

    it('returns copy_modified when agent copy changed but center did not', () => {
      const skillId = createAndImportSkill('sync-modified-skill')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Modify the agent copy
      const agentSkillDir = path.join(agentDir, skillId)
      writeSkillFile(agentSkillDir, 'SKILL.md',
        '---\nname: sync-modified-skill\ndescription: Agent edited\n---\n# Agent edited'
      )

      const preview = service.previewSyncCopy(targetId)

      expect(preview.status).toBe('copy_modified')
      expect(preview.suggested).toBe('agent_over_center')
      expect(preview.agentHash).not.toBe(preview.sourceHash)
    })

    it('returns copy_diverged when both center and agent changed', () => {
      const skillId = createAndImportSkill('sync-diverged-skill')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Modify both center and agent copies
      const centerSkillDir = path.join(centerPath, skillId)
      writeSkillFile(centerSkillDir, 'SKILL.md',
        '---\nname: sync-diverged-skill\ndescription: Center version\n---\n# Center'
      )

      const agentSkillDir = path.join(agentDir, skillId)
      writeSkillFile(agentSkillDir, 'SKILL.md',
        '---\nname: sync-diverged-skill\ndescription: Agent version\n---\n# Agent'
      )

      const preview = service.previewSyncCopy(targetId)

      expect(preview.status).toBe('copy_diverged')
      expect(preview.suggested).toBe('manual')
    })

    it('throws for non-existent target', () => {
      expect(() => service.previewSyncCopy('nonexistent-target')).toThrow()
    })

    it('throws for link targets (only copy targets are syncable)', () => {
      const skillId = createAndImportSkill('sync-link-skill')

      // Distribute as link instead of copy
      const preview = service.previewDistribute([skillId], ['sync-agent'], 'link')
      service.executeDistribute(preview)

      const targetId = `${skillId}__sync-agent`
      expect(() => service.previewSyncCopy(targetId)).toThrow()
    })
  })

  // ── executeSyncCopy ─────────────────────────────────────────────

  describe('executeSyncCopy', () => {
    it('center_over_agent overwrites agent copy with center version', () => {
      const skillId = createAndImportSkill('exec-center-over-agent')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Modify center
      const centerSkillDir = path.join(centerPath, skillId)
      writeSkillFile(centerSkillDir, 'extra.txt', 'center content')

      // Verify agent doesn't have the file yet
      const agentSkillDir = path.join(agentDir, skillId)
      expect(fs.existsSync(path.join(agentSkillDir, 'extra.txt'))).toBe(false)

      const result: CopySyncResult = service.executeSyncCopy(targetId, 'center_over_agent')

      expect(result.success).toBe(true)
      expect(result.action).toBe('center_over_agent')
      expect(result.preview).not.toBeNull()
      expect(result.preview!.status).toBe('ok')

      // Agent copy should now have the extra file
      expect(fs.existsSync(path.join(agentSkillDir, 'extra.txt'))).toBe(true)
      expect(readSkillFile(agentSkillDir, 'extra.txt')).toBe('center content')
    })

    it('agent_over_center overwrites center library with agent copy', () => {
      const skillId = createAndImportSkill('exec-agent-over-center')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Modify agent copy
      const agentSkillDir = path.join(agentDir, skillId)
      writeSkillFile(agentSkillDir, 'agent-only.txt', 'agent content')

      // Verify center doesn't have the file yet
      const centerSkillDir = path.join(centerPath, skillId)
      expect(fs.existsSync(path.join(centerSkillDir, 'agent-only.txt'))).toBe(false)

      const result = service.executeSyncCopy(targetId, 'agent_over_center')

      expect(result.success).toBe(true)
      expect(result.action).toBe('agent_over_center')
      expect(result.preview!.status).toBe('ok')

      // Center should now have the file
      expect(fs.existsSync(path.join(centerSkillDir, 'agent-only.txt'))).toBe(true)
      expect(readSkillFile(centerSkillDir, 'agent-only.txt')).toBe('agent content')
    })

    it('manual preserves diverged state without file writes', () => {
      const skillId = createAndImportSkill('exec-manual')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Diverge both sides
      const centerSkillDir = path.join(centerPath, skillId)
      writeSkillFile(centerSkillDir, 'center.txt', 'center')

      const agentSkillDir = path.join(agentDir, skillId)
      writeSkillFile(agentSkillDir, 'agent.txt', 'agent')

      const result = service.executeSyncCopy(targetId, 'manual')

      expect(result.success).toBe(true)
      expect(result.action).toBe('manual')

      // Both files should still exist (no writes occurred)
      expect(fs.existsSync(path.join(centerSkillDir, 'center.txt'))).toBe(true)
      expect(fs.existsSync(path.join(agentSkillDir, 'agent.txt'))).toBe(true)
      // Neither side should have the other's file
      expect(fs.existsSync(path.join(centerSkillDir, 'agent.txt'))).toBe(false)
      expect(fs.existsSync(path.join(agentSkillDir, 'center.txt'))).toBe(false)
    })

    it('after center_over_agent sync, a second preview shows ok status', () => {
      const skillId = createAndImportSkill('exec-double-sync')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Modify center
      const centerSkillDir = path.join(centerPath, skillId)
      writeSkillFile(centerSkillDir, 'SKILL.md',
        '---\nname: exec-double-sync\ndescription: Changed\n---\n# Changed'
      )

      // First sync
      service.executeSyncCopy(targetId, 'center_over_agent')

      // Second preview should show ok
      const preview = service.previewSyncCopy(targetId)
      expect(preview.status).toBe('ok')
    })

    it('after agent_over_center sync, source type is updated to agent_override', () => {
      const skillId = createAndImportSkill('exec-override-source')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Modify agent copy
      const agentSkillDir = path.join(agentDir, skillId)
      writeSkillFile(agentSkillDir, 'override.txt', 'override content')

      service.executeSyncCopy(targetId, 'agent_over_center')

      // Check source type
      const sourceRow = service.getDb().conn.prepare(
        'SELECT source_type FROM skill_sources WHERE skill_id = ?'
      ).get(skillId) as { source_type: string }

      expect(sourceRow.source_type).toBe('agent_override')
    })
  })

  // ── previewCopyTargetDiff ───────────────────────────────────────

  describe('previewCopyTargetDiff', () => {
    it('returns empty files when content is identical', () => {
      const skillId = createAndImportSkill('diff-identical')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      const diff: CopyTargetDiffPreview = service.previewCopyTargetDiff(targetId)

      expect(diff.targetId).toBe(targetId)
      expect(diff.skillId).toBe(skillId)
      expect(diff.files.length).toBe(0)
    })

    it('shows modified for files that differ between center and agent', () => {
      const skillId = createAndImportSkill('diff-modified')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Modify center SKILL.md
      const centerSkillDir = path.join(centerPath, skillId)
      writeSkillFile(centerSkillDir, 'SKILL.md',
        '---\nname: diff-modified\ndescription: Center changed\n---\n# Changed'
      )

      const diff = service.previewCopyTargetDiff(targetId)

      expect(diff.files.length).toBe(1)
      expect(diff.files[0].path).toBe('SKILL.md')
      expect(diff.files[0].changeType).toBe('modified')
      expect(diff.files[0].centerContent).not.toBe(diff.files[0].copyContent)
    })

    it('shows copy_removed for files in center but not in agent copy', () => {
      const skillId = createAndImportSkill('diff-removed')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Add a new file to center only
      const centerSkillDir = path.join(centerPath, skillId)
      writeSkillFile(centerSkillDir, 'new-file.txt', 'center only')

      const diff = service.previewCopyTargetDiff(targetId)

      const removedFile = diff.files.find((f) => f.changeType === 'copy_removed')
      expect(removedFile).toBeTruthy()
      expect(removedFile!.path).toBe('new-file.txt')
      expect(removedFile!.centerContent).toBe('center only')
      expect(removedFile!.copyContent).toBeNull()
    })

    it('shows copy_added for files in agent copy but not in center', () => {
      const skillId = createAndImportSkill('diff-added')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      // Add a new file to agent copy only
      const agentSkillDir = path.join(agentDir, skillId)
      writeSkillFile(agentSkillDir, 'agent-only.txt', 'agent only')

      const diff = service.previewCopyTargetDiff(targetId)

      const addedFile = diff.files.find((f) => f.changeType === 'copy_added')
      expect(addedFile).toBeTruthy()
      expect(addedFile!.path).toBe('agent-only.txt')
      expect(addedFile!.centerContent).toBeNull()
      expect(addedFile!.copyContent).toBe('agent only')
    })

    it('detects multiple changes across different files', () => {
      const skillId = createAndImportSkill('diff-multi')
      const targetId = distributeCopyAndGetTargetId(skillId, 'sync-agent')

      const centerSkillDir = path.join(centerPath, skillId)
      const agentSkillDir = path.join(agentDir, skillId)

      // Center gets a new file
      writeSkillFile(centerSkillDir, 'center-new.txt', 'center')
      // Agent gets a new file
      writeSkillFile(agentSkillDir, 'agent-new.txt', 'agent')
      // Modify SKILL.md in center
      writeSkillFile(centerSkillDir, 'SKILL.md',
        '---\nname: diff-multi\ndescription: Multi\n---\n# Multi'
      )

      const diff = service.previewCopyTargetDiff(targetId)

      expect(diff.files.length).toBe(3)
      const changeTypes = diff.files.map((f) => f.changeType).sort()
      expect(changeTypes).toEqual(['copy_added', 'copy_removed', 'modified'])
    })

    it('throws for non-existent target', () => {
      expect(() => service.previewCopyTargetDiff('nonexistent-target')).toThrow()
    })
  })
})
