<script setup lang="ts">
/**
 * Skill Manager V2 — Shell Component
 *
 * Layout: left rail navigation + main area (topbar + content).
 * The rail has glyph icons + counts, grouped into Management / Configuration.
 */

import { onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillTabId } from '@/types/skillManagerV2'
import SkillSettingsPage from './SkillSettingsPage.vue'
import SkillLibraryPage from './SkillLibraryPage.vue'
import SkillDetailSlider from './SkillDetailSlider.vue'
import InstallPage from './InstallPage.vue'
import DiagnosisPage from './DiagnosisPage.vue'
import AgentManagementPage from './AgentManagementPage.vue'

const { t } = useI18n()
const store = useSkillManagerStore()
const appStore = useAppStore()

function handleClose(): void {
  appStore.showSkillsManager = false
}

// ── Tab definitions ───────────────────────────────────────────────

interface TabDef {
  id: SkillTabId
  labelKey: string
  glyph: string
  group: 'management' | 'configuration'
}

const tabs: TabDef[] = [
  { id: 'library', labelKey: 'skillManagerV2.tabs.library', glyph: 'SK', group: 'management' },
  { id: 'install', labelKey: 'skillManagerV2.tabs.install', glyph: 'IN', group: 'management' },
  { id: 'packs', labelKey: 'skillManagerV2.tabs.packs', glyph: 'PK', group: 'management' },
  { id: 'agents', labelKey: 'skillManagerV2.tabs.agents', glyph: 'AG', group: 'management' },
  { id: 'diagnostics', labelKey: 'skillManagerV2.tabs.diagnostics', glyph: 'DX', group: 'management' },
  { id: 'settings', labelKey: 'skillManagerV2.tabs.settings', glyph: 'ST', group: 'configuration' },
]

const managementTabs = computed(() => tabs.filter((tab) => tab.group === 'management'))
const configurationTabs = computed(() => tabs.filter((tab) => tab.group === 'configuration'))

const currentTitle = computed(() => {
  const key = `skillManagerV2.viewTitle.${store.activeTab}`
  return t(key)
})

const currentSubtitle = computed(() => {
  const key = `skillManagerV2.viewSubtitle.${store.activeTab}`
  return t(key)
})

function tabCount(tabId: SkillTabId): number | null {
  if (!store.metrics) return null
  switch (tabId) {
    case 'library': return store.metrics.centerSkillCount
    case 'packs': return store.packs.length
    case 'agents': return store.agents.length
    case 'diagnostics': return store.metrics.diagnosisIssueCount
    default: return null
  }
}

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
  <div class="sm2-shell">
    <!-- ── Left Rail ──────────────────────────────────────────── -->
    <aside class="sm2-rail">
      <div class="sm2-rail-header">
        <button class="sm2-back-btn" @click="handleClose" :title="t('common.close')">
          <ArrowLeft :size="18" />
        </button>
        <div class="sm2-rail-titles">
          <h1 class="sm2-rail-title">{{ t('skillManagerV2.title') }}</h1>
          <p class="sm2-rail-subtitle">{{ t('skillManagerV2.nav.management') }}</p>
        </div>
      </div>

      <nav class="sm2-nav">
        <div class="sm2-nav-label">{{ t('skillManagerV2.nav.management') }}</div>
        <button
          v-for="tab in managementTabs"
          :key="tab.id"
          class="sm2-nav-item"
          :class="{ active: store.activeTab === tab.id }"
          @click="handleTabClick(tab.id)"
        >
          <span class="sm2-nav-glyph">{{ tab.glyph }}</span>
          <span class="sm2-nav-text">{{ t(tab.labelKey) }}</span>
          <span
            v-if="tabCount(tab.id) !== null && tabCount(tab.id)! > 0"
            class="sm2-nav-count"
          >
            {{ tabCount(tab.id) }}
          </span>
        </button>

        <div class="sm2-nav-label">{{ t('skillManagerV2.nav.configuration') }}</div>
        <button
          v-for="tab in configurationTabs"
          :key="tab.id"
          class="sm2-nav-item"
          :class="{ active: store.activeTab === tab.id }"
          @click="handleTabClick(tab.id)"
        >
          <span class="sm2-nav-glyph">{{ tab.glyph }}</span>
          <span class="sm2-nav-text">{{ t(tab.labelKey) }}</span>
        </button>
      </nav>

      <div class="sm2-rail-footer" v-if="store.settings">
        <div class="sm2-path-card">
          <strong>{{ t('skillManagerV2.nav.centerLibrary') }}</strong>
          <code>{{ store.settings.centerLibraryPath }}</code>
        </div>
      </div>
    </aside>

    <!-- ── Main Area ──────────────────────────────────────────── -->
    <main class="sm2-main">
      <!-- Topbar -->
      <header class="sm2-topbar">
        <div class="sm2-heading">
          <h2 class="sm2-heading-title">{{ currentTitle }}</h2>
          <p class="sm2-heading-subtitle">{{ currentSubtitle }}</p>
        </div>
        <div class="sm2-top-actions">
          <button
            class="sm2-btn"
            :disabled="store.loading"
            @click="handleRefresh"
          >
            {{ t('skillManagerV2.actions.refresh') }}
          </button>
        </div>
      </header>

      <!-- Content -->
      <section class="sm2-content">
        <!-- Loading State -->
        <div v-if="store.loading && !store.overview" class="sm2-loading">
          {{ t('skillManagerV2.loading') }}
        </div>

        <!-- Error State -->
        <div v-else-if="store.error" class="sm2-error">
          {{ store.error }}
        </div>

        <!-- Tab Content -->
        <template v-else>
          <SkillLibraryPage v-if="store.activeTab === 'library'" />
          <InstallPage v-else-if="store.activeTab === 'install'" />

          <!-- Packs Tab -->
          <div v-else-if="store.activeTab === 'packs'" class="sm2-workspace">
            <div v-if="store.packs.length === 0" class="sm2-empty">
              <p class="sm2-empty-title">{{ t('skillManagerV2.empty.noPacks') }}</p>
              <p class="sm2-empty-desc">{{ t('skillManagerV2.empty.noPacksDesc') }}</p>
            </div>
            <div v-else class="sm2-pack-list">
              <div v-for="pack in store.packs" :key="pack.id" class="sm2-pack-item">
                <h3>{{ pack.name }}</h3>
                <p>{{ pack.description }}</p>
                <span>{{ pack.memberCount }} skills · {{ pack.appliedAgentCount }} agents</span>
              </div>
            </div>
          </div>

          <AgentManagementPage v-else-if="store.activeTab === 'agents'" />
          <DiagnosisPage v-else-if="store.activeTab === 'diagnostics'" />
          <SkillSettingsPage v-else-if="store.activeTab === 'settings'" />
        </template>
      </section>
    </main>

    <!-- ── Skill Detail Slider ──────────────────────────────────── -->
    <SkillDetailSlider />
  </div>
</template>

<style scoped lang="scss">
.sm2-shell {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  color: var(--text-primary);
  position: relative;
}

// ── Left Rail ────────────────────────────────────────────────────

.sm2-rail {
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-default);
}

.sm2-rail-header {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.sm2-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.sm2-rail-titles {
  min-width: 0;
}

.sm2-rail-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  font-family: var(--font-display);
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sm2-rail-subtitle {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
}

.sm2-nav {
  flex: 1;
  padding: 10px 8px;
  overflow-y: auto;
}

.sm2-nav-label {
  padding: 8px 10px 4px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.sm2-nav-item {
  width: 100%;
  min-width: 0;
  height: 36px;
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 10px;
  margin: 2px 0;
  padding: 0 10px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  &.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
    box-shadow: inset 3px 0 0 var(--accent-primary), var(--shadow-sm);

    .sm2-nav-glyph {
      background: var(--accent-primary-glow);
      color: var(--accent-primary);
    }
    .sm2-nav-count {
      background: var(--accent-primary-glow);
      color: var(--accent-primary);
    }
  }
}

.sm2-nav-glyph {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--surface-card);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 800;
}

.sm2-nav-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sm2-nav-count {
  min-width: 20px;
  height: 18px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-full);
  background: var(--surface-card);
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  padding: 0 6px;
}

.sm2-rail-footer {
  padding: 10px;
  border-top: 1px solid var(--border-default);
  flex-shrink: 0;
}

.sm2-path-card {
  padding: 10px 12px;
  border: 1px solid var(--accent-primary-glow);
  border-radius: var(--radius-md);
  background: var(--accent-primary-glow);

  strong {
    display: block;
    font-size: 11px;
    font-weight: 700;
    color: var(--text-secondary);
  }
  code {
    display: block;
    margin-top: 5px;
    color: var(--accent-primary);
    font-family: var(--font-mono);
    font-size: 11px;
    overflow-wrap: anywhere;
  }
}

// ── Main Area ────────────────────────────────────────────────────

.sm2-main {
  min-width: 0;
  display: grid;
  grid-template-rows: 60px minmax(0, 1fr);
  background: var(--bg-primary);
}

.sm2-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.sm2-heading {
  min-width: 0;
}

.sm2-heading-title {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  font-family: var(--font-display);
  line-height: 1.2;
  letter-spacing: -0.01em;
}

.sm2-heading-subtitle {
  margin: 2px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sm2-top-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

// ── Buttons ──────────────────────────────────────────────────────

.sm2-btn {
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

// ── Content ──────────────────────────────────────────────────────

.sm2-content {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.sm2-workspace {
  height: 100%;
  overflow-y: auto;
  padding: 16px 20px 24px;
}

.sm2-loading,
.sm2-error {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  opacity: 0.7;
}

.sm2-error {
  color: var(--error);
}

.sm2-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;

  p { margin: 4px 0; }
}

.sm2-empty-title {
  font-size: 15px;
  font-weight: 600;
}

.sm2-empty-desc {
  font-size: 13px;
  opacity: 0.6;
}

.sm2-pack-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sm2-pack-item {
  padding: 12px 14px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);

  h3 {
    font-size: 14px;
    font-weight: 600;
    margin: 0 0 4px;
  }
  p {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0 0 6px;
  }
  span {
    font-size: 11px;
    color: var(--text-muted);
  }
}
</style>
