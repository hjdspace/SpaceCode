<script setup lang="ts">
/**
 * Skill Manager V2 — Skill Library Page
 *
 * Layout: status-strip metrics + toolbar + skill browser (cards/list) + inline inspector.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillSummary } from '@/types/skillManagerV2'
import AgentIconBadge from './AgentIconBadge.vue'
import PreviewDialog from './PreviewDialog.vue'
import {
  STATUS_LABEL_KEYS,
  STATUS_CSS_CLASSES,
  SOURCE_LABEL_KEYS,
  STATUS_FILTER_OPTIONS,
  SOURCE_FILTER_OPTIONS,
} from './skillLabels'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── Delete dialog state ────────────────────────────────────────────

const deletePreviewVisible = computed(() => store.busyAction === 'preview-delete')
const deleteBusy = computed(() => store.busyAction === 'delete-skill')
const deletePreviewTargets = computed(() => store.selectedSkillDetail?.targets ?? [])

// ── Inspector state ────────────────────────────────────────────────

const showInspector = computed(() => store.selectedSkillId !== null)
const detail = computed(() => store.selectedSkillDetail)
const detailLoading = computed(() => store.detailLoading)

const frontmatter = computed<Record<string, unknown> | null>(() => {
  if (!detail.value?.frontmatterJson) return null
  try {
    return JSON.parse(detail.value.frontmatterJson) as Record<string, unknown>
  } catch {
    return null
  }
})

const sourceLabel = computed(() => {
  if (!detail.value?.source) return null
  return t(SOURCE_LABEL_KEYS[detail.value.source.sourceType])
})

// ── Handlers ───────────────────────────────────────────────────────

function handleSkillClick(skill: SkillSummary): void {
  store.loadSkillDetail(skill.id)
}

function handleSearchInput(event: Event): void {
  const target = event.target as HTMLInputElement
  store.setSearchQuery(target.value)
}

function handleStatusFilter(event: Event): void {
  const target = event.target as HTMLSelectElement
  store.setStatusFilter(target.value || null)
}

function handleSourceFilter(event: Event): void {
  const target = event.target as HTMLSelectElement
  store.setSourceFilter(target.value || null)
}

function handleViewModeChange(mode: 'cards' | 'list'): void {
  store.setViewMode(mode)
}

async function handleOpenPath(): Promise<void> {
  if (!detail.value) return
  await store.openPath(detail.value.centerPath)
}

async function handleDeleteClick(): Promise<void> {
  if (!store.selectedSkillId) return
  store.busyAction = 'preview-delete'
}

async function handleDeleteConfirm(): Promise<void> {
  if (!store.selectedSkillId) return
  await store.executeDeleteSkill(store.selectedSkillId)
  store.busyAction = null
}

function handleDeleteCancel(): void {
  store.busyAction = null
}

function handleCloseInspector(): void {
  store.clearSelectedSkill()
}

function getSkillGlyph(name: string): string {
  const parts = name.replace(/[-_]/g, ' ').split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}
</script>

<template>
  <div class="slp-layout">
    <!-- Left: Skill Browser -->
    <div class="slp-browser-side">
      <!-- Status Strip -->
      <div class="slp-status-strip" v-if="store.metrics">
        <div class="slp-metric">
          <strong>{{ store.metrics.centerSkillCount }}</strong>
          <span>{{ t('skillManagerV2.metrics.centerSkills') }}</span>
        </div>
        <div class="slp-metric">
          <strong>{{ store.metrics.agentTargetCount }}</strong>
          <span>{{ t('skillManagerV2.metrics.agentTargets') }}</span>
        </div>
        <div class="slp-metric">
          <strong>{{ store.metrics.unmanagedCount }}</strong>
          <span>{{ t('skillManagerV2.metrics.unmanaged') }}</span>
        </div>
        <div class="slp-metric">
          <strong>{{ store.metrics.diagnosisIssueCount }}</strong>
          <span>{{ t('skillManagerV2.metrics.issues') }}</span>
        </div>
      </div>

      <!-- Toolbar -->
      <div class="slp-toolbar">
        <input
          class="slp-search"
          type="text"
          :placeholder="t('skillManagerV2.actions.search')"
          :value="store.filters.searchQuery"
          @input="handleSearchInput"
        />
        <select class="slp-filter" @change="handleStatusFilter">
          <option value="">{{ t('skillManagerV2.filter.allStatuses') }}</option>
          <option
            v-for="opt in STATUS_FILTER_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ t(opt.labelKey) }}
          </option>
        </select>
        <select class="slp-filter" @change="handleSourceFilter">
          <option value="">{{ t('skillManagerV2.filter.allSources') }}</option>
          <option
            v-for="opt in SOURCE_FILTER_OPTIONS"
            :key="opt.value"
            :value="opt.value"
          >
            {{ t(opt.labelKey) }}
          </option>
        </select>
        <div class="slp-view-toggle">
          <button
            :class="{ active: store.viewMode === 'cards' }"
            @click="handleViewModeChange('cards')"
          >
            {{ t('skillManagerV2.view.cards') }}
          </button>
          <button
            :class="{ active: store.viewMode === 'list' }"
            @click="handleViewModeChange('list')"
          >
            {{ t('skillManagerV2.view.list') }}
          </button>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="store.filteredSkills.length === 0" class="slp-empty">
        <p class="slp-empty-title">{{ t('skillManagerV2.empty.noSkills') }}</p>
        <p class="slp-empty-desc">{{ t('skillManagerV2.empty.noSkillsDesc') }}</p>
      </div>

      <!-- Cards View -->
      <div v-else-if="store.viewMode === 'cards'" class="slp-cards">
        <button
          v-for="skill in store.filteredSkills"
          :key="skill.id"
          class="slp-card"
          :class="{ active: store.selectedSkillId === skill.id }"
          @click="handleSkillClick(skill)"
        >
          <div class="slp-card-head">
            <span class="slp-glyph">{{ getSkillGlyph(skill.name) }}</span>
            <div class="slp-card-info">
              <h3>{{ skill.name }}</h3>
              <p>{{ skill.description }}</p>
            </div>
          </div>
          <div class="slp-card-meta">
            <span
              v-if="skill.sourceType"
              class="slp-chip"
              :class="skill.sourceType === 'github' || skill.sourceType === 'marketplace' ? 'ok' : ''"
            >
              {{ t(SOURCE_LABEL_KEYS[skill.sourceType]) }}
            </span>
            <span class="slp-chip">{{ skill.agentBadges.length }} Agents</span>
          </div>
          <div class="slp-agent-row">
            <AgentIconBadge
              v-for="badge in skill.agentBadges"
              :key="badge.agentId"
              :badge="badge"
            />
          </div>
        </button>
      </div>

      <!-- List View -->
      <div v-else class="slp-list-view">
        <table class="slp-list">
          <thead>
            <tr>
              <th>{{ t('skillManagerV2.list.name') }}</th>
              <th>{{ t('skillManagerV2.list.source') }}</th>
              <th>{{ t('skillManagerV2.list.status') }}</th>
              <th>{{ t('skillManagerV2.list.agents') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="skill in store.filteredSkills"
              :key="skill.id"
              class="slp-row"
              :class="{ active: store.selectedSkillId === skill.id }"
              @click="handleSkillClick(skill)"
            >
              <td class="slp-row-name">
                <span class="slp-glyph sm">{{ getSkillGlyph(skill.name) }}</span>
                {{ skill.name }}
              </td>
              <td class="slp-row-source">
                <span v-if="skill.sourceType">
                  {{ t(SOURCE_LABEL_KEYS[skill.sourceType]) }}
                </span>
                <span v-else>—</span>
              </td>
              <td>
                <span class="slp-status-pill" :class="STATUS_CSS_CLASSES[skill.status]">
                  {{ t(STATUS_LABEL_KEYS[skill.status]) }}
                </span>
              </td>
              <td>
                <div class="slp-agent-row">
                  <AgentIconBadge
                    v-for="badge in skill.agentBadges"
                    :key="badge.agentId"
                    :badge="badge"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Right: Inspector -->
    <aside class="slp-inspector" v-if="showInspector">
      <!-- Loading -->
      <div v-if="detailLoading" class="slp-insp-loading">
        {{ t('skillManagerV2.loading') }}
      </div>

      <!-- Content -->
      <template v-else-if="detail">
        <!-- Header -->
        <div class="slp-insp-header">
          <div class="slp-insp-title">
            <span class="slp-glyph">{{ getSkillGlyph(detail.name) }}</span>
            <div>
              <h3>{{ detail.name }}</h3>
              <p>{{ t('skillManagerV2.detail.agentTargets') }} · {{ detail.targets.length }}</p>
            </div>
          </div>
          <button class="slp-insp-close" @click="handleCloseInspector">×</button>
        </div>

        <div class="slp-insp-body">
          <!-- Description -->
          <div class="slp-panel">
            <div class="slp-panel-body">
              <p class="slp-insp-desc">{{ detail.description }}</p>
            </div>
          </div>

          <!-- Source & Center -->
          <div class="slp-panel">
            <div class="slp-panel-head">
              <strong>{{ t('skillManagerV2.detail.sourceAndCenter') }}</strong>
            </div>
            <div class="slp-panel-body">
              <dl class="slp-kv">
                <dt>{{ t('skillManagerV2.detail.centerPath') }}</dt>
                <dd>{{ detail.centerPath }}</dd>
              </dl>
              <dl class="slp-kv" v-if="detail.source">
                <dt>{{ t('skillManagerV2.detail.source') }}</dt>
                <dd>{{ sourceLabel }}</dd>
              </dl>
              <dl class="slp-kv" v-if="detail.source?.sourceUri">
                <dt>URI</dt>
                <dd>{{ detail.source.sourceUri }}</dd>
              </dl>
              <dl class="slp-kv">
                <dt>{{ t('skillManagerV2.detail.hash') }}</dt>
                <dd>{{ detail.currentHash.slice(0, 16) }}…</dd>
              </dl>
            </div>
          </div>

          <!-- Installed Agents -->
          <div class="slp-panel">
            <div class="slp-panel-head">
              <strong>{{ t('skillManagerV2.detail.installedAgents') }}</strong>
              <span class="slp-chip">{{ detail.targets.length }}</span>
            </div>
            <div class="slp-panel-body">
              <div v-if="detail.targets.length === 0" class="slp-insp-muted">
                {{ t('skillManagerV2.detail.noTargets') }}
              </div>
              <div v-else class="slp-claim-list">
                <div v-for="target in detail.targets" :key="target.id" class="slp-claim">
                  <div>
                    <strong>{{ target.agentId }}</strong>
                    <small>{{ target.targetPath }}</small>
                  </div>
                  <span
                    class="slp-status-pill"
                    :class="target.actualMode === 'link' ? 'link' : 'copy'"
                  >
                    {{ target.actualMode === 'link'
                      ? t('skillManagerV2.settings.modeLink')
                      : t('skillManagerV2.settings.modeCopy') }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Claims -->
          <div class="slp-panel" v-if="detail.claims.length > 0">
            <div class="slp-panel-head">
              <strong>{{ t('skillManagerV2.detail.claims') }}</strong>
            </div>
            <div class="slp-panel-body">
              <div class="slp-claim-list">
                <div v-for="claim in detail.claims" :key="claim.id" class="slp-claim">
                  <div>
                    <strong>{{ claim.claimType }}</strong>
                    <small v-if="claim.packId">pack: {{ claim.packId }}</small>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Frontmatter -->
          <div class="slp-panel" v-if="frontmatter">
            <div class="slp-panel-head">
              <strong>{{ t('skillManagerV2.detail.frontmatter') }}</strong>
            </div>
            <div class="slp-panel-body">
              <pre class="slp-code-block">{{ JSON.stringify(frontmatter, null, 2) }}</pre>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="slp-insp-footer">
          <button class="slp-btn primary" @click="handleOpenPath">
            {{ t('skillManagerV2.actions.openPath') }}
          </button>
          <button class="slp-btn danger" @click="handleDeleteClick">
            {{ t('skillManagerV2.actions.delete') }}
          </button>
        </div>
      </template>

      <!-- No selection -->
      <div v-else class="slp-insp-muted">
        {{ t('skillManagerV2.agent.selectAgent') }}
      </div>
    </aside>

    <!-- Delete Confirmation Dialog -->
    <PreviewDialog
      :visible="deletePreviewVisible"
      :title="t('skillManagerV2.delete.title')"
      :busy="deleteBusy"
      destructive
      :confirm-label="t('skillManagerV2.delete.confirm')"
      @confirm="handleDeleteConfirm"
      @cancel="handleDeleteCancel"
    >
      <p>{{ t('skillManagerV2.delete.warning') }}</p>
      <div v-if="deletePreviewTargets.length > 0" class="slp-delete-targets">
        <p class="slp-delete-targets-title">
          {{ t('skillManagerV2.delete.affectedTargets') }}:
        </p>
        <ul>
          <li v-for="target in deletePreviewTargets" :key="target.id">
            {{ target.agentId }} — {{ target.targetPath }}
          </li>
        </ul>
      </div>
      <p v-else class="slp-delete-no-targets">
        {{ t('skillManagerV2.delete.noTargets') }}
      </p>
    </PreviewDialog>
  </div>
</template>

<style scoped lang="scss">
.slp-layout {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  min-height: 0;
}

.slp-browser-side {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

// ── Status Strip ──────────────────────────────────────────────────

.slp-status-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.slp-metric {
  min-width: 0;
  min-height: 70px;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);

  strong {
    display: block;
    font-size: 20px;
    font-weight: 700;
    font-family: var(--font-display);
    line-height: 1;
  }
  span {
    display: block;
    margin-top: 5px;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.35;
  }
}

// ── Toolbar ───────────────────────────────────────────────────────

.slp-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.slp-search {
  flex: 1 1 160px;
  height: 34px;
  min-width: 0;
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px var(--accent-primary-glow);
  }
}

.slp-filter {
  height: 34px;
  padding: 0 28px 0 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}

.slp-view-toggle {
  height: 32px;
  display: inline-flex;
  align-items: center;
  padding: 3px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);

  button {
    height: 24px;
    min-width: 46px;
    padding: 0 8px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;

    &.active {
      background: var(--bg-elevated);
      color: var(--text-primary);
      box-shadow: var(--shadow-sm);
    }
  }
}

// ── Empty ─────────────────────────────────────────────────────────

.slp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;

  p { margin: 4px 0; }
}

.slp-empty-title {
  font-size: 15px;
  font-weight: 600;
}

.slp-empty-desc {
  font-size: 13px;
  color: var(--text-muted);
}

// ── Cards ─────────────────────────────────────────────────────────

.slp-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 10px;
}

.slp-card {
  min-width: 0;
  min-height: 150px;
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  text-align: left;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-sm);
  }
  &.active {
    border-color: var(--accent-primary-glow);
    background: var(--accent-primary-glow);
    box-shadow: inset 3px 0 0 var(--accent-primary);
  }
}

.slp-card-head {
  min-width: 0;
  display: grid;
  grid-template-columns: 30px 1fr;
  gap: 9px;
  align-items: center;
}

.slp-glyph {
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

  &.sm {
    width: 22px;
    height: 22px;
    font-size: 9px;
    display: inline-grid;
    vertical-align: middle;
    margin-right: 6px;
  }
}

.slp-card-info {
  min-width: 0;

  h3 {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 13px;
    font-weight: 600;
  }
  p {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 11px;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
}

.slp-card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.slp-agent-row {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

// ── Chips ─────────────────────────────────────────────────────────

.slp-chip {
  height: 20px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
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

// ── Status Pills ──────────────────────────────────────────────────

.slp-status-pill {
  min-width: 50px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 7px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;

  &.status-ok { color: var(--success); background: rgba(5, 150, 105, 0.08); }
  &.status-conflict,
  &.status-copy-diverged { color: var(--error); background: rgba(220, 38, 38, 0.08); }
  &.status-copy-outdated,
  &.status-copy-modified,
  &.status-broken-link,
  &.status-missing { color: var(--warning); background: rgba(217, 119, 6, 0.08); }
  &.status-unmanaged { color: var(--accent-tertiary); background: rgba(124, 58, 237, 0.08); }
}

// ── List View ─────────────────────────────────────────────────────

.slp-list-view {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  overflow: hidden;
}

.slp-list {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;

  th {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-default);
    font-weight: 700;
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-subtle);
  }
}

.slp-row {
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: var(--surface-soft);
  }
  &.active {
    background: var(--accent-primary-glow);
    box-shadow: inset 3px 0 0 var(--accent-primary);
  }
}

.slp-row-name {
  font-weight: 600;
}

.slp-row-source {
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 11px;
}

// ── Inspector ─────────────────────────────────────────────────────

.slp-inspector {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  border-left: 1px solid var(--border-default);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
}

.slp-insp-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  opacity: 0.5;
}

.slp-insp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.slp-insp-title {
  display: grid;
  grid-template-columns: 32px 1fr;
  gap: 10px;
  align-items: center;
  min-width: 0;

  h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  p {
    margin: 2px 0 0;
    color: var(--text-muted);
    font-size: 11px;
  }
}

.slp-insp-close {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    color: var(--text-primary);
    border-color: var(--border-strong);
  }
}

.slp-insp-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.slp-insp-desc {
  font-size: 13px;
  margin: 0;
  line-height: 1.5;
}

.slp-insp-muted {
  font-size: 13px;
  color: var(--text-muted);
  padding: 40px 20px;
  text-align: center;
}

// ── Panels ────────────────────────────────────────────────────────

.slp-panel {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  overflow: hidden;
}

.slp-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);

  strong {
    font-size: 12px;
    font-weight: 700;
  }
}

.slp-panel-body {
  padding: 12px;
}

.slp-kv {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 8px;
  align-items: start;
  padding: 6px 0;
  border-bottom: 1px solid var(--border-subtle);
  font-size: 12px;
  margin: 0;

  &:last-child {
    border-bottom: 0;
  }
  dt {
    color: var(--text-muted);
    font-weight: 600;
  }
  dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
}

.slp-claim-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slp-claim {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  font-size: 12px;

  strong {
    display: block;
    font-size: 12px;
    font-weight: 600;
  }
  small {
    display: block;
    margin-top: 2px;
    color: var(--text-muted);
    font-size: 10px;
    overflow-wrap: anywhere;
  }
}

.slp-code-block {
  font-size: 11px;
  font-family: var(--font-mono);
  background: var(--surface-soft);
  padding: 8px;
  border-radius: var(--radius-sm);
  overflow-x: auto;
  margin: 0;
  line-height: 1.4;
}

// ── Inspector Footer ──────────────────────────────────────────────

.slp-insp-footer {
  display: flex;
  gap: 6px;
  padding: 12px;
  border-top: 1px solid var(--border-default);
  flex-shrink: 0;
}

.slp-btn {
  flex: 1;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }

  &.primary {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: #fff;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }
  &.danger {
    border-color: rgba(220, 38, 38, 0.3);
    color: var(--error);
    background: rgba(220, 38, 38, 0.06);

    &:hover {
      background: rgba(220, 38, 38, 0.12);
    }
  }
}

// ── Delete dialog ─────────────────────────────────────────────────

.slp-delete-targets {
  margin-top: 8px;

  ul {
    margin: 4px 0;
    padding-left: 20px;
    font-size: 12px;
  }
}

.slp-delete-targets-title {
  font-weight: 600;
  margin: 4px 0;
}

.slp-delete-no-targets {
  color: var(--success);
  margin-top: 8px;
}
</style>
