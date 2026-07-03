<template>
  <div v-if="actions.length" class="next-steps">
    <span class="ns-title">{{ t('design.nextSteps.title') }}</span>
    <div class="ns-actions">
      <button v-for="(a, i) in actions" :key="i" class="ns-btn" @click="$emit('select', a.prompt)">
        {{ a.label }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { NextStepAction } from '@/utils/chat/buildBlocks'
defineProps<{ actions: NextStepAction[] }>()
defineEmits<{ (e: 'select', prompt: string): void }>()
const { t } = useI18n()
</script>

<style scoped lang="scss">
.next-steps { padding: 8px 0; border-top: 1px solid var(--surface-border); margin-top: 8px; }
.ns-title { font-size: 11px; color: var(--text-muted); text-transform: uppercase; }
.ns-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.ns-btn { background: var(--bg-secondary); border: 1px solid var(--surface-border); border-radius: var(--radius-full); padding: 4px 12px; font-size: 12px; cursor: pointer; &:hover { background: var(--surface-hover); } }
</style>
