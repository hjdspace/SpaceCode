<script setup lang="ts">
/**
 * Skill Manager V2 — Settings Page
 *
 * Displays and edits Skill Manager settings:
 * - Center library path (read-only)
 * - Default install mode (link / copy)
 * - Link fail policy (ask / copy)
 * - Startup scan toggle
 * - Show unmanaged toggle
 *
 * Reference: AgentBro `src/components/skills-v2/SettingsPageV2.tsx`
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { InstallMode, LinkFailPolicy } from '@/types/skillManagerV2'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── Local form state (synced from store settings) ─────────────────

const centerLibraryPath = computed(() => store.settings?.centerLibraryPath ?? '')
const defaultInstallMode = computed<InstallMode>(() => store.settings?.defaultInstallMode ?? 'link')
const linkFailPolicy = computed<LinkFailPolicy>(() => store.settings?.linkFailPolicy ?? 'copy')
const startupScan = computed<boolean>(() => store.settings?.startupScan ?? true)
const showUnmanaged = computed<boolean>(() => store.settings?.showUnmanaged ?? true)

// ── Handlers ──────────────────────────────────────────────────────

async function handleInstallModeChange(e: Event): Promise<void> {
  const target = e.target as HTMLSelectElement
  await store.updateSettings({ defaultInstallMode: target.value as InstallMode })
}

async function handleLinkFailPolicyChange(e: Event): Promise<void> {
  const target = e.target as HTMLSelectElement
  await store.updateSettings({ linkFailPolicy: target.value as LinkFailPolicy })
}

async function handleStartupScanChange(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement
  await store.updateSettings({ startupScan: target.checked })
}

async function handleShowUnmanagedChange(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement
  await store.updateSettings({ showUnmanaged: target.checked })
}
</script>

<template>
  <div class="skill-settings-page">
    <h2 class="settings-title">{{ t('skillManagerV2.settings.title') }}</h2>

    <!-- Center Library Path (read-only) -->
    <div class="settings-row">
      <label class="settings-label">{{ t('skillManagerV2.settings.centerLibraryPath') }}</label>
      <input
        type="text"
        class="settings-input readonly"
        :value="centerLibraryPath"
        readonly
      />
    </div>

    <!-- Default Install Mode -->
    <div class="settings-row">
      <label class="settings-label">{{ t('skillManagerV2.settings.defaultInstallMode') }}</label>
      <select
        class="settings-select"
        :value="defaultInstallMode"
        @change="handleInstallModeChange"
      >
        <option value="link">{{ t('skillManagerV2.settings.modeLink') }}</option>
        <option value="copy">{{ t('skillManagerV2.settings.modeCopy') }}</option>
      </select>
    </div>

    <!-- Link Fail Policy -->
    <div class="settings-row">
      <label class="settings-label">{{ t('skillManagerV2.settings.linkFailPolicy') }}</label>
      <select
        class="settings-select"
        :value="linkFailPolicy"
        @change="handleLinkFailPolicyChange"
      >
        <option value="ask">{{ t('skillManagerV2.settings.policyAsk') }}</option>
        <option value="copy">{{ t('skillManagerV2.settings.policyCopy') }}</option>
      </select>
    </div>

    <!-- Startup Scan -->
    <div class="settings-row">
      <label class="settings-label">{{ t('skillManagerV2.settings.startupScan') }}</label>
      <input
        type="checkbox"
        class="settings-checkbox"
        :checked="startupScan"
        @change="handleStartupScanChange"
      />
    </div>

    <!-- Show Unmanaged -->
    <div class="settings-row">
      <label class="settings-label">{{ t('skillManagerV2.settings.showUnmanaged') }}</label>
      <input
        type="checkbox"
        class="settings-checkbox"
        :checked="showUnmanaged"
        @change="handleShowUnmanagedChange"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.skill-settings-page {
  max-width: 600px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.settings-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.settings-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.settings-label {
  font-size: 13px;
  font-weight: 500;
}

.settings-input {
  padding: 8px 10px;
  border: 1px solid var(--border-color, #555);
  border-radius: 4px;
  background: var(--bg-input, #2a2a2a);
  color: inherit;
  font-size: 13px;

  &.readonly {
    opacity: 0.7;
    cursor: default;
  }
}

.settings-select {
  padding: 8px 10px;
  border: 1px solid var(--border-color, #555);
  border-radius: 4px;
  background: var(--bg-input, #2a2a2a);
  color: inherit;
  font-size: 13px;
  cursor: pointer;
}

.settings-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
}
</style>
