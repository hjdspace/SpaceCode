<script setup lang="ts">
/**
 * Skill Manager V2 — Install Page
 *
 * Layout: subtab cards (Local / GitHub / Marketplace) + import flow.
 * The local import flow uses the existing ImportDialog component.
 */

import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ImportDialog from './ImportDialog.vue'

const { t } = useI18n()

// ── State ─────────────────────────────────────────────────────────

const activeSubtab = ref<'local' | 'github' | 'marketplace'>('local')
const importDialog = ref<InstanceType<typeof ImportDialog> | null>(null)

// ── Handlers ───────────────────────────────────────────────────────

function handleImportClick(): void {
  importDialog.value?.open()
}
</script>

<template>
  <div class="ipm-page">
    <!-- Subtabs -->
    <div class="ipm-subtabs">
      <button
        :class="{ active: activeSubtab === 'local' }"
        @click="activeSubtab = 'local'"
      >
        {{ t('skillManagerV2.install.local') }}
      </button>
      <button
        :class="{ active: activeSubtab === 'github' }"
        @click="activeSubtab = 'github'"
      >
        {{ t('skillManagerV2.install.github') }}
      </button>
      <button
        :class="{ active: activeSubtab === 'marketplace' }"
        @click="activeSubtab = 'marketplace'"
      >
        {{ t('skillManagerV2.install.marketplace') }}
      </button>
    </div>

    <!-- Content -->
    <div class="ipm-content">
      <!-- Local Import -->
      <div v-if="activeSubtab === 'local'" class="ipm-card">
        <div class="ipm-card-icon">SK</div>
        <h3 class="ipm-card-title">{{ t('skillManagerV2.install.localTitle') }}</h3>
        <p class="ipm-card-desc">{{ t('skillManagerV2.install.localDesc') }}</p>
        <button class="ipm-btn primary" @click="handleImportClick">
          {{ t('skillManagerV2.actions.importFolder') }}
        </button>
      </div>

      <!-- GitHub -->
      <div v-else-if="activeSubtab === 'github'" class="ipm-card">
        <div class="ipm-card-icon">GH</div>
        <h3 class="ipm-card-title">{{ t('skillManagerV2.install.github') }}</h3>
        <p class="ipm-card-desc">{{ t('skillManagerV2.install.githubPlaceholder') }}</p>
      </div>

      <!-- Marketplace -->
      <div v-else class="ipm-card">
        <div class="ipm-card-icon">MP</div>
        <h3 class="ipm-card-title">{{ t('skillManagerV2.install.marketplace') }}</h3>
        <p class="ipm-card-desc">{{ t('skillManagerV2.install.marketplacePlaceholder') }}</p>
      </div>
    </div>

    <!-- Import Dialog -->
    <ImportDialog ref="importDialog" />
  </div>
</template>

<style scoped lang="scss">
.ipm-page {
  height: 100%;
  overflow-y: auto;
  padding: 16px 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

// ── Subtabs ───────────────────────────────────────────────────────

.ipm-subtabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--border-default);
  overflow-x: auto;

  button {
    height: 34px;
    padding: 0 16px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    transition: all 0.15s;

    &:hover {
      color: var(--text-primary);
    }
    &.active {
      color: var(--accent-primary);
      border-bottom-color: var(--accent-primary);
    }
  }
}

// ── Content ───────────────────────────────────────────────────────

.ipm-content {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 20px;
}

.ipm-card {
  max-width: 420px;
  width: 100%;
  padding: 28px 24px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  text-align: center;
}

.ipm-card-icon {
  width: 48px;
  height: 48px;
  display: grid;
  place-items: center;
  margin: 0 auto 16px;
  border-radius: var(--radius-md);
  background: var(--accent-primary-glow);
  color: var(--accent-primary);
  font-size: 16px;
  font-weight: 800;
}

.ipm-card-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 700;
  font-family: var(--font-display);
}

.ipm-card-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}

.ipm-btn {
  height: 36px;
  padding: 0 20px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    border-color: var(--border-strong);
    background: var(--bg-hover);
  }

  &.primary {
    border-color: var(--accent-primary);
    background: var(--accent-primary);
    color: #fff;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }
}
</style>
