<template>
  <main class="chat-panel">
    <SessionTabBar
      :pane-id="paneId"
      :active-tab-id-override="paneTabId"
      @new-session="handleNewSession"
      @switch-session="handleSwitchSession"
      @close-tab="handleCloseTab"
    />
    
    <!-- Terminal Panel: v-show 保持挂载，避免切换标签时终端被销毁 -->
    <div v-if="terminalPanelMounted" v-show="isTerminalTab" class="terminal-wrapper">
      <TerminalPanel />
    </div>
    
    <!-- Chat Content -->
    <div v-show="!isTerminalTab" class="chat-content-wrapper">
      <div class="chat-header">
        <div class="header-left">
          <h2>{{ currentSession?.title || t('common.newConversation') }}</h2>
        </div>
        <div class="header-actions">
          <button
            class="history-btn"
            @click="showHistoryModal = true"
            :title="t('chatPanel.historyConversations')"
            :aria-label="t('chatPanel.historyConversations')"
          >
            <History :size="16" />
          </button>
          <span class="agent-badge" v-if="sessionStore.currentAgent" :title="sessionStore.currentAgent">
            <span class="badge-dot agent-dot" aria-hidden="true"></span>
            {{ sessionStore.currentAgent }}
          </span>          <span class="model-badge" v-if="currentModel" :title="currentModel">
            <span class="badge-dot" aria-hidden="true"></span>
            {{ formatModelName(currentModel) }}
          </span>
          <ContextUsageChip
            v-if="!showNoProjectWelcome"
            @open="showContextModal = true"
          />
          <span class="provider-badge" v-if="provider">
            <span class="badge-dot" aria-hidden="true"></span>
            {{ provider.toUpperCase() }}
          </span>
          <span class="status-indicator" :class="{ configured: isConfigured }">
            <span class="status-dot" aria-hidden="true"></span>
            <span class="status-text">{{ isConfigured ? t('chat.ready') : t('chat.notConfigured') }}</span>
          </span>
        </div>
      </div>

      <!-- Body: flex-row with chat left + panel right -->
      <div class="chat-body-row">
        <!-- Left: Chat area -->
        <div
          ref="chatMainRef"
          class="chat-main"
          :class="{ 'with-env-panel': sessionContext.showEnvPanel, 'chat-main-reserved': chatMainReservesEnvPanel }"
        >
          <div class="chat-panel-body">
            <NoProjectHome v-if="showNoProjectWelcome" />

            <template v-else>
              <TeammateTranscriptHeader
                v-if="paneIsViewingTeammate"
                :teammate="paneViewedTeammate"
                @back="sessionStore.backToLeaderView"
              />

              <MessageList
                :messages="paneMessages"
                :loading="paneIsLoading"
                @tool-submit="handleToolSubmit"
                @tool-skip="handleToolSkip"
                @rewind="handleMessageRewind"
              />

              <RecommendedPrompts />
              <WorkAssistantShortcuts />
            </template>
          </div>

          <TeamStatusBar
            v-if="!showNoProjectWelcome"
            :team-context="paneTeamContext"
            :viewing-agent-task-id="paneViewedAgentTaskId"
            @view-teammate="sessionStore.viewTeammateTranscript"
          />

          <ContextUsageWarningBar
            v-if="!showNoProjectWelcome"
            @open="showContextModal = true"
          />

          <ChatInput
            @send="handleSend"
            @slash-command="handleSlashCommand"
            @update:model="handleModelChange"
            @update:effort="handleEffortChange"
            @update:agent="handleAgentChange"
            @open-skills="handleOpenSkills"
            @stop="handleStop"
            :disabled="paneIsLoading"
            :is-sending="paneIsLoading"
            :model-value="currentModel"
            :working-directory="paneWorkingDirectory"
            :placeholder="t('chat.askAnything')"
            :show-open-project-action="showNoProjectWelcome"
          />
          <ToastNotification />

          <!-- Work 模式自动路由：多助手匹配时的选择弹窗 -->
          <WorkAssistantPicker
            v-if="pickerVisible"
            v-model:visible="pickerVisible"
            :candidates="pickerCandidates"
            @confirm="onPickerConfirm"
            @cancel="onPickerCancel"
          />

          <!-- Rewind Dialog -->
          <RewindDialog
            v-if="sessionStore.rewindState.showDialog"
            :show="sessionStore.rewindState.showDialog"
            :selected-message-id="sessionStore.rewindState.selectedMessageId"
            :message-content="rewindSelectedMessageContent"
            :selected-option="sessionStore.rewindState.selectedOption"
            :summarize-feedback="sessionStore.rewindState.summarizeFeedback"
            :is-rewinding="sessionStore.rewindState.isRewinding"
            :error="sessionStore.rewindState.error"
            :diff-stats="null"
            @update:show="sessionStore.setShowRewindDialog"
            @update:selected-option="sessionStore.setRewindSelectedOption"
            @update:summarize-feedback="sessionStore.setRewindSummarizeFeedback"
            @confirm="handleRewindConfirm"
            @cancel="handleRewindCancel"
          />

          <!-- Code Rewind Confirmation Dialog -->
          <CodeRewindConfirmDialog
            v-if="sessionStore.rewindState.showCodeConfirm"
            :show="sessionStore.rewindState.showCodeConfirm"
            :files="[...sessionStore.rewindState.filesToRewind]"
            :is-loading="sessionStore.rewindState.isRewinding"
            @confirm="handleCodeRewindConfirm"
            @cancel="handleCodeRewindCancel"
          />

          <!-- Message Selector for /rewind command -->
          <MessageSelector
            v-if="showMessageSelector"
            :show="showMessageSelector"
            :messages="userMessages"
            :selected-message-id="sessionStore.rewindState.selectedMessageId"
            @update:show="showMessageSelector = $event"
            @select="handleMessageSelect"
            @cancel="showMessageSelector = false"
          />
        </div>

        <!-- Right: Env Panel (floating glassmorphism card) -->
        <Transition name="sc-env-fade">
          <SessionContextEnvPanel v-if="sessionContext.showEnvPanel" @continue="handleContinue" />
        </Transition>

        <!-- Right: Detail Panel (tasks/review) -->
        <Transition name="sc-panel-slide">
          <SessionContextTaskPanel v-if="sessionContext.showRightPanel" />
        </Transition>

        <!-- Capsule (shown when env panel is collapsed: by user, by activity, or always-collapse mode) -->
        <Transition name="sc-capsule-fade">
          <div
            v-if="!sessionContext.showEnvPanel && (sessionContext.hasActivity || sessionContext.userOverride || sessionContext.panelExpandMode === 'always-collapse')"
            class="sc-capsule"
            :class="{ 'sc-capsule-shifted': sessionContext.showRightPanel }"
            @click="sessionContext.openEnvPanel()"
          >
            <ClipboardList :size="14" />
            <span class="sc-capsule-text" v-if="sessionContext.tasks.length > 0">{{ sessionContext.taskProgress.completed }}/{{ sessionContext.taskProgress.total }}</span>
            <span class="sc-capsule-text" v-else-if="sessionContext.gitAdditions > 0 || sessionContext.gitDeletions > 0 || sessionContext.changedFiles.length > 0">+{{ sessionContext.gitAdditions }} -{{ sessionContext.gitDeletions }}</span>
            <span class="sc-capsule-text" v-else>{{ t('sessionContext.gitTools') }}</span>
          </div>
        </Transition>
      </div>
    </div>
    
    <!-- History Session Modal -->
    <Transition name="modal-fade">
      <div 
        v-if="showHistoryModal" 
        class="history-modal-overlay" 
        @click.self="showHistoryModal = false"
      >
        <div class="history-modal-content">
          <div class="history-modal-header">
            <h3>{{ t('chatPanel.restoreHistory') }}</h3>
            <button class="history-close-btn" @click="showHistoryModal = false">×</button>
          </div>
          
          <div class="history-modal-body">
            <!-- Search Input -->
            <input
              type="text"
              v-model="historySearchQuery"
              :placeholder="t('chatPanel.searchPlaceholder')"
              class="history-search-input"
              autofocus
            />
            
            <!-- Session List -->
            <HistorySessionList
              :search-query="historySearchQuery"
              @select="handleRestoreHistorySession"
            />
          </div>
        </div>
      </div>
    </Transition>

    <ContextUsageModal v-if="showContextModal" v-model:show="showContextModal" />

    <!-- Diff 面板 -->
    <Transition name="modal">
      <div v-if="showDiffPanel" class="diff-overlay" @click.self="showDiffPanel = false">
        <div class="diff-modal">
          <div class="diff-modal-header">
            <h3>{{ t('chatPanel.gitDiff') }}</h3>
            <button class="diff-close-btn" @click="showDiffPanel = false">×</button>
          </div>
          <div class="diff-modal-body">
            <div v-if="diffPanelLoading" class="diff-loading">
              <p>{{ t('chatPanel.loadingDiff') }}</p>
            </div>
            <div v-else-if="!diffPanelData" class="diff-empty">
              <p>{{ t('chatPanel.workingTreeClean') }}</p>
            </div>
            <DiffExplorer v-else :diffData="diffPanelData" />
          </div>
        </div>
      </div>
    </Transition>

    <!-- Session Context Commit Dialog (modal overlay) -->
    <SessionContextCommitDialog
      v-if="sessionContext.showCommitDialog"
      @close="sessionContext.closeCommitDialog()"
    />

    <!-- Session Context Create Branch Dialog -->
    <SessionContextCreateBranchDialog v-if="sessionContext.showCreateBranchDialog" />

    <!-- Session Context Git Graph Modal -->
    <SessionContextGitGraphModal v-if="sessionContext.showGitGraphModal" />

    <!-- Session Context Push Dialog -->
    <SessionContextPushDialog v-if="sessionContext.showPushDialog" />
  </main>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTurnStore } from '@/stores/turn'
import { useChatSessionStore } from '@/stores/chatSession'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { useSplitLayoutStore } from '@/stores/splitLayout'
import MessageList from '../chat/MessageList.vue'
import RecommendedPrompts from '../chat/RecommendedPrompts.vue'
import WorkAssistantShortcuts from '../work/WorkAssistantShortcuts.vue'
import TeamStatusBar from '../chat/TeamStatusBar.vue'
import TeammateTranscriptHeader from '../chat/TeammateTranscriptHeader.vue'
import ChatInput, { type Attachment, type ImageAttachment } from '../chat/ChatInput.vue'

interface AllAttachments {
  files: Attachment[]
  images: ImageAttachment[]
}
import SessionTabBar from '../chat/SessionTabBar.vue'
import NoProjectHome from './NoProjectHome.vue'
import ToastNotification from '../common/ToastNotification.vue'
import { History, ClipboardList } from 'lucide-vue-next'
import ContextUsageChip from '../chat/ContextUsageChip.vue'
import ContextUsageWarningBar from '../chat/ContextUsageWarningBar.vue'
import { useContextUsageStore } from '@/stores/contextUsage'
import { useSessionContext } from '@/stores/sessionContext'
import { useScmStore } from '@/stores/scm'
import { useTaskManager } from '@/composables/useTaskManager'
import { syncTaskStateFromToolCall } from '@/utils/taskToolSync'
import { buildMessagesFromHistory } from '@/utils/sessionRestore'
import { initLLMService, llmState, updateConfig } from '@/services/llm'
import { pathsEqual } from '@/utils/recentProjectRoots'
import { useChatCommands } from '@/composables/useChatCommands'
import { useWorkRouter } from '@/composables/useWorkRouter'
import type { AgentDef } from '@/stores/agents'
import { api } from '@/services/electronAPI'
import { isH5Mode } from '@/services/h5ApiClient'
import type { Message } from '@/types'

const WorkAssistantPicker = defineAsyncComponent(() => import('../work/WorkAssistantPicker.vue'))
const TerminalPanel = defineAsyncComponent(() => import('../terminal/TerminalPanel.vue'))
const RewindDialog = defineAsyncComponent(() => import('../chat/RewindDialog.vue'))
const CodeRewindConfirmDialog = defineAsyncComponent(() => import('../chat/CodeRewindConfirmDialog.vue'))
const MessageSelector = defineAsyncComponent(() => import('../chat/MessageSelector.vue'))
const HistorySessionList = defineAsyncComponent(() => import('../explorer/HistorySessionList.vue'))
const ContextUsageModal = defineAsyncComponent(() => import('../chat/ContextUsageModal.vue'))
const DiffExplorer = defineAsyncComponent(() => import('../chat/DiffExplorer.vue'))
const SessionContextEnvPanel = defineAsyncComponent(() => import('../session-context/SessionContextEnvPanel.vue'))
const SessionContextTaskPanel = defineAsyncComponent(() => import('../session-context/SessionContextTaskPanel.vue'))
const SessionContextCommitDialog = defineAsyncComponent(() => import('../session-context/SessionContextCommitDialog.vue'))
const SessionContextCreateBranchDialog = defineAsyncComponent(() => import('../session-context/SessionContextCreateBranchDialog.vue'))
const SessionContextGitGraphModal = defineAsyncComponent(() => import('../session-context/SessionContextGitGraphModal.vue'))
const SessionContextPushDialog = defineAsyncComponent(() => import('../session-context/SessionContextPushDialog.vue'))

const turnStore = useTurnStore()
const sessionStore = useChatSessionStore()
const settingsStore = useSettingsStore()
const appStore = useAppStore()
const splitLayout = useSplitLayoutStore()
const { t } = useI18n()

// ── Pane props（分屏多 pane 时由 SplitContainer 传入；未传入 = 单屏，行为
//    与改造前完全一致：所有 pane-scoped 计算回退到全局 current*） ──
const props = defineProps<{
  /** 当前 pane 绑定的会话 id；未传时回退到 sessionStore.currentSessionId */
  sessionId?: string
  /** 所在 pane 的 id（用于焦点/active 同步等高级用法；当前阶段未消费） */
  paneId?: string
  /** 当前 pane 绑定的 centerTab id（分屏时由 PaneLeafView 传入；用于 pane 级标签高亮和终端判断） */
  paneTabId?: string
}>()

/** 用 prop 或 current 解析出本 pane 实际绑定的会话 id（可能为空字符串） */
const paneSessionId = computed(() => props.sessionId || sessionStore.currentSessionId || '')

/** Pane-scoped 数据：始终响应式跟踪所在 session（无 prop 时即 current 行为） */
const paneSession = computed(() =>
  props.sessionId ? sessionStore.getSession(paneSessionId.value) : sessionStore.currentSession
)
const paneMessages = computed(() =>
  props.sessionId ? sessionStore.getDisplayMessages(paneSessionId.value) : sessionStore.displayMessages
)
const paneRawMessages = computed(() =>
  props.sessionId ? sessionStore.getSessionMessages(paneSessionId.value) : sessionStore.currentMessages
)
const paneIsLoading = computed(() =>
  paneSessionId.value ? turnStore.getIsLoading(paneSessionId.value) : false
)
const paneWorkingDirectory = computed(() =>
  props.sessionId ? sessionStore.getWorkingDirectory(paneSessionId.value) : sessionStore.workingDirectory
)
const paneTeamContext = computed(() =>
  props.sessionId ? sessionStore.getTeamContext(paneSessionId.value) : sessionStore.currentTeamContext
)
const paneViewedAgentTaskId = computed(() =>
  props.sessionId ? sessionStore.getViewedAgentTaskId(paneSessionId.value) : sessionStore.currentViewedAgentTaskId
)
const paneIsViewingTeammate = computed(() =>
  props.sessionId ? sessionStore.getIsViewingTeammate(paneSessionId.value) : sessionStore.isViewingTeammate
)
const paneViewedTeammate = computed(() =>
  props.sessionId ? sessionStore.getViewedTeammate(paneSessionId.value) : sessionStore.viewedTeammate
)

const showHistoryModal = ref(false)
const historySearchQuery = ref('')
const showContextModal = ref(false)
const showDiffPanel = ref(false)
const diffPanelData = ref<any>(null)
const diffPanelLoading = ref(false)
const contextUsageStore = useContextUsageStore()
const sessionContext = useSessionContext()
const scmStore = useScmStore()
const taskManager = useTaskManager()

// ── Work 模式自动路由：助手选择弹窗 ──────────────────────────────
const { route: routeWork } = useWorkRouter()
const pickerVisible = ref(false)
const pickerCandidates = ref<AgentDef[]>([])
let pickerResolve: ((a: AgentDef | null) => void) | null = null

function pickAssistant(candidates: AgentDef[]): Promise<AgentDef | null> {
  pickerCandidates.value = candidates
  pickerVisible.value = true
  return new Promise(resolve => { pickerResolve = resolve })
}

function onPickerConfirm(a: AgentDef) {
  pickerVisible.value = false
  pickerResolve?.(a)
  pickerResolve = null
}

function onPickerCancel() {
  pickerVisible.value = false
  pickerResolve?.(null)
  pickerResolve = null
}

type RouteOutcome =
  | { kind: 'routed'; assistant: AgentDef }
  | { kind: 'cancel' }
  | { kind: 'passthrough' }

/** Work 模式发送前路由：匹配助手 / 咨询用户 / 透传 */
async function routeWorkSend(content: string): Promise<RouteOutcome> {
  const result = routeWork(content)
  if (result.type === 'match' && result.assistant) {
    return { kind: 'routed', assistant: result.assistant }
  }
  if (result.type === 'ask' && result.candidates.length > 0) {
    const chosen = await pickAssistant(result.candidates)
    if (!chosen) return { kind: 'cancel' }
    return { kind: 'routed', assistant: chosen }
  }
  return { kind: 'passthrough' }
}

// The floating env panel needs ~324px (300 panel + 12 right margin + 12 gutter).
// Reserve that space whenever the chat can still keep a usable composer/message
// width. Below this threshold (narrow split panes / very small windows) the
// panel remains a true overlay instead of squeezing the chat into an unusable
// column.
const ENV_PANEL_SHOULDER = 324
const CHAT_MAIN_MIN_RESERVED_WIDTH = 640
const CHAT_MAIN_RESERVE_THRESHOLD = CHAT_MAIN_MIN_RESERVED_WIDTH + ENV_PANEL_SHOULDER // 964px
const chatMainRef = ref<HTMLElement | null>(null)
const chatMainReservesEnvPanel = ref(false)

// React to chat-main mounting/unmounting (e.g. terminal tab ↔ chat tab) and
// to its width changing (window resize, sidebar toggle, right detail panel
// open/close). When the column is wide enough we apply `.chat-main-reserved`,
// which the SCSS below uses to give the floating env panel a real shoulder.
watchEffect((onCleanup) => {
  const el = chatMainRef.value
  if (!el || typeof ResizeObserver === 'undefined') return

  const updateReservation = (width: number) => {
    chatMainReservesEnvPanel.value = width >= CHAT_MAIN_RESERVE_THRESHOLD
  }

  updateReservation(el.getBoundingClientRect().width)

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.target.getBoundingClientRect().width
      updateReservation(width)
    }
  })
  observer.observe(el)
  onCleanup(() => observer.disconnect())
})

// 监听 TitleBar 的 diff 触发
const stopDiffWatch = watch(() => sessionStore.diffPanelTrigger, () => {
  fetchAndShowDiff()
})

onBeforeUnmount(() => {
  stopDiffWatch()
  document.removeEventListener('keydown', handleSessionContextEsc)
})

// Session Context: ESC to close floating panels
function handleSessionContextEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (sessionContext.showCommitDialog) {
      sessionContext.closeCommitDialog()
    } else if (sessionContext.showPushDialog) {
      sessionContext.closePushDialog()
    } else if (sessionContext.showCreateBranchDialog) {
      sessionContext.closeCreateBranchDialog()
    } else if (sessionContext.showGitGraphModal) {
      sessionContext.closeGitGraphModal()
    } else if (sessionContext.showPanelMenu) {
      sessionContext.closePanelMenu()
    } else if (sessionContext.showGitOpsMenu) {
      sessionContext.closeGitOpsMenu()
    } else if (sessionContext.showBranchDropdown) {
      sessionContext.closeBranchDropdown()
    } else if (sessionContext.showRightPanel) {
      sessionContext.closeRightPanel()
    } else if (sessionContext.showEnvPanel) {
      sessionContext.closeEnvPanel()
    }
  }
}
document.addEventListener('keydown', handleSessionContextEsc)

// Session Context: handle continue button from env panel
function handleContinue() {
  // Trigger the agent to continue with the current task
  // This is a placeholder - actual implementation depends on the chat flow
  console.log('[SessionContext] Continue requested')
}

// Session Context: sync git stats from the real diff line counts
let gitStatsRequestId = 0

watch(
  () => [
    paneWorkingDirectory.value,
    scmStore.staged,
    scmStore.unstaged,
    scmStore.untracked,
  ],
  async () => {
    const requestId = ++gitStatsRequestId
    const totalChanged =
      scmStore.staged.length +
      scmStore.unstaged.length +
      scmStore.untracked.length

    if (totalChanged === 0) {
      sessionContext.updateGitStats({ additions: 0, deletions: 0, files: [] })
      return
    }

    const cwd = paneWorkingDirectory.value || appStore.projectRoot
    if (!cwd) {
      sessionContext.updateGitStats({ additions: 0, deletions: 0, files: [] })
      return
    }

    try {
      const result = await api.git.getFullDiff(cwd)
      if (requestId !== gitStatsRequestId) return

      if (result?.stats && Array.isArray(result.files)) {
        sessionContext.updateGitStats({
          additions: result.stats.linesAdded,
          deletions: result.stats.linesRemoved,
          files: result.files.map(file => ({
            path: file.path,
            insertions: file.linesAdded,
            deletions: file.linesRemoved,
          })),
        })
      } else {
        sessionContext.updateGitStats({ additions: 0, deletions: 0, files: [] })
      }
    } catch (e) {
      if (requestId !== gitStatsRequestId) return
      console.error('[SessionContext] Failed to sync git stats:', e)
      sessionContext.updateGitStats({ additions: 0, deletions: 0, files: [] })
    }
  },
  { deep: true },
)
// Rebuild task state from the current session's message history.
// Fires on session switch (to restore tasks that were previously created)
// and on message changes (to pick up new TodoWrite/TaskCreate/TaskUpdate/
// TaskList tool calls as they arrive during streaming).
//
// ★ This replaces the previous two-watcher design (one watching displayMessages,
//   one clearing tasks on session switch) which had a race condition: the
//   clear watcher ran AFTER the sync watcher (creation order), wiping tasks
//   that had just been restored from the new session's message history.
//   The unified watcher clears first, then rebuilds — no race.
watch(
  () => [paneSessionId.value, paneMessages.value] as const,
  ([_sid, msgs]) => {
    // Clear stale tasks from the previous session, then rebuild from history.
    taskManager.clearTasks()

    // Replay all task-related tool calls in chronological order to reconstruct
    // the task state. Handles both V1 (TodoWrite) and V2 (TaskCreate/TaskUpdate/
    // TaskList) tool families.
    let latestTodos: any[] | null = null

    for (const msg of msgs) {
      if (!msg.toolCalls) continue
      for (const tc of msg.toolCalls) {
        if (tc.name === 'TodoWrite' && tc.input?.todos && Array.isArray(tc.input.todos)) {
          latestTodos = tc.input.todos as any[]
        } else if (tc.name === 'TaskCreate' || tc.name === 'TaskUpdate' || tc.name === 'TaskList') {
          // Replay V2 task tool calls using their input + output (result).
          // TaskList does a full syncFromList; TaskCreate/TaskUpdate are incremental.
          syncTaskStateFromToolCall(taskManager, tc, tc.output || '')
        }
      }
    }

    // TodoWrite is a full-replace operation — apply the latest one last so
    // it overwrites any incremental V2 state (the two families are mutually
    // exclusive, but this guarantees correctness if both ever coexist).
    if (latestTodos && latestTodos.length > 0) {
      taskManager.syncTasksFromList(
        latestTodos
          .filter(t => t && typeof t.content === 'string')
          .map(t => ({
            id: String(t.id ?? t.content),
            content: t.content,
            status: (['pending', 'in_progress', 'completed'].includes(t.status)
              ? t.status
              : 'pending') as 'pending' | 'in_progress' | 'completed',
          }))
      )
    }
  },
  { deep: true }
)

// Sync taskManager → sessionContext.tasks
// taskManager is the single source of truth for all task tools (TodoWrite +
// TaskCreate/TaskUpdate/TaskList). This watcher propagates changes to the
// sessionContext store, which drives the floating EnvPanel and right-side
// TaskPanel. It also triggers evaluateAutoExpand() so the EnvPanel
// auto-opens when tasks appear.
const _allManagerTasks = computed(() => taskManager.getAllTasks())
watch(
  _allManagerTasks,
  (tasks) => {
    if (tasks.length > 0) {
      sessionContext.updateTasks(
        tasks.map(t => ({
          id: t.id,
          content: t.content,
          status: t.status,
          owner: t.owner,
          blockedBy: t.blockedBy,
        }))
      )
    } else {
      // Clear sessionContext.tasks when taskManager is empty
      // (e.g. after switching sessions) so stale tasks don't linger.
      sessionContext.updateTasks([])
    }
  },
  { deep: true }
)

// Rewind state
const showMessageSelector = ref(false)

const rewindSelectedMessageContent = computed(() => {
  const messageId = sessionStore.rewindState.selectedMessageId
  if (!messageId) return ''
  const message = paneSession.value?.messages.find(m => m.id === messageId)
  return message?.content || ''
})

const userMessages = computed(() =>
  paneSession.value?.messages
    .filter(m => m.role === 'user')
    .map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content || '',
      timestamp: m.timestamp || Date.now()
    })) || []
)

async function handleRewindConfirm() {
  const option = sessionStore.rewindState.selectedOption
  const messageId = sessionStore.rewindState.selectedMessageId

  if (!messageId) return

  if (option === 'summarize') {
    sessionStore.summarizeTurn(
      paneSessionId.value || '',
      messageId,
      sessionStore.rewindState.summarizeFeedback
    )
    sessionStore.setShowRewindDialog(false)
    sessionStore.resetRewindState()
  } else if (option === 'cancel') {
    sessionStore.setShowRewindDialog(false)
    sessionStore.resetRewindState()
  } else if (option === 'both' || option === 'code') {
    // Show code rewind confirmation dialog for code-related modes
    await openCodeRewindConfirm()
  } else {
    // conversation mode - no code changes, proceed directly
    executeRewind()
  }
}

async function openCodeRewindConfirm() {
  if (!sessionStore.rewindState.selectedMessageId || !paneSessionId.value) return

  if (sessionStore.turnChangeCards.length === 0) {
    await sessionStore.loadTurnCheckpoints(
      paneSessionId.value,
      paneWorkingDirectory.value || undefined
    )
  }

  const files = await sessionStore.loadFilesToRewind(
    paneSessionId.value,
    sessionStore.rewindState.selectedMessageId
  )

  if (files.length > 0) {
    sessionStore.setFilesToRewind(files)
    sessionStore.setShowCodeConfirm(true)
  } else {
    // No files to rollback, proceed directly
    executeRewind()
  }
}

function handleCodeRewindConfirm() {
  sessionStore.setShowCodeConfirm(false)
  executeRewind()
}

function handleCodeRewindCancel() {
  sessionStore.setShowCodeConfirm(false)
  // Return to main rewind dialog, don't close it
}

async function executeRewind() {
  const option = sessionStore.rewindState.selectedOption
  const messageId = sessionStore.rewindState.selectedMessageId

  if (!messageId) return

  try {
    await sessionStore.rewindSession(
      paneSessionId.value || '',
      messageId,
      option as 'both' | 'conversation' | 'code'
    )
    sessionStore.setShowRewindDialog(false)
    sessionStore.resetRewindState()
  } catch (err: any) {
    console.error('[ChatPanel] Rewind failed:', err)
  }
}

function handleRewindCancel() {
  sessionStore.resetRewindState()
}

function handleMessageSelect(messageId: string) {
  showMessageSelector.value = false
  sessionStore.setRewindSelectedMessage(messageId)
  sessionStore.setShowRewindDialog(true)
}

function handleOpenRewind() {
  showMessageSelector.value = true
}

function handleMessageRewind(message: Message) {
  sessionStore.setRewindSelectedMessage(message.id)
  sessionStore.setShowRewindDialog(true)
}

const chatCommands = useChatCommands({
  sessionId: paneSessionId.value,
  messages: paneRawMessages.value,
  onOpenSkills: () => {
    handleOpenSkills()
  },
  onOpenRewind: () => {
    handleOpenRewind()
  },
})

const currentSession = computed(() => paneSession.value)
const provider = computed(() => llmState.provider.value)
const isConfigured = computed(() => llmState.isConfigured.value)

// Check if current tab is a terminal tab
// 分屏模式下用 paneTabId 判断，避免全局 activeCenterTab 被其他 pane 切换而串扰
const isTerminalTab = computed(() => {
  if (props.paneTabId) {
    return props.paneTabId.startsWith('terminal-')
  }
  return appStore.activeCenterTab.startsWith('terminal-')
})

// Defer xterm and PTY UI until the first terminal visit, then keep it mounted.
const terminalPanelMounted = ref(isTerminalTab.value)
watch(isTerminalTab, (active) => {
  if (active) terminalPanelMounted.value = true
})

/** At least one conversation is bound to a real folder (sidebar / CLI cwd), not only default chat */
const hasWorkspaceContext = computed(() =>
  sessionStore.sessions.some((s) => !!(s.workingDirectory && String(s.workingDirectory).trim()))
)

/** No folder context in chat/projects list, or app has not bound a project root yet */
const showNoProjectWelcome = computed(() => {
  if (isTerminalTab.value) return false
  // H5 模式下不显示“无项目”欢迎页 — 手机端通过镜像会话访问，
  // 即使桌面端没有打开项目，也应该显示聊天界面让用户能看到消息
  if (isH5Mode()) return false
  if (!hasWorkspaceContext.value) return true
  return !(appStore.projectRoot || '').trim()
})

watch(
  () => ({
    has: hasWorkspaceContext.value,
    root: (appStore.projectRoot || '').trim(),
    terminal: isTerminalTab.value,
  }),
  ({ has, root, terminal }) => {
    if (terminal) return
    // H5 模式下跳过会话清理 — 手机端会话由桌面端管理，不应自动删除
    if (isH5Mode()) return
    if (!has) {
      // 只移除当前项目相关的会话
      const sessionsToRemove = sessionStore.sessions.filter(s =>
        pathsEqual(s.workingDirectory || '', root)
      )
      sessionsToRemove.forEach(s => sessionStore.deleteSession(s.id))

      if (pathsEqual(appStore.projectRoot, root)) {
        appStore.closeProject()
        sessionStore.switchProject('')
      }
    }
  },
  { flush: 'post' }
)

// 当前选中的模型
const currentModel = ref('')

// 初始化时从 settings 加载模型
onMounted(async () => {
  await initLLMService()
  currentModel.value = settingsStore.config.model || ''
  if (paneSessionId.value) {
    void contextUsageStore.refresh(paneSessionId.value)
  }

  // Initialize SCM store: starts file watcher, which will trigger
  // git stats sync → auto-expand the env panel when changes appear.
  void scmStore.refresh()

  // chat-main width is observed by the watchEffect above (reactive to chatMainRef)

  // Dev helper: expose sessionContext store for console testing
  if (import.meta.env.DEV) {
    ;(window as any).__sc = {
      openEnv: () => sessionContext.openEnvPanel(),
      closeEnv: () => sessionContext.closeEnvPanel(),
      openReview: () => sessionContext.openRightPanel('review'),
      openTasks: () => sessionContext.openRightPanel('tasks'),
      closeRight: () => sessionContext.closeRightPanel(),
      toggleBranch: () => sessionContext.toggleBranchDropdown(),
      openCommit: () => sessionContext.openCommitDialog(),
      setTasks: (tasks: any[]) => sessionContext.updateTasks(tasks),
      setGitStats: (stats: any) => sessionContext.updateGitStats(stats),
      store: sessionContext,
    }
    console.log('[Dev] Session Context API: __sc.openEnv() / __sc.openReview() / __sc.setTasks([...])')
  }
})

watch(
  () => [paneSessionId.value, paneIsLoading.value] as const,
  ([sid, loading], prev) => {
    if (!sid) {
      contextUsageStore.clear()
      return
    }
    if (loading) return
    if (!prev || prev[0] !== sid || prev[1] === true) {
      void contextUsageStore.refresh(sid, prev?.[1] === true)
    }
  },
)

// AI 回复完成后，自动发送 pending 队列中的消息
watch(() => paneIsLoading.value, async (loading, prevLoading) => {
  if (prevLoading && !loading) {
    const sid = paneSessionId.value
    if (!sid) return

    // 将暂存的 prompt（Ctrl+S）转为 pending message，由下方逻辑自动发送
    if (sessionStore.hasStash(sid)) {
      const stash = sessionStore.getStash(sid)
      if (stash && (stash.text.trim() || stash.attachments.length > 0 || stash.images.length > 0)) {
        turnStore.addPendingMessage(sid, {
          id: crypto.randomUUID(),
          content: stash.text,
          attachments: stash.attachments.map(f => ({ ...f })),
          images: stash.images.map(img => ({ ...img })),
          displayLabel: stash.text.slice(0, 80),
          priority: 'later',
          createdAt: Date.now(),
        })
        sessionStore.clearStash(sid)
      }
    }

    // 逐条取出并发送，避免一次性清除队列导致异常时消息丢失
    while (true) {
      const pending = turnStore.getPendingMessages(sid)
      if (pending.length === 0) break
      const msg = turnStore.recallPendingMessage(sid, pending[0].id)
      if (!msg) break

      await handleSend(msg.content, {
        files: msg.attachments as Attachment[],
        images: msg.images as ImageAttachment[],
      })
    }
  }
})

// 监听 settings 变化同步模型
watch(() => settingsStore.config.model, (newModel) => {
  if (newModel && newModel !== currentModel.value) {
    currentModel.value = newModel
  }
})

// 处理模型变更 - 同步到 Agent 系统并重启 CLI 会话
async function handleModelChange(model: string) {
  currentModel.value = model
  
  // 同步到 settings store
  const config = settingsStore.config
  switch (settingsStore.authMethod) {
    case 'anthropic_compatible':
      settingsStore.anthropicConfig.sonnetModel = model
      break
    case 'openai_compatible':
      settingsStore.openaiConfig.sonnetModel = model
      break
    case 'gemini_api':
      settingsStore.geminiConfig.sonnetModel = model
      break
  }
  settingsStore.saveSettings()
  
  // 同步到 LLM 服务
  updateConfig({
    provider: config.provider as any,
    apiKey: config.apiKey || '',
    baseUrl: config.baseUrl,
    model: model
  })
  
  // 重启 CLI 会话以使新模型生效
  await sessionStore.switchModel(model)
  
  console.log('[ChatPanel] Model changed to:', model)
}

// 处理推理深度变更 - 同步到 settings store 和 ~/.claude/settings.json
async function handleEffortChange(effort: string) {
  const level = effort as 'low' | 'medium' | 'high' | 'max'
  settingsStore.effortLevel = level
  settingsStore.saveSettings()

  // 同步到 ~/.claude/settings.json 以便 CLI 读取
  try {
    await api.injectGuiModelsToSettings({
      primaryModel: settingsStore.getPrimaryModel() || '',
      haikuModel: settingsStore.getHaikuModel(),
      sonnetModel: settingsStore.getSonnetModel(),
      opusModel: settingsStore.getOpusModel(),
      effortLevel: level
    })
  } catch (error) {
    console.error('[ChatPanel] Failed to sync effort to Claude settings:', error)
  }

  console.log('[ChatPanel] Effort changed to:', level)
}

// 处理 Agent 变更 - 切换 Agent 需要重启 CLI 会话
async function handleAgentChange(agent: string) {
  await sessionStore.switchAgent(agent)
  console.log('[ChatPanel] Agent changed to:', agent || '(default)')
}

// 格式化模型名称显示
function formatModelName(model: string): string {
  if (!model) return ''
  // 如果名称太长，截断显示
  if (model.length > 25) {
    return model.slice(0, 22) + '...'
  }
  return model
}

interface SendOptions {
  displayLabel?: string
}

interface AllAttachments {
  files: Attachment[]
  images: ImageAttachment[]
}

async function handleSend(content: string, attachments: AllAttachments, options?: SendOptions) {
  console.log('[ChatPanel] handleSend called:', content.slice(0, 50))
  const hasContent = content.trim().length > 0 || attachments.files.length > 0 || attachments.images.length > 0
  if (!hasContent) return

  // Work 模式自动路由：空会话且未选助手时，根据输入匹配专业助手。
  // 单命中 → 直接创建助手会话；多命中/模糊 → 弹出选择；无匹配 → 透传到当前会话。
  if (
    appStore.mode === 'work' &&
    paneSession.value?.mode === 'work' &&
    !paneSession.value?.assistantId &&
    paneMessages.value.length === 0
  ) {
    const outcome = await routeWorkSend(content.trim())
    if (outcome.kind === 'cancel') return
    if (outcome.kind === 'routed' && outcome.assistant) {
      try {
        const session = await sessionStore.startWorkAssistantSession({
          name: outcome.assistant.name,
          skills: outcome.assistant.skills,
          permission: outcome.assistant.permission,
        })
        appStore.openSessionTab(session.id, session.title)
      } catch (err) {
        console.error('[ChatPanel] Failed to start routed assistant session:', err)
      }
    }
    // passthrough：不创建助手会话，直接发送到当前空 work 会话
  }

  // Work 助手会话：用户首次发送消息时展开 Artifacts 面板
  // （选择助手时不立即弹出，等用户真正开始使用助手再展开）
  if (
    appStore.mode === 'work' &&
    paneSession.value?.mode === 'work' &&
    paneSession.value?.assistantId &&
    !appStore.infoPanelTabs.some(t => t.id === 'artifacts-panel')
  ) {
    appStore.openArtifactsPanel()
  }

  const userTyped = content.trim()
  let messageContent = userTyped

  if (attachments.files.length > 0) {
    const attachmentInfo = attachments.files.map(att =>
      att.isFolder ? `[Folder: ${att.name}]` : `[File: ${att.name}]`
    ).join(', ')

    if (messageContent) {
      messageContent += `\n\nAttachments: ${attachmentInfo}`
    } else {
      messageContent = `Attachments: ${attachmentInfo}`
    }
  }

  if (attachments.images.length > 0) {
    const imageInfo = attachments.images.map(img => `[Image: ${img.name}]`).join(', ')
    if (messageContent) {
      messageContent += `\n\nImages: ${imageInfo}`
    } else {
      messageContent = `Images: ${imageInfo}`
    }
  }

  const displayLabel = options?.displayLabel && options.displayLabel !== messageContent
    ? options.displayLabel
    : userTyped
  const userContent = displayLabel !== messageContent ? displayLabel : undefined

  console.log('[ChatPanel] Calling turnStore.sendMessage...')
  try {
    await turnStore.sendMessage(messageContent, userContent, {
      files: attachments.files,
      images: attachments.images
    })
    console.log('[ChatPanel] turnStore.sendMessage done')
  } catch (error) {
    console.error('[ChatPanel] sendMessage failed:', error)
    // 错误已在 sendMessage 内部处理（loading 状态清除、processStatus 重置），
    // 此处仅防止 unhandled rejection 导致 UI 异常
  }
}

// 处理停止/中断
async function handleStop() {
  console.log('[ChatPanel] Stopping...')
  try {
    await turnStore.abort()
    console.log('[ChatPanel] Stop requested successfully')
  } catch (error) {
    console.error('[ChatPanel] Error stopping:', error)
  }
}

// 处理斜杠命令
async function handleSlashCommand(command: string, args: string, attachments: AllAttachments) {
  console.log('[ChatPanel] Slash command:', command, args, attachments)

  // 添加用户输入的命令到消息列表
  const commandText = `/${command}${args ? ' ' + args : ''}`
  await sessionStore.addMessage({
    role: 'user',
    content: commandText
  })

  // 执行命令
  const result = await executeSlashCommand(command, args)

  // 对于 rewind / context / diff 命令，不添加 assistant 回复（UI 直接打开面板）
  const cmd = command.toLowerCase()
  if (cmd === 'rewind' || cmd === 'checkpoint') {
    return
  }
  if (cmd === 'context') {
    showContextModal.value = true
    return
  }
  if (cmd === 'diff') {
    return
  }

  // 添加命令执行结果
  await sessionStore.addMessage({
    role: 'assistant',
    content: result
  })
}

// 导入新的命令系统
import { BUILT_IN_COMMANDS, COMMAND_PROMPTS, findCommand, type CommandKind } from '@/lib/constants/commands'

// 执行斜杠命令
async function executeSlashCommand(command: string, args: string): Promise<string> {
  const workingDir = paneWorkingDirectory.value
  const cmd = findCommand(command)

  // 使用新的命令系统处理
  switch (command.toLowerCase()) {
    case 'help':
      return generateHelpMessage()

    case 'clear':
    case 'reset':
    case 'new':
      // 先中断任何正在进行的请求，重置 loading 状态
      await turnStore.abort()
      // 清除当前会话的消息
      if (paneSession.value) {
        paneSession.value.messages = []
        paneSession.value.title = t('common.newChat')
      }
      return t('chatPanel.commandCleared')

    case 'cost':
      return generateCostMessage()

    case 'context':
      showContextModal.value = true
      return ''

    case 'terminal':
      // 打开终端标签
      appStore.openTerminalTab(args || undefined)
      return t('chatPanel.commandTerminalOpened')

    case 'diff':
      // 获取 git diff 并展示
      await fetchAndShowDiff()
      return ''

    case 'settings':
      // 打开设置面板
      window.dispatchEvent(new CustomEvent('open-settings'))
      return t('chatPanel.commandSettingsOpened')

    case 'skills':
      // 打开技能管理器
      window.dispatchEvent(new CustomEvent('open-skills-manager'))
      return t('chatPanel.commandSkillsOpened')

case 'mcp':
	      // 打开 MCP 管理器
	      window.dispatchEvent(new CustomEvent('open-mcp-manager'))
	      return t('chatPanel.commandMcpOpened')

	    case 'browser-use':
	      // 打开 Browser Use 设置
	      window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'browser-use' } }))
	      return t('chatPanel.commandBrowserUseOpened')

	    case 'rewind':
    case 'checkpoint':
      handleOpenRewind()
      return ''

    case 'theme': {
      const currentTheme = settingsStore.appearance.theme
      const isDark = currentTheme === 'dark' || currentTheme === 'anthropic-dark'
      settingsStore.updateAppearance({ theme: isDark ? 'light' : 'dark' })
      return isDark ? t('chatPanel.commandThemeLight') : t('chatPanel.commandThemeDark')
    }

    case 'vim':
      return t('chatPanel.commandVimWip')

    case 'keybindings':
      return generateKeybindingsMessage()

    default: {
      const cmdDef = findCommand(command)
      if (cmdDef && (cmdDef.kind === 'sdk_command' || cmdDef.kind === 'codepilot_command')) {
        const fullCommand = args ? `/${command} ${args}` : `/${command}`
        const userContent = fullCommand
        await turnStore.sendMessage(userContent, fullCommand, {
          files: [],
          images: []
        })
        return ''
      }
      return t('chatPanel.commandUnknown', { command })
    }
  }
}

// 生成帮助信息
function generateHelpMessage(): string {
  const immediate = BUILT_IN_COMMANDS.filter((c) => c.immediate || c.kind === 'immediate')
  const sdk = BUILT_IN_COMMANDS.filter((c) => c.kind === 'sdk_command')
  const codepilot = BUILT_IN_COMMANDS.filter((c) => c.kind === 'codepilot_command')

  return `## ${t('chatPanel.helpTitle')}

### ${t('chatPanel.helpInstant')}
${immediate.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### ${t('chatPanel.helpSdk')}
${sdk.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### ${t('chatPanel.helpCodepilot')}
${codepilot.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### ${t('chatPanel.helpCustomSkills')}
${t('chatPanel.helpCustomSkillsDesc')}

**${t('chatPanel.helpTips')}**:
- ${t('chatPanel.helpTipBrowse')}
- ${t('chatPanel.helpTipMention')}
- ${t('chatPanel.helpTipNewline')}
- ${t('chatPanel.helpTipProject')}`
}

// 获取并展示 Git Diff
async function fetchAndShowDiff() {
  const workingDir = paneWorkingDirectory.value
  if (!workingDir) {
    await sessionStore.addMessage({
      role: 'assistant',
      content: t('chatPanel.commandDiffNoProject')
    })
    return
  }

  diffPanelLoading.value = true
  diffPanelData.value = null
  showDiffPanel.value = true

  try {
    const result = await api.git.getFullDiff(workingDir)
    if (!result) {
      // Not a git repo or error
      diffPanelData.value = null
    } else {
      diffPanelData.value = result
    }
  } catch (e) {
    console.error('[DiffPanel] Failed to fetch diff:', e)
    diffPanelData.value = null
  } finally {
    diffPanelLoading.value = false
  }
}

// 生成 Token 用量信息
function generateCostMessage(): string {
  const messages = paneRawMessages.value
  let totalInput = 0
  let totalOutput = 0
  let turnCount = 0

  for (const msg of messages) {
    // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
    const content = msg.content || ''
    const estimatedTokens = Math.ceil(content.length / 4)

    if (msg.role === 'user') {
      totalInput += estimatedTokens
    } else if (msg.role === 'assistant') {
      totalOutput += estimatedTokens
      turnCount++
    }
  }

  const totalTokens = totalInput + totalOutput

  if (turnCount === 0) {
    return `## ${t('chatPanel.costTitle')}\n\n${t('chatPanel.costNoMessages')}`
  }

  return `## ${t('chatPanel.costTitleEstimated')}

| ${t('chatPanel.costMetric')} | ${t('chatPanel.costCount')} |
|--------|-------|
| ${t('chatPanel.costInputTokens')} | ${totalInput.toLocaleString()} |
| ${t('chatPanel.costOutputTokens')} | ${totalOutput.toLocaleString()} |
| **${t('chatPanel.costTotalTokens')}** | **${totalTokens.toLocaleString()}** |
| ${t('chatPanel.costTurns')} | ${turnCount} |

*${t('chatPanel.costNote')}*`
}

// 生成上下文信息
function generateContextMessage(): string {
  const session = paneSession.value
  if (!session) return t('chatPanel.commandNoSession')

  const messageCount = session.messages.length
  const userMessages = session.messages.filter((m) => m.role === 'user').length
  const assistantMessages = session.messages.filter((m) => m.role === 'assistant').length

  let context = `## ${t('chatPanel.contextTitle')}

| ${t('chatPanel.contextMetric')} | ${t('chatPanel.contextValue')} |
|--------|-------|
| ${t('chatPanel.contextTotalMessages')} | ${messageCount} |
| ${t('chatPanel.contextUserMessages')} | ${userMessages} |
| ${t('chatPanel.contextAssistantMessages')} | ${assistantMessages} |
`

  if (session.workingDirectory) {
    context += `| ${t('chatPanel.contextWorkingDirectory')} | \`${session.workingDirectory}\` |`
  }

  return context
}

function generateKeybindingsMessage(): string {
  return `## ${t('chatPanel.keybindingsTitle')}

| ${t('chatPanel.keybindingsShortcut')} | ${t('chatPanel.keybindingsAction')} |
|----------|--------|
| Enter | ${t('chatPanel.keybindingsSendMessage')} |
| Shift+Enter | ${t('chatPanel.keybindingsNewLine')} |
| / | ${t('chatPanel.keybindingsCommandPalette')} |
| @ | ${t('chatPanel.keybindingsMentionFile')} |
| Escape | ${t('chatPanel.keybindingsCloseMenu')} |
| ↑↓ | ${t('chatPanel.keybindingsNavigate')} |
| Tab | ${t('chatPanel.keybindingsAcceptSuggestion')} |
| Ctrl+Z | ${t('chatPanel.keybindingsUndo')} |`
}

// 处理打开技能管理器
function handleOpenSkills() {
  window.dispatchEvent(new CustomEvent('open-skills-manager'))
}

// 处理工具提交（AskUserQuestion / 任何 behavior:'ask' 工具）
//
// 卡片现在传的是「更新后的 updatedInput」（含 answers / plan / 等等），
// 直接对应 engine PermissionAllowResult.updatedInput 的语义。
// 我们走新的 control_response 通道：turnStore.allowPermission。
async function handleToolSubmit(messageId: string, toolId: string, updatedInput: Record<string, unknown>) {
  console.log('[ChatPanel] Tool submit:', { messageId, toolId, updatedInput })

  if (turnStore.hasPendingPermissionForToolUse(toolId)) {
    await turnStore.allowPermission(messageId, toolId, updatedInput)
    return
  }

  // Fallback：极少数遗留路径下没有 pending permission（例如 engine 端走
  // 工具自调用流程，permission 已被自动批准），把 answers 当作 tool_result 推回。
  const answers = (updatedInput?.answers as Record<string, string> | undefined) ?? {}
  await turnStore.submitToolAnswer(paneSessionId.value, messageId, toolId, answers)
}

// 处理工具跳过（AskUserQuestion / 任何 behavior:'ask' 工具）
async function handleToolSkip(messageId: string, toolId: string) {
  console.log('[ChatPanel] Tool skip:', { messageId, toolId })

  if (turnStore.hasPendingPermissionForToolUse(toolId)) {
    await turnStore.denyPermission(messageId, toolId, t('chatPanel.userSkippedQuestions'))
    return
  }
  // Fallback for legacy path
  await turnStore.skipToolAnswer(paneSessionId.value, messageId, toolId)
}

async function handleNewSession() {
  if (props.paneId) {
    // ── 分屏模式：在当前 pane 中创建新会话 ──
    const session = sessionStore.createSession(t('common.newChat'))
    appStore.openSessionTab(session.id, session.title)
    const tabId = `session-${session.id}`
    splitLayout.setPaneContent(props.paneId, { kind: 'session', tabId })
    splitLayout.setActivePane(props.paneId)
    return
  }
  // ── 非分屏模式：原有行为 ──
  if (sessionStore.currentSessionId && sessionStore.currentSession) {
    appStore.openSessionTab(sessionStore.currentSessionId, sessionStore.currentSession.title)
  }

  const session = sessionStore.createSession(t('common.newChat'))
  appStore.openSessionTab(session.id, session.title)
}

function handleSwitchSession(sessionId: string) {
  // 分屏模式下 SessionTabBar 已更新 pane content，
  // SplitContainer watcher 会同步 active pane → 全局 currentSessionId。
  // 非分屏模式需要显式 selectSession + 同步工作目录。
  if (props.paneId) {
    return
  }
  sessionStore.selectSession(sessionId)
  if (sessionStore.workingDirectory && sessionStore.workingDirectory !== appStore.projectRoot) {
    appStore.setProjectRoot(sessionStore.workingDirectory)
    settingsStore.projectRoot = sessionStore.workingDirectory
    settingsStore.saveSettings()
  }
}

function handleCloseTab(tabId: string) {
  const tab = appStore.centerTabs.find(t => t.id === tabId)
  if (tab?.sessionId) {
    sessionStore.deactivateSession(tab.sessionId)
  }
  appStore.closeSessionTab(tabId)
}

async function handleRestoreHistorySession(session: any) {
  try {
    const claudeCode = api.claudeCode
    if (!claudeCode || !session?.sessionId) return

    const existingSession = sessionStore.sessions.find(s => s.id === session.sessionId)

    if (existingSession) {
      console.log('[ChatPanel] Reusing existing session:', session.sessionId)
      sessionStore.selectSession(session.sessionId)
      appStore.openSessionTab(session.sessionId, existingSession.title)
      showHistoryModal.value = false
      await nextTick()
      const reusedProjectPath = existingSession.workingDirectory || session.projectPath
      try {
        await sessionStore.loadTurnCheckpoints(session.sessionId, reusedProjectPath)
      } catch (err) {
        console.warn('[ChatPanel] loadTurnCheckpoints failed:', err)
      }
      return
    }

    const fullSession = await claudeCode.getFullSession(session.projectPath, session.sessionId)
    if (!fullSession?.messages) return

    const restoredSession = sessionStore.createSession(
      session.metadata?.customTitle ||
      (session.firstUserMessage ? session.firstUserMessage.slice(0, 60) : t('chatPanel.historyRestoreTitle')),
      session.projectPath,
      session.sessionId
    )

    const restoredMessages = buildMessagesFromHistory(fullSession.messages as any[])

    for (const msg of restoredMessages) {
      // 子代理（sidechain）消息会被构建成 teammate-message，仅用于队友转录，
      // 不应进入主时间线（否则会被渲染成普通用户/助手消息）。其转录由下方
      // recordTeammateMessage 单独处理。
      if (msg.metadata?.kind === 'teammate-message') continue
      sessionStore.addMessage(msg, restoredSession.id)
    }

    for (const raw of fullSession.messages as any[]) {
      sessionStore.recordTeammateMessage(raw, restoredSession.id)
    }

    showHistoryModal.value = false

    // ── 关键修复：为新恢复的历史会话创建标签页 ──
    // 此前缺少 openSessionTab 调用，导致恢复的会话没有标签页，
    // 用户无法切换回之前打开的其他历史会话。
    appStore.openSessionTab(restoredSession.id, restoredSession.title)

    // 分屏模式下：把恢复的会话放入当前 pane
    if (props.paneId) {
      const tabId = `session-${restoredSession.id}`
      splitLayout.setPaneContent(props.paneId, { kind: 'session', tabId })
      splitLayout.setActivePane(props.paneId)
    }

    // 历史会话加载后显式触发轮次变更卡片加载，避免依赖 MessageList watcher
    // 的时序（destructured props / 异步消息追加可能导致 watcher 未在合适时机触发）。
    await nextTick()
    try {
      await sessionStore.loadTurnCheckpoints(restoredSession.id, session.projectPath)
    } catch (err) {
      console.warn('[ChatPanel] loadTurnCheckpoints failed:', err)
    }

    console.log(
      '[ChatPanel] History session restored with original ID:',
      restoredSession.id,
      '| Messages loaded:',
      restoredSession.messages.length
    )
  } catch (error) {
    console.error('[ChatPanel] Failed to restore history session:', error)
  }
}
</script>

<style lang="scss" scoped>
.chat-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: transparent;
  position: relative;
  height: 100%;
}

.terminal-wrapper {
flex: 1;
overflow: hidden;
display: flex;
flex-direction: column;
}

.chat-content-wrapper {
flex: 1;
display: flex;
flex-direction: column;
min-height: 0;
overflow: hidden;
}

// New: flex-row body for chat + side panel
.chat-body-row {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  overflow: visible;
  position: relative;
}

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  // 300 (panel width) + 12 (right margin) + 12 (gutter to chat) = 324.
  --env-shoulder: 0px;
  &.with-env-panel.chat-main-reserved {
    --env-shoulder: 324px;
  }

  > * {
    transition: margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .chat-panel-body > * {
    transition:
      margin-right 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      padding-right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  &.with-env-panel.chat-main-reserved > :not(.chat-panel-body) {
    margin-right: var(--env-shoulder);
  }

  &.with-env-panel.chat-main-reserved .chat-panel-body > :not(.message-list) {
    margin-right: var(--env-shoulder);
  }

  &.with-env-panel.chat-main-reserved .chat-panel-body > .message-list {
    padding-right: var(--env-shoulder);
  }

  // When the column is not wide enough we keep the env panel as an overlay:
  // reserving 324px in a narrow split pane would make the chat unusable.
}

.chat-panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.chat-header {
  height: 52px;
  flex-shrink: 0;
  padding: 0 24px;
  background: var(--surface-glass);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--surface-border);
  @include flex-between;
  position: relative;
  
  &::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: var(--surface-border);
  }
  
  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  
  h2 {
    font-family: var(--font-display);
    font-size: calc(var(--font-size-base) + 1px);
    font-weight: 600;
    color: var(--text-primary);
    @include truncate;
    max-width: 300px;
  }
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-badge,
.provider-badge,
.agent-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  letter-spacing: 0.5px;
  text-transform: uppercase;
}

.model-badge {
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--surface-border);
  max-width: 150px;

  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary);
    flex-shrink: 0;
  }
}

.agent-badge {
  background: color-mix(in srgb, var(--accent-secondary) 10%, transparent);
  color: var(--accent-primary, #6366f1);
  border: 1px solid color-mix(in srgb, var(--accent-secondary) 30%, transparent);

  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-primary, #6366f1);
    flex-shrink: 0;
  }
}

.provider-badge {
  background: var(--accent-primary);
  color: white;
  
  .badge-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: white;
    animation: pulse 2s ease-in-out infinite;
  }
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--error);
    box-shadow: 0 0 8px var(--error-glow);
    transition: all var(--transition-fast);
  }
  
  .status-text {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
  }
  
  &.configured {
    .status-dot {
      background: var(--success);
      box-shadow: 0 0 8px var(--success-glow);
    }
    
    .status-text {
      color: var(--success);
    }
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

/* History Button */
.history-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--accent-primary);
  }
}

/* History Modal */
.history-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 10vh;
}

.history-modal-content {
  width: 90%;
  max-width: 640px;
  max-height: 75vh;
  background: var(--bg-primary);
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-lg);
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.history-modal-header {
  padding: 16px 24px;
  border-bottom: 1px solid var(--surface-border);
  @include flex-between;

  h3 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
}

.history-close-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 20px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--error);
  }
}

.history-modal-body {
  padding: 12px;
  overflow-y: auto;
  flex: 1;
}

.history-search-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  transition: all 0.2s ease;
  margin-bottom: 8px;

  &::placeholder {
    color: var(--text-muted);
  }

  &:focus {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.15);
  }
}

/* Modal Transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: all 0.25s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;

  .history-modal-content {
    transform: translateY(-10px) scale(0.98);
  }
}

/* Diff Modal */
.diff-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.diff-modal {
  background: var(--bg-elevated);
  border-radius: 12px;
  width: 92vw;
  max-width: 1200px;
  height: 85vh;
  max-height: 800px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
}

.diff-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--surface-border);
  flex-shrink: 0;
  background: var(--surface-soft);

  h3 {
    margin: 0;
    font-size: calc(var(--font-size-base) + 1px);
    font-weight: 600;
    color: var(--text-primary);
  }
}

.diff-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: var(--surface-hover);
    color: var(--text-primary);
  }
}

.diff-modal-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
}

.diff-loading,
.diff-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  font-size: 13px;
}

/* Modal Transition */
.modal-enter-active,
.modal-leave-active {
  transition: all 0.25s ease;

  .diff-modal {
    transition: all 0.25s ease;
  }
}

.modal-enter-from,
.modal-leave-to {
  opacity: 0;

  .diff-modal {
    transform: translateY(-10px) scale(0.98);
  }
}

/* Session Context: Env panel floating card transition */
.sc-env-fade-enter-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.sc-env-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.sc-env-fade-enter-from,
.sc-env-fade-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.96);
}

/* Session Context: Panel slide transition (for right detail panel) */
.sc-panel-slide-enter-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.sc-panel-slide-leave-active {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
}
.sc-panel-slide-enter-from,
.sc-panel-slide-leave-to {
  width: 0;
  opacity: 0;
  transform: translateX(20px);
}

/* Session Context: Capsule */
.sc-capsule {
  position: absolute;
  right: 12px;
  top: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: var(--glass-bg);
  backdrop-filter: blur(16px) saturate(1.2);
  -webkit-backdrop-filter: blur(16px) saturate(1.2);
  border: 1px solid var(--glass-border);
  border-radius: 20px;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease, right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  z-index: 15;
  box-shadow:
    var(--glass-shadow-2),
    var(--glass-inset);

  &:hover {
    background: var(--glass-hover);
    color: var(--text-primary);
    border-color: var(--glass-border);
    box-shadow:
      var(--glass-shadow-1),
      var(--glass-inset);
  }

  // Mirror the env panel: when the right detail panel is open, slide left
  // so the capsule doesn't sit on top of it.
  &.sc-capsule-shifted {
    right: 432px;
  }
}

.sc-capsule-text {
  font-family: var(--font-mono);
  font-weight: 500;
}

.sc-capsule-fade-enter-active {
  transition: all 0.3s ease 0.2s;
}
.sc-capsule-fade-leave-active {
  transition: all 0.15s ease;
}
.sc-capsule-fade-enter-from,
.sc-capsule-fade-leave-to {
  opacity: 0;
  transform: scale(0.9);
}
</style>
