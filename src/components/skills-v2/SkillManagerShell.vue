<script setup lang="ts">
/**
 * Skill Manager V2 — Shell Component
 *
 * Main layout: left tab navigation + right content area.
 * Top metrics bar shows key counts.
 *
 * Reference: AgentBro `src/components/skills-v2/SkillManagerShell.tsx`
 */

import { onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillTabId } from '@/types/skillManagerV2'
import SkillSettingsPage from './SkillSettingsPage.vue'
import SkillLibraryPage from './SkillLibraryPage.vue'
import SkillDetailSlider from './SkillDetailSlider.vue'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── Tab definitions ───────────────────────────────────────────────

const tabs = computed<Array<{ id: SkillTabId; labelKey: string; icon: string }>>(() => [
  { id: 'library', labelKey: 'skillManagerV2.tabs.library', icon: 'library' },
  { id: 'install', labelKey: 'skillManagerV2.tabs.install', icon: 'install' },
  { id: 'packs', labelKey: 'skillManagerV2.tabs.packs', icon: 'packs' },
  { id: 'agents', labelKey: 'skillManagerV2.tabs.agents', icon: 'agents' },
  { id: 'diagnostics', labelKey: 'skillManagerV2.tabs.diagnostics', icon: 'diagnostics' },
  { id: 'settings', labelKey: 'skillManagerV2.tabs.settings', icon: 'settings' },
])

// ── Lifecycle ─────────────────────────────────────────────────────

onMounted(() => {
  store.init()
})

// ── Handlers ──────────────────────────────────────────────────────

function handleTabClick(tabId: SkillTabId): void {
  store.setTab(tabId)
}

async function handleRefresh(): Promise<void> {
  await store.refresh()
}
</script>

<template>
  <div class="skill-manager-v2">
    <!-- ── Header ─────────────────────────────────────────────── -->
    <header class="sm-header">
      <h1 class="sm-title">{{ t('skillManagerV2.title') }}</h1>
      <button
        class="sm-refresh-btn"
        :disabled="store.loading"
        @click="handleRefresh"
      >
        {{ t('skillManagerV2.actions.refresh') }}
      </button>
    </header>

    <!-- ── Metrics Bar ────────────────────────────────────────── -->
    <div class="sm-metrics-bar" v-if="store.metrics">
      <div class="sm-metric">
        <span class="sm-metric-value">{{ store.metrics.centerSkillCount }}</span>
        <span class="sm-metric-label">{{ t('skillManagerV2.metrics.centerSkills') }}</span>
      </div>
      <div class="sm-metric">
        <span class="sm-metric-value">{{ store.metrics.agentTargetCount }}</span>
        <span class="sm-metric-label">{{ t('skillManagerV2.metrics.agentTargets') }}</span>
      </div>
      <div class="sm-metric">
        <span class="sm-metric-value">{{ store.metrics.unmanagedCount }}</span>
        <span class="sm-metric-label">{{ t('skillManagerV2.metrics.unmanaged') }}</span>
      </div>
      <div class="sm-metric">
        <span class="sm-metric-value">{{ store.metrics.diagnosisIssueCount }}</span>
        <span class="sm-metric-label">{{ t('skillManagerV2.metrics.issues') }}</span>
      </div>
    </div>

    <!-- ── Main Body: Tabs + Content ──────────────────────────── -->
    <div class="sm-body">
      <!-- Tab Navigation -->
      <nav class="sm-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="sm-tab"
          :class="{ active: store.activeTab === tab.id }"
          @click="handleTabClick(tab.id)"
        >
          {{ t(tab.labelKey) }}
        </button>
      </nav>

      <!-- Content Area -->
      <main class="sm-content">
        <!-- Loading State -->
        <div v-if="store.loading" class="sm-loading">
          {{ t('skillManagerV2.loading') }}
        </div>

        <!-- Error State -->
        <div v-else-if="store.error" class="sm-error">
          {{ store.error }}
        </div>

        <!-- Tab Content -->
        <template v-else>
          <!-- Library Tab (Slice 2) -->
          <SkillLibraryPage v-if="store.activeTab === 'library'" />

          <!-- Install Tab (Slice 3) -->
          <div v-else-if="store.activeTab === 'install'" class="sm-tab-content">
            <div class="sm-placeholder">
              {{ t('skillManagerV2.tabs.install') }}
            </div>
          </div>

          <!-- Packs Tab (Slice 6) -->
          <div v-else-if="store.activeTab === 'packs'" class="sm-tab-content">
            <div v-if="store.packs.length === 0" class="sm-empty">
              <p>{{ t('skillManagerV2.empty.noPacks') }}</p>
              <p class="sm-empty-desc">{{ t('skillManagerV2.empty.noPacksDesc') }}</p>
            </div>
            <div v-else class="sm-pack-list">
              <div v-for="pack in store.packs" :key="pack.id" class="sm-pack-item">
                <h3>{{ pack.name }}</h3>
                <p>{{ pack.description }}</p>
                <span>{{ pack.memberCount }} skills · {{ pack.appliedAgentCount }} agents</span>
              </div>
            </div>
          </div>

          <!-- Agents Tab (Slice 9) -->
          <div v-else-if="store.activeTab === 'agents'" class="sm-tab-content">
            <div v-if="store.agents.length === 0" class="sm-empty">
              <p>{{ t('skillManagerV2.empty.noAgents') }}</p>
            </div>
            <div v-else class="sm-agent-list">
              <div v-for="agent in store.agents" :key="agent.id" class="sm-agent-item">
                <h3>{{ agent.displayName }}</h3>
                <p v-if="agent.skillsDir">{{ agent.skillsDir }}</p>
                <span>{{ agent.managedSkillCount }} managed · {{ agent.unmanagedCount }} unmanaged</span>
              </div>
            </div>
          </div>

          <!-- Diagnostics Tab (Slice 8) -->
          <div v-else-if="store.activeTab === 'diagnostics'" class="sm-tab-content">
            <div v-if="store.issues.length === 0" class="sm-empty">
              <p>{{ t('skillManagerV2.empty.noIssues') }}</p>
              <p class="sm-empty-desc">{{ t('skillManagerV2.empty.noIssuesDesc') }}</p>
            </div>
            <div v-else class="sm-issue-list">
              <div v-for="issue in store.issues" :key="issue.id" class="sm-issue-item">
                <span class="sm-issue-severity" :class="issue.severity">{{ issue.severity }}</span>
                <h3>{{ issue.title }}</h3>
                <p>{{ issue.detail }}</p>
              </div>
            </div>
          </div>

          <!-- Settings Tab -->
          <SkillSettingsPage v-else-if="store.activeTab === 'settings'" />
        </template>
      </main>
    </div>

    <!-- ── Skill Detail Slider (Slice 2) ──────────────────────────── -->
    <SkillDetailSlider />
  </div>
</template>

<style scoped lang="scss">
.skill-manager-v2 {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary, #1e1e1e);
  color: var(--text-primary, #e0e0e0);
  overflow: hidden;
}

.sm-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-color, #333);
  flex-shrink: 0;
}

.sm-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}

.sm-refresh-btn {
  padding: 6px 16px;
  border: 1px solid var(--border-color, #555);
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size&:hover {
    background: var(--bg-hover, #2a2a2a);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.sm-metrics-bar {
  display: flex;
  gap: 24px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border-color, #333);
  flex-shrink: 0;
}

.sm-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.sm-metric-value {
  font-size: 20px;
  font-weight: 700;
}

.sm-metric-label {
  font-size: 11px;
  opacity: 0.7;
}

.sm-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.sm-tabs {
  display: flex;
  flex-direction: column;
  width: 160px;
  border-right: 1px solid var(--border-color, #333);
  flex-shrink: 0;
  padding: 8px 0;
}

.sm-tab {
  display: block;
  padding: 10px 16px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font-size: 13px;

  &:hover {
    background: var(--bg-hover, #2a2a2a);
  }

  &.active {
    background: var(--bg-active, #094771);
    color: var(--text-active, #fff);
    border-left: 3px solid var(--accent-color, #007acc);
  }
}

.sm-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.sm-loading,
.sm-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  opacity: 0.7;
}

.sm-error {
  color: var(--error-color, #f48771);
}

.sm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;

  p {
    margin: 4px 0;
  }
}

.sm-empty-desc {
  opacity: 0.6;
  font-size: 13px;
}

.sm-skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.sm-skill-card {
  padding: 14px;
  border: 1px solid var(--border-color, #333);
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    border-color: var(--accent-color, #007acc);
  }
}

.sm-skill-name {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 6px;
}

.sm-skill-desc {
  font-size: 12px;
  opacity: 0.7;
  margin: 0 0 8px;
}

.sm-skill-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.sm-agent-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  background: var(--bg-badge, #333);
}

.sm-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  opacity: 0.5;
}

.sm-pack-list,
.sm-agent-list,
.sm-issue-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sm-pack-item,
.sm-agent-item,
.sm-issue-item {
  padding: 12px;
  border: 1px solid var(--border-color, #333);
  border-radius: 4px;
}

.sm-issue-severity {
  display: inline-block;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  margin-bottom: 4px;

  &.error { background: #f48771; color: #fff; }
  &.warning { background: #cca700; color: #fff; }
  &.info { background: #75beff; color: #fff; }
}
</style>
