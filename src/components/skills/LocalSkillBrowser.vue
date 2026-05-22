<template>
  <div class="local-skill-browser">
    <div class="toolbar">
      <div class="search-box">
        <Search :size="16" />
        <input
          type="text"
          :placeholder="t('skills.searchSkills')"
          :value="store.searchQuery"
          @input="store.setSearchQuery(($event.target as HTMLInputElement).value)"
        />
      </div>

      <div class="view-toggle">
        <button
          class="toggle-btn"
          :class="{ active: store.viewMode === 'grid' }"
          @click="store.setViewMode('grid')"
          :title="t('skills.viewGrid')"
        >
          <LayoutGrid :size="16" />
        </button>
        <button
          class="toggle-btn"
          :class="{ active: store.viewMode === 'list' }"
          @click="store.setViewMode('list')"
          :title="t('skills.viewList')"
        >
          <List :size="16" />
        </button>
      </div>
    </div>

    <div class="browser-content">
      <CategorySidebar
        v-model="store.selectedCategory"
        :categoriesWithCount="store.categoriesWithCount"
        :customDirectories="store.customDirectories"
        @add-directory="showDirectoryManager = true"
        @remove-directory="handleRemoveDirectory"
      />

      <SkillGrid
        :skills="store.filteredSkills"
        :viewMode="store.viewMode"
        :installingId="store.installingId"
        @select="handleSelectSkill"
        @install="handleInstall"
        @uninstall="handleUninstall"
      />

      <LocalSkillDetail
        :skill="selectedSkill"
        :isInstalling="!!store.installingId"
        @close="selectedSkill = null"
        @install="handleInstall"
        @uninstall="handleUninstall"
      />
    </div>

    <DirectoryManager
      v-model="showDirectoryManager"
      :customDirectories="store.customDirectories"
      @add="handleAddDirectory"
      @remove="handleRemoveDirectory"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Search,
  LayoutGrid,
  List
} from 'lucide-vue-next'
import { useLocalSkillsStore, type LocalSkill } from '../../stores/localSkills'
import CategorySidebar from './CategorySidebar.vue'
import SkillGrid from './SkillGrid.vue'
import LocalSkillDetail from './LocalSkillDetail.vue'
import DirectoryManager from './DirectoryManager.vue'

const { t } = useI18n()
const store = useLocalSkillsStore()
const selectedSkill = ref<LocalSkill | null>(null)
const showDirectoryManager = ref(false)

onMounted(async () => {
  await store.loadCustomDirectories()
  await store.fetchLocalSkills()
})

function handleSelectSkill(skill: LocalSkill) {
  selectedSkill.value = skill
}

async function handleInstall(name: string, scope?: 'global' | 'project') {
  try {
    const targetScope = scope || 'global'
    await store.installSkill(name, targetScope)
    alert(t('skills.installSuccess'))
  } catch (err) {
    console.error('Failed to install skill:', err)
    alert(`Failed to install: ${err instanceof Error ? err.message : err}`)
  }
}

async function handleUninstall(name: string) {
  try {
    await store.uninstallSkill(name)
    alert(t('skills.uninstallSuccess'))
  } catch (err) {
    console.error('Failed to uninstall skill:', err)
    alert(`Failed to uninstall: ${err instanceof Error ? err.message : err}`)
  }
}

async function handleAddDirectory(dirPath: string) {
  try {
    await store.addCustomDirectory(dirPath)
    alert(t('skills.directoryManager.addSuccess'))
  } catch (err) {
    console.error('Failed to add directory:', err)
    alert(`Failed to add: ${err instanceof Error ? err.message : err}`)
  }
}

async function handleRemoveDirectory(dirPath: string) {
  try {
    await store.removeCustomDirectory(dirPath)
  } catch (err) {
    console.error('Failed to remove directory:', err)
    alert(`Failed to remove: ${err instanceof Error ? err.message : err}`)
  }
}
</script>

<style scoped lang="scss">
.local-skill-browser {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  gap: 12px;
}

.search-box {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 8px;

  input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 13px;

    &::placeholder {
      color: var(--text-tertiary);
    }
  }
}

.view-toggle {
  display: flex;
  gap: 4px;
}

.toggle-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s;

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }
}

.browser-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

@media (max-width: 1024px) {
  .browser-content {
    flex-direction: column;
  }

  .local-skill-browser {
    overflow-y: auto;
  }

  :deep(.category-sidebar) {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--border-color);
    max-height: 200px;
  }

  :deep(.skill-detail) {
    width: 100%;
    border-left: none;
    border-top: 1px solid var(--border-color);
  }

  :deep(.no-selection) {
    display: none;
  }
}
</style>
