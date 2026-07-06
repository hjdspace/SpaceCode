<template>
  <div v-if="show" class="turn-summary">
    <div class="turn-summary-item total-duration">
      <span class="ts-label">{{ t('timeline.totalDuration') }}</span>
      <span class="ts-value">{{ durationText }}</span>
    </div>
    <template v-if="reasoningText">
      <div class="turn-summary-divider"></div>
      <div class="turn-summary-item">
        <span class="ts-label">{{ t('timeline.thinking') }}</span>
        <span class="ts-value">{{ reasoningText }}</span>
      </div>
    </template>
    <template v-if="metadata?.model">
      <div class="turn-summary-divider"></div>
      <div class="turn-summary-item">
        <span class="ts-label">{{ t('timeline.model') }}</span>
        <span class="ts-value">{{ metadata.model }}</span>
      </div>
    </template>
    <template v-if="tokenText">
      <div class="turn-summary-divider"></div>
      <div class="turn-summary-item">
        <span class="ts-label">{{ t('timeline.tokens') }}</span>
        <span class="ts-value">{{ tokenText }}</span>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { MessageMetadata } from '@/types'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** 消息元数据，提供 model / inputTokens / outputTokens / duration */
  metadata?: MessageMetadata
  /** 思考（reasoning）耗时（ms），不传则不显示思考条目 */
  reasoningDurationMs?: number | null
  /** 是否正在流式生成中 */
  loading?: boolean
  /** 覆盖总用时（ms），用于 AgentTimeline 从消息时间戳自行计算的场景；不传则回退到 metadata.duration */
  totalDurationMs?: number | null
}>()

const { t } = useI18n()

const show = computed(() => {
  if (props.loading) return false
  return !!(props.metadata?.duration || props.metadata?.model || props.totalDurationMs)
})

const effectiveDurationMs = computed(() => {
  if (props.totalDurationMs != null && props.totalDurationMs > 0) return props.totalDurationMs
  return props.metadata?.duration || 0
})

const durationText = computed(() => {
  const ms = effectiveDurationMs.value
  if (ms <= 0) return '0.0s'
  return `${(ms / 1000).toFixed(1)}s`
})

const reasoningText = computed(() => {
  const ms = props.reasoningDurationMs
  if (!ms || ms <= 0) return ''
  return `${(ms / 1000).toFixed(1)}s`
})

const tokenText = computed(() => {
  const meta = props.metadata
  if (!meta) return ''
  const { inputTokens, outputTokens } = meta
  if (inputTokens && outputTokens) {
    return `${inputTokens.toLocaleString()} + ${outputTokens.toLocaleString()}`
  } else if (inputTokens) {
    return `${inputTokens.toLocaleString()}`
  } else if (outputTokens) {
    return `${outputTokens.toLocaleString()}`
  }
  return ''
})
</script>

<style lang="scss" scoped>
.turn-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 10px;
  padding: 6px 12px;
  border-radius: var(--radius-md);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  font-size: 11px;
  color: var(--text-muted);
  flex-wrap: wrap;
}

.turn-summary-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);

  .ts-label {
    color: var(--text-disabled);
    font-family: var(--font-body);
    font-weight: 500;
  }

  .ts-value {
    color: var(--text-secondary);
    font-weight: 500;
  }

  &.total-duration .ts-value {
    color: var(--accent-primary);
    font-weight: 600;
  }
}

.turn-summary-divider {
  width: 1px;
  height: 12px;
  background: var(--surface-border);
}
</style>
