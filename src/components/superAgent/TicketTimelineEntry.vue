<template>
  <div class="ticket-entry" :data-testid="`super-agent-ticket-entry-${card.ticketId}`">
    <WorkerTaskCard
      :card="card"
      compact
      :progress="progress"
      @open="emit('open', $event)"
      @accept="emit('accept', $event)"
      @stop="emit('stop', $event)"
      @retry="emit('retry', $event)"
      @message="emit('message', $event)"
    />
    <AttentionBubble
      v-for="bubble in attentions ?? []"
      :key="bubble.attentionId"
      :attention="bubble"
    />
    <section v-if="card.artifacts?.length" class="artifact-summary" data-testid="super-agent-artifacts">
      <header class="artifact-heading">
        <Files :size="14" aria-hidden="true" />
        <span>{{ t('superAgent.artifacts.title') }}</span>
        <span class="artifact-count">{{ card.artifacts.length }}</span>
      </header>
      <button
        v-for="path in card.artifacts"
        :key="path"
        type="button"
        class="artifact-file"
        data-testid="super-agent-artifact"
        :title="path"
        @click.stop="openArtifact(path)"
      >
        <FileText :size="16" aria-hidden="true" />
        <span class="artifact-meta">
          <span class="artifact-name">{{ path.split(/[\\/]/).pop() }}</span>
          <span class="artifact-path">{{ path }}</span>
        </span>
        <ArrowUpRight :size="14" class="artifact-open" aria-hidden="true" />
      </button>
      <p v-if="artifactError" class="artifact-error" role="alert">{{ artifactError }}</p>
    </section>
    <!-- 待验收超时提醒（T10 #80）：跟着本工单卡片出现在时间线里，点击只打开只读标签 -->
    <div
      v-if="reviewReminder"
      class="review-reminder-bubble"
      role="button"
      tabindex="0"
      :data-testid="`super-agent-review-reminder-${card.ticketId}`"
      @click="emit('open', card.ticketId)"
      @keydown.enter.prevent="emit('open', card.ticketId)"
    >
      <AlarmClockCheck class="reminder-icon" :size="14" />
      <span>{{ t('superAgent.review.reminderHint', { title: reviewReminder.title }) }}</span>
      <span class="reminder-open">{{ t('superAgent.review.openTicket') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 时间线里的一个工单位（设计 §10.3）：卡片 + 该工单的 Worker 提问 + 待验收超时提醒。
 *
 * 三者都以 ticketId 为身份，随卡片一起挂在派工那条助手回复下方，不再堆在页面顶部；
 * 计数由侧边栏入口徽章承担。动作事件原样透传给 SuperAgentView，由它委托 store 落库。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlarmClockCheck, ArrowUpRight, Files, FileText } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { api } from '@/services/electronAPI'
import { isBinaryFilePath } from '@/utils/binaryFile'
import { isHtmlPreviewPath, isImagePreviewPath, isOfficePreviewPath } from '@/utils/artifactFormat'
import type {
  SuperAgentAttentionView,
  SuperAgentTicketCard,
  SuperAgentTicketProgress,
} from '@/shared/channels/superAgent'
import type { SuperAgentReviewReminderItem } from '@/stores/superAgent'
import WorkerTaskCard from './WorkerTaskCard.vue'
import AttentionBubble from './AttentionBubble.vue'

defineProps<{
  card: SuperAgentTicketCard
  progress?: SuperAgentTicketProgress | null
  attentions?: SuperAgentAttentionView[]
  reviewReminder?: SuperAgentReviewReminderItem | null
}>()

const emit = defineEmits<{
  open: [ticketId: string]
  accept: [ticketId: string]
  stop: [ticketId: string]
  retry: [ticketId: string]
  message: [payload: { ticketId: string; text: string }]
}>()

const { t } = useI18n()
const appStore = useAppStore()
const artifactError = ref('')

async function openArtifact(path: string) {
  artifactError.value = ''
  try {
    if (isOfficePreviewPath(path)) {
      appStore.openOfficePreview(path)
    } else if (isHtmlPreviewPath(path) || isImagePreviewPath(path)) {
      await appStore.openFileInWebview(path)
    } else if (isBinaryFilePath(path)) {
      // 文本预览器只会显示乱码：这类产物如实告知不支持，不假装打开成功
      artifactError.value = t('superAgent.artifacts.unsupported')
    } else {
      if (await api.readFile(path) === null) {
        artifactError.value = t('superAgent.artifacts.unavailable')
        return
      }
      await appStore.openFile(path)
    }
  } catch {
    artifactError.value = t('superAgent.artifacts.unavailable')
  }
}
</script>

<style scoped lang="scss">
.ticket-entry {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.artifact-summary {
  min-width: 0;
  margin: 4px 0;
  padding: 10px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--bg-elevated);
}

.artifact-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 500;
}

.artifact-count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.artifact-file {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;

  > svg { flex: none; }
  &:hover { background: var(--surface-hover); }
  &:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 1px; }
}

.artifact-meta {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.artifact-name {
  font-size: 13px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.artifact-path {
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 11px;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.artifact-open { color: var(--text-secondary); }
.artifact-error { margin: 6px 8px 0; color: var(--error); font-size: 12px; }

.review-reminder-bubble {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid var(--warning);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: var(--text-sm);
  cursor: pointer;

  .reminder-icon {
    flex: none;
    color: var(--warning);
  }

  .reminder-open {
    margin-left: auto;
    flex: none;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  &:hover,
  &:focus-visible {
    background: var(--surface-hover);
  }
}
</style>
