<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2
        v-if="isAwaitingApproval || toolCall.status === 'running'"
        :size="14"
        class="tool-icon status-running"
      />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <ClipboardCheck v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.exitPlan') }}</span>
      <div class="tool-actions">
        <span v-if="statusText" class="tool-meta" :class="statusClass">{{ statusText }}</span>
        <ChevronDown
          v-if="canExpand"
          :size="14"
          class="tool-chevron"
          :class="{ 'is-expanded': isExpanded }"
        />
      </div>
    </div>

    <div v-if="isExpanded && canExpand" class="tool-body">
      <div class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.exitPlanBody') }}</div>
        <div class="tool-section-body plan-body">
          <MarkdownRenderer :content="planContent" class="plan-content" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ClipboardCheck, Loader2, X } from 'lucide-vue-next'
import { useTurnStore } from '@/stores/turn'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

const props = defineProps<{ toolCall: ToolCall }>()
const { t } = useI18n()
const turnStore = useTurnStore()

const isExpanded = ref(false)

const planContent = computed(() => {
  if (!props.toolCall.input) return ''
  const plan = props.toolCall.input.plan
  return typeof plan === 'string' ? plan.trim() : ''
})

// 审批进行中时，PermissionRequestCard 已在同一位置展示整份计划正文；卡片必须让位，
// 否则时间线里会出现两份相同的计划。查询按全局唯一的 toolUseId 跨会话做，不回退
// currentSessionId —— 多 pane 下这张卡片所属的会话可能并不是当前会话。
const isAwaitingApproval = computed(
  () => !!turnStore.findPendingPermissionByToolUse(props.toolCall.id),
)

const canExpand = computed(() => !!planContent.value && !isAwaitingApproval.value)

const statusClass = computed(() => `status-${props.toolCall.status}`)

const statusText = computed(() => {
  if (isAwaitingApproval.value) return t('toolCards.exitPlanAwaiting')
  if (props.toolCall.status === 'error') return t('toolCards.exitPlanDenied')
  if (props.toolCall.status === 'completed') return t('toolCards.exitPlanApproved')
  return ''
})

function toggleExpand() {
  if (!canExpand.value) return
  isExpanded.value = !isExpanded.value
}
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

.plan-body {
  max-height: 480px;
  overflow-y: auto;
  @include scrollbar-overlay;
}

.plan-content {
  font-size: var(--text-md);
  line-height: var(--leading-prose);
  color: var(--text-secondary);

  :deep(.md-heading) {
    margin-top: 12px;
    margin-bottom: 8px;
    color: var(--text-primary);
  }

  :deep(.md-paragraph),
  :deep(.md-list) {
    margin-bottom: 8px;
  }

  :deep(.md-list) {
    padding-left: 20px;
  }

  :deep(pre.code-block) {
    margin: 8px 0;
  }
}
</style>
