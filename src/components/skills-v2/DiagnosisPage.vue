<script setup lang="ts">
/**
 * Skill Manager V2 — Diagnosis Page
 *
 * Layout: action bar + diagnostic-card grid.
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CheckCircle2, RefreshCw, Wrench } from 'lucide-vue-next'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { DiagnosisIssue, FixKind } from '@/types/skillManagerV2'

const { t } = useI18n()
const store = useSkillManagerStore()
const activeFilter = ref<'all' | 'auto' | 'confirm' | 'hint'>('all')

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
const autoCount = computed(() => issues.value.filter((issue) => issue.fixKind === 'auto').length)
const confirmCount = computed(() => issues.value.filter((issue) => issue.fixKind === 'confirm').length)
const hintCount = computed(() => issues.value.filter((issue) => issue.fixKind === 'manual' || issue.fixKind === 'info').length)
const filteredIssues = computed(() => activeFilter.value === 'all'
  ? issues.value
  : activeFilter.value === 'hint'
    ? issues.value.filter((issue) => issue.fixKind === 'manual' || issue.fixKind === 'info')
    : issues.value.filter((issue) => issue.fixKind === activeFilter.value)
)

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
    <div class="dxp-health-banner" :class="{ healthy: !hasIssues }">
      <div class="dxp-health-copy">
        <span class="dxp-health-status"><CheckCircle2 :size="14" />{{ hasIssues ? t('skillManagerV2.diagnosis.attention') : t('skillManagerV2.diagnosis.healthy') }}</span>
        <h3>{{ hasIssues ? t('skillManagerV2.diagnosis.issueTitle', { count: issues.length }) : t('skillManagerV2.diagnosis.healthyTitle') }}</h3>
        <p>{{ hasIssues ? t('skillManagerV2.diagnosis.issueDesc') : t('skillManagerV2.empty.noIssuesDesc') }}</p>
      </div>
      <div class="dxp-actions">
        <button
          class="dxp-btn"
          :disabled="loading"
          @click="handleRunScan"
        >
          <RefreshCw :size="15" :class="{ spin: loading }" />
          {{ loading ? t('skillManagerV2.diagnosis.scanning') : t('skillManagerV2.diagnosis.runScan') }}
        </button>
        <button
          class="dxp-btn primary"
          :disabled="fixing || !hasIssues"
          @click="handleSafeFixes"
        >
          <Wrench :size="15" />
          {{ fixing ? t('common.loading') : t('skillManagerV2.diagnosis.safeFixes') }}
        </button>
      </div>
    </div>

    <div class="dxp-stat-grid">
      <button :class="{ active: activeFilter === 'auto' }" @click="activeFilter = 'auto'"><strong>{{ autoCount }}</strong><span>{{ t('skillManagerV2.diagnosis.fixAuto') }}</span></button>
      <button :class="{ active: activeFilter === 'confirm' }" @click="activeFilter = 'confirm'"><strong>{{ confirmCount }}</strong><span>{{ t('skillManagerV2.diagnosis.fixConfirm') }}</span></button>
      <button :class="{ active: activeFilter === 'hint' }" @click="activeFilter = 'hint'"><strong>{{ hintCount }}</strong><span>{{ t('skillManagerV2.diagnosis.fixManual') }}</span></button>
    </div>

    <div class="dxp-filter-tabs">
      <button :class="{ active: activeFilter === 'all' }" @click="activeFilter = 'all'">{{ t('skillManagerV2.diagnosis.all') }} ({{ issues.length }})</button>
      <span v-if="errorCount">{{ errorCount }} {{ t('skillManagerV2.diagnosis.severityError') }}</span>
      <span v-if="warningCount">{{ warningCount }} {{ t('skillManagerV2.diagnosis.severityWarning') }}</span>
      <span v-if="infoCount">{{ infoCount }} {{ t('skillManagerV2.diagnosis.severityInfo') }}</span>
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
        v-for="issue in filteredIssues"
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

.dxp-health-banner {
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 22px;
  border: 1px solid color-mix(in srgb, var(--warning) 28%, var(--border-default));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--warning) 6%, var(--bg-elevated));

  &.healthy {
    border-color: color-mix(in srgb, var(--success) 28%, var(--border-default));
    background: color-mix(in srgb, var(--success) 6%, var(--bg-elevated));
  }
}

.dxp-health-copy {
  h3 {
    margin: 7px 0 4px;
    font: 700 22px/1.2 var(--font-display);
    letter-spacing: 0;
  }

  p {
    max-width: 65ch;
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
  }
}

.dxp-health-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--success);
  font-size: 11px;
  font-weight: 700;
}

.dxp-stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;

  button {
    min-height: 76px;
    padding: 13px 16px;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: border-color 180ms ease, background 180ms ease;

    &:hover, &.active {
      border-color: color-mix(in srgb, var(--accent-primary) 42%, var(--border-default));
      background: var(--accent-primary-glow);
    }
  }

  strong {
    display: block;
    font: 700 21px/1 var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  span {
    display: block;
    margin-top: 7px;
    color: var(--text-muted);
    font-size: 11px;
  }
}

.dxp-filter-tabs {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--border-default);

  button {
    height: 34px;
    padding: 0 10px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;

    &.active { border-bottom-color: var(--accent-primary); color: var(--accent-primary); }
  }

  span { color: var(--text-muted); font-size: 10px; }
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
  flex-shrink: 0;
}

.dxp-btn {
  height: 32px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
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

.spin { animation: dxp-spin 900ms linear infinite; }
@keyframes dxp-spin { to { transform: rotate(360deg); } }

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

@media (max-width: 720px) {
  .dxp-health-banner { align-items: stretch; flex-direction: column; }
  .dxp-actions .dxp-btn { flex: 1; }
  .dxp-stat-grid { grid-template-columns: 1fr; }
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
