<template>
  <button
    type="button"
    class="working-dir-picker"
    data-testid="working-dir-trigger"
    @click="handleClick"
  >
    <Folder :size="13" />
    <span class="working-dir-value">{{ displayName }}</span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', path: string): void }>()

const { t } = useI18n()

const displayName = computed(() => {
  if (!props.modelValue) {
    return t('work.selectFolder')
  }
  const normalized = props.modelValue.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length ? parts[parts.length - 1] : props.modelValue
})

async function handleClick() {
  try {
    const result = await api.selectFolder()
    if (!result.canceled && result.filePaths.length > 0) {
      emit('update:modelValue', result.filePaths[0])
    }
  } catch (error) {
    console.error('Failed to select working directory:', error)
  }
}
</script>

<style scoped lang="scss">
.working-dir-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full);
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-primary);
  transition: background var(--transition-fast), border-color var(--transition-fast);
  max-width: 180px;
}

.working-dir-picker:hover {
  background: var(--bg-hover);
  border-color: var(--surface-border-strong);
}

.working-dir-value {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
