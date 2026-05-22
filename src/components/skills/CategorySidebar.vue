<template>
  <div class="category-sidebar">
    <div class="section">
      <h3 class="section-title">{{ t('skills.categories') ? '' : 'Categories' }}</h3>
      <div class="category-list">
        <button
          v-for="cat in categoriesWithCount"
          :key="cat.id"
          class="category-item"
          :class="{ active: modelValue === cat.id }"
          @click="$emit('update:modelValue', cat.id)"
        >
          <component :is="getIconComponent(cat.icon)" :size="16" />
          <span class="category-label">{{ t(cat.labelKey) }}</span>
          <span class="count-badge">{{ cat.count }}</span>
        </button>
      </div>
    </div>

    <div class="section directories-section">
      <div class="section-header">
        <h3 class="section-title">{{ t('skills.customDirectories') }}</h3>
        <button class="add-dir-btn" @click="$emit('add-directory')" title="Add Directory">
          <Plus :size="14" />
        </button>
      </div>

      <div class="builtin-dir">
        <FolderOpen :size="14" />
        <span>{{ t('skills.directoryManager.builtinDir') }}</span>
      </div>

      <div v-if="customDirectories.length === 0" class="empty-dirs">
        {{ t('skills.noCustomDirectories') }}
      </div>

      <div v-else class="custom-dirs-list">
        <div
          v-for="dir in customDirectories"
          :key="dir"
          class="custom-dir-item"
          :class="{ active: selectedDirectory === dir }"
          :title="dir"
          @click="handleDirClick(dir)"
        >
          <Folder :size="14" />
          <span class="dir-name">{{ getDirectoryName(dir) }}</span>
          <button
            class="remove-btn"
            @click.stop="$emit('remove-directory', dir)"
            title="Remove Directory"
          >
            <X :size="12" />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  Grid3x3,
  Palette,
  FileText,
  Code2,
  Brain,
  Server,
  Sparkles,
  MessageSquare,
  Package,
  Plus,
  FolderOpen,
  Folder,
  X
} from 'lucide-vue-next'
import { CATEGORIES, type Category } from '../../stores/localSkills'

const props = defineProps<{
  modelValue: string
  categoriesWithCount: Category[]
  customDirectories: string[]
  selectedDirectory?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'update:selectedDirectory', value: string | null): void
  (e: 'add-directory'): void
  (e: 'remove-directory', dirPath: string): void
}>()

function handleDirClick(dir: string) {
  if (props.selectedDirectory === dir) {
    emit('update:selectedDirectory', null)
  } else {
    emit('update:selectedDirectory', dir)
  }
}

const { t } = useI18n()

const iconComponents: Record<string, any> = {
  'Grid3x3': Grid3x3,
  'Palette': Palette,
  'FileText': FileText,
  'Code2': Code2,
  'Brain': Brain,
  'Server': Server,
  'Sparkles': Sparkles,
  'MessageSquare': MessageSquare,
  'Package': Package
}

function getIconComponent(iconName: string): any {
  return iconComponents[iconName] || Package
}

function getDirectoryName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}
</script>

<style scoped lang="scss">
.category-sidebar {
  width: 200px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 16px;
  overflow-y: auto;
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-primary);
  font-size: 13px;

  &:hover {
    background: var(--bg-tertiary);
  }

  &.active {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);

    .count-badge {
      background: var(--accent-primary);
      color: white;
    }
  }
}

.category-label {
  flex: 1;
  text-align: left;
}

.count-badge {
  padding: 2px 6px;
  background: var(--bg-tertiary);
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
  min-width: 20px;
  text-align: center;
}

.directories-section {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.add-dir-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background: transparent;
  border: 1px solid var(--border-color);
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.2s;

  &:hover {
    background: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }
}

.builtin-dir,
.custom-dir-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.builtin-dir {
  background: var(--bg-tertiary);
  margin-bottom: 4px;
}

.custom-dirs-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.custom-dir-item {
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--bg-tertiary);
  }

  &.active {
    background: var(--accent-primary-glow);
    color: var(--accent-primary);
  }

  .dir-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .remove-btn {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    opacity: 0;
    transition: all 0.2s;

    &:hover {
      background: var(--error);
      color: white;
    }
  }

  &:hover .remove-btn {
    opacity: 1;
  }
}

.empty-dirs {
  padding: 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}
</style>
