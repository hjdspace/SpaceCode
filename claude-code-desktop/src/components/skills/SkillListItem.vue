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
      :class="{ confirm: confirmDelete }"
      @click.stop="handleDelete"
      :title="confirmDelete ? 'Click again to confirm' : 'Delete skill'"
    >
      <Trash2 :size="12" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { Zap, Trash2 } from 'lucide-vue-next'
import type { Skill } from '@/stores/skills'

interface Props {
  skill: Skill
  selected: boolean
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: []
  delete: [skill: Skill]
}>()

const hovered = ref(false)
const confirmDelete = ref(false)

const showDelete = computed(() => hovered.value || confirmDelete.value)

function handleDelete() {
  if (confirmDelete.value) {
    emit('delete', props.skill)
    confirmDelete.value = false
  } else {
    confirmDelete.value = true
    setTimeout(() => confirmDelete.value = false, 3000)
  }
}
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

  &.confirm {
    opacity: 1;
    background: #dc3545;
    color: white;

    &:hover {
      background: #c82333;
    }
  }
}
</style>
