/**
 * TargetClassifier — Pure-Function Module for Target Classification
 *
 * Single source of truth for skill inventory classification semantics.
 * Previously, the same classification logic (managed / unmanaged /
 * unmanaged_reusable / conflict / builtin_read_only) was duplicated:
 *   - Main process: service.ts `listAgentSkillInventory` (L1642-1648)
 *   - Renderer:    AgentSyncPanel.vue `statusTone` / `statusTagClass`
 *                   / `canBatchAdopt` / `canOpenAdopt` (L88-106)
 *
 * This module is the seam: both sides import the same pure functions.
 *
 * Design rationale (see codebase-design SKILL):
 * - Pure functions → no hidden state, trivially testable (table-driven).
 * - One classification function → classification bug fixed once, fixed
 *   everywhere (e.g. fc36204c4-type bugs no longer require cross-seam dual fix).
 * - Renderer consumes `canImport` / `status` from the same logic, not a
 *   re-implementation.
 */

import type { AgentSkillInventoryItem } from '@/types/skillManagerV2'

// ── Classification input & output ───────────────────────────────────

/** Input for classifying an unmanaged skill item. */
export interface ClassifyInput {
  /** Whether the item is managed (has a skill_targets row). */
  managed: boolean
  /** Whether the item is in a read-only agent directory. */
  readOnly: boolean
  /** The center library hash for this skill ID, or null if not in center. */
  centerHash: string | null
  /** The item's own hash, or null. */
  itemHash: string | null
}

/** The full classification result — all derived fields in one struct. */
export interface Classification {
  /** The status string: ok | unmanaged | unmanaged_reusable | conflict | builtin_read_only. */
  status: string
  /** Whether the item can be imported (adopted) into the center library. */
  canImport: boolean
  /** Whether the item is managed. */
  managed: boolean
  /** Whether the item is read-only. */
  readOnly: boolean
}

// ── Tone & tag classification ────────────────────────────────────────

/** Visual tone for rendering — derived from status + managed. */
export type InventoryTone = 'ok' | 'unmanaged' | 'conflict' | 'reusable' | 'readonly'

/** CSS tag class for rendering — derived from status + managed. */
export type InventoryTagClass =
  | 'tag-ok'
  | 'tag-unmanaged'
  | 'tag-conflict'
  | 'tag-reusable'
  | 'tag-readonly'

/** Whether the user can open the adopt dialog for this item. */
export type InventoryAction =
  | 'adopt'      // can adopt this item
  | 'conflict'   // has a conflict, needs resolution
  | 'none'       // no action available

// ── Pure classification functions ────────────────────────────────────

/**
 * Classify a single inventory item.
 *
 * This is the canonical classification logic — the single source of truth.
 * Both the main process (when building inventory DTOs) and the renderer
 * (when rendering tags / deciding actions) must use this function.
 *
 * Semantics:
 * - managed → status from DB (ok / missing / broken_link / copy_*)
 * - readOnly → 'builtin_read_only', canImport = false
 * - not in center → 'unmanaged', canImport = true
 * - in center, hash matches → 'unmanaged_reusable', canImport = true
 * - in center, hash differs → 'conflict', canImport = false
 */
export function classifyTarget(input: ClassifyInput): Classification {
  // Managed items keep their DB status; they are never importable.
  if (input.managed) {
    return {
      status: 'ok', // The actual status is assigned by the DB row; 'ok' is the default.
      canImport: false,
      managed: true,
      readOnly: false,
    }
  }

  // Read-only items (e.g. built-in agent skills that can't be modified).
  if (input.readOnly) {
    return {
      status: 'builtin_read_only',
      canImport: false,
      managed: false,
      readOnly: true,
    }
  }

  // Not in center library → unmanaged, importable.
  if (input.centerHash === null) {
    return {
      status: 'unmanaged',
      canImport: true,
      managed: false,
      readOnly: false,
    }
  }

  // In center library — check if hash matches.
  const hashMatches =
    input.itemHash !== null && input.centerHash === input.itemHash

  if (hashMatches) {
    return {
      status: 'unmanaged_reusable',
      canImport: true,
      managed: false,
      readOnly: false,
    }
  }

  // Hash mismatch → conflict.
  return {
    status: 'conflict',
    canImport: false,
    managed: false,
    readOnly: false,
  }
}

/**
 * Derive the visual tone for an inventory item.
 * Used by the renderer to pick CSS classes.
 */
export function classifyTone(item: AgentSkillInventoryItem): InventoryTone {
  if (item.status === 'conflict') return 'conflict'
  if (item.status === 'unmanaged_reusable') return 'reusable'
  if (item.status === 'builtin_read_only') return 'readonly'
  return item.managed ? 'ok' : 'unmanaged'
}

/**
 * Derive the CSS tag class for an inventory item.
 * Used by the renderer for status badges.
 */
export function classifyTagClass(item: AgentSkillInventoryItem): InventoryTagClass {
  if (item.status === 'conflict') return 'tag-conflict'
  if (item.status === 'unmanaged_reusable') return 'tag-reusable'
  if (item.status === 'builtin_read_only') return 'tag-readonly'
  return item.managed ? 'tag-ok' : 'tag-unmanaged'
}

/**
 * Whether the user can open the adopt dialog for this item.
 * Unmanaged items that are importable or in conflict can be adopted.
 */
export function canOpenAdopt(item: AgentSkillInventoryItem): boolean {
  return !item.managed && (item.canImport || item.status === 'conflict')
}

/**
 * Whether the item is eligible for batch adopt (import).
 * Only importable, non-conflict items qualify.
 */
export function canBatchAdopt(item: AgentSkillInventoryItem): boolean {
  return item.canImport && item.status !== 'conflict'
}

/**
 * Count conflicts in an agent's inventory.
 */
export function countConflicts(items: AgentSkillInventoryItem[]): number {
  return items.filter((item) => !item.managed && item.status === 'conflict').length
}
