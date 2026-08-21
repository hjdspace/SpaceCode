<script setup lang="ts">
/**
 * Skill Manager V2 — Agent Sync Panel
 *
 * Full replica of AgentBro's `AgentSyncPanel` (InstallView.tsx):
 * summary bar → agent strip → shared .agents row → pending inbox with
 * search / agent filter / list-card toggle / batch actions, plus the
 * one-click organize and batch-conflict flows.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Check, Plus, RefreshCw, Search, X } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type {
  AgentSkillInventoryAgent,
  AgentSkillInventoryItem,
  AdoptOption,
} from '@/types/skillManagerV2'
import AdoptDialog from './AdoptDialog.vue'
import AgentIconBadge from './AgentIconBadge.vue'
import BatchConflictDialog from './BatchConflictDialog.vue'
import OneClickOrganizeDialog from './OneClickOrganizeDialog.vue'
import { inventoryStatusKey, type BatchConflictMode, type OneClickOrganizeMode } from './skillLabels'

const { t } = useI18n()
const store = useSkillManagerStore()

/** Localized status label for an inventory item (search also matches this text). */
function inventoryStatusLabel(item: AgentSkillInventoryItem): string {
  const key = inventoryStatusKey(item.managed, item.status)
  return key ? t(key) : item.status
}

// ── Types ─────────────────────────────────────────────────────────

interface AgentSyncRow {
  agent: AgentSkillInventoryAgent
  item: AgentSkillInventoryItem
}

type AgentSyncViewMode = 'list' | 'cards'

interface AgentSyncImportProgress {
  current: number
  total: number
  currentName: string
}

const SHARED_SKILLS_AGENT_ID = 'agents'
const NOTICE_DISMISS_MS = 3200

const STATUS_TABS = [
  { id: 'all', labelKey: 'skillManagerV2.agentSync.tabAll' },
  { id: 'importable', labelKey: 'skillManagerV2.agentSync.tabImportable' },
  { id: 'unmanaged', labelKey: 'skillManagerV2.agentSync.tabUnmanaged' },
  { id: 'conflict', labelKey: 'skillManagerV2.agentSync.tabConflict' },
  { id: 'managed', labelKey: 'skillManagerV2.agentSync.tabManaged' },
] as const

// ── State ─────────────────────────────────────────────────────────

const agents = ref<AgentSkillInventoryAgent[]>([])
const sharedAgent = ref<AgentSkillInventoryAgent | null>(null)
const selectedAgent = ref('all')
const statusFilter = ref('all')
const query = ref('')
const viewMode = ref<AgentSyncViewMode>('cards')
const showManaged = ref(false)
const advancedOpen = ref(false)
const selectedIds = ref(new Set<string>())
const loading = ref(true)
const scanning = ref(false)
const importing = ref(false)
const importProgress = ref<AgentSyncImportProgress | null>(null)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const adoptRow = ref<AgentSyncRow | null>(null)
const adoptOpeningKey = ref<string | null>(null)
const oneClickOpen = ref(false)
const batchConflictOpen = ref(false)
const cleaningShared = ref(false)

let noticeTimer: number | null = null

// ── Item predicates (AgentBro helpers) ────────────────────────────

function statusTone(item: AgentSkillInventoryItem): 'ok' | 'unmanaged' | 'conflict' {
  if (item.status === 'conflict') return 'conflict'
  return item.managed ? 'ok' : 'unmanaged'
}

function statusTagClass(item: AgentSkillInventoryItem): string {
  if (item.status === 'conflict') return 'tag-conflict'
  if (item.status === 'unmanaged_reusable') return 'tag-reusable'
  if (item.status === 'builtin_read_only') return 'tag-readonly'
  return item.managed ? 'tag-ok' : 'tag-unmanaged'
}

function canOpenAdopt(item: AgentSkillInventoryItem): boolean {
  return !item.managed && (item.canImport || item.status === 'conflict')
}

function canBatchAdopt(item: AgentSkillInventoryItem): boolean {
  return item.canImport && item.status !== 'conflict'
}

function agentConflictCount(agent: AgentSkillInventoryAgent): number {
  return agent.items.filter((item) => !item.managed && item.status === 'conflict').length
}

function localSkillCount(agent: AgentSkillInventoryAgent): number {
  return agent.managedCount + agent.unmanagedCount + agent.readOnlyCount
}

function isSharedAgentsSkillsPath(p: string): boolean {
  const parts = p.split(/[\\/]+/)
  return parts.some((part, index) => part === '.agents' && parts[index + 1] === 'skills')
}

function shouldCleanupOnBatchAdopt(item: AgentSkillInventoryItem): boolean {
  return item.agentId === 'agents' || isSharedAgentsSkillsPath(item.path)
}

function defaultBatchAdoptMode(item: AgentSkillInventoryItem): AdoptOption {
  return shouldCleanupOnBatchAdopt(item) ? 'import_cleanup' : 'import_keep'
}

function oneClickAdoptMode(item: AgentSkillInventoryItem, mode: OneClickOrganizeMode): AdoptOption {
  return shouldCleanupOnBatchAdopt(item) ? 'import_cleanup' : mode
}

function importKey(item: AgentSkillInventoryItem): string {
  return `${item.agentId}:${item.id}`
}

function batchConflictRenameId(item: AgentSkillInventoryItem): string {
  const raw = `${item.skillId || item.name || item.id}-${item.agentId || 'agent'}`
  const normalized = raw
    .trim()
    .replace(/[\s./\\]+/g, '-')
    .replace(/[^A-Za-z0-9_-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || `${item.id}-import`
}

function agentAttentionLabel(agent: AgentSkillInventoryAgent): string {
  const conflicts = agentConflictCount(agent)
  if (agent.importableCount > 0 && conflicts > 0) {
    return t('skillManagerV2.agentSync.attentionBoth', { importable: agent.importableCount, conflicts })
  }
  if (agent.importableCount > 0) return t('skillManagerV2.agentSync.importableOnly', { count: agent.importableCount })
  if (conflicts > 0) return t('skillManagerV2.agentSync.conflictsOnly', { count: conflicts })
  return t('skillManagerV2.agentSync.healthy')
}

function agentAttentionTone(agent: AgentSkillInventoryAgent): 'conflict' | 'attention' | 'ok' {
  if (agentConflictCount(agent) > 0) return 'conflict'
  if (agent.importableCount > 0 || agent.unmanagedCount > 0) return 'attention'
  return 'ok'
}

function agentBadge(agentId: string, agentName: string): { agentId: string; agentName: string; mode: 'link'; status: 'ok' } {
  return { agentId, agentName, mode: 'link', status: 'ok' }
}

// ── Data loading ──────────────────────────────────────────────────

function applyInventory(inventory: AgentSkillInventoryAgent[]): void {
  const installed = inventory
    .filter((agent) => agent.installed && agent.agentId !== SHARED_SKILLS_AGENT_ID)
    .sort((a, b) => {
      const skillCountDiff = localSkillCount(b) - localSkillCount(a)
      if (skillCountDiff !== 0) return skillCountDiff
      const importableDiff = b.importableCount - a.importableCount
      if (importableDiff !== 0) return importableDiff
      return a.displayName.localeCompare(b.displayName)
    })
  agents.value = installed
  sharedAgent.value =
    inventory.find((agent) => agent.installed && agent.agentId === SHARED_SKILLS_AGENT_ID) ?? null

  if (selectedAgent.value !== 'all' && !installed.some((agent) => agent.agentId === selectedAgent.value)) {
    selectedAgent.value = 'all'
  }

  const sources = sharedAgent.value ? [...installed, sharedAgent.value] : installed
  const valid = new Set(sources.flatMap((agent) => agent.items.filter(canBatchAdopt).map((item) => importKey(item))))
  selectedIds.value = new Set(Array.from(selectedIds.value).filter((key) => valid.has(key)))
}

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const inventory = (await store.loadAgentInventory()) ?? []
    applyInventory(inventory)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

// Re-apply when the background startup scan lands so the panel stays fresh.
watch(
  () => store.agentInventory,
  (inventory) => {
    if (inventory && !loading.value && !scanning.value && !importing.value) {
      applyInventory(inventory)
    }
  },
)

watch(notice, (value) => {
  if (noticeTimer !== null) window.clearTimeout(noticeTimer)
  if (value) {
    noticeTimer = window.setTimeout(() => {
      notice.value = null
    }, NOTICE_DISMISS_MS)
  }
})

onBeforeUnmount(() => {
  if (noticeTimer !== null) window.clearTimeout(noticeTimer)
})

// ── Scan ──────────────────────────────────────────────────────────

async function scan(): Promise<void> {
  scanning.value = true
  error.value = null
  notice.value = null
  try {
    await store.refresh()
    await load()
    notice.value = t('skillManagerV2.agentSync.noticeScanned')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    scanning.value = false
  }
}

// ── Row pipeline ──────────────────────────────────────────────────

const sortedAgents = computed(() =>
  agents.value
    .map((agent, index) => ({ agent, index }))
    .sort((a, b) => {
      const conflictDiff = agentConflictCount(b.agent) - agentConflictCount(a.agent)
      if (conflictDiff !== 0) return conflictDiff
      return a.index - b.index
    })
    .map(({ agent }) => agent),
)

const visibleAgents = computed(() =>
  selectedAgent.value === 'all'
    ? sortedAgents.value
    : sortedAgents.value.filter((agent) => agent.agentId === selectedAgent.value),
)

const visibleSources = computed(() =>
  selectedAgent.value === 'all' && sharedAgent.value
    ? [...visibleAgents.value, sharedAgent.value]
    : visibleAgents.value,
)

interface IndexedRow {
  row: AgentSyncRow
  index: number
}

const allRows = computed<AgentSyncRow[]>(() =>
  visibleSources.value.flatMap((agent) => agent.items.map((item) => ({ agent, item }))),
)

const pendingRows = computed<AgentSyncRow[]>(() =>
  allRows.value.filter(({ item }) => (!item.managed && !item.readOnly) || item.status === 'conflict'),
)

const rows = computed<AgentSyncRow[]>(() => {
  const base = showManaged.value ? allRows.value : pendingRows.value
  const q = query.value.trim().toLowerCase()
  return base
    .filter(({ item }) => {
      if (statusFilter.value === 'managed' && !item.managed) return false
      if (statusFilter.value === 'importable' && !canBatchAdopt(item)) return false
      if (statusFilter.value === 'unmanaged' && item.managed) return false
      if (statusFilter.value === 'conflict' && item.status !== 'conflict') return false
      return true
    })
    .filter(({ item }) => {
      if (!q) return true
      return [item.name, item.skillId, item.path, inventoryStatusLabel(item), item.reason ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
    .map((row, index): IndexedRow => ({ row, index }))
    .sort((a, b) => {
      const conflictDiff =
        Number(b.row.item.status === 'conflict') - Number(a.row.item.status === 'conflict')
      if (conflictDiff !== 0) return conflictDiff
      return a.index - b.index
    })
    .map(({ row }) => row)
})

watch(
  () => showManaged.value,
  (value) => {
    if (!value && statusFilter.value === 'managed') statusFilter.value = 'all'
  },
)

const importableRows = computed(() => rows.value.filter(({ item }) => canBatchAdopt(item)))
const visibleConflictRows = computed(
  () => rows.value.filter(({ item }) => !item.managed && item.status === 'conflict'),
)
const oneClickConflictRows = computed(
  () => pendingRows.value.filter(({ item }) => !item.managed && item.status === 'conflict'),
)
const oneClickImportable = computed(() => pendingRows.value.map(({ item }) => item).filter(canBatchAdopt))
const oneClickConflicts = computed(() => oneClickConflictRows.value.map(({ item }) => item))
const scopedImportableCount = computed(() => oneClickImportable.value.length)
const scopedConflictCount = computed(() => oneClickConflicts.value.length)
const allSources = computed(() => (sharedAgent.value ? [...agents.value, sharedAgent.value] : agents.value))
const noInstalledAgents = computed(() => !loading.value && allSources.value.length === 0)
const totalManaged = computed(() => allSources.value.reduce((sum, agent) => sum + agent.managedCount, 0))
const totalImportable = computed(() => allSources.value.reduce((sum, agent) => sum + agent.importableCount, 0))
const totalConflicts = computed(() =>
  allSources.value.reduce(
    (sum, agent) => sum + agent.items.filter((item) => !item.managed && item.status === 'conflict').length,
    0,
  ),
)
const pendingCount = computed(() =>
  allSources.value.reduce(
    (sum, agent) => sum + agent.items.filter((item) => !item.managed || item.status === 'conflict').length,
    0,
  ),
)

// ── Summary bar ───────────────────────────────────────────────────

const summaryTitle = computed(() => {
  if (noInstalledAgents.value) return t('skillManagerV2.agentSync.summaryNoDirs')
  if (scopedImportableCount.value > 0) {
    return t('skillManagerV2.agentSync.summaryFound', {
      adoptable: scopedImportableCount.value,
      conflicts: scopedConflictCount.value,
    })
  }
  if (scopedConflictCount.value > 0) {
    return t('skillManagerV2.agentSync.summaryConflictsOnly', { conflicts: scopedConflictCount.value })
  }
  return t('skillManagerV2.agentSync.summaryDone')
})

const summaryRecommendation = computed(() => {
  if (noInstalledAgents.value) return t('skillManagerV2.agentSync.recNoDirs')
  if (sharedAgent.value && selectedAgent.value === 'all' && sharedAgent.value.importableCount > 0) {
    return t('skillManagerV2.agentSync.recSharedFirst')
  }
  if (scopedImportableCount.value > 0) return t('skillManagerV2.agentSync.recSymlink')
  if (scopedConflictCount.value > 0) return t('skillManagerV2.agentSync.recConflictFirst')
  return t('skillManagerV2.agentSync.recAllDone')
})

const summaryChip = computed(() => {
  if (sharedAgent.value && sharedAgent.value.importableCount > 0) {
    return t('skillManagerV2.agentSync.chipCleanupRecommended')
  }
  if (totalImportable.value > 0) return t('skillManagerV2.agentSync.chipLinkRecommended')
  return t('skillManagerV2.agentSync.chipPending', { count: pendingCount.value })
})

const allAgentTone = computed(() =>
  totalConflicts.value > 0 ? 'conflict' : pendingCount.value > 0 ? 'attention' : 'ok',
)

const primaryActionLabel = computed(() => {
  if (importing.value) return t('skillManagerV2.agentSync.organizing')
  if (noInstalledAgents.value) return t('skillManagerV2.agentSync.rescan')
  if (scopedImportableCount.value > 0) {
    return t('skillManagerV2.agentSync.organize', { count: scopedImportableCount.value })
  }
  if (scopedConflictCount.value > 0) return t('skillManagerV2.agentSync.processingConflicts')
  return t('skillManagerV2.agentSync.completed')
})

const primaryActionDisabled = computed(() => {
  if (importing.value || scanning.value) return true
  if (noInstalledAgents.value) return false
  return scopedImportableCount.value === 0 && scopedConflictCount.value === 0
})

const scanDisabled = computed(() => scanning.value || importing.value)

// ── Selection ─────────────────────────────────────────────────────

function toggle(item: AgentSkillInventoryItem): void {
  if (!canBatchAdopt(item)) return
  const key = importKey(item)
  const next = new Set(selectedIds.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedIds.value = next
}

function selectAllVisible(): void {
  selectedIds.value = new Set(importableRows.value.map(({ item }) => importKey(item)))
}

function clearSelection(): void {
  selectedIds.value = new Set()
}

// ── Adopt execution helpers ───────────────────────────────────────

function executeAdopt(
  agentId: string,
  unmanagedId: string,
  option: AdoptOption,
  renamedId?: string
): Promise<void> {
  const sm = api.skillManagerV2
  if (!sm) return Promise.resolve()
  return sm.executeAdopt(agentId, unmanagedId, option, renamedId ?? undefined)
}

async function importSelected(): Promise<void> {
  const selected = importableRows.value.filter(({ item }) => selectedIds.value.has(importKey(item)))
  if (selected.length === 0) return
  importing.value = true
  importProgress.value = { current: 0, total: selected.length, currentName: selected[0]?.item.name ?? '' }
  error.value = null
  notice.value = null
  try {
    let ok = 0
    const failed: string[] = []
    for (const [index, { item }] of selected.entries()) {
      importProgress.value = { current: index + 1, total: selected.length, currentName: item.name }
      try {
        await executeAdopt(item.agentId, item.id, defaultBatchAdoptMode(item))
        ok += 1
      } catch (e) {
        failed.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    await store.loadOverview()
    await load()
    selectedIds.value = new Set()
    notice.value =
      failed.length > 0
        ? t('skillManagerV2.agentSync.noticeAdoptedFailed', { count: ok, failed: failed.length })
        : t('skillManagerV2.agentSync.noticeAdopted', { count: ok })
    if (failed.length > 0) error.value = failed.slice(0, 3).join('\n')
  } finally {
    importing.value = false
    importProgress.value = null
  }
}

function openAdoptPreview(row: AgentSyncRow): void {
  if (!canOpenAdopt(row.item) || importing.value || adoptOpeningKey.value) return
  adoptOpeningKey.value = importKey(row.item)
  error.value = null
  notice.value = null
  adoptRow.value = row
  adoptOpeningKey.value = null
}

async function finishAdopt(): Promise<void> {
  adoptRow.value = null
  await store.loadOverview()
  await load()
  selectedIds.value = new Set()
  notice.value = t('skillManagerV2.agentSync.noticeAdopted', { count: 1 })
}

// ── Shared .agents cleanup ────────────────────────────────────────

async function cleanupManagedSharedSkills(): Promise<void> {
  const shared = sharedAgent.value
  if (!shared || cleaningShared.value || importing.value || scanning.value) return
  const targetIds = shared.items.filter((item) => item.managed && item.targetId).map((item) => item.targetId as string)
  if (targetIds.length === 0) return
  cleaningShared.value = true
  error.value = null
  notice.value = null
  try {
    let deleted = 0
    const failed: string[] = []
    for (const targetId of targetIds) {
      try {
        await store.deleteTarget(targetId)
        deleted += 1
      } catch (e) {
        failed.push(`${targetId}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    await store.loadOverview()
    await load()
    notice.value =
      failed.length > 0
        ? t('skillManagerV2.agentSync.noticeCleanedFailed', { count: deleted, failed: failed.length })
        : t('skillManagerV2.agentSync.noticeCleaned', { count: deleted })
    if (failed.length > 0) error.value = failed.slice(0, 3).join('\n')
  } finally {
    cleaningShared.value = false
  }
}

// ── One-click organize ────────────────────────────────────────────

function openOneClickOrganize(): void {
  if (oneClickImportable.value.length === 0) {
    notice.value = null
    error.value =
      oneClickConflicts.value.length > 0
        ? t('skillManagerV2.agentSync.errNeedConflict', { count: oneClickConflicts.value.length })
        : t('skillManagerV2.agentSync.errNoImportable')
    return
  }
  error.value = null
  notice.value = null
  oneClickOpen.value = true
}

function handlePrimarySyncAction(): void {
  if (noInstalledAgents.value) {
    void scan()
    return
  }
  if (scopedImportableCount.value > 0) {
    openOneClickOrganize()
    return
  }
  if (scopedConflictCount.value > 0 && oneClickConflicts.value[0]) {
    openAdoptPreview(oneClickConflictRows.value.find(({ item }) => item === oneClickConflicts.value[0]) ?? oneClickConflictRows.value[0])
  }
}

function modeNoticeSuffix(mode: OneClickOrganizeMode): string {
  switch (mode) {
    case 'import_link':
      return t('skillManagerV2.agentSync.suffixLink')
    case 'import_copy':
      return t('skillManagerV2.agentSync.suffixCopy')
    default:
      return t('skillManagerV2.agentSync.suffixKeep')
  }
}

async function executeOneClickOrganize(mode: OneClickOrganizeMode): Promise<void> {
  const importable = oneClickImportable.value
  const conflicts = oneClickConflicts.value
  oneClickOpen.value = false
  importing.value = true
  importProgress.value = { current: 0, total: importable.length, currentName: importable[0]?.name ?? '' }
  error.value = null
  notice.value = null
  try {
    let ok = 0
    const failed: string[] = []
    for (const [index, item] of importable.entries()) {
      importProgress.value = { current: index + 1, total: importable.length, currentName: item.name }
      try {
        await executeAdopt(item.agentId, item.id, oneClickAdoptMode(item, mode))
        ok += 1
      } catch (e) {
        failed.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    await store.loadOverview()
    await load()
    selectedIds.value = new Set()
    let message = t('skillManagerV2.agentSync.noticeOrganized', { count: ok, suffix: modeNoticeSuffix(mode) })
    if (conflicts.length > 0) {
      message += t('skillManagerV2.agentSync.noticeOrganizedConflict', { count: conflicts.length })
    }
    if (failed.length > 0) {
      message += t('skillManagerV2.agentSync.noticeOrganizedFailed', { count: failed.length })
    }
    notice.value = message
    if (failed.length > 0) error.value = failed.slice(0, 3).join('\n')
  } finally {
    importing.value = false
    importProgress.value = null
  }
}

// ── Batch conflicts ───────────────────────────────────────────────

function openBatchConflicts(): void {
  if (visibleConflictRows.value.length === 0) return
  error.value = null
  notice.value = null
  batchConflictOpen.value = true
}

function batchConflictDoneVerb(mode: BatchConflictMode): string {
  switch (mode) {
    case 'rename':
      return t('skillManagerV2.agentSync.noticeConflictRename')
    case 'center_over_agent':
      return t('skillManagerV2.agentSync.noticeConflictCenter')
    case 'overwrite_center':
      return t('skillManagerV2.agentSync.noticeConflictOverwrite')
    default:
      return t('skillManagerV2.agentSync.noticeConflictSkip')
  }
}

async function executeBatchConflicts(mode: BatchConflictMode): Promise<void> {
  const conflicts = visibleConflictRows.value
  if (conflicts.length === 0) return
  batchConflictOpen.value = false
  importing.value = true
  importProgress.value = { current: 0, total: conflicts.length, currentName: conflicts[0]?.item.name ?? '' }
  error.value = null
  notice.value = null
  try {
    let ok = 0
    const failed: string[] = []
    for (const [index, { item }] of conflicts.entries()) {
      importProgress.value = { current: index + 1, total: conflicts.length, currentName: item.name }
      try {
        await executeAdopt(
          item.agentId,
          item.id,
          mode,
          mode === 'rename' ? batchConflictRenameId(item) : undefined,
        )
        ok += 1
      } catch (e) {
        failed.push(`${item.name}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    await store.loadOverview()
    await load()
    selectedIds.value = new Set()
    notice.value =
      failed.length > 0
        ? `${batchConflictDoneVerb(mode)} ${t('skillManagerV2.agentSync.conflictCountUnit', { count: ok })}${t('skillManagerV2.agentSync.noticeFailedSuffix', { count: failed.length })}`
        : `${batchConflictDoneVerb(mode)} ${t('skillManagerV2.agentSync.conflictCountUnit', { count: ok })}`
    if (failed.length > 0) error.value = failed.slice(0, 3).join('\n')
  } finally {
    importing.value = false
    importProgress.value = null
  }
}

// ── Progress ──────────────────────────────────────────────────────

const progressPercent = computed(() => {
  const progress = importProgress.value
  if (!progress || progress.total <= 0) return 4
  return Math.max(4, Math.round((progress.current / progress.total) * 100))
})
</script>

<template>
  <div class="asp">
    <!-- Summary bar -->
    <div class="asp-summary">
      <div class="asp-summary-main">
        <strong>{{ summaryTitle }}</strong>
        <span>{{ summaryRecommendation }}</span>
        <div class="asp-chips" :aria-label="t('skillManagerV2.agentSync.summaryChips')">
          <em>{{ t('skillManagerV2.agentSync.chipAgents', { count: agents.length }) }}</em>
          <em v-if="sharedAgent">
            {{ t('skillManagerV2.agentSync.chipSharedSkills', { count: localSkillCount(sharedAgent) }) }}
          </em>
          <em>{{ t('skillManagerV2.agentSync.chipManagedHidden', { count: totalManaged }) }}</em>
          <em>{{ summaryChip }}</em>
        </div>
      </div>
      <div class="asp-summary-actions">
        <button v-if="!noInstalledAgents" class="asp-btn" :disabled="scanDisabled" @click="scan">
          <RefreshCw :size="14" :class="{ spin: scanning }" />
          {{ scanning ? t('skillManagerV2.agentSync.scanning') : t('skillManagerV2.agentSync.rescan') }}
        </button>
        <button class="asp-btn asp-btn-featured" :disabled="primaryActionDisabled" @click="handlePrimarySyncAction">
          {{ primaryActionLabel }}
        </button>
      </div>
    </div>

    <!-- Agent strip -->
    <div class="asp-agent-strip" :aria-label="t('skillManagerV2.agentSync.agentFilter')">
      <button
        type="button"
        class="asp-agent-card"
        :class="[`tone-${allAgentTone}`, { active: selectedAgent === 'all' }]"
        :disabled="scanning"
        :aria-pressed="selectedAgent === 'all'"
        @click="selectedAgent = 'all'"
      >
        <span class="asp-agent-glyph">Ag</span>
        <span>
          <strong>{{ t('skillManagerV2.agentSync.allAgents') }}</strong>
          <small>{{
            pendingCount > 0
              ? t('skillManagerV2.agentSync.pendingShort', { count: pendingCount })
              : t('skillManagerV2.agentSync.healthy')
          }}</small>
        </span>
      </button>
      <button
        v-for="agent in sortedAgents"
        :key="agent.agentId"
        type="button"
        class="asp-agent-card"
        :class="[`tone-${agentAttentionTone(agent)}`, { active: selectedAgent === agent.agentId }]"
        :disabled="scanning"
        :aria-pressed="selectedAgent === agent.agentId"
        @click="selectedAgent = agent.agentId"
      >
        <AgentIconBadge :badge="agentBadge(agent.agentId, agent.displayName)" :size="28" />
        <span>
          <strong>{{ agent.displayName }}</strong>
          <small>{{ agentAttentionLabel(agent) }}</small>
        </span>
      </button>
    </div>

    <!-- Shared .agents source -->
    <div v-if="sharedAgent" class="asp-shared-source">
      <span class="asp-agent-glyph">Ag</span>
      <div>
        <strong>{{ t('skillManagerV2.agentSync.sharedSourceTitle') }}</strong>
        <span>{{
          t('skillManagerV2.agentSync.sharedSourceMeta', {
            dir: sharedAgent.skillsDir || '~/.agents/skills',
            importable: sharedAgent.importableCount,
            unmanaged: sharedAgent.unmanagedCount,
          })
        }}</span>
      </div>
      <button
        v-if="sharedAgent.managedCount > 0"
        type="button"
        class="asp-btn asp-btn-danger"
        :disabled="cleaningShared || importing || scanning"
        @click="cleanupManagedSharedSkills"
      >
        {{ cleaningShared ? t('skillManagerV2.agentSync.cleaning') : t('skillManagerV2.agentSync.cleanupShared') }}
      </button>
    </div>

    <!-- Pending inbox -->
    <section class="asp-inbox">
      <div class="asp-inbox-head">
        <div>
          <h3>{{ t('skillManagerV2.agentSync.inboxTitle') }}</h3>
          <p>{{ t('skillManagerV2.agentSync.inboxSubtitle', { count: selectedIds.size }) }}</p>
        </div>
        <div class="asp-inbox-tools">
          <div class="asp-search">
            <Search :size="14" />
            <input
              :aria-label="t('skillManagerV2.agentSync.searchLabel')"
              :placeholder="t('skillManagerV2.agentSync.searchPlaceholder')"
              :value="query"
              @input="query = ($event.target as HTMLInputElement).value"
            />
          </div>
          <label class="asp-agent-select">
            <span>{{ t('skillManagerV2.agentSync.selectAgent') }}</span>
            <select
              :aria-label="t('skillManagerV2.agentSync.selectAgent')"
              :disabled="scanning"
              :value="selectedAgent"
              @change="selectedAgent = ($event.target as HTMLSelectElement).value"
            >
              <option value="all">{{ t('skillManagerV2.agentSync.allAgents') }}</option>
              <option v-for="agent in sortedAgents" :key="agent.agentId" :value="agent.agentId">
                {{ agent.displayName }} ·
                {{ t('skillManagerV2.agentSync.importableOnly', { count: agent.importableCount }) }}
              </option>
            </select>
          </label>
          <div class="asp-view-toggle" :aria-label="t('skillManagerV2.agentSync.viewToggle')">
            <button
              type="button"
              :aria-pressed="viewMode === 'list'"
              :class="{ active: viewMode === 'list' }"
              @click="viewMode = 'list'"
            >
              {{ t('skillManagerV2.agentSync.listView') }}
            </button>
            <button
              type="button"
              :aria-pressed="viewMode === 'cards'"
              :class="{ active: viewMode === 'cards' }"
              @click="viewMode = 'cards'"
            >
              {{ t('skillManagerV2.agentSync.cardsView') }}
            </button>
          </div>
          <div class="asp-batch-actions">
            <button
              class="asp-btn"
              :disabled="importableRows.length === 0 || importing"
              @click="selectAllVisible"
            >
              {{ t('skillManagerV2.agentSync.selectImportable') }}
            </button>
            <button
              class="asp-btn"
              :disabled="visibleConflictRows.length === 0 || importing"
              @click="openBatchConflicts"
            >
              {{ t('skillManagerV2.agentSync.batchConflicts') }}
            </button>
            <button
              class="asp-btn"
              :disabled="selectedIds.size === 0 || importing"
              @click="clearSelection"
            >
              {{ t('skillManagerV2.agentSync.clear') }}
            </button>
            <button
              class="asp-btn asp-btn-primary"
              :disabled="selectedIds.size === 0 || importing"
              @click="importSelected"
            >
              {{ importing ? t('skillManagerV2.agentSync.adopting') : t('skillManagerV2.agentSync.adoptToCenter') }}
            </button>
          </div>
          <div v-if="notice" class="asp-notice" role="status" aria-live="polite">
            <span class="asp-notice-mark" aria-hidden="true"><Check :size="12" /></span>
            <span>{{ notice }}</span>
            <button type="button" :aria-label="t('common.close')" @click="notice = null">
              <X :size="13" />
            </button>
          </div>
        </div>
      </div>

      <!-- Advanced view -->
      <div class="asp-advanced">
        <button
          class="asp-btn asp-btn-ghost"
          type="button"
          :aria-expanded="advancedOpen"
          @click="advancedOpen = !advancedOpen"
        >
          {{ t('skillManagerV2.agentSync.advanced') }}
        </button>
        <div v-if="advancedOpen" class="asp-advanced-panel">
          <label class="asp-managed-toggle">
            <input v-model="showManaged" type="checkbox" />
            <span>{{ t('skillManagerV2.agentSync.showManaged') }}</span>
          </label>
          <div class="asp-status-tabs">
            <button
              v-for="tab in STATUS_TABS"
              :key="tab.id"
              type="button"
              :class="{ active: statusFilter === tab.id }"
              :aria-pressed="statusFilter === tab.id"
              :disabled="tab.id === 'managed' && !showManaged"
              @click="statusFilter = tab.id"
            >
              {{ t(tab.labelKey) }}
            </button>
          </div>
        </div>
      </div>

      <!-- Progress toast -->
      <div v-if="importProgress" class="asp-progress" role="status" aria-live="polite">
        <div class="asp-progress-main">
          <span>{{
            t('skillManagerV2.agentSync.progressTitle', {
              current: importProgress.current,
              total: importProgress.total,
            })
          }}</span>
          <strong>{{ importProgress.currentName || t('skillManagerV2.agentSync.progressPreparing') }}</strong>
        </div>
        <div class="asp-progress-bar" aria-hidden="true" :style="{ '--asp-progress': `${progressPercent}%` }">
          <span />
        </div>
      </div>

      <div v-if="error" class="asp-error">{{ error }}</div>

      <!-- Body -->
      <div v-if="loading" class="asp-empty">{{ t('skillManagerV2.agentSync.loading') }}</div>
      <div v-else-if="noInstalledAgents" class="asp-empty">
        {{ t('skillManagerV2.agentSync.emptyNoDirs') }}
      </div>
      <div v-else-if="rows.length === 0" class="asp-empty">
        {{ showManaged ? t('skillManagerV2.agentSync.emptyNoMatch') : t('skillManagerV2.agentSync.emptyNoPending') }}
      </div>

      <!-- Cards view -->
      <div v-else-if="viewMode === 'cards'" class="asp-grid">
        <div
          v-for="{ agent, item } in rows"
          :key="importKey(item)"
          class="asp-card"
          :class="[`tone-${statusTone(item)}`, { selected: selectedIds.has(importKey(item)) }]"
          :title="item.name"
          @click="openAdoptPreview({ agent, item })"
        >
          <div class="asp-card-head">
            <input
              type="checkbox"
              class="asp-checkbox"
              :aria-label="t('skillManagerV2.agentSync.selectItem', { name: item.name })"
              :checked="selectedIds.has(importKey(item))"
              :disabled="!canBatchAdopt(item) || importing"
              @click.stop
              @change="toggle(item)"
            />
            <AgentIconBadge :badge="agentBadge(agent.agentId, agent.displayName)" :size="34" />
            <div class="asp-card-title">{{ item.name }}</div>
            <button
              v-if="canBatchAdopt(item)"
              class="asp-icon-add"
              :title="t('skillManagerV2.agentSync.adoptToCenter')"
              :aria-label="t('skillManagerV2.agentSync.adoptItemAction', { name: item.name })"
              :disabled="importing || adoptOpeningKey === importKey(item)"
              @click.stop="openAdoptPreview({ agent, item })"
            >
              <Plus :size="16" />
            </button>
            <button
              v-if="!canBatchAdopt(item) && item.status === 'conflict'"
              class="asp-btn asp-btn-small"
              :title="t('skillManagerV2.agentSync.handleConflictTitle')"
              :disabled="importing || adoptOpeningKey === importKey(item)"
              @click.stop="openAdoptPreview({ agent, item })"
            >
              <AlertTriangle :size="13" />
              {{ t('skillManagerV2.agentSync.handleConflict') }}
            </button>
          </div>
          <div class="asp-card-meta">
            <span class="asp-source-pill">{{ agent.displayName }}</span>
            <span class="asp-tag" :class="statusTagClass(item)">{{ inventoryStatusLabel(item) }}</span>
            <span v-if="item.actualMode" class="asp-tag">
              {{ item.actualMode === 'link' ? t('skillManagerV2.settings.modeLink') : t('skillManagerV2.settings.modeCopy') }}
            </span>
          </div>
          <code class="asp-card-path">{{ item.path }}</code>
        </div>
      </div>

      <!-- List view -->
      <div v-else class="asp-listview">
        <div
          v-for="{ agent, item } in rows"
          :key="importKey(item)"
          class="asp-item"
          @click="openAdoptPreview({ agent, item })"
        >
          <input
            type="checkbox"
            class="asp-checkbox"
            :aria-label="t('skillManagerV2.agentSync.selectItem', { name: item.name })"
            :checked="selectedIds.has(importKey(item))"
            :disabled="!canBatchAdopt(item) || importing"
            @click.stop
            @change="toggle(item)"
          />
          <AgentIconBadge :badge="agentBadge(agent.agentId, agent.displayName)" :size="34" />
          <div class="asp-item-main">
            <div class="asp-item-title">
              <strong>{{ item.name }}</strong>
            </div>
            <div class="asp-item-meta">
              <span class="asp-source-pill">{{ agent.displayName }}</span>
              <span class="asp-tag" :class="statusTagClass(item)">{{ inventoryStatusLabel(item) }}</span>
              <span v-if="item.actualMode" class="asp-tag">
                {{ item.actualMode === 'link' ? t('skillManagerV2.settings.modeLink') : t('skillManagerV2.settings.modeCopy') }}
              </span>
              <code class="asp-item-path">{{ item.path }}</code>
            </div>
          </div>
          <button
            v-if="canBatchAdopt(item)"
            class="asp-icon-add"
            :title="t('skillManagerV2.agentSync.adoptToCenter')"
            :aria-label="t('skillManagerV2.agentSync.adoptItemAction', { name: item.name })"
            :disabled="importing || adoptOpeningKey === importKey(item)"
            @click.stop="openAdoptPreview({ agent, item })"
          >
            <Plus :size="16" />
          </button>
          <button
            v-if="!canBatchAdopt(item) && item.status === 'conflict'"
            class="asp-btn asp-btn-small"
            :disabled="importing || adoptOpeningKey === importKey(item)"
            @click.stop="openAdoptPreview({ agent, item })"
          >
            <AlertTriangle :size="13" />
            {{ t('skillManagerV2.agentSync.handleConflict') }}
          </button>
        </div>
      </div>
    </section>

    <!-- Dialogs -->
    <AdoptDialog
      v-if="adoptRow && !adoptRow.item.managed"
      visible
      :agent-id="adoptRow.item.agentId"
      :unmanaged-id="adoptRow.item.id"
      :skill-path="adoptRow.item.path"
      @close="adoptRow = null"
      @adopted="finishAdopt"
    />
    <OneClickOrganizeDialog
      :visible="oneClickOpen"
      :importable-count="oneClickImportable.length"
      :conflict-count="oneClickConflicts.length"
      :busy="importing"
      @close="oneClickOpen = false"
      @confirm="executeOneClickOrganize"
    />
    <BatchConflictDialog
      :visible="batchConflictOpen"
      :conflict-count="visibleConflictRows.length"
      :visible-only="true"
      :busy="importing"
      @close="batchConflictOpen = false"
      @confirm="executeBatchConflicts"
    />
  </div>
</template>

<style scoped lang="scss">
.asp {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

// ── Buttons ──────────────────────────────────────────────────────

.asp-btn {
  min-height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 0 11px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.asp-btn-featured {
  border-color: color-mix(in srgb, var(--accent-primary) 45%, var(--border-default));
  background: color-mix(in srgb, var(--accent-primary) 9%, var(--bg-elevated));
  color: var(--accent-primary);
  font-weight: 700;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent-primary) 15%, var(--bg-elevated));
  }
}

.asp-btn-primary {
  border-color: transparent;
  background: var(--accent-primary);
  color: var(--text-on-accent, #fff);

  &:hover:not(:disabled) {
    background: var(--accent-primary-hover, var(--accent-primary));
  }
}

.asp-btn-danger {
  border-color: color-mix(in srgb, var(--error) 40%, var(--border-default));
  background: color-mix(in srgb, var(--error) 7%, var(--bg-elevated));
  color: var(--error);
}

.asp-btn-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--text-muted);

  &:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.asp-btn-small {
  min-height: 28px;
  padding: 0 9px;
  font-size: 11px;
}

.spin {
  animation: asp-spin 900ms linear infinite;
}
@keyframes asp-spin {
  to {
    transform: rotate(360deg);
  }
}

// ── Summary ──────────────────────────────────────────────────────

.asp-summary {
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border: 1px solid color-mix(in srgb, var(--accent-primary) 22%, var(--border-default));
  border-radius: var(--radius-md);
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent-primary) 6%, var(--bg-elevated)),
    color-mix(in srgb, var(--success) 5%, var(--bg-elevated))
  );
}

.asp-summary-main {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;

  strong {
    display: block;
    font-family: var(--font-display);
    font-size: 16px;
  }

  > span {
    display: block;
    margin-top: 5px;
    max-width: 72ch;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
}

.asp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;

  em {
    padding: 2px 8px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-full);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    font-size: 10px;
    font-style: normal;
    font-weight: 700;
    white-space: nowrap;
  }
}

.asp-summary-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

// ── Agent strip ──────────────────────────────────────────────────

.asp-agent-strip {
  width: 100%;
  min-width: 0;
  display: flex;
  gap: 8px;
  padding: 8px;
  overflow-x: auto;
  flex-wrap: nowrap;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.asp-agent-card {
  flex: 0 0 150px;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  padding: 7px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    background: var(--surface-soft);
  }
  &.active {
    border-color: var(--accent-primary);
    background: var(--accent-primary-glow);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  &.tone-conflict {
    border-color: rgba(220, 38, 38, 0.3);
    background: rgba(220, 38, 38, 0.05);
  }
  &.tone-attention {
    border-color: rgba(217, 119, 6, 0.25);
    background: rgba(217, 119, 6, 0.05);
  }

  strong,
  small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  strong {
    font-size: 12px;
  }
  small {
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 10px;
  }
}

.asp-agent-glyph {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 800;
}

// ── Shared source ────────────────────────────────────────────────

.asp-shared-source {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);

  > div {
    min-width: 0;
    flex: 1;

    strong {
      display: block;
      font-size: 12px;
    }
    span {
      display: block;
      margin-top: 3px;
      color: var(--text-muted);
      font-size: 11px;
      overflow-wrap: anywhere;
    }
  }
}

// ── Inbox ────────────────────────────────────────────────────────

.asp-inbox {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.asp-inbox-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  min-width: 0;

  > :first-child {
    min-width: 0;
    flex: 1 1 180px;
  }

  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
  }
  p {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 11px;
  }
}

.asp-inbox-tools {
  flex: 1 1 600px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
}

.asp-search {
  flex: 1 1 180px;
  min-width: 120px;
  max-width: 240px;
  height: 32px;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: center;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
  color: var(--text-muted);

  &:focus-within {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }

  input {
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-primary);
    font-size: 12px;
  }
}

.asp-agent-select {
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;

  > span {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  select {
    height: 32px;
    max-width: 160px;
    padding: 0 30px 0 10px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--surface-soft);
    color: var(--text-primary);
    font-size: 12px;
    outline: none;
    cursor: pointer;
    appearance: none;
    overflow: hidden;
    text-overflow: ellipsis;

    &:focus {
      border-color: var(--accent-primary);
    }
  }

  &::after {
    content: '⌄';
    position: absolute;
    right: 11px;
    color: var(--text-muted);
    font-size: 12px;
    pointer-events: none;
  }
}

.asp-view-toggle {
  height: 32px;
  display: flex;
  padding: 2px;
  gap: 2px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);

  button {
    min-width: 48px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;

    &.active {
      background: var(--text-primary);
      color: var(--bg-primary);
    }
  }
}

.asp-batch-actions {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
}

// ── Notice ───────────────────────────────────────────────────────

.asp-notice {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 8px 4px 5px;
  border: 1px solid rgba(5, 135, 102, 0.22);
  border-radius: var(--radius-full);
  background: rgba(5, 135, 102, 0.07);
  color: var(--success);
  font-size: 11px;
  font-weight: 600;
  animation: asp-notice-in 160ms ease;

  button {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    cursor: pointer;

    &:hover {
      background: rgba(5, 135, 102, 0.12);
    }
  }
}

.asp-notice-mark {
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--success);
  color: #fff;
}

@keyframes asp-notice-in {
  from {
    opacity: 0;
    transform: translateY(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

// ── Advanced ─────────────────────────────────────────────────────

.asp-advanced {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.asp-advanced-panel {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 10px 12px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
}

.asp-managed-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;

  input {
    accent-color: var(--accent-primary);
  }
}

.asp-status-tabs {
  display: flex;
  padding: 2px;
  gap: 2px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);

  button {
    height: 26px;
    padding: 0 11px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;

    &.active {
      background: var(--text-primary);
      color: var(--bg-primary);
    }
    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
}

// ── Progress ─────────────────────────────────────────────────────

.asp-progress {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px 13px;
  border: 1px solid rgba(109, 40, 217, 0.3);
  border-radius: var(--radius-md);
  background: rgba(124, 58, 237, 0.06);
}

.asp-progress-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;

  span {
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
  }
  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--accent-tertiary);
    font-size: 12px;
  }
}

.asp-progress-bar {
  --asp-progress: 4%;
  height: 6px;
  overflow: hidden;
  border-radius: var(--radius-full);
  background: rgba(124, 58, 237, 0.14);

  span {
    display: block;
    width: var(--asp-progress);
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #7c3aed, #16a34a);
    background-size: 200% 100%;
    animation: asp-progress-stripes 1.2s linear infinite;
    transition: width 0.25s ease;
  }
}

@keyframes asp-progress-stripes {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: 0 0;
  }
}

// ── Error / empty ────────────────────────────────────────────────

.asp-error {
  padding: 9px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--error) 9%, transparent);
  color: var(--error);
  font-size: 11px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.asp-empty {
  padding: 36px 20px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

// ── Cards ────────────────────────────────────────────────────────

.asp-grid {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
  gap: 10px;
}

.asp-card {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-left-width: 3px;
  border-radius: var(--radius-md);
  background: var(--surface-soft);
  cursor: pointer;
  transition: border-color 0.16s, box-shadow 0.16s, transform 0.16s;

  &:hover {
    border-color: var(--border-strong);
    box-shadow: 0 8px 20px rgba(5, 10, 20, 0.08);
    transform: translateY(-1px);
  }

  &.tone-unmanaged {
    border-left-color: rgba(16, 185, 129, 0.55);
  }
  &.tone-conflict {
    border-left-color: rgba(220, 38, 38, 0.55);
  }
  &.tone-ok {
    border-left-color: rgba(13, 148, 136, 0.4);
  }

  &.selected {
    border-color: rgba(10, 132, 255, 0.45);
    box-shadow: 0 0 0 1px rgba(10, 132, 255, 0.25);
  }
}

.asp-card-head {
  display: grid;
  grid-template-columns: auto 34px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
}

.asp-card-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 700;
}

.asp-checkbox {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-primary);
  cursor: pointer;

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
}

.asp-icon-add {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 50%;
  background: var(--accent-primary);
  color: var(--text-on-accent, #fff);
  cursor: pointer;
  transition: transform 0.15s;

  &:hover:not(:disabled) {
    transform: scale(1.1);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.asp-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.asp-source-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: rgba(4, 120, 87, 0.09);
  color: #047857;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
}

.asp-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;

  &.tag-ok {
    background: rgba(5, 150, 105, 0.09);
    color: var(--success);
  }
  &.tag-unmanaged {
    background: rgba(124, 58, 237, 0.09);
    color: var(--accent-tertiary);
  }
  &.tag-reusable {
    background: rgba(100, 116, 139, 0.1);
    color: var(--text-secondary);
  }
  &.tag-readonly {
    background: rgba(14, 116, 144, 0.1);
    color: #0e7490;
  }
  &.tag-conflict {
    background: rgba(220, 38, 38, 0.09);
    color: var(--error);
  }
}

.asp-card-path,
.asp-item-path {
  display: block;
  overflow: hidden;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// ── List view ────────────────────────────────────────────────────

.asp-listview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
}

.asp-item {
  display: grid;
  grid-template-columns: auto 34px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;

  &:hover {
    border-color: var(--border-default);
    background: var(--surface-soft);
  }
}

.asp-item-main {
  min-width: 0;
}

.asp-item-title strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.asp-item-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-top: 4px;
}

@media (max-width: 1100px) {
  .asp-inbox-head {
    flex-direction: column;
    align-items: stretch;
  }
  .asp-inbox-tools {
    justify-content: flex-start;
  }
}

@media (max-width: 900px) {
  .asp-summary {
    align-items: stretch;
    flex-direction: column;
  }
  .asp-summary-actions {
    justify-content: flex-start;
  }
  .asp-inbox-tools {
    flex-direction: column;
    align-items: stretch;
  }
  .asp-inbox-tools {
    justify-content: flex-start;
  }
  .asp-search {
    flex: 1 1 auto;
    max-width: none;
  }
}
</style>
