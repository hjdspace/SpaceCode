/**
 * Skill Manager V2 — Pinia Store
 *
 * Central state management for the Skill Manager V2 module.
 * Reference: AgentBro `src/stores/skillStoreV2.ts`
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import type {
  SkillManagerOverview,
  SkillManagerSettings,
  SkillSummary,
  AgentSummary,
  SkillPackSummary,
  SkillPackDetail,
  UpsertPackInput,
  DeletePackPreview,
  RemovePackFromAgentPreview,
  RemovePackFromAgentResult,
  CopySyncPreview,
  CopySyncResult,
  CopySyncAction,
  CopyTargetDiffPreview,
  DiagnosisIssue,
  UnmanagedItemDto,
  SkillTabId,
  ViewMode,
  SkillDetail,
  DeleteCenterSkillPreview,
  AddCenterSkillInput,
  AddCenterSkillPreview,
  AddCenterSkillDecision,
  AddCenterSkillResult,
  InstallMode,
  DistributionPreview,
  DistributionResult,
  AdoptOption,
  AdoptPreview,
  AdoptBatchItem,
  AdoptBatchResult,
  AgentInventoryScanResult,
} from '@/types/skillManagerV2'

// ── Filters ────────────────────────────────────────────────────────

export interface SkillFilters {
  searchQuery: string
  statusFilter: string | null
  sourceFilter: string | null
}

const DEFAULT_FILTERS: SkillFilters = {
  searchQuery: '',
  statusFilter: null,
  sourceFilter: null,
}

// ── Store ──────────────────────────────────────────────────────────

export const useSkillManagerStore = defineStore('skillManagerV2', () => {
  // ── State ──────────────────────────────────────────────────────

  const activeTab = ref<SkillTabId>('library')
  const viewMode = ref<ViewMode>('cards')
  const overview = ref<SkillManagerOverview | null>(null)
  const settings = ref<SkillManagerSettings | null>(null)
  const filters = ref<SkillFilters>({ ...DEFAULT_FILTERS })
  const loading = ref(false)
  const error = ref<string | null>(null)
  const initialized = ref(false)
  const selectedSkillId = ref<string | null>(null)
  const selectedSkillDetail = ref<SkillDetail | null>(null)
  const selectedPackDetail = ref<SkillPackDetail | null>(null)
  const packDetailLoading = ref(false)
  const detailLoading = ref(false)
  const busyAction = ref<string | null>(null)

  // ── Computed ───────────────────────────────────────────────────

  const skills = computed<SkillSummary[]>(() => overview.value?.skills ?? [])
  const agents = computed<AgentSummary[]>(() => overview.value?.agents ?? [])
  const packs = computed<SkillPackSummary[]>(() => overview.value?.packs ?? [])
  const issues = computed<DiagnosisIssue[]>(() => overview.value?.issues ?? [])
  const unmanaged = computed<UnmanagedItemDto[]>(() => overview.value?.unmanaged ?? [])
  const metrics = computed(() => overview.value?.metrics ?? null)

  /** Filtered skills based on search query, status, and source filters. */
  const filteredSkills = computed<SkillSummary[]>(() => {
    let result = skills.value

    const q = filters.value.searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter((s) => {
        return (
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (s.sourceType ?? '').toLowerCase().includes(q) ||
          s.agentBadges.some((b) => b.agentName.toLowerCase().includes(q))
        )
      })
    }

    if (filters.value.statusFilter) {
      result = result.filter((s) => s.status === filters.value.statusFilter)
    }

    if (filters.value.sourceFilter) {
      result = result.filter((s) => s.sourceType === filters.value.sourceFilter)
    }

    return result
  })

  // ── Actions ────────────────────────────────────────────────────

  /**
   * Initialize the store: bootstrap the backend service, then load overview.
   * Safe to call multiple times — only runs once unless `force` is true.
   */
  async function init(force = false): Promise<void> {
    if (initialized.value && !force) return

    loading.value = true
    error.value = null

    try {
      const sm = api.skillManagerV2
      if (!sm) {
        throw new Error('Skill Manager V2 API not available')
      }

      await sm.bootstrap()
      await sm.init()
      await loadOverview()
      initialized.value = true
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** Load the overview DTO from the backend. */
  async function loadOverview(): Promise<void> {
    const sm = api.skillManagerV2
    if (!sm) return

    try {
      const data = await sm.getOverview()
      overview.value = data
      settings.value = data.settings
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** Refresh: trigger a full scan and reload overview. */
  async function refresh(): Promise<void> {
    const sm = api.skillManagerV2
    if (!sm) return

    loading.value = true
    error.value = null

    try {
      const data = await sm.refresh()
      overview.value = data
      settings.value = data.settings
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** Set the active tab. */
  function setTab(tab: SkillTabId): void {
    activeTab.value = tab
  }

  /** Set the view mode (cards / list). */
  function setViewMode(mode: ViewMode): void {
    viewMode.value = mode
  }

  /** Set the search query filter. */
  function setSearchQuery(query: string): void {
    filters.value.searchQuery = query
  }

  /** Set the status filter. */
  function setStatusFilter(status: string | null): void {
    filters.value.statusFilter = status
  }

  /** Set the source filter. */
  function setSourceFilter(source: string | null): void {
    filters.value.sourceFilter = source
  }

  /** Reset all filters to defaults. */
  function resetFilters(): void {
    filters.value = { ...DEFAULT_FILTERS }
  }

  /** Update settings and reload overview. */
  async function updateSettings(patch: Partial<SkillManagerSettings>): Promise<void> {
    const sm = api.skillManagerV2
    if (!sm) return

    loading.value = true
    error.value = null

    try {
      settings.value = await sm.updateSettings(patch)
      await loadOverview()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  /** Open a path in the system file manager. */
  async function openPath(targetPath: string): Promise<void> {
    const sm = api.skillManagerV2
    if (!sm) return
    await sm.openPath(targetPath)
  }

  // ── Slice 2: Skill detail & delete ──────────────────────────────

  /** Load skill detail for the selected skill. */
  async function loadSkillDetail(skillId: string): Promise<void> {
    const sm = api.skillManagerV2
    if (!sm) return

    selectedSkillId.value = skillId
    detailLoading.value = true
    error.value = null

    try {
      selectedSkillDetail.value = await sm.getSkillDetail(skillId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      selectedSkillDetail.value = null
    } finally {
      detailLoading.value = false
    }
  }

  /** Clear the selected skill. */
  function clearSelectedSkill(): void {
    selectedSkillId.value = null
    selectedSkillDetail.value = null
  }

  /** Preview deleting a center library skill. */
  async function previewDeleteSkill(skillId: string): Promise<DeleteCenterSkillPreview | null> {
    const sm = api.skillManagerV2
    if (!sm) return null
    return await sm.previewDeleteCenterSkill(skillId)
  }

  /** Execute deletion of a center library skill, then refresh. */
  async function executeDeleteSkill(skillId: string): Promise<void> {
    const sm = api.skillManagerV2
    if (!sm) return

    busyAction.value = 'delete-skill'
    error.value = null

    try {
      await sm.executeDeleteCenterSkill(skillId)
      clearSelectedSkill()
      await loadOverview()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busyAction.value = null
    }
  }

  // ── Slice 3: Import to center library ──────────────────────────

  /** Preview adding a skill from an external source to the center library. */
  async function previewAddCenterSkill(input: AddCenterSkillInput): Promise<AddCenterSkillPreview | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    try {
      return await sm.previewAddCenterSkill(input)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  /** Execute adding a skill to the center library, then refresh overview. */
  async function executeAddCenterSkill(
    input: AddCenterSkillInput,
    decisions: AddCenterSkillDecision[]
  ): Promise<AddCenterSkillResult | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    busyAction.value = 'import-skill'
    error.value = null

    try {
      const result = await sm.executeAddCenterSkill(input, decisions)
      await loadOverview()
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      busyAction.value = null
    }
  }

  // ── Slice 4: Distribute to Agent ────────────────────────────────

  /** Preview distributing skills to agents. */
  async function previewDistribute(
    skillIds: string[],
    targetAgentIds: string[],
    requestedMode: InstallMode
  ): Promise<DistributionPreview | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    try {
      return await sm.previewDistribute(skillIds, targetAgentIds, requestedMode)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  /** Execute distribution, then refresh overview. */
  async function executeDistribute(preview: DistributionPreview): Promise<DistributionResult | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    busyAction.value = 'distribute'
    error.value = null

    try {
      const result = await sm.executeDistribute(preview)
      await loadOverview()
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      busyAction.value = null
    }
  }

  /** Delete a single target from an agent, then refresh. */
  async function deleteTarget(targetId: string): Promise<void> {
    const sm = api.skillManagerV2
    if (!sm) return

    busyAction.value = 'delete-target'
    error.value = null

    try {
      await sm.deleteTarget(targetId)
      await loadOverview()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busyAction.value = null
    }
  }

  // ── Slice 5: Agent Scan & Adopt ────────────────────────────────

  /** Scan an agent's skills directory for managed/unmanaged/conflict items. */
  async function scanAgentInventory(agentId: string): Promise<AgentInventoryScanResult | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    busyAction.value = 'scan-agent'
    error.value = null

    try {
      const result = await sm.scanAgentInventory(agentId)
      await loadOverview()
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      busyAction.value = null
    }
  }

  /** Preview adopting an unmanaged skill. */
  async function previewAdopt(agentId: string, unmanagedId: string): Promise<AdoptPreview | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    try {
      return await sm.previewAdopt(agentId, unmanagedId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  /** Execute adopting an unmanaged skill, then refresh. */
  async function executeAdopt(
    agentId: string,
    unmanagedId: string,
    option: AdoptOption,
    renamedId?: string
  ): Promise<void> {
    const sm = api.skillManagerV2
    if (!sm) return

    busyAction.value = 'adopt'
    error.value = null

    try {
      await sm.executeAdopt(agentId, unmanagedId, option, renamedId)
      await loadOverview()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busyAction.value = null
    }
  }

  /** Execute batch adoption of multiple unmanaged skills. */
  async function executeAdoptBatch(items: AdoptBatchItem[]): Promise<AdoptBatchResult | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    busyAction.value = 'adopt-batch'
    error.value = null

    try {
      const result = await sm.executeAdoptBatch(items)
      await loadOverview()
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      busyAction.value = null
    }
  }

  // ── Skill Packs ───────────────────────────────────────────────────

  /** Load pack detail for the selected pack. */
  async function loadPackDetail(packId: string): Promise<void> {
    const sm = api.skillManagerV2
    if (!sm) return

    packDetailLoading.value = true
    error.value = null

    try {
      selectedPackDetail.value = await sm.getPackDetail(packId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      selectedPackDetail.value = null
    } finally {
      packDetailLoading.value = false
    }
  }

  /** Clear the selected pack. */
  function clearSelectedPack(): void {
    selectedPackDetail.value = null
  }

  /** Create or update a skill pack, then refresh overview. */
  async function upsertPack(input: UpsertPackInput): Promise<SkillPackDetail | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    busyAction.value = 'upsert-pack'
    error.value = null

    try {
      const detail = await sm.upsertPack(input)
      await loadOverview()
      return detail
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      busyAction.value = null
    }
  }

  /** Preview deleting a skill pack. */
  async function previewDeletePack(packId: string): Promise<DeletePackPreview | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    try {
      return await sm.previewDeletePack(packId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  /** Delete a skill pack, then refresh overview. */
  async function deletePack(packId: string): Promise<void> {
    const sm = api.skillManagerV2
    if (!sm) return

    busyAction.value = 'delete-pack'
    error.value = null

    try {
      await sm.deletePack(packId)
      clearSelectedPack()
      await loadOverview()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busyAction.value = null
    }
  }

  /** Preview applying a pack to target agents. */
  async function previewApplyPack(
    packId: string,
    targetAgentIds: string[],
    requestedMode: InstallMode
  ): Promise<DistributionPreview | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    try {
      return await sm.previewApplyPack(packId, targetAgentIds, requestedMode)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  /** Execute applying a pack to target agents, then refresh overview. */
  async function executeApplyPack(
    packId: string,
    targetAgentIds: string[],
    requestedMode: InstallMode
  ): Promise<DistributionResult | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    busyAction.value = 'apply-pack'
    error.value = null

    try {
      const result = await sm.executeApplyPack(packId, targetAgentIds, requestedMode)
      await loadOverview()
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      busyAction.value = null
    }
  }

  /** Preview removing a pack from an agent. */
  async function previewRemovePackFromAgent(
    packId: string,
    agentId: string
  ): Promise<RemovePackFromAgentPreview | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    try {
      return await sm.previewRemovePackFromAgent(packId, agentId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  /** Remove a pack from an agent, then refresh overview. */
  async function removePackFromAgent(
    packId: string,
    agentId: string
  ): Promise<RemovePackFromAgentResult | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    busyAction.value = 'remove-pack'
    error.value = null

    try {
      const result = await sm.executeRemovePackFromAgent(packId, agentId)
      await loadOverview()
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      busyAction.value = null
    }
  }

  // ── Copy Sync ─────────────────────────────────────────────────────

  /** Preview copy sync for a target. */
  async function previewSyncCopy(targetId: string): Promise<CopySyncPreview | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    try {
      return await sm.previewSyncCopy(targetId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  /** Execute copy sync for a target, then refresh overview. */
  async function executeSyncCopy(
    targetId: string,
    action: CopySyncAction
  ): Promise<CopySyncResult | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    busyAction.value = 'sync-copy'
    error.value = null

    try {
      const result = await sm.executeSyncCopy(targetId, action)
      await loadOverview()
      return result
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    } finally {
      busyAction.value = null
    }
  }

  /** Preview file-level diff between center library and agent copy. */
  async function previewCopyTargetDiff(targetId: string): Promise<CopyTargetDiffPreview | null> {
    const sm = api.skillManagerV2
    if (!sm) return null

    try {
      return await sm.previewCopyTargetDiff(targetId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      return null
    }
  }

  return {
    // State
    activeTab,
    viewMode,
    overview,
    settings,
    filters,
    loading,
    error,
    initialized,
    selectedSkillId,
    selectedSkillDetail,
    selectedPackDetail,
    packDetailLoading,
    detailLoading,
    busyAction,

    // Computed
    skills,
    agents,
    packs,
    issues,
    unmanaged,
    metrics,
    filteredSkills,

    // Actions
    init,
    loadOverview,
    refresh,
    setTab,
    setViewMode,
    setSearchQuery,
    setStatusFilter,
    setSourceFilter,
    resetFilters,
    updateSettings,
    openPath,
    loadSkillDetail,
    clearSelectedSkill,
    previewDeleteSkill,
    executeDeleteSkill,
    previewAddCenterSkill,
    executeAddCenterSkill,
    previewDistribute,
    executeDistribute,
    deleteTarget,
    scanAgentInventory,
    previewAdopt,
    executeAdopt,
    executeAdoptBatch,

    // Skill Pack actions
    loadPackDetail,
    clearSelectedPack,
    upsertPack,
    previewDeletePack,
    deletePack,
    previewApplyPack,
    executeApplyPack,
    previewRemovePackFromAgent,
    removePackFromAgent,

    // Copy Sync actions
    previewSyncCopy,
    executeSyncCopy,
    previewCopyTargetDiff,
  }
})
