<script setup lang="ts">
/**
 * Skill Manager V2 — Install Page
 *
 * Layout: subtab cards (Local / GitHub / Marketplace) + import flow.
 * The local import flow uses the existing ImportDialog component.
 * GitHub import clones a repo and imports via ImportDialog.
 * Marketplace uses the existing skills marketplace API.
 */

import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, FolderOpen, GitBranch, RefreshCw, Search, Sparkles, Store, UsersRound } from 'lucide-vue-next'
import { useSkillsStore } from '@/stores/skills'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import { api } from '@/services/electronAPI'
import ImportDialog from './ImportDialog.vue'
import MigrationWizard from './MigrationWizard.vue'
import AgentIconBadge from './AgentIconBadge.vue'
import type { AddCenterSkillInput } from '@/types/skillManagerV2'

const { t } = useI18n()
const skillsStore = useSkillsStore()
const store = useSkillManagerStore()

// ── State ─────────────────────────────────────────────────────────

const activeSubtab = ref<'marketplace' | 'sync' | 'local' | 'github'>('marketplace')
const importDialog = ref<InstanceType<typeof ImportDialog> | null>(null)

// GitHub state
const githubUrl = ref('')
const githubBranch = ref('')
const githubSubPath = ref('')
const githubCloning = ref(false)
const githubError = ref<string | null>(null)
const githubClonedPath = ref<string | null>(null)
const githubImporting = ref(false)
const githubImportError = ref<string | null>(null)
const githubImportSuccess = ref(false)

// Marketplace state
const marketplaceQuery = ref('')
const marketplaceSearching = ref(false)
const marketplaceError = ref<string | null>(null)
const installingSkillIds = ref<Set<string>>(new Set())
const installedSkillIds = ref<Set<string>>(new Set())

// Agent sync state
const syncLoading = ref(false)
const syncFilter = ref('')
const syncAgentFilter = ref('all')
const syncWizardVisible = ref(false)
const syncNotice = ref<string | null>(null)

// ── Computed ──────────────────────────────────────────────────────

const marketplaceSkills = computed(() => skillsStore.marketplaceSkills)
const hasMarketplaceResults = computed(() => marketplaceSkills.value.length > 0)
const syncItems = computed(() => {
  const query = syncFilter.value.trim().toLowerCase()
  return store.unmanaged.filter((item) => {
    if (syncAgentFilter.value !== 'all' && item.agentId !== syncAgentFilter.value) return false
    if (!query) return true
    return `${item.inferredSkillId ?? ''} ${item.path} ${item.reason}`.toLowerCase().includes(query)
  })
})
const syncAgentCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const item of store.unmanaged) {
    if (item.agentId) counts.set(item.agentId, (counts.get(item.agentId) ?? 0) + 1)
  }
  return counts
})
const syncAgents = computed(() => store.agents.filter((agent) => (syncAgentCounts.value.get(agent.id) ?? 0) > 0))

// ── Handlers ───────────────────────────────────────────────────────

function handleImportClick(): void {
  importDialog.value?.open()
}

function normalizeGithubUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  // owner/repo format → full URL
  if (!trimmed.startsWith('http') && !trimmed.startsWith('git@')) {
    return `https://github.com/${trimmed}`
  }
  return trimmed
}

async function handleGithubClone(): Promise<void> {
  if (!githubUrl.value.trim()) {
    githubError.value = t('skillManagerV2.install.githubUrlPlaceholder')
    return
  }

  githubCloning.value = true
  githubError.value = null
  githubClonedPath.value = null
  githubImportSuccess.value = false

  try {
    const url = normalizeGithubUrl(githubUrl.value)
    const sm = api.skillManagerV2
    if (!sm) {
      githubError.value = 'Skill Manager API not available'
      return
    }

    const result = await sm.cloneGitHubRepo(
      url,
      githubBranch.value.trim() || undefined,
      githubSubPath.value.trim() || undefined
    )

    if (result.success && result.localPath) {
      githubClonedPath.value = result.localPath
    } else {
      githubError.value = result.error || t('skillManagerV2.install.githubCloneFailed')
    }
  } catch (e) {
    githubError.value = e instanceof Error ? e.message : String(e)
  } finally {
    githubCloning.value = false
  }
}

async function handleGithubImport(): Promise<void> {
  if (!githubClonedPath.value) return

  githubImporting.value = true
  githubImportError.value = null

  try {
    const input: AddCenterSkillInput = {
      sourcePath: githubClonedPath.value,
      sourceType: 'github',
      sourceUri: normalizeGithubUrl(githubUrl.value),
    }

    const preview = await store.previewAddCenterSkill(input)
    if (!preview) {
      githubImportError.value = store.error || t('skillManagerV2.install.githubImportFailed')
      return
    }

    // Auto-resolve blockers with 'skip' default
    const decisions = preview.blockers.map((b) => ({
      skillId: b.skillId,
      resolution: 'skip' as const,
    }))

    const result = await store.executeAddCenterSkill(input, decisions)
    if (result) {
      githubImportSuccess.value = true
    } else {
      githubImportError.value = store.error || t('skillManagerV2.install.githubImportFailed')
    }
  } catch (e) {
    githubImportError.value = e instanceof Error ? e.message : String(e)
  } finally {
    githubImporting.value = false
  }
}

function handleGithubReset(): void {
  githubUrl.value = ''
  githubBranch.value = ''
  githubSubPath.value = ''
  githubClonedPath.value = null
  githubError.value = null
  githubImportError.value = null
  githubImportSuccess.value = false
}

async function handleMarketplaceSearch(): Promise<void> {
  if (!marketplaceQuery.value.trim()) return

  marketplaceSearching.value = true
  marketplaceError.value = null

  try {
    await skillsStore.searchMarketplace(marketplaceQuery.value.trim())
  } catch (e) {
    marketplaceError.value = e instanceof Error ? e.message : String(e)
  } finally {
    marketplaceSearching.value = false
  }
}

function handleMarketplaceSearchKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    handleMarketplaceSearch()
  }
}

function getMarketSkillId(skill: { id?: string; skillId?: string; name?: string }): string {
  return skill.id || skill.skillId || skill.name || ''
}

async function handleMarketplaceInstall(source: string, skillId: string): Promise<void> {
  const id = `${source}/${skillId}`
  installingSkillIds.value.add(id)

  try {
    const result = await skillsStore.installMarketplaceSkill(source, skillId, true)
    if (result.success) {
      installedSkillIds.value.add(id)
    }
  } catch (e) {
    console.error('Marketplace install failed:', e)
  } finally {
    installingSkillIds.value.delete(id)
  }
}

function isInstalling(source: string, skillId: string): boolean {
  return installingSkillIds.value.has(`${source}/${skillId}`)
}

function isInstalled(source: string, skillId: string): boolean {
  return installedSkillIds.value.has(`${source}/${skillId}`)
}

async function scanAllAgents(): Promise<void> {
  syncLoading.value = true
  syncNotice.value = null
  try {
    const agents = store.agents.filter((agent) => agent.enabled)
    for (const agent of agents) await store.scanAgentInventory(agent.id, false)
    await store.loadOverview()
    syncNotice.value = t('skillManagerV2.install.syncScanned', { count: store.unmanaged.length })
  } finally {
    syncLoading.value = false
  }
}

function agentBadge(agentId: string, agentName: string): { agentId: string; agentName: string; mode: 'link'; status: 'ok' } {
  return { agentId, agentName, mode: 'link', status: 'ok' }
}
</script>

<template>
  <div class="ipm-page">
    <!-- Subtabs -->
    <div class="ipm-subtabs">
      <button
        :class="{ active: activeSubtab === 'local' }"
        @click="activeSubtab = 'local'"
      >
        <FolderOpen :size="16" />
        {{ t('skillManagerV2.install.local') }}
      </button>
      <button
        :class="{ active: activeSubtab === 'sync' }"
        @click="activeSubtab = 'sync'"
      >
        <UsersRound :size="16" />
        {{ t('skillManagerV2.install.sync') }}
        <span v-if="store.metrics?.unmanagedCount" class="ipm-tab-count">{{ store.metrics.unmanagedCount }}</span>
      </button>
      <button
        :class="{ active: activeSubtab === 'github' }"
        @click="activeSubtab = 'github'"
      >
        <GitBranch :size="16" />
        {{ t('skillManagerV2.install.github') }}
      </button>
      <button
        :class="{ active: activeSubtab === 'marketplace' }"
        @click="activeSubtab = 'marketplace'"
      >
        <Store :size="16" />
        {{ t('skillManagerV2.install.marketplace') }}
      </button>
    </div>

    <!-- Content -->
    <div class="ipm-content">
      <!-- Local Import -->
      <div v-if="activeSubtab === 'local'" class="ipm-card">
        <div class="ipm-card-icon">SK</div>
        <h3 class="ipm-card-title">{{ t('skillManagerV2.install.localTitle') }}</h3>
        <p class="ipm-card-desc">{{ t('skillManagerV2.install.localDesc') }}</p>
        <button class="ipm-btn primary" @click="handleImportClick">
          {{ t('skillManagerV2.actions.importFolder') }}
        </button>
      </div>

      <!-- Agent sync -->
      <div v-else-if="activeSubtab === 'sync'" class="ipm-sync-panel">
        <div class="ipm-sync-hero">
          <div>
            <span class="ipm-eyebrow"><Sparkles :size="14" /> {{ t('skillManagerV2.install.syncEyebrow') }}</span>
            <h3>{{ t('skillManagerV2.install.syncTitle') }}</h3>
            <p>{{ t('skillManagerV2.install.syncDesc') }}</p>
          </div>
          <div class="ipm-sync-hero-actions">
            <button class="ipm-btn" :disabled="syncLoading" @click="scanAllAgents">
              <RefreshCw :size="15" :class="{ spin: syncLoading }" />
              {{ syncLoading ? t('skillManagerV2.install.syncScanning') : t('skillManagerV2.install.syncRescan') }}
            </button>
            <button class="ipm-btn primary" :disabled="syncItems.length === 0" @click="syncWizardVisible = true">
              <Check :size="15" />
              {{ t('skillManagerV2.install.syncOrganize', { count: syncItems.length }) }}
            </button>
          </div>
        </div>

        <div v-if="syncNotice" class="ipm-notice">{{ syncNotice }}</div>

        <div class="ipm-sync-summary">
          <div class="ipm-sync-stat"><strong>{{ syncItems.length }}</strong><span>{{ t('skillManagerV2.install.syncPending') }}</span></div>
          <div class="ipm-sync-stat"><strong>{{ syncAgents.length }}</strong><span>{{ t('skillManagerV2.install.syncAgentsFound') }}</span></div>
          <div class="ipm-sync-stat"><strong>{{ store.metrics?.agentTargetCount ?? 0 }}</strong><span>{{ t('skillManagerV2.install.syncManagedHidden') }}</span></div>
        </div>

        <div class="ipm-agent-strip" v-if="syncAgents.length > 0">
          <button class="ipm-agent-filter" :class="{ active: syncAgentFilter === 'all' }" @click="syncAgentFilter = 'all'">
            <span class="ipm-agent-filter-icon">Ag</span>
            <span><strong>{{ t('skillManagerV2.actions.allAgents') }}</strong><small>{{ store.unmanaged.length }} {{ t('skillManagerV2.install.syncPendingShort') }}</small></span>
          </button>
          <button v-for="agent in syncAgents" :key="agent.id" class="ipm-agent-filter" :class="{ active: syncAgentFilter === agent.id }" @click="syncAgentFilter = agent.id">
            <AgentIconBadge :badge="agentBadge(agent.id, agent.displayName)" :size="30" />
            <span><strong>{{ agent.displayName }}</strong><small>{{ syncAgentCounts.get(agent.id) }} {{ t('skillManagerV2.install.syncPendingShort') }}</small></span>
          </button>
        </div>

        <div class="ipm-sync-toolbar">
          <label class="ipm-search-wrap"><Search :size="16" /><input v-model="syncFilter" :placeholder="t('skillManagerV2.install.syncSearch')" /></label>
          <span class="ipm-sync-hint">{{ t('skillManagerV2.install.syncHint') }}</span>
        </div>

        <div v-if="syncItems.length === 0" class="ipm-sync-empty">
          <div class="ipm-sync-empty-icon"><Check :size="28" /></div>
          <strong>{{ t('skillManagerV2.install.syncEmptyTitle') }}</strong>
          <p>{{ t('skillManagerV2.install.syncEmptyDesc') }}</p>
        </div>
        <div v-else class="ipm-sync-grid">
          <article v-for="item in syncItems" :key="item.id" class="ipm-sync-card">
            <div class="ipm-sync-card-head">
              <AgentIconBadge v-if="item.agentId" :badge="agentBadge(item.agentId, store.agents.find((agent) => agent.id === item.agentId)?.displayName ?? item.agentId)" :size="32" />
              <div><strong>{{ item.inferredSkillId ?? item.id }}</strong><span>{{ store.agents.find((agent) => agent.id === item.agentId)?.displayName ?? item.agentId }}</span></div>
            </div>
            <p>{{ item.reason }}</p>
            <code>{{ item.path }}</code>
          </article>
        </div>
      </div>

      <!-- GitHub -->
      <div v-else-if="activeSubtab === 'github'" class="ipm-github-panel">
        <div class="ipm-panel-header">
          <div class="ipm-card-icon">GH</div>
          <div>
            <h3 class="ipm-card-title">{{ t('skillManagerV2.install.githubTitle') }}</h3>
            <p class="ipm-card-desc">{{ t('skillManagerV2.install.githubDesc') }}</p>
          </div>
        </div>

        <!-- Input Form -->
        <div v-if="!githubClonedPath && !githubImportSuccess" class="ipm-form">
          <div class="ipm-form-field">
            <label>{{ t('skillManagerV2.install.githubUrlLabel') }}</label>
            <input
              v-model="githubUrl"
              type="text"
              class="ipm-input"
              :placeholder="t('skillManagerV2.install.githubUrlPlaceholder')"
              :disabled="githubCloning"
              @keydown.enter="handleGithubClone"
            />
          </div>
          <div class="ipm-form-row">
            <div class="ipm-form-field">
              <label>{{ t('skillManagerV2.install.githubBranchLabel') }}</label>
              <input
                v-model="githubBranch"
                type="text"
                class="ipm-input"
                :placeholder="t('skillManagerV2.install.githubBranchPlaceholder')"
                :disabled="githubCloning"
              />
            </div>
            <div class="ipm-form-field">
              <label>{{ t('skillManagerV2.install.githubSubPathLabel') }}</label>
              <input
                v-model="githubSubPath"
                type="text"
                class="ipm-input"
                :placeholder="t('skillManagerV2.install.githubSubPathPlaceholder')"
                :disabled="githubCloning"
              />
            </div>
          </div>

          <div v-if="githubError" class="ipm-error">{{ githubError }}</div>

          <button
            class="ipm-btn primary"
            :disabled="githubCloning || !githubUrl.trim()"
            @click="handleGithubClone"
          >
            {{ githubCloning ? t('skillManagerV2.install.githubCloning') : t('skillManagerV2.install.githubCloneBtn') }}
          </button>
        </div>

        <!-- Cloned Preview -->
        <div v-else-if="githubClonedPath && !githubImportSuccess" class="ipm-clone-result">
          <div class="ipm-clone-success">
            {{ t('skillManagerV2.install.githubCloneSuccess') }}
          </div>
          <code class="ipm-clone-path">{{ githubClonedPath }}</code>

          <div v-if="githubImportError" class="ipm-error">{{ githubImportError }}</div>

          <div class="ipm-clone-actions">
            <button
              class="ipm-btn primary"
              :disabled="githubImporting"
              @click="handleGithubImport"
            >
              {{ githubImporting ? t('skillManagerV2.install.githubImporting') : t('skillManagerV2.install.githubImportBtn') }}
            </button>
            <button class="ipm-btn" @click="handleGithubReset">
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>

        <!-- Import Success -->
        <div v-else-if="githubImportSuccess" class="ipm-success">
          <div class="ipm-success-icon">✓</div>
          <p>{{ t('skillManagerV2.install.githubImportSuccess') }}</p>
          <button class="ipm-btn" @click="handleGithubReset">
            {{ t('skillManagerV2.install.githubCloneBtn') }}
          </button>
        </div>
      </div>

      <!-- Marketplace -->
      <div v-else class="ipm-marketplace-panel">
        <div class="ipm-panel-header">
          <div class="ipm-card-icon">MP</div>
          <div>
            <h3 class="ipm-card-title">{{ t('skillManagerV2.install.marketplaceTitle') }}</h3>
            <p class="ipm-card-desc">{{ t('skillManagerV2.install.marketplaceDesc') }}</p>
          </div>
        </div>

        <!-- Search Bar -->
        <div class="ipm-search-bar">
          <input
            v-model="marketplaceQuery"
            type="text"
            class="ipm-input"
            :placeholder="t('skillManagerV2.install.marketplaceSearchPlaceholder')"
            :disabled="marketplaceSearching"
            @keydown="handleMarketplaceSearchKeydown"
          />
          <button
            class="ipm-btn primary"
            :disabled="marketplaceSearching || !marketplaceQuery.trim()"
            @click="handleMarketplaceSearch"
          >
            {{ marketplaceSearching ? t('skillManagerV2.install.marketplaceSearching') : t('skillManagerV2.install.marketplaceSearchBtn') }}
          </button>
        </div>

        <div v-if="marketplaceError" class="ipm-error">{{ marketplaceError }}</div>

        <!-- Empty State -->
        <div v-if="!marketplaceSearching && !hasMarketplaceResults" class="ipm-market-empty">
          {{ t('skillManagerV2.install.marketplaceEmpty') }}
        </div>

        <!-- Searching State -->
        <div v-if="marketplaceSearching" class="ipm-market-loading">
          {{ t('skillManagerV2.install.marketplaceSearching') }}
        </div>

        <!-- Results Grid -->
        <div v-if="!marketplaceSearching && hasMarketplaceResults" class="ipm-market-grid">
          <div
            v-for="skill in marketplaceSkills"
            :key="getMarketSkillId(skill)"
            class="ipm-market-card"
          >
            <div class="ipm-market-card-head">
              <span class="ipm-market-glyph">{{ (skill.name || '?').slice(0, 2).toUpperCase() }}</span>
              <div class="ipm-market-card-info">
                <h4>{{ skill.name }}</h4>
                <span class="ipm-market-source">{{ skill.source }}</span>
              </div>
            </div>
            <p v-if="skill.installs !== undefined" class="ipm-market-installs">
              {{ skill.installs }} {{ t('skillManagerV2.install.marketplaceInstalls') }}
            </p>
            <div class="ipm-market-card-actions">
              <button
                v-if="isInstalled(skill.source, skill.skillId)"
                class="ipm-btn ipm-btn-installed"
                disabled
              >
                {{ t('skillManagerV2.install.marketplaceInstalled') }}
              </button>
              <button
                v-else
                class="ipm-btn primary"
                :disabled="isInstalling(skill.source, skill.skillId)"
                @click="handleMarketplaceInstall(skill.source, skill.skillId)"
              >
                {{ isInstalling(skill.source, skill.skillId)
                  ? t('skillManagerV2.install.marketplaceInstalling')
                  : t('skillManagerV2.install.marketplaceInstall') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Import Dialog -->
    <ImportDialog ref="importDialog" />
    <MigrationWizard :visible="syncWizardVisible" @close="syncWizardVisible = false" @completed="syncWizardVisible = false" />
  </div>
</template>

<style scoped lang="scss">
.ipm-page {
  height: 100%;
  overflow-y: auto;
  padding: 16px 20px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ipm-tab-count {
  min-width: 18px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--warning) 14%, transparent);
  color: var(--warning);
  font-size: 10px;
}

// ── Subtabs ───────────────────────────────────────────────────────

.ipm-subtabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--border-default);
  overflow-x: auto;
  flex-shrink: 0;

  button {
    height: 34px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 16px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      color: var(--text-primary);
    }
    &.active {
      color: var(--accent-primary);
      border-bottom-color: var(--accent-primary);
    }
  }
}

// ── Content ───────────────────────────────────────────────────────

.ipm-content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 8px;
}

.ipm-card {
  max-width: 420px;
  width: 100%;
  padding: 28px 24px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  text-align: center;
}

.ipm-card-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  margin: 0 auto 16px;
  border-radius: var(--radius-md);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-size: 16px;
  font-weight: 800;
}

.ipm-card-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  font-family: var(--font-display);
}

.ipm-card-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}

.ipm-btn {
  height: 36px;
  padding: 0 20px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 13px;
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

.ipm-btn-installed {
  border-color: rgba(5, 150, 105, 0.3);
  background: rgba(5, 150, 105, 0.08);
  color: var(--success);
}

// ── GitHub Panel ──────────────────────────────────────────────────

.ipm-github-panel {
  max-width: 560px;
  width: 100%;
  padding: 24px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
}

.ipm-panel-header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 20px;

  .ipm-card-icon {
    margin: 0;
    flex-shrink: 0;
  }

  .ipm-card-title {
    margin: 0;
  }

  .ipm-card-desc {
    margin: 4px 0 0;
  }
}

.ipm-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ipm-form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.ipm-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;

  label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }
}

.ipm-input {
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }

  &:disabled {
    opacity: 0.6;
  }
}

.ipm-error {
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  background: rgba(220, 38, 38, 0.08);
  color: var(--error);
  font-size: 12px;
}

.ipm-clone-result {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ipm-clone-success {
  font-size: 14px;
  font-weight: 600;
  color: var(--success);
}

.ipm-clone-path {
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  font-family: var(--font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.ipm-clone-actions {
  display: flex;
  gap: 8px;
}

.ipm-success {
  text-align: center;
  padding: 20px;

  .ipm-success-icon {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    margin: 0 auto 12px;
    border-radius: 50%;
    background: rgba(5, 150, 105, 0.12);
    color: var(--success);
    font-size: 24px;
    font-weight: 700;
  }

  p {
    margin: 0 0 16px;
    font-size: 14px;
    font-weight: 600;
  }
}

// ── Marketplace Panel ─────────────────────────────────────────────

.ipm-marketplace-panel {
  max-width: 800px;
  width: 100%;
  padding: 24px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
}

.ipm-search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;

  .ipm-input {
    flex: 1;
  }
}

.ipm-market-empty,
.ipm-market-loading {
  padding: 40px 20px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.ipm-market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.ipm-market-card {
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ipm-market-card-head {
  display: grid;
  grid-template-columns: 30px 1fr;
  gap: 9px;
  align-items: center;
  min-width: 0;
}

.ipm-market-glyph {
  width: 30px;
  height: 30px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 800;
  flex-shrink: 0;
}

.ipm-market-card-info {
  min-width: 0;

  h4 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 600;
  }
}

.ipm-market-source {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ipm-market-installs {
  margin: 0;
  color: var(--text-muted);
  font-size: 11px;
}

.ipm-market-card-actions {
  margin-top: auto;

  .ipm-btn {
    width: 100%;
    height: 30px;
    font-size: 12px;
    padding: 0 10px;
  }
}

// ── Agent Sync ────────────────────────────────────────────────────

.ipm-sync-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ipm-sync-hero {
  min-height: 112px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px;
  border: 1px solid color-mix(in srgb, var(--accent-primary) 24%, var(--border-default));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent-primary) 5%, var(--bg-elevated));

  h3 {
    margin: 6px 0 4px;
    font: 700 20px/1.2 var(--font-display);
    letter-spacing: 0;
  }

  p {
    max-width: 65ch;
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.55;
  }
}

.ipm-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 700;
}

.ipm-sync-hero-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.ipm-notice {
  padding: 9px 12px;
  border: 1px solid color-mix(in srgb, var(--success) 28%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--success) 7%, transparent);
  color: var(--success);
  font-size: 12px;
}

.ipm-sync-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  overflow: hidden;
}

.ipm-sync-stat {
  min-width: 0;
  padding: 14px 16px;
  border-right: 1px solid var(--border-default);

  &:last-child { border-right: 0; }

  strong {
    display: block;
    font: 700 22px/1 var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  span {
    display: block;
    margin-top: 6px;
    color: var(--text-muted);
    font-size: 11px;
  }
}

.ipm-agent-strip {
  display: flex;
  gap: 8px;
  padding: 8px;
  overflow-x: auto;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
}

.ipm-agent-filter {
  min-width: 148px;
  height: 54px;
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: 9px;
  align-items: center;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease;

  &:hover { background: var(--surface-soft); }
  &.active {
    border-color: color-mix(in srgb, var(--accent-primary) 42%, var(--border-default));
    background: var(--accent-primary-glow);
  }

  strong, small { display: block; }
  strong { font-size: 12px; }
  small { margin-top: 3px; color: var(--text-muted); font-size: 10px; }
}

.ipm-agent-filter-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent-primary) 12%, var(--bg-elevated));
  color: var(--accent-primary);
  font-size: 11px;
  font-weight: 800;
}

.ipm-sync-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ipm-search-wrap {
  width: min(360px, 100%);
  height: 34px;
  display: grid;
  grid-template-columns: 20px 1fr;
  align-items: center;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
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
    font: inherit;
    font-size: 12px;
  }
}

.ipm-sync-hint {
  color: var(--text-muted);
  font-size: 11px;
}

.ipm-sync-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 10px;
}

.ipm-sync-card {
  min-width: 0;
  padding: 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);

  p {
    min-height: 34px;
    margin: 10px 0 8px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.45;
  }

  code {
    display: block;
    overflow: hidden;
    color: var(--text-muted);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.ipm-sync-card-head {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 10px;
  align-items: center;

  strong, span { display: block; }
  strong { overflow: hidden; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  span { margin-top: 2px; color: var(--text-muted); font-size: 10px; }
}

.ipm-sync-empty {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-md);
  text-align: center;

  strong { margin-top: 10px; font-size: 14px; }
  p { margin: 5px 0 0; color: var(--text-muted); font-size: 12px; }
}

.ipm-sync-empty-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--success) 10%, transparent);
  color: var(--success);
}

.spin { animation: ipm-spin 900ms linear infinite; }
@keyframes ipm-spin { to { transform: rotate(360deg); } }

@media (max-width: 760px) {
  .ipm-sync-hero { align-items: stretch; flex-direction: column; }
  .ipm-sync-hero-actions { width: 100%; }
  .ipm-sync-hero-actions .ipm-btn { flex: 1; }
  .ipm-sync-toolbar { align-items: stretch; flex-direction: column; }
  .ipm-sync-summary { grid-template-columns: 1fr; }
  .ipm-sync-stat { border-right: 0; border-bottom: 1px solid var(--border-default); }
  .ipm-sync-stat:last-child { border-bottom: 0; }
}
</style>
