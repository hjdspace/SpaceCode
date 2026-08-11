/**
 * Skill Manager V2 — Center Library Scanner
 *
 * Scans the center library directory (`~/.spacecode/skills`) for skill subdirectories,
 * parses frontmatter, computes directory hashes, and upserts into the DB.
 *
 * Reference: AgentBro `src-tauri/src/skills/v2/service.rs` `scan_center_library()`
 */

import * as fs from 'fs'
import * as path from 'path'

import { Db } from './db'
import {
  hashDir,
  isIgnoredEntry,
  isSkillDir,
  nowIso,
  readFrontmatter,
} from './fsutil'

// ── Types ──────────────────────────────────────────────────────────

/** A discovered skill on disk, not yet written to DB. */
export interface DiscoveredSkill {
  id: string
  dir: string
  name: string
  description: string
  hash: string
  frontmatterJson: string
}

/** Result of a center library scan. */
export interface ScanResult {
  discovered: DiscoveredSkill[]
  orphanedDbIds: string[]
}

// ── Scanner ────────────────────────────────────────────────────────

/**
 * Scan the center library directory for valid skill subdirectories.
 * Returns discovered skills and DB ids that no longer exist on disk.
 */
export function scanCenterDir(centerPath: string): DiscoveredSkill[] {
  fs.mkdirSync(centerPath, { recursive: true })

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(centerPath, { withFileTypes: true })
  } catch {
    return []
  }

  const discovered: DiscoveredSkill[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (isIgnoredEntry(entry.name)) continue
    const skillDir = path.join(centerPath, entry.name)
    if (!isSkillDir(skillDir)) continue

    const fm = readFrontmatter(skillDir)
    const name = fm.map.get('name') ?? entry.name
    const description = fm.map.get('description') ?? ''
    const hash = hashDir(skillDir)
    const frontmatterJson = JSON.stringify(Object.fromEntries(fm.map))

    discovered.push({ id: entry.name, dir: skillDir, name, description, hash, frontmatterJson })
  }

  return discovered
}

/**
 * Upsert discovered skills into the DB, and return DB ids that no longer exist on disk.
 */
export function upsertScannedSkills(db: Db, discovered: DiscoveredSkill[]): string[] {
  const now = nowIso()

  const upsertStmt = db.conn.prepare(`
    INSERT INTO skills (id, name, description, skill_type, center_path, current_hash, frontmatter_json, created_at, updated_at, last_scanned_at)
    VALUES (?, ?, ?, 'skill', ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      current_hash = excluded.current_hash,
      frontmatter_json = excluded.frontmatter_json,
      updated_at = excluded.updated_at,
      last_scanned_at = excluded.last_scanned_at
  `)

  const existingIds = new Set(
    (db.conn.prepare('SELECT id FROM skills').all() as Array<{ id: string }>).map((r) => r.id)
  )

  for (const skill of discovered) {
    upsertStmt.run(skill.id, skill.name, skill.description, skill.dir, skill.hash, skill.frontmatterJson, now, now, now)
    existingIds.delete(skill.id)
  }

  return Array.from(existingIds)
}

/**
 * Full scan: discover skills on disk, upsert to DB, return result.
 */
export function scanCenterLibrary(db: Db, centerPath: string): ScanResult {
  const discovered = scanCenterDir(centerPath)
  const orphanedDbIds = upsertScannedSkills(db, discovered)
  return { discovered, orphanedDbIds }
}
