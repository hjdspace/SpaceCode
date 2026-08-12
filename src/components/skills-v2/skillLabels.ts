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
