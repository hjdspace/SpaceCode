<template>
  <div class="message-list" ref="listRef" :class="{ 'has-messages': props.messages.length > 0 || props.loading }">
    <div class="messages-container">
      <div v-if="props.messages.length === 0 && !props.loading" class="empty-state">
        <MessageSquare :size="48" />
        <p>{{ t('chat.startConversation') }}</p>
        <span>{{ t('chat.startConversationDesc') }}</span>
      </div>

      <template v-for="item in displayItems" :key="item.key">
        <MessageItem
          v-if="item.type === 'user-group'"
          :message="item.group!.messages[0]"
          :can-rewind="item.group!.messages[0].id !== props.messages[props.messages.length - 1]?.id"
          @tool-submit="(mId, tId, ans) => emit('toolSubmit', mId, tId, ans)"
          @tool-skip="(mId, tId) => emit('toolSkip', mId, tId)"
          @rewind="(msg) => emit('rewind', msg)"
        />
        <AgentTimeline
          v-else-if="item.type === 'assistant-group'"
          :messages="item.group!.messages"
          :loading="props.loading && item.group!.id === messageGroups[messageGroups.length - 1]?.id"
          @tool-submit="(tId, ans) => emit('toolSubmit', item.group!.id, tId, ans)"
          @tool-skip="(tId) => emit('toolSkip', item.group!.id, tId)"
        />
        <CurrentTurnChangeCard
          v-else-if="item.type === 'turn-card'"
          :card-data="item.card!"
          class="turn-change-card-wrapper"
        />
        <ArtifactSummaryCard
          v-else-if="item.type === 'artifact-card'"
          :artifacts="item.artifacts!"
        />
      </template>

      <div v-if="props.loading" class="typing-indicator">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, computed, onUnmounted } from 'vue'
import type { Message } from '@/types'
import type { TurnChangeCardData } from '@/types'
import { storeToRefs } from 'pinia'
import MessageItem from './MessageItem.vue'
import AgentTimeline from './AgentTimeline.vue'
import CurrentTurnChangeCard from './CurrentTurnChangeCard.vue'
import ArtifactSummaryCard from './ArtifactSummaryCard.vue'
import { MessageSquare } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { getCompletedTurnTargets, type RewindTurnTarget } from '@/utils/turnCheckpointUtils'

const { t } = useI18n()
const chatStore = useChatStore()
const storeTurnChangeCards = computed(() => chatStore.turnChangeCards)

const emit = defineEmits<{
  toolSubmit: [messageId: string, toolId: string, updatedInput: Record<string, unknown>]
  toolSkip: [messageId: string, toolId: string]
  rewind: [message: Message]
}>()

const props = defineProps<{
  messages: Message[]
  loading: boolean
}>()

interface MessageGroup {
  id: string
  type: 'user' | 'assistant'
  messages: Message[]
}

interface DisplayItem {
  type: 'user-group' | 'assistant-group' | 'turn-card' | 'artifact-card'
  key: string
  group?: MessageGroup
  card?: TurnChangeCardData
  artifacts?: import('@/types').ArtifactSummaryEntry[]
}

// ========== 优化1: 消息分组计算缓存 (类似useMemo) ==========
// 使用输入数组引用 + 数组形态作为缓存键. 关键约束:
//  - chat store 的 updateMessage() 每次流式 text_delta 都会执行
//    `session.messages = [...]` 整体替换数组, 同时把被改的 message 替换为
//    `{ ...old, ...updates }` 这个新对象. 因此每次内容增长 -> msgs 引用变 ->
//    缓存必须失效, 重建后下游拿到的才是最新的 message 引用.
//  - addMessage() 发送用户消息/追加 assistant 占位消息时使用 push(), 数组引用
//    不变但 length/lastId 会变, 所以不能只按引用缓存, 否则用户 bubble 会延迟显示.
//  - 更旧的实现只用 `length-firstId-lastId` 作为 key, 流式期间这三个值都不变,
//    缓存永久命中, 把第一次构建时持有的"僵尸 message 引用"一直传给
//    AgentTimeline, 导致 LLM 答复无法实时渲染, 必须切走会话再切回 (组件
//    remount, 缓存重置) 才能看到完整内容.
//  - 对于不替换数组、只改对象内部属性的更新 (例如 msg.timelineEvents = [...])
//    msgs 引用相同, 缓存命中是正确的: 下游 AgentTimeline 拿到的是同一批
//    message 引用, 它内部的内容感知缓存会再做一次细粒度失效.
let _cachedMessageGroups: MessageGroup[] | null = null
let _cachedMessagesRef: Message[] | null = null
let _cachedMessagesLength = -1
let _cachedFirstMessageId = ''
let _cachedLastMessageId = ''

function buildMessageGroups(msgs: Message[]): MessageGroup[] {
  const firstMessageId = msgs[0]?.id || ''
  const lastMessageId = msgs[msgs.length - 1]?.id || ''

  if (
    _cachedMessageGroups &&
    _cachedMessagesRef === msgs &&
    _cachedMessagesLength === msgs.length &&
    _cachedFirstMessageId === firstMessageId &&
    _cachedLastMessageId === lastMessageId
  ) {
    return _cachedMessageGroups
  }

  const groups: MessageGroup[] = []
  let currentGroup: MessageGroup | null = null
  const usedKeys = new Set<string>()

  for (const msg of msgs) {
    const groupType = msg.role === 'user' ? 'user' : 'assistant'

    if (!currentGroup || currentGroup.type !== groupType) {
      // Ensure unique key: prefer msg.id, but append suffix if duplicated
      let key = msg.id
      let suffix = 1
      while (usedKeys.has(key)) {
        key = `${msg.id}-${suffix++}`
      }
      usedKeys.add(key)

      currentGroup = {
        id: key,
        type: groupType,
        messages: [msg]
      }
      groups.push(currentGroup)
    } else {
      currentGroup.messages.push(msg)
    }
  }

  _cachedMessageGroups = groups
  _cachedMessagesRef = msgs
  _cachedMessagesLength = msgs.length
  _cachedFirstMessageId = firstMessageId
  _cachedLastMessageId = lastMessageId
  return groups
}

const messageGroups = computed<MessageGroup[]>(() => {
  return buildMessageGroups(props.messages)
})

// 若某助手分组的回合产生了产物（仅办公模式），返回对应的产物卡片项，否则 null
function artifactCardItem(group: MessageGroup): DisplayItem | null {
  if (chatStore.currentSession?.mode !== 'work') return null
  const withArtifacts = group.messages.find(
    m => m.metadata?.artifacts && m.metadata.artifacts.length > 0
  )
  if (!withArtifacts) return null
  return {
    type: 'artifact-card',
    key: `artifact-card-${group.id}`,
    artifacts: withArtifacts.metadata!.artifacts,
  }
}

function buildDisplayItems(
  groups: MessageGroup[],
  cards: TurnChangeCardData[]
): DisplayItem[] {
  if (cards.length === 0) {
    const items: DisplayItem[] = []
    for (const g of groups) {
      items.push({
        type: g.type === 'user' ? 'user-group' : 'assistant-group',
        key: g.id,
        group: g,
      })
      if (g.type === 'assistant') {
        const ac = artifactCardItem(g)
        if (ac) items.push(ac)
      }
    }
    return items
  }

  const items: DisplayItem[] = []
  let userMsgIndex = -1

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]

    if (group.type === 'user') {
      userMsgIndex++
      const userMsg = group.messages[0]

      items.push({ type: 'user-group', key: group.id, group })

      if (i + 1 < groups.length && groups[i + 1].type === 'assistant') {
        i++
        const assistantGroup = groups[i]
        items.push({ type: 'assistant-group', key: assistantGroup.id, group: assistantGroup })
        const acUser = artifactCardItem(assistantGroup)
        if (acUser) items.push(acUser)
      }

      const card = cards.find(
        c =>
          c.targetUserMessageId === userMsg.id ||
          c.checkpoint.target.userMessageIndex === userMsgIndex
      )
      if (card) {
        items.push({
          type: 'turn-card',
          key: `turn-card-${card.targetUserMessageId}`,
          card,
        })
      }
    } else {
      items.push({ type: 'assistant-group', key: group.id, group })
      const acElse = artifactCardItem(group)
      if (acElse) items.push(acElse)
    }
  }

  return items
}

const displayItems = ref<DisplayItem[]>([])

watch(
  [messageGroups, () => storeTurnChangeCards.value],
  ([groups, cards]) => {
    displayItems.value = buildDisplayItems(groups, cards)
  },
  { immediate: true }
)

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
let _scrollRafScheduled = false

const SCROLL_BOTTOM_THRESHOLD = 80 // 像素阈值，判断是否在底部附近

function isNearScrollBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < SCROLL_BOTTOM_THRESHOLD
}

function scrollToBottom(behavior: 'auto' | 'smooth' = 'auto') {
  // 节流：流式期间 streamScrollSignal 每个 delta 都会触发 scrollToBottom，
  // 使用 rAF 合并同一帧内的多次调用，避免每个 delta 触发 3 次滚动（nextTick + rAF + setTimeout）。
  if (_scrollRafScheduled) return
  _scrollRafScheduled = true
  requestAnimationFrame(() => {
    _scrollRafScheduled = false
    if (!listRef.value || !shouldAutoScrollRef.value) return
    isProgrammaticScrollingRef.value = true
    listRef.value.scrollTo({
      top: listRef.value.scrollHeight,
      behavior,
    })
    // 在下一帧清除标志，避免 scroll 事件误判
    requestAnimationFrame(() => {
      isProgrammaticScrollingRef.value = false
    })
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

const streamScrollSignal = computed(() => {
  const lastMessage = props.messages[props.messages.length - 1]
  if (!lastMessage) return 'empty'

  const timelineSignal = (lastMessage.timelineEvents || [])
    .map(event => `${event.id}:${event.status}:${(event.content || '').length}`)
    .join('|')

  return [
    props.messages.length,
    lastMessage.id,
    lastMessage.role,
    (lastMessage.content || '').length,
    (lastMessage.reasoning?.content || '').length,
    lastMessage.reasoning?.endTime ? 1 : 0,
    lastMessage.metadata ? 1 : 0,
    props.loading ? 1 : 0,
    timelineSignal,
  ].join(':')
})

// 监听消息数量、loading 和流式内容变化，智能决定是否自动滚动
watch(streamScrollSignal, () => {
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

const completedTurnTargets = computed(() => getCachedCompletedTurnTargets(props.messages))
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

watch(() => props.messages.length, () => {
  const sessionId = chatStore.currentSessionId
  const isIdle = !chatStore.isLoading && !props.loading

  if (sessionId && isIdle && hasCompletedTurns.value) {
    debouncedLoadTurnCheckpoints(sessionId)
  }
})

onMounted(async () => {
  // 添加滚动监听
  if (listRef.value) {
    listRef.value.addEventListener('scroll', handleScroll, { passive: true })
  }

  if (props.messages.length > 0) {
    scrollToBottom()
  }

  const sessionId = chatStore.currentSessionId
  if (sessionId && !props.loading && hasCompletedTurns.value) {
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
