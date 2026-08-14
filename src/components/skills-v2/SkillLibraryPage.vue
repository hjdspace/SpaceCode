<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CheckSquare, Download, List, LayoutGrid, Search, X } from 'lucide-vue-next'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillSummary } from '@/types/skillManagerV2'
import DistributeDialog from './DistributeDialog.vue'
import PreviewDialog from './PreviewDialog.vue'
import {
  SOURCE_FILTER_OPTIONS,
  SOURCE_LABEL_KEYS,
  STATUS_FILTER_OPTIONS,
  STATUS_LABEL_KEYS,
  STATUS_CSS_CLASSES,
} from './skillLabels'

const { t } = useI18n()
const store = useSkillManagerStore()

const batchMode = ref(false)
const selectedSkillIds = ref<string[]>([])
const distributeVisible = ref(false)

const deletePreviewVisible = computed(() => store.busyAction === 'preview-delete')
const deleteBusy = computed(() => store.busyAction === 'delete-skill')
const allSelected = computed(() => store.filteredSkills.length > 0 && store.filteredSkills.every((skill) => selectedSkillIds.value.includes(skill.id)))
const selectedSkills = computed(() => store.skills.filter((skill) => selectedSkillIds.value.includes(skill.id)))

function getSkillGlyph(name: string): string {
  const parts = name.replace(/[-_]/g, ' ').split(/\s+/)
  return parts.length >= 2
    ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    : name.slice(0, 2).toUpperCase()
}

function handleSearchInput(event: Event): void {
  store.setSearchQuery((event.target as HTMLInputElement).value)
}

function handleStatusFilter(event: Event): void {
  store.setStatusFilter((event.target as HTMLSelectElement).value || null)
}

function handleSourceFilter(event: Event): void {
  store.setSourceFilter((event.target as HTMLSelectElement).value || null)
}

function handleSkillActivate(skill: SkillSummary): void {
  if (batchMode.value) {
    toggleSkill(skill.id)
    return
  }
  void store.loadSkillDetail(skill.id)
}

function toggleSkill(skillId: string): void {
  selectedSkillIds.value = selectedSkillIds.value.includes(skillId)
    ? selectedSkillIds.value.filter((id) => id !== skillId)
    : [...selectedSkillIds.value, skillId]
}

function toggleSelectAll(): void {
  selectedSkillIds.value = allSelected.value ? [] : store.filteredSkills.map((skill) => skill.id)
}

function clearSelection(): void {
  selectedSkillIds.value = []
}

function enterBatchMode(): void {
  batchMode.value = true
}

function leaveBatchMode(): void {
  batchMode.value = false
  clearSelection()
}

function openInstall(): void {
  store.setTab('install')
}

function openDistribution(): void {
  if (selectedSkillIds.value.length > 0) distributeVisible.value = true
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
  <div class="slp-page">
    <div class="slp-page-head">
      <div>
        <p class="slp-eyebrow">{{ t('skillManagerV2.metrics.centerSkills') }}</p>
        <h2>{{ t('skillManagerV2.viewTitle.library') }}</h2>
        <p class="slp-page-desc">{{ t('skillManagerV2.viewSubtitle.library') }}</p>
      </div>
      <div class="slp-head-actions">
        <button class="slp-btn slp-btn-primary" type="button" @click="openInstall">
          <Download :size="16" />{{ t('skillManagerV2.actions.install') }}
        </button>
        <button
          v-if="!batchMode"
          class="slp-btn"
          type="button"
          @click="enterBatchMode"
        >
          <CheckSquare :size="16" />{{ t('skillManagerV2.actions.batchManage') }}
        </button>
        <button v-else class="slp-btn" type="button" @click="leaveBatchMode">
          <X :size="16" />{{ t('skillManagerV2.actions.cancelBatch') }}
        </button>
      </div>
    </div>

    <div v-if="store.metrics" class="slp-status-strip">
      <div class="slp-metric"><strong>{{ store.metrics.centerSkillCount }}</strong><span>{{ t('skillManagerV2.metrics.centerSkills') }}</span></div>
      <div class="slp-metric"><strong>{{ store.metrics.agentTargetCount }}</strong><span>{{ t('skillManagerV2.metrics.agentTargets') }}</span></div>
      <div class="slp-metric"><strong>{{ store.metrics.unmanagedCount }}</strong><span>{{ t('skillManagerV2.metrics.unmanaged') }}</span></div>
      <div class="slp-metric"><strong>{{ store.metrics.diagnosisIssueCount }}</strong><span>{{ t('skillManagerV2.metrics.issues') }}</span></div>
    </div>

    <div class="slp-toolbar">
      <label class="slp-search-wrap">
        <Search :size="16" />
        <input
          type="search"
          :placeholder="t('skillManagerV2.actions.search')"
          :value="store.filters.searchQuery"
          @input="handleSearchInput"
        />
      </label>
      <select class="slp-filter" :value="store.filters.statusFilter ?? ''" @change="handleStatusFilter">
        <option value="">{{ t('skillManagerV2.filter.allStatuses') }}</option>
        <option v-for="opt in STATUS_FILTER_OPTIONS" :key="opt.value" :value="opt.value">{{ t(opt.labelKey) }}</option>
      </select>
      <select class="slp-filter" :value="store.filters.sourceFilter ?? ''" @change="handleSourceFilter">
        <option value="">{{ t('skillManagerV2.filter.allSources') }}</option>
        <option v-for="opt in SOURCE_FILTER_OPTIONS" :key="opt.value" :value="opt.value">{{ t(opt.labelKey) }}</option>
      </select>
      <div class="slp-view-toggle" role="group">
        <button type="button" :class="{ active: store.viewMode === 'cards' }" :title="t('skillManagerV2.view.cards')" @click="store.setViewMode('cards')"><LayoutGrid :size="16" /></button>
        <button type="button" :class="{ active: store.viewMode === 'list' }" :title="t('skillManagerV2.view.list')" @click="store.setViewMode('list')"><List :size="16" /></button>
      </div>
    </div>

    <div v-if="batchMode" class="slp-batch-bar">
      <div>
        <strong>{{ t('skillManagerV2.batch.selected', { count: selectedSkillIds.length }) }}</strong>
        <span>{{ t('skillManagerV2.batch.hint') }}</span>
      </div>
      <div class="slp-batch-actions">
        <button class="slp-btn" type="button" @click="toggleSelectAll">
          <Check :size="15" />{{ allSelected ? t('skillManagerV2.batch.clear') : t('skillManagerV2.batch.selectAll') }}
        </button>
        <button class="slp-btn" type="button" @click="clearSelection">{{ t('skillManagerV2.batch.clear') }}</button>
        <button class="slp-btn slp-btn-primary" type="button" :disabled="selectedSkillIds.length === 0" @click="openDistribution">
          {{ t('skillManagerV2.batch.distribute', { count: selectedSkillIds.length }) }}
        </button>
      </div>
    </div>

    <div v-if="store.filteredSkills.length === 0" class="slp-empty">
      <p class="slp-empty-title">{{ t('skillManagerV2.empty.noSkills') }}</p>
      <p class="slp-empty-desc">{{ t('skillManagerV2.empty.noSkillsDesc') }}</p>
    </div>

    <div v-else-if="store.viewMode === 'cards'" class="slp-cards">
      <article
        v-for="skill in store.filteredSkills"
        :key="skill.id"
        class="slp-card"
        :class="{ active: store.selectedSkillId === skill.id, selected: selectedSkillIds.includes(skill.id) }"
        tabindex="0"
        @click="handleSkillActivate(skill)"
        @keydown.enter="handleSkillActivate(skill)"
        @keydown.space.prevent="handleSkillActivate(skill)"
      >
        <div class="slp-card-head">
          <span class="slp-glyph">{{ getSkillGlyph(skill.name) }}</span>
          <div class="slp-card-info">
            <h3>{{ skill.name }}</h3>
            <p>{{ skill.description || t('skillManagerV2.empty.noDescription') }}</p>
          </div>
          <button v-if="batchMode" class="slp-select" type="button" :aria-label="skill.name" @click.stop="toggleSkill(skill.id)">
            <Check v-if="selectedSkillIds.includes(skill.id)" :size="16" />
          </button>
          <span v-else class="slp-health-dot" :class="STATUS_CSS_CLASSES[skill.status]" />
        </div>
        <div class="slp-card-meta">
          <span class="slp-status-pill" :class="STATUS_CSS_CLASSES[skill.status]">{{ t(STATUS_LABEL_KEYS[skill.status]) }}</span>
          <span v-if="skill.sourceType" class="slp-chip">{{ t(SOURCE_LABEL_KEYS[skill.sourceType]) }}</span>
          <span class="slp-chip">{{ skill.agentBadges.length }} {{ t('skillManagerV2.detail.agentTargets') }}</span>
        </div>
        <p class="slp-card-path">{{ skill.centerPath }}</p>
      </article>
    </div>

    <div v-else class="slp-list-view">
      <table class="slp-list">
        <thead><tr><th>{{ t('skillManagerV2.list.name') }}</th><th>{{ t('skillManagerV2.list.source') }}</th><th>{{ t('skillManagerV2.list.status') }}</th><th>{{ t('skillManagerV2.list.agents') }}</th></tr></thead>
        <tbody>
          <tr v-for="skill in store.filteredSkills" :key="skill.id" :class="{ active: store.selectedSkillId === skill.id, selected: selectedSkillIds.includes(skill.id) }" @click="handleSkillActivate(skill)">
            <td class="slp-row-name"><span v-if="batchMode" class="slp-list-check"><Check v-if="selectedSkillIds.includes(skill.id)" :size="13" /></span><span class="slp-glyph sm">{{ getSkillGlyph(skill.name) }}</span>{{ skill.name }}</td>
            <td>{{ skill.sourceType ? t(SOURCE_LABEL_KEYS[skill.sourceType]) : '—' }}</td>
            <td><span class="slp-status-pill" :class="STATUS_CSS_CLASSES[skill.status]">{{ t(STATUS_LABEL_KEYS[skill.status]) }}</span></td>
            <td>{{ skill.agentBadges.length }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <DistributeDialog
      :visible="distributeVisible"
      :skill-ids="selectedSkillIds"
      @close="distributeVisible = false"
      @distributed="leaveBatchMode"
    />

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
    </PreviewDialog>
  </div>
</template>

<style scoped lang="scss">
.slp-page { height: 100%; min-height: 0; overflow-y: auto; padding: 24px 28px 40px; color: var(--text-primary); }
.slp-page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-bottom: 22px; }
.slp-eyebrow { margin: 0 0 5px; color: var(--accent-primary); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.slp-page-head h2 { margin: 0; font-family: var(--font-display); font-size: 25px; line-height: 1.1; letter-spacing: -.02em; }
.slp-page-desc { margin: 7px 0 0; color: var(--text-muted); font-size: 13px; }
.slp-head-actions, .slp-batch-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.slp-btn { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 13px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-weight: 700; cursor: pointer; transition: border-color .18s, background .18s, transform .18s; }
.slp-btn:hover:not(:disabled) { border-color: var(--accent-primary); background: var(--bg-hover); transform: translateY(-1px); }
.slp-btn:disabled { cursor: not-allowed; opacity: .45; }
.slp-btn-primary { border-color: transparent; background: var(--accent-primary); color: var(--text-on-accent, #fff); box-shadow: 0 8px 18px color-mix(in srgb, var(--accent-primary) 22%, transparent); }
.slp-status-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.slp-metric { min-height: 82px; padding: 16px 17px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: color-mix(in srgb, var(--bg-elevated) 92%, var(--accent-primary) 8%); }
.slp-metric strong { display: block; font-family: var(--font-display); font-size: 25px; font-variant-numeric: tabular-nums; line-height: 1; }
.slp-metric span { display: block; margin-top: 8px; color: var(--text-muted); font-size: 11px; }
.slp-toolbar { display: flex; gap: 9px; align-items: center; padding: 10px; margin-bottom: 14px; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }
.slp-search-wrap { height: 40px; min-width: 180px; flex: 1; display: flex; align-items: center; gap: 9px; padding: 0 12px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); color: var(--text-muted); }
.slp-search-wrap input { width: 100%; border: 0; outline: 0; background: transparent; color: var(--text-primary); font-size: 13px; }
.slp-filter { height: 40px; min-width: 130px; padding: 0 28px 0 11px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; }
.slp-view-toggle { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid var(--border-default); border-radius: var(--radius-sm); background: var(--surface-soft); }
.slp-view-toggle button { width: 34px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 5px; background: transparent; color: var(--text-muted); cursor: pointer; }
.slp-view-toggle button.active { background: var(--bg-elevated); color: var(--text-primary); box-shadow: var(--shadow-sm); }
.slp-batch-bar { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 14px 16px; margin-bottom: 14px; border: 1px solid color-mix(in srgb, var(--accent-primary) 32%, var(--border-default)); border-radius: var(--radius-md); background: color-mix(in srgb, var(--accent-primary-glow) 74%, var(--bg-elevated)); }
.slp-batch-bar strong, .slp-batch-bar span { display: block; }
.slp-batch-bar strong { font-size: 14px; }
.slp-batch-bar span { margin-top: 3px; color: var(--text-muted); font-size: 11px; }
.slp-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; padding-bottom: 12px; }
.slp-card { position: relative; min-height: 196px; display: flex; flex-direction: column; gap: 15px; padding: 18px; border: 1px solid var(--border-default); border-radius: 12px; background: var(--bg-elevated); text-align: left; cursor: pointer; transition: transform .18s, border-color .18s, box-shadow .18s; }
.slp-card:hover, .slp-card:focus-visible { border-color: color-mix(in srgb, var(--accent-primary) 48%, var(--border-default)); box-shadow: 0 12px 28px color-mix(in srgb, var(--accent-primary) 12%, transparent); outline: none; transform: translateY(-2px); }
.slp-card.active, .slp-card.selected { border-color: var(--accent-primary); box-shadow: inset 3px 0 0 var(--accent-primary); }
.slp-card-head { min-width: 0; display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; gap: 12px; align-items: start; }
.slp-glyph { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 11px; background: var(--text-primary); color: var(--bg-primary); font-size: 14px; font-weight: 800; }
.slp-glyph.sm { width: 28px; height: 28px; border-radius: 8px; font-size: 10px; }
.slp-card-info { min-width: 0; }
.slp-card-info h3 { margin: 1px 0 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-display); font-size: 16px; font-weight: 750; }
.slp-card-info p { display: -webkit-box; margin: 7px 0 0; overflow: hidden; color: var(--text-secondary); font-size: 12px; line-height: 1.55; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.slp-health-dot { width: 9px; height: 9px; margin-top: 7px; border-radius: 50%; background: var(--success); box-shadow: 0 0 0 5px color-mix(in srgb, var(--success) 14%, transparent); }
.slp-health-dot.warn, .slp-health-dot.bad { background: var(--warning); }
.slp-select { width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg-elevated); color: var(--text-on-accent, #fff); cursor: pointer; }
.slp-card.selected .slp-select { border-color: var(--accent-primary); background: var(--accent-primary); }
.slp-card-meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: auto; }
.slp-chip, .slp-status-pill { min-height: 22px; display: inline-flex; align-items: center; padding: 0 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
.slp-chip { background: var(--surface-soft); color: var(--text-muted); }
.slp-status-pill.ok { background: color-mix(in srgb, var(--success) 13%, transparent); color: var(--success); }
.slp-status-pill.warn, .slp-status-pill.unmanaged, .slp-status-pill.copy_outdated, .slp-status-pill.copy_modified, .slp-status-pill.copy_diverged { background: color-mix(in srgb, var(--warning) 14%, transparent); color: var(--warning); }
.slp-status-pill.bad, .slp-status-pill.conflict, .slp-status-pill.broken_link, .slp-status-pill.missing { background: color-mix(in srgb, var(--error) 13%, transparent); color: var(--error); }
.slp-card-path { margin: 0; overflow: hidden; color: var(--text-muted); font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.slp-list-view { overflow: hidden; border: 1px solid var(--border-default); border-radius: var(--radius-md); background: var(--bg-elevated); }
.slp-list { width: 100%; border-collapse: collapse; font-size: 12px; }
.slp-list th { padding: 11px 14px; border-bottom: 1px solid var(--border-default); color: var(--text-muted); text-align: left; font-size: 10px; }
.slp-list td { padding: 12px 14px; border-bottom: 1px solid var(--border-default); color: var(--text-secondary); }
.slp-list tr { cursor: pointer; transition: background .15s; }
.slp-list tr:hover, .slp-list tr.active { background: var(--bg-hover); }
.slp-row-name { color: var(--text-primary) !important; font-weight: 700; }.slp-list-check { width: 20px; height: 20px; display: inline-grid; place-items: center; margin-right: 8px; border: 1px solid var(--border-strong); border-radius: 5px; color: var(--text-on-accent, #fff); vertical-align: middle; }.slp-list tr.selected .slp-list-check { border-color: var(--accent-primary); background: var(--accent-primary); }
.slp-empty { display: grid; place-items: center; min-height: 260px; text-align: center; }
.slp-empty p { margin: 5px 0; }
.slp-empty-title { font-size: 16px; font-weight: 700; }
.slp-empty-desc { color: var(--text-muted); font-size: 12px; }
@media (max-width: 820px) { .slp-page { padding: 18px 16px 32px; } .slp-page-head, .slp-batch-bar { flex-direction: column; align-items: stretch; } .slp-head-actions, .slp-batch-actions { justify-content: stretch; } .slp-head-actions .slp-btn, .slp-batch-actions .slp-btn { flex: 1; } .slp-status-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } .slp-toolbar { flex-wrap: wrap; } .slp-search-wrap { flex-basis: 100%; } }
@media (max-width: 520px) { .slp-status-strip { gap: 8px; } .slp-metric { min-height: 70px; padding: 12px; } .slp-cards { grid-template-columns: 1fr; } .slp-filter { flex: 1; min-width: 0; } }
</style>
