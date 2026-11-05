<!--
  Attention 非模态问答气泡（T08 #78）：
  - question 打开时展示问题与工单溯源，提供就地回答入口；
    不弹 modal、textarea 不自动聚焦（不抢焦点），气泡以内联块出现在消息流上。
  - 已提交的回答数量实时展示（等待执行方认领）；认领后气泡折叠为一行审计，
    点击可展开查看问题与认领数量，撤回的气泡由父级直接过滤不渲染。
  - 回答经 store.answerAttention 走主进程领域接缝（requestId 幂等），
    blocked/failed 闸门期间只落库不投递，由主进程决定何时补投。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, MessageCircleQuestion } from 'lucide-vue-next'
import type { SuperAgentAttentionView } from '@/shared/channels/superAgent'
import { createUuid } from '@/utils/uuid'
import { useSuperAgentStore } from '@/stores/superAgent'

const props = defineProps<{ attention: SuperAgentAttentionView }>()

const { t } = useI18n()
const superAgentStore = useSuperAgentStore()

const answerText = ref('')
const submitting = ref(false)
const failed = ref(false)
const auditOpen = ref(false)

/** 只有 question 类 Attention 可就地回答；permission/delivery 仅展示。 */
const answerable = computed(() => props.attention.kind === 'question')
/** 认领后折叠为一行审计，点击展开。 */
const collapsed = computed(() => props.attention.status === 'answered')

async function submitAnswer(): Promise<void> {
  const text = answerText.value.trim()
  const repoRoot = superAgentStore.snapshot?.repoRoot ?? ''
  if (text === '' || submitting.value) return
  submitting.value = true
  failed.value = false
  try {
    await superAgentStore.answerAttention(repoRoot, {
      requestId: createUuid(),
      attentionId: props.attention.attentionId,
      text,
    })
    answerText.value = ''
  } catch {
    failed.value = true
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div v-if="collapsed" class="attention-bubble is-collapsed" data-testid="attention-bubble-collapsed">
    <button type="button" class="collapsed-row" @click="auditOpen = !auditOpen">
      <CircleCheck class="icon-ok" :size="14" />
      <span class="answered-label">{{ t('superAgent.attention.answeredLabel') }}</span>
      <span class="question-summary">{{ attention.question }}</span>
      <span class="expand-hint">{{
        auditOpen ? t('superAgent.attention.collapseHint') : t('superAgent.attention.expandHint')
      }}</span>
    </button>
    <div v-if="auditOpen" class="audit-detail">
      <p class="question-full">
        {{ t('superAgent.attention.answeredAudit', { question: attention.question, count: attention.answers.length }) }}
      </p>
      <p class="ticket-source">
        {{ t('superAgent.attention.ticketLabel') }} · {{ attention.ticketTitle }}
      </p>
    </div>
  </div>
  <div v-else class="attention-bubble" data-testid="attention-bubble">
    <div class="bubble-head">
      <MessageCircleQuestion class="icon-ask" :size="15" />
      <span class="ticket-source">
        {{ t('superAgent.attention.ticketLabel') }} · {{ attention.ticketTitle }}
      </span>
      <span class="waiting-badge">{{ t('superAgent.attention.waitingHint') }}</span>
    </div>
    <p class="question" data-testid="attention-bubble-question">{{ attention.question }}</p>
    <p
      v-if="attention.answers.length > 0"
      class="submitted-hint"
      data-testid="attention-bubble-submitted"
    >
      {{ t('superAgent.attention.submittedHint', { count: attention.answers.length }) }}
    </p>
    <form v-if="answerable" class="answer-form" @submit.prevent="submitAnswer">
      <textarea
        v-model="answerText"
        rows="2"
        data-testid="attention-bubble-input"
        :placeholder="t('superAgent.attention.answerPlaceholder')"
      />
      <button
        type="submit"
        class="submit-btn"
        data-testid="attention-bubble-submit"
        :disabled="answerText.trim() === '' || submitting"
      >
        {{ submitting ? t('superAgent.attention.answering') : t('superAgent.attention.answerSubmit') }}
      </button>
    </form>
    <p v-else class="delivery-hint">{{ t('superAgent.attention.deliveryHint') }}</p>
    <p v-if="failed" class="failed-hint" data-testid="attention-bubble-error">
      {{ t('superAgent.attention.answerFailedHint') }}
    </p>
  </div>
</template>

<style scoped lang="scss">
.attention-bubble {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--border-normal);
  border-left: 3px solid var(--accent-primary);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.bubble-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);

  .icon-ask {
    color: var(--accent-primary);
    flex-shrink: 0;
  }
}

.ticket-source {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.waiting-badge {
  margin-left: auto;
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--accent-primary);
  color: var(--bg-elevated);
  font-size: 11px;
  white-space: nowrap;
}

.question {
  margin: 0;
  font-size: 13px;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.submitted-hint,
.delivery-hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.answer-form {
  display: flex;
  flex-direction: column;
  gap: 6px;

  textarea {
    resize: vertical;
    min-height: 44px;
    padding: 6px 8px;
    border: 1px solid var(--border-normal);
    border-radius: 6px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: 12px;
    font-family: inherit;
  }

  .submit-btn {
    align-self: flex-end;
    padding: 4px 14px;
    border: none;
    border-radius: 6px;
    background: var(--accent-primary);
    color: var(--bg-elevated);
    font-size: 12px;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: var(--bg-primary-hover);
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
}

.failed-hint {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #e5484d);
}

.is-collapsed {
  border-left-color: var(--border-normal);

  .collapsed-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 12px;
    cursor: pointer;
    text-align: left;

    .icon-ok {
      color: var(--success, #30a46c);
      flex-shrink: 0;
    }

    .answered-label {
      color: var(--text-muted);
      white-space: nowrap;
    }

    .question-summary {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-primary);
    }

    .expand-hint {
      color: var(--text-muted);
      white-space: nowrap;
    }
  }

  .audit-detail {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 6px;
    border-top: 1px dashed var(--border-normal);
    font-size: 12px;

    .question-full {
      margin: 0;
      color: var(--text-primary);
    }

    .ticket-source {
      margin: 0;
      color: var(--text-muted);
      white-space: normal;
    }
  }
}
</style>
