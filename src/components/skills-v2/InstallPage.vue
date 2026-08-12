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
import { useSkillsStore } from '@/stores/skills'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import { api } from '@/services/electronAPI'
import ImportDialog from './ImportDialog.vue'
import type { AddCenterSkillInput } from '@/types/skillManagerV2'

const { t } = useI18n()
const skillsStore = useSkillsStore()
const store = useSkillManagerStore()

// ── State ─────────────────────────────────────────────────────────

const activeSubtab = ref<'local' | 'github' | 'marketplace'>('local')
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

// ── Computed ──────────────────────────────────────────────────────

const marketplaceSkills = computed(() => skillsStore.marketplaceSkills)
const hasMarketplaceResults = computed(() => marketplaceSkills.value.length > 0)

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
</script>

<template>
  <div class="ipm-page">
    <!-- Subtabs -->
    <div class="ipm-subtabs">
      <button
        :class="{ active: activeSubtab === 'local' }"
        @click="activeSubtab = 'local'"
      >
        {{ t('skillManagerV2.install.local') }}
      </button>
      <button
        :class="{ active: activeSubtab === 'github' }"
        @click="activeSubtab = 'github'"
      >
        {{ t('skillManagerV2.install.github') }}
      </button>
      <button
        :class="{ active: activeSubtab === 'marketplace' }"
        @click="activeSubtab = 'marketplace'"
      >
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

// ── Subtabs ───────────────────────────────────────────────────────

.ipm-subtabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--border-default);
  overflow-x: auto;
  flex-shrink: 0;

  button {
    height: 34px;
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
</style>
