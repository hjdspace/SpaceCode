<template>
  <div class="work-routing-card" data-test="work-routing-card" :class="{ matching: state.phase === 'matching' }">
    <div class="wr-head">
      <span class="wr-icon" aria-hidden="true">
        <Loader2 v-if="state.phase === 'matching'" :size="15" class="spin" />
        <Sparkles v-else :size="15" />
      </span>
      <div class="wr-heading">
        <span class="wr-title" data-test="work-routing-title">{{ title }}</span>
        <span class="wr-subtitle">{{ subtitle }}</span>
      </div>
      <button
        v-if="state.phase === 'matching'"
        type="button"
        class="wr-cancel"
        data-test="work-routing-cancel"
        @click="emit('cancel')"
      >
        {{ t('common.cancel') }}
      </button>
    </div>

    <template v-if="state.phase === 'candidates'">
      <div v-if="state.ranked.length" class="wr-options">
        <button
          v-for="candidate in state.ranked"
          :key="candidate.name"
          type="button"
          class="wr-option"
          data-test="work-routing-candidate"
          @click="emit('pick', candidate.name)"
        >
          <span class="wr-avatar" aria-hidden="true"><Bot :size="15" /></span>
          <span class="wr-option-body">
            <span class="wr-name">{{ workDisplayName(candidate.name) }}</span>
            <span v-if="candidate.reason" class="wr-reason">{{ candidate.reason }}</span>
          </span>
        </button>
      </div>

      <div v-else-if="state.suggestions.length" class="wr-suggestions">
        <span class="wr-suggest-label">{{ t('work.routeSuggestionsLabel') }}</span>
        <div class="wr-chips">
          <button
            v-for="suggestion in state.suggestions"
            :key="suggestion.name"
            type="button"
            class="wr-chip"
            :title="suggestion.description"
            data-test="work-routing-suggestion"
            @click="emit('pick', suggestion.name)"
          >
            {{ workDisplayName(suggestion.name) }}
          </button>
        </div>
      </div>

      <div class="wr-actions">
        <button
          v-if="canRetry"
          type="button"
          class="wr-action wr-retry"
          data-test="work-routing-retry"
          @click="emit('retry')"
        >
          <RotateCcw :size="14" />
          <span>{{ t('work.routeRetry') }}</span>
        </button>
        <button type="button" class="wr-action wr-general" data-test="work-routing-general" @click="emit('general')">
          <MessagesSquare :size="14" />
          <span>{{ t('work.generalChat') }}</span>
        </button>
        <button
          v-if="!state.ranked.length"
          type="button"
          class="wr-action wr-gallery"
          data-test="work-routing-gallery"
          @click="emit('gallery')"
        >
          <LayoutGrid :size="14" />
          <span>{{ t('work.routeGallery') }}</span>
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot, LayoutGrid, Loader2, MessagesSquare, RotateCcw, Sparkles } from 'lucide-vue-next'
import type { WorkRoutingCardState, WorkRoutingFailure } from '@/types/workRouting'
import { workDisplayName } from '@/utils/workAssistant'

const props = defineProps<{
  state: WorkRoutingCardState
}>()

const emit = defineEmits<{
  pick: [name: string]
  general: []
  gallery: []
  cancel: []
  retry: []
}>()

const { t } = useI18n()

const TITLE_KEYS: Record<WorkRoutingFailure, string> = {
  none: 'work.routeNoneTitle',
  unavailable: 'work.routeUnavailableTitle',
  timeout: 'work.routeTimeoutTitle',
  abort: 'work.routeCancelledTitle',
  error: 'work.routeErrorTitle',
}

const title = computed(() => {
  if (props.state.phase === 'matching') return t('work.routeMatching')
  if (props.state.ranked.length > 0) return t('work.routeCandidatesTitle')
  const key = props.state.failure ? TITLE_KEYS[props.state.failure] : 'work.routeErrorTitle'
  return t(key)
})

const subtitle = computed(() => {
  if (props.state.phase === 'matching') return t('work.routeMatchingHint')
  if (props.state.ranked.length > 0) return t('work.routeCandidatesHint')
  return t('work.routeFallbackHint')
})

/** 可重试条件：失败形态的候选卡且不是用户主动取消的。 */
const canRetry = computed(() => {
  if (props.state.phase !== 'candidates') return false
  if (props.state.ranked.length > 0) return false
  const f = props.state.failure
  return f === 'error' || f === 'timeout' || f === 'none'
})
</script>

<style lang="scss" scoped>
.work-routing-card {
  margin: 10px 0 14px;
  padding: 12px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--surface-border);
  border-left: 3px solid var(--accent-primary);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.wr-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.wr-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 7px;
  color: var(--accent-primary);
  background: var(--accent-primary-glow);
}

.wr-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wr-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-primary);
  line-height: var(--leading-compact);
}

.wr-subtitle {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  line-height: var(--leading-normal, 1.5);
}

.wr-cancel {
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full, 999px);
  cursor: pointer;
  transition: color 150ms ease, border-color 150ms ease;

  &:hover {
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }
}

.wr-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.wr-option {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 9px 10px;
  text-align: left;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease;

  &:hover {
    border-color: var(--accent-primary);
    background: var(--surface-glass-hover);
  }
}

.wr-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 6px;
  color: var(--accent-primary);
  background: var(--accent-primary-glow);
}

.wr-option-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.wr-name {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.wr-reason {
  font-size: var(--text-2xs);
  color: var(--text-muted);
  line-height: var(--leading-normal, 1.5);
}

.wr-suggestions {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.wr-suggest-label {
  font-size: var(--text-2xs);
  color: var(--text-muted);
}

.wr-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wr-chip {
  padding: 4px 10px;
  font-size: var(--text-2xs);
  color: var(--text-secondary);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-full, 999px);
  cursor: pointer;
  transition: color 150ms ease, border-color 150ms ease;

  &:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }
}

.wr-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.wr-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, color 150ms ease;
}

.wr-general {
  color: var(--accent-primary);
  background: var(--accent-primary-glow);
  border: 1px solid transparent;

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.wr-retry {
  color: var(--accent-primary);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);

  &:hover {
    background: var(--accent-primary-glow);
    border-color: var(--accent-primary);
  }
}

.wr-gallery {
  color: var(--text-secondary);
  background: transparent;
  border: 1px solid var(--surface-border);

  &:hover {
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }
}

.spin {
  animation: wr-spin 0.9s linear infinite;
}

@keyframes wr-spin {
  to { transform: rotate(360deg); }
}
</style>
