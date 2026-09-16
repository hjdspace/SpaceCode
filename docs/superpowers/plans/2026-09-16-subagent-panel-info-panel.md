# Subagent Panel in InfoPanel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move subagent detail display from inline expansion (AgentToolCard) to a right-side InfoPanel mode, matching PI-Desktop UX.

**Architecture:** Add `subagent` mode to InfoPanel via a new `SubagentPanel.vue` component that reuses `AgentTimeline` and `MarkdownRenderer`. Clicking AgentToolCard opens the panel; clicking "Back" restores the previous InfoPanel tab.

**Tech Stack:** Vue 3 + TypeScript + Pinia + SCSS

---

### Task 1: Extend InfoPanelTabType and add store state

**Files:**
- Modify: `src/types/index.ts:57`
- Modify: `src/stores/app.ts:57,88-106,164-166,896-987`

- [ ] **Step 1: Add `'subagent'` to `InfoPanelTabType`**

In `src/types/index.ts`, line 57, change:
```typescript
export type InfoPanelTabType = 'file' | 'markdown' | 'diff' | 'tool-diff' | 'webview' | 'terminal' | 'artifacts' | 'office-preview' | 'design-preview'
```
To:
```typescript
export type InfoPanelTabType = 'file' | 'markdown' | 'diff' | 'tool-diff' | 'webview' | 'terminal' | 'artifacts' | 'office-preview' | 'design-preview' | 'subagent'
```

- [ ] **Step 2: Add subagent panel types and state to app store**

In `src/stores/app.ts`, add after `InfoPanelTab` interface (after line 66):

```typescript
export interface SubagentPanelState {
  toolCallId: string
  sessionId: string
}
```

Add state refs after `activeInfoTabId` (after line 105):

```typescript
const subagentPanelState = ref<SubagentPanelState | null>(null)
// Shadow state to restore InfoPanel after closing subagent view
let _previousActiveTabId: string | null = null
let _previousPanelHome = false
```

- [ ] **Step 3: Add `openSubagentPanel` and `closeSubagentPanel` actions**

In `src/stores/app.ts`, add after `closeAllInfoTabs` (after line 282):

```typescript
function openSubagentPanel(toolCallId: string) {
  const sessionStore = useChatSessionStore()
  // Save current panel state for restore
  _previousActiveTabId = activeInfoTabId.value
  _previousPanelHome = panelHome.value
  subagentPanelState.value = {
    toolCallId,
    sessionId: sessionStore.currentSessionId ?? '',
  }
  infoPanelVisible.value = true
  panelHome.value = false
}

function closeSubagentPanel() {
  subagentPanelState.value = null
  // Restore previous panel state
  if (_previousActiveTabId) {
    activeInfoTabId.value = _previousActiveTabId
    panelHome.value = _previousPanelHome
  } else {
    panelHome.value = true
  }
}
```

- [ ] **Step 4: Modify `infoPanelMode` computed to handle subagent**

In `src/stores/app.ts`, change `infoPanelMode` (lines 164-166) from:
```typescript
const infoPanelMode = computed<InfoPanelTabType>(() => {
  return activeInfoTab.value?.type ?? 'file'
})
```
To:
```typescript
const infoPanelMode = computed<InfoPanelTabType>(() => {
  if (subagentPanelState.value) return 'subagent'
  return activeInfoTab.value?.type ?? 'file'
})
```

- [ ] **Step 5: Modify `toggleInfoPanel` to close subagent panel if open**

In `src/stores/app.ts`, change `toggleInfoPanel` (lines 347-356) from:
```typescript
function toggleInfoPanel() {
  if (infoPanelVisible.value) {
    infoPanelVisible.value = false
  } else {
    infoPanelVisible.value = true
    if (infoPanelTabs.value.length === 0) {
      panelHome.value = true
    }
  }
}
```
To:
```typescript
function toggleInfoPanel() {
  if (infoPanelVisible.value) {
    if (subagentPanelState.value) {
      closeSubagentPanel()
    }
    infoPanelVisible.value = false
  } else {
    infoPanelVisible.value = true
    if (infoPanelTabs.value.length === 0) {
      panelHome.value = true
    }
  }
}
```

- [ ] **Step 6: Export new state and actions**

In `src/stores/app.ts`, add to the return block (after line 910, before `infoPanelTabs`):
```typescript
subagentPanelState,
```
And after line 944 (`showInfoPanel`):
```typescript
openSubagentPanel,
closeSubagentPanel,
```

- [ ] **Step 7: Build to verify**

```bash
npm run build
```
Expected: TypeScript compiles without new errors. The pre-existing `@vue-flow/*` errors are unrelated.

- [ ] **Step 8: Commit**

```bash
git add src/types/index.ts src/stores/app.ts
git commit -m "feat: add subagent panel state management to app store

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

---

### Task 2: Create SubagentPanel.vue component

**Files:**
- Create: `src/components/layout/SubagentPanel.vue`

- [ ] **Step 1: Create the component file**

Create `src/components/layout/SubagentPanel.vue`:

```vue
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

// ── Find the tool call from the session messages ──
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

// ── Subagent transcript (reactive, live-updating) ──
const toolCallId = computed(() => panelState.value?.toolCallId ?? '')
const { messages: streamMessages } = useSubagentTranscript(toolCallId)

// ── Derived state ──
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

// ── Live elapsed timer ──
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

// ── Clean up on panel close ──
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

/* ── Hero ── */
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

/* ── Scrollable body ── */
.subagent-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

/* ── Task description card ── */
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

/* ── Result section ── */
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

/* ── Activity section ── */
.activity-section {
  margin-top: 12px;
}

/* ── Waiting / empty state ── */
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
```

- [ ] **Step 2: Add i18n keys for SubagentPanel**

In `src/i18n/locales/en-US.ts`, add after the `toolCards` block (find a suitable location after line 2169):

```typescript
subagentPanel: {
  backToChat: 'Back to chat',
  notFound: 'Subagent not found',
  taskDescription: 'Task Description',
  result: 'Result',
  waiting: 'Waiting for subagent to start...',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
},
```

In `src/i18n/locales/zh-CN.ts`, add at the same location:

```typescript
subagentPanel: {
  backToChat: '返回聊天',
  notFound: '未找到子智能体',
  taskDescription: '任务描述',
  result: '结果',
  waiting: '等待子智能体启动...',
  running: '运行中',
  done: '已完成',
  failed: '失败',
},
```

- [ ] **Step 3: Build to verify**

```bash
npm run build
```
Expected: TypeScript compiles without new errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/SubagentPanel.vue src/i18n/locales/en-US.ts src/i18n/locales/zh-CN.ts
git commit -m "feat: add SubagentPanel component for InfoPanel subagent mode

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

---

### Task 3: Wire SubagentPanel into InfoPanel

**Files:**
- Modify: `src/components/layout/InfoPanel.vue:1-163`

- [ ] **Step 1: Add SubagentPanel import and template branch**

In `src/components/layout/InfoPanel.vue`:

**In the template** (after the `<script setup>` opening comment or import block doesn't matter for correctness — add the component import in `<script setup>`):

Add import after line 180:
```typescript
import SubagentPanel from './SubagentPanel.vue'
```

Add a new template branch inside the `<div class="panel-content">` block. The subagent mode should appear BEFORE the PanelLauncher and other mode checks, since it's a "mode override" not a tab. Add right after `<div class="panel-content">` (line 5):

```vue
<div class="panel-content">
  <!-- Subagent panel: overrides normal tab content -->
  <SubagentPanel v-if="mode === 'subagent'" />

  <PanelLauncher v-if="showLauncher && mode !== 'subagent' && !showLauncher" />
```

Wait — this would break the logic. Let me reconsider. The PanelLauncher and other mode conditions already use `showLauncher` which is `appStore.panelHome || appStore.infoPanelTabs.length === 0`. Since `openSubagentPanel` sets `panelHome = false`, `showLauncher` will be false. And since `mode` is now `'subagent'`, the existing `v-if/v-else-if` chain won't match any branch. So the simplest fix is:

Replace line 5-6:
```vue
    <div class="panel-content">
      <PanelLauncher v-if="showLauncher" />
```
With:
```vue
    <div class="panel-content">
      <SubagentPanel v-if="mode === 'subagent'" />
      <PanelLauncher v-else-if="showLauncher" />
```

And in the `<script setup>` block, add the import after the existing component imports (after line 180):
```typescript
import SubagentPanel from './SubagentPanel.vue'
```

- [ ] **Step 2: Build to verify**

```bash
npm run build
```
Expected: TypeScript compiles without new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/InfoPanel.vue
git commit -m "feat: wire SubagentPanel into InfoPanel subagent mode

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

---

### Task 4: Simplify AgentToolCard — remove inline expand, add panel trigger

**Files:**
- Modify: `src/components/chat/tools/AgentToolCard.vue`

- [ ] **Step 1: Rewrite the template — remove expand, add click handler**

Replace the entire template (lines 1-77) in `AgentToolCard.vue`:

```vue
<template>
  <div class="agent-tool-row">
    <!-- Clickable header → opens subagent panel -->
    <div class="agent-header" @click="openInPanel">
      <Bot :size="14" class="agent-icon" :class="statusClass" />
      <span class="agent-label">{{ t('toolCards.agent') }}</span>
      <span class="agent-type">{{ agentTypeDisplay }}</span>
      <span class="agent-separator">·</span>
      <span class="agent-task">{{ taskSummary }}</span>
      <!-- 状态徽章 -->
      <span v-if="statusBadge" class="agent-status-badge" :class="statusBadgeClass">
        {{ statusBadge }}
      </span>
      <ExternalLink :size="13" class="panel-hint-icon" />
    </div>

    <!-- 折叠态预览：输出摘要 / 最近工具调用活动 -->
    <div v-if="outputPreview || recentToolCalls.length" class="agent-preview">
      <div v-if="outputPreview" class="preview-output">{{ outputPreview }}</div>
      <div v-if="recentToolCalls.length && !outputPreview" class="preview-activity">
        <div v-for="tc in recentToolCalls" :key="tc.id" class="activity-item">
          {{ formatToolCallSummary(tc) }}
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 2: Rewrite the script — remove expand logic, add panel trigger**

Replace the entire `<script setup>` block (lines 80-247):

```typescript
import type { ToolCall, Message } from '@/types'
import { Bot, ExternalLink } from 'lucide-vue-next'
import type { Component } from 'vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import {
  parseAgentToolOutput,
  extractAgentDisplayText,
  getAgentOutputSummary,
  isAgentLaunchResult,
  formatToolCallSummary,
} from '@/services/teamTranscriptService'
import { useSubagentTranscript } from '@/composables/useSubagentTranscript'

const props = defineProps<{ toolCall: ToolCall }>()
const { t } = useI18n()
const appStore = useAppStore()
const { messages: streamMessages } = useSubagentTranscript(() => props.toolCall.id)

const MAX_OUTPUT = 4000
const MAX_RECENT_TOOL_CALLS = 3

const statusClass = computed(() => `status-${props.toolCall.status}`)

const agentTypeDisplay = computed(() => {
  const type = props.toolCall.input?.agentType || props.toolCall.input?.type || 'general-purpose'
  return type === 'general-purpose' ? 'Agent' : String(type)
})

function getFirstStringField(input: Record<string, unknown>, fields: string[]): string {
  for (const field of fields) {
    const value = input[field]
    if (typeof value === 'string') return value
  }
  return ''
}

const taskSummary = computed(() =>
  getFirstStringField(props.toolCall.input || {}, ['description', 'prompt', 'task', 'content'])
)

// ── 折叠态预览逻辑（保留）──
const recentToolCalls = computed<ToolCall[]>(() => {
  const result: ToolCall[] = []
  for (const msg of streamMessages.value) {
    if (msg.toolCalls) {
      result.push(...msg.toolCalls)
    }
  }
  return result.slice(-MAX_RECENT_TOOL_CALLS)
})

const assistantTexts = computed<Message[]>(() =>
  streamMessages.value.filter(msg => msg.role === 'assistant' && msg.content?.trim())
)

const renderedOutput = computed(() => {
  if (streamMessages.value.length) return ''
  const o = props.toolCall.output || ''
  if (!o) return ''
  const { displayText } = parseAgentToolOutput(o)
  const cleaned = extractAgentDisplayText(displayText)
  if (!cleaned || isAgentLaunchResult(cleaned)) return ''
  return cleaned.length > MAX_OUTPUT ? cleaned.slice(0, MAX_OUTPUT) + '\n\n...' : cleaned
})

const outputPreview = computed(() => {
  if (renderedOutput.value) {
    return getAgentOutputSummary(renderedOutput.value)
  }
  const lastAssistant = assistantTexts.value[assistantTexts.value.length - 1]
  if (lastAssistant?.content?.trim()) {
    return getAgentOutputSummary(lastAssistant.content)
  }
  return ''
})

const statusBadge = computed(() => {
  if (props.toolCall.status === 'running' || props.toolCall.status === 'pending') {
    return t('toolCards.agentStatusRunning')
  }
  if (props.toolCall.status === 'error') {
    return t('toolCards.agentStatusFailed')
  }
  if (props.toolCall.status === 'completed') {
    return t('toolCards.agentStatusDone')
  }
  return ''
})

const statusBadgeClass = computed(() => {
  if (props.toolCall.status === 'running' || props.toolCall.status === 'pending') return 'badge-running'
  if (props.toolCall.status === 'error') return 'badge-failed'
  if (props.toolCall.status === 'completed') return 'badge-done'
  return ''
})

function openInPanel() {
  appStore.openSubagentPanel(props.toolCall.id)
}
```

- [ ] **Step 3: Replace the SCSS — remove expand-related styles, add panel hint icon**

Replace the entire `<style lang="scss" scoped>` block (lines 249-567):

```scss
.agent-tool-row {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  font-size: 13px;
}

.agent-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);

  &:hover {
    background: var(--surface-glass-hover);
  }
}

.agent-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);

  &.status-running {
    color: var(--accent-tertiary);
    animation: agent-spin 1s linear infinite;
  }

  &.status-completed {
    color: var(--success);
  }

  &.status-error {
    color: var(--error);
  }
}

@keyframes agent-spin {
  to { transform: rotate(360deg); }
}

.agent-label {
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.agent-type {
  font-size: 13px;
  color: var(--accent-tertiary);
  font-weight: 500;
  flex-shrink: 0;
}

.agent-separator {
  font-size: 13px;
  color: var(--text-disabled);
  flex-shrink: 0;
}

.agent-task {
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.agent-status-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.4;

  &.badge-running {
    background: color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent);
    color: var(--warning, #f59e0b);
  }

  &.badge-done {
    background: color-mix(in srgb, var(--success, #22c55e) 12%, transparent);
    color: var(--success, #22c55e);
  }

  &.badge-failed {
    background: color-mix(in srgb, var(--error, #ef4444) 12%, transparent);
    color: var(--error, #ef4444);
  }
}

/* 面板跳转图标，在 hover 时显示 */
.panel-hint-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0;
  transition: opacity var(--transition-fast);
  margin-left: auto;
}

.agent-header:hover .panel-hint-icon {
  opacity: 0.6;
}

/* ── 折叠态预览 ── */
.agent-preview {
  padding: 2px 8px 4px 28px;
  max-width: 100%;
}

.preview-output {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-activity {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.activity-item {
  font-size: 11px;
  color: var(--text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 4: Build to verify**

```bash
npm run build
```
Expected: TypeScript compiles without new errors.

- [ ] **Step 5: Run tests**

```bash
npm run test
```
Expected: All existing tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/tools/AgentToolCard.vue
git commit -m "feat: replace AgentToolCard inline expand with InfoPanel trigger

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

---

### Task 5: Verification — build + test + manual smoke

- [ ] **Step 1: Full build**

```bash
npm run build
```
Expected: Clean build, no new errors.

- [ ] **Step 2: Run test suite**

```bash
npm run test
```
Expected: All tests pass.

- [ ] **Step 3: Commit final verification**

```bash
git add -A
git commit -m "chore: final verification of subagent panel implementation

Co-Authored-By: Claude Sonnet 4 <noreply@anthropic.com>"
```

---

## Manual Test Checklist

After the app launches:

1. Start a conversation that triggers an Agent tool call (e.g., "search the codebase for authentication logic")
2. Verify the Agent tool card appears in the timeline with preview text and a `→` (ExternalLink) icon on hover
3. Click the card → InfoPanel opens with the subagent detail view
4. Verify the sticky hero shows: status dot, agent name, agent type, status badge, live timer
5. Verify the task description card is visible and expandable/collapsible
6. Verify tool calls appear in the AgentTimeline area as they happen
7. Verify markdown output renders in the panel
8. Verify the live timer ticks while the subagent is running
9. Click "Back to chat" → InfoPanel returns to previous state (home launcher or previous tab)
10. Verify clicking the same AgentToolCard again re-opens the panel
