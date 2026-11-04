<script setup lang="ts">
/**
 * 只读系统问题面板（T13 #83）。
 *
 * MVP 只上报不可操作：不提供重试/忽略等处置按钮，问题项仅展示类别、
 * 稳定错误码的本地化文案与关联工单。delivery 永久失败已由工单卡片
 * 呈现，不会出现在这里（store 已过滤 reflectedOnTicket 项）。
 * 类别/错误码均为开放字符串，未知项回退通用文案键。
 */
import { useI18n } from 'vue-i18n'
import type { SuperAgentHealthItem } from '@/shared/channels/superAgent'
import { healthCategoryI18nKey } from '@/lib/superAgent/healthText'

defineProps<{
  problems: SuperAgentHealthItem[]
}>()

const { t } = useI18n()
</script>

<template>
  <section class="super-agent-health" data-testid="super-agent-health">
    <h3 class="title">{{ t('superAgent.health.title') }}</h3>
    <p class="hint">{{ t('superAgent.health.readonlyHint') }}</p>

    <ul v-if="problems.length" class="problem-list">
      <li v-for="problem in problems" :key="problem.category" class="problem-item">
        <span class="category">{{ t(healthCategoryI18nKey(problem.category)) }}</span>
        <span class="message">{{ t(problem.codeI18nKey) }}</span>
        <span v-if="problem.ticketId" class="ticket">
          {{ t('superAgent.health.relatedTicket', { ticketId: problem.ticketId }) }}
        </span>
      </li>
    </ul>

    <p v-else class="empty">{{ t('superAgent.health.empty') }}</p>
  </section>
</template>

<style scoped lang="scss">
.super-agent-health {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
  background: var(--bg-primary);
  font-size: 12px;
}

.title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.hint,
.empty {
  margin: 0;
  color: var(--text-muted);
}

.problem-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.problem-item {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  padding: 6px 8px;
  border-radius: 6px;
  background: var(--bg-elevated);
}

.category {
  font-weight: 600;
  color: var(--text-primary);
}

.message {
  color: var(--text-secondary);
}

.ticket {
  color: var(--text-muted);
}
</style>
