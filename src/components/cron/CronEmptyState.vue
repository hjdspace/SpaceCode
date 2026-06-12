<template>
  <div class="cron-empty">
    <div class="empty-icon">
      <Clock :size="36" />
    </div>
    <div class="empty-title">{{ t('cron.emptyTitle') }}</div>
    <div class="empty-desc">{{ t('cron.emptyDesc') }}</div>
    <button class="btn-create-first" @click="$emit('create')">
      <Plus :size="18" />
      {{ t('cron.createFirst') }}
    </button>
    <div class="empty-examples">
      <div class="empty-examples-title">{{ t('cron.examples') }}</div>
      <div class="empty-example-item" v-for="ex in examples" :key="ex">
        <span class="empty-example-bullet">&#9656;</span>
        <span>{{ ex }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Clock, Plus } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

defineEmits<{ create: [] }>()

const { t } = useI18n()
const examples = [
  t('cron.example1'),
  t('cron.example2'),
  t('cron.example3'),
  t('cron.example4'),
]
</script>

<style lang="scss" scoped>
.cron-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 40px;
  text-align: center;
}

.empty-icon {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-xl);
  background: var(--surface-card);
  color: var(--text-disabled);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}

.empty-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.empty-desc {
  font-size: var(--font-size-base);
  color: var(--text-muted);
  max-width: 360px;
  line-height: 1.6;
  margin-bottom: 24px;
}

.btn-create-first {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  background: var(--accent-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  box-shadow: 0 2px 8px rgba(13, 148, 136, 0.25);

  &:hover {
    background: var(--accent-primary-hover);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(13, 148, 136, 0.3);
  }

  &:active {
    transform: translateY(0);
  }
}

.empty-examples {
  margin-top: 32px;
  text-align: left;
  max-width: 360px;
}

.empty-examples-title {
  font-size: 12px;
  color: var(--text-muted);
  font-weight: 500;
  margin-bottom: 10px;
}

.empty-example-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.empty-example-bullet {
  color: var(--accent-primary);
  flex-shrink: 0;
  margin-top: 2px;
}
</style>
