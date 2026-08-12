<script setup lang="ts">
/**
 * Skill Manager V2 — Diagnosis Page
 *
 * Layout: action bar + diagnostic-card grid.
 */

import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { DiagnosisIssue, FixKind } from '@/types/skillManagerV2'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── Computed ───────────────────────────────────────────────────────

const issues = computed<DiagnosisIssue[]>(() => {
  return store.diagnosisIssues.length > 0
    ? store.diagnosisIssues
    : store.issues
})

const errorCount = computed(() => issues.value.filter((i) => i.severity === 'error').length)
const warningCount = computed(() => issues.value.filter((i) => i.severity === 'warning').length)
const infoCount = computed(() => issues.value.filter((i) => i.severity === 'info').length)

const hasIssues = computed(() => issues.value.length > 0)
const loading = computed(() => store.diagnosisLoading)
const fixing = computed(() => store.busyAction === 'safe-fixes')
const safeFixResult = computed(() => store.safeFixResult)

// ── Lifecycle ─────────────────────────────────────────────────────

onMounted(() => {
  if (issues.value.length === 0 && !loading.value) {
    store.runDiagnosis()
  }
})

// ── Handlers ───────────────────────────────────────────────────────

async function handleRunScan(): Promise<void> {
  await store.runDiagnosis()
}

async function handleSafeFixes(): Promise<void> {
  await store.executeSafeFixes()
}

// ── Helpers ────────────────────────────────────────────────────────

function severityClass(severity: string): string {
  return severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info'
}

function severityLabel(severity: string): string {
  const map: Record<string, string> = {
    error: t('skillManagerV2.diagnosis.severityError'),
    warning: t('skillManagerV2.diagnosis.severityWarning'),
    info: t('skillManagerV2.diagnosis.severityInfo'),
  }
  return map[severity] ?? severity
}

function fixKindLabel(fixKind: FixKind): string {
  const map: Record<FixKind, string> = {
    auto: t('skillManagerV2.diagnosis.fixAuto'),
    confirm: t('skillManagerV2.diagnosis.fixConfirm'),
    manual: t('skillManagerV2.diagnosis.fixManual'),
    info: t('skillManagerV2.diagnosis.fixInfo'),
  }
  return map[fixKind] ?? fixKind
}

function fixKindClass(fixKind: FixKind): string {
  const map: Record<FixKind, string> = {
    auto: 'auto',
    confirm: 'confirm',
    manual: 'manual',
    info: 'info',
  }
  return map[fixKind] ?? 'info'
}
</script>

<template>
  <div class="dxp-page">
    <!-- Action Bar -->
    <div class="dxp-action-bar">
      <div class="dxp-summary">
        <span class="dxp-summary-item error" v-if="errorCount > 0">
          {{ errorCount }} {{ t('skillManagerV2.diagnosis.severityError') }}
        </span>
        <span class="dxp-summary-item warning" v-if="warningCount > 0">
          {{ warningCount }} {{ t('skillManagerV2.diagnosis.severityWarning') }}
        </span>
        <span class="dxp-summary-item info" v-if="infoCount > 0">
          {{ infoCount }} {{ t('skillManagerV2.diagnosis.severityInfo') }}
        </span>
        <span v-if="!hasIssues && !loading" class="dxp-all-clear">
          {{ t('skillManagerV2.empty.noIssues') }}
        </span>
      </div>
      <div class="dxp-actions">
        <button
          class="dxp-btn"
          :disabled="loading"
          @click="handleRunScan"
        >
          {{ loading ? t('skillManagerV2.diagnosis.scanning') : t('skillManagerV2.diagnosis.runScan') }}
        </button>
        <button
          class="dxp-btn primary"
          :disabled="fixing || !hasIssues"
          @click="handleSafeFixes"
        >
          {{ fixing ? t('common.loading') : t('skillManagerV2.diagnosis.safeFixes') }}
        </button>
      </div>
    </div>

    <!-- Safe Fix Result -->
    <div v-if="safeFixResult" class="dxp-fix-result">
      {{ t('skillManagerV2.diagnosis.fixedCount', { count: safeFixResult.fixedCount }) }}
    </div>

    <!-- Loading -->
    <div v-if="loading && !hasIssues" class="dxp-loading">
      {{ t('skillManagerV2.diagnosis.scanning') }}
    </div>

    <!-- Empty State -->
    <div v-else-if="!hasIssues" class="dxp-empty">
      <p class="dxp-empty-title">{{ t('skillManagerV2.empty.noIssues') }}</p>
      <p class="dxp-empty-desc">{{ t('skillManagerV2.empty.noIssuesDesc') }}</p>
    </div>

    <!-- Issue Cards Grid -->
    <div v-else class="dxp-grid">
      <div
        v-for="issue in issues"
        :key="issue.id"
        class="dxp-card"
        :class="severityClass(issue.severity)"
      >
        <div class="dxp-card-head">
          <span class="dxp-sev-badge" :class="severityClass(issue.severity)">
            {{ issue.severity === 'error' ? '!' : issue.severity === 'warning' ? 'W' : 'i' }}
          </span>
          <h3 class="dxp-card-title">{{ issue.title }}</h3>
        </div>
        <p class="dxp-card-detail">{{ issue.detail }}</p>
        <div class="dxp-card-meta">
          <span class="dxp-meta-item">
            <small>{{ t('skillManagerV2.list.status') }}</small>
            {{ severityLabel(issue.severity) }}
          </span>
          <span class="dxp-meta-item">
            <small>{{ t('skillManagerV2.detail.source') }}</small>
            {{ issue.entityType }}
          </span>
          <span class="dxp-meta-item">
            <small>{{ t('skillManagerV2.detail.manage') }}</small>
            <span class="dxp-fix-badge" :class="fixKindClass(issue.fixKind)">
              {{ fixKindLabel(issue.fixKind) }}
            </span>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dxp-page {
  height: 100%;
  overflow-y: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

// ── Action Bar ────────────────────────────────────────────────────

.dxp-action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.dxp-summary {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.dxp-summary-item {
  height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 600;

  &.error {
    background: rgba(220, 38, 38, 0.08);
    color: var(--error);
  }
  &.warning {
    background: rgba(217, 119, 6, 0.08);
    color: var(--warning);
  }
  &.info {
    background: rgba(59, 130, 246, 0.08);
    color: var(--info);
  }
}

.dxp-all-clear {
  height: 24px;
  display: inline-flex;
  align-items: center;
  padding: 0 10px;
  border-radius: var(--radius-full);
  background: rgba(5, 150, 105, 0.08);
  color: var(--success);
  font-size: 12px;
  font-weight: 600;
}

.dxp-actions {
  display: flex;
  gap: 8px;
}

.dxp-btn {
  height: 32px;
  padding: 0 14px;
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

// ── Fix Result ────────────────────────────────────────────────────

.dxp-fix-result {
  padding: 10px 14px;
  border: 1px solid rgba(5, 150, 105, 0.2);
  border-radius: var(--radius-md);
  background: rgba(5, 150, 105, 0.06);
  color: var(--success);
  font-size: 13px;
  font-weight: 600;
}

// ── Loading / Empty ───────────────────────────────────────────────

.dxp-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  opacity: 0.5;
}

.dxp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;

  p { margin: 4px 0; }
}

.dxp-empty-title {
  font-size: 15px;
  font-weight: 600;
}

.dxp-empty-desc {
  font-size: 13px;
  color: var(--text-muted);
}

// ── Issue Cards Grid ──────────────────────────────────────────────

.dxp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}

.dxp-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  transition: box-shadow 0.15s;

  &:hover {
    box-shadow: var(--shadow-sm);
  }

  &.error {
    border-left: 3px solid var(--error);
  }
  &.warning {
    border-left: 3px solid var(--warning);
  }
  &.info {
    border-left: 3px solid var(--info);
  }
}

.dxp-card-head {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 9px;
  align-items: center;
  margin-bottom: 8px;
}

.dxp-sev-badge {
  width: 24px;
  height: 24px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-full);
  font-size: 12px;
  font-weight: 800;

  &.error {
    background: rgba(220, 38, 38, 0.1);
    color: var(--error);
  }
  &.warning {
    background: rgba(217, 119, 6, 0.1);
    color: var(--warning);
  }
  &.info {
    background: rgba(59, 130, 246, 0.1);
    color: var(--info);
  }
}

.dxp-card-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dxp-card-detail {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.dxp-card-meta {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.dxp-meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  font-weight: 600;

  small {
    color: var(--text-muted);
    font-size: 10px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
}

.dxp-fix-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 700;

  &.auto {
    background: rgba(5, 150, 105, 0.08);
    color: var(--success);
  }
  &.confirm {
    background: rgba(217, 119, 6, 0.08);
    color: var(--warning);
  }
  &.manual {
    background: rgba(220, 38, 38, 0.08);
    color: var(--error);
  }
  &.info {
    background: rgba(59, 130, 246, 0.08);
    color: var(--info);
  }
}
</style>
