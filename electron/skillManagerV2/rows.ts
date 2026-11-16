/**
 * SQLite row shapes for Skill Manager V2.
 *
 * These mirror the column lists in db.ts, not the public DTOs in
 * @/types/skillManagerV2 — the service maps between the two.
 */

export interface AgentRow {
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

// Every column the detail query selects is already on AgentRow.
export type AgentDetailRow = AgentRow

export interface SkillRow {
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

export interface TargetBadgeRow {
  agent_id: string
  actual_mode: string
  status: string
  display_name: string
}

export interface PackRow {
  id: string
  name: string
  description: string
  tags_json: string
  created_at: string
  updated_at: string
  member_count: number
  applied_agent_count: number
}

export interface UnmanagedRow {
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

export interface IssueRow {
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

export interface SkillDetailRow {
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

export interface SourceRow {
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

export interface TargetRow {
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

export interface ClaimRow {
  id: string
  target_id: string
  claim_type: string
  pack_id: string | null
  created_at: string
}

export interface PackDetailRow {
  id: string
  name: string
  description: string
  tags_json: string
  created_at: string
  updated_at: string
}

export interface PackMemberRow {
  pack_id: string
  skill_id: string
  sort_order: number
  required: number
  skill_name: string | null
}

export interface TargetSyncRow {
  id: string
  skill_id: string
  target_path: string
  source_hash: string
  current_hash: string | null
  actual_mode: string
}