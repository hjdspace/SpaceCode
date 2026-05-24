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
        v-model:selectedDirectory="store.selectedDirectory"
        :categoriesWithCount="store.categoriesWithCount"
        :customDirectories="store.customDirectories"
        @add-directory="showDirectoryManager = true"
        @remove-directory="handleRemoveDirectory"
      />

      <div class="main-pane">
        <div v-if="store.filteredBundles.length > 0" class="bundles-section">
          <div class="section-title">
            <Package :size="14" />
            <span>{{ t('skills.bundle.sectionTitle') }}</span>
            <span class="count">{{ store.filteredBundles.length }}</span>
          </div>
          <LocalSkillBundleCard
            v-for="b in store.filteredBundles"
            :key="b.id"
            :bundle="b"
            :skills="store.getBundleSkills(b.id)"
            :installing="store.installingId === b.id"
            @install="handleBundleInstall"
            @uninstall="handleBundleUninstall"
            @selectSkill="handleSelectSkill"
          />
        </div>

        <div v-if="store.filteredSkills.length > 0" class="skills-section">
          <div class="section-title">
            <LayoutGrid :size="14" />
            <span>{{ t('skills.skillsSectionTitle') }}</span>
            <span class="count">{{ store.filteredSkills.length }}</span>
          </div>
          <SkillGrid
            :skills="store.filteredSkills"
            :viewMode="store.viewMode"
            :installingId="store.installingId"
            @select="handleSelectSkill"
            @install="handleInstall"
            @uninstall="handleUninstall"
          />
        </div>

        <div
          v-if="store.filteredBundles.length === 0 && store.filteredSkills.length === 0"
          class="empty-pane"
        >
          <PackageOpen :size="48" />
          <p>{{ t('skills.emptyLibrary') }}</p>
          <span>{{ t('skills.emptyLibraryDesc') }}</span>
        </div>
      </div>

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

    <InstallScopeDialog
      v-model:open="showInstallScope"
      :skillName="installingSkillName"
      @confirm="handleInstallScopeConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Search,
  LayoutGrid,
  List,
  Package,
  PackageOpen
} from 'lucide-vue-next'
import { useLocalSkillsStore, type LocalSkill, type LocalSkillBundle } from '../../stores/localSkills'
import { useAppStore } from '@/stores/app'
import CategorySidebar from './CategorySidebar.vue'
import SkillGrid from './SkillGrid.vue'
import LocalSkillDetail from './LocalSkillDetail.vue'
import DirectoryManager from './DirectoryManager.vue'
import InstallScopeDialog from './InstallScopeDialog.vue'
import LocalSkillBundleCard from './LocalSkillBundleCard.vue'

const { t } = useI18n()
const store = useLocalSkillsStore()
const appStore = useAppStore()
const selectedSkill = ref<LocalSkill | null>(null)
const showDirectoryManager = ref(false)
const showInstallScope = ref(false)
const installingSkillName = ref('')
type PendingInstall =
  | { kind: 'skill', name: string }
  | { kind: 'bundle', bundle: LocalSkillBundle }
const pendingInstall = ref<PendingInstall | null>(null)

const emit = defineEmits<{
  installed: []
}>()

onMounted(async () => {
  await store.loadCustomDirectories()
  const cwd = appStore.projectRoot || undefined
  await store.fetchLocalSkills(cwd)
})

function handleSelectSkill(skill: LocalSkill) {
  selectedSkill.value = skill
}

async function handleInstall(name: string, scope?: 'global' | 'project') {
  if (scope) {
    try {
      const cwd = appStore.projectRoot || undefined
      await store.installSkill(name, scope, cwd)
      emit('installed')
    } catch (err) {
      console.error('Failed to install skill:', err)
      alert(`Failed to install: ${err instanceof Error ? err.message : err}`)
    }
  } else {
    pendingInstall.value = { kind: 'skill', name }
    installingSkillName.value = name
    showInstallScope.value = true
  }
}

function handleBundleInstall(bundle: LocalSkillBundle) {
  pendingInstall.value = { kind: 'bundle', bundle }
  installingSkillName.value = bundle.name
  showInstallScope.value = true
}

async function handleBundleUninstall(bundle: LocalSkillBundle) {
  if (!confirm(t('skills.bundle.confirmUninstall', { name: bundle.name }))) return
  try {
    const cwd = appStore.projectRoot || undefined
    await store.uninstallBundle(bundle.name, cwd)
    emit('installed')
  } catch (err) {
    console.error('Failed to uninstall bundle:', err)
    alert(`Failed to uninstall bundle: ${err instanceof Error ? err.message : err}`)
  }
}

async function handleInstallScopeConfirm(scope: 'global' | 'project') {
  const target = pendingInstall.value
  pendingInstall.value = null
  if (!target) return
  const cwd = appStore.projectRoot || undefined
  try {
    if (target.kind === 'bundle') {
      await store.installBundle(target.bundle.id, scope, cwd)
    } else {
      await store.installSkill(target.name, scope, cwd)
    }
    emit('installed')
  } catch (err) {
    console.error('Failed to install:', err)
    alert(`Failed to install: ${err instanceof Error ? err.message : err}`)
  }
}

async function handleUninstall(name: string) {
  try {
    const cwd = appStore.projectRoot || undefined
    await store.uninstallSkill(name, cwd)
    emit('installed')
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

.main-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.bundles-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 16px 8px;
}

.skills-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 8px 16px 16px;
}

.empty-pane {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  gap: 8px;
  color: var(--text-tertiary);

  p {
    font-size: 16px;
    font-weight: 500;
    margin: 0;
  }

  span {
    font-size: 13px;
  }
}

.section-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-tertiary);

  .count {
    background: var(--bg-tertiary);
    color: var(--text-secondary);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 500;
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
