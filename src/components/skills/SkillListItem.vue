<template>
  <div
    class="skill-list-item"
    :class="{ selected }"
    @click="$emit('select')"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <Zap :size="16" class="skill-icon" />
    <div class="skill-info">
      <span class="skill-name">/{{ skill.name }}</span>
      <p class="skill-desc">{{ skill.description }}</p>
    </div>
    <button
      v-if="showDelete"
      class="delete-btn"
      @click.stop="emit('delete', props.skill)"
      :title="t('skills.editor.deleteSkill')"
    >
      <Trash2 :size="12" />
    </button>
    <span v-else-if="readonly" class="readonly-badge" :title="t('skills.builtinReadonly')">
      {{ t('skills.builtin') }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Zap, Trash2 } from 'lucide-vue-next'
import type { Skill } from '@/stores/skills'

interface Props {
  skill: Skill
  selected: boolean
  readonly?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: []
  delete: [skill: Skill]
}>()

const { t } = useI18n()

const hovered = ref(false)

const showDelete = computed(() => hovered.value && !props.readonly && props.skill.source !== 'builtin')
</script>

<style lang="scss" scoped>
.skill-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--bg-hover);
  }

  &.selected {
    background: var(--accent-primary-muted, rgba(var(--accent-primary-rgb), 0.1));
    color: var(--accent-primary);
  }
}

.skill-icon {
  flex-shrink: 0;
  color: var(--text-muted);
}

.skill-info {
  flex: 1;
  min-width: 0;
}

.skill-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  display: block;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-desc {
  font-size: 11px;
  color: var(--text-muted);
  margin: 2px 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.delete-btn {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;

  .skill-list-item:hover & {
    opacity: 1;
  }

  &:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
}

.readonly-badge {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  border: 1px solid var(--border-default);
  background: var(--bg-tertiary);
}
</style>
