/**
 * Skill Manager V2 — Core Service
 *
 * bootstrap(): Ensure directories + DB exist, seed built-in agents.
 * getOverview(): Return SkillManagerOverview DTO.
 * refresh(): Full scan of center library + known agent directories.
 *
 * Reference: AgentBro `src-tauri/src/skills/v2/service.rs`
 */

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
} from './fsutil'
import { scanCenterLibrary } from './scanner'
import { getBuiltInAgents } from './agentRegistry'
import type {
  AgentSummary,
  SkillManagerOverview,
  SkillManagerSettings,
  SkillPackSummary,
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
             (SELECT COUNT(*) FROM skill_targets t WHERE t.agent_id = a.id) AS managed_count
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
      unmanagedCount: 0,
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
