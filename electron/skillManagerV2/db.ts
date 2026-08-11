/**
 * Skill Manager V2 — SQLite Database Layer
 *
 * Schema v4, migrations, and typed row access via better-sqlite3.
 *
 * Reference: AgentBro `src-tauri/src/skills/v2/db.rs`
 */

import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { nowIso } from './fsutil'

// ── Schema version ─────────────────────────────────────────────────

export const SCHEMA_VERSION = 4

// ── Migration SQL ──────────────────────────────────────────────────

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  skill_type TEXT NOT NULL DEFAULT 'skill',
  center_path TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  frontmatter_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_scanned_at TEXT
);

CREATE TABLE IF NOT EXISTS skill_sources (
  skill_id TEXT PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_uri TEXT,
  source_ref TEXT,
  imported_from_agent TEXT,
  imported_from_path TEXT,
  installed_via TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  skills_dir TEXT,
  config_path TEXT,
  mcp_config_path TEXT,
  plugin_dir TEXT,
  version TEXT,
  latest_version TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_scanned_at TEXT
);

CREATE TABLE IF NOT EXISTS skill_targets (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_path TEXT NOT NULL,
  install_mode TEXT NOT NULL,
  actual_mode TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  current_hash TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(skill_id, agent_id, target_path)
);

CREATE TABLE IF NOT EXISTS skill_target_claims (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES skill_targets(id) ON DELETE CASCADE,
  claim_type TEXT NOT NULL,
  pack_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(target_id, claim_type, pack_id)
);

CREATE TABLE IF NOT EXISTS skill_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_pack_members (
  pack_id TEXT NOT NULL REFERENCES skill_packs(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(pack_id, skill_id)
);

CREATE TABLE IF NOT EXISTS unmanaged_items (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL,
  agent_id TEXT,
  path TEXT NOT NULL,
  inferred_skill_id TEXT,
  hash TEXT,
  reason TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS diagnosis_issues (
  id TEXT PRIMARY KEY,
  issue_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  fix_kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_skill_targets_agent ON skill_targets(agent_id);
CREATE INDEX IF NOT EXISTS idx_claims_pack ON skill_target_claims(pack_id);
CREATE INDEX IF NOT EXISTS idx_issues_type ON diagnosis_issues(issue_type, resolved_at);
`

// ── Db wrapper ─────────────────────────────────────────────────────

export class Db {
  readonly conn: DatabaseType

  private constructor(dbPath: string) {
    // Ensure parent dir exists
    const parent = path.dirname(dbPath)
    fs.mkdirSync(parent, { recursive: true })

    this.conn = new Database(dbPath)
    this.conn.pragma('journal_mode = WAL')
    this.conn.pragma('foreign_keys = ON')

    // Run migrations
    this.conn.exec(MIGRATION_V1)

    // Record schema version (idempotent)
    const now = nowIso()
    this.conn
      .prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION, now)
  }

  /** Open (or create) a database at the given path. */
  static open(dbPath: string): Db {
    return new Db(dbPath)
  }

  /** Close the database connection. */
  close(): void {
    this.conn.close()
  }

  /** Get the highest applied migration version. */
  appliedVersion(): number {
    const row = this.conn
      .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
      .get() as { v: number }
    return row.v
  }

  /** List all table names in the database. */
  listTables(): string[] {
    const rows = this.conn
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>
    return rows.map((r) => r.name)
  }

  // ── Settings ────────────────────────────────────────────────────

  loadSettingsJson(): Record<string, unknown> {
    const row = this.conn
      .prepare("SELECT value FROM settings WHERE key = 'settings'")
      .get() as { value: string } | undefined
    if (!row) return {}
    try {
      return JSON.parse(row.value) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  saveSettingsJson(value: Record<string, unknown>): void {
    const s = JSON.stringify(value)
    this.conn
      .prepare(
        `INSERT INTO settings(key, value) VALUES('settings', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(s)
  }

  // ── Transaction helper ──────────────────────────────────────────

  transaction<T>(fn: (tx: DatabaseType) => T): T {
    const wrapped = this.conn.transaction(() => fn(this.conn))
    return wrapped()
  }
}
