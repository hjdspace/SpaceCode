<template>
  <SuperAgentDialog
    :visible="visible"
    :title="t('superAgent.health.title')"
    @close="emit('close')"
  >
    <template #subtitle>
      <span
        class="summary-count"
        :class="problems.length > 0 ? 'has-problems' : 'all-clear'"
        data-testid="super-agent-health-summary"
      >
        {{ t('superAgent.health.summary', { count: problems.length }) }}
      </span>
    </template>

    <div
      class="super-agent-health"
      :class="{ actionable: problems.length > 0 }"
      data-testid="super-agent-health"
    >
      <p class="health-legend">{{ t('superAgent.health.actionableHint') }}</p>

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
    </div>

    <template #footer>
      <span
        v-if="hint"
        class="health-action-hint"
        :class="{ failed: hintFailed }"
        data-testid="super-agent-health-action-hint"
      >
        {{ hint }}
      </span>
      <span v-else class="health-action-hint" />
      <button
        type="button"
        class="bar-button"
        data-testid="super-agent-health-close"
        @click="emit('close')"
      >
        {{ t('common.close') }}
      </button>
    </template>
  </SuperAgentDialog>
</template>

<script setup lang="ts">
/**
 * T13 #83 健康面板（T20 #90 升级为可操作）：
 * 问题项支持重试 / 忽略（两步确认）；unavailable Eval（eval 类别主体项）
 * 支持重新评估 / 忽略。面板只负责呈现与确认交互，处置动作交给父级
 * （SuperAgentView → superAgent store）完成并回显状态。
 *
 * 弹窗承载：主区顶部有 z-index 30 的悬浮工卡，内联展开必被压住。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SuperAgentHealthItem } from '@/shared/channels/superAgent'
import { healthCategoryI18nKey } from '@/lib/superAgent/healthText'
import SuperAgentDialog from './SuperAgentDialog.vue'

defineProps<{
  visible: boolean
  /** error 级且未由工单卡片呈现的问题项。 */
  problems: SuperAgentHealthItem[]
  /** 上一次处置的回显文案（成功或失败）。 */
  hint?: string
  hintFailed?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
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
  gap: 10px;
}

.summary-count {
  padding: 1px 8px;
  border-radius: var(--radius-full);
  background: var(--surface-glass);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);

  &.has-problems {
    color: var(--error);
  }

  &.all-clear {
    color: var(--text-secondary);
  }
}

.health-legend {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.health-items {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.health-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface-glass);

  // T20：主体项（unavailable Eval）与系统级问题视觉区分。
  &.subject-item {
    border-color: var(--accent-primary);
  }

  .item-main {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: var(--text-sm);

    .item-category {
      font-weight: var(--font-weight-semibold);
      color: var(--text-primary);
    }

    .item-error {
      color: var(--text-secondary);
    }

    .item-ticket {
      color: var(--text-secondary);
      font-family: $font-mono;
      font-size: var(--text-2xs);
    }
  }

  .item-actions {
    display: flex;
    align-items: center;
    gap: 6px;

    .confirm-text {
      font-size: var(--text-sm);
      color: var(--text-primary);
    }

    .action {
      padding: 4px 10px;
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-primary);
      font-size: var(--text-sm);
      cursor: pointer;
      transition: background-color var(--transition-fast), border-color var(--transition-fast);

      &:hover:not(:disabled) {
        background: var(--surface-hover);
      }

      &:disabled {
        cursor: not-allowed;
        opacity: 0.55;
      }

      &.reevaluate {
        border-color: var(--accent-primary);
        color: var(--accent-primary);
      }

      &.dismiss.confirm {
        border-color: var(--error);
        color: var(--error);
      }

      &.cancel {
        color: var(--text-secondary);
      }

      @include focus-ring;
    }
  }
}

.health-empty {
  margin: 0;
  padding: 16px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  color: var(--text-secondary);
  text-align: center;
}

.health-action-hint {
  flex: 1;
  min-width: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);

  &.failed {
    color: var(--error);
  }
}

.bar-button {
  flex: none;
  padding: 5px 12px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color var(--transition-fast);

  &:hover {
    background: var(--surface-hover);
  }

  @include focus-ring;
}
</style>
