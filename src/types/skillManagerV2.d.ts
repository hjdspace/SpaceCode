/**
 * Skill Manager V2 — Type Definitions
 *
 * All DTOs for the Skill Manager v2 module.
 * Reference: AgentBro `src/services/skillApiV2.ts` interfaces.
 */

// ── Enums / Literal Types ──────────────────────────────────────────

export type SkillTabId = 'library' | 'install' | 'packs' | 'agents' | 'diagnostics' | 'settings'
export type ViewMode = 'cards' | 'list'
export type InstallMode = 'link' | 'copy'
export type ActualMode = 'link' | 'copy'
export type LinkFailPolicy = 'ask' | 'copy'
export type SkillStatus = 'ok' | 'unmanaged' | 'conflict' | 'broken_link' | 'copy_outdated' | 'copy_modified' | 'copy_diverged' | 'missing'
export type SourceType = 'local_folder' | 'archive' | 'github' | 'url' | 'agent_import' | 'agent_override' | 'manual_center' | 'marketplace'
export type ClaimType = 'direct' | 'pack'
export type DiagnosisSeverity = 'info' | 'warning' | 'error'
export type FixKind = 'auto' | 'confirm' | 'manual' | 'info'
export type EntityType = 'skill' | 'target' | 'pack' | 'agent' | 'snapshot'
export type UnmanagedItemType = 'skill_dir' | 'skill_file' | 'config_file'
export type CopySyncStatus = 'ok' | 'copy_outdated' | 'copy_modified' | 'copy_diverged'
export type CopySyncAction = 'center_over_agent' | 'agent_over_center' | 'manual'

// ── Settings ───────────────────────────────────────────────────────

export interface SkillManagerSettings {
  centerLibraryPath: string
  defaultInstallMode: InstallMode
  linkFailPolicy: LinkFailPolicy
  startupScan: boolean
  showUnmanaged: boolean
}

// ── Overview ───────────────────────────────────────────────────────

export interface SkillManagerMetrics {
  centerSkillCount: number
  agentTargetCount: number
  unmanagedCount: number
  diagnosisIssueCount: number
}

export interface SkillManagerOverview {
  metrics: SkillManagerMetrics
  settings: SkillManagerSettings
  skills: SkillSummary[]
  agents: AgentSummary[]
  packs: SkillPackSummary[]
  issues: DiagnosisIssue[]
  unmanaged: UnmanagedItemDto[]
}

// ── Skill ──────────────────────────────────────────────────────────

export interface SkillSummary {
  id: string
  name: string
  description: string
  skillType: string
  centerPath: string
  currentHash: string
  status: SkillStatus
  sourceType: SourceType | null
  agentBadges: AgentBadge[]
  createdAt: string
  updatedAt: string
}

export interface AgentBadge {
  agentId: string
  agentName: string
  mode: ActualMode
  status: SkillStatus
}

export interface SkillSource {
  skillId: string
  sourceType: SourceType
  sourceUri: string | null
  sourceRef: string | null
  importedFromAgent: string | null
  importedFromPath: string | null
  installedVia: string
  createdAt: string
  updatedAt: string
}

export interface SkillTarget {
  id: string
  skillId: string
  agentId: string
  targetPath: string
  installMode: InstallMode
  actualMode: ActualMode
  sourceHash: string
  currentHash: string | null
  status: SkillStatus
  createdAt: string
  updatedAt: string
}

export interface SkillTargetClaim {
  id: string
  targetId: string
  claimType: ClaimType
  packId: string | null
  createdAt: string
}

export interface FileTreeNode {
  name: string
  nodeType: 'dir' | 'file'
  path: string
  children: FileTreeNode[] | null
}

export interface SkillDetail {
  id: string
  name: string
  description: string
  skillType: string
  centerPath: string
  currentHash: string
  frontmatterJson: string
  source: SkillSource | null
  targets: SkillTarget[]
  claims: SkillTargetClaim[]
  files: FileTreeNode | null
  createdAt: string
  updatedAt: string
  lastScannedAt: string | null
}

// ── Agent ──────────────────────────────────────────────────────────

export interface AgentSummary {
  id: string
  displayName: string
  skillsDir: string | null
  configPath: string | null
  mcpConfigPath: string | null
  pluginDir: string | null
  version: string | null
  latestVersion: string | null
  enabled: boolean
  /** Whether the agent has a local installation/configuration detected. */
  installed: boolean
  lastScannedAt: string | null
  managedSkillCount: number
  unmanagedCount: number
}

export interface AgentDetail {
  id: string
  displayName: string
  skillsDir: string | null
  configPath: string | null
  pluginDir: string | null
  version: string | null
  lastScannedAt: string | null
  skills: SkillTarget[]
  unmanaged: UnmanagedItemDto[]
  appliedPacks: SkillPackSummary[]
  healthIssues: DiagnosisIssue[]
  mcpServers: McpServerStatus[]
  plugins: PluginStatus[]
}

export interface McpServerStatus {
  name: string
  command: string
  args: string[]
  valid: boolean
  message: string
}

export interface PluginStatus {
  id: string
  name: string
  version: string | null
  enabled: boolean
  source: string | null
}

// ── Skill Pack ─────────────────────────────────────────────────────

export interface SkillPackSummary {
  id: string
  name: string
  description: string
  tags: string[]
  memberCount: number
  appliedAgentCount: number
  createdAt: string
  updatedAt: string
}

export interface SkillPackMember {
  packId: string
  skillId: string
  skillName: string
  sortOrder: number
  required: boolean
  missing: boolean
}

export interface SkillPackDetail {
  id: string
  name: string
  description: string
  tags: string[]
  members: SkillPackMember[]
  appliedAgents: AgentSummary[]
  createdAt: string
  updatedAt: string
}

// ── Unmanaged ──────────────────────────────────────────────────────

export interface UnmanagedItemDto {
  id: string
  itemType: UnmanagedItemType
  agentId: string | null
  path: string
  inferredSkillId: string | null
  hash: string | null
  reason: string
  firstSeenAt: string
  lastSeenAt: string
}

// ── Diagnosis ──────────────────────────────────────────────────────

export interface DiagnosisIssue {
  id: string
  issueType: string
  severity: DiagnosisSeverity
  entityType: EntityType
  entityId: string | null
  title: string
  detail: string
  fixKind: FixKind
  payloadJson: string
  createdAt: string
  resolvedAt: string | null
}

// ── Distribution ──────────────────────────────────────────────────

export interface DistributionChange {
  skillId: string
  skillName: string
  agentId: string
  agentName: string
  action: 'create' | 'reuse' | 'blocked'
  mode: InstallMode
  reason: string | null
}

export interface DistributionBlocker {
  skillId: string
  skillName: string
  agentId: string
  agentName: string
  reason: string
}

export interface DistributionPreview {
  changes: DistributionChange[]
  blockers: DistributionBlocker[]
}

export interface DistributionResult {
  success: boolean
  created: number
  reused: number
  failed: number
  errors: string[]
}

// ── Delete Preview ─────────────────────────────────────────────────

export interface DeleteCenterSkillPreview {
  skillId: string
  skillName: string
  affectedTargets: SkillTarget[]
}

// ── Adopt ──────────────────────────────────────────────────────────

export type AdoptOption =
  | 'import_to_center'
  | 'replace_with_link'
  | 'replace_with_copy'
  | 'import_keep'
  | 'import_link'
  | 'import_copy'
  | 'import_cleanup'
  | 'center_over_agent'
  | 'overwrite_center'
  | 'rename'
  | 'skip'

export interface AdoptPreview {
  agentId: string
  unmanagedId: string
  inferredSkillId: string
  centerHasSameName: boolean
  centerSkillId: string | null
  options: AdoptOption[]
  conflictReason: string | null
}

// ── Copy Sync ──────────────────────────────────────────────────────

export interface CopySyncPreview {
  targetId: string
  skillId: string
  targetPath: string
  sourceHash: string
  centerHash: string
  agentHash: string | null
  status: CopySyncStatus
  suggested: CopySyncAction | 'none'
}

export interface CopySyncResult {
  success: boolean
  action: CopySyncAction
  message: string
  preview: CopySyncPreview | null
}

export interface CopyTargetDiffFile {
  path: string
  changeType: 'modified' | 'copy_removed' | 'copy_added'
  centerContent: string | null
  copyContent: string | null
}

export interface CopyTargetDiffPreview {
  targetId: string
  skillId: string
  targetPath: string
  centerPath: string
  status: CopySyncStatus
  files: CopyTargetDiffFile[]
}

// ── Add Center Skill ───────────────────────────────────────────────

export interface AddCenterSkillInput {
  sourcePath: string
  sourceType: SourceType
  sourceUri?: string
  sourceRef?: string
  renamedId?: string
  importedFromAgent?: string
  importedFromPath?: string
  /** When true, treat sourcePath as a parent directory containing multiple skill subdirectories. */
  multi?: boolean
  /** "copy" (default) or "link" — how the skill is imported into the center library. */
  importMode?: 'copy' | 'link'
}

export interface AddCenterSkillCandidate {
  skillId: string
  proposedSkillId: string
  name: string
  description: string
  sourceDir: string
  hash: string
  action: 'create' | 'update' | 'blocked'
  existingSourceType: SourceType | null
  reason: string | null
}

export interface AddCenterSkillPreview {
  candidates: AddCenterSkillCandidate[]
  blockers: AddCenterSkillCandidate[]
  unchangedCount: number
  centerPath: string
}

export interface AddCenterSkillDecision {
  skillId: string
  proposedSkillId?: string
  /** "create" (rename), "update" (overwrite), or "skip" */
  resolution: 'create' | 'update' | 'skip'
}

export interface AddCenterSkillResult {
  /** IDs of newly created skills. */
  skillIds: string[]
  /** IDs of updated skills. */
  updated: string[]
  /** IDs of skipped skills. */
  skipped: string[]
}

// ── Upsert Pack ────────────────────────────────────────────────────

export interface UpsertPackInput {
  id?: string
  name: string
  description?: string
  tags?: string[]
  memberSkillIds: string[]
}

// ── Adopt Batch ─────────────────────────────────────────────────────

export interface AdoptBatchItem {
  agentId: string
  unmanagedId: string
  option: AdoptOption
  renamedId?: string
}

export interface AdoptResult {
  unmanagedId: string
  success: boolean
  skillId: string | null
  error: string | null
}

export interface AdoptBatchResult {
  results: AdoptResult[]
  successCount: number
  failureCount: number
}

// ── Agent Inventory ─────────────────────────────────────────────────

export interface AgentInventoryScanResult {
  agentId: string
  managed: SkillTarget[]
  unmanaged: UnmanagedItemDto[]
  conflicts: UnmanagedItemDto[]
}

// ── Pack Remove Preview ────────────────────────────────────────────

export interface PackAffectedTarget {
  targetId: string
  agentId: string
  targetPath: string
  mode: string
  claimCount: number
}

export interface RemovePackFromAgentPreview {
  packId: string
  packName: string
  agentId: string
  agentName: string
  affectedTargets: PackAffectedTarget[]
  willRemoveTargets: number
  willPreserveTargets: number
}

export interface RemovePackFromAgentResult {
  packId: string
  agentId: string
  removedClaims: number
  removedTargets: number
  preservedTargets: number
}

export interface DeletePackPreview {
  packId: string
  packName: string
  appliedAgents: string[]
  affectedTargets: PackAffectedTarget[]
  removable: boolean
  warnings: string[]
}

// ── IPC Channel Names ──────────────────────────────────────────────
// Channel name constants are defined in electron/skillManagerV2/channels.ts
// (runtime values cannot live in .d.ts files)
