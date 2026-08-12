/**
 * Skill Manager V2 — JSON Snapshot Export
 *
 * Exports the entire Skill Manager state as a JSON-serializable object.
 *
 * Reference: AgentBro `src-tauri/src/skills/v2/snapshot.rs`
 */

import type { Db } from './db'
import { nowIso } from './fsutil'

// ── Snapshot types ─────────────────────────────────────────────────

export interface SkillManagerSnapshot {
  version: number
  exportedAt: string
  centerLibraryPath: string
  settings: Record<string, unknown>
  skills: Array<Record<string, unknown>>
  agents: Array<Record<string, unknown>>
  targets: Array<Record<string, unknown>>
  claims: Array<Record<string, unknown>>
  packs: Array<Record<string, unknown>>
  packMembers: Array<Record<string, unknown>>
  unmanaged: Array<Record<string, unknown>>
  issues: Array<Record<string, unknown>>
}

// ── Snapshot exporter ──────────────────────────────────────────────

export function exportSnapshot(db: Db, centerPath: string): SkillManagerSnapshot {
  const settings = db.loadSettingsJson()

  const skillRows = db.conn.prepare('SELECT * FROM skills ORDER BY name').all() as Array<Record<string, unknown>>
  const skills = skillRows.map((r) => ({
    id: r['id'],
    name: r['name'],
    description: r['description'],
    skillType: r['skill_type'],
    centerPath: r['center_path'],
    currentHash: r['current_hash'],
    frontmatterJson: r['frontmatter_json'],
    createdAt: r['created_at'],
    updatedAt: r['updated_at'],
    lastScannedAt: r['last_scanned_at'],
  }))
  const agents = db.conn.prepare('SELECT * FROM agents ORDER BY display_name').all() as Array<Record<string, unknown>>
  const targets = db.conn.prepare('SELECT * FROM skill_targets ORDER BY created_at').all() as Array<Record<string, unknown>>
  const claims = db.conn.prepare('SELECT * FROM skill_target_claims ORDER BY created_at').all() as Array<Record<string, unknown>>
  const packs = db.conn.prepare('SELECT * FROM skill_packs ORDER BY name').all() as Array<Record<string, unknown>>
  const packMembers = db.conn.prepare('SELECT * FROM skill_pack_members ORDER BY pack_id, sort_order').all() as Array<Record<string, unknown>>
  const unmanaged = db.conn.prepare('SELECT * FROM unmanaged_items ORDER BY last_seen_at DESC').all() as Array<Record<string, unknown>>
  const issues = db.conn.prepare(
    'SELECT * FROM diagnosis_issues WHERE resolved_at IS NULL ORDER BY created_at DESC'
  ).all() as Array<Record<string, unknown>>

  return {
    version: 1,
    exportedAt: nowIso(),
    centerLibraryPath: centerPath,
    settings,
    skills,
    agents,
    targets,
    claims,
    packs,
    packMembers,
    unmanaged,
    issues,
  }
}
