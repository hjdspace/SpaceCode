<template>
  <div
    class="factory-overlay"
    role="dialog"
    aria-modal="true"
    :aria-label="task.title"
    data-watch-panel
    @click.self="emit('close')"
  >
    <div class="watch-panel">
      <header class="watch-head">
        <span class="chip tag" data-watch-tag>{{ t('factory.actions.observe') }}</span>
        <div class="head-title">
          <h2 data-watch-title>{{ task.title }}</h2>
          <p class="head-meta" data-watch-branch>
            <GitBranch :size="11" />
            <span>{{ task.branch }}</span>
          </p>
        </div>
        <span class="head-spacer" />
        <span class="chip readonly" data-watch-readonly>
          <Eye :size="11" />
          {{ t('factory.watch.readonly') }}
        </span>
        <button
          class="icon-btn"
          :aria-label="t('factory.watch.close')"
          data-watch-close
          @click="emit('close')"
        >
          <X :size="16" />
        </button>
      </header>

      <!-- 只读镜像：消息是引擎 JSONL 重建的，交互入口（回退/重新发送/权限确认）一律不提供。 -->
      <div ref="bodyEl" class="watch-body" data-watch-body>
        <div v-if="showLoading" class="watch-state" data-watch-loading>
          <Loader2 :size="18" class="spin" />
          <p>{{ t('factory.watch.loading') }}</p>
        </div>
        <div v-else-if="showError" class="watch-state" data-watch-error>
          <AlertTriangle :size="18" />
          <p>{{ errorText }}</p>
        </div>
        <template v-else>
          <div v-for="group in groups" :key="group.key" class="watch-group">
            <MessageItem
              v-if="group.type === 'user'"
              :message="group.messages[0]"
              :session-id="sessionId"
              :can-rewind="false"
            />
            <AgentTimeline v-else :messages="group.messages" :session-id="sessionId" />
          </div>
          <div v-if="!groups.length" class="watch-state" data-watch-empty>
            <MessageSquare :size="18" />
            <p>{{ t('factory.watch.empty') }}</p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Eye, GitBranch, Loader2, MessageSquare, X } from 'lucide-vue-next'
import type { FactoryTask, FactoryTaskTranscriptResult } from '@/shared/factory'
import type { Message } from '@/types'
import { buildMessagesFromHistory } from '@/utils/sessionRestore'
import MessageItem from '@/components/chat/MessageItem.vue'
import AgentTimeline from '@/components/chat/AgentTimeline.vue'

const props = defineProps<{
  task: FactoryTask
  /** 最近一次成功读取的转录；轮询失败时保留旧内容，避免面板闪空。 */
  transcript: FactoryTaskTranscriptResult | null
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const bodyEl = ref<HTMLElement | null>(null)
const sessionId = computed(() => (props.transcript?.ok ? props.transcript.sessionId : ''))

const messages = computed<Message[]>(() => {
  if (!props.transcript?.ok) return []
  return buildMessagesFromHistory(props.transcript.messages).map((message, index) => ({
    ...message,
    id: message.id ?? `watch-${index}`,
    timestamp: message.timestamp ?? 0,
  }))
})

interface WatchGroup {
  key: string
  type: 'user' | 'assistant'
  messages: Message[]
}

/** 与聊天页同一分组口径：连续同角色合并，用户气泡 / 助手时间线交替出现。 */
const groups = computed<WatchGroup[]>(() => {
  const result: WatchGroup[] = []
  for (const message of messages.value) {
    const type = message.role === 'user' ? 'user' : 'assistant'
    const last = result[result.length - 1]
    if (last && last.type === type) last.messages.push(message)
    else result.push({ key: `watch-${result.length}-${message.id}`, type, messages: [message] })
  }
  return result
})

const hasContent = computed(() => props.transcript?.ok === true)
const showLoading = computed(() => props.loading && !hasContent.value)
const showError = computed(() => !hasContent.value && props.error !== null)
const errorText = computed(() => {
  switch (props.error) {
    case 'no-session':
      return t('factory.watch.noSession')
    case 'worktree-missing':
      return t('factory.watch.worktreeMissing')
    default:
      return t('factory.watch.loadFailed')
  }
})

/** 打开时落在最新一条；后续轮询只要有新消息就跟随到底部。 */
watch(
  [() => props.task.id, () => messages.value.length],
  async () => {
    await nextTick()
    const el = bodyEl.value
    if (el) el.scrollTop = el.scrollHeight
  },
  { immediate: true },
)
</script>

<style lang="scss" scoped>
.factory-overlay {
  position: absolute;
  inset: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.watch-panel {
  display: flex;
  flex-direction: column;
  width: min(820px, 100%);
  height: min(720px, 100%);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-secondary, #1a1a2e);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.watch-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--surface-border);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;

  &.tag {
    background: var(--accent-soft, rgba(99, 102, 241, 0.16));
    color: var(--accent, #818cf8);
  }

  // 只读是这块面板的前提：中性实底，和接管面板的「已暂停」同一视觉重量。
  &.readonly {
    background: var(--text-primary);
    color: var(--bg-secondary, #1a1a2e);
    font-weight: 600;
  }
}

.head-title {
  min-width: 0;

  h2 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.head-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 3px 0 0;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--text-muted);

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.head-spacer {
  flex: 1;
}

.icon-btn {
  display: inline-flex;
  padding: 4px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }
}

.watch-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 16px;
  @include scrollbar-overlay;
}

.watch-group + .watch-group {
  margin-top: 8px;
}

.watch-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 160px;
  color: var(--text-muted);
  font-size: 12px;

  p {
    margin: 0;
    text-align: center;
  }
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
