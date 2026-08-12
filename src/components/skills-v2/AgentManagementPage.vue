<script setup lang="ts">
/**
 * Skill Manager V2 — Agent Management Page
 *
 * Left: agent list with managed/unmanaged counts.
 * Right: agent detail with skills, unmanaged items, applied packs, health issues.
 *
 * Reference: AgentBro `src/components/skills-v2/AgentManagementPage.tsx`
 */

import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillTarget, UnmanagedItemDto, DiagnosisIssue } from '@/types/skillManagerV2'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── Computed ───────────────────────────────────────────────────────

const agents = computed(() => store.agents)
const selectedAgent = computed(() => store.selectedAgentDetail)

const linkTargets = computed<SkillTarget[]>(() =>
  selectedAgent.value?.skills.filter((t) => t.actualMode === 'link') ?? []
)

const copyTargets = computed<SkillTarget[]>(() =>
  selectedAgent.value?.skills.filter((t) => t.actualMode === 'copy') ?? []
)

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

// ── Lifecycle ──────────────────────────────────────────────────────

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
</script>

<template>
  <div class="agent-mgmt-page">
    <!-- Empty state -->
    <div v-if="!hasAgents" class="amg-empty">
      <p class="amg-empty-title">{{ t('skillManagerV2.empty.noAgents') }}</p>
    </div>

    <!-- Two-column layout -->
    <div v-else class="amg-layout">
      <!-- Left: Agent List -->
      <div class="amg-agent-list">
        <div
          v-for="agent in agents"
          :key="agent.id"
          class="amg-agent-card"
          :class="{ active: store.selectedAgentId === agent.id }"
          @click="handleSelectAgent(agent.id)"
        >
          <h3 class="amg-agent-name">{{ agent.displayName }}</h3>
          <p v-if="agent.skillsDir" class="amg-agent-dir">{{ agent.skillsDir }}</p>
          <div class="amg-agent-stats">
            <span class="amg-stat">{{ t('skillManagerV2.agent.managed') }}: {{ agent.managedSkillCount }}</span>
            <span class="amg-stat">{{ t('skillManagerV2.agent.unmanaged') }}: {{ agent.unmanagedCount }}</span>
          </div>
        </div>
      </div>

      <!-- Right: Agent Detail -->
      <div class="amg-detail">
        <!-- Loading -->
        <div v-if="store.agentDetailLoading" class="amg-loading">
          {{ t('common.loading') }}
        </div>

        <template v-else-if="selectedAgent">
          <!-- Header -->
          <div class="amg-detail-header">
            <h2 class="amg-detail-title">{{ selectedAgent.displayName }}</h2>
            <div class="amg-detail-actions">
              <button
                class="amg-btn"
                :disabled="store.busyAction === 'scan-agent-detail'"
                @click="handleScanAgent(selectedAgent.id)"
              >
                {{ t('skillManagerV2.agent.scan') }}
              </button>
              <button
                v-if="selectedAgent.skillsDir"
                class="amg-btn"
                @click="handleOpenDir(selectedAgent.skillsDir)"
              >
                {{ t('skillManagerV2.actions.openPath') }}
              </button>
            </div>
          </div>

          <!-- Version info -->
          <div class="amg-section">
            <h3 class="amg-section-title">{{ t('skillManagerV2.agent.version') }}</h3>
            <p class="amg-section-body">
              <span v-if="selectedAgent.version">{{ selectedAgent.version }}</span>
              <span v-else class="amg-muted">{{ t('skillManagerV2.agent.versionUnknown') }}</span>
            </p>
          </div>

          <!-- Skills -->
          <div class="amg-section">
            <h3 class="amg-section-title">
              {{ t('skillManagerV2.agent.installedSkills') }}
              <span class="amg-section-count">({{ selectedAgent.skills.length }})</span>
            </h3>
            <div v-if="selectedAgent.skills.length === 0" class="amg-muted">
              {{ t('skillManagerV2.agent.noSkills') }}
            </div>
            <div v-else class="amg-target-list">
              <div v-for="target in selectedAgent.skills" :key="target.id" class="amg-target-item">
                <span class="amg-target-skill">{{ target.skillId }}</span>
                <span class="amg-target-mode" :class="target.actualMode">{{ target.actualMode }}</span>
                <span class="amg-target-status" :class="target.status">{{ statusLabel(target.status) }}</span>
              </div>
            </div>
          </div>

          <!-- Unmanaged -->
          <div v-if="unmanagedItems.length > 0" class="amg-section">
            <h3 class="amg-section-title">
              {{ t('skillManagerV2.agent.unmanagedSkills') }}
              <span class="amg-section-count">({{ unmanagedItems.length }})</span>
            </h3>
            <div class="amg-unmanaged-list">
              <div v-for="item in unmanagedItems" :key="item.id" class="amg-unmanaged-item">
                <span class="amg-unmanaged-name">{{ item.inferredSkillId ?? item.path }}</span>
                <span class="amg-unmanaged-reason">{{ item.reason }}</span>
              </div>
            </div>
          </div>

          <!-- Applied Packs -->
          <div v-if="appliedPacks.length > 0" class="amg-section">
            <h3 class="amg-section-title">
              {{ t('skillManagerV2.agent.appliedPacks') }}
              <span class="amg-section-count">({{ appliedPacks.length }})</span>
            </h3>
            <div class="amg-pack-list">
              <div v-for="pack in appliedPacks" :key="pack.id" class="amg-pack-item">
                <span class="amg-pack-name">{{ pack.name }}</span>
                <span class="amg-pack-members">{{ pack.memberCount }} skills</span>
              </div>
            </div>
          </div>

          <!-- Health Issues -->
          <div v-if="healthIssues.length > 0" class="amg-section">
            <h3 class="amg-section-title amg-health-title">
              {{ t('skillManagerV2.agent.healthIssues') }}
              <span class="amg-section-count">({{ healthIssues.length }})</span>
            </h3>
            <div class="amg-health-list">
              <div
                v-for="issue in healthIssues"
                :key="issue.id"
                class="amg-health-item"
                :class="issue.severity"
              >
                <span class="amg-health-severity" :class="issue.severity">{{ issue.severity }}</span>
                <span class="amg-health-title">{{ issue.title }}</span>
                <span class="amg-health-detail">{{ issue.detail }}</span>
              </div>
            </div>
          </div>
        </template>

        <!-- No agent selected -->
        <div v-else class="amg-muted">
          {{ t('skillManagerV2.agent.selectAgent') }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.agent-mgmt-page {
  height: 100%;
}

.amg-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
}

.amg-empty-title {
  font-size: 16px;
  opacity: 0.6;
}

.amg-layout {
  display: flex;
  gap: 16px;
  height: 100%;
}

.amg-agent-list {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
}

.amg-agent-card {
  padding: 12px;
  border: 1px solid var(--border-color, #333);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s;

  &:hover {
    border-color: var(--accent-color, #007acc);
  }
  &.active {
    border-color: var(--accent-color, #007acc);
    background: var(--bg-active, rgba(9, 71, 113, 0.3));
  }
}

.amg-agent-name {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 4px;
}

.amg-agent-dir {
  font-size: 11px;
  opacity: 0.5;
  margin: 0 0 6px;
  word-break: break-all;
}

.amg-agent-stats {
  display: flex;
  gap: 10px;
}

.amg-stat {
  font-size: 11px;
  opacity: 0.7;
}

.amg-detail {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.amg-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  opacity: 0.5;
}

.amg-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color, #333);
}

.amg-detail-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.amg-detail-actions {
  display: flex;
  gap: 8px;
}

.amg-btn {
  padding: 5px 12px;
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

.amg-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.amg-section-title {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  opacity: 0.9;
}

.amg-section-count {
  font-weight: 400;
  opacity: 0.6;
}

.amg-section-body {
  font-size: 13px;
  margin: 0;
}

.amg-muted {
  font-size: 13px;
  opacity: 0.5;
}

.amg-target-list,
.amg-unmanaged-list,
.amg-pack-list,
.amg-health-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.amg-target-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  font-size: 12px;
}

.amg-target-skill {
  flex: 1;
  font-weight: 500;
}

.amg-target-mode {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;

  &.link { background: rgba(117, 190, 255, 0.2); color: #75beff; }
  &.copy { background: rgba(204, 167, 0, 0.2); color: #cca700; }
}

.amg-target-status {
  font-size: 10px;
  opacity: 0.7;

  &.ok { color: #4ec9b0; }
  &.broken_link { color: #f48771; }
  &.copy_outdated,
  &.copy_modified,
  &.copy_diverged { color: #cca700; }
  &.missing { color: #f48771; }
}

.amg-unmanaged-item,
.amg-pack-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  font-size: 12px;
}

.amg-unmanaged-name {
  font-weight: 500;
}

.amg-unmanaged-reason {
  font-size: 11px;
  opacity: 0.6;
}

.amg-pack-name {
  font-weight: 500;
}

.amg-pack-members {
  font-size: 11px;
  opacity: 0.6;
}

.amg-health-title {
  color: #f48771;
}

.amg-health-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
  border-left: 3px solid transparent;
  font-size: 12px;

  &.error { border-left-color: #f48771; }
  &.warning { border-left-color: #cca700; }
  &.info { border-left-color: #75beff; }
}

.amg-health-severity {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  width: fit-content;
  padding: 1px 6px;
  border-radius: 3px;

  &.error { background: #f48771; color: #fff; }
  &.warning { background: #cca700; color: #fff; }
  &.info { background: #75beff; color: #fff; }
}

.amg-health-detail {
  font-size: 11px;
  opacity: 0.6;
}
</style>
