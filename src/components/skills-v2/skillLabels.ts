/**
 * Skill Manager V2 — Label Mappings
 *
 * Maps source types and status values to i18n keys and CSS classes.
 * Reference: AgentBro `src/components/skills-v2/skillLabels.ts`
 */

import type { SkillStatus, SourceType } from '@/types/skillManagerV2'

// ── Status labels ──────────────────────────────────────────────────

export const STATUS_LABEL_KEYS: Record<SkillStatus, string> = {
  ok: 'skillManagerV2.status.ok',
  unmanaged: 'skillManagerV2.status.unmanaged',
  conflict: 'skillManagerV2.status.conflict',
  broken_link: 'skillManagerV2.status.brokenLink',
  copy_outdated: 'skillManagerV2.status.copyOutdated',
  copy_modified: 'skillManagerV2.status.copyModified',
  copy_diverged: 'skillManagerV2.status.copyDiverged',
  missing: 'skillManagerV2.status.missing',
}

export const STATUS_CSS_CLASSES: Record<SkillStatus, string> = {
  ok: 'status-ok',
  unmanaged: 'status-unmanaged',
  conflict: 'status-conflict',
  broken_link: 'status-broken-link',
  copy_outdated: 'status-copy-outdated',
  copy_modified: 'status-copy-modified',
  copy_diverged: 'status-copy-diverged',
  missing: 'status-missing',
}

// ── Source type labels ─────────────────────────────────────────────

export const SOURCE_LABEL_KEYS: Record<SourceType, string> = {
  local_folder: 'skillManagerV2.source.localFolder',
  archive: 'skillManagerV2.source.archive',
  github: 'skillManagerV2.source.github',
  url: 'skillManagerV2.source.url',
  agent_import: 'skillManagerV2.source.agentImport',
  agent_override: 'skillManagerV2.source.agentOverride',
  manual_center: 'skillManagerV2.source.manualCenter',
  marketplace: 'skillManagerV2.source.marketplace',
}

// ── Agent icon initials ────────────────────────────────────────────

export const AGENT_INITIALS: Record<string, string> = {
  'claude-code': 'CC',
  'codex': 'CX',
  'cursor': 'CR',
  'trae': 'TR',
}

export function getAgentInitials(agentId: string): string {
  return AGENT_INITIALS[agentId] ?? agentId.slice(0, 2).toUpperCase()
}

// ── Skill glyph ────────────────────────────────────────────────────

/** Derive a two-letter glyph from a skill name (word initials, else first two chars). */
export function getSkillGlyph(name: string): string {
  const parts = name.replace(/[-_]/g, ' ').split(/\s+/)
  return parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

/** Final path segment, handling both / and \ separators. */
export function pathBasename(p: string): string {
  return p.split(/[\\/]+/).filter(Boolean).pop() ?? ''
}

// ── Unmanaged reason labels ────────────────────────────────────────

const UNMANAGED_REASON_KEYS: Record<string, string> = {
  not_in_center_library: 'skillManagerV2.agent.reasonNotInCenter',
  same_name_as_center_skill: 'skillManagerV2.agent.reasonNameConflict',
  shared_agents_directory: 'skillManagerV2.agent.reasonSharedDir',
  agent_builtin_read_only: 'skillManagerV2.agent.reasonReadOnly',
}

/** Map a backend unmanaged-item reason code to an i18n key, or null to show the raw text. */
export function unmanagedReasonKey(reason: string): string | null {
  return UNMANAGED_REASON_KEYS[reason] ?? null
}

// ── Agent sync inventory status labels ────────────────────────────

/** Resolution modes for the batch-conflict dialog. Reference: AgentBro `BatchConflictMode`. */
export type BatchConflictMode = 'center_over_agent' | 'rename' | 'overwrite_center' | 'skip'

/** Install modes for the one-click organize dialog. Reference: AgentBro `OneClickOrganizeMode`. */
export type OneClickOrganizeMode = 'import_link' | 'import_copy' | 'import_keep'

export const INVENTORY_STATUS_LABEL_KEYS: Record<string, string> = {
  unmanaged: 'skillManagerV2.agentSync.statusUnmanaged',
  unmanaged_reusable: 'skillManagerV2.agentSync.statusReusable',
  conflict: 'skillManagerV2.agentSync.statusConflict',
  builtin_read_only: 'skillManagerV2.agentSync.statusReadOnly',
  ok: 'skillManagerV2.status.ok',
  missing: 'skillManagerV2.status.missing',
  broken_link: 'skillManagerV2.status.brokenLink',
  copy_outdated: 'skillManagerV2.status.copyOutdated',
  copy_modified: 'skillManagerV2.status.copyModified',
  copy_diverged: 'skillManagerV2.status.copyDiverged',
}

/** i18n key for an inventory item's status label (managed items show a fixed label). */
export function inventoryStatusKey(managed: boolean, status: string): string | null {
  if (managed) return 'skillManagerV2.agentSync.statusManaged'
  return INVENTORY_STATUS_LABEL_KEYS[status] ?? null
}

// ── Status filter options ──────────────────────────────────────────

export const STATUS_FILTER_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: 'ok', labelKey: 'skillManagerV2.status.ok' },
  { value: 'conflict', labelKey: 'skillManagerV2.status.conflict' },
  { value: 'copy_outdated', labelKey: 'skillManagerV2.status.copyOutdated' },
  { value: 'copy_modified', labelKey: 'skillManagerV2.status.copyModified' },
  { value: 'copy_diverged', labelKey: 'skillManagerV2.status.copyDiverged' },
  { value: 'unmanaged', labelKey: 'skillManagerV2.status.unmanaged' },
  { value: 'missing', labelKey: 'skillManagerV2.status.missing' },
]

// ── Source filter options ──────────────────────────────────────────

export const SOURCE_FILTER_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: 'local_folder', labelKey: 'skillManagerV2.source.localFolder' },
  { value: 'archive', labelKey: 'skillManagerV2.source.archive' },
  { value: 'github', labelKey: 'skillManagerV2.source.github' },
  { value: 'agent_import', labelKey: 'skillManagerV2.source.agentImport' },
  { value: 'manual_center', labelKey: 'skillManagerV2.source.manualCenter' },
  { value: 'marketplace', labelKey: 'skillManagerV2.source.marketplace' },
]
