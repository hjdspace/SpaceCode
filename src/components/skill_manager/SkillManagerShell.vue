<script setup lang="ts">
/**
 * Skill Manager V2 — Shell Component
 *
 * Layout: left rail navigation + main area (topbar + content).
 * The rail has glyph icons + counts, grouped into Management / Configuration.
 */

import { onMounted, computed, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Bot,
  BookOpen,
  Download,
  HardDrive,
  PackageOpen,
  RefreshCw,
  Settings,
  Stethoscope,
  X,
} from 'lucide-vue-next'
import appIcon from '@/assets/app-icon.svg'
import { useAppStore } from '@/stores/app'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillTabId } from '@/types/skillManagerV2'
import SkillSettingsPage from './SkillSettingsPage.vue'
import SkillLibraryPage from './SkillLibraryPage.vue'
import SkillDetailSlider from './SkillDetailSlider.vue'
import InstallPage from './InstallPage.vue'
import DiagnosisPage from './DiagnosisPage.vue'
import AgentManagementPage from './AgentManagementPage.vue'
import SkillPackPage from './SkillPackPage.vue'

const { t } = useI18n()
const store = useSkillManagerStore()
const appStore = useAppStore()
const refreshing = ref(false)

function handleClose(): void {
  appStore.showSkillsManager = false
}

// ── Tab definitions ───────────────────────────────────────────────

interface TabDef {
  id: SkillTabId
  labelKey: string
  icon: Component
  group: 'management' | 'configuration'
}

const tabs: TabDef[] = [
  { id: 'library', labelKey: 'skillManagerV2.tabs.library', icon: BookOpen, group: 'management' },
  { id: 'install', labelKey: 'skillManagerV2.tabs.install', icon: Download, group: 'management' },
  { id: 'packs', labelKey: 'skillManagerV2.tabs.packs', icon: PackageOpen, group: 'management' },
  { id: 'agents', labelKey: 'skillManagerV2.tabs.agents', icon: Bot, group: 'management' },
  { id: 'diagnostics', labelKey: 'skillManagerV2.tabs.diagnostics', icon: Stethoscope, group: 'management' },
  { id: 'settings', labelKey: 'skillManagerV2.tabs.settings', icon: Settings, group: 'configuration' },
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
  refreshing.value = true
  try {
    await store.refresh()
    for (const agent of store.agents) {
      if (agent.enabled) await store.scanAgentInventory(agent.id, false)
    }
    await store.loadOverview()
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <div class="sm2-shell">
    <!-- ── Left Rail ──────────────────────────────────────────── -->
    <aside class="sm2-rail">
      <div class="sm2-rail-header">
        <div class="sm2-brand-mark"><img :src="appIcon" alt="SpaceCode" /></div>
        <div class="sm2-rail-titles">
          <h1 class="sm2-rail-title">{{ t('skillManagerV2.title') }}</h1>
          <p class="sm2-rail-subtitle">SpaceCode Skills</p>
        </div>
      </div>

      <nav class="sm2-nav">
        <div class="sm2-nav-label">{{ t('skillManagerV2.nav.management') }}</div>
        <button
          v-for="tab in managementTabs"
          :key="tab.id"
          class="sm2-nav-item"
          :class="{ active: store.activeTab === tab.id }"
          :aria-current="store.activeTab === tab.id ? 'page' : undefined"
          :title="t(tab.labelKey)"
          @click="handleTabClick(tab.id)"
        >
          <span class="sm2-nav-glyph"><component :is="tab.icon" :size="17" /></span>
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
          :aria-current="store.activeTab === tab.id ? 'page' : undefined"
          :title="t(tab.labelKey)"
          @click="handleTabClick(tab.id)"
        >
          <span class="sm2-nav-glyph"><component :is="tab.icon" :size="17" /></span>
          <span class="sm2-nav-text">{{ t(tab.labelKey) }}</span>
        </button>
      </nav>

      <div class="sm2-rail-footer">
        <div class="sm2-device-card">
          <span class="sm2-device-icon"><HardDrive :size="17" /></span>
          <span><strong>{{ t('skillManagerV2.nav.localDevice') }}</strong><small><i />{{ t('skillManagerV2.nav.online') }}</small></span>
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
          <span class="sm2-library-status" v-if="store.metrics">
            <i />{{ store.metrics.centerSkillCount }} {{ t('skillManagerV2.metrics.centerSkills') }}
          </span>
          <button
            class="sm2-icon-btn"
            :disabled="refreshing"
            @click="handleRefresh"
            :title="t('skillManagerV2.actions.refresh')"
          >
            <RefreshCw :size="17" :class="{ spin: refreshing }" />
          </button>
          <button class="sm2-icon-btn" @click="handleClose" :title="t('common.close')">
            <X :size="18" />
          </button>
        </div>
      </header>

      <!-- Content -->
      <section class="sm2-content">
        <!-- Loading State -->
        <div v-if="store.loading && !store.overview" class="sm2-loading" aria-live="polite">
          <div class="sm2-loading-metrics">
            <span v-for="index in 4" :key="index" />
          </div>
          <div class="sm2-loading-toolbar" />
          <div class="sm2-loading-grid">
            <span v-for="index in 6" :key="index" />
          </div>
          <p>{{ t('skillManagerV2.loading') }}</p>
        </div>

        <!-- Error State -->
        <div v-else-if="store.error" class="sm2-error">
          {{ store.error }}
        </div>

        <!-- Tab Content -->
        <template v-else>
          <SkillLibraryPage v-if="store.activeTab === 'library'" />
          <InstallPage v-else-if="store.activeTab === 'install'" />

          <SkillPackPage v-else-if="store.activeTab === 'packs'" />

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
  grid-template-columns: 232px minmax(0, 1fr);
  // 显式约束行高：隐式 auto 行会被内容撑开，导致内部高度链断裂、页面无法滚动
  grid-template-rows: minmax(0, 1fr);
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
  background: color-mix(in srgb, var(--bg-secondary) 96%, var(--accent-primary) 4%);
  border-right: 1px solid var(--border-default);
}

.sm2-rail-header {
  height: 72px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.sm2-brand-mark {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--accent-primary) 24%, var(--border-default));
  border-radius: 10px;
  background: var(--bg-elevated);
  flex-shrink: 0;

  img {
    width: 25px;
    height: 25px;
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
  letter-spacing: 0;
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
  padding: 14px 10px;
  overflow-y: auto;
}

.sm2-nav-label {
  padding: 8px 10px 4px;
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0;
}

.sm2-nav-item {
  width: 100%;
  min-width: 0;
  height: 42px;
  display: grid;
  grid-template-columns: 28px 1fr auto;
  align-items: center;
  gap: 10px;
  margin: 3px 0;
  padding: 0 10px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--text-secondary);
  text-align: left;
  font-size: 13px;
  cursor: pointer;
  transition: background 180ms ease, color 180ms ease, transform 180ms ease;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    transform: translateX(2px);
  }

  &.active {
    background: linear-gradient(110deg, var(--accent-primary), color-mix(in srgb, var(--accent-primary) 68%, var(--accent-secondary)));
    color: var(--text-on-accent, #fff);
    box-shadow: 0 9px 22px color-mix(in srgb, var(--accent-primary) 24%, transparent);

    .sm2-nav-glyph {
      background: rgba(255, 255, 255, 0.18);
      color: var(--text-on-accent, #fff);
    }
    .sm2-nav-count {
      background: rgba(255, 255, 255, 0.18);
      color: var(--text-on-accent, #fff);
    }
  }
}

.sm2-nav-glyph {
  width: 28px;
  height: 28px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--radius-sm);
  background: transparent;
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

.sm2-device-card {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 9px;
  align-items: center;
  padding: 10px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--bg-elevated);

  strong {
    display: block;
    font-size: 12px;
    font-weight: 700;
  }

  small {
    display: block;
    margin-top: 3px;
    color: var(--text-muted);
    font-size: 10px;

    i {
      width: 6px;
      height: 6px;
      display: inline-block;
      margin-right: 5px;
      border-radius: 50%;
      background: var(--success);
    }
  }
}

.sm2-device-icon {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
}

// ── Main Area ────────────────────────────────────────────────────

.sm2-main {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 72px minmax(0, 1fr);
  background: color-mix(in srgb, var(--bg-primary) 97%, var(--accent-primary) 3%);
}

.sm2-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 0 20px;
  border-bottom: 1px solid var(--border-default);
  background: color-mix(in srgb, var(--bg-primary) 94%, transparent);
  backdrop-filter: blur(14px);
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
  letter-spacing: 0;
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

.sm2-icon-btn {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
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

.sm2-library-status {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  white-space: nowrap;

  i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
  }
}

.spin { animation: sm2-spin 900ms linear infinite; }
@keyframes sm2-spin { to { transform: rotate(360deg); } }

// ── Content ──────────────────────────────────────────────────────

.sm2-content {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-primary) 98%, var(--accent-primary) 2%);
}

.sm2-workspace {
  height: 100%;
  overflow-y: auto;
  padding: 16px 20px 24px;
}

.sm2-loading,
.sm2-error {
  height: 100%;
}

.sm2-loading {
  position: relative;
  padding: 20px;
  overflow: hidden;

  p {
    position: absolute;
    left: 50%;
    top: 50%;
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
    transform: translate(-50%, -50%);
  }
}

.sm2-loading-metrics,
.sm2-loading-grid {
  display: grid;
  gap: 12px;
}

.sm2-loading-metrics {
  grid-template-columns: repeat(4, minmax(0, 1fr));

  span { height: 76px; }
}

.sm2-loading-toolbar {
  height: 52px;
  margin: 14px 0;
}

.sm2-loading-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));

  span { height: 190px; }
}

.sm2-loading-metrics span,
.sm2-loading-toolbar,
.sm2-loading-grid span {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: linear-gradient(
    90deg,
    var(--bg-elevated) 25%,
    var(--bg-hover) 50%,
    var(--bg-elevated) 75%
  );
  background-size: 200% 100%;
  animation: sm2-skeleton 1.3s ease-in-out infinite;
}

@keyframes sm2-skeleton {
  to { background-position: -200% 0; }
}

.sm2-error {
  display: flex;
  align-items: center;
  justify-content: center;
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

.sm2-nav-item:focus-visible,
.sm2-icon-btn:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

@media (max-width: 820px) {
  .sm2-shell { grid-template-columns: 68px minmax(0, 1fr); }
  .sm2-rail-header { justify-content: center; padding: 0; }
  .sm2-rail-titles,
  .sm2-nav-label,
  .sm2-nav-text,
  .sm2-nav-count,
  .sm2-device-card > span:last-child { display: none; }
  .sm2-nav { padding-inline: 8px; }
  .sm2-nav-item {
    grid-template-columns: 1fr;
    justify-items: center;
    padding: 0;
  }
  .sm2-nav-item:hover { transform: none; }
  .sm2-rail-footer { padding: 8px; }
  .sm2-device-card { grid-template-columns: 1fr; padding: 8px; }
  .sm2-library-status { display: none; }
}

@media (max-width: 560px) {
  .sm2-heading-subtitle { display: none; }
  .sm2-topbar { padding-inline: 12px; }
}
</style>
