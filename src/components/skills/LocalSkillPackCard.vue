<template>
  <div class="pack-card" :class="{ 'all-installed': pack.installedCount >= pack.skillCount }" @click="$emit('open', pack)">
    <div class="icon-wrapper">
      <Boxes :size="20" />
    </div>

    <div class="pack-info">
      <div class="title-row">
        <h3 class="pack-name">{{ pack.name }}</h3>
        <span v-if="categoryLabel" class="category-badge">{{ categoryLabel }}</span>
        <span v-if="pack.installedCount >= pack.skillCount" class="all-installed-badge">
          <CheckCircle :size="10" />
          {{ t('skillManagerV2.builtinPacks.allInstalled') }}
        </span>
      </div>
      <div class="meta-row">
        <span class="meta-item">
          <Layers :size="11" />
          {{ t('skillManagerV2.builtinPacks.skills', { count: pack.skillCount }) }}
        </span>
        <span class="meta-item">
          <Folder :size="11" />
          {{ t('skillManagerV2.builtinPacks.categories', { count: pack.categories.length }) }}
        </span>
        <span class="meta-item" :class="{ done: pack.installedCount > 0 }">
          {{ t('skillManagerV2.builtinPacks.installedOf', { installed: pack.installedCount, total: pack.skillCount }) }}
        </span>
      </div>
      <div v-if="pack.categories.length > 0" class="category-chips">
        <span v-for="cat in pack.categories.slice(0, 5)" :key="cat.name" class="chip">{{ cat.name }}</span>
        <span v-if="pack.categories.length > 5" class="chip more">+{{ pack.categories.length - 5 }}</span>
      </div>
      <div v-else class="progress-track">
        <div class="progress-fill" :style="{ width: progressPercent + '%' }" />
      </div>
    </div>

    <div class="actions" @click.stop>
      <button class="action-btn primary" @click="$emit('open', pack)">
        <Eye :size="14" />
        {{ t('skillManagerV2.builtinPacks.viewSkills') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Boxes, CheckCircle, Layers, Folder, Eye } from 'lucide-vue-next'
import { packCategoryKey } from '../skill_manager/skillLabels'
import type { LocalSkillPack } from '../../stores/localSkills'

const props = defineProps<{
  pack: LocalSkillPack
}>()

defineEmits<{
  (e: 'open', pack: LocalSkillPack): void
}>()

const { t, te } = useI18n()

const progressPercent = computed(() => {
  if (props.pack.skillCount === 0) return 0
  return Math.round((props.pack.installedCount / props.pack.skillCount) * 100)
})

/** 包级分类的本地化标签，未知分类回退显示原始 id，无分类返回 null。 */
const categoryLabel = computed<string | null>(() => {
  const key = packCategoryKey(props.pack.category)
  if (!key || !props.pack.category) return null
  return te(key) ? t(key) : props.pack.category
})
</script>

<style scoped lang="scss">
.pack-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--accent-primary);
  }

  &.all-installed {
    border-left: 3px solid var(--success, #10b981);
  }
}

.icon-wrapper {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--bg-tertiary);
  color: var(--accent-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.pack-info {
  flex: 1;
  min-width: 0;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.pack-name {
  font-size: var(--text-base-plus);
  font-weight: 600;
  margin: 0;
  color: var(--text-primary);
}

.all-installed-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: var(--radius-xs);
  font-size: 10px;
  font-weight: 500;
  border: 1px solid #10b981;
  color: #10b981;
}

.category-badge {
  padding: 2px 8px;
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
  color: var(--accent-primary);
  font-size: 10px;
  font-weight: 600;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 11px;
  color: var(--text-tertiary);
  margin-top: 4px;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;

  &.done {
    color: #10b981;
  }
}

.category-chips {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.chip {
  padding: 1px 8px;
  border-radius: var(--radius-xs);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 10px;
  text-transform: capitalize;

  &.more {
    color: var(--text-tertiary);
  }
}

.progress-track {
  margin-top: 10px;
  height: 3px;
  border-radius: 2px;
  background: var(--bg-tertiary);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--accent-primary);
  transition: width 0.3s ease;
}

.actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: opacity var(--transition-fast);

  &.primary {
    background: var(--accent-primary);
    color: white;

    &:hover:not(:disabled) { opacity: 0.9; }
  }
}
</style>
