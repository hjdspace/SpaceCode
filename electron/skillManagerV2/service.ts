/**
 * Skill Manager V2 — Core Service
 *
 * bootstrap(): Ensure directories + DB exist, seed built-in agents.
 * getOverview(): Return SkillManagerOverview DTO.
 * refresh(): Full scan of center library + known agent directories.
 *
 * Reference: AgentBro `src-tauri/src/skills/v2/service.rs`
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

import { Db, SCHEMA_VERSION } from './db'
import {
  defaultCenterPath,
  defaultSqlitePath,
  hashDir,
  isIgnoredEntry,
  isSkillDir,
  nowIso,
  readFrontmatter,
  buildFileTree,
  removePath,
  copyDirRecursive,
  expandTilde,
  inferSkillId,
  pathExists,
  createLink,
} from './fsutil'
import { scanCenterLibrary } from './scanner'
import { getBuiltInAgents } from './agentRegistry'
import { DiagnosisEngine } from './diagnosis'
import { exportSnapshot, type SkillManagerSnapshot } from './snapshot'
import type {
  AgentSummary,
  SkillManagerOverview,
  SkillManagerSettings,
  SkillPackSummary,
  SkillPackDetail,
  SkillPackMember,
  SkillSummary,
  DiagnosisIssue,
  UnmanagedItemDto,
  SkillManagerMetrics,
  SkillDetail,
  SkillSource,
  SkillTarget,
  SkillTargetClaim,
  DeleteCenterSkillPreview,
  FileTreeNode,
  AddCenterSkillInput,
  AddCenterSkillCandidate,
  AddCenterSkillPreview,
  AddCenterSkillDecision,
  AddCenterSkillResult,
  SourceType,
  InstallMode,
  DistributionPreview,
  DistributionChange,
  DistributionBlocker,
  DistributionResult,
  AdoptOption,
  AdoptPreview,
  AdoptBatchItem,
  AdoptBatchResult,
  AdoptResult,
  AgentInventoryScanResult,
  UpsertPackInput,
  RemovePackFromAgentPreview,
  RemovePackFromAgentResult,
  DeletePackPreview,
  PackAffectedTarget,
  CopySyncPreview,
  CopySyncResult,
  CopySyncAction,
  CopyTargetDiffPreview,
  CopyTargetDiffFile,
  CopySyncStatus,
  AgentDetail,
} from '@/types/skillManagerV2'

// ── Default settings ───────────────────────────────────────────────

const DEFAULT_SETTINGS: SkillManagerSettings = {
  centerLibraryPath: '',
  defaultInstallMode: 'link',
  linkFailPolicy: 'copy',
  startupScan: true,
  showUnmanaged: true,
}

// ── Service class ──────────────────────────────────────────────────

export class SkillManagerService {
  private db: Db
  private centerPath: string

  private constructor(dbPath?: string, centerPath?: string) {
    const resolvedCenterPath = centerPath ?? defaultCenterPath()
    this.centerPath = resolvedCenterPath
    this.db = Db.open(dbPath ?? defaultSqlitePath())
  }

  /**
   * Bootstrap: ensure directories exist, open DB, seed built-in agents.
   * Returns the service instance.
   */
  static bootstrap(dbPath?: string, centerPath?: string): SkillManagerService {
    const resolvedCenterPath = centerPath ?? defaultCenterPath()

    // Ensure center library directory exists
    fs.mkdirSync(resolvedCenterPath, { recursive: true })

    // Ensure skill-manager directory exists
    const skillMgrDir = path.dirname(dbPath ?? defaultSqlitePath())
    fs.mkdirSync(skillMgrDir, { recursive: true })

    const service = new SkillManagerService(dbPath, resolvedCenterPath)

    // Seed built-in agents into DB
    service.seedBuiltInAgents()

    // Save default settings if not present
    service.ensureDefaultSettings()

    return service
  }

  /** Close the database connection. */
  close(): void {
    this.db.close()
  }

  // ── Settings ────────────────────────────────────────────────────

  getSettings(): SkillManagerSettings {
    const raw = this.db.loadSettingsJson()
    const settings: SkillManagerSettings = { ...DEFAULT_SETTINGS }
    if (raw['centerLibraryPath']) {
      settings.centerLibraryPath = raw['centerLibraryPath'] as string
    } else {
      settings.centerLibraryPath = this.centerPath
    }
    if (raw['defaultInstallMode']) {
      settings.defaultInstallMode = raw['defaultInstallMode'] as 'link' | 'copy'
    }
    if (raw['linkFailPolicy']) {
      settings.linkFailPolicy = raw['linkFailPolicy'] as 'ask' | 'copy'
    }
    if (typeof raw['startupScan'] === 'boolean') {
      settings.startupScan = raw['startupScan'] as boolean
    }
    if (typeof raw['showUnmanaged'] === 'boolean') {
      settings.showUnmanaged = raw['showUnmanaged'] as boolean
    }
    return settings
  }

  updateSettings(patch: Partial<SkillManagerSettings>): SkillManagerSettings {
    const current = this.getSettings()
    const updated = { ...current, ...patch }
    const json: Record<string, unknown> = {
      centerLibraryPath: updated.centerLibraryPath,
      defaultInstallMode: updated.defaultInstallMode,
      linkFailPolicy: updated.linkFailPolicy,
      startupScan: updated.startupScan,
      showUnmanaged: updated.showUnmanaged,
    }
    this.db.saveSettingsJson(json)
    return updated
  }

  private ensureDefaultSettings(): void {
    const raw = this.db.loadSettingsJson()
    if (Object.keys(raw).length === 0) {
      this.db.saveSettingsJson({
        centerLibraryPath: this.centerPath,
        defaultInstallMode: 'link',
        linkFailPolicy: 'copy',
        startupScan: true,
        showUnmanaged: true,
      })
    }
  }

  // ── Agent registry ──────────────────────────────────────────────

  private seedBuiltInAgents(): void {
    const now = nowIso()
    const agents = getBuiltInAgents()
    const stmt = this.db.conn.prepare(`
      INSERT OR IGNORE INTO agents (id, display_name, skills_dir, config_path, mcp_config_path, enabled, last_scanned_at)
      VALUES (?, ?, ?, ?, ?, 1, ?)
    `)
    for (const agent of agents) {
      stmt.run(agent.id, agent.displayName, agent.skillsDir, agent.configPath, agent.mcpConfigPath, now)
    }
  }

  listAgents(): AgentSummary[] {
    const rows = this.db.conn.prepare(`
      SELECT a.id, a.display_name, a.skills_dir, a.config_path, a.mcp_config_path, a.plugin_dir,
             a.version, a.latest_version, a.enabled, a.last_scanned_at,
             (SELECT COUNT(*) FROM skill_targets t WHERE t.agent_id = a.id) AS managed_count,
             (SELECT COUNT(*) FROM unmanaged_items u WHERE u.agent_id = a.id) AS unmanaged_count
      FROM agents a
      ORDER BY a.display_name
    `).all() as AgentRow[]

    return rows.map((r) => ({
      id: r.id,
      displayName: r.display_name,
      skillsDir: r.skills_dir,
      configPath: r.config_path,
      mcpConfigPath: r.mcp_config_path,
      pluginDir: r.plugin_dir,
      version: r.version,
      latestVersion: r.latest_version,
      enabled: r.enabled === 1,
      lastScannedAt: r.last_scanned_at,
      managedSkillCount: r.managed_count,
      unmanagedCount: r.unmanaged_count,
    }))
  }

  // ── Skills ──────────────────────────────────────────────────────

  listCenterSkills(): SkillSummary[] {
    const rows = this.db.conn.prepare(`
      SELECT s.id, s.name, s.description, s.skill_type, s.center_path, s.current_hash,
             s.created_at, s.updated_at,
             (SELECT ss.source_type FROM skill_sources ss WHERE ss.skill_id = s.id) AS source_type
      FROM skills s
      ORDER BY s.name
    `).all() as SkillRow[]

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      skillType: r.skill_type,
      centerPath: r.center_path,
      currentHash: r.current_hash,
      status: 'ok' as const,
      sourceType: (r.source_type ?? null) as SkillSummary['sourceType'],
      agentBadges: this.getAgentBadges(r.id),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  private getAgentBadges(skillId: string): SkillSummary['agentBadges'] {
    const rows = this.db.conn.prepare(`
      SELECT t.agent_id, t.actual_mode, t.status, a.display_name
      FROM skill_targets t
      JOIN agents a ON a.id = t.agent_id
      WHERE t.skill_id = ?
    `).all(skillId) as TargetBadgeRow[]

    return rows.map((r) => ({
      agentId: r.agent_id,
      agentName: r.display_name,
      mode: r.actual_mode as 'link' | 'copy',
      status: r.status as SkillSummary['agentBadges'][0]['status'],
    }))
  }

  // ── Packs ───────────────────────────────────────────────────────

  listPacks(): SkillPackSummary[] {
    const rows = this.db.conn.prepare(`
      SELECT p.id, p.name, p.description, p.tags_json, p.created_at, p.updated_at,
             (SELECT COUNT(*) FROM skill_pack_members m WHERE m.pack_id = p.id) AS member_count,
             (SELECT COUNT(DISTINCT tc.pack_id) FROM skill_target_claims tc WHERE tc.pack_id = p.id) AS applied_agent_count
      FROM skill_packs p
      ORDER BY p.name
    `).all() as PackRow[]

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      tags: JSON.parse(r.tags_json) as string[],
      memberCount: r.member_count,
      appliedAgentCount: r.applied_agent_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  // ── Unmanaged ───────────────────────────────────────────────────

  listUnmanaged(): UnmanagedItemDto[] {
    const rows = this.db.conn.prepare(`
      SELECT id, item_type, agent_id, path, inferred_skill_id, hash, reason, first_seen_at, last_seen_at
      FROM unmanaged_items
      ORDER BY last_seen_at DESC
    `).all() as UnmanagedRow[]

    return rows.map((r) => ({
      id: r.id,
      itemType: r.item_type as UnmanagedItemDto['itemType'],
      agentId: r.agent_id,
      path: r.path,
      inferredSkillId: r.inferred_skill_id,
      hash: r.hash,
      reason: r.reason,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    }))
  }

  // ── Diagnosis issues ────────────────────────────────────────────

  listDiagnosisIssues(): DiagnosisIssue[] {
    const rows = this.db.conn.prepare(`
      SELECT id, issue_type, severity, entity_type, entity_id, title, detail, fix_kind, payload_json, created_at, resolved_at
      FROM diagnosis_issues
      WHERE resolved_at IS NULL
      ORDER BY
        CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        created_at DESC
    `).all() as IssueRow[]

    return rows.map((r) => ({
      id: r.id,
      issueType: r.issue_type,
      severity: r.severity as DiagnosisIssue['severity'],
      entityType: r.entity_type as DiagnosisIssue['entityType'],
      entityId: r.entity_id,
      title: r.title,
      detail: r.detail,
      fixKind: r.fix_kind as DiagnosisIssue['fixKind'],
      payloadJson: r.payload_json,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    }))
  }

  // ── Overview ────────────────────────────────────────────────────

  getOverview(): SkillManagerOverview {
    const skills = this.listCenterSkills()
    const agents = this.listAgents()
    const packs = this.listPacks()
    const issues = this.listDiagnosisIssues()
    const unmanaged = this.listUnmanaged()

    const agentTargetCount = this.db.conn
      .prepare('SELECT COUNT(*) AS c FROM skill_targets')
      .get() as { c: number }

    const metrics: SkillManagerMetrics = {
      centerSkillCount: skills.length,
      agentTargetCount: agentTargetCount.c,
      unmanagedCount: unmanaged.length,
      diagnosisIssueCount: issues.length,
    }

    return {
      metrics,
      settings: this.getSettings(),
      skills,
      agents,
      packs,
      issues,
      unmanaged,
    }
  }

  // ── Refresh ─────────────────────────────────────────────────────

  /**
   * Full scan: scan center library directory for skills, update DB.
   * Also clear stale unmanaged items and re-scan agent directories.
   */
  refresh(): SkillManagerOverview {
    this.scanCenterLibraryInternal()
    return this.getOverview()
  }

  /**
   * Scan the center library directory for skill subdirectories.
   * Add new skills to DB, update existing ones.
   * Delegates to scanner.ts.
   */
  private scanCenterLibraryInternal(): void {
    scanCenterLibrary(this.db, this.centerPath)
  }

  // ── Database info ───────────────────────────────────────────────

  getDbPath(): string {
    return this.db.conn.name
  }

  getCenterPath(): string {
    return this.centerPath
  }

  getSchemaVersion(): number {
    return SCHEMA_VERSION
  }

  getTableNames(): string[] {
    return this.db.listTables()
  }

  /** Get the underlying Db instance (for tests). */
  getDb(): Db {
    return this.db
  }

  // ── Skill Detail (Slice 2) ─────────────────────────────────────

  /**
   * Get full detail for a single skill: frontmatter, source, targets, claims, file tree.
   * Returns null if the skill id is not found in the DB.
   */
  getSkillDetail(skillId: string): SkillDetail | null {
    const row = this.db.conn.prepare(`
      SELECT id, name, description, skill_type, center_path, current_hash,
             frontmatter_json, created_at, updated_at, last_scanned_at
      FROM skills WHERE id = ?
    `).get(skillId) as SkillDetailRow | undefined

    if (!row) return null

    const source = this.getSkillSource(skillId)
    const targets = this.getSkillTargets(skillId)
    const claims = this.getSkillTargetClaims(skillId)
    const files = buildFileTree(row.center_path, 3)

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      skillType: row.skill_type,
      centerPath: row.center_path,
      currentHash: row.current_hash,
      frontmatterJson: row.frontmatter_json,
      source,
      targets,
      claims,
      files,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastScannedAt: row.last_scanned_at,
    }
  }

  private getSkillSource(skillId: string): SkillSource | null {
    const row = this.db.conn.prepare(`
      SELECT skill_id, source_type, source_uri, source_ref, imported_from_agent,
             imported_from_path, installed_via, created_at, updated_at
      FROM skill_sources WHERE skill_id = ?
    `).get(skillId) as SourceRow | undefined

    if (!row) return null

    return {
      skillId: row.skill_id,
      sourceType: row.source_type as SkillSource['sourceType'],
      sourceUri: row.source_uri,
      sourceRef: row.source_ref,
      importedFromAgent: row.imported_from_agent,
      importedFromPath: row.imported_from_path,
      installedVia: row.installed_via,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private getSkillTargets(skillId: string): SkillTarget[] {
    const rows = this.db.conn.prepare(`
      SELECT id, skill_id, agent_id, target_path, install_mode, actual_mode,
             source_hash, current_hash, status, created_at, updated_at
      FROM skill_targets WHERE skill_id = ?
      ORDER BY created_at
    `).all(skillId) as TargetRow[]

    return rows.map((r) => ({
      id: r.id,
      skillId: r.skill_id,
      agentId: r.agent_id,
      targetPath: r.target_path,
      installMode: r.install_mode as SkillTarget['installMode'],
      actualMode: r.actual_mode as SkillTarget['actualMode'],
      sourceHash: r.source_hash,
      currentHash: r.current_hash,
      status: r.status as SkillTarget['status'],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  private getSkillTargetClaims(skillId: string): SkillTargetClaim[] {
    const rows = this.db.conn.prepare(`
      SELECT c.id, c.target_id, c.claim_type, c.pack_id, c.created_at
      FROM skill_target_claims c
      JOIN skill_targets t ON t.id = c.target_id
      WHERE t.skill_id = ?
      ORDER BY c.created_at
    `).all(skillId) as ClaimRow[]

    return rows.map((r) => ({
      id: r.id,
      targetId: r.target_id,
      claimType: r.claim_type as SkillTargetClaim['claimType'],
      packId: r.pack_id,
      createdAt: r.created_at,
    }))
  }

  // ── Delete Center Skill (Slice 2) ──────────────────────────────

  /**
   * Preview deleting a center library skill.
   * Returns the skill info and any affected agent targets.
   * Returns null if the skill id is not found.
   */
  previewDeleteCenterSkill(skillId: string): DeleteCenterSkillPreview | null {
    const row = this.db.conn.prepare(`
      SELECT id, name FROM skills WHERE id = ?
    `).get(skillId) as { id: string; name: string } | undefined

    if (!row) return null

    const affectedTargets = this.getSkillTargets(skillId)

    return {
      skillId: row.id,
      skillName: row.name,
      affectedTargets,
    }
  }

  /**
   * Execute deletion of a center library skill.
   * Removes: DB record (skills, skill_sources, skill_targets, skill_target_claims via cascade),
   *          filesystem directory.
   * Throws if the skill id is not found.
   */
  executeDeleteCenterSkill(skillId: string): void {
    const row = this.db.conn.prepare(`
      SELECT id, center_path FROM skills WHERE id = ?
    `).get(skillId) as { id: string; center_path: string } | undefined

    if (!row) {
      throw new Error(`Skill not found: ${skillId}`)
    }

    // Delete from DB (cascade will handle skill_sources, skill_targets, skill_target_claims)
    this.db.conn.prepare('DELETE FROM skills WHERE id = ?').run(skillId)

    // Delete the directory from filesystem
    removePath(row.center_path)
  }

  // ── Add Center Skill (Slice 3) ──────────────────────────────────

  /**
   * Preview adding an external skill to the center library.
   * Validates the source, computes hashes, and detects conflicts.
   *
   * Reference: AgentBro `service.rs` `preview_add_center_skill()`
   */
  previewAddCenterSkill(input: AddCenterSkillInput): AddCenterSkillPreview {
    const expandedSrc = expandTilde(input.sourcePath)

    if (!pathExists(expandedSrc)) {
      throw new Error(`Source path does not exist: ${expandedSrc}`)
    }

    if (!fs.statSync(expandedSrc).isDirectory()) {
      throw new Error(`Source path is not a directory: ${expandedSrc}`)
    }

    // Determine skill directories to process
    const dirs = this.resolveSkillDirs(expandedSrc, input.multi ?? false)

    if (dirs.length === 0) {
      throw new Error(
        'No valid skill directories found (each must contain SKILL.md)'
      )
    }

    const candidates: AddCenterSkillCandidate[] = []
    const blockers: AddCenterSkillCandidate[] = []
    let unchangedCount = 0

    for (const dir of dirs) {
      const proposed = inferSkillId(dir)
      const fm = readFrontmatter(dir)
      const name = fm.map.get('name') ?? proposed
      const description = fm.map.get('description') ?? ''
      const hash = hashDir(dir)

      // Check if a skill with this ID already exists in DB
      const existing = this.db.conn.prepare(
        'SELECT id, current_hash, center_path FROM skills WHERE id = ?'
      ).get(proposed) as { id: string; current_hash: string; center_path: string } | undefined

      if (!existing) {
        // No conflict → create
        candidates.push({
          skillId: proposed,
          proposedSkillId: proposed,
          name,
          description,
          sourceDir: dir,
          hash,
          action: 'create',
          existingSourceType: null,
          reason: null,
        })
        continue
      }

      // Skill exists — check if same source
      const sourceRow = this.db.conn.prepare(
        'SELECT source_type, source_uri FROM skill_sources WHERE skill_id = ?'
      ).get(proposed) as { source_type: string; source_uri: string | null } | undefined

      const sameSource = this.sourcesMatchForCandidate(input, dir, sourceRow)

      if (sameSource) {
        // Same source → check if content is unchanged
        if (existing.current_hash === hash) {
          unchangedCount++
          continue
        }
        // Content differs → update
        candidates.push({
          skillId: proposed,
          proposedSkillId: proposed,
          name,
          description,
          sourceDir: dir,
          hash,
          action: 'update',
          existingSourceType: (sourceRow?.source_type as SourceType) ?? null,
          reason: null,
        })
      } else {
        // Different source → blocked
        blockers.push({
          skillId: proposed,
          proposedSkillId: proposed,
          name,
          description,
          sourceDir: dir,
          hash,
          action: 'blocked',
          existingSourceType: (sourceRow?.source_type as SourceType) ?? null,
          reason: `A different skill already uses id '${proposed}'. Choose overwrite, rename, or skip.`,
        })
      }
    }

    return {
      candidates,
      blockers,
      unchangedCount,
      centerPath: this.centerPath,
    }
  }

  /**
   * Execute adding an external skill to the center library.
   * Processes decisions for blocked items, copies files, records sources.
   *
   * Reference: AgentBro `service.rs` `execute_add_center_skill()`
   */
  executeAddCenterSkill(
    input: AddCenterSkillInput,
    decisions: AddCenterSkillDecision[]
  ): AddCenterSkillResult {
    const preview = this.previewAddCenterSkill(input)

    fs.mkdirSync(this.centerPath, { recursive: true })

    const created: string[] = []
    const updated: string[] = []
    const skipped: string[] = []

    // Build decision lookup
    const decisionMap = new Map<string, AddCenterSkillDecision>()
    for (const d of decisions) {
      decisionMap.set(d.skillId, d)
    }

    // Process blockers — require explicit decision
    for (const blocker of preview.blockers) {
      const dec = decisionMap.get(blocker.skillId)

      if (!dec) {
        throw new Error(
          `Blocked skill '${blocker.skillId}' requires an explicit decision (overwrite/rename/skip).`
        )
      }

      if (dec.resolution === 'skip') {
        skipped.push(blocker.skillId)
        continue
      }

      if (dec.resolution === 'update') {
        // Overwrite existing
        this.writeSkillToCenter(blocker.skillId, blocker.sourceDir, input)
        updated.push(blocker.skillId)
        continue
      }

      if (dec.resolution === 'create') {
        // Rename
        const newId = dec.proposedSkillId ?? `${blocker.skillId}-import`
        this.writeSkillToCenter(newId, blocker.sourceDir, input)
        created.push(newId)
        continue
      }
    }

    // Process candidates — create/update unless skip
    for (const cand of preview.candidates) {
      const dec = decisionMap.get(cand.skillId)

      if (dec?.resolution === 'skip') {
        skipped.push(cand.skillId)
        continue
      }

      if (cand.action === 'update') {
        this.writeSkillToCenter(cand.skillId, cand.sourceDir, input)
        updated.push(cand.skillId)
        continue
      }

      // Create — allow rename override
      const newId = dec?.proposedSkillId
      if (newId && newId !== cand.skillId) {
        this.writeSkillToCenter(newId, cand.sourceDir, input)
        created.push(newId)
      } else {
        this.writeSkillToCenter(cand.skillId, cand.sourceDir, input)
        created.push(cand.skillId)
      }
    }

    // Auto-scan center library to update DB
    scanCenterLibrary(this.db, this.centerPath)

    return {
      skillIds: created,
      updated,
      skipped,
    }
  }

  // ── Add Center Skill helpers ────────────────────────────────────

  /**
   * Resolve which directories to process from the source path.
   * If multi is true, scan all subdirectories that are valid skill dirs.
   * If the source itself is a skill dir, use it directly.
   * Otherwise, scan subdirectories for skill dirs.
   */
  private resolveSkillDirs(srcPath: string, multi: boolean): string[] {
    if (multi) {
      return this.scanSubDirsForSkills(srcPath)
    }

    if (isSkillDir(srcPath)) {
      return [srcPath]
    }

    // Not a skill dir itself — try scanning subdirectories
    return this.scanSubDirsForSkills(srcPath)
  }

  /** Scan immediate subdirectories for valid skill directories. */
  private scanSubDirsForSkills(parentDir: string): string[] {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(parentDir, { withFileTypes: true })
    } catch {
      return []
    }

    const dirs: string[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.isSymbolicLink()) continue
      if (isIgnoredEntry(entry.name)) continue
      const subDir = path.join(parentDir, entry.name)
      if (isSkillDir(subDir)) {
        dirs.push(subDir)
      }
    }
    return dirs
  }

  /**
   * Check if the input source matches the existing DB source for a candidate.
   * Same source means same source_type AND (same source_uri OR same hash if no URI).
   */
  private sourcesMatchForCandidate(
    input: AddCenterSkillInput,
    sourceDir: string,
    existing: { source_type: string; source_uri: string | null } | undefined
  ): boolean {
    if (!existing) {
      // No source record — compare by hash
      const sourceHash = hashDir(sourceDir)
      const skillRow = this.db.conn.prepare(
        'SELECT current_hash FROM skills WHERE id = ?'
      ).get(inferSkillId(sourceDir)) as { current_hash: string } | undefined
      return skillRow?.current_hash === sourceHash
    }

    // Same source type?
    if (existing.source_type !== input.sourceType) return false

    // If both have URIs, compare them
    if (existing.source_uri && input.sourceUri) {
      return existing.source_uri === input.sourceUri
    }

    // If neither has URI, compare by hash
    if (!existing.source_uri && !input.sourceUri) {
      const sourceHash = hashDir(sourceDir)
      const skillRow = this.db.conn.prepare(
        'SELECT current_hash FROM skills WHERE id = ?'
      ).get(inferSkillId(sourceDir)) as { current_hash: string } | undefined
      return skillRow?.current_hash === sourceHash
    }

    // One has URI, the other doesn't → different sources
    return false
  }

  /**
   * Write a skill from sourceDir into the center library at centerPath/skillId.
   * Overwrites existing directory if present, then records the source.
   */
  private writeSkillToCenter(
    skillId: string,
    sourceDir: string,
    input: AddCenterSkillInput
  ): void {
    const dest = path.join(this.centerPath, skillId)

    // Remove existing destination if present
    if (pathExists(dest)) {
      removePath(dest)
    }

    // Copy the skill directory
    copyDirRecursive(sourceDir, dest)

    // Record source in DB
    this.recordSourceAfterWrite(skillId, dest, sourceDir, input)
  }

  /**
   * Record/update the skill and source rows in the DB after writing to disk.
   */
  private recordSourceAfterWrite(
    skillId: string,
    destPath: string,
    sourceDir: string,
    input: AddCenterSkillInput
  ): void {
    const fm = readFrontmatter(destPath)
    const name = fm.map.get('name') ?? skillId
    const description = fm.map.get('description') ?? ''
    const hash = hashDir(destPath)
    const frontmatterJson = JSON.stringify(Object.fromEntries(fm.map))
    const now = nowIso()

    this.db.transaction((tx) => {
      // Upsert skill row
      tx.prepare(`
        INSERT INTO skills (id, name, description, skill_type, center_path, current_hash, frontmatter_json, created_at, updated_at, last_scanned_at)
        VALUES (?, ?, ?, 'skill', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          current_hash = excluded.current_hash,
          frontmatter_json = excluded.frontmatter_json,
          updated_at = excluded.updated_at,
          last_scanned_at = excluded.last_scanned_at
      `).run(skillId, name, description, destPath, hash, frontmatterJson, now, now, now)

      // Upsert source row
      const sourceUri = input.sourceUri ?? sourceDir
      tx.prepare(`
        INSERT INTO skill_sources (skill_id, source_type, source_uri, source_ref, imported_from_agent, imported_from_path, installed_via, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'spacecode', ?, ?)
        ON CONFLICT(skill_id) DO UPDATE SET
          source_type = excluded.source_type,
          source_uri = excluded.source_uri,
          source_ref = excluded.source_ref,
          imported_from_agent = excluded.imported_from_agent,
          imported_from_path = excluded.imported_from_path,
          updated_at = excluded.updated_at
      `).run(
        skillId,
        input.sourceType,
        sourceUri,
        input.sourceRef ?? null,
        input.importedFromAgent ?? null,
        input.importedFromPath ?? null,
        now,
        now
      )
    })
  }

  // ── Diagnosis (Slice 8) ────────────────────────────────────────

  /**
   * Run a full diagnosis scan: clear old issues, detect new ones, persist to DB.
   * Returns the list of new issues found.
   *
   * Reference: AgentBro `src-tauri/src/skills/v2/diagnosis.rs` `run()`
   */
  runDiagnosis(): DiagnosisIssue[] {
    const engine = new DiagnosisEngine(this.db, this.centerPath)
    return engine.run()
  }

  /**
   * Execute all auto-level safe fixes.
   * Returns a summary of what was fixed.
   */
  executeSafeFixes(): { fixedCount: number; details: string[] } {
    const engine = new DiagnosisEngine(this.db, this.centerPath)
    return engine.executeSafeFixes()
  }

  // ── Agent Detail (Slice 9) ─────────────────────────────────────

  /**
   * Get full detail for a single agent: skills, unmanaged, applied packs, health issues.
   * Returns null if the agent id is not found.
   *
   * Reference: AgentBro `service.rs` `get_agent_detail()`
   */
  getAgentDetail(agentId: string): AgentDetail | null {
    const row = this.db.conn.prepare(`
      SELECT id, display_name, skills_dir, config_path, version, last_scanned_at
      FROM agents WHERE id = ?
    `).get(agentId) as AgentDetailRow | undefined

    if (!row) return null

    const skills = this.getAgentManagedTargets(agentId)
    const unmanaged = this.getAgentUnmanaged(agentId)
    const appliedPacks = this.getAgentAppliedPacks(agentId)
    const healthIssues = this.getAgentHealthIssues(agentId)

    return {
      id: row.id,
      displayName: row.display_name,
      skillsDir: row.skills_dir,
      configPath: row.config_path,
      version: row.version,
      lastScannedAt: row.last_scanned_at,
      skills,
      unmanaged,
      appliedPacks,
      healthIssues,
    }
  }

  /**
   * Scan a single agent and return updated detail.
   * Delegates to scanAgentInventory to refresh the unmanaged items, then returns detail.
   */
  scanAgentDetail(agentId: string): AgentDetail | null {
    this.scanAgentInventory(agentId)
    return this.getAgentDetail(agentId)
  }

  /** Get unmanaged items for a specific agent. */
  private getAgentUnmanaged(agentId: string): UnmanagedItemDto[] {
    const rows = this.db.conn.prepare(`
      SELECT id, item_type, agent_id, path, inferred_skill_id, hash, reason, first_seen_at, last_seen_at
      FROM unmanaged_items WHERE agent_id = ?
      ORDER BY last_seen_at DESC
    `).all(agentId) as UnmanagedRow[]

    return rows.map((r) => ({
      id: r.id,
      itemType: r.item_type as UnmanagedItemDto['itemType'],
      agentId: r.agent_id,
      path: r.path,
      inferredSkillId: r.inferred_skill_id,
      hash: r.hash,
      reason: r.reason,
      firstSeenAt: r.first_seen_at,
      lastSeenAt: r.last_seen_at,
    }))
  }

  /** Get packs applied to a specific agent. */
  private getAgentAppliedPacks(agentId: string): SkillPackSummary[] {
    const packIds = this.db.conn.prepare(`
      SELECT DISTINCT c.pack_id
      FROM skill_target_claims c
      JOIN skill_targets t ON t.id = c.target_id
      WHERE t.agent_id = ? AND c.pack_id IS NOT NULL
    `).all(agentId) as Array<{ pack_id: string }>

    if (packIds.length === 0) return []

    const allPacks = this.listPacks()
    const packIdSet = new Set(packIds.map((p) => p.pack_id))
    return allPacks.filter((p) => packIdSet.has(p.id))
  }

  /** Get health issues for a specific agent. */
  private getAgentHealthIssues(agentId: string): DiagnosisIssue[] {
    const rows = this.db.conn.prepare(`
      SELECT DISTINCT d.id, d.issue_type, d.severity, d.entity_type, d.entity_id, d.title, d.detail, d.fix_kind, d.payload_json, d.created_at, d.resolved_at
      FROM diagnosis_issues d
      WHERE d.resolved_at IS NULL AND (
        (d.entity_type = 'agent' AND d.entity_id = ?)
        OR (d.entity_type = 'target' AND d.entity_id IN (
          SELECT id FROM skill_targets WHERE agent_id = ?
        ))
        OR d.payload_json LIKE ?
      )
      ORDER BY
        CASE d.severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
        d.created_at DESC
    `).all(agentId, agentId, `%"agentId":"${agentId}"%`) as IssueRow[]

    return rows.map((r) => ({
      id: r.id,
      issueType: r.issue_type,
      severity: r.severity as DiagnosisIssue['severity'],
      entityType: r.entity_type as DiagnosisIssue['entityType'],
      entityId: r.entity_id,
      title: r.title,
      detail: r.detail,
      fixKind: r.fix_kind as DiagnosisIssue['fixKind'],
      payloadJson: r.payload_json,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
    }))
  }

  // ── Snapshot Export ────────────────────────────────────────────

  /**
   * Export a JSON snapshot of the entire Skill Manager state.
   */
  exportSnapshot(): SkillManagerSnapshot {
    return exportSnapshot(this.db, this.centerPath)
  }

  // ── Distribute to Agent (Slice 4) ───────────────────────────────

  /**
   * Preview distributing center library skills to one or more agents.
   * For each skill×agent pair, determines: create / reuse / blocked.
   *
   * Reference: AgentBro `service.rs` `preview_distribute()`
   */
  previewDistribute(
    skillIds: string[],
    targetAgentIds: string[],
    requestedMode: InstallMode
  ): DistributionPreview {
    const changes: DistributionChange[] = []
    const blockers: DistributionBlocker[] = []

    for (const skillId of skillIds) {
      // Verify skill exists in center library
      const skillRow = this.db.conn.prepare(
        'SELECT id, name, center_path, current_hash FROM skills WHERE id = ?'
      ).get(skillId) as { id: string; name: string; center_path: string; current_hash: string } | undefined

      if (!skillRow) {
        throw new Error(`Skill not found in center library: ${skillId}`)
      }

      for (const agentId of targetAgentIds) {
        const agentRow = this.db.conn.prepare(
          'SELECT id, display_name, skills_dir FROM agents WHERE id = ?'
        ).get(agentId) as { id: string; display_name: string; skills_dir: string | null } | undefined

        if (!agentRow) {
          throw new Error(`Agent not found: ${agentId}`)
        }

        const targetPath = path.join(agentRow.skills_dir ?? '', skillId)

        // Check if target already exists in DB (managed)
        const existingTarget = this.db.conn.prepare(
          'SELECT id, skill_id, agent_id, target_path, install_mode, actual_mode, source_hash, current_hash, status FROM skill_targets WHERE skill_id = ? AND agent_id = ?'
        ).get(skillId, agentId) as TargetRow | undefined

        if (existingTarget) {
          // Reuse — target already managed
          changes.push({
            skillId,
            skillName: skillRow.name,
            agentId,
            agentName: agentRow.display_name,
            action: 'reuse',
            mode: existingTarget.install_mode as InstallMode,
            reason: null,
          })
          continue
        }

        // Check if something unmanaged exists at the target path
        if (pathExists(targetPath)) {
          // Unmanaged same-name — blocked
          blockers.push({
            skillId,
            skillName: skillRow.name,
            agentId,
            agentName: agentRow.display_name,
            reason: `Unmanaged file exists at ${targetPath}. Adopt it first.`,
          })
          continue
        }

        // Create
        changes.push({
          skillId,
          skillName: skillRow.name,
          agentId,
          agentName: agentRow.display_name,
          action: 'create',
          mode: requestedMode,
          reason: null,
        })
      }
    }

    return { changes, blockers }
  }

  /**
   * Execute distribution: create links/copies, write target + claim records.
   *
   * Reference: AgentBro `service.rs` `execute_distribute()`
   */
  executeDistribute(preview: DistributionPreview): DistributionResult {
    const settings = this.getSettings()
    let created = 0
    let reused = 0
    let failed = 0
    const errors: string[] = []

    for (const change of preview.changes) {
      try {
        if (change.action === 'reuse') {
          reused++
          continue
        }

        if (change.action === 'create') {
          const skillRow = this.db.conn.prepare(
            'SELECT id, name, center_path, current_hash FROM skills WHERE id = ?'
          ).get(change.skillId) as { id: string; name: string; center_path: string; current_hash: string }

          const agentRow = this.db.conn.prepare(
            'SELECT id, display_name, skills_dir FROM agents WHERE id = ?'
          ).get(change.agentId) as { id: string; display_name: string; skills_dir: string | null }

          const centerPath = skillRow.center_path
          const targetPath = path.join(agentRow.skills_dir ?? '', change.skillId)

          let actualMode: 'link' | 'copy' = change.mode

          if (change.mode === 'link') {
            const linkResult = createLink(centerPath, targetPath, settings.linkFailPolicy)
            actualMode = linkResult.actualMode
            if (linkResult.error) {
              errors.push(`${change.skillId} → ${change.agentId}: ${linkResult.error}`)
              failed++
              continue
            }
          } else {
            // Copy mode
            copyDirRecursive(centerPath, targetPath)
          }

          // Write target + claim to DB
          this.writeTargetAndClaim(
            change.skillId,
            change.agentId,
            targetPath,
            change.mode,
            actualMode,
            skillRow.current_hash
          )

          created++
        }
      } catch (e) {
        errors.push(`${change.skillId} → ${change.agentId}: ${(e as Error).message}`)
        failed++
      }
    }

    return {
      success: failed === 0,
      created,
      reused,
      failed,
      errors,
    }
  }

  /**
   * Write a skill_target row and a direct claim row.
   */
  private writeTargetAndClaim(
    skillId: string,
    agentId: string,
    targetPath: string,
    installMode: InstallMode,
    actualMode: 'link' | 'copy',
    sourceHash: string
  ): void {
    const now = nowIso()
    const targetId = `${skillId}__${agentId}`

    this.db.transaction((tx) => {
      // Upsert target
      tx.prepare(`
        INSERT INTO skill_targets (id, skill_id, agent_id, target_path, install_mode, actual_mode, source_hash, current_hash, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'ok', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          install_mode = excluded.install_mode,
          actual_mode = excluded.actual_mode,
          source_hash = excluded.source_hash,
          status = 'ok',
          updated_at = excluded.updated_at
      `).run(targetId, skillId, agentId, targetPath, installMode, actualMode, sourceHash, now, now)

      // Upsert direct claim (UNIQUE on target_id + claim_type + pack_id)
      tx.prepare(`
        INSERT INTO skill_target_claims (id, target_id, claim_type, pack_id, created_at)
        VALUES (?, ?, 'direct', NULL, ?)
        ON CONFLICT(target_id, claim_type, pack_id) DO NOTHING
      `).run(`${targetId}__direct`, targetId, now)
    })
  }

  /**
   * Delete a single target from an agent.
   * Removes the file/link and all DB records (target + claims via cascade).
   *
   * Reference: AgentBro `service.rs` delete target logic
   */
  deleteTarget(targetId: string): void {
    const row = this.db.conn.prepare(
      'SELECT id, skill_id, agent_id, target_path FROM skill_targets WHERE id = ?'
    ).get(targetId) as { id: string; skill_id: string; agent_id: string; target_path: string } | undefined

    if (!row) {
      throw new Error(`Target not found: ${targetId}`)
    }

    // Remove the file/link from disk
    removePath(row.target_path)

    // Delete from DB (cascade will remove claims)
    this.db.conn.prepare('DELETE FROM skill_targets WHERE id = ?').run(targetId)
  }

  // ── Agent Scan & Adopt (Slice 5) ────────────────────────────────

  /**
   * Scan an agent's skills directory for managed / unmanaged / conflict items.
   * Updates the unmanaged_items table with discovered items.
   *
   * Reference: AgentBro `service.rs` `scan_agent_inventory()`
   */
  scanAgentInventory(agentId: string): AgentInventoryScanResult {
    const agentRow = this.db.conn.prepare(
      'SELECT id, display_name, skills_dir FROM agents WHERE id = ?'
    ).get(agentId) as { id: string; display_name: string; skills_dir: string | null } | undefined

    if (!agentRow) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    const skillsDir = agentRow.skills_dir ?? ''
    const managedTargets = this.getAgentManagedTargets(agentId)
    const managedSkillIds = new Set(managedTargets.map((t) => t.skillId))

    // Get center library skill IDs and hashes
    const centerSkills = this.db.conn.prepare(
      'SELECT id, current_hash FROM skills'
    ).all() as Array<{ id: string; current_hash: string }>
    const centerSkillMap = new Map(centerSkills.map((s) => [s.id, s.current_hash]))

    // Scan the agent directory for skill dirs
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    } catch {
      entries = []
    }

    const unmanaged: UnmanagedItemDto[] = []
    const conflicts: UnmanagedItemDto[] = []
    const now = nowIso()

    // Remove old unmanaged items for this agent
    this.db.conn.prepare('DELETE FROM unmanaged_items WHERE agent_id = ?').run(agentId)

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (isIgnoredEntry(entry.name)) continue

      const skillDirPath = path.join(skillsDir, entry.name)
      if (!isSkillDir(skillDirPath)) continue

      // Skip if managed (has a target record)
      if (managedSkillIds.has(entry.name)) continue

      // Compute hash and infer skill ID from directory name (matches center library convention)
      const inferredId = entry.name
      const hash = hashDir(skillDirPath)
      const unmanagedId = `${agentId}__${entry.name}`

      // Check if center library has same-name skill
      const centerHash = centerSkillMap.get(inferredId)
      if (centerHash) {
        // Same name exists in center — check if hash matches
        if (centerHash !== hash) {
          // Conflict — same name, different content
          conflicts.push({
            id: unmanagedId,
            itemType: 'skill_dir',
            agentId,
            path: skillDirPath,
            inferredSkillId: inferredId,
            hash,
            reason: `Same-name skill '${inferredId}' exists in center library but content differs`,
            firstSeenAt: now,
            lastSeenAt: now,
          })
        } else {
          // Same name, same hash — effectively managed (might be a copy or link)
          // Treat as unmanaged but with a note that it matches center
          unmanaged.push({
            id: unmanagedId,
            itemType: 'skill_dir',
            agentId,
            path: skillDirPath,
            inferredSkillId: inferredId,
            hash,
            reason: 'Skill matches center library content but has no managed target',
            firstSeenAt: now,
            lastSeenAt: now,
          })
        }
      } else {
        // No same-name in center — genuinely unmanaged
        unmanaged.push({
          id: unmanagedId,
          itemType: 'skill_dir',
          agentId,
          path: skillDirPath,
          inferredSkillId: inferredId,
          hash,
          reason: 'Skill not found in center library',
          firstSeenAt: now,
          lastSeenAt: now,
        })
      }
    }

    // Write unmanaged + conflict items to DB
    const insertStmt = this.db.conn.prepare(`
      INSERT OR REPLACE INTO unmanaged_items (id, item_type, agent_id, path, inferred_skill_id, hash, reason, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const item of [...unmanaged, ...conflicts]) {
      insertStmt.run(
        item.id,
        item.itemType,
        item.agentId,
        item.path,
        item.inferredSkillId,
        item.hash,
        item.reason,
        item.firstSeenAt,
        item.lastSeenAt
      )
    }

    // Update agent's last scanned timestamp
    this.db.conn.prepare('UPDATE agents SET last_scanned_at = ? WHERE id = ?').run(now, agentId)

    return {
      agentId,
      managed: managedTargets,
      unmanaged,
      conflicts,
    }
  }

  /** Get all managed targets for an agent. */
  private getAgentManagedTargets(agentId: string): SkillTarget[] {
    const rows = this.db.conn.prepare(`
      SELECT id, skill_id, agent_id, target_path, install_mode, actual_mode,
             source_hash, current_hash, status, created_at, updated_at
      FROM skill_targets WHERE agent_id = ?
      ORDER BY created_at
    `).all(agentId) as TargetRow[]

    return rows.map((r) => ({
      id: r.id,
      skillId: r.skill_id,
      agentId: r.agent_id,
      targetPath: r.target_path,
      installMode: r.install_mode as SkillTarget['installMode'],
      actualMode: r.actual_mode as SkillTarget['actualMode'],
      sourceHash: r.source_hash,
      currentHash: r.current_hash,
      status: r.status as SkillTarget['status'],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  }

  /**
   * Preview adopting an unmanaged skill into the center library.
   *
   * Reference: AgentBro `service.rs` `preview_adopt()`
   */
  previewAdopt(agentId: string, unmanagedId: string): AdoptPreview {
    const row = this.db.conn.prepare(
      'SELECT id, agent_id, path, inferred_skill_id, hash, reason FROM unmanaged_items WHERE id = ?'
    ).get(unmanagedId) as UnmanagedRow | undefined

    if (!row) {
      throw new Error(`Unmanaged item not found: ${unmanagedId}`)
    }

    const inferredSkillId = row.inferred_skill_id ?? path.basename(row.path)

    // Check if center library has a same-name skill
    const centerSkill = this.db.conn.prepare(
      'SELECT id, current_hash FROM skills WHERE id = ?'
    ).get(inferredSkillId) as { id: string; current_hash: string } | undefined

    const centerHasSameName = centerSkill !== undefined
    const isConflict = centerHasSameName && centerSkill!.current_hash !== row.hash

    const options: AdoptOption[] = []
    let conflictReason: string | null = null

    if (isConflict) {
      // Conflict — only import_to_center with rename, or skip
      conflictReason = `Center library has a skill with id '${inferredSkillId}' but content differs. Rename or skip to proceed.`
      options.push('import_to_center')
    } else {
      // No conflict — all options available
      options.push('import_to_center')
      options.push('replace_with_link')
      options.push('replace_with_copy')
    }

    return {
      agentId,
      unmanagedId,
      inferredSkillId,
      centerHasSameName,
      centerSkillId: centerSkill?.id ?? null,
      options,
      conflictReason,
    }
  }

  /**
   * Execute adopting an unmanaged skill.
   *
   * Reference: AgentBro `service.rs` `execute_adopt()`
   */
  executeAdopt(
    agentId: string,
    unmanagedId: string,
    option: AdoptOption,
    renamedId?: string
  ): void {
    const row = this.db.conn.prepare(
      'SELECT id, agent_id, path, inferred_skill_id, hash FROM unmanaged_items WHERE id = ?'
    ).get(unmanagedId) as UnmanagedRow | undefined

    if (!row) {
      throw new Error(`Unmanaged item not found: ${unmanagedId}`)
    }

    const agentRow = this.db.conn.prepare(
      'SELECT id, skills_dir FROM agents WHERE id = ?'
    ).get(agentId) as { id: string; skills_dir: string | null } | undefined

    if (!agentRow) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    const agentSkillsDir = agentRow.skills_dir ?? ''
    const sourcePath = row.path
    const inferredSkillId = row.inferred_skill_id ?? path.basename(sourcePath)
    const targetSkillId = renamedId ?? inferredSkillId
    const centerDest = path.join(this.centerPath, targetSkillId)

    if (option === 'import_to_center') {
      // Copy to center library, keep agent file unchanged
      if (pathExists(centerDest)) {
        // If same name exists, need rename
        if (targetSkillId === inferredSkillId) {
          throw new Error(`Skill '${targetSkillId}' already exists in center. Use rename.`)
        }
      }
      copyDirRecursive(sourcePath, centerDest)
      this.recordAdoptedSkill(targetSkillId, centerDest, sourcePath, agentId)
    } else if (option === 'replace_with_link') {
      // Copy to center, replace agent file with symlink
      copyDirRecursive(sourcePath, centerDest)
      this.recordAdoptedSkill(targetSkillId, centerDest, sourcePath, agentId)

      // Remove agent file and create symlink
      removePath(sourcePath)
      const linkResult = createLink(centerDest, sourcePath, this.getSettings().linkFailPolicy)

      // Write target + claim
      this.writeTargetAndClaim(
        targetSkillId,
        agentId,
        sourcePath,
        'link',
        linkResult.actualMode,
        hashDir(centerDest)
      )
    } else if (option === 'replace_with_copy') {
      // Copy to center, replace agent file with fresh copy
      copyDirRecursive(sourcePath, centerDest)
      this.recordAdoptedSkill(targetSkillId, centerDest, sourcePath, agentId)

      // Remove agent file and create copy
      removePath(sourcePath)
      copyDirRecursive(centerDest, sourcePath)

      // Write target + claim
      this.writeTargetAndClaim(
        targetSkillId,
        agentId,
        sourcePath,
        'copy',
        'copy',
        hashDir(centerDest)
      )
    }

    // Remove unmanaged item from DB
    this.db.conn.prepare('DELETE FROM unmanaged_items WHERE id = ?').run(unmanagedId)
  }

  /** Record a skill that was adopted into the center library. */
  private recordAdoptedSkill(
    skillId: string,
    destPath: string,
    sourcePath: string,
    agentId: string
  ): void {
    const fm = readFrontmatter(destPath)
    const name = fm.map.get('name') ?? skillId
    const description = fm.map.get('description') ?? ''
    const hash = hashDir(destPath)
    const frontmatterJson = JSON.stringify(Object.fromEntries(fm.map))
    const now = nowIso()

    this.db.transaction((tx) => {
      tx.prepare(`
        INSERT INTO skills (id, name, description, skill_type, center_path, current_hash, frontmatter_json, created_at, updated_at, last_scanned_at)
        VALUES (?, ?, ?, 'skill', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          current_hash = excluded.current_hash,
          frontmatter_json = excluded.frontmatter_json,
          updated_at = excluded.updated_at,
          last_scanned_at = excluded.last_scanned_at
      `).run(skillId, name, description, destPath, hash, frontmatterJson, now, now, now)

      tx.prepare(`
        INSERT INTO skill_sources (skill_id, source_type, source_uri, source_ref, imported_from_agent, imported_from_path, installed_via, created_at, updated_at)
        VALUES (?, 'agent_import', ?, NULL, ?, ?, 'spacecode', ?, ?)
        ON CONFLICT(skill_id) DO UPDATE SET
          source_type = excluded.source_type,
          source_uri = excluded.source_uri,
          imported_from_agent = excluded.imported_from_agent,
          imported_from_path = excluded.imported_from_path,
          updated_at = excluded.updated_at
      `).run(skillId, sourcePath, agentId, sourcePath, now, now)
    })
  }

  /**
   * Execute batch adoption of multiple unmanaged skills.
   *
   * Reference: AgentBro `service.rs` `execute_adopt_batch()`
   */
  executeAdoptBatch(items: AdoptBatchItem[]): AdoptBatchResult {
    const results: AdoptResult[] = []
    let successCount = 0
    let failureCount = 0

    for (const item of items) {
      try {
        service_executeAdoptSingle(this, item)
        results.push({
          unmanagedId: item.unmanagedId,
          success: true,
          skillId: item.renamedId ?? null,
          error: null,
        })
        successCount++
      } catch (e) {
        results.push({
          unmanagedId: item.unmanagedId,
          success: false,
          skillId: null,
          error: (e as Error).message,
        })
        failureCount++
      }
    }

    return { results, successCount, failureCount }
  }

  // ── Skill Packs ──────────────────────────────────────────────────

  /**
   * Create or update a skill pack.
   *
   * Reference: AgentBro `service.rs` `upsert_skill_pack()`
   */
  upsertPack(input: UpsertPackInput): SkillPackDetail {
    const name = input.name.trim()
    if (!name) {
      throw new Error('Pack name is required.')
    }

    // Validate members exist in center library
    for (const skillId of input.memberSkillIds) {
      const exists = this.db.conn.prepare(
        'SELECT 1 FROM skills WHERE id = ?'
      ).get(skillId)
      if (!exists) {
        throw new Error(`Pack member '${skillId}' is not in the center library.`)
      }
    }

    const now = nowIso()
    const tagsJson = JSON.stringify(input.tags ?? [])
    const id = input.id ?? `pack-${uuidShort()}`

    this.db.transaction((tx) => {
      // Upsert pack row
      tx.prepare(`
        INSERT INTO skill_packs (id, name, description, tags_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          tags_json = excluded.tags_json,
          updated_at = excluded.updated_at
      `).run(id, name, input.description ?? '', tagsJson, now, now)

      // Replace members
      tx.prepare('DELETE FROM skill_pack_members WHERE pack_id = ?').run(id)
      const memberStmt = tx.prepare(
        'INSERT INTO skill_pack_members (pack_id, skill_id, sort_order, required) VALUES (?, ?, ?, 1)'
      )
      input.memberSkillIds.forEach((skillId, idx) => {
        memberStmt.run(id, skillId, idx)
      })
    })

    return this.getPackDetail(id)!
  }

  /**
   * Get full detail for a skill pack: members + applied agents.
   * Returns null if pack not found.
   *
   * Reference: AgentBro `service.rs` `get_skill_pack_detail()`
   */
  getPackDetail(packId: string): SkillPackDetail | null {
    const row = this.db.conn.prepare(`
      SELECT id, name, description, tags_json, created_at, updated_at
      FROM skill_packs WHERE id = ?
    `).get(packId) as PackDetailRow | undefined

    if (!row) return null

    const members = this.getPackMembers(packId)
    const appliedAgents = this.getPackAppliedAgents(packId)

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      tags: JSON.parse(row.tags_json) as string[],
      members,
      appliedAgents,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  /** Get pack members with skill names and missing flags. */
  private getPackMembers(packId: string): SkillPackMember[] {
    const rows = this.db.conn.prepare(`
      SELECT m.pack_id, m.skill_id, m.sort_order, m.required,
             s.name AS skill_name
      FROM skill_pack_members m
      LEFT JOIN skills s ON s.id = m.skill_id
      WHERE m.pack_id = ?
      ORDER BY m.sort_order
    `).all(packId) as PackMemberRow[]

    return rows.map((r) => ({
      packId: r.pack_id,
      skillId: r.skill_id,
      skillName: r.skill_name ?? r.skill_id,
      sortOrder: r.sort_order,
      required: r.required === 1,
      missing: r.skill_name === null,
    }))
  }

  /** Get agents that have this pack applied (via pack claims on their targets). */
  private getPackAppliedAgents(packId: string): AgentSummary[] {
    const agentIds = this.db.conn.prepare(`
      SELECT DISTINCT t.agent_id
      FROM skill_target_claims c
      JOIN skill_targets t ON t.id = c.target_id
      WHERE c.pack_id = ?
    `).all(packId) as Array<{ agent_id: string }>

    if (agentIds.length === 0) return []

    const agents = this.listAgents()
    const agentIdSet = new Set(agentIds.map((a) => a.agent_id))
    return agents.filter((a) => agentIdSet.has(a.id))
  }

  /**
   * Preview deleting a skill pack.
   * Shows affected agents and whether the pack can be safely deleted.
   */
  previewDeletePack(packId: string): DeletePackPreview {
    const row = this.db.conn.prepare(
      'SELECT id, name FROM skill_packs WHERE id = ?'
    ).get(packId) as { id: string; name: string } | undefined

    if (!row) {
      throw new Error(`Pack not found: ${packId}`)
    }

    const affectedTargets = this.getPackAffectedTargets(packId, null)
    const appliedAgents = [...new Set(affectedTargets.map((t) => t.agentId))]
    const removable = affectedTargets.length === 0
    const warnings = removable
      ? []
      : [`Skill pack '${row.name}' is still applied to ${appliedAgents.length} agent(s). Revoke it before deleting.`]

    return {
      packId: row.id,
      packName: row.name,
      appliedAgents,
      affectedTargets,
      removable,
      warnings,
    }
  }

  /**
   * Delete a skill pack.
   * Throws if the pack is still applied to any agent.
   */
  deletePack(packId: string): void {
    const preview = this.previewDeletePack(packId)
    if (!preview.removable) {
      throw new Error(
        `Pack '${preview.packName}' is applied to ${preview.appliedAgents.length} agent(s). Revoke it from all agents first.`
      )
    }

    // Delete pack (cascade removes skill_pack_members)
    this.db.conn.prepare('DELETE FROM skill_packs WHERE id = ?').run(packId)
  }

  /**
   * Preview applying a pack to target agents.
   * Reuses the distribution preview logic.
   */
  previewApplyPack(
    packId: string,
    targetAgentIds: string[],
    requestedMode: InstallMode
  ): DistributionPreview {
    const detail = this.getPackDetail(packId)
    if (!detail) {
      throw new Error(`Pack not found: ${packId}`)
    }

    const skillIds = detail.members.map((m) => m.skillId)
    return this.previewDistribute(skillIds, targetAgentIds, requestedMode)
  }

  /**
   * Execute applying a pack to target agents.
   * Distributes all member skills and writes pack claims.
   */
  executeApplyPack(
    packId: string,
    targetAgentIds: string[],
    requestedMode: InstallMode
  ): DistributionResult {
    const detail = this.getPackDetail(packId)
    if (!detail) {
      throw new Error(`Pack not found: ${packId}`)
    }

    const preview = this.previewDistribute(
      detail.members.map((m) => m.skillId),
      targetAgentIds,
      requestedMode
    )

    return this.executeDistributeWithPackClaim(preview, packId)
  }

  /**
   * Execute distribution with pack claims instead of direct claims.
   */
  private executeDistributeWithPackClaim(
    preview: DistributionPreview,
    packId: string
  ): DistributionResult {
    const settings = this.getSettings()
    let created = 0
    let reused = 0
    let failed = 0
    const errors: string[] = []

    for (const change of preview.changes) {
      try {
        if (change.action === 'reuse') {
          // Target already exists — add pack claim if not present
          this.ensurePackClaim(change.skillId, change.agentId, packId)
          reused++
          continue
        }

        if (change.action === 'create') {
          const skillRow = this.db.conn.prepare(
            'SELECT id, name, center_path, current_hash FROM skills WHERE id = ?'
          ).get(change.skillId) as { id: string; name: string; center_path: string; current_hash: string }

          const agentRow = this.db.conn.prepare(
            'SELECT id, display_name, skills_dir FROM agents WHERE id = ?'
          ).get(change.agentId) as { id: string; display_name: string; skills_dir: string | null }

          const centerPath = skillRow.center_path
          const targetPath = path.join(agentRow.skills_dir ?? '', change.skillId)

          let actualMode: 'link' | 'copy' = change.mode

          if (change.mode === 'link') {
            const linkResult = createLink(centerPath, targetPath, settings.linkFailPolicy)
            actualMode = linkResult.actualMode
            if (linkResult.error) {
              errors.push(`${change.skillId} → ${change.agentId}: ${linkResult.error}`)
              failed++
              continue
            }
          } else {
            copyDirRecursive(centerPath, targetPath)
          }

          // Write target + pack claim
          this.writeTargetAndPackClaim(
            change.skillId,
            change.agentId,
            targetPath,
            change.mode,
            actualMode,
            skillRow.current_hash,
            packId
          )

          created++
        }
      } catch (e) {
        errors.push(`${change.skillId} → ${change.agentId}: ${(e as Error).message}`)
        failed++
      }
    }

    return {
      success: failed === 0,
      created,
      reused,
      failed,
      errors,
    }
  }

  /**
   * Write a skill_target row and a pack claim row.
   */
  private writeTargetAndPackClaim(
    skillId: string,
    agentId: string,
    targetPath: string,
    installMode: InstallMode,
    actualMode: 'link' | 'copy',
    sourceHash: string,
    packId: string
  ): void {
    const now = nowIso()
    const targetId = `${skillId}__${agentId}`

    this.db.transaction((tx) => {
      // Upsert target
      tx.prepare(`
        INSERT INTO skill_targets (id, skill_id, agent_id, target_path, install_mode, actual_mode, source_hash, current_hash, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'ok', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          install_mode = excluded.install_mode,
          actual_mode = excluded.actual_mode,
          source_hash = excluded.source_hash,
          status = 'ok',
          updated_at = excluded.updated_at
      `).run(targetId, skillId, agentId, targetPath, installMode, actualMode, sourceHash, now, now)

      // Upsert pack claim (UNIQUE on target_id + claim_type + pack_id)
      tx.prepare(`
        INSERT INTO skill_target_claims (id, target_id, claim_type, pack_id, created_at)
        VALUES (?, ?, 'pack', ?, ?)
        ON CONFLICT(target_id, claim_type, pack_id) DO NOTHING
      `).run(`${targetId}__pack__${packId}`, targetId, packId, now)
    })
  }

  /**
   * Ensure a pack claim exists on an already-existing target.
   */
  private ensurePackClaim(skillId: string, agentId: string, packId: string): void {
    const targetId = `${skillId}__${agentId}`
    const now = nowIso()

    this.db.conn.prepare(`
      INSERT INTO skill_target_claims (id, target_id, claim_type, pack_id, created_at)
      VALUES (?, ?, 'pack', ?, ?)
      ON CONFLICT(target_id, claim_type, pack_id) DO NOTHING
    `).run(`${targetId}__pack__${packId}`, targetId, packId, now)
  }

  /**
   * Preview removing a pack from an agent.
   * Shows which targets will be removed (last claim) vs preserved (other claims remain).
   */
  previewRemovePackFromAgent(packId: string, agentId: string): RemovePackFromAgentPreview {
    const packRow = this.db.conn.prepare(
      'SELECT id, name FROM skill_packs WHERE id = ?'
    ).get(packId) as { id: string; name: string } | undefined

    if (!packRow) {
      throw new Error(`Pack not found: ${packId}`)
    }

    const agentRow = this.db.conn.prepare(
      'SELECT id, display_name FROM agents WHERE id = ?'
    ).get(agentId) as { id: string; display_name: string } | undefined

    if (!agentRow) {
      throw new Error(`Agent not found: ${agentId}`)
    }

    const affectedTargets = this.getPackAffectedTargets(packId, agentId)
    const willRemove = affectedTargets.filter((t) => t.claimCount <= 1).length
    const willPreserve = affectedTargets.length - willRemove

    return {
      packId: packRow.id,
      packName: packRow.name,
      agentId,
      agentName: agentRow.display_name,
      affectedTargets,
      willRemoveTargets: willRemove,
      willPreserveTargets: willPreserve,
    }
  }

  /**
   * Remove a pack from an agent.
   * Deletes only the pack's claims; removes target files only when no claims remain.
   */
  removePackFromAgent(packId: string, agentId: string): RemovePackFromAgentResult {
    const preview = this.previewRemovePackFromAgent(packId, agentId)

    let removedClaims = 0
    let removedTargets = 0
    let preservedTargets = 0

    for (const target of preview.affectedTargets) {
      // Delete the pack claim
      this.db.conn.prepare(
        'DELETE FROM skill_target_claims WHERE target_id = ? AND pack_id = ?'
      ).run(target.targetId, packId)
      removedClaims++

      // Check remaining claims
      const remaining = this.countClaims(target.targetId)
      if (remaining === 0) {
        // Remove target file + DB record
        removePath(target.targetPath)
        this.db.conn.prepare('DELETE FROM skill_targets WHERE id = ?').run(target.targetId)
        removedTargets++
      } else {
        preservedTargets++
      }
    }

    return {
      packId,
      agentId,
      removedClaims,
      removedTargets,
      preservedTargets,
    }
  }

  /** Count claims on a target. */
  private countClaims(targetId: string): number {
    const row = this.db.conn.prepare(
      'SELECT COUNT(*) AS c FROM skill_target_claims WHERE target_id = ?'
    ).get(targetId) as { c: number }
    return row.c
  }

  /** Get affected targets for a pack, optionally filtered by agent. */
  private getPackAffectedTargets(packId: string, agentId: string | null): PackAffectedTarget[] {
    const sql = agentId
      ? `SELECT DISTINCT t.id, t.agent_id, t.target_path, t.actual_mode
         FROM skill_target_claims c
         JOIN skill_targets t ON t.id = c.target_id
         WHERE c.pack_id = ? AND t.agent_id = ?
         ORDER BY t.agent_id, t.target_path`
      : `SELECT DISTINCT t.id, t.agent_id, t.target_path, t.actual_mode
         FROM skill_target_claims c
         JOIN skill_targets t ON t.id = c.target_id
         WHERE c.pack_id = ?
         ORDER BY t.agent_id, t.target_path`

    const params = agentId ? [packId, agentId] : [packId]
    const rows = this.db.conn.prepare(sql).all(...params) as Array<{
      id: string
      agent_id: string
      target_path: string
      actual_mode: string
    }>

    return rows.map((r) => ({
      targetId: r.id,
      agentId: r.agent_id,
      targetPath: r.target_path,
      mode: r.actual_mode,
      claimCount: this.countClaims(r.id),
    }))
  }

  // ── Copy Sync ────────────────────────────────────────────────────

  /**
   * Preview copy sync for a target.
   * Computes center hash + agent copy hash and determines status.
   *
   * Reference: AgentBro `service.rs` `preview_sync_copy_target()`
   */
  previewSyncCopy(targetId: string): CopySyncPreview {
    const row = this.db.conn.prepare(`
      SELECT id, skill_id, target_path, source_hash, current_hash, actual_mode
      FROM skill_targets WHERE id = ?
    `).get(targetId) as TargetSyncRow | undefined

    if (!row) {
      throw new Error(`Target not found: ${targetId}`)
    }

    // Only copy targets are syncable
    if (row.actual_mode !== 'copy') {
      throw new Error(`Target ${targetId} is not a copy target (mode: ${row.actual_mode})`)
    }

    // Get center library hash from live disk
    const skillRow = this.db.conn.prepare(
      'SELECT id, center_path, current_hash FROM skills WHERE id = ?'
    ).get(row.skill_id) as { id: string; center_path: string; current_hash: string } | undefined

    if (!skillRow) {
      throw new Error(`Skill not found: ${row.skill_id}`)
    }

    const centerHash = pathExists(skillRow.center_path) && fs.statSync(skillRow.center_path).isDirectory()
      ? hashDir(skillRow.center_path)
      : skillRow.current_hash

    const agentHash = pathExists(row.target_path) && fs.statSync(row.target_path).isDirectory()
      ? hashDir(row.target_path)
      : row.current_hash ?? null

    const centerChanged = centerHash !== row.source_hash
    const copyChanged = agentHash !== null && agentHash !== row.source_hash

    let status: CopySyncStatus
    let suggested: CopySyncAction | 'none'

    if (centerChanged && copyChanged) {
      status = 'copy_diverged'
      suggested = 'manual'
    } else if (centerChanged) {
      status = 'copy_outdated'
      suggested = 'center_over_agent'
    } else if (copyChanged) {
      status = 'copy_modified'
      suggested = 'agent_over_center'
    } else {
      status = 'ok'
      suggested = 'none'
    }

    return {
      targetId,
      skillId: row.skill_id,
      targetPath: row.target_path,
      sourceHash: row.source_hash,
      centerHash,
      agentHash,
      status,
      suggested,
    }
  }

  /**
   * Execute copy sync.
   * - center_over_agent: overwrite agent copy with center library version
   * - agent_over_center: overwrite center library with agent copy
   * - manual: keep diverged state (no file writes, just mark status)
   *
   * Reference: AgentBro `service.rs` `execute_sync_copy_target()`
   */
  executeSyncCopy(targetId: string, action: CopySyncAction): CopySyncResult {
    const preview = this.previewSyncCopy(targetId)
    const now = nowIso()

    if (action === 'center_over_agent') {
      const skillRow = this.db.conn.prepare(
        'SELECT center_path FROM skills WHERE id = ?'
      ).get(preview.skillId) as { center_path: string }

      // Overwrite agent copy with center library content
      removePath(preview.targetPath)
      copyDirRecursive(skillRow.center_path, preview.targetPath)

      const newSourceHash = hashDir(skillRow.center_path)
      const newAgentHash = hashDir(preview.targetPath)

      this.db.transaction((tx) => {
        tx.prepare(
          'UPDATE skills SET current_hash = ?, updated_at = ? WHERE id = ?'
        ).run(newSourceHash, now, preview.skillId)

        tx.prepare(`
          UPDATE skill_targets
          SET source_hash = ?, current_hash = ?, status = 'ok', updated_at = ?
          WHERE id = ?
        `).run(newSourceHash, newAgentHash, now, targetId)
      })

      const nextPreview = this.previewSyncCopy(targetId)
      return {
        success: true,
        action,
        message: `Agent copy updated from center library.`,
        preview: nextPreview,
      }
    }

    if (action === 'agent_over_center') {
      // Overwrite center library with agent copy
      const skillRow = this.db.conn.prepare(
        'SELECT center_path FROM skills WHERE id = ?'
      ).get(preview.skillId) as { center_path: string }

      removePath(skillRow.center_path)
      copyDirRecursive(preview.targetPath, skillRow.center_path)

      const newHash = hashDir(skillRow.center_path)

      this.db.transaction((tx) => {
        tx.prepare(
          'UPDATE skills SET current_hash = ?, updated_at = ? WHERE id = ?'
        ).run(newHash, now, preview.skillId)

        tx.prepare(`
          UPDATE skill_targets
          SET source_hash = ?, current_hash = ?, status = 'ok', updated_at = ?
          WHERE id = ?
        `).run(newHash, newHash, now, targetId)

        // Record source as agent_override
        tx.prepare(`
          UPDATE skill_sources
          SET source_type = 'agent_override', updated_at = ?
          WHERE skill_id = ?
        `).run(now, preview.skillId)
      })

      const nextPreview = this.previewSyncCopy(targetId)
      return {
        success: true,
        action,
        message: `Center library updated from agent copy.`,
        preview: nextPreview,
      }
    }

    // action === 'manual' — just mark status as copy_diverged
    this.db.conn.prepare(`
      UPDATE skill_targets SET status = 'copy_diverged', updated_at = ? WHERE id = ?
    `).run(now, targetId)

    const nextPreview = this.previewSyncCopy(targetId)
    return {
      success: true,
      action,
      message: `Diverged state preserved. Manual resolution required.`,
      preview: nextPreview,
    }
  }

  /**
   * Preview file-level diff between center library and agent copy.
   *
   * Reference: AgentBro `service.rs` `preview_copy_target_diff()`
   */
  previewCopyTargetDiff(targetId: string): CopyTargetDiffPreview {
    const sync = this.previewSyncCopy(targetId)

    const skillRow = this.db.conn.prepare(
      'SELECT center_path FROM skills WHERE id = ?'
    ).get(sync.skillId) as { center_path: string }

    const centerPath = skillRow.center_path
    const copyPath = sync.targetPath

    if (!pathExists(centerPath) || !fs.statSync(centerPath).isDirectory()) {
      throw new Error(`Center path is not a directory: ${centerPath}`)
    }
    if (!pathExists(copyPath) || !fs.statSync(copyPath).isDirectory()) {
      throw new Error(`Copy target is not a directory: ${copyPath}`)
    }

    const centerFiles = collectRelativeFiles(centerPath)
    const copyFiles = collectRelativeFiles(copyPath)
    const allFiles = new Set([...centerFiles, ...copyFiles])

    const files: CopyTargetDiffFile[] = []
    for (const rel of allFiles) {
      const centerBytes = readRelativeFile(centerPath, rel)
      const copyBytes = readRelativeFile(copyPath, rel)

      if (centerBytes !== null && copyBytes !== null && centerBytes === copyBytes) {
        continue // Same content
      }

      let changeType: CopyTargetDiffFile['changeType']
      if (centerBytes !== null && copyBytes !== null) {
        changeType = 'modified'
      } else if (centerBytes !== null && copyBytes === null) {
        changeType = 'copy_removed'
      } else if (centerBytes === null && copyBytes !== null) {
        changeType = 'copy_added'
      } else {
        continue
      }

      files.push({
        path: rel,
        changeType,
        centerContent: centerBytes,
        copyContent: copyBytes,
      })
    }

    return {
      targetId,
      skillId: sync.skillId,
      targetPath: sync.targetPath,
      centerPath,
      status: sync.status,
      files,
    }
  }
}

// Helper function to avoid `this` binding issues in batch loop
function service_executeAdoptSingle(
  svc: SkillManagerService,
  item: AdoptBatchItem
): void {
  svc.executeAdopt(item.agentId, item.unmanagedId, item.option, item.renamedId)
}

// ── UUID short helper ─────────────────────────────────────────────

function uuidShort(): string {
  return crypto.randomBytes(6).toString('hex')
}

// ── Internal row types ─────────────────────────────────────────────

interface AgentRow {
  id: string
  display_name: string
  skills_dir: string | null
  config_path: string | null
  mcp_config_path: string | null
  plugin_dir: string | null
  version: string | null
  latest_version: string | null
  enabled: number
  last_scanned_at: string | null
  managed_count: number
  unmanaged_count: number
}

interface SkillRow {
  id: string
  name: string
  description: string
  skill_type: string
  center_path: string
  current_hash: string
  created_at: string
  updated_at: string
  source_type: string | null
}

interface TargetBadgeRow {
  agent_id: string
  actual_mode: string
  status: string
  display_name: string
}

interface PackRow {
  id: string
  name: string
  description: string
  tags_json: string
  created_at: string
  updated_at: string
  member_count: number
  applied_agent_count: number
}

interface UnmanagedRow {
  id: string
  item_type: string
  agent_id: string | null
  path: string
  inferred_skill_id: string | null
  hash: string | null
  reason: string
  first_seen_at: string
  last_seen_at: string
}

interface IssueRow {
  id: string
  issue_type: string
  severity: string
  entity_type: string
  entity_id: string | null
  title: string
  detail: string
  fix_kind: string
  payload_json: string
  created_at: string
  resolved_at: string | null
}

interface SkillDetailRow {
  id: string
  name: string
  description: string
  skill_type: string
  center_path: string
  current_hash: string
  frontmatter_json: string
  created_at: string
  updated_at: string
  last_scanned_at: string | null
}

interface SourceRow {
  skill_id: string
  source_type: string
  source_uri: string | null
  source_ref: string | null
  imported_from_agent: string | null
  imported_from_path: string | null
  installed_via: string
  created_at: string
  updated_at: string
}

interface TargetRow {
  id: string
  skill_id: string
  agent_id: string
  target_path: string
  install_mode: string
  actual_mode: string
  source_hash: string
  current_hash: string | null
  status: string
  created_at: string
  updated_at: string
}

interface ClaimRow {
  id: string
  target_id: string
  claim_type: string
  pack_id: string | null
  created_at: string
}

interface PackDetailRow {
  id: string
  name: string
  description: string
  tags_json: string
  created_at: string
  updated_at: string
}

interface PackMemberRow {
  pack_id: string
  skill_id: string
  sort_order: number
  required: number
  skill_name: string | null
}

interface TargetSyncRow {
  id: string
  skill_id: string
  target_path: string
  source_hash: string
  current_hash: string | null
  actual_mode: string
}

interface AgentDetailRow {
  id: string
  display_name: string
  skills_dir: string | null
  config_path: string | null
  version: string | null
  last_scanned_at: string | null
}

// ── Copy sync helpers ──────────────────────────────────────────────

/** Collect relative file paths from a directory (non-recursive, flat). */
function collectRelativeFiles(dir: string): Set<string> {
  const result = new Set<string>()
  collectRelativeFilesRecursive(dir, '', result)
  return result
}

function collectRelativeFilesRecursive(baseDir: string, relPrefix: string, out: Set<string>): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (isIgnoredEntry(entry.name)) continue
    const rel = relPrefix ? path.join(relPrefix, entry.name) : entry.name
    if (entry.isDirectory()) {
      if (entry.isSymbolicLink()) continue
      collectRelativeFilesRecursive(path.join(baseDir, entry.name), rel, out)
    } else if (entry.isFile()) {
      out.add(rel)
    }
  }
}

/** Read a file relative to a base directory. Returns null if not found. */
function readRelativeFile(baseDir: string, relPath: string): string | null {
  const fullPath = path.join(baseDir, relPath)
  try {
    return fs.readFileSync(fullPath, 'utf-8')
  } catch {
    return null
  }
}
