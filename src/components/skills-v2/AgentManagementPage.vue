<script setup lang="ts">
/**
 * Skill Manager V2 — Agent Management Page
 *
 * Layout: side-panel agent list + detail-panel with tabs (Skills, Packs, Diagnostics).
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, Check, FolderOpen, LayoutGrid, List, PackageOpen, Plus, RefreshCw, Search, Sparkles, PlugZap, Server, Settings2 } from 'lucide-vue-next'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillTarget, UnmanagedItemDto, DiagnosisIssue } from '@/types/skillManagerV2'
import AdoptDialog from './AdoptDialog.vue'
import AgentIconBadge from './AgentIconBadge.vue'
import { getSkillGlyph, pathBasename, unmanagedReasonKey } from './skillLabels'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── State ─────────────────────────────────────────────────────────

type AgentDetailTab = 'overview' | 'skills' | 'packs' | 'diagnostics' | 'mcp' | 'plugins' | 'config'

const activeTab = ref<AgentDetailTab>('overview')
const adoptItem = ref<UnmanagedItemDto | null>(null)
const skillQuery = ref('')
const skillScope = ref<'agent' | 'shared'>('agent')
const skillStatus = ref<'managed' | 'unmanaged'>('managed')
const skillsView = ref<'cards' | 'list'>('cards')

// ── Computed ───────────────────────────────────────────────────────

const agents = computed(() => store.agents.filter((agent) => agent.id !== 'agents'))
const installedAgents = computed(() => agents.value.filter((agent) => agent.installed))
const uninstalledAgents = computed(() => agents.value.filter((agent) => !agent.installed))
const selectedAgent = computed(() => store.selectedAgentDetail)

const unmanagedItems = computed<UnmanagedItemDto[]>(() =>
  selectedAgent.value?.unmanaged ?? []
)
const sharedSkills = computed(() => (selectedAgent.value?.skills ?? []).filter((skill) => {
  const normalizedPath = skill.targetPath.replace(/\\/g, '/')
  return normalizedPath.includes('/.agents/skills/')
}))
const filteredAgentSkills = computed(() => {
  const query = skillQuery.value.trim().toLowerCase()
  const skills = skillScope.value === 'shared'
    ? sharedSkills.value
    : (selectedAgent.value?.skills ?? []).filter((skill) => !sharedSkills.value.some((shared) => shared.id === skill.id))
  if (skillStatus.value === 'unmanaged') return []
  return skills.filter((skill) => {
    if (skillScope.value === 'shared' && !inheritsSharedSkills.value) return false
    if (!query) return true
    return `${skill.skillId} ${pathBasename(skill.targetPath)} ${skill.targetPath}`.toLowerCase().includes(query)
  })
})

const appliedPacks = computed(() =>
  selectedAgent.value?.appliedPacks ?? []
)

const healthIssues = computed<DiagnosisIssue[]>(() =>
  selectedAgent.value?.healthIssues ?? []
)
const mcpServers = computed(() => selectedAgent.value?.mcpServers ?? [])
const plugins = computed(() => selectedAgent.value?.plugins ?? [])
const availablePacks = computed(() => {
  const appliedIds = new Set(appliedPacks.value.map((pack) => pack.id))
  return store.packs.filter((pack) => !appliedIds.has(pack.id))
})
const configuredPaths = computed(() => {
  if (!selectedAgent.value) return 0
  return [selectedAgent.value.skillsDir, selectedAgent.value.configPath, selectedAgent.value.pluginDir]
    .filter(Boolean).length
})
const healthErrorCount = computed(() => healthIssues.value.filter((issue) => issue.severity === 'error').length)
const invalidMcpCount = computed(() => mcpServers.value.filter((server) => !server.valid).length)
const attentionCount = computed(() => healthIssues.value.length + unmanagedItems.value.length + mcpServers.value.filter((server) => !server.valid).length)
const overviewTone = computed(() => healthErrorCount.value > 0 ? 'danger' : attentionCount.value > 0 ? 'attention' : 'ready')
const overviewTitle = computed(() => healthErrorCount.value > 0
  ? t('skillManagerV2.agent.overview.configErrors', { count: healthErrorCount.value })
  : attentionCount.value > 0 ? t('skillManagerV2.agent.overview.attention', { count: attentionCount.value }) : t('skillManagerV2.agent.overview.ready'))
const overviewDescription = computed(() => healthErrorCount.value > 0
  ? t('skillManagerV2.agent.overview.configErrorDesc')
  : attentionCount.value > 0 ? t('skillManagerV2.agent.overview.attentionDesc') : t('skillManagerV2.agent.overview.readyDesc'))
const capabilities = computed(() => {
  const detail = selectedAgent.value
  if (!detail) return []
  const validMcp = mcpServers.value.filter((server) => server.valid).length
  const enabledPlugins = plugins.value.filter((plugin) => plugin.enabled).length
  return [
    {
      id: 'skills', label: 'Skills', value: detail.skills.length, unit: t('skillManagerV2.agent.overview.available'), detail: unmanagedItems.value.length > 0 ? t('skillManagerV2.agent.overview.pendingAdopt', { count: unmanagedItems.value.length }) : t('skillManagerV2.agent.overview.allManaged'), tab: 'skills' as AgentDetailTab, tone: unmanagedItems.value.length > 0 ? 'amber' : 'blue', progress: detail.skills.length + unmanagedItems.value.length === 0 ? 100 : detail.skills.length / (detail.skills.length + unmanagedItems.value.length) * 100,
    },
    {
      id: 'packs', label: t('skillManagerV2.agent.overview.packTitle'), value: appliedPacks.value.length, unit: t('skillManagerV2.agent.overview.applied'), detail: availablePacks.value.length > 0 ? t('skillManagerV2.agent.overview.morePacks', { count: availablePacks.value.length }) : t('skillManagerV2.agent.overview.packsComplete'), tab: 'packs' as AgentDetailTab, tone: 'violet', progress: appliedPacks.value.length + availablePacks.value.length === 0 ? 0 : appliedPacks.value.length / (appliedPacks.value.length + availablePacks.value.length) * 100,
    },
    {
      id: 'mcp', label: 'MCP', value: validMcp, unit: detail.mcpServers.length > 0 ? t('skillManagerV2.agent.overview.serviceAvailable', { count: detail.mcpServers.length }) : t('skillManagerV2.agent.overview.notConfigured'), detail: detail.mcpServers.length === 0 ? t('skillManagerV2.agent.overview.noService') : validMcp === detail.mcpServers.length ? t('skillManagerV2.agent.overview.serviceHealthy') : t('skillManagerV2.agent.overview.serviceErrors', { count: detail.mcpServers.length - validMcp }), tab: 'mcp' as AgentDetailTab, tone: detail.mcpServers.length > 0 && validMcp < detail.mcpServers.length ? 'amber' : 'green', progress: detail.mcpServers.length === 0 ? 0 : validMcp / detail.mcpServers.length * 100,
    },
    {
      id: 'plugins', label: 'Plugins', value: enabledPlugins, unit: detail.plugins.length > 0 ? t('skillManagerV2.agent.overview.pluginEnabled', { count: detail.plugins.length }) : t('skillManagerV2.agent.overview.notInstalled'), detail: detail.plugins.length === 0 ? t('skillManagerV2.agent.overview.noPlugin') : enabledPlugins === detail.plugins.length ? t('skillManagerV2.agent.overview.pluginHealthy') : t('skillManagerV2.agent.overview.pluginDisabled', { count: detail.plugins.length - enabledPlugins }), tab: 'plugins' as AgentDetailTab, tone: 'green', progress: detail.plugins.length === 0 ? 0 : enabledPlugins / detail.plugins.length * 100,
    },
  ]
})

const hasAgents = computed(() => agents.value.length > 0)
const inheritsSharedSkills = computed(() =>
  selectedAgent.value?.id === 'codex'
)

// ── Agent status summary ──────────────────────────────────────────

function agentStatusChip(agent: typeof agents.value[0]): { cls: string; label: string } {
  if (agent.unmanagedCount > 0) return { cls: 'warn', label: t('skillManagerV2.status.unmanaged') }
  return { cls: 'ok', label: t('skillManagerV2.status.ok') }
}

// ── Lifecycle ─────────────────────────────────────────────────────

onMounted(() => {
  if (hasAgents.value && !store.selectedAgentId) {
    const first = installedAgents.value[0] ?? agents.value[0]
    store.scanAgentDetail(first.id)
  }
})

// ── Handlers ───────────────────────────────────────────────────────

function handleSelectAgent(agentId: string): void {
  activeTab.value = 'overview'
  skillScope.value = 'agent'
  skillStatus.value = 'managed'
  skillQuery.value = ''
  void store.scanAgentDetail(agentId)
}

function openSection(tab: AgentDetailTab): void {
  activeTab.value = tab
}

async function handleApplyPack(packId: string): Promise<void> {
  if (!selectedAgent.value) return
  await store.executeApplyPack(packId, [selectedAgent.value.id], store.settings?.defaultInstallMode ?? 'link')
  await store.loadAgentDetail(selectedAgent.value.id)
}

async function handleRevokePack(packId: string): Promise<void> {
  if (!selectedAgent.value) return
  await store.removePackFromAgent(packId, selectedAgent.value.id)
  await store.loadAgentDetail(selectedAgent.value.id)
}

async function handleScanAgent(agentId: string): Promise<void> {
  await store.scanAgentDetail(agentId)
}

async function handleOpenDir(dirPath: string): Promise<void> {
  await store.openPath(dirPath)
}

function agentBadge(agentId: string, agentName: string): { agentId: string; agentName: string; mode: 'link'; status: 'ok' } {
  return { agentId, agentName, mode: 'link', status: 'ok' }
}

function handleAdopt(item: UnmanagedItemDto): void {
  adoptItem.value = item
}

/** Card display name for an unmanaged item (AgentBro: inferred id, else path basename). */
function unmanagedName(item: UnmanagedItemDto): string {
  return item.inferredSkillId || pathBasename(item.path) || item.id
}

function reasonLabel(reason: string): string {
  const key = unmanagedReasonKey(reason)
  return key ? t(key) : reason
}

async function handleAdopted(): Promise<void> {
  adoptItem.value = null
  if (store.selectedAgentId) await store.loadAgentDetail(store.selectedAgentId)
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    ok: t('skillManagerV2.status.ok'),
    unmanaged: t('skillManagerV2.status.unmanaged'),
    conflict: t('skillManagerV2.status.conflict'),
    broken_link: t('skillManagerV2.status.brokenLink'),
    copy_outdated: t('skillManagerV2.status.copyOutdated'),
    copy_modified: t('skillManagerV2.status.copyModified'),
    copy_diverged: t('skillManagerV2.status.copyDiverged'),
    missing: t('skillManagerV2.status.missing'),
  }
  return map[status] ?? status
}

function statusPillClass(status: string): string {
  const map: Record<string, string> = {
    ok: 'ok',
    unmanaged: 'unmanaged',
    conflict: 'conflict',
    broken_link: 'warn',
    copy_outdated: 'warn',
    copy_modified: 'warn',
    copy_diverged: 'conflict',
    missing: 'warn',
  }
  return map[status] ?? 'ok'
}

function modePillClass(mode: string): string {
  return mode === 'link' ? 'link' : 'copy'
}

function severityClass(severity: string): string {
  return severity === 'error' ? 'bad' : severity === 'warning' ? 'warn' : 'ok'
}

function severityLabel(severity: string): string {
  const map: Record<string, string> = {
    error: t('skillManagerV2.diagnosis.severityError'),
    warning: t('skillManagerV2.diagnosis.severityWarning'),
    info: t('skillManagerV2.diagnosis.severityInfo'),
  }
  return map[severity] ?? severity
}
</script>

<template>
  <div class="agent-page">
    <!-- Empty state -->
    <div v-if="!hasAgents" class="amp-empty">
      <p class="amp-empty-title">{{ t('skillManagerV2.empty.noAgents') }}</p>
    </div>

    <!-- Two-column layout -->
    <div v-else class="amp-layout">
      <!-- Left: Agent List -->
      <aside class="amp-side-panel">
        <header class="amp-side-header">
          <h3>{{ t('skillManagerV2.tabs.agents') }}</h3>
          <p>{{ t('skillManagerV2.viewSubtitle.agents') }}</p>
        </header>
        <div class="amp-side-body">
          <div v-if="installedAgents.length > 0" class="amp-agent-group">
            <div class="amp-agent-group-title">
              <span>{{ t('skillManagerV2.agent.installedAgents') }}</span><b>{{ installedAgents.length }}</b>
            </div>
            <button
              v-for="agent in installedAgents"
              :key="agent.id"
              class="amp-list-item"
              :class="{ active: store.selectedAgentId === agent.id }"
              @click="handleSelectAgent(agent.id)"
            >
              <AgentIconBadge :badge="agentBadge(agent.id, agent.displayName)" :size="30" />
              <span>
                <strong>{{ agent.displayName }}</strong>
                <small>v{{ agent.version ?? '?' }} · {{ agent.managedSkillCount }} Skills · {{ agent.unmanagedCount }} {{ t('skillManagerV2.agent.unmanaged') }}</small>
              </span>
              <span class="amp-chip" :class="agentStatusChip(agent).cls">
                {{ agentStatusChip(agent).label }}
              </span>
            </button>
          </div>
          <div v-if="uninstalledAgents.length > 0" class="amp-agent-group">
            <div class="amp-agent-group-title">
              <span>{{ t('skillManagerV2.agent.uninstalledAgents') }}</span><b>{{ uninstalledAgents.length }}</b>
            </div>
            <button
              v-for="agent in uninstalledAgents"
              :key="agent.id"
              class="amp-list-item"
              :class="{ active: store.selectedAgentId === agent.id }"
              @click="handleSelectAgent(agent.id)"
            >
              <AgentIconBadge :badge="agentBadge(agent.id, agent.displayName)" :size="30" />
              <span>
                <strong>{{ agent.displayName }}</strong>
                <small>{{ t('skillManagerV2.agent.notInstalled') }}</small>
              </span>
              <span class="amp-chip">{{ t('skillManagerV2.agent.notInstalled') }}</span>
            </button>
          </div>
        </div>
      </aside>

      <!-- Right: Agent Detail -->
      <section class="amp-detail-panel">
        <!-- Loading -->
        <div v-if="store.agentDetailLoading" class="amp-loading">
          {{ t('common.loading') }}
        </div>

        <template v-else-if="selectedAgent">
          <!-- Agent Header -->
          <div class="amp-agent-header">
            <div class="amp-agent-title">
              <AgentIconBadge :badge="agentBadge(selectedAgent.id, selectedAgent.displayName)" :size="38" />
              <div>
                <h3>{{ selectedAgent.displayName }}</h3>
                <p>
                  <span v-if="selectedAgent.skillsDir">{{ selectedAgent.skillsDir }}</span>
                  <span v-if="selectedAgent.lastScannedAt"> · {{ selectedAgent.lastScannedAt }}</span>
                </p>
              </div>
            </div>
            <div class="amp-header-stats">
              <span><strong>{{ selectedAgent.skills.length }}</strong>{{ t('skillManagerV2.agent.managedCount') }}</span>
              <span><strong>{{ selectedAgent.unmanaged.length }}</strong>{{ t('skillManagerV2.agent.unmanagedCount') }}</span>
              <span><strong>{{ mcpServers.length }}</strong>MCP</span>
              <span><strong>{{ plugins.length }}</strong>Plugins</span>
            </div>
            <div class="amp-header-actions">
              <button
                class="amp-btn primary"
                :disabled="store.busyAction === 'scan-agent-detail'"
                @click="handleScanAgent(selectedAgent.id)"
              >
                <RefreshCw :size="15" :class="{ spin: store.busyAction === 'scan-agent-detail' }" />
                {{ t('skillManagerV2.agent.scan') }}
              </button>
              <button
                v-if="selectedAgent.skillsDir"
                class="amp-btn"
                @click="handleOpenDir(selectedAgent.skillsDir)"
              >
                <FolderOpen :size="15" />
                {{ t('skillManagerV2.actions.openPath') }}
              </button>
            </div>
          </div>

          <div v-if="inheritsSharedSkills" class="amp-shared-notice">
            {{ t('skillManagerV2.agent.sharedSkillsNotice', { agent: selectedAgent.displayName }) }}
          </div>

          <!-- Tabs -->
          <div class="amp-tabs">
            <button
              :class="{ active: activeTab === 'overview' }"
              @click="activeTab = 'overview'"
            >
              {{ t('skillManagerV2.agent.tabs.overview') }}
            </button>
            <button
              :class="{ active: activeTab === 'skills' }"
              @click="activeTab = 'skills'"
            >
              {{ t('skillManagerV2.agent.tabs.skills') }}
            </button>
            <button
              :class="{ active: activeTab === 'packs' }"
              @click="activeTab = 'packs'"
            >
              {{ t('skillManagerV2.agent.tabs.packs') }}
            </button>
            <button
              :class="{ active: activeTab === 'diagnostics' }"
              @click="activeTab = 'diagnostics'"
            >
              {{ t('skillManagerV2.agent.tabs.diagnostics') }}
            </button>
            <button :class="{ active: activeTab === 'mcp' }" @click="activeTab = 'mcp'">
              <Server :size="14" /> MCP ({{ mcpServers.length }})
            </button>
            <button :class="{ active: activeTab === 'plugins' }" @click="activeTab = 'plugins'">
              <PlugZap :size="14" /> Plugins ({{ plugins.length }})
            </button>
            <button :class="{ active: activeTab === 'config' }" @click="activeTab = 'config'">
              <Settings2 :size="14" /> {{ t('skillManagerV2.agent.tabs.config') }}
            </button>
          </div>

          <!-- Tab Content -->
          <div class="amp-tab-content">
            <!-- Overview Tab -->
            <div v-if="activeTab === 'overview'" class="amp-overview">
              <section class="amp-overview-status" :class="`amp-overview-status--${overviewTone}`">
                <div class="amp-overview-status-copy">
                  <div class="amp-overview-kicker"><span class="amp-overview-pulse" />{{ t('skillManagerV2.agent.overview.status') }}</div>
                  <h4>{{ overviewTitle }}</h4>
                  <p>{{ overviewDescription }}</p>
                </div>
                <div class="amp-overview-readiness">
                  <div><span>{{ t('skillManagerV2.agent.overview.completeness') }}</span><strong>{{ configuredPaths }}<small>/3</small></strong></div>
                  <div class="amp-overview-track"><span :style="{ width: `${configuredPaths / 3 * 100}%` }" /></div>
                  <button type="button" @click="openSection('config')">{{ t('skillManagerV2.agent.overview.viewConfig') }} <ArrowUpRight :size="13" /></button>
                </div>
              </section>

              <section class="amp-overview-section">
                <div class="amp-overview-section-head">
                  <div><h4>{{ t('skillManagerV2.agent.overview.capabilities') }}</h4><p>{{ t('skillManagerV2.agent.overview.capabilitiesHint') }}</p></div>
                  <span>{{ t('skillManagerV2.agent.overview.connected', { count: capabilities.reduce((sum, capability) => sum + capability.value, 0) }) }}</span>
                </div>
                <div class="amp-capability-grid">
                  <button
                    v-for="capability in capabilities"
                    :key="capability.id"
                    type="button"
                    class="amp-capability-card"
                    :class="`amp-capability-card--${capability.tone}`"
                    @click="openSection(capability.tab)"
                  >
                    <span class="amp-capability-label"><i>{{ capability.label.slice(0, 1) }}</i>{{ capability.label }}<ArrowUpRight :size="13" /></span>
                    <span class="amp-capability-value"><strong>{{ capability.value }}</strong><small>{{ capability.unit }}</small></span>
                    <span class="amp-capability-detail">{{ capability.detail }}</span>
                    <span class="amp-capability-track"><span :style="{ width: `${Math.max(0, Math.min(100, capability.progress))}%` }" /></span>
                  </button>
                </div>
              </section>

              <div class="amp-overview-lower">
                <section class="amp-overview-panel">
                  <div class="amp-overview-panel-head"><div><h4>{{ t('skillManagerV2.agent.overview.packTitle') }}</h4><p>{{ t('skillManagerV2.agent.overview.packHint') }}</p></div><button type="button" @click="openSection('packs')">{{ t('skillManagerV2.agent.overview.manageAll') }}</button></div>
                  <div class="amp-pack-groups">
                    <div>
                      <div class="amp-pack-group-head"><span>{{ t('skillManagerV2.agent.overview.active') }}</span><b>{{ appliedPacks.length }}</b></div>
                      <div v-if="appliedPacks.length" class="amp-pack-list">
                        <div v-for="pack in appliedPacks" :key="pack.id" class="amp-pack-row amp-pack-row--active">
                          <span><Check :size="13" /></span><div><strong>{{ pack.name }}</strong><small>{{ t('skillManagerV2.agent.overview.skillCount', { count: pack.memberCount }) }}</small></div><button type="button" :disabled="store.busyAction === 'remove-pack'" @click="handleRevokePack(pack.id)">{{ t('skillManagerV2.agent.overview.cancel') }}</button>
                        </div>
                      </div>
                      <div v-else class="amp-pack-empty">{{ t('skillManagerV2.agent.overview.noAppliedPacks') }}</div>
                    </div>
                    <div>
                      <div class="amp-pack-group-head"><span>{{ t('skillManagerV2.agent.overview.availablePacks') }}</span><b>{{ availablePacks.length }}</b></div>
                      <div v-if="availablePacks.length" class="amp-pack-list">
                        <div v-for="pack in availablePacks" :key="pack.id" class="amp-pack-row">
                          <span><Plus :size="13" /></span><div><strong>{{ pack.name }}</strong><small>{{ t('skillManagerV2.agent.overview.skillCount', { count: pack.memberCount }) }} · {{ t('skillManagerV2.agent.overview.agentUsage', { count: pack.appliedAgentCount }) }}</small></div><button type="button" :disabled="store.busyAction === 'apply-pack' || pack.memberCount === 0" @click="handleApplyPack(pack.id)">{{ t('skillManagerV2.agent.overview.apply') }}</button>
                        </div>
                      </div>
                      <div v-else class="amp-pack-empty">{{ t('skillManagerV2.agent.overview.noAvailablePacks') }}</div>
                    </div>
                  </div>
                </section>
                <section class="amp-overview-panel amp-overview-next">
                  <div class="amp-overview-panel-head"><div><h4>{{ t('skillManagerV2.agent.overview.next') }}</h4><p>{{ attentionCount ? t('skillManagerV2.agent.overview.nextHint') : t('skillManagerV2.agent.overview.noRequiredAction') }}</p></div><span v-if="attentionCount">{{ attentionCount }}</span></div>
                  <button v-if="unmanagedItems.length" type="button" class="amp-next-action" @click="openSection('skills')"><i class="warn" /><div><strong>{{ t('skillManagerV2.agent.overview.adoptAction', { count: unmanagedItems.length }) }}</strong><small>{{ t('skillManagerV2.agent.overview.adoptActionHint') }}</small></div><ArrowUpRight :size="14" /></button>
                  <button v-if="invalidMcpCount" type="button" class="amp-next-action" @click="openSection('mcp')"><i class="warn" /><div><strong>{{ t('skillManagerV2.agent.overview.fixMcp', { count: invalidMcpCount }) }}</strong><small>{{ t('skillManagerV2.agent.overview.fixMcpHint') }}</small></div><ArrowUpRight :size="14" /></button>
                  <div v-if="!attentionCount" class="amp-all-clear"><span><Check :size="13" /></span><div><strong>{{ t('skillManagerV2.agent.overview.readyAction') }}</strong><small>{{ t('skillManagerV2.agent.overview.readyActionHint') }}</small></div></div>
                </section>
              </div>
            </div>

            <!-- Skills Tab -->
            <div v-if="activeTab === 'skills'" class="amp-skills-tab">
              <section class="amp-skill-pack-banner">
                <div class="amp-skill-pack-banner-icon"><PackageOpen :size="18" /></div>
                <div><h4>{{ t('skillManagerV2.agent.overview.packTitle') }}</h4><p>{{ t('skillManagerV2.agent.skillsPage.packHint') }}</p></div>
                <span class="amp-skill-pack-count">{{ t('skillManagerV2.agent.skillsPage.packApplied', { applied: appliedPacks.length, total: appliedPacks.length + availablePacks.length }) }}</span>
                <div v-if="appliedPacks.length" class="amp-skill-pack-active">
                  <Check :size="16" /><div><strong>{{ appliedPacks[0].name }}</strong><small>{{ t('skillManagerV2.agent.overview.skillCount', { count: appliedPacks[0].memberCount }) }}</small></div><button type="button" @click="handleRevokePack(appliedPacks[0].id)">{{ t('skillManagerV2.agent.skillsPage.cancelApply') }}</button>
                </div>
              </section>
              <div class="amp-skill-switch-row">
                <div class="amp-segmented"><button type="button" :class="{ active: skillScope === 'agent' }" @click="skillScope = 'agent'">{{ t('skillManagerV2.agent.skillsPage.agentScope', { count: selectedAgent.skills.length - sharedSkills.length }) }}</button><button type="button" :disabled="!inheritsSharedSkills" :class="{ active: skillScope === 'shared' }" @click="skillScope = 'shared'">{{ t('skillManagerV2.agent.skillsPage.sharedScope', { count: sharedSkills.length }) }}</button></div>
                <div class="amp-segmented"><button type="button" :class="{ active: skillStatus === 'managed' }" @click="skillStatus = 'managed'">{{ t('skillManagerV2.agent.skillsPage.managed', { count: selectedAgent.skills.length }) }}</button><button type="button" :class="{ active: skillStatus === 'unmanaged' }" @click="skillStatus = 'unmanaged'">{{ t('skillManagerV2.agent.skillsPage.unmanaged', { count: unmanagedItems.length }) }}</button></div>
              </div>
              <div class="amp-skill-toolbar">
                <label><Search :size="15" /><input v-model="skillQuery" type="search" :placeholder="t('skillManagerV2.agent.skillsPage.search')" /></label>
                <div class="amp-skill-view-toggle"><button type="button" :class="{ active: skillsView === 'cards' }" title="卡片" @click="skillsView = 'cards'"><LayoutGrid :size="16" /></button><button type="button" :class="{ active: skillsView === 'list' }" title="列表" @click="skillsView = 'list'"><List :size="16" /></button></div>
              </div>
              <!-- Info Grid -->
              <div class="amp-info-grid">
                <div class="amp-info-cell">
                  <strong>{{ selectedAgent.version ?? '?' }}</strong>
                  <span>{{ t('skillManagerV2.agent.currentVersion') }}</span>
                </div>
                <div class="amp-info-cell">
                  <strong>{{ selectedAgent.skills.length }}</strong>
                  <span>{{ t('skillManagerV2.agent.totalSkills') }}</span>
                </div>
                <div class="amp-info-cell">
                  <strong>{{ selectedAgent.skills.filter((s: SkillTarget) => s.status === 'ok').length }}</strong>
                  <span>{{ t('skillManagerV2.agent.managedCount') }}</span>
                </div>
                <div class="amp-info-cell">
                  <strong>{{ selectedAgent.unmanaged.length }}</strong>
                  <span>{{ t('skillManagerV2.agent.unmanagedCount') }}</span>
                </div>
              </div>

              <!-- Skills Cards -->
              <div v-if="skillStatus === 'managed' && filteredAgentSkills.length > 0 && skillsView === 'cards'" class="amp-skill-grid">
                <article
                  v-for="target in filteredAgentSkills"
                  :key="target.id"
                  class="amp-skill-card"
                >
                  <div class="amp-skill-head">
                    <span class="amp-skill-icon">{{ getSkillGlyph(pathBasename(target.targetPath) || target.skillId) }}</span>
                    <div class="amp-skill-title">
                      <strong>{{ pathBasename(target.targetPath) || target.skillId }}</strong>
                      <span>{{ target.skillId }}</span>
                    </div>
                    <span class="amp-status-pill" :class="statusPillClass(target.status)">
                      {{ statusLabel(target.status) }}
                    </span>
                  </div>
                  <div class="amp-skill-meta">
                    <span class="amp-mode-pill" :class="modePillClass(target.actualMode)">
                      {{ target.actualMode === 'link'
                        ? t('skillManagerV2.settings.modeLink')
                        : t('skillManagerV2.settings.modeCopy') }}
                    </span>
                  </div>
                  <code :title="target.targetPath">{{ target.targetPath }}</code>
                </article>
              </div>

              <div v-else-if="skillStatus === 'managed' && filteredAgentSkills.length > 0" class="amp-skill-list-view">
                <button v-for="target in filteredAgentSkills" :key="target.id" type="button" class="amp-skill-list-row" @click="handleOpenDir(target.targetPath)"><span class="amp-skill-icon">{{ getSkillGlyph(pathBasename(target.targetPath) || target.skillId) }}</span><span><strong>{{ pathBasename(target.targetPath) || target.skillId }}</strong><small>{{ target.targetPath }}</small></span><span class="amp-status-pill" :class="statusPillClass(target.status)">{{ statusLabel(target.status) }}</span></button>
              </div>

              <!-- Unmanaged -->
              <div v-if="unmanagedItems.length > 0 && skillStatus === 'unmanaged'" class="amp-section">
                <h4 class="amp-section-title">
                  {{ t('skillManagerV2.agent.unmanagedSkills') }}
                  <span class="amp-count">({{ unmanagedItems.length }})</span>
                </h4>
                <div class="amp-skill-grid">
                  <article
                    v-for="item in unmanagedItems"
                    :key="item.id"
                    class="amp-skill-card unmanaged"
                  >
                    <div class="amp-skill-head">
                      <span class="amp-skill-icon">{{ getSkillGlyph(unmanagedName(item)) }}</span>
                      <div class="amp-skill-title">
                        <strong>{{ unmanagedName(item) }}</strong>
                        <span>{{ reasonLabel(item.reason) }}</span>
                      </div>
                      <span class="amp-status-pill unmanaged">{{ t('skillManagerV2.status.unmanaged') }}</span>
                    </div>
                    <code :title="item.path">{{ item.path }}</code>
                    <div class="amp-skill-actions">
                      <button class="amp-row-action" @click="handleAdopt(item)">
                        <Sparkles :size="14" />{{ t('skillManagerV2.agent.adopt') }}
                      </button>
                    </div>
                  </article>
                </div>
              </div>
            </div>

            <!-- Packs Tab -->
            <div v-if="activeTab === 'packs'" class="amp-packs-tab">
              <div v-if="appliedPacks.length === 0" class="amp-muted">
                {{ t('skillManagerV2.empty.noPacks') }}
              </div>
              <div v-else class="amp-data-list">
                <div v-for="pack in appliedPacks" :key="pack.id" class="amp-data-row">
                  <span class="amp-glyph sm">PK</span>
                  <div>
                    <strong>{{ pack.name }}</strong>
                    <span>{{ pack.memberCount }} skills</span>
                  </div>
                  <span class="amp-chip ok">{{ t('skillManagerV2.status.ok') }}</span>
                </div>
              </div>
            </div>

            <!-- Diagnostics Tab -->
            <div v-if="activeTab === 'diagnostics'" class="amp-diag-tab">
              <div v-if="healthIssues.length === 0" class="amp-muted">
                {{ t('skillManagerV2.empty.noIssues') }}
              </div>
              <div v-else class="amp-data-list">
                <div
                  v-for="issue in healthIssues"
                  :key="issue.id"
                  class="amp-data-row"
                >
                  <span class="amp-glyph sm" :class="severityClass(issue.severity)">
                    {{ issue.severity === 'error' ? '!' : issue.severity === 'warning' ? 'W' : 'i' }}
                  </span>
                  <div>
                    <strong>{{ issue.title }}</strong>
                    <span>{{ issue.detail }}</span>
                  </div>
                  <span class="amp-chip" :class="severityClass(issue.severity)">
                    {{ severityLabel(issue.severity) }}
                  </span>
                </div>
              </div>
            </div>

            <div v-if="activeTab === 'mcp'" class="amp-mcp-tab">
              <div v-if="mcpServers.length === 0" class="amp-muted">{{ t('skillManagerV2.agent.noMcp') }}</div>
              <div v-else class="amp-data-list">
                <div v-for="server in mcpServers" :key="server.name" class="amp-data-row">
                  <span class="amp-glyph sm">M</span>
                  <div><strong>{{ server.name }}</strong><span>{{ server.command || server.message }}</span></div>
                  <span class="amp-chip" :class="server.valid ? 'ok' : 'bad'">{{ server.valid ? t('skillManagerV2.status.ok') : t('skillManagerV2.status.conflict') }}</span>
                </div>
              </div>
            </div>

            <div v-if="activeTab === 'plugins'" class="amp-plugins-tab">
              <div v-if="plugins.length === 0" class="amp-muted">{{ t('skillManagerV2.agent.noPlugins') }}</div>
              <div v-else class="amp-data-list">
                <div v-for="plugin in plugins" :key="plugin.id" class="amp-data-row">
                  <span class="amp-glyph sm">P</span>
                  <div><strong>{{ plugin.name }}</strong><span>{{ plugin.source ?? '' }}{{ plugin.version ? ` · v${plugin.version}` : '' }}</span></div>
                  <span class="amp-chip" :class="plugin.enabled ? 'ok' : 'warn'">{{ plugin.enabled ? t('skillManagerV2.agent.enabled') : t('skillManagerV2.agent.disabled') }}</span>
                </div>
              </div>
            </div>

            <div v-if="activeTab === 'config'" class="amp-config-tab">
              <div class="amp-path-row"><span>Skills</span><code>{{ selectedAgent.skillsDir || '-' }}</code></div>
              <div class="amp-path-row"><span>Settings</span><code>{{ selectedAgent.configPath || '-' }}</code></div>
              <div class="amp-path-row"><span>Plugins</span><code>{{ selectedAgent.pluginDir || '-' }}</code></div>
            </div>
          </div>
        </template>

        <!-- No agent selected -->
        <div v-else class="amp-muted">
          {{ t('skillManagerV2.agent.selectAgent') }}
        </div>
      </section>
    </div>
    <AdoptDialog
      v-if="adoptItem && selectedAgent"
      visible
      :agent-id="selectedAgent.id"
      :unmanaged-id="adoptItem.id"
      :skill-path="adoptItem.path"
      @close="adoptItem = null"
      @adopted="handleAdopted"
    />
  </div>
</template>

<style scoped lang="scss">
.agent-page {
  height: 100%;
}

.amp-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
}

.amp-empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-muted);
}

.amp-layout {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  padding: 16px 20px;
  overflow: hidden;
}

// ── Side Panel ────────────────────────────────────────────────────

.amp-side-panel {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.amp-side-header {
  padding: 12px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-soft);
  flex-shrink: 0;

  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
  }
  p {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.4;
  }
}

.amp-side-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.amp-agent-group + .amp-agent-group {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
}

.amp-agent-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 7px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;

  b {
    min-width: 20px;
    padding: 2px 6px;
    border-radius: var(--radius-full);
    background: var(--surface-soft);
    text-align: center;
    font-size: 10px;
  }
}

.amp-list-menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.amp-list-item {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  padding: 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  text-align: left;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--border-default);
    background: var(--surface-soft);
  }
  &.active {
    border-color: var(--accent-primary-glow);
    background: var(--accent-primary-glow);
  }

  strong {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 600;
  }
  small {
    display: block;
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: 10px;
  }
}

.amp-chip {
  height: 20px;
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-full);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;

  &.ok {
    border-color: rgba(5, 150, 105, 0.2);
    background: rgba(5, 150, 105, 0.06);
    color: var(--success);
  }
  &.warn {
    border-color: rgba(217, 119, 6, 0.25);
    background: rgba(217, 119, 6, 0.06);
    color: var(--warning);
  }
  &.bad {
    border-color: rgba(220, 38, 38, 0.25);
    background: rgba(220, 38, 38, 0.06);
    color: var(--error);
  }
}

// ── Detail Panel ──────────────────────────────────────────────────

.amp-detail-panel {
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.amp-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  opacity: 0.5;
}

.amp-agent-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-soft);
  flex-shrink: 0;
}

.amp-shared-notice {
  margin: 0 16px 12px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--accent-primary) 35%, var(--border-default));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent-primary) 9%, var(--bg-elevated));
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.5;
}

.amp-agent-title {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 11px;
  align-items: center;
  min-width: 0;

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  p {
    margin: 4px 0 0;
    color: var(--text-muted);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
}

.amp-header-stats {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-wrap: wrap;

  span {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
    padding: 5px 8px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-full);
    background: var(--bg-elevated);
    color: var(--text-muted);
    font-size: 10px;
    white-space: nowrap;
  }

  strong { color: var(--text-primary); font-size: 13px; }
}

.amp-glyph {
  width: 38px;
  height: 38px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--surface-card);
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 800;
  flex-shrink: 0;

  &.sm {
    width: 26px;
    height: 26px;
    font-size: 10px;
    border-radius: var(--radius-sm);

    &.warn { background: rgba(217, 119, 6, 0.1); color: var(--warning); }
    &.bad { background: rgba(220, 38, 38, 0.1); color: var(--error); }
    &.ok { background: rgba(5, 150, 105, 0.1); color: var(--success); }
  }
}

.amp-header-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.amp-btn {
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }
  &.primary {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: #fff;

    &:hover:not(:disabled) {
      background: var(--accent-primary-hover);
    }
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.amp-row-action {
  height: 28px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 9px;
  border: 1px solid color-mix(in srgb, var(--accent-primary) 35%, var(--border-default));
  border-radius: var(--radius-sm);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;

  &:hover { background: color-mix(in srgb, var(--accent-primary) 15%, transparent); }
}

.spin { animation: amp-spin 900ms linear infinite; }
@keyframes amp-spin { to { transform: rotate(360deg); } }

// ── Tabs ──────────────────────────────────────────────────────────

.amp-tabs {
  display: flex;
  gap: 4px;
  padding: 10px 14px 0;
  border-bottom: 1px solid var(--border-subtle);
  overflow-x: auto;
  flex-shrink: 0;

  button {
    height: 28px;
    padding: 0 12px;
    border: 1px solid var(--border-default);
    border-bottom: none;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    background: var(--surface-soft);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      color: var(--text-primary);
      background: var(--bg-elevated);
    }

    &.active {
      border-color: var(--border-default);
      border-bottom-color: var(--bg-elevated);
      background: var(--bg-elevated);
      color: var(--accent-primary);
      font-weight: 700;
    }
  }
}

.amp-tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
}

// ── Info Grid ─────────────────────────────────────────────────────

.amp-info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}

.amp-info-cell {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);

  strong {
    display: block;
    font-size: 16px;
    font-weight: 700;
    font-family: var(--font-display);
    line-height: 1;
  }
  span {
    display: block;
    margin-top: 4px;
    color: var(--text-muted);
    font-size: 10px;
  }
}

// ── Data List ─────────────────────────────────────────────────────

.amp-data-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.amp-data-row {
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) auto;
  gap: 9px;
  align-items: center;
  padding: 9px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  font-size: 12px;
  min-width: 0;

  strong {
    display: block;
    font-size: 12px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  span {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
    overflow-wrap: anywhere;
  }
}

.amp-status-pill {
  min-width: 50px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;

  &.link { color: var(--accent-primary); background: rgba(13, 148, 136, 0.08); }
  &.copy { color: var(--accent-secondary); background: rgba(99, 102, 241, 0.08); }
  &.ok { color: var(--success); background: rgba(5, 150, 105, 0.08); }
  &.warn { color: var(--warning); background: rgba(217, 119, 6, 0.08); }
  &.bad { color: var(--error); background: rgba(220, 38, 38, 0.08); }
  &.unmanaged { color: var(--accent-tertiary); background: rgba(124, 58, 237, 0.08); }
  &.conflict { color: var(--error); background: rgba(220, 38, 38, 0.08); }
}

// ── Skill Cards ───────────────────────────────────────────────────

.amp-skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 10px;
}

.amp-skill-card {
  min-height: 96px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
  transition: border-color 0.16s, box-shadow 0.16s, transform 0.16s;

  &:hover {
    border-color: var(--border-strong);
    box-shadow: 0 8px 20px rgba(5, 10, 20, 0.08);
    transform: translateY(-1px);
  }

  &.unmanaged {
    border-color: rgba(217, 119, 6, 0.25);
    background: rgba(217, 119, 6, 0.04);
  }

  code {
    flex: 1;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    word-break: break-all;
    overflow-wrap: anywhere;
  }
}

.amp-skill-head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.amp-skill-icon {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 800;
}

.amp-skill-title {
  min-width: 0;
  flex: 1;

  strong {
    display: block;
    font-size: 12px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.amp-skill-meta {
  display: flex;
  gap: 6px;
}

.amp-mode-pill {
  height: 18px;
  display: inline-flex;
  align-items: center;
  padding: 0 7px;
  border-radius: var(--radius-full);
  font-size: 9px;
  font-weight: 700;

  &.link { color: var(--accent-primary); background: rgba(13, 148, 136, 0.08); }
  &.copy { color: var(--accent-secondary); background: rgba(99, 102, 241, 0.08); }
}

.amp-skill-actions {
  display: flex;
  justify-content: flex-end;
}

.amp-section {
  margin-top: 14px;
}

.amp-section-title {
  font-size: 12px;
  font-weight: 700;
  margin: 0 0 8px;
  color: var(--text-secondary);
}

.amp-count {
  font-weight: 400;
  color: var(--text-muted);
}

.amp-muted {
  font-size: 13px;
  color: var(--text-muted);
  padding: 40px 20px;
  text-align: center;
}

.amp-config-tab {
  display: grid;
  gap: 8px;
}

.amp-path-row {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  color: var(--text-muted);
  font-size: 11px;

  code {
    overflow-wrap: anywhere;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 11px;
  }
}

.amp-overview { display: grid; gap: 12px; padding-bottom: 8px; }
.amp-overview-status { --amp-signal: var(--success); display: grid; grid-template-columns: minmax(0, 1fr) 184px; gap: 14px; min-height: 102px; position: relative; overflow: hidden; border: 1px solid color-mix(in srgb, var(--amp-signal) 24%, var(--border-default)); border-radius: 12px; padding: 14px 15px 14px 18px; background: linear-gradient(115deg, color-mix(in srgb, var(--amp-signal) 7%, var(--bg-elevated)), var(--bg-elevated)); box-shadow: var(--shadow-sm); }
.amp-overview-status::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 4px; background: var(--amp-signal); }
.amp-overview-status--attention { --amp-signal: var(--warning); }
.amp-overview-status--danger { --amp-signal: var(--error); }
.amp-overview-status-copy { align-self: center; min-width: 0; }
.amp-overview-kicker { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; color: var(--amp-signal); font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.amp-overview-pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--amp-signal); box-shadow: 0 0 0 4px color-mix(in srgb, var(--amp-signal) 14%, transparent); }
.amp-overview-status h4 { margin: 0; font-size: 22px; line-height: 1.08; letter-spacing: -.03em; }
.amp-overview-status p { margin: 5px 0 0; color: var(--text-muted); font-size: 11px; line-height: 1.5; }
.amp-overview-readiness { z-index: 1; display: grid; align-content: center; gap: 7px; border: 1px solid color-mix(in srgb, var(--amp-signal) 18%, var(--border-default)); border-radius: 10px; padding: 9px 11px; background: color-mix(in srgb, var(--bg-elevated) 84%, var(--amp-signal) 16%); }
.amp-overview-readiness > div:first-child { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.amp-overview-readiness span { color: var(--text-muted); font-size: 10px; font-weight: 700; }
.amp-overview-readiness strong { font-size: 18px; font-variant-numeric: tabular-nums; }
.amp-overview-readiness strong small { margin-left: 2px; color: var(--text-muted); font-size: 10px; }
.amp-overview-track, .amp-capability-track { display: block; height: 4px; overflow: hidden; border-radius: var(--radius-full); background: color-mix(in srgb, var(--text-muted) 14%, transparent); }
.amp-overview-track > span, .amp-capability-track > span { display: block; height: 100%; border-radius: inherit; background: var(--amp-signal); transition: width .25s ease; }
.amp-overview-readiness button, .amp-overview-panel-head > button { display: inline-flex; align-items: center; gap: 3px; width: fit-content; border: 0; padding: 0; background: transparent; color: var(--amp-signal); font: inherit; font-size: 11px; font-weight: 800; cursor: pointer; }
.amp-overview-readiness button:hover, .amp-overview-panel-head > button:hover { text-decoration: underline; text-underline-offset: 3px; }
.amp-overview-section { display: grid; gap: 7px; }
.amp-overview-section-head, .amp-overview-panel-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
.amp-overview-section-head h4, .amp-overview-panel-head h4 { margin: 0; font-size: 13px; font-weight: 800; }
.amp-overview-section-head p, .amp-overview-panel-head p { margin: 3px 0 0; color: var(--text-muted); font-size: 10px; }
.amp-overview-section-head > span, .amp-overview-panel-head > span { border: 1px solid var(--border-default); border-radius: var(--radius-full); padding: 4px 8px; background: var(--surface-soft); color: var(--text-muted); font-size: 10px; font-weight: 700; white-space: nowrap; }
.amp-capability-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.amp-capability-card { --amp-cap: var(--accent-primary); --amp-cap-soft: color-mix(in srgb, var(--accent-primary) 10%, transparent); display: grid; min-width: 0; min-height: 104px; align-content: space-between; gap: 6px; position: relative; overflow: hidden; border: 1px solid var(--border-default); border-radius: 11px; padding: 10px 11px; background: linear-gradient(150deg, var(--amp-cap-soft), transparent 48%), var(--bg-elevated); color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; transition: border-color .16s, box-shadow .16s, transform .16s; }
.amp-capability-card:hover { border-color: color-mix(in srgb, var(--amp-cap) 38%, var(--border-default)); box-shadow: 0 8px 20px color-mix(in srgb, var(--amp-cap) 12%, transparent); transform: translateY(-1px); }
.amp-capability-card--green { --amp-cap: var(--success); --amp-cap-soft: color-mix(in srgb, var(--success) 9%, transparent); }
.amp-capability-card--amber { --amp-cap: var(--warning); --amp-cap-soft: color-mix(in srgb, var(--warning) 11%, transparent); }
.amp-capability-card--violet { --amp-cap: var(--accent-secondary); --amp-cap-soft: color-mix(in srgb, var(--accent-secondary) 10%, transparent); }
.amp-capability-label { display: flex; align-items: center; gap: 7px; color: var(--text-muted); font-size: 10px; font-weight: 800; }
.amp-capability-label i { display: grid; width: 19px; height: 19px; place-items: center; border-radius: 7px; background: var(--amp-cap-soft); color: var(--amp-cap); font-size: 10px; font-style: normal; font-weight: 900; }
.amp-capability-label svg { margin-left: auto; color: var(--amp-cap); }
.amp-capability-value { display: flex; align-items: baseline; gap: 6px; }
.amp-capability-value strong { font-size: 21px; font-variant-numeric: tabular-nums; line-height: 1; }
.amp-capability-value small, .amp-capability-detail { color: var(--text-muted); font-size: 10px; font-weight: 700; }
.amp-capability-detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amp-capability-track > span { background: var(--amp-cap); }
.amp-overview-lower { display: grid; grid-template-columns: minmax(0, 1.48fr) minmax(240px, .52fr); gap: 8px; }
.amp-overview-panel { min-width: 0; border: 1px solid var(--border-default); border-radius: 11px; padding: 11px; background: var(--bg-elevated); box-shadow: var(--shadow-sm); }
.amp-overview-panel-head { align-items: center; min-height: 28px; padding-bottom: 8px; border-bottom: 1px solid var(--border-default); }
.amp-overview-panel-head > button { color: var(--accent-primary); }
.amp-pack-groups { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding-top: 8px; }
.amp-pack-group-head { display: flex; align-items: center; justify-content: space-between; min-height: 20px; margin-bottom: 4px; padding: 0 2px; color: var(--text-muted); font-size: 9px; font-weight: 780; }
.amp-pack-group-head b { min-width: 18px; border-radius: var(--radius-full); padding: 2px 5px; background: var(--surface-soft); text-align: center; font-size: 9px; }
.amp-pack-list { display: grid; max-height: 142px; gap: 5px; overflow-y: auto; }
.amp-pack-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; min-height: 42px; align-items: center; gap: 7px; border: 1px solid var(--border-default); border-radius: 8px; padding: 5px 6px; background: var(--surface-soft); }
.amp-pack-row--active { border-color: color-mix(in srgb, var(--success) 23%, var(--border-default)); background: color-mix(in srgb, var(--success) 6%, var(--bg-elevated)); }
.amp-pack-row > span { display: grid; width: 22px; height: 22px; place-items: center; border-radius: 7px; background: var(--accent-primary-glow); color: var(--accent-primary); }
.amp-pack-row--active > span { background: color-mix(in srgb, var(--success) 12%, transparent); color: var(--success); }
.amp-pack-row strong, .amp-pack-row small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amp-pack-row strong { font-size: 10px; font-weight: 800; }
.amp-pack-row small { margin-top: 1px; color: var(--text-muted); font-size: 8px; }
.amp-pack-row > button { min-height: 25px; border: 1px solid color-mix(in srgb, var(--accent-primary) 22%, var(--border-default)); border-radius: 7px; padding: 3px 7px; background: var(--accent-primary-glow); color: var(--accent-primary); font: inherit; font-size: 9px; font-weight: 800; cursor: pointer; }
.amp-pack-row--active > button { border-color: color-mix(in srgb, var(--error) 18%, var(--border-default)); background: color-mix(in srgb, var(--error) 5%, transparent); color: var(--error); }
.amp-pack-row > button:disabled { opacity: .45; cursor: not-allowed; }
.amp-pack-empty { display: grid; min-height: 42px; place-items: center; border: 1px dashed var(--border-default); border-radius: 8px; color: var(--text-muted); font-size: 9px; }
.amp-next-action { display: flex; width: 100%; min-height: 34px; align-items: center; gap: 8px; border: 0; border-radius: 7px; padding: 5px; background: transparent; color: var(--text-primary); font: inherit; text-align: left; cursor: pointer; }
.amp-next-action:hover { background: var(--accent-primary-glow); }
.amp-next-action i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--accent-primary); box-shadow: 0 0 0 4px var(--accent-primary-glow); }
.amp-next-action i.warn { background: var(--warning); box-shadow: 0 0 0 4px color-mix(in srgb, var(--warning) 14%, transparent); }
.amp-next-action div { min-width: 0; }
.amp-next-action strong, .amp-next-action small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amp-next-action strong { font-size: 10px; font-weight: 800; }
.amp-next-action small { margin-top: 1px; color: var(--text-muted); font-size: 8px; }
.amp-next-action svg { margin-left: auto; color: var(--text-muted); }
.amp-all-clear { display: flex; min-height: 54px; align-items: center; gap: 8px; padding: 8px 5px 0; }
.amp-all-clear > span { display: grid; width: 24px; height: 24px; place-items: center; border-radius: 7px; background: color-mix(in srgb, var(--success) 13%, transparent); color: var(--success); }
.amp-all-clear strong, .amp-all-clear small { display: block; }
.amp-all-clear strong { font-size: 10px; }
.amp-all-clear small { margin-top: 2px; color: var(--text-muted); font-size: 8px; }
.amp-skill-pack-banner { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 10px; align-items: center; border: 1px solid color-mix(in srgb, var(--accent-primary) 20%, var(--border-default)); border-radius: 12px; padding: 10px 12px; background: linear-gradient(105deg, color-mix(in srgb, var(--accent-primary) 7%, var(--bg-elevated)), var(--bg-elevated)); }
.amp-skill-pack-banner-icon { display: grid; width: 34px; height: 34px; place-items: center; border-radius: 10px; background: var(--accent-primary-glow); color: var(--accent-primary); }
.amp-skill-pack-banner h4 { margin: 0; font-size: 14px; }
.amp-skill-pack-banner p { margin: 2px 0 0; color: var(--text-muted); font-size: 10px; }
.amp-skill-pack-count { border: 1px solid var(--border-default); border-radius: var(--radius-full); padding: 5px 8px; color: var(--text-muted); font-size: 10px; white-space: nowrap; }
.amp-skill-pack-active { grid-column: 1 / -1; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 8px; align-items: center; border: 1px solid color-mix(in srgb, var(--success) 30%, var(--border-default)); border-radius: 9px; padding: 8px 10px; background: color-mix(in srgb, var(--success) 7%, var(--bg-elevated)); color: var(--success); }
.amp-skill-pack-active > div { min-width: 0; }
.amp-skill-pack-active strong, .amp-skill-pack-active small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amp-skill-pack-active strong { color: var(--text-primary); font-size: 12px; }
.amp-skill-pack-active small { margin-top: 2px; color: var(--text-muted); font-size: 10px; }
.amp-skill-pack-active button { border: 1px solid color-mix(in srgb, var(--error) 23%, var(--border-default)); border-radius: 7px; padding: 5px 8px; background: color-mix(in srgb, var(--error) 5%, transparent); color: var(--error); font: inherit; font-size: 10px; font-weight: 700; cursor: pointer; }
.amp-skill-switch-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }
.amp-segmented { display: inline-flex; padding: 2px; border: 1px solid var(--border-default); border-radius: 9px; background: var(--surface-soft); }
.amp-segmented button { min-height: 30px; border: 0; border-radius: 7px; padding: 0 11px; background: transparent; color: var(--text-muted); font: inherit; font-size: 11px; font-weight: 700; cursor: pointer; }
.amp-segmented button.active { background: var(--accent-primary); color: var(--text-on-accent, #fff); box-shadow: 0 5px 12px color-mix(in srgb, var(--accent-primary) 20%, transparent); }
.amp-segmented button:disabled { opacity: .45; cursor: not-allowed; }
.amp-skill-toolbar { display: flex; gap: 8px; align-items: center; padding: 9px; border: 1px solid var(--border-default); border-radius: 10px; background: var(--surface-soft); }
.amp-skill-toolbar label { min-width: 0; flex: 1; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border: 1px solid var(--border-default); border-radius: 8px; background: var(--bg-elevated); color: var(--text-muted); }
.amp-skill-toolbar input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-primary); font: inherit; font-size: 12px; }
.amp-skill-view-toggle { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--border-default); border-radius: 8px; background: var(--bg-elevated); }
.amp-skill-view-toggle button { display: grid; width: 31px; height: 30px; place-items: center; border: 0; border-radius: 6px; background: transparent; color: var(--text-muted); cursor: pointer; }
.amp-skill-view-toggle button.active { background: var(--text-primary); color: var(--bg-primary); }
.amp-skill-list-view { display: grid; gap: 5px; }
.amp-skill-list-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; gap: 9px; align-items: center; width: 100%; border: 1px solid var(--border-default); border-radius: 9px; padding: 8px; background: var(--bg-elevated); text-align: left; cursor: pointer; }
.amp-skill-list-row:hover { border-color: var(--accent-primary); background: var(--surface-soft); }
.amp-skill-list-row > span:nth-child(2) { min-width: 0; }
.amp-skill-list-row strong, .amp-skill-list-row small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.amp-skill-list-row strong { font-size: 12px; }
.amp-skill-list-row small { margin-top: 2px; color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; }

@media (max-width: 920px) {
  .amp-layout { grid-template-columns: 220px minmax(0, 1fr); }
  .amp-capability-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .amp-overview-lower { grid-template-columns: 1fr; }
  .amp-chip { display: none; }
  .amp-list-item { grid-template-columns: 32px minmax(0, 1fr); }
  .amp-header-stats { width: 100%; margin-left: 0; }
}

@media (max-width: 680px) {
  .amp-layout { display: flex; flex-direction: column; overflow-y: auto; }
  .amp-side-panel { min-height: 180px; flex: 0 0 180px; }
  .amp-detail-panel { min-height: 420px; overflow: visible; }
  .amp-agent-header { align-items: stretch; flex-direction: column; }
  .amp-header-actions { justify-content: stretch; }
  .amp-header-actions .amp-btn { flex: 1; }
  .amp-overview-status { grid-template-columns: 1fr; }
  .amp-overview-readiness { grid-template-columns: minmax(0, 1fr) 110px auto; align-items: center; }
  .amp-pack-groups { grid-template-columns: 1fr; }
}
</style>
