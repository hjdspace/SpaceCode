<template>
  <div class="subagent-panel">
    <!-- Top nav bar -->
    <div class="subagent-nav">
      <button class="nav-back-btn" @click="appStore.closeSubagentPanel()">
        <ArrowLeft :size="14" />
        <span>{{ t('subagentPanel.backToChat') }}</span>
      </button>
      <button class="nav-close-btn" @click="appStore.closeSubagentPanel()" :title="t('common.close')">
        <X :size="14" />
      </button>
    </div>

    <!-- Empty / error state -->
    <div v-if="!panelState" class="subagent-empty">
      <p>{{ t('subagentPanel.notFound') }}</p>
    </div>

    <template v-else>
      <!-- Sticky hero -->
      <div class="subagent-hero">
        <div class="hero-row">
          <span class="hero-status-dot" :class="statusClass" />
          <Bot :size="16" class="hero-icon" :class="statusClass" />
          <span class="hero-name">{{ agentName }}</span>
          <span class="hero-type">{{ agentType }}</span>
        </div>
        <div class="hero-meta">
          <span v-if="modelName" class="hero-model">{{ modelName }}</span>
          <span class="hero-badge" :class="statusClass">{{ statusLabel }}</span>
          <span v-if="isRunning" class="hero-timer">
            <Clock :size="12" />
            {{ formattedElapsed }}
          </span>
        </div>
      </div>

      <!-- Scrollable body -->
      <div class="subagent-body">
        <!-- Task description -->
        <details v-if="taskDescription" class="task-card" open>
          <summary class="task-card-summary">
            <FileText :size="14" />
            <span>{{ t('subagentPanel.taskDescription') }}</span>
          </summary>
          <div class="task-card-body">
            <MarkdownRenderer :content="taskDescription" />
          </div>
        </details>

        <!-- Activity timeline: reuse AgentTimeline -->
        <div v-if="streamMessages.length" class="activity-section">
          <AgentTimeline
            :messages="streamMessages"
            :loading="isRunning"
          />
        </div>

        <!-- Running indicator: three bouncing dots, same as main chat -->
        <div v-if="isRunning && streamMessages.length" class="typing-indicator">
          <div class="dot"></div>
          <div class="dot"></div>
          <div class="dot"></div>
        </div>

        <!-- Final result (when complete and no transcript) -->
        <div v-if="!isRunning && finalOutput && !streamMessages.length" class="result-section">
          <div class="section-header">
            <MessageCircle :size="14" />
            <span>{{ t('subagentPanel.result') }}</span>
          </div>
          <div class="result-body">
            <MarkdownRenderer :content="finalOutput" />
          </div>
        </div>

        <!-- Empty state while waiting for first message -->
        <div v-if="!hasContent" class="subagent-waiting">
          <Loader2 :size="20" class="spin-icon" />
          <p>{{ t('subagentPanel.waiting') }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useAppStore } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useSubagentTranscript } from '@/composables/useSubagentTranscript'
import { useI18n } from 'vue-i18n'
import { parseAgentToolOutput, extractAgentDisplayText, isAgentLaunchResult } from '@/services/teamTranscriptService'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import AgentTimeline from '@/components/chat/AgentTimeline.vue'
import { ArrowLeft, X, Bot, Clock, FileText, MessageCircle, Loader2 } from 'lucide-vue-next'

const appStore = useAppStore()
const sessionStore = useChatSessionStore()
const { t } = useI18n()

const panelState = computed(() => appStore.subagentPanelState)

// Find the tool call from the session messages
const toolCall = computed(() => {
  const state = panelState.value
  if (!state) return null
  const session = sessionStore.sessions.find(s => s.id === state.sessionId)
  if (!session) return null
  for (const msg of session.messages) {
    if (msg.toolCalls) {
      const found = msg.toolCalls.find(tc => tc.id === state.toolCallId)
      if (found) return found
    }
  }
  return null
})

// Subagent transcript (reactive, live-updating)
const toolCallId = computed(() => panelState.value?.toolCallId ?? '')
const { messages: streamMessages } = useSubagentTranscript(toolCallId)

// Derived state
const isRunning = computed(() => {
  const tc = toolCall.value
  return tc?.status === 'running' || tc?.status === 'pending'
})

const statusClass = computed(() => {
  const tc = toolCall.value
  if (tc?.status === 'running' || tc?.status === 'pending') return 'status-running'
  if (tc?.status === 'error') return 'status-error'
  return 'status-completed'
})

const agentType = computed(() =>
  toolCall.value?.input?.agentType || toolCall.value?.input?.type || 'Agent'
)

const agentName = computed(() => {
  const type = agentType.value
  return type === 'general-purpose' ? 'Agent' : String(type)
})

const modelName = computed(() =>
  toolCall.value?.input?.model || ''
)

const statusLabel = computed(() => {
  const tc = toolCall.value
  if (tc?.status === 'running' || tc?.status === 'pending') return t('subagentPanel.running')
  if (tc?.status === 'error') return t('subagentPanel.failed')
  return t('subagentPanel.done')
})

const taskDescription = computed(() => {
  const input = toolCall.value?.input || {}
  return (input.description || input.prompt || input.task || '') as string
})

const finalOutput = computed(() => {
  const o = toolCall.value?.output || ''
  if (!o) return ''
  const { displayText } = parseAgentToolOutput(o)
  const cleaned = extractAgentDisplayText(displayText)
  if (!cleaned || isAgentLaunchResult(cleaned)) return ''
  return cleaned
})

const hasContent = computed(() =>
  streamMessages.value.length > 0 || finalOutput.value
)

// Live elapsed timer
const elapsed = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

watch(isRunning, (running) => {
  if (running) {
    elapsed.value = 0
    timer = setInterval(() => { elapsed.value++ }, 1000)
  } else {
    if (timer) { clearInterval(timer); timer = null }
  }
}, { immediate: true })

onUnmounted(() => {
  if (timer) { clearInterval(timer); timer = null }
})

const formattedElapsed = computed(() => {
  const s = elapsed.value
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`
})

// Clean up on panel close
watch(() => appStore.subagentPanelState, (state) => {
  if (!state && timer) {
    clearInterval(timer)
    timer = null
  }
})
</script>

<style lang="scss" scoped>
.subagent-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.subagent-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
}

.nav-back-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.nav-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

.subagent-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--text-muted);
  font-size: 13px;
}

/* Hero */
.subagent-hero {
  padding: 12px 16px;
  background: var(--surface-glass);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
  position: sticky;
  top: 0;
  z-index: 5;
}

.hero-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hero-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  &.status-running {
    background: var(--accent-tertiary);
    animation: hero-pulse 1.5s ease-in-out infinite;
  }
  &.status-completed {
    background: var(--success);
  }
  &.status-error {
    background: var(--error);
  }
}

@keyframes hero-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.hero-icon {
  flex-shrink: 0;

  &.status-running {
    color: var(--accent-tertiary);
    animation: hero-spin 1s linear infinite;
  }
  &.status-completed {
    color: var(--success);
  }
  &.status-error {
    color: var(--error);
  }
}

@keyframes hero-spin {
  to { transform: rotate(360deg); }
}

.hero-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.hero-type {
  font-size: 12px;
  color: var(--text-muted);
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--surface-glass-hover);
}

.hero-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-left: 16px;
}

.hero-model {
  font-size: 12px;
  color: var(--text-muted);
}

.hero-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 10px;

  &.status-running {
    background: color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent);
    color: var(--warning, #f59e0b);
  }
  &.status-completed {
    background: color-mix(in srgb, var(--success, #22c55e) 12%, transparent);
    color: var(--success, #22c55e);
  }
  &.status-error {
    background: color-mix(in srgb, var(--error, #ef4444) 12%, transparent);
    color: var(--error, #ef4444);
  }
}

.hero-timer {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

/* Scrollable body */
.subagent-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

/* Task description card */
.task-card {
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--bg-secondary);
  overflow: hidden;

  &[open] .task-card-summary {
    border-bottom: 1px solid var(--surface-border);
  }
}

.task-card-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;

  &:hover {
    background: var(--surface-glass-hover);
  }

  &::marker {
    font-size: 10px;
  }
}

.task-card-body {
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
}

/* Result section */
.result-section {
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--bg-secondary);
  overflow: hidden;
  margin-top: 12px;

  .section-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--surface-border);
    background: var(--surface-glass);
  }

  .result-body {
    padding: 12px;
    font-size: 13px;
    line-height: 1.6;
  }
}

/* Activity section */
.activity-section {
  margin-top: 12px;
}

/* Running indicator (three bouncing dots, same as main chat) */
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 12px 2px;

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent-primary);
    animation: typing-bounce 1.4s infinite ease-in-out both;

    &:nth-child(1) { animation-delay: -0.32s; }
    &:nth-child(2) { animation-delay: -0.16s; }
  }
}

@keyframes typing-bounce {
  0%, 80%, 100% {
    transform: scale(0);
  }
  40% {
    transform: scale(1);
  }
}

/* Waiting / empty state */
.subagent-waiting {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 0;
  gap: 12px;
  color: var(--text-muted);
  font-size: 13px;

  .spin-icon {
    animation: hero-spin 1s linear infinite;
    color: var(--accent-tertiary);
  }
}
</style>
