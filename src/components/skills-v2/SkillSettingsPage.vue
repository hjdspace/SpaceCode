<script setup lang="ts">
/**
 * Skill Manager V2 — Settings Page
 *
 * Layout: settings grid panels with form controls.
 */

import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSkillManagerStore } from '@/stores/skillManagerStore'
import type { SkillManagerSettings, InstallMode, LinkFailPolicy } from '@/types/skillManagerV2'

const { t } = useI18n()
const store = useSkillManagerStore()

// ── Local form state ───────────────────────────────────────────────

const form = ref<SkillManagerSettings | null>(null)
const saving = ref(false)
const saved = ref(false)

// Sync form with store settings
watch(
  () => store.settings,
  (newSettings) => {
    if (newSettings) {
      form.value = { ...newSettings }
    }
  },
  { immediate: true }
)

// ── Computed ───────────────────────────────────────────────────────

const hasForm = computed(() => form.value !== null)
const isDirty = computed(() => {
  if (!form.value || !store.settings) return false
  return JSON.stringify(form.value) !== JSON.stringify(store.settings)
})

// ── Handlers ───────────────────────────────────────────────────────

async function handleSave(): Promise<void> {
  if (!form.value) return
  saving.value = true
  await store.updateSettings(form.value)
  saving.value = false
  saved.value = true
  setTimeout(() => { saved.value = false }, 3000)
}

function handleReset(): void {
  if (store.settings) {
    form.value = { ...store.settings }
  }
}

async function handleOpenCenterPath(): Promise<void> {
  if (form.value) {
    await store.openPath(form.value.centerLibraryPath)
  }
}

function setInstallMode(mode: InstallMode): void {
  if (form.value) {
    form.value.defaultInstallMode = mode
  }
}

function setLinkFailPolicy(policy: LinkFailPolicy): void {
  if (form.value) {
    form.value.linkFailPolicy = policy
  }
}
</script>

<template>
  <div class="sst-page" v-if="hasForm && form">
    <!-- Center Library Path Panel -->
    <div class="sst-panel">
      <div class="sst-panel-head">
        <strong>{{ t('skillManagerV2.settings.centerLibraryPath') }}</strong>
      </div>
      <div class="sst-panel-body">
        <div class="sst-path-row">
          <input
            v-model="form.centerLibraryPath"
            class="sst-input"
            type="text"
            readonly
          />
          <button class="sst-btn" @click="handleOpenCenterPath">
            {{ t('skillManagerV2.actions.openPath') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Default Install Mode Panel -->
    <div class="sst-panel">
      <div class="sst-panel-head">
        <strong>{{ t('skillManagerV2.settings.defaultInstallMode') }}</strong>
      </div>
      <div class="sst-panel-body">
        <div class="sst-segmented">
          <button
            :class="{ active: form.defaultInstallMode === 'link' }"
            @click="setInstallMode('link')"
          >
            {{ t('skillManagerV2.settings.modeLink') }}
          </button>
          <button
            :class="{ active: form.defaultInstallMode === 'copy' }"
            @click="setInstallMode('copy')"
          >
            {{ t('skillManagerV2.settings.modeCopy') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Link Fail Policy Panel -->
    <div class="sst-panel">
      <div class="sst-panel-head">
        <strong>{{ t('skillManagerV2.settings.linkFailPolicy') }}</strong>
      </div>
      <div class="sst-panel-body">
        <div class="sst-segmented">
          <button
            :class="{ active: form.linkFailPolicy === 'ask' }"
            @click="setLinkFailPolicy('ask')"
          >
            {{ t('skillManagerV2.settings.policyAsk') }}
          </button>
          <button
            :class="{ active: form.linkFailPolicy === 'copy' }"
            @click="setLinkFailPolicy('copy')"
          >
            {{ t('skillManagerV2.settings.policyCopy') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Scan Options Panel -->
    <div class="sst-panel">
      <div class="sst-panel-head">
        <strong>{{ t('skillManagerV2.settings.startupScan') }}</strong>
      </div>
      <div class="sst-panel-body">
        <label class="sst-toggle">
          <input type="checkbox" v-model="form.startupScan" />
          <span class="sst-toggle-slider"></span>
          <span class="sst-toggle-label">{{ t('skillManagerV2.settings.startupScan') }}</span>
        </label>
      </div>
    </div>

    <!-- Show Unmanaged Panel -->
    <div class="sst-panel">
      <div class="sst-panel-head">
        <strong>{{ t('skillManagerV2.settings.showUnmanaged') }}</strong>
      </div>
      <div class="sst-panel-body">
        <label class="sst-toggle">
          <input type="checkbox" v-model="form.showUnmanaged" />
          <span class="sst-toggle-slider"></span>
          <span class="sst-toggle-label">{{ t('skillManagerV2.settings.showUnmanaged') }}</span>
        </label>
      </div>
    </div>

    <!-- Save Bar -->
    <div class="sst-save-bar">
      <span v-if="saved" class="sst-saved-msg">
        {{ t('skillManagerV2.settings.saved') }}
      </span>
      <div class="sst-save-actions">
        <button
          class="sst-btn"
          :disabled="!isDirty || saving"
          @click="handleReset"
        >
          {{ t('skillManagerV2.actions.cancel') }}
        </button>
        <button
          class="sst-btn primary"
          :disabled="!isDirty || saving"
          @click="handleSave"
        >
          {{ saving ? t('skillManagerV2.loading') : t('skillManagerV2.actions.confirm') }}
        </button>
      </div>
    </div>
  </div>

  <!-- Loading -->
  <div v-else class="sst-loading">
    {{ t('skillManagerV2.loading') }}
  </div>
</template>

<style scoped lang="scss">
.sst-page {
  height: 100%;
  overflow-y: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

// ── Panels ────────────────────────────────────────────────────────

.sst-panel {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  overflow: hidden;
}

.sst-panel-head {
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--surface-soft);

  strong {
    font-size: 13px;
    font-weight: 700;
  }
}

.sst-panel-body {
  padding: 14px;
}

// ── Path Row ──────────────────────────────────────────────────────

.sst-path-row {
  display: flex;
  gap: 8px;
}

.sst-input {
  flex: 1;
  height: 34px;
  min-width: 0;
  padding: 0 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);
  color: var(--text-primary);
  font-size: 12px;
  font-family: var(--font-mono);
  outline: none;
}

// ── Buttons ───────────────────────────────────────────────────────

.sst-btn {
  height: 34px;
  padding: 0 16px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;

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

// ── Segmented Control ─────────────────────────────────────────────

.sst-segmented {
  display: inline-flex;
  padding: 3px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--surface-soft);

  button {
    height: 28px;
    min-width: 64px;
    padding: 0 14px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;

    &.active {
      background: var(--bg-elevated);
      color: var(--text-primary);
      box-shadow: var(--shadow-sm);
    }
  }
}

// ── Toggle Switch ─────────────────────────────────────────────────

.sst-toggle {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;

  input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
}

.sst-toggle-slider {
  width: 36px;
  height: 20px;
  border-radius: var(--radius-full);
  background: var(--border-strong);
  position: relative;
  transition: background 0.2s;

  &::before {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
  }

  input:checked + & {
    background: var(--accent-primary);
  }
  input:checked + &::before {
    transform: translateX(16px);
  }
}

.sst-toggle-label {
  font-size: 12px;
  color: var(--text-secondary);
}

// ── Save Bar ──────────────────────────────────────────────────────

.sst-save-bar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 8px;
}

.sst-saved-msg {
  font-size: 12px;
  color: var(--success);
  font-weight: 600;
}

.sst-save-actions {
  display: flex;
  gap: 8px;
}

.sst-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  opacity: 0.5;
}
</style>
