<template>
  <div class="local-skill-card" :class="{ installed: skill.isInstalled }" @click="$emit('select', skill)">
    <div class="card-header">
      <div class="icon-wrapper" :style="{ backgroundColor: categoryColor + '20', color: categoryColor }">
        <component :is="categoryIcon" :size="20" />
      </div>
      <div class="skill-info">
        <h3 class="skill-name">{{ skill.name }}</h3>
        <span class="category-badge" :style="{ backgroundColor: categoryColor + '15', color: categoryColor }">
          {{ categoryLabel }}
        </span>
      </div>
    </div>

    <p class="skill-description">{{ truncatedDescription }}</p>

    <div v-if="skill.tags?.length" class="tags-wrapper">
      <span v-for="tag in skill.tags.slice(0, 3)" :key="tag" class="tag">{{ tag }}</span>
    </div>

    <div class="card-footer">
      <span class="source-text">{{ t('skills.skillDetail.source') }}: {{ sourceDirName }}</span>
      <button
        v-if="!skill.isInstalled"
        class="install-btn"
        :disabled="isInstalling"
        @click.stop="$emit('install', skill.name)"
      >
        <Loader2 v-if="isInstalling" :size="14" class="spin" />
        <Download v-else :size="14" />
        {{ isInstalling ? '...' : t('skills.install') }}
      </button>
      <button
        v-else
        class="uninstall-btn"
        @click.stop="$emit('uninstall', skill.name)"
      >
        <Trash2 :size="14" />
        {{ t('skills.uninstall') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Download, Trash2, Loader2, Grid3x3, Palette, FileText, Code2, Brain, Server, Sparkles, MessageSquare, Package } from 'lucide-vue-next'
import type { LocalSkill } from '../../stores/localSkills'
import { CATEGORIES } from '../../stores/localSkills'

const props = defineProps<{
  skill: LocalSkill
  installing: boolean
}>()

defineEmits<{
  (e: 'select', skill: LocalSkill): void
  (e: 'install', name: string): void
  (e: 'uninstall', name: string): void
}>()

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

const categoryColor = computed(() => {
  const cat = CATEGORIES.find(c => c.id === props.skill.category)
  return cat?.color || '#6b7280'
})

const categoryIcon = computed(() => {
  const cat = CATEGORIES.find(c => c.id === props.skill.category)
  return iconComponents[cat?.icon || 'Package'] || Package
})

const categoryLabel = computed(() => {
  const cat = CATEGORIES.find(c => c.id === props.skill.category)
  return cat ? t(cat.labelKey) : t('skills.categories.other')
})

const truncatedDescription = computed(() => {
  const desc = props.skill.description
  return desc.length > 100 ? desc.slice(0, 100) + '...' : desc
})

const sourceDirName = computed(() => {
  return props.skill.sourceDir.split(/[\\/]/).pop() || props.skill.sourceDir
})

const isInstalling = computed(() => props.installing)
</script>

<style scoped lang="scss">
.local-skill-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 12px;

  &:hover {
    border-color: var(--accent-primary);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    transform: translateY(-2px);
  }

  &.installed {
    border-left: 3px solid var(--success);
  }
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.skill-info {
  flex: 1;
  min-width: 0;
}

.skill-name {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 4px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
}

.skill-description {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary);
  margin: 0;
}

.tags-wrapper {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.tag {
  padding: 2px 8px;
  background: var(--bg-tertiary);
  border-radius: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

.source-text {
  font-size: 11px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.install-btn,
.uninstall-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
}

.install-btn {
  background: var(--accent-primary);
  color: white;
  border: none;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }
}

.uninstall-btn {
  background: transparent;
  color: var(--error);
  border: 1px solid var(--error);

  &:hover {
    background: var(--error);
    color: white;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
