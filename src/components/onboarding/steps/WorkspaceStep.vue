<template>
  <span class="ob-label">{{ t('onboarding.workspace.path') }}</span>
  <div class="ob-row">
    <input
      class="ob-input is-mono path-input"
      :value="settingsStore.projectRoot"
      spellcheck="false"
      :placeholder="defaultPath || '~/Documents/SpaceCode'"
      @change="applyPath(($event.target as HTMLInputElement).value.trim())"
    >
    <button type="button" class="ob-btn ob-btn--ghost ob-btn--sm" @click="browse">
      <FolderOpen :size="12" />
      {{ t('onboarding.workspace.browse') }}
    </button>
  </div>

  <template v-if="recent.length">
    <div class="ob-group-title">{{ t('onboarding.workspace.recent') }}</div>
    <div class="recent-list">
      <button v-for="path in recent" :key="path" type="button" class="ob-chip is-recent" @click="applyPath(path)">
        <span class="mono">{{ path }}</span>
      </button>
    </div>
  </template>

  <div class="ob-row default-row">
    <button type="button" class="ob-btn ob-btn--ghost ob-btn--sm" :disabled="busy" @click="useDefault">
      {{ t('onboarding.workspace.useDefault') }}
    </button>
    <span v-if="defaultPath" class="ob-endpoint">{{ defaultPath }}</span>
  </div>

  <p class="ob-hint">{{ t('onboarding.workspace.note') }}</p>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { FolderOpen } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import { getRecentProjectRoots, recordRecentProjectRoot } from '@/utils/recentProjectRoots'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const appStore = useAppStore()

const defaultPath = ref('')
const recent = ref<string[]>([])
const busy = ref(false)

function applyPath(path: string) {
  if (!path) return
  settingsStore.projectRoot = path
  appStore.setProjectRoot(path)
  recordRecentProjectRoot(path)
  recent.value = getRecentProjectRoots()
  void api.ensureDir(path)
  void settingsStore.saveSettings()
}

async function browse() {
  try {
    const result = await api.selectFolder()
    if (!result.canceled && result.filePaths[0]) applyPath(result.filePaths[0])
  } catch (err) {
    console.error('[Onboarding] Failed to browse folder:', err)
  }
}

async function useDefault() {
  busy.value = true
  try {
    const path = defaultPath.value || (await api.ensureDefaultWorkspace())
    if (path) {
      defaultPath.value = path
      applyPath(path)
    }
  } catch (err) {
    console.error('[Onboarding] Default workspace unavailable:', err)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  recent.value = getRecentProjectRoots()
  try {
    defaultPath.value = await api.ensureDefaultWorkspace()
  } catch { /* 展示用，拿不到就退回占位文案 */ }
})
</script>

<style lang="scss" scoped>
.path-input {
  flex: 1;
  min-width: 200px;
}

.recent-list {
  display: grid;
  gap: 6px;
  justify-items: start;
}

.is-recent {
  max-width: 100%;

  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.default-row {
  margin-top: 12px;
}
</style>
