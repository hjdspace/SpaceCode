<script setup lang="ts">
/**
 * Skill Manager V2 — Install Page (Slice 3)
 *
 * Install page with sub-tabs: Local Import, GitHub, Marketplace.
 * Only Local Import is functional in Slice 3.
 *
 * Reference: AgentBro `src/components/skills-v2/InstallPage.tsx`
 */

import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ImportDialog from './ImportDialog.vue'

const { t } = useI18n()

type SubTab = 'local' | 'github' | 'marketplace'

const activeSubTab = ref<SubTab>('local')
const importDialog = ref<InstanceType<typeof ImportDialog> | null>(null)

const subTabs: Array<{ id: SubTab; labelKey: string }> = [
  { id: 'local', labelKey: 'skillManagerV2.install.local' },
  { id: 'github', labelKey: 'skillManagerV2.install.github' },
  { id: 'marketplace', labelKey: 'skillManagerV2.install.marketplace' },
]

function openImportDialog(): void {
  importDialog.value?.open()
}
</script>

<template>
  <div class="install-page">
    <!-- Sub-tab Navigation -->
    <div class="install-subtabs">
      <button
        v-for="tab in subTabs"
        :key="tab.id"
        class="install-subtab"
        :class="{ active: activeSubTab === tab.id }"
        @click="activeSubTab = tab.id"
      >
        {{ t(tab.labelKey) }}
      </button>
    </div>

    <!-- Sub-tab Content -->
    <div class="install-content">
      <!-- Local Import -->
      <div v-if="activeSubTab === 'local'" class="install-local">
        <div class="install-local-intro">
          <h3>{{ t('skillManagerV2.install.localTitle') }}</h3>
          <p>{{ t('skillManagerV2.install.localDesc') }}</p>
          <button class="install-local-btn" @click="openImportDialog">
            {{ t('skillManagerV2.install.selectAndImport') }}
          </button>
        </div>
      </div>

      <!-- GitHub Import (placeholder) -->
      <div v-else-if="activeSubTab === 'github'" class="install-github">
        <div class="install-placeholder">
          {{ t('skillManagerV2.install.githubPlaceholder') }}
        </div>
      </div>

      <!-- Marketplace (placeholder) -->
      <div v-else-if="activeSubTab === 'marketplace'" class="install-marketplace">
        <div class="install-placeholder">
          {{ t('skillManagerV2.install.marketplacePlaceholder') }}
        </div>
      </div>
    </div>

    <!-- Import Dialog -->
    <ImportDialog ref="importDialog" />
  </div>
</template>

<style scoped lang="scss">
.install-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.install-subtabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  border-bottom: 1px solid var(--border-color, #333);
}

.install-subtab {
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 13px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;

  &:hover {
    opacity: 0.8;
  }

  &.active {
    border-bottom-color: var(--accent-color, #007acc);
    color: var(--accent-color, #007acc);
  }
}

.install-content {
  flex: 1;
}

.install-local-intro {
  max-width: 500px;

  h3 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 8px;
  }

  p {
    font-size: 13px;
    opacity: 0.7;
    margin: 0 0 20px;
    line-height: 1.5;
  }
}

.install-local-btn {
  padding: 10px 24px;
  border: 1px solid var(--accent-color, #007acc);
  border-radius: 4px;
  background: var(--accent-color, #007acc);
  color: #fff;
  cursor: pointer;
  font-size: 14px;

  &:hover {
    opacity: 0.9;
  }
}

.install-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  opacity: 0.4;
  font-size: 14px;
}
</style>
