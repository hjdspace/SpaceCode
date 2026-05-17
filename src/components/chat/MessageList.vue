<template>
  <div class="message-list" ref="listRef" :class="{ 'has-messages': messages.length > 0 || loading }">
    <div class="messages-container">
      <div v-if="messages.length === 0 && !loading" class="empty-state">
        <MessageSquare :size="48" />
        <p>{{ t('chat.startConversation') }}</p>
        <span>{{ t('chat.startConversationDesc') }}</span>
      </div>

      <template v-for="group in messageGroups" :key="group.id">
        <!-- User message bubble -->
        <MessageItem
          v-if="group.type === 'user'"
          :message="group.messages[0]"
          @tool-submit="(mId, tId, ans) => emit('toolSubmit', mId, tId, ans)"
          @tool-skip="(mId, tId) => emit('toolSkip', mId, tId)"
        />
        <!-- Assistant timeline (unified) -->
        <AgentTimeline
          v-else
          :messages="group.messages"
          :loading="loading && group.id === messageGroups[messageGroups.length - 1]?.id"
          @tool-submit="(tId, ans) => emit('toolSubmit', group.id, tId, ans)"
          @tool-skip="(tId) => emit('toolSkip', group.id, tId)"
        />
      </template>

      <div v-if="loading" class="typing-indicator">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>

      <!-- Turn Change Cards -->
      <CurrentTurnChangeCard
        v-for="(card, index) in chatStore.turnChangeCards"
        :key="card.targetUserMessageId"
        :card-data="card"
        class="turn-change-card-wrapper"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, computed, onUnmounted } from 'vue'
import type { Message } from '@/types'
import MessageItem from './MessageItem.vue'
import AgentTimeline from './AgentTimeline.vue'
import CurrentTurnChangeCard from './CurrentTurnChangeCard.vue'
import { MessageSquare } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { getCompletedTurnTargets, type RewindTurnTarget } from '@/utils/turnCheckpointUtils'

const { t } = useI18n()
const chatStore = useChatStore()

const emit = defineEmits<{
  toolSubmit: [messageId: string, toolId: string, updatedInput: Record<string, unknown>]
  toolSkip: [messageId: string, toolId: string]
}>()

const { messages, loading } = defineProps<{
  messages: Message[]
  loading: boolean
}>()

interface MessageGroup {
  id: string
  type: 'user' | 'assistant'
  messages: Message[]
}

// ========== 优化1: 消息分组计算缓存 (类似useMemo) ==========
// 使用自定义缓存避免每次渲染重新计算
let _cachedMessageGroups: MessageGroup[] | null = null
let _cachedMessagesKey = ''

function buildMessageGroups(msgs: Message[]): MessageGroup[] {
  // 生成简单key用于比较消息数组是否变化
  const key = msgs.length > 0 ? `${msgs.length}-${msgs[msgs.length - 1]?.id}-${msgs[0]?.id}` : 'empty'

  if (_cachedMessageGroups && _cachedMessagesKey === key) {
    return _cachedMessageGroups
  }

  const groups: MessageGroup[] = []
  let currentGroup: MessageGroup | null = null

  for (const msg of msgs) {
    const groupType = msg.role === 'user' ? 'user' : 'assistant'

    if (!currentGroup || currentGroup.type !== groupType) {
      currentGroup = {
        id: msg.id,
        type: groupType,
        messages: [msg]
      }
      groups.push(currentGroup)
    } else {
      currentGroup.messages.push(msg)
    }
  }

  _cachedMessageGroups = groups
  _cachedMessagesKey = key
  return groups
}

const messageGroups = computed<MessageGroup[]>(() => {
  return buildMessageGroups(messages)
})

// ========== 优化2: 滚动位置记忆与恢复 ==========
const MAX_SCROLL_SNAPSHOTS = 10
const sessionScrollSnapshots = new Map<string, { scrollTop: number; wasAtBottom: boolean }>()

function rememberSessionScroll(sessionId: string, element: HTMLElement) {
  // LRU策略：超过10个时删除最旧的
  if (sessionScrollSnapshots.size >= MAX_SCROLL_SNAPSHOTS && !sessionScrollSnapshots.has(sessionId)) {
    const oldestSessionId = sessionScrollSnapshots.keys().next().value
    if (oldestSessionId) sessionScrollSnapshots.delete(oldestSessionId)
  }

  sessionScrollSnapshots.set(sessionId, {
    scrollTop: element.scrollTop,
    wasAtBottom: isNearScrollBottom(element),
  })
}

function restoreSessionScroll(sessionId: string, element: HTMLElement) {
  const snapshot = sessionScrollSnapshots.get(sessionId)

  if (snapshot && !snapshot.wasAtBottom) {
    // 恢复之前的滚动位置（用户在阅读历史）
    element.scrollTop = snapshot.scrollTop
  } else {
    // 新会话或之前在底部 → 自动滚到底部
    element.scrollTop = element.scrollHeight
  }
}

// ========== 优化3: 智能自动滚动控制 ==========
const listRef = ref<HTMLElement | null>(null)
const shouldAutoScrollRef = ref(true)
const isProgrammaticScrollingRef = ref(false)
const lastSessionIdRef = ref<string | null>(null)

const SCROLL_BOTTOM_THRESHOLD = 80 // 像素阈值，判断是否在底部附近

function isNearScrollBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < SCROLL_BOTTOM_THRESHOLD
}

function scrollToBottom(behavior: 'auto' | 'smooth' = 'auto') {
  nextTick(() => {
    if (listRef.value) {
      isProgrammaticScrollingRef.value = true
      listRef.value.scrollTop = listRef.value.scrollHeight

      // 重置标记
      setTimeout(() => {
        isProgrammaticScrollingRef.value = false
      }, 50)
    }
  })
}

// 用户滚动事件处理
function handleScroll() {
  if (isProgrammaticScrollingRef.value || !listRef.value) return

  const isAtBottom = isNearScrollBottom(listRef.value)
  shouldAutoScrollRef.value = isAtBottom

  // 记录当前滚动位置
  const sessionId = chatStore.currentSessionId
  if (sessionId) {
    rememberSessionScroll(sessionId, listRef.value)
  }
}

// 监听messages变化，智能决定是否自动滚动
watch(() => [messages.length, loading], ([newLength, newLoading], [oldLength, oldLoading]) => {
  if (!listRef.value) return

  // 只有在底部时才自动滚动（用户正在看最新消息）
  if (shouldAutoScrollRef.value) {
    scrollToBottom('auto')
  }
}, { flush: 'post' })

// 会话切换时恢复滚动位置
watch(() => chatStore.currentSessionId, (newSessionId, oldSessionId) => {
  if (!listRef.value || !newSessionId) return

  // 记住旧会话的滚动位置
  if (oldSessionId) {
    rememberSessionScroll(oldSessionId, listRef.value)
  }

  // 恢复新会话的滚动位置（在下一个tick执行，确保DOM已更新）
  nextTick(() => {
    if (listRef.value && newSessionId) {
      restoreSessionScroll(newSessionId, listRef.value)
    }
  })

  lastSessionIdRef.value = newSessionId
}, { flush: 'post' })

// ========== 优化4: completedTurnTargets计算缓存 ==========
let _cachedTurnTargets: RewindTurnTarget[] | null = null
let _cachedTurnTargetsKey = ''

function getCachedCompletedTurnTargets(msgs: Message[]): RewindTurnTarget[] {
  const key = msgs.length > 0 ? `${msgs.length}-${msgs[msgs.length - 1]?.id}` : 'empty'

  if (_cachedTurnTargets && _cachedTurnTargetsKey === key) {
    return _cachedTurnTargets
  }

  _cachedTurnTargets = getCompletedTurnTargets(msgs)
  _cachedTurnTargetsKey = key
  return _cachedTurnTargets
}

const completedTurnTargets = computed(() => getCachedCompletedTurnTargets(messages))
const hasCompletedTurns = computed(() => completedTurnTargets.value.length > 0)

// 优化：使用防抖处理turnCheckpoints加载
let _turnCheckpointsTimeout: ReturnType<typeof setTimeout> | null = null

function debouncedLoadTurnCheckpoints(sessionId: string) {
  if (_turnCheckpointsTimeout) {
    clearTimeout(_turnCheckpointsTimeout)
  }

  _turnCheckpointsTimeout = setTimeout(async () => {
    if (sessionId && !chatStore.isLoading && hasCompletedTurns.value) {
      await chatStore.loadTurnCheckpoints(sessionId)
    }
  }, 100)
}

watch(() => chatStore.currentSessionId, (sessionId) => {
  if (sessionId && !chatStore.isLoading && hasCompletedTurns.value) {
    debouncedLoadTurnCheckpoints(sessionId)
  }
})

watch(() => messages.length, () => {
  const sessionId = chatStore.currentSessionId
  const isIdle = !chatStore.isLoading && !loading

  if (sessionId && isIdle && hasCompletedTurns.value) {
    debouncedLoadTurnCheckpoints(sessionId)
  } else if (sessionId && isIdle && !hasCompletedTurns.value) {
    chatStore.clearTurnCheckpoints()
  }
})

onMounted(async () => {
  // 添加滚动监听
  if (listRef.value) {
    listRef.value.addEventListener('scroll', handleScroll, { passive: true })
  }

  if (messages.length > 0) {
    scrollToBottom()
  }

  const sessionId = chatStore.currentSessionId
  if (sessionId && !loading && hasCompletedTurns.value) {
    await chatStore.loadTurnCheckpoints(sessionId)
  }

  lastSessionIdRef.value = sessionId
})

onUnmounted(() => {
  if (listRef.value) {
    listRef.value.removeEventListener('scroll', handleScroll)
  }

  if (_turnCheckpointsTimeout) {
    clearTimeout(_turnCheckpointsTimeout)
  }
})
</script>

<style lang="scss" scoped>
.message-list {
  flex: 1;
  min-height: 0;
  max-height: 100%;
  overflow-y: auto;
  @include scrollbar;
  display: flex;
  flex-direction: column;
}

.messages-container {
  flex: 0 0 auto;
  min-height: 100%;
  padding: 16px 20px;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
  display: flex;
  flex-direction: column;

  > * {
    flex-shrink: 0;
  }
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  gap: 12px;
  flex: 1;
  min-height: 0;

  p {
    font-size: 18px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  span {
    font-size: 13px;
    text-align: center;
    max-width: 280px;
  }
}

.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 12px 16px;

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: bounce 1.4s infinite ease-in-out both;

    &:nth-child(1) { animation-delay: -0.32s; }
    &:nth-child(2) { animation-delay: -0.16s; }
  }
}

.turn-change-card-wrapper {
  margin: 12px 16px;
}

@keyframes bounce {
  0%, 80%, 100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}
</style>
