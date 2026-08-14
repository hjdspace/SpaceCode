<script setup lang="ts">
/**
 * Skill Manager V2 — Agent Management Page
 *
 * Layout: side-panel agent list + detail-panel with tabs (Skills, Packs, Diagnostics).
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, RefreshCw, Sparkles } from 'lucide-vue-next'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillTarget, UnmanagedItemDto, DiagnosisIssue } from '@/types/skillManagerV2'
import AdoptDialog from './AdoptDialog.vue'
import AgentIconBadge from './AgentIconBadge.vue'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── State ─────────────────────────────────────────────────────────

const activeTab = ref<'skills' | 'packs' | 'diagnostics'>('skills')
const adoptItem = ref<UnmanagedItemDto | null>(null)

// ── Computed ───────────────────────────────────────────────────────

const agents = computed(() => store.agents)
const selectedAgent = computed(() => store.selectedAgentDetail)

const unmanagedItems = computed<UnmanagedItemDto[]>(() =>
  selectedAgent.value?.unmanaged ?? []
)

const appliedPacks = computed(() =>
  selectedAgent.value?.appliedPacks ?? []
)

const healthIssues = computed<DiagnosisIssue[]>(() =>
  selectedAgent.value?.healthIssues ?? []
)

const hasAgents = computed(() => agents.value.length > 0)

// ── Agent status summary ──────────────────────────────────────────

function agentStatusChip(agent: typeof agents.value[0]): { cls: string; label: string } {
  if (agent.unmanagedCount > 0) return { cls: 'warn', label: t('skillManagerV2.status.unmanaged') }
  return { cls: 'ok', label: t('skillManagerV2.status.ok') }
}

// ── Lifecycle ─────────────────────────────────────────────────────

onMounted(() => {
  if (hasAgents.value && !store.selectedAgentId) {
    store.loadAgentDetail(agents.value[0].id)
  }
})

// ── Handlers ───────────────────────────────────────────────────────

function handleSelectAgent(agentId: string): void {
  store.loadAgentDetail(agentId)
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
          <div class="amp-list-menu">
            <button
              v-for="agent in agents"
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

          <!-- Tabs -->
          <div class="amp-tabs">
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
          </div>

          <!-- Tab Content -->
          <div class="amp-tab-content">
            <!-- Skills Tab -->
            <div v-if="activeTab === 'skills'" class="amp-skills-tab">
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

              <!-- Skills List -->
              <div class="amp-data-list" v-if="selectedAgent.skills.length > 0">
                <div
                  v-for="target in selectedAgent.skills"
                  :key="target.id"
                  class="amp-data-row"
                >
                  <span class="amp-glyph sm">{{ target.skillId.slice(0, 2).toUpperCase() }}</span>
                  <div>
                    <strong>{{ target.skillId }}</strong>
                    <span>{{ target.targetPath }}</span>
                  </div>
                  <span class="amp-status-pill" :class="modePillClass(target.actualMode)">
                    {{ target.actualMode === 'link'
                      ? t('skillManagerV2.settings.modeLink')
                      : t('skillManagerV2.settings.modeCopy') }}
                  </span>
                </div>
              </div>

              <!-- Unmanaged -->
              <div v-if="unmanagedItems.length > 0" class="amp-section">
                <h4 class="amp-section-title">
                  {{ t('skillManagerV2.agent.unmanagedSkills') }}
                  <span class="amp-count">({{ unmanagedItems.length }})</span>
                </h4>
                <div class="amp-data-list">
                  <div v-for="item in unmanagedItems" :key="item.id" class="amp-data-row">
                    <span class="amp-glyph sm">?</span>
                    <div>
                      <strong>{{ item.inferredSkillId ?? item.path }}</strong>
                      <span>{{ item.reason }}</span>
                    </div>
                    <button class="amp-row-action" @click="handleAdopt(item)">
                      <Sparkles :size="14" />{{ t('skillManagerV2.agent.adopt') }}
                    </button>
                  </div>
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

@media (max-width: 920px) {
  .amp-layout { grid-template-columns: 220px minmax(0, 1fr); }
  .amp-chip { display: none; }
  .amp-list-item { grid-template-columns: 32px minmax(0, 1fr); }
}

@media (max-width: 680px) {
  .amp-layout { display: flex; flex-direction: column; overflow-y: auto; }
  .amp-side-panel { min-height: 180px; flex: 0 0 180px; }
  .amp-detail-panel { min-height: 420px; overflow: visible; }
  .amp-agent-header { align-items: stretch; flex-direction: column; }
  .amp-header-actions { justify-content: stretch; }
  .amp-header-actions .amp-btn { flex: 1; }
}
</style>
