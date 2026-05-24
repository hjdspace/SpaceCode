<template>
  <div
    v-if="show"
    class="context-warning-bar"
    :class="warningLevel"
    role="status"
  >
    <AlertTriangle v-if="warningLevel !== 'ok'" :size="14" />
    <span>{{ message }}</span>
    <button type="button" class="details-link" @click="$emit('open')">
      {{ t('contextUsage.viewDetails') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle } from 'lucide-vue-next'
import { storeToRefs } from 'pinia'
import { useContextUsageStore } from '@/stores/contextUsage'
import { useSettingsStore } from '@/stores/settings'

defineEmits<{
  open: []
}>()

const { t } = useI18n()
const contextStore = useContextUsageStore()
const settingsStore = useSettingsStore()
const { snapshot } = storeToRefs(contextStore)

const warningLevel = computed(() => snapshot.value?.warningLevel ?? 'ok')

const show = computed(() => {
  if (settingsStore.appearance?.showContextWarningBar === false) return false
  const level = warningLevel.value
  return level === 'warn' || level === 'error' || level === 'blocking'
})

const message = computed(() => {
  return snapshot.value?.warningMessage ?? t('contextUsage.contextLow')
})
</script>

<style lang="scss" scoped>
.context-warning-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  margin: 0 12px 8px;
  border-radius: var(--radius-md);
  font-size: 12px;
  line-height: 1.4;

  &.warn {
    background: rgba(224, 137, 107, 0.1);
    border: 1px solid rgba(224, 137, 107, 0.25);
    color: var(--warning);
  }

  &.error,
  &.blocking {
    background: rgba(224, 96, 80, 0.1);
    border: 1px solid rgba(224, 96, 80, 0.3);
    color: var(--error);
  }
}

.details-link {
  margin-left: auto;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
  opacity: 0.85;

  &:hover {
    opacity: 1;
  }
}
</style>
