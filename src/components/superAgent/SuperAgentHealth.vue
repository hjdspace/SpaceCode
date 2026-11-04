<template>
  <section
    class="super-agent-health"
    data-testid="super-agent-health"
    :class="{ actionable: problems.length > 0 }"
  >
    <header class="health-summary">
      <span
        class="summary-count"
        :class="problems.length > 0 ? 'has-problems' : 'all-clear'"
        data-testid="super-agent-health-summary"
      >
        {{ t('superAgent.health.summary', { count: problems.length }) }}
      </span>
    </header>

    <ul v-if="problems.length > 0" class="health-items" data-testid="super-agent-health-items">
      <li
        v-for="item in problems"
        :key="itemKey(item)"
        class="health-item"
        :class="{ 'subject-item': item.subjectId !== null }"
        :data-testid="`super-agent-health-item-${itemKey(item)}`"
      >
        <div class="item-main">
          <span class="item-category">{{ t(healthCategoryI18nKey(item.category)) }}</span>
          <span class="item-error">{{ t(item.codeI18nKey) }}</span>
          <span
            v-if="item.ticketId"
            class="item-ticket"
            :data-testid="`super-agent-health-ticket-${itemKey(item)}`"
          >
            {{ t('superAgent.health.relatedTicket', { ticketId: item.ticketId }) }}
          </span>
        </div>

        <!-- T20：面板从只读升级为可操作。忽略走两步确认，避免误触。 -->
        <div class="item-actions">
          <template v-if="confirmingKey !== itemKey(item)">
            <button
              v-if="isEvalSubject(item)"
              type="button"
              class="action reevaluate"
              :data-testid="`super-agent-health-reevaluate-${itemKey(item)}`"
              @click="emit('reevaluate', item.subjectId as string)"
            >
              {{ t('superAgent.health.reevaluate') }}
            </button>
            <button
              v-else
              type="button"
              class="action retry"
              :data-testid="`super-agent-health-retry-${itemKey(item)}`"
              @click="emit('retry', item.category, item.subjectId)"
            >
              {{ t('superAgent.health.retry') }}
            </button>
            <button
              type="button"
              class="action dismiss"
              :data-testid="`super-agent-health-dismiss-${itemKey(item)}`"
              @click="confirmingKey = itemKey(item)"
            >
              {{ t('superAgent.health.dismiss') }}
            </button>
          </template>
          <template v-else>
            <span class="confirm-text">{{ t('superAgent.health.dismissConfirm') }}</span>
            <button
              type="button"
              class="action dismiss confirm"
              :data-testid="`super-agent-health-dismiss-confirm-${itemKey(item)}`"
              @click="confirmDismiss(item)"
            >
              {{ t('superAgent.health.dismissConfirmYes') }}
            </button>
            <button
              type="button"
              class="action cancel"
              :data-testid="`super-agent-health-dismiss-cancel-${itemKey(item)}`"
              @click="confirmingKey = null"
            >
              {{ t('superAgent.health.dismissConfirmNo') }}
            </button>
          </template>
        </div>
      </li>
    </ul>

    <p v-else class="health-empty" data-testid="super-agent-health-empty">
      {{ t('superAgent.health.empty') }}
    </p>

    <footer class="health-hint" data-testid="super-agent-health-hint">
      {{ t('superAgent.health.actionableHint') }}
    </footer>
  </section>
</template>

<script setup lang="ts">
/**
 * T13 #83 健康面板（T20 #90 升级为可操作）：
 * 问题项支持重试 / 忽略（两步确认）；unavailable Eval（eval 类别主体项）
 * 支持重新评估 / 忽略。面板只负责呈现与确认交互，处置动作交给父级
 * （SuperAgentView → superAgent store）完成并回显状态。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SuperAgentHealthItem } from '@/shared/channels/superAgent'
import { healthCategoryI18nKey } from '@/lib/superAgent/healthText'

defineProps<{
  /** error 级且未由工单卡片呈现的问题项。 */
  problems: SuperAgentHealthItem[]
}>()

const emit = defineEmits<{
  (e: 'retry', category: SuperAgentHealthItem['category'], subjectId: string | null): void
  (e: 'dismiss', category: SuperAgentHealthItem['category'], subjectId: string | null): void
  (e: 'reevaluate', evalId: string): void
}>()

const { t } = useI18n()

/** 两步确认的目标项 key；null 表示无待确认项。 */
const confirmingKey = ref<string | null>(null)

function itemKey(item: SuperAgentHealthItem): string {
  return item.subjectId !== null ? `${item.category}-${item.subjectId}` : item.category
}

/** eval 类别的主体项（unavailable Eval）：处置出口是重新评估而非重试。 */
function isEvalSubject(item: SuperAgentHealthItem): boolean {
  return item.category === 'eval' && item.subjectId !== null
}

function confirmDismiss(item: SuperAgentHealthItem): void {
  confirmingKey.value = null
  emit('dismiss', item.category, item.subjectId)
}
</script>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.super-agent-health {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.health-summary .summary-count {
  font-weight: 600;

  &.has-problems {
    color: var(--danger, #d93025);
  }

  &.all-clear {
    color: var(--text-muted);
  }
}

.health-items {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.health-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--surface-hover);
  border: 1px solid transparent;

  // T20：主体项（unavailable Eval）与系统级问题视觉区分。
  &.subject-item {
    border-color: var(--border-accent, var(--text-muted));
  }

  .item-main {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 12px;

    .item-category {
      font-weight: 600;
      color: var(--text-primary);
    }

    .item-error {
      color: var(--text-muted);
    }

    .item-ticket {
      color: var(--text-muted);
      font-family: $font-mono;
    }
  }

  .item-actions {
    display: flex;
    align-items: center;
    gap: 6px;

    .confirm-text {
      font-size: 12px;
      color: var(--text-primary);
    }

    .action {
      padding: 3px 10px;
      font-size: 12px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      background: var(--bg-elevated);
      color: var(--text-primary);
      cursor: pointer;
      transition: background-color 0.15s ease;

      &:hover {
        background: var(--surface-hover);
      }

      &:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      &.reevaluate {
        border-color: var(--primary, var(--border-color));
      }

      &.dismiss.confirm {
        color: var(--danger, #d93025);
        border-color: var(--danger, #d93025);
      }

      &.cancel {
        color: var(--text-muted);
      }
    }
  }
}

.health-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.health-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
