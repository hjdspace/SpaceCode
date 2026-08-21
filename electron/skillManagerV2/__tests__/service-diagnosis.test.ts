import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { SkillManagerService } from '../service'
import { setHomeOverride } from '../fsutil'
import type { DiagnosisIssue } from '@/types/skillManagerV2'

// 版本探测会真实 spawn npm/CLI 进程，测试里固定返回值保持确定性
vi.mock('../agentVersions', () => ({
  detectAgentVersion: vi.fn(async (agentId: string) =>
    agentId === 'claude-code' ? '2.1.0' : null
  ),
}))

// ── Test helpers ───────────────────────────────────────────────────

let tmpDir: string
let centerPath: string
let dbPath: string
let agentDir: string
let service: SkillManagerService

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-diag-test-'))
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

describe('SkillManagerService — Diagnosis Engine', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir()
    setHomeOverride(path.join(tmpDir, 'home'))
    centerPath = path.join(tmpDir, 'skills')
    agentDir = path.join(tmpDir, 'claude-skills')
    dbPath = path.join(tmpDir, 'skill-manager', 'test.db')

    fs.mkdirSync(agentDir, { recursive: true })

    // Override the built-in agent's skills_dir to our temp agent dir
    service = SkillManagerService.bootstrap(dbPath, centerPath)
    // Update agent skills_dir for test
    service.getDb().conn.prepare(
      'UPDATE agents SET skills_dir = ? WHERE id = ?'
    ).run(agentDir, 'claude-code')
  })

  afterEach(() => {
    setHomeOverride(null)
    service.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── runDiagnosis ──────────────────────────────────────────────

  describe('runDiagnosis', () => {
    it('can rerun without violating stable issue IDs', () => {
      createSkillDir(centerPath, 'repeat-orphan', 'Repeat Orphan')

      const first = service.runDiagnosis()
      const second = service.runDiagnosis()

      expect(first.some((issue) => issue.entityId === 'repeat-orphan')).toBe(true)
      expect(second.some((issue) => issue.entityId === 'repeat-orphan')).toBe(true)
      expect(service.listDiagnosisIssues().filter((issue) => issue.entityId === 'repeat-orphan')).toHaveLength(1)
    })

    it('returns empty issues on a clean system', () => {
      createSkillDir(centerPath, 'clean-skill', 'Clean Skill')
      service.refresh()

      const issues = service.runDiagnosis()
      expect(issues).toBeDefined()
      // A clean system should have zero or very few issues
      const unresolved = issues.filter((i) => i.resolvedAt === null)
      expect(unresolved.length).toBe(0)
    })

    it('detects unmanaged center library directories', () => {
      // Create a skill directory in center library that won't be in DB
      createSkillDir(centerPath, 'orphan-skill', 'Orphan Skill')
      // Don't call refresh — so the skill dir exists on disk but not in DB

      const issues = service.runDiagnosis()
      const centerDirIssues = issues.filter(
        (i) => i.issueType === 'unmanaged_center_dir'
      )
      expect(centerDirIssues.length).toBeGreaterThan(0)
      expect(centerDirIssues.some((i) => i.title.includes('orphan-skill'))).toBe(true)
    })

    it('detects agent unmanaged skills', () => {
      // Create a skill in center library and scan
      createSkillDir(centerPath, 'managed-skill', 'Managed')
      service.refresh()

      // Create an unmanaged skill in agent dir
      createSkillDir(agentDir, 'rogue-skill', 'Rogue Skill')

      // Scan agent to populate unmanaged items
      service.scanAgentInventory('claude-code')

      const issues = service.runDiagnosis()
      const unmanagedIssues = issues.filter(
        (i) => i.issueType === 'agent_unmanaged_skill'
      )
      expect(unmanagedIssues.length).toBeGreaterThan(0)
      expect(unmanagedIssues.some((i) => i.detail.includes('rogue-skill'))).toBe(true)
    })

    it('detects broken link targets', () => {
      // Create and scan a skill
      createSkillDir(centerPath, 'linkable-skill', 'Linkable')
      service.refresh()

      // Distribute as link to agent
      const preview = service.previewDistribute(['linkable-skill'], ['claude-code'], 'link')
      service.executeDistribute(preview)

      // Delete the center library directory to create a broken link
      fs.rmSync(path.join(centerPath, 'linkable-skill'), { recursive: true, force: true })

      const issues = service.runDiagnosis()
      const brokenLinkIssues = issues.filter(
        (i) => i.issueType === 'broken_link'
      )
      expect(brokenLinkIssues.length).toBeGreaterThan(0)
    })

    it('detects stale targets (DB has record but file missing)', () => {
      createSkillDir(centerPath, 'stale-skill', 'Stale')
      service.refresh()

      // Distribute as copy to agent
      const preview = service.previewDistribute(['stale-skill'], ['claude-code'], 'copy')
      service.executeDistribute(preview)

      // Remove the agent-side file
      fs.rmSync(path.join(agentDir, 'stale-skill'), { recursive: true, force: true })

      const issues = service.runDiagnosis()
      const staleIssues = issues.filter(
        (i) => i.issueType === 'stale_target'
      )
      expect(staleIssues.length).toBeGreaterThan(0)
    })

    it('detects copy diverged targets', () => {
      createSkillDir(centerPath, 'diverge-skill', 'Diverge')
      service.refresh()

      // Distribute as copy
      const preview = service.previewDistribute(['diverge-skill'], ['claude-code'], 'copy')
      service.executeDistribute(preview)

      // Modify both center and agent copies
      fs.writeFileSync(
        path.join(centerPath, 'diverge-skill', 'SKILL.md'),
        '---\nname: Diverge\ndescription: Center changed\n---\n# Diverge'
      )
      fs.writeFileSync(
        path.join(agentDir, 'diverge-skill', 'SKILL.md'),
        '---\nname: Diverge\ndescription: Agent changed\n---\n# Diverge'
      )

      // Update center hash
      service.refresh()

      const issues = service.runDiagnosis()
      const divergedIssues = issues.filter(
        (i) => i.issueType === 'copy_diverged'
      )
      expect(divergedIssues.length).toBeGreaterThan(0)
    })

    it('clears old issues and replaces with new ones on re-run', () => {
      // Create an orphan dir to generate an issue
      createSkillDir(centerPath, 'orphan-1', 'Orphan 1')

      const firstRun = service.runDiagnosis()
      expect(firstRun.length).toBeGreaterThan(0)

      // Fix the issue by scanning the center library
      service.refresh()

      const secondRun = service.runDiagnosis()
      const unresolved = secondRun.filter((i) => i.resolvedAt === null)
      // The orphan-1 issue should be gone
      expect(unresolved.find((i) => i.title.includes('orphan-1'))).toBeUndefined()
    })
  })

  // ── executeSafeFixes ──────────────────────────────────────────

  describe('executeSafeFixes', () => {
    it('removes stale targets with auto fix', () => {
      createSkillDir(centerPath, 'stale-skill', 'Stale')
      service.refresh()

      const preview = service.previewDistribute(['stale-skill'], ['claude-code'], 'copy')
      service.executeDistribute(preview)

      // Remove the agent-side file to make target stale
      fs.rmSync(path.join(agentDir, 'stale-skill'), { recursive: true, force: true })

      // Run diagnosis to detect the stale target
      service.runDiagnosis()

      // Execute safe fixes
      const result = service.executeSafeFixes()
      expect(result.fixedCount).toBeGreaterThan(0)

      // Verify the target is gone from DB
      const targets = service.getDb().conn.prepare(
        'SELECT id FROM skill_targets WHERE skill_id = ?'
      ).all('stale-skill')
      expect(targets.length).toBe(0)
    })

    it('removes broken links with auto fix', () => {
      createSkillDir(centerPath, 'linkable-skill', 'Linkable')
      service.refresh()

      const preview = service.previewDistribute(['linkable-skill'], ['claude-code'], 'link')
      service.executeDistribute(preview)

      // Delete the center library directory
      fs.rmSync(path.join(centerPath, 'linkable-skill'), { recursive: true, force: true })

      // Run diagnosis and fix
      service.runDiagnosis()
      const result = service.executeSafeFixes()
      expect(result.fixedCount).toBeGreaterThan(0)

      // Verify the target is removed
      const targets = service.getDb().conn.prepare(
        'SELECT id FROM skill_targets WHERE skill_id = ?'
      ).all('linkable-skill')
      expect(targets.length).toBe(0)
    })

    it('does not fix confirm or manual level issues', () => {
      createSkillDir(centerPath, 'diverge-skill', 'Diverge')
      service.refresh()

      const preview = service.previewDistribute(['diverge-skill'], ['claude-code'], 'copy')
      service.executeDistribute(preview)

      // Modify both copies to create divergence
      fs.writeFileSync(
        path.join(centerPath, 'diverge-skill', 'SKILL.md'),
        '---\nname: Diverge\ndescription: Center\n---\n# Diverge'
      )
      fs.writeFileSync(
        path.join(agentDir, 'diverge-skill', 'SKILL.md'),
        '---\nname: Diverge\ndescription: Agent\n---\n# Diverge'
      )
      service.refresh()

      service.runDiagnosis()
      const result = service.executeSafeFixes()
      // Diverged copy is confirm-level, not auto
      expect(result.fixedCount).toBe(0)
    })

    it('returns summary of what was fixed', () => {
      createSkillDir(centerPath, 'stale-skill', 'Stale')
      service.refresh()

      const preview = service.previewDistribute(['stale-skill'], ['claude-code'], 'copy')
      service.executeDistribute(preview)

      fs.rmSync(path.join(agentDir, 'stale-skill'), { recursive: true, force: true })

      service.runDiagnosis()
      const result = service.executeSafeFixes()
      expect(result).toHaveProperty('fixedCount')
      expect(result).toHaveProperty('details')
      expect(Array.isArray(result.details)).toBe(true)
    })
  })

  // ── listDiagnosisIssues after runDiagnosis ───────────────────

  describe('listDiagnosisIssues after runDiagnosis', () => {
    it('returns unresolved issues sorted by severity', () => {
      createSkillDir(centerPath, 'orphan-skill', 'Orphan')
      // Also create a stale target
      createSkillDir(centerPath, 'stale-skill', 'Stale')
      service.refresh()

      const preview = service.previewDistribute(['stale-skill'], ['claude-code'], 'copy')
      service.executeDistribute(preview)
      fs.rmSync(path.join(agentDir, 'stale-skill'), { recursive: true, force: true })

      service.runDiagnosis()
      const issues = service.listDiagnosisIssues()
      expect(issues.length).toBeGreaterThan(0)

      // Check severity ordering: error before warning before info
      const severityOrder = { error: 0, warning: 1, info: 2 }
      for (let i = 1; i < issues.length; i++) {
        const prev = severityOrder[issues[i - 1].severity]
        const curr = severityOrder[issues[i].severity]
        expect(prev).toBeLessThanOrEqual(curr)
      }
    })
  })

  // ── exportSnapshot ───────────────────────────────────────────

  describe('exportSnapshot', () => {
    it('returns a valid JSON snapshot with all sections', () => {
      createSkillDir(centerPath, 'snap-skill', 'Snap Skill')
      service.refresh()

      const snapshot = service.exportSnapshot()
      expect(snapshot).toBeDefined()
      expect(snapshot.version).toBe(1)
      expect(snapshot.skills).toBeDefined()
      expect(Array.isArray(snapshot.skills)).toBe(true)
      expect(snapshot.skills.length).toBe(1)
      expect(snapshot.agents).toBeDefined()
      expect(Array.isArray(snapshot.agents)).toBe(true)
      expect(snapshot.targets).toBeDefined()
      expect(Array.isArray(snapshot.targets)).toBe(true)
      expect(snapshot.packs).toBeDefined()
      expect(Array.isArray(snapshot.packs)).toBe(true)
      expect(snapshot.issues).toBeDefined()
      expect(Array.isArray(snapshot.issues)).toBe(true)
      expect(snapshot.settings).toBeDefined()
      expect(snapshot.exportedAt).toBeDefined()
    })

    it('includes skill metadata in snapshot', () => {
      createSkillDir(centerPath, 'meta-skill', 'Meta Skill')
      service.refresh()

      const snapshot = service.exportSnapshot()
      const skill = snapshot.skills.find((s) => s['id'] === 'meta-skill')
      expect(skill).toBeDefined()
      expect(skill!['name']).toBe('Meta Skill')
      expect(skill!['currentHash']).toBeDefined()
      expect(skill!['centerPath']).toBeDefined()
    })
  })
})

// ── Agent Detail Tests ─────────────────────────────────────────────

describe('SkillManagerService — Agent Detail', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir()
    setHomeOverride(path.join(tmpDir, 'home'))
    centerPath = path.join(tmpDir, 'skills')
    agentDir = path.join(tmpDir, 'claude-skills')
    dbPath = path.join(tmpDir, 'skill-manager', 'test.db')

    fs.mkdirSync(agentDir, { recursive: true })
    service = SkillManagerService.bootstrap(dbPath, centerPath)
    service.getDb().conn.prepare(
      'UPDATE agents SET skills_dir = ? WHERE id = ?'
    ).run(agentDir, 'claude-code')
  })

  afterEach(() => {
    setHomeOverride(null)
    service.close()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('getAgentDetail', () => {
    it('returns null for non-existent agent', () => {
      const detail = service.getAgentDetail('non-existent')
      expect(detail).toBeNull()
    })

    it('returns agent detail with basic info', () => {
      const detail = service.getAgentDetail('claude-code')
      expect(detail).not.toBeNull()
      expect(detail!.id).toBe('claude-code')
      expect(detail!.displayName).toBe('Claude Code')
      expect(detail!.skillsDir).toBe(agentDir)
    })

    it('returns managed skills in targets array', () => {
      createSkillDir(centerPath, 'detail-skill', 'Detail Skill')
      service.refresh()

      const preview = service.previewDistribute(['detail-skill'], ['claude-code'], 'link')
      service.executeDistribute(preview)

      const detail = service.getAgentDetail('claude-code')
      expect(detail!.skills.length).toBe(1)
      expect(detail!.skills[0].skillId).toBe('detail-skill')
      expect(detail!.skills[0].agentId).toBe('claude-code')
    })

    it('returns unmanaged items', () => {
      createSkillDir(centerPath, 'managed', 'Managed')
      service.refresh()

      // Create unmanaged skill in agent dir
      createSkillDir(agentDir, 'unmanaged', 'Unmanaged')
      service.scanAgentInventory('claude-code')

      const detail = service.getAgentDetail('claude-code')
      expect(detail!.unmanaged.length).toBe(1)
      // inferredSkillId derives from frontmatter name (sanitized), not dir name
      expect(detail!.unmanaged[0].inferredSkillId).toBe('Unmanaged')
    })

    it('keeps nested skills with the same directory name as separate unmanaged items', () => {
      // Use openclaw (a recursive agent) so nested skills are discovered
      const openclawDir = path.join(tmpDir, 'openclaw-skills')
      fs.mkdirSync(path.join(openclawDir, 'first'), { recursive: true })
      fs.mkdirSync(path.join(openclawDir, 'second'), { recursive: true })
      service.getDb().conn.prepare(
        'UPDATE agents SET skills_dir = ? WHERE id = ?'
      ).run(openclawDir, 'openclaw')

      createSkillDir(path.join(openclawDir, 'first'), 'shared-name', 'First Shared')
      createSkillDir(path.join(openclawDir, 'second'), 'shared-name', 'Second Shared')

      const result = service.scanAgentInventory('openclaw')

      expect(result.unmanaged).toHaveLength(2)
      expect(new Set(result.unmanaged.map((item) => item.id)).size).toBe(2)
    })

    it('returns healthIssues filtered for this agent', () => {
      createSkillDir(centerPath, 'broken-skill', 'Broken')
      service.refresh()

      const preview = service.previewDistribute(['broken-skill'], ['claude-code'], 'link')
      service.executeDistribute(preview)

      // Delete center lib to create broken link
      fs.rmSync(path.join(centerPath, 'broken-skill'), { recursive: true, force: true })

      service.runDiagnosis()

      const detail = service.getAgentDetail('claude-code')
      expect(detail!.healthIssues.length).toBeGreaterThan(0)
    })

    it('returns applied packs', () => {
      createSkillDir(centerPath, 'pack-skill-1', 'Pack Skill 1')
      createSkillDir(centerPath, 'pack-skill-2', 'Pack Skill 2')
      service.refresh()

      const pack = service.upsertPack({
        name: 'Test Pack',
        memberSkillIds: ['pack-skill-1', 'pack-skill-2'],
      })

      service.executeApplyPack(pack.id, ['claude-code'], 'link')

      const detail = service.getAgentDetail('claude-code')
      expect(detail!.appliedPacks.length).toBe(1)
      expect(detail!.appliedPacks[0].name).toBe('Test Pack')
    })
  })

  describe('scanAgentDetail', () => {
    it('refreshes agent state and returns updated detail', async () => {
      createSkillDir(centerPath, 'scan-skill', 'Scan Skill')
      service.refresh()

      const preview = service.previewDistribute(['scan-skill'], ['claude-code'], 'link')
      service.executeDistribute(preview)

      // Add an unmanaged skill after initial scan
      createSkillDir(agentDir, 'new-unmanaged', 'New Unmanaged')

      const detail = await service.scanAgentDetail('claude-code')
      expect(detail).not.toBeNull()
      expect(detail!.unmanaged.length).toBe(1)
      // inferredSkillId derives from frontmatter name (sanitized)
      expect(detail!.unmanaged[0].inferredSkillId).toBe('New-Unmanaged')
    })

    it('detects and persists the agent CLI version', async () => {
      const detail = await service.scanAgentDetail('claude-code')
      expect(detail).not.toBeNull()
      expect(detail!.version).toBe('2.1.0')
      expect(service.listAgents().find((a) => a.id === 'claude-code')!.version).toBe('2.1.0')
    })

    it('updates lastScannedAt timestamp', async () => {
      const before = service.getAgentDetail('claude-code')!.lastScannedAt ?? ''
      // Wait a tiny bit to ensure timestamp changes
      const detail = await service.scanAgentDetail('claude-code')
      // lastScannedAt should be set (non-null)
      expect(detail).not.toBeNull()
      // The agent row should have last_scanned_at set
      const row = service.getDb().conn.prepare(
        'SELECT last_scanned_at FROM agents WHERE id = ?'
      ).get('claude-code') as { last_scanned_at: string | null }
      expect(row.last_scanned_at).not.toBeNull()
    })
  })
})
