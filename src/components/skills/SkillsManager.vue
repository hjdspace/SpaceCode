<template>
  <div class="skills-manager">
    <!-- Fixed header -->
    <div class="skills-header">
      <div class="header-content">
        <div class="header-left">
          <button class="close-btn" @click="handleClose" :title="t('common.close')">
            <ArrowLeft :size="18" />
          </button>
          <div>
            <h1 class="title">{{ t('skills.title') }}</h1>
            <p class="description">{{ t('skills.description') }}</p>
          </div>
        </div>
        <button v-if="viewTab === 'local'" class="btn btn-primary" @click="showCreate = true">
          <Plus :size="14" />
          {{ t('skills.newSkill') }}
        </button>
      </div>
      <!-- Segmented control -->
      <div class="tab-switcher">
        <button
          class="tab-btn"
          :class="{ active: viewTab === 'local' }"
          @click="viewTab = 'local'"
        >
          {{ t('skills.tabMySkills') }}
        </button>
        <button
          class="tab-btn"
          :class="{ active: viewTab === 'marketplace' }"
          @click="viewTab = 'marketplace'"
        >
          {{ t('skills.tabMarketplace') }}
        </button>
        <button
          class="tab-btn"
          :class="{ active: viewTab === 'library' }"
          @click="viewTab = 'library'"
        >
          {{ t('skills.localLibrary') }}
        </button>
      </div>
    </div>

    <!-- Main content -->
    <div v-if="viewTab === 'marketplace'" class="marketplace-container">
      <MarketplaceBrowser @installed="fetchSkills" />
    </div>
    <div v-else-if="viewTab === 'library'" class="library-container">
      <LocalSkillBrowser @installed="fetchSkills" />
    </div>
    <div v-else class="skills-content">
      <!-- Left: skill list -->
      <div class="skills-list-panel">
        <div class="search-box">
          <Search :size="14" class="search-icon" />
          <input
            v-model="search"
            :placeholder="t('skills.searchSkillsMy')"
            class="search-input"
          />
        </div>
        <div class="skills-list">
          <div v-if="globalSkills.length > 0" class="skill-group">
            <span class="group-label">{{ t('skills.groupGlobal') }}</span>
            <SkillListItem
              v-for="skill in globalSkills"
              :key="`${skill.source}:${skill.installedSource ?? 'default'}:${skill.name}`"
              :skill="skill"
              :selected="isSelected(skill)"
              @select="selected = skill"
              @delete="handleDelete"
            />
          </div>
          <div v-if="projectSkills.length > 0" class="skill-group">
            <span class="group-label">{{ t('skills.groupProject') }}</span>
            <SkillListItem
              v-for="skill in projectSkills"
              :key="`${skill.source}:${skill.installedSource ?? 'default'}:${skill.name}`"
              :skill="skill"
              :selected="isSelected(skill)"
              @select="selected = skill"
              @delete="handleDelete"
            />
          </div>
          <div v-if="installedSkills.length > 0" class="skill-group">
            <span class="group-label">{{ t('skills.groupInstalled') }}</span>
            <SkillListItem
              v-for="skill in installedSkills"
              :key="`${skill.source}:${skill.installedSource ?? 'default'}:${skill.name}`"
              :skill="skill"
              :selected="isSelected(skill)"
              @select="selected = skill"
              @delete="handleDelete"
            />
          </div>
          <div v-if="pluginSkills.length > 0" class="skill-group">
            <span class="group-label">{{ t('skills.groupPlugins') }}</span>
            <SkillListItem
              v-for="skill in pluginSkills"
              :key="skill.filePath || `${skill.source}:${skill.installedSource ?? 'default'}:${skill.name}`"
              :skill="skill"
              :selected="isSelected(skill)"
              @select="selected = skill"
              @delete="handleDelete"
            />
          </div>
          <div v-if="builtinSkills.length > 0" class="skill-group">
            <span class="group-label">{{ t('skills.groupBuiltin') }}</span>
            <SkillListItem
              v-for="skill in builtinSkills"
              :key="`builtin:${skill.name}`"
              :skill="skill"
              :selected="isSelected(skill)"
              :readonly="true"
              @select="selected = skill"
            />
          </div>
          <div v-if="filtered.length === 0" class="empty-state">
            <Zap :size="32" class="empty-icon" />
            <p class="empty-text">{{ search ? t('skills.noSkillsFound') : t('skills.noSkillsYet') }}</p>
            <button v-if="!search" class="btn btn-secondary" @click="showCreate = true">
              <Plus :size="12" />
              {{ t('skills.createOne') }}
            </button>
          </div>
        </div>
      </div>

      <!-- Divider -->
      <div class="divider" />

      <!-- Right: editor -->
      <div class="skill-editor-panel">
        <SkillEditor
          v-if="selected"
          :key="selected.filePath || `${selected.source}:${selected.name}`"
          :skill="selected"
          @save="handleSave"
          @delete="handleDelete"
        />
        <div v-else class="no-selection">
          <Zap :size="48" class="no-selection-icon" />
          <div class="no-selection-text">
            <p class="no-selection-title">{{ t('skills.noSkillSelected') }}</p>
            <p class="no-selection-desc">{{ t('skills.noSkillSelectedDesc') }}</p>
          </div>
          <button class="btn btn-secondary" @click="showCreate = true">
            <Plus :size="14" />
            {{ t('skills.newSkill') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Create Skill Dialog -->
    <CreateSkillDialog
      v-model:open="showCreate"
      @create="handleCreate"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Search, Zap, ArrowLeft } from 'lucide-vue-next'
import { useSkillsStore, type Skill } from '@/stores/skills'
import { useAppStore } from '@/stores/app'
import SkillListItem from './SkillListItem.vue'
import SkillEditor from './SkillEditor.vue'
import CreateSkillDialog from './CreateSkillDialog.vue'
import MarketplaceBrowser from './MarketplaceBrowser.vue'
import LocalSkillBrowser from './LocalSkillBrowser.vue'

const { t } = useI18n()
const skillsStore = useSkillsStore()
const appStore = useAppStore()

function handleClose() {
  appStore.showSkillsManager = false
}

const search = ref('')
const selected = ref<Skill | null>(null)
const showCreate = ref(false)
const viewTab = ref<'local' | 'marketplace' | 'library'>('local')

const loading = computed(() => skillsStore.loading)
const skills = computed(() => skillsStore.skills)

const filtered = computed(() => {
  const term = search.value.toLowerCase()
  return skills.value.filter(s =>
    s.name.toLowerCase().includes(term) ||
    s.description.toLowerCase().includes(term)
  )
})

const globalSkills = computed(() => filtered.value.filter(s => s.source === 'global'))
const projectSkills = computed(() => filtered.value.filter(s => s.source === 'project'))
const installedSkills = computed(() => filtered.value.filter(s => s.source === 'installed'))
const pluginSkills = computed(() => filtered.value.filter(s => s.source === 'plugin'))
const builtinSkills = computed(() => filtered.value.filter(s => s.source === 'builtin'))

function isSelected(skill: Skill): boolean {
  if (!selected.value) return false
  return selected.value.name === skill.name &&
    selected.value.source === skill.source &&
    selected.value.installedSource === skill.installedSource
}

async function fetchSkills() {
  const cwd = appStore.projectRoot || undefined
  await skillsStore.fetchSkills(cwd)
}

async function handleCreate(name: string, scope: 'global' | 'project', content: string) {
  try {
    const cwd = appStore.projectRoot || undefined
    const skill = await skillsStore.createSkill(name, scope, content, cwd)
    selected.value = skill
    showCreate.value = false
  } catch (err) {
    console.error('Failed to create skill:', err)
    alert(err instanceof Error ? err.message : 'Failed to create skill')
  }
}

async function handleSave(skill: Skill, content: string) {
  try {
    await skillsStore.saveSkill(skill, content)
  } catch (err) {
    console.error('Failed to save skill:', err)
    alert(err instanceof Error ? err.message : 'Failed to save skill')
  }
}

async function handleDelete(skill: Skill) {
  if (skill.source === 'builtin') return
  if (!confirm(t('skills.deleteConfirm', { name: skill.name }))) return
  try {
    await skillsStore.deleteSkill(skill)
    if (isSelected(skill)) {
      selected.value = null
    }
  } catch (err) {
    console.error('Failed to delete skill:', err)
    alert(err instanceof Error ? err.message : 'Failed to delete skill')
  }
}

onMounted(() => {
  fetchSkills()
})
</script>

<style lang="scss" scoped>
.skills-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.skills-header {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border-default);
  padding: 16px 20px 12px;
  background: var(--bg-secondary);
}

.header-content {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.description {
  font-size: 13px;
  color: var(--text-muted);
  margin: 4px 0 0;
}

.tab-switcher {
  display: flex;
  align-items: center;
  background: var(--bg-tertiary);
  border-radius: 6px;
  padding: 2px;
  width: fit-content;
}

.tab-btn {
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: var(--text-primary);
  }

  &.active {
    background: var(--bg-primary);
    color: var(--text-primary);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }
}

.marketplace-container {
  flex: 1;
  overflow: hidden;
}

.library-container {
  flex: 1;
  overflow: hidden;
}

.skills-content {
  display: flex;
  flex: 1;
  min-height: 0;
}

.skills-list-panel {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 12px;
}

.search-box {
  position: relative;
  margin-bottom: 8px;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
}

.search-input {
  width: 100%;
  padding: 8px 10px 8px 32px;
  border: 1px solid var(--border-default);
  border-radius: 6px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;

  &:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  &::placeholder {
    color: var(--text-muted);
  }
}

.skills-list {
  flex: 1;
  overflow-y: auto;
}

.skill-group {
  margin-bottom: 8px;
}

.group-label {
  display: block;
  padding: 4px 8px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  color: var(--text-muted);
}

.empty-icon {
  opacity: 0.4;
}

.empty-text {
  font-size: 12px;
  margin: 0;
}

.divider {
  width: 1px;
  background: var(--border-default);
  flex-shrink: 0;
}

.skill-editor-panel {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.no-selection {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: var(--text-muted);
}

.no-selection-icon {
  opacity: 0.3;
}

.no-selection-text {
  text-align: center;
}

.no-selection-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0;
}

.no-selection-desc {
  font-size: 12px;
  margin: 4px 0 0;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s;

  &.btn-primary {
    background: var(--accent-primary);
    color: white;

    &:hover {
      background: var(--accent-primary-hover);
    }
  }

  &.btn-secondary {
    background: var(--bg-secondary);
    border: 1px solid var(--border-default);
    color: var(--text-primary);

    &:hover {
      background: var(--bg-hover);
      border-color: var(--accent-primary);
    }
  }
}
</style>
