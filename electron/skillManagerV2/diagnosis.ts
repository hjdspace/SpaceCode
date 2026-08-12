/**
 * Skill Manager V2 — Diagnosis Engine
 *
 * Scans DB + filesystem for health issues and generates DiagnosisIssue list.
 * Provides auto-fix for safe (auto-level) issues.
 *
 * Reference: AgentBro `src-tauri/src/skills/v2/diagnosis.rs`
 */

import * as fs from 'fs'
import * as path from 'path'

import type { Db } from './db'
import type {
  DiagnosisIssue,
  DiagnosisSeverity,
  FixKind,
  EntityType,
} from '@/types/skillManagerV2'
import { nowIso, isSkillDir, isIgnoredEntry, pathExists, hashDir } from './fsutil'

// ── Types ──────────────────────────────────────────────────────────

export interface SafeFixResult {
  fixedCount: number
  details: string[]
}

// ── Diagnosis Engine ───────────────────────────────────────────────

export class DiagnosisEngine {
  private db: Db
  private centerPath: string

  constructor(db: Db, centerPath: string) {
    this.db = db
    this.centerPath = centerPath
  }

  /**
   * Run a full diagnosis scan.
   * Clears old unresolved issues, then generates new ones.
   */
  run(): DiagnosisIssue[] {
    const now = nowIso()

    // Mark all old unresolved issues as resolved (they'll be re-evaluated)
    this.db.conn.prepare(
      'UPDATE diagnosis_issues SET resolved_at = ? WHERE resolved_at IS NULL'
    ).run(now)

    const issues: DiagnosisIssue[] = []

    // Run all detectors
    this.detectUnmanagedCenterDirs(issues, now)
    this.detectAgentUnmanagedSkills(issues, now)
    this.detectBrokenLinks(issues, now)
    this.detectStaleTargets(issues, now)
    this.detectCopyDiverged(issues, now)
    this.detectPackMemberMissing(issues, now)
    this.detectOrphanClaims(issues, now)

    // Insert new issues into DB
    const insertStmt = this.db.conn.prepare(`
      INSERT INTO diagnosis_issues (id, issue_type, severity, entity_type, entity_id, title, detail, fix_kind, payload_json, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `)

    for (const issue of issues) {
      insertStmt.run(
        issue.id,
        issue.issueType,
        issue.severity,
        issue.entityType,
        issue.entityId,
        issue.title,
        issue.detail,
        issue.fixKind,
        issue.payloadJson,
        issue.createdAt
      )
    }

    return issues
  }

  /**
   * Execute all auto-level safe fixes.
   */
  executeSafeFixes(): SafeFixResult {
    const autoIssues = this.db.conn.prepare(`
      SELECT id, issue_type, entity_id, payload_json
      FROM diagnosis_issues
      WHERE resolved_at IS NULL AND fix_kind = 'auto'
    `).all() as Array<{
      id: string
      issue_type: string
      entity_id: string | null
      payload_json: string
    }>

    let fixedCount = 0
    const details: string[] = []

    for (const issue of autoIssues) {
      try {
        const fixed = this.applyFix(issue.issue_type, issue.entity_id, issue.payload_json)
        if (fixed) {
          // Mark issue as resolved
          this.db.conn.prepare(
            'UPDATE diagnosis_issues SET resolved_at = ? WHERE id = ?'
          ).run(nowIso(), issue.id)
          fixedCount++
          details.push(`Fixed: ${issue.issue_type} (${issue.entity_id ?? 'N/A'})`)
        }
      } catch {
        // Skip failed fixes
      }
    }

    return { fixedCount, details }
  }

  // ── Detectors ──────────────────────────────────────────────────

  /**
   * Detect directories in the center library that are not in the DB.
   */
  private detectUnmanagedCenterDirs(issues: DiagnosisIssue[], now: string): void {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(this.centerPath, { withFileTypes: true })
    } catch {
      return
    }

    // Get all skill IDs from DB
    const dbSkillIds = new Set(
      (this.db.conn.prepare('SELECT id FROM skills').all() as Array<{ id: string }>).map((r) => r.id)
    )

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (isIgnoredEntry(entry.name)) continue
      if (dbSkillIds.has(entry.name)) continue

      const dirPath = path.join(this.centerPath, entry.name)
      if (!isSkillDir(dirPath)) continue

      issues.push({
        id: `unmanaged_center__${entry.name}`,
        issueType: 'unmanaged_center_dir',
        severity: 'info',
        entityType: 'skill',
        entityId: entry.name,
        title: `Unmanaged directory in center library: ${entry.name}`,
        detail: `Directory '${entry.name}' exists in the center library but is not tracked in the database. Run a refresh to adopt it.`,
        fixKind: 'info',
        payloadJson: JSON.stringify({ path: dirPath }),
        createdAt: now,
        resolvedAt: null,
      })
    }
  }

  /**
   * Detect unmanaged skills in agent directories.
   */
  private detectAgentUnmanagedSkills(issues: DiagnosisIssue[], now: string): void {
    const unmanaged = this.db.conn.prepare(`
      SELECT id, agent_id, path, inferred_skill_id, reason
      FROM unmanaged_items
    `).all() as Array<{
      id: string
      agent_id: string | null
      path: string
      inferred_skill_id: string | null
      reason: string
    }>

    for (const item of unmanaged) {
      issues.push({
        id: `agent_unmanaged__${item.id}`,
        issueType: 'agent_unmanaged_skill',
        severity: 'info',
        entityType: 'agent',
        entityId: item.agent_id,
        title: `Unmanaged skill in agent: ${item.inferred_skill_id ?? path.basename(item.path)}`,
        detail: `${item.reason}. Path: ${item.path}`,
        fixKind: 'manual',
        payloadJson: JSON.stringify({ unmanagedId: item.id, agentId: item.agent_id }),
        createdAt: now,
        resolvedAt: null,
      })
    }
  }

  /**
   * Detect broken symlink targets (link points to non-existent center library directory).
   */
  private detectBrokenLinks(issues: DiagnosisIssue[], now: string): void {
    const targets = this.db.conn.prepare(`
      SELECT id, skill_id, agent_id, target_path, actual_mode, source_hash
      FROM skill_targets
      WHERE actual_mode = 'link'
    `).all() as Array<{
      id: string
      skill_id: string
      agent_id: string
      target_path: string
      actual_mode: string
      source_hash: string
    }>

    for (const target of targets) {
      // Check if the symlink target (center library path) still exists
      const skillRow = this.db.conn.prepare(
        'SELECT center_path FROM skills WHERE id = ?'
      ).get(target.skill_id) as { center_path: string } | undefined

      if (!skillRow) {
        // Skill was deleted from DB but target remains — broken
        issues.push({
          id: `broken_link__${target.id}`,
          issueType: 'broken_link',
          severity: 'error',
          entityType: 'target',
          entityId: target.id,
          title: `Broken link: ${target.skill_id}`,
          detail: `Symlink target '${target.target_path}' points to a skill that no longer exists in the center library.`,
          fixKind: 'auto',
          payloadJson: JSON.stringify({ targetId: target.id, targetPath: target.target_path }),
          createdAt: now,
          resolvedAt: null,
        })
        continue
      }

      // Check if center_path exists on disk
      if (!pathExists(skillRow.center_path)) {
        issues.push({
          id: `broken_link__${target.id}`,
          issueType: 'broken_link',
          severity: 'error',
          entityType: 'target',
          entityId: target.id,
          title: `Broken link: ${target.skill_id}`,
          detail: `Symlink target '${target.target_path}' points to '${skillRow.center_path}' which no longer exists on disk.`,
          fixKind: 'auto',
          payloadJson: JSON.stringify({ targetId: target.id, targetPath: target.target_path }),
          createdAt: now,
          resolvedAt: null,
        })
      }
    }
  }

  /**
   * Detect stale targets (DB has target record but file doesn't exist on disk).
   */
  private detectStaleTargets(issues: DiagnosisIssue[], now: string): void {
    const targets = this.db.conn.prepare(`
      SELECT id, skill_id, agent_id, target_path, actual_mode
      FROM skill_targets
    `).all() as Array<{
      id: string
      skill_id: string
      agent_id: string
      target_path: string
      actual_mode: string
    }>

    for (const target of targets) {
      if (pathExists(target.target_path)) continue

      issues.push({
        id: `stale_target__${target.id}`,
        issueType: 'stale_target',
        severity: 'warning',
        entityType: 'target',
        entityId: target.id,
        title: `Stale target: ${target.skill_id}`,
        detail: `Target '${target.target_path}' is in the database but the file/link does not exist on disk.`,
        fixKind: 'auto',
        payloadJson: JSON.stringify({ targetId: target.id }),
        createdAt: now,
        resolvedAt: null,
      })
    }
  }

  /**
   * Detect copy targets that have diverged from the center library.
   * Compares the actual disk hash of the agent copy against the center library hash.
   */
  private detectCopyDiverged(issues: DiagnosisIssue[], now: string): void {
    const targets = this.db.conn.prepare(`
      SELECT id, skill_id, target_path, source_hash, current_hash, status, actual_mode
      FROM skill_targets
      WHERE actual_mode = 'copy'
    `).all() as Array<{
      id: string
      skill_id: string
      target_path: string
      source_hash: string
      current_hash: string | null
      status: string
      actual_mode: string
    }>

    for (const target of targets) {
      // Skip if target path doesn't exist (stale target is handled elsewhere)
      if (!pathExists(target.target_path)) continue

      // Get center library hash from DB (refreshed by scanCenterLibrary)
      const skillRow = this.db.conn.prepare(
        'SELECT center_path, current_hash FROM skills WHERE id = ?'
      ).get(target.skill_id) as { center_path: string; current_hash: string } | undefined

      if (!skillRow) continue
      if (!pathExists(skillRow.center_path)) continue

      const centerHash = skillRow.current_hash
      const agentHash = hashDir(target.target_path)

      // Diverged: both center and agent copy differ from the original source hash
      if (centerHash !== target.source_hash && agentHash !== target.source_hash) {
        issues.push({
          id: `copy_diverged__${target.id}`,
          issueType: 'copy_diverged',
          severity: 'warning',
          entityType: 'target',
          entityId: target.id,
          title: `Copy diverged: ${target.skill_id}`,
          detail: `Agent copy at '${target.target_path}' has diverged from the center library version. Manual resolution required.`,
          fixKind: 'confirm',
          payloadJson: JSON.stringify({ targetId: target.id, skillId: target.skill_id }),
          createdAt: now,
          resolvedAt: null,
        })
      }
    }
  }

  /**
   * Detect pack members that are missing from the center library.
   */
  private detectPackMemberMissing(issues: DiagnosisIssue[], now: string): void {
    const members = this.db.conn.prepare(`
      SELECT m.pack_id, m.skill_id, p.name AS pack_name
      FROM skill_pack_members m
      JOIN skill_packs p ON p.id = m.pack_id
      LEFT JOIN skills s ON s.id = m.skill_id
      WHERE s.id IS NULL
    `).all() as Array<{
      pack_id: string
      skill_id: string
      pack_name: string
    }>

    for (const member of members) {
      issues.push({
        id: `pack_missing__${member.pack_id}__${member.skill_id}`,
        issueType: 'pack_member_missing',
        severity: 'warning',
        entityType: 'pack',
        entityId: member.pack_id,
        title: `Missing pack member: ${member.skill_id}`,
        detail: `Pack '${member.pack_name}' references skill '${member.skill_id}' which no longer exists in the center library.`,
        fixKind: 'auto',
        payloadJson: JSON.stringify({ packId: member.pack_id, skillId: member.skill_id }),
        createdAt: now,
        resolvedAt: null,
      })
    }
  }

  /**
   * Detect orphan pack claims (pack claim exists but target doesn't).
   */
  private detectOrphanClaims(issues: DiagnosisIssue[], now: string): void {
    const claims = this.db.conn.prepare(`
      SELECT c.id, c.target_id, c.pack_id, c.claim_type
      FROM skill_target_claims c
      LEFT JOIN skill_targets t ON t.id = c.target_id
      WHERE t.id IS NULL
    `).all() as Array<{
      id: string
      target_id: string
      pack_id: string | null
      claim_type: string
    }>

    for (const claim of claims) {
      issues.push({
        id: `orphan_claim__${claim.id}`,
        issueType: 'orphan_claim',
        severity: 'warning',
        entityType: 'target',
        entityId: claim.target_id,
        title: `Orphan claim`,
        detail: `Claim '${claim.id}' references target '${claim.target_id}' which no longer exists.`,
        fixKind: 'auto',
        payloadJson: JSON.stringify({ claimId: claim.id }),
        createdAt: now,
        resolvedAt: null,
      })
    }
  }

  // ── Fix appliers ───────────────────────────────────────────────

  private applyFix(issueType: string, entityId: string | null, payloadJson: string): boolean {
    const payload = JSON.parse(payloadJson) as Record<string, unknown>

    switch (issueType) {
      case 'broken_link':
        return this.fixBrokenLink(payload)
      case 'stale_target':
        return this.fixStaleTarget(payload)
      case 'pack_member_missing':
        return this.fixPackMemberMissing(payload)
      case 'orphan_claim':
        return this.fixOrphanClaim(payload)
      default:
        return false
    }
  }

  /** Remove a broken link target from disk and DB. */
  private fixBrokenLink(payload: Record<string, unknown>): boolean {
    const targetId = payload.targetId as string
    const targetPath = payload.targetPath as string

    // Remove the broken symlink from disk
    try {
      if (pathExists(targetPath)) {
        fs.unlinkSync(targetPath)
      }
    } catch {
      // Ignore — might already be gone
    }

    // Delete from DB (cascade removes claims)
    this.db.conn.prepare('DELETE FROM skill_targets WHERE id = ?').run(targetId)
    return true
  }

  /** Remove a stale target from DB (file already missing). */
  private fixStaleTarget(payload: Record<string, unknown>): boolean {
    const targetId = payload.targetId as string
    this.db.conn.prepare('DELETE FROM skill_targets WHERE id = ?').run(targetId)
    return true
  }

  /** Remove a missing pack member reference. */
  private fixPackMemberMissing(payload: Record<string, unknown>): boolean {
    const packId = payload.packId as string
    const skillId = payload.skillId as string
    this.db.conn.prepare(
      'DELETE FROM skill_pack_members WHERE pack_id = ? AND skill_id = ?'
    ).run(packId, skillId)
    return true
  }

  /** Remove an orphan claim. */
  private fixOrphanClaim(payload: Record<string, unknown>): boolean {
    const claimId = payload.claimId as string
    this.db.conn.prepare('DELETE FROM skill_target_claims WHERE id = ?').run(claimId)
    return true
  }
}
