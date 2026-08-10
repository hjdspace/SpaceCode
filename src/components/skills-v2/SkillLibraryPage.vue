<script setup lang="ts">
/**
 * Skill Manager V2 — Skill Library Page
 *
 * Card/list view of center library skills with search, filters, and detail access.
 * Reference: AgentBro `src/components/skills-v2/SkillLibraryPage.tsx`
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

async function handleOpenPath(skill: SkillSummary): Promise<void> {
  await store.openPath(skill.centerPath)
}

async function handleDeleteClick(): Promise<void> {
  if (!store.selectedSkillId) return
  // Preview is already loaded via the detail slider
  // Show the dialog
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
</script>

<template>
  <div class="skill-library-page">
    <!-- ── Toolbar ─────────────────────────────────────────────── -->
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

    <!-- ── Empty State ─────────────────────────────────────────── -->
    <div v-if="store.filteredSkills.length === 0" class="slp-empty">
      <p>{{ t('skillManagerV2.empty.noSkills') }}</p>
      <p class="slp-empty-desc">{{ t('skillManagerV2.empty.noSkillsDesc') }}</p>
    </div>

    <!-- ── Cards View ──────────────────────────────────────────── -->
    <div v-else-if="store.viewMode === 'cards'" class="slp-cards">
      <div
        v-for="skill in store.filteredSkills"
        :key="skill.id"
        class="slp-card"
        @click="handleSkillClick(skill)"
      >
        <div class="slp-card-header">
          <h3 class="slp-card-name">{{ skill.name }}</h3>
          <span
            class="slp-status-tag"
            :class="STATUS_CSS_CLASSES[skill.status]"
          >
            {{ t(STATUS_LABEL_KEYS[skill.status]) }}
          </span>
        </div>
        <p class="slp-card-desc">{{ skill.description }}</p>
        <div class="slp-card-footer">
          <span v-if="skill.sourceType" class="slp-source-tag">
            {{ t(SOURCE_LABEL_KEYS[skill.sourceType]) }}
          </span>
          <div class="slp-badges">
            <AgentIconBadge
              v-for="badge in skill.agentBadges"
              :key="badge.agentId"
              :badge="badge"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ── List View ───────────────────────────────────────────── -->
    <table v-else class="slp-list">
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
          @click="handleSkillClick(skill)"
        >
          <td class="slp-row-name">{{ skill.name }}</td>
          <td class="slp-row-source">
            <span v-if="skill.sourceType">
              {{ t(SOURCE_LABEL_KEYS[skill.sourceType]) }}
            </span>
            <span v-else>—</span>
          </td>
          <td>
            <span
              class="slp-status-tag"
              :class="STATUS_CSS_CLASSES[skill.status]"
            >
              {{ t(STATUS_LABEL_KEYS[skill.status]) }}
            </span>
          </td>
          <td>
            <div class="slp-badges">
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

    <!-- ── Delete Confirmation Dialog ─────────────────────────── -->
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
.skill-library-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 12px;
}

.slp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.slp-search {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  background: var(--bg-input, #252525);
  color: inherit;
  font-size: 13px;

  &:focus {
    border-color: var(--accent-color, #007acc);
    outline: none;
  }
}

.slp-filter {
  padding: 8px 12px;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  background: var(--bg-input, #252525);
  color: inherit;
  font-size: 13px;
}

.slp-view-toggle {
  display: flex;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  overflow: hidden;

  button {
    padding: 6px 12px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 12px;

    &.active {
      background: var(--bg-active, #094771);
      color: var(--text-active, #fff);
    }
  }
}

.slp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;

  p { margin: 4px 0; }
}

.slp-empty-desc {
  opacity: 0.6;
  font-size: 13px;
}

// ── Cards ──────────────────────────────────────────────────────────

.slp-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  overflow-y: auto;
}

.slp-card {
  padding: 14px;
  border: 1px solid var(--border-color, #333);
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 6px;

  &:hover {
    border-color: var(--accent-color, #007acc);
  }
}

.slp-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.slp-card-name {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slp-card-desc {
  font-size: 12px;
  opacity: 0.7;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.slp-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.slp-source-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-badge, #333);
  opacity: 0.8;
}

.slp-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

// ── Status tags ────────────────────────────────────────────────────

.slp-status-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;

  &.status-ok { background: rgba(76, 175, 80, 0.2); color: #4caf50; }
  &.status-conflict { background: rgba(244, 135, 113, 0.2); color: #f48771; }
  &.status-copy-diverged { background: rgba(244, 135, 113, 0.2); color: #f48771; }
  &.status-copy-outdated { background: rgba(204, 167, 0, 0.2); color: #cca700; }
  &.status-copy-modified { background: rgba(204, 167, 0, 0.2); color: #cca700; }
  &.status-broken-link { background: rgba(204, 167, 0, 0.2); color: #cca700; }
  &.status-missing { background: rgba(204, 167, 0, 0.2); color: #cca700; }
  &.status-unmanaged { background: rgba(117, 190, 255, 0.2); color: #75beff; }
}

// ── List ───────────────────────────────────────────────────────────

.slp-list {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;

  th {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color, #333);
    font-weight: 600;
    font-size: 12px;
    opacity: 0.7;
  }

  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color, #222);
  }
}

.slp-row {
  cursor: pointer;

  &:hover {
    background: var(--bg-hover, #2a2a2a);
  }
}

.slp-row-name {
  font-weight: 500;
}

// ── Delete dialog ──────────────────────────────────────────────────

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
  color: var(--success-color, #4caf50);
  margin-top: 8px;
}
</style>
