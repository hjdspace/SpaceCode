<template>
  <div class="file-attachment-card" :title="file.path">
    <div class="file-attachment-icon" aria-hidden="true">
      <FileText :size="20" />
      <span class="file-attachment-badge">{{ extension }}</span>
    </div>
    <div class="file-attachment-meta">
      <span class="file-attachment-name">{{ file.name }}</span>
      <span class="file-attachment-type">{{ extension }}</span>
    </div>
    <button
      v-if="removable"
      type="button"
      class="file-attachment-remove"
      :title="t('chatInput.removeAttachment')"
      :aria-label="t('chatInput.removeAttachment')"
      @click.stop="$emit('remove')"
    >
      <X :size="12" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { FileText, X } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { Attachment } from '@/types'

const props = withDefaults(defineProps<{
  file: Attachment
  removable?: boolean
}>(), {
  removable: false,
})

defineEmits<{
  remove: []
}>()

const { t } = useI18n()

/** 卡片上展示的大写类型标签（MD / TSX / PDF…），无扩展名时回退 FILE */
const extension = computed(() => {
  const name = props.file.name
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return 'FILE'
  return name.slice(dot + 1).toUpperCase().slice(0, 4)
})
</script>

<style lang="scss" scoped>
.file-attachment-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  max-width: 240px;
  padding: 10px 12px;
  border: 1px solid var(--surface-border);
  border-radius: 10px;
  background: var(--bg-secondary);
}

.file-attachment-icon {
  position: relative;
  flex: 0 0 34px;
  width: 34px;
  height: 38px;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 4px;
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-muted);

  svg {
    position: absolute;
    top: 5px;
    left: 7px;
    opacity: 0.35;
  }
}

.file-attachment-badge {
  position: relative;
  max-width: 30px;
  padding: 1px 3px;
  border-radius: 3px;
  background: #3b82f6;
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0.2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-attachment-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.file-attachment-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-attachment-type {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.file-attachment-remove {
  position: absolute;
  top: -7px;
  right: -7px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--surface-border);
  border-radius: 50%;
  background: var(--bg-primary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;

  &:hover {
    color: var(--text-primary);
    border-color: var(--surface-border-strong);
  }
}
</style>
