<script setup lang="ts">
/**
 * Skill Manager V2 — Diagnosis Page
 *
 * Shows diagnosis issues grouped by severity, with one-click safe fixes
 * and per-issue fix actions.
 *
 * Reference: AgentBro `src/components/skills-v2/DiagnosisPage.tsx`
 */

import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { DiagnosisIssue, DiagnosisSeverity } from '@/types/skillManagerV2'

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

const autoFixableCount = computed(() =>
  issues.value.filter((i) => i.fixKind === 'auto').length
)

const hasIssues = computed(() => issues.value.length > 0)

// ── Lifecycle ──────────────────────────────────────────────────────

onMounted(() => {
  // Auto-run diagnosis on first visit if no issues loaded yet
  if (!store.diagnosisIssues.length && !store.diagnosisLoading) {
    store.runDiagnosis()
  }
})

// ── Handlers ───────────────────────────────────────────────────────

async function handleRunDiagnosis(): Promise<void> {
  await store.runDiagnosis()
}

async function handleSafeFixes(): Promise<void> {
  await store.executeSafeFixes()
}

function severityLabel(severity: DiagnosisSeverity): string {
  const map: Record<DiagnosisSeverity, string> = {
    error: t('skillManagerV2.diagnosis.severityError'),
    warning: t('skillManagerV2.diagnosis.severityWarning'),
    info: t('skillManagerV2.diagnosis.severityInfo'),
  }
  return map[severity]
}

function fixKindLabel(fixKind: string): string {
  const map: Record<string, string> = {
    auto: t('skillManagerV2.diagnosis.fixAuto'),
    confirm: t('skillManagerV2.diagnosis.fixConfirm'),
    manual: t('skillManagerV2.diagnosis.fixManual'),
    info: t('skillManagerV2.diagnosis.fixInfo'),
  }
  return map[fixKind] ?? fixKind
}
</script>

<template>
  <div class="diagnosis-page">
    <!-- Header -->
    <div class="diag-header">
      <h2 class="diag-title">{{ t('skillManagerV2.diagnosis.title') }}</h2>
      <div class="diag-actions">
        <button
          class="diag-btn"
          :disabled="store.diagnosisLoading"
          @click="handleRunDiagnosis"
        >
          {{ store.diagnosisLoading ? t('common.loading') : t('skillManagerV2.diagnosis.runScan') }}
        </button>
        <button
          v-if="autoFixableCount > 0"
          class="diag-btn diag-btn-primary"
          :disabled="store.busyAction === 'safe-fixes'"
          @click="handleSafeFixes"
        >
          {{ t('skillManagerV2.diagnosis.safeFixes') }} ({{ autoFixableCount }})
        </button>
      </div>
    </div>

    <!-- Safe fix result -->
    <div v-if="store.safeFixResult" class="diag-fix-result">
      <span class="diag-fix-count">
        {{ t('skillManagerV2.diagnosis.fixedCount', { count: store.safeFixResult.fixedCount }) }}
      </span>
      <ul v-if="store.safeFixResult.details.length" class="diag-fix-details">
        <li v-for="(detail, idx) in store.safeFixResult.details" :key="idx">{{ detail }}</li>
      </ul>
    </div>

    <!-- Loading -->
    <div v-if="store.diagnosisLoading" class="diag-loading">
      {{ t('skillManagerV2.diagnosis.scanning') }}
    </div>

    <!-- Empty state -->
    <div v-else-if="!hasIssues" class="diag-empty">
      <p class="diag-empty-title">{{ t('skillManagerV2.empty.noIssues') }}</p>
      <p class="diag-empty-desc">{{ t('skillManagerV2.empty.noIssuesDesc') }}</p>
    </div>

    <!-- Issue summary -->
    <div v-else class="diag-summary">
      <span v-if="errorCount" class="diag-summary-item error">
        {{ t('skillManagerV2.diagnosis.severityError') }}: {{ errorCount }}
      </span>
      <span v-if="warningCount" class="diag-summary-item warning">
        {{ t('skillManagerV2.diagnosis.severityWarning') }}: {{ warningCount }}
      </span>
      <span v-if="infoCount" class="diag-summary-item info">
        {{ t('skillManagerV2.diagnosis.severityInfo') }}: {{ infoCount }}
      </span>
    </div>

    <!-- Issue list -->
    <div v-if="hasIssues" class="diag-issue-list">
      <div
        v-for="issue in issues"
        :key="issue.id"
        class="diag-issue-card"
        :class="issue.severity"
      >
        <div class="diag-issue-header">
          <span class="diag-issue-severity-badge" :class="issue.severity">
            {{ severityLabel(issue.severity) }}
          </span>
          <span class="diag-issue-fix-kind">{{ fixKindLabel(issue.fixKind) }}</span>
        </div>
        <h3 class="diag-issue-title">{{ issue.title }}</h3>
        <p class="diag-issue-detail">{{ issue.detail }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.diagnosis-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.diag-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color, #333);
}

.diag-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.diag-actions {
  display: flex;
  gap: 8px;
}

.diag-btn {
  padding: 6px 14px;
  border: 1px solid var(--border-color, #555);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 12px;

  &:hover:not(:disabled) {
    background: var(--bg-hover, #2a2a2a);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.diag-btn-primary {
  background: var(--accent-color, #007acc);
  border-color: var(--accent-color, #007acc);
  color: #fff;

  &:hover:not(:disabled) {
    opacity: 0.9;
    background: var(--accent-color, #007acc);
  }
}

.diag-fix-result {
  padding: 10px 14px;
  border: 1px solid var(--border-color, #333);
  border-radius: 6px;
  background: var(--bg-hover, #2a2a2a);
}

.diag-fix-count {
  font-weight: 600;
  font-size: 13px;
}

.diag-fix-details {
  margin: 6px 0 0;
  padding-left: 20px;
  font-size: 12px;
  opacity: 0.8;
}

.diag-loading,
.diag-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.diag-empty-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0 0 4px;
}

.diag-empty-desc {
  font-size: 13px;
  opacity: 0.6;
  margin: 0;
}

.diag-summary {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.diag-summary-item {
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 3px;

  &.error { background: rgba(244, 135, 113, 0.2); color: #f48771; }
  &.warning { background: rgba(204, 167, 0, 0.2); color: #cca700; }
  &.info { background: rgba(117, 190, 255, 0.2); color: #75beff; }
}

.diag-issue-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.diag-issue-card {
  padding: 12px 14px;
  border: 1px solid var(--border-color, #333);
  border-radius: 6px;
  border-left: 3px solid transparent;

  &.error { border-left-color: #f48771; }
  &.warning { border-left-color: #cca700; }
  &.info { border-left-color: #75beff; }
}

.diag-issue-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.diag-issue-severity-badge {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;

  &.error { background: #f48771; color: #fff; }
  &.warning { background: #cca700; color: #fff; }
  &.info { background: #75beff; color: #fff; }
}

.diag-issue-fix-kind {
  font-size: 11px;
  opacity: 0.6;
}

.diag-issue-title {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 4px;
}

.diag-issue-detail {
  font-size: 12px;
  opacity: 0.7;
  margin: 0;
  line-height: 1.5;
}
</style>
