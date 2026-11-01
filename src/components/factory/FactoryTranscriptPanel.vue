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

      <!-- 状态条：转录读取失败时也要能看到流水线还在推进 -->
      <div class="watch-status" data-watch-status>
        <span class="pulse" :class="{ active: running }" aria-hidden="true" />
        <span class="activity" data-watch-activity>{{ activityText }}</span>
        <span v-if="running" class="chip live" data-watch-live>{{ t('factory.watch.live') }}</span>
      </div>

      <!-- 只读镜像：消息来自同一会话的事件流，交互入口（回退/重新发送/权限确认）一律不提供。 -->
      <div class="watch-body" data-watch-body>
        <div v-if="showLoading" class="watch-state" data-watch-loading>
          <Loader2 :size="18" class="spin" />
          <p>{{ t('factory.watch.loading') }}</p>
        </div>
        <div v-else-if="showError" class="watch-state" data-watch-error>
          <AlertTriangle :size="18" />
          <p>{{ errorText }}</p>
        </div>
        <div
          v-else-if="attachedId && (hasMessages || running)"
          class="watch-live"
          data-watch-live-body
        >
          <ChatPanel :session-id="attachedId" compact readonly />
        </div>
        <div v-else class="watch-state" data-watch-empty>
          <MessageSquare :size="18" />
          <p>{{ t('factory.watch.empty') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, Eye, GitBranch, Loader2, MessageSquare, X } from 'lucide-vue-next'
import type { FactoryEvent, FactoryTask, FactoryTaskTranscriptResult } from '@/shared/factory'
import type { Message, SessionEngineType } from '@/types'
import { buildMessagesFromHistory } from '@/utils/sessionRestore'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import { showsTaskProgress } from '@/stores/factory/board'
import ChatPanel from '@/components/layout/ChatPanel.vue'

const props = withDefaults(
  defineProps<{
    task: FactoryTask
    /** 最近一次成功读取的转录；轮询失败时保留旧内容，避免面板闪空。 */
    transcript: FactoryTaskTranscriptResult | null
    loading: boolean
    error: string | null
    /** 该任务最近一条流水线事件：状态条据此说明「现在在做什么」。 */
    lastEvent?: FactoryEvent | null
  }>(),
  { lastEvent: null },
)

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const sessionStore = useChatSessionStore()
const turnStore = useTurnStore()

/**
 * 面板挂载的只读镜像会话 id。会话由主进程流水线驱动，这里只在渲染层注册
 * 一个临时条目，让持久事件订阅把同一会话的流式输出写进聊天渲染链路。
 */
const attachedId = ref<string | null>(null)

const attachedSession = computed(() =>
  attachedId.value ? sessionStore.getSession(attachedId.value) : undefined,
)
const hasMessages = computed(() => (attachedSession.value?.messages.length ?? 0) > 0)

const running = computed(() => {
  if (showsTaskProgress(props.task)) return true
  const id = attachedId.value
  return id ? turnStore.getIsLoading(id) : false
})

const activityText = computed(() => {
  const event = props.lastEvent
  if (event) return t(`factory.events.${event.code}`, event.params ?? {})
  return running.value ? t('factory.watch.running') : t('factory.watch.idle')
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

function normalizeMessages(): Message[] {
  if (!props.transcript?.ok) return []
  return buildMessagesFromHistory(props.transcript.messages).map((message, index) => ({
    ...message,
    id: message.id ?? `watch-${index}`,
    timestamp: message.timestamp ?? 0,
  }))
}

function releaseAttached(): void {
  const id = attachedId.value
  if (!id) return
  attachedId.value = null
  // 只摘本地镜像；流水线的引擎进程不能因为面板关闭而被停掉。
  turnStore.releaseObservedSession(id)
  sessionStore.detachObservedSession(id)
}

function attach(sessionId: string): void {
  const transcript = props.transcript
  if (!transcript?.ok || transcript.sessionId !== sessionId) return
  if (attachedId.value === sessionId) return
  releaseAttached()
  const session = sessionStore.attachObservedSession({
    sessionId,
    title: props.task.title,
    engineType: transcript.engineType as SessionEngineType,
    messages: normalizeMessages(),
    running: running.value,
  })
  // 同 id 的真实会话不归观察面板管：保持空态，不把用户会话变成只读镜像。
  if (session?.observedSession) attachedId.value = sessionId
}

/** 阶段推进时会换成新的会话 id：先释放旧镜像，再挂新会话并灌入其转录快照。 */
watch(
  () => (props.transcript?.ok ? props.transcript.sessionId : ''),
  (sessionId) => {
    if (!sessionId) {
      releaseAttached()
      return
    }
    attach(sessionId)
  },
  { immediate: true },
)

onBeforeUnmount(releaseAttached)
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

  &.live {
    background: var(--success-glow);
    color: var(--success);
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

.watch-status {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  padding: 8px 16px;
  border-bottom: 1px solid var(--surface-border);
  font-size: 11.5px;
  color: var(--text-muted);

  .activity {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pulse {
    width: 6px;
    height: 6px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--text-muted);

    &.active {
      background: var(--success);
      animation: pulse 1.4s ease-in-out infinite;
    }
  }
}

.watch-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.watch-live {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.watch-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 160px;
  padding: 12px 16px;
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

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.45;
    transform: scale(1.4);
  }
}
</style>
