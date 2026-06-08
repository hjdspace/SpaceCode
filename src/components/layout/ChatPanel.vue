<template>
  <main class="chat-panel">
    <SessionTabBar
      @new-session="handleNewSession"
      @switch-session="handleSwitchSession"
      @close-tab="handleCloseTab"
    />
    
    <!-- Terminal Panel -->
    <div v-if="isTerminalTab" class="terminal-wrapper">
      <TerminalPanel />
    </div>
    
    <!-- Chat Content -->
    <template v-else>
      <div class="chat-header">
        <div class="header-left">
          <h2>{{ currentSession?.title || t('common.newConversation') }}</h2>
        </div>
        <div class="header-actions">
          <button
            class="history-btn"
            @click="showHistoryModal = true"
            title="历史会话"
          >
            <History :size="16" />
          </button>
          <span class="agent-badge" v-if="chatStore.currentAgent" :title="chatStore.currentAgent">
            <span class="badge-dot agent-dot"></span>
            {{ chatStore.currentAgent }}
          </span>
          <span class="model-badge" v-if="currentModel" :title="currentModel">
            <span class="badge-dot"></span>
            {{ formatModelName(currentModel) }}
          </span>
          <ContextUsageChip
            v-if="!showNoProjectWelcome"
            @open="showContextModal = true"
          />
          <span class="provider-badge" v-if="provider">
            <span class="badge-dot"></span>
            {{ provider.toUpperCase() }}
          </span>
          <span class="status-indicator" :class="{ configured: isConfigured }">
            <span class="status-dot"></span>
            <span class="status-text">{{ isConfigured ? t('chat.ready') : t('chat.notConfigured') }}</span>
          </span>
        </div>
      </div>
      
      <div class="chat-panel-body">
        <NoProjectHome v-if="showNoProjectWelcome" />

        <template v-else>
          <TeammateTranscriptHeader
            v-if="chatStore.isViewingTeammate"
            :teammate="chatStore.viewedTeammate"
            @back="chatStore.backToLeaderView"
          />

          <MessageList
            :messages="chatStore.displayMessages"
            :loading="chatStore.isLoading"
            @tool-submit="handleToolSubmit"
            @tool-skip="handleToolSkip"
            @rewind="handleMessageRewind"
          />
        </template>
      </div>

      <TeamStatusBar
        v-if="!showNoProjectWelcome"
        :team-context="chatStore.currentTeamContext"
        :viewing-agent-task-id="chatStore.currentViewedAgentTaskId"
        @view-teammate="chatStore.viewTeammateTranscript"
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
        :disabled="chatStore.isLoading"
        :is-sending="chatStore.isLoading"
        :model-value="currentModel"
        :working-directory="chatStore.workingDirectory"
        :placeholder="t('chat.askAnything')"
        :show-open-project-action="showNoProjectWelcome"
      />
      <ToastNotification />

      <!-- Rewind Dialog -->
      <RewindDialog
        :show="chatStore.rewindState.showDialog"
        :selected-message-id="chatStore.rewindState.selectedMessageId"
        :message-content="rewindSelectedMessageContent"
        :selected-option="chatStore.rewindState.selectedOption"
        :summarize-feedback="chatStore.rewindState.summarizeFeedback"
        :is-rewinding="chatStore.rewindState.isRewinding"
        :error="chatStore.rewindState.error"
        :diff-stats="null"
        @update:show="chatStore.setShowRewindDialog"
        @update:selected-option="chatStore.setRewindSelectedOption"
        @update:summarize-feedback="chatStore.setRewindSummarizeFeedback"
        @confirm="handleRewindConfirm"
        @cancel="handleRewindCancel"
      />

      <!-- Code Rewind Confirmation Dialog -->
      <CodeRewindConfirmDialog
        :show="chatStore.rewindState.showCodeConfirm"
        :files="[...chatStore.rewindState.filesToRewind]"
        :is-loading="chatStore.rewindState.isRewinding"
        @confirm="handleCodeRewindConfirm"
        @cancel="handleCodeRewindCancel"
      />

      <!-- Message Selector for /rewind command -->
      <MessageSelector
        :show="showMessageSelector"
        :messages="userMessages"
        :selected-message-id="chatStore.rewindState.selectedMessageId"
        @update:show="showMessageSelector = $event"
        @select="handleMessageSelect"
        @cancel="showMessageSelector = false"
      />
    </template>
    
    <!-- History Session Modal -->
    <Transition name="modal-fade">
      <div 
        v-if="showHistoryModal" 
        class="history-modal-overlay" 
        @click.self="showHistoryModal = false"
      >
        <div class="history-modal-content">
          <div class="history-modal-header">
            <h3>📜 恢复历史会话</h3>
            <button class="history-close-btn" @click="showHistoryModal = false">×</button>
          </div>
          
          <div class="history-modal-body">
            <!-- Search Input -->
            <input
              type="text"
              v-model="historySearchQuery"
              placeholder="🔍 搜索会话标题、路径..."
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

    <ContextUsageModal v-model:show="showContextModal" />

    <!-- Diff 面板 -->
    <Transition name="modal">
      <div v-if="showDiffPanel" class="diff-overlay" @click.self="showDiffPanel = false">
        <div class="diff-modal">
          <div class="diff-modal-header">
            <h3>Git Diff</h3>
            <button class="diff-close-btn" @click="showDiffPanel = false">×</button>
          </div>
          <div class="diff-modal-body">
            <div v-if="diffPanelLoading" class="diff-loading">
              <p>Loading diff...</p>
            </div>
            <div v-else-if="!diffPanelData" class="diff-empty">
              <p>Working tree is clean or not a git repository.</p>
            </div>
            <DiffExplorer v-else :diffData="diffPanelData" />
          </div>
        </div>
      </div>
    </Transition>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import MessageList from '../chat/MessageList.vue'
import TeamStatusBar from '../chat/TeamStatusBar.vue'
import TeammateTranscriptHeader from '../chat/TeammateTranscriptHeader.vue'
import ChatInput, { type Attachment, type ImageAttachment } from '../chat/ChatInput.vue'

interface AllAttachments {
  files: Attachment[]
  images: ImageAttachment[]
}
import SessionTabBar from '../chat/SessionTabBar.vue'
import TerminalPanel from '../terminal/TerminalPanel.vue'
import NoProjectHome from './NoProjectHome.vue'
import ToastNotification from '../common/ToastNotification.vue'
import RewindDialog from '../chat/RewindDialog.vue'
import CodeRewindConfirmDialog from '../chat/CodeRewindConfirmDialog.vue'
import MessageSelector from '../chat/MessageSelector.vue'
import { History } from 'lucide-vue-next'
import HistorySessionList from '../explorer/HistorySessionList.vue'
import ContextUsageChip from '../chat/ContextUsageChip.vue'
import ContextUsageWarningBar from '../chat/ContextUsageWarningBar.vue'
import ContextUsageModal from '../chat/ContextUsageModal.vue'
import DiffExplorer from '../chat/DiffExplorer.vue'
import { useContextUsageStore } from '@/stores/contextUsage'
import { buildMessagesFromHistory } from '@/utils/sessionRestore'
import { initLLMService, llmState, updateConfig } from '@/services/llm'
import { pathsEqual } from '@/utils/recentProjectRoots'
import { useChatCommands } from '@/composables/useChatCommands'
import { api } from '@/services/electronAPI'
import type { Message } from '@/types'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const appStore = useAppStore()
const { t } = useI18n()

const showHistoryModal = ref(false)
const historySearchQuery = ref('')
const showContextModal = ref(false)
const showDiffPanel = ref(false)
const diffPanelData = ref<any>(null)
const diffPanelLoading = ref(false)
const contextUsageStore = useContextUsageStore()

// 监听 TitleBar 的 diff 触发
const stopDiffWatch = watch(() => chatStore.diffPanelTrigger, () => {
  fetchAndShowDiff()
})

onBeforeUnmount(() => {
  stopDiffWatch()
})

// Rewind state
const showMessageSelector = ref(false)

const rewindSelectedMessageContent = computed(() => {
  const messageId = chatStore.rewindState.selectedMessageId
  if (!messageId) return ''
  const message = chatStore.currentSession?.messages.find(m => m.id === messageId)
  return message?.content || ''
})

const userMessages = computed(() =>
  chatStore.currentSession?.messages
    .filter(m => m.role === 'user')
    .map(m => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content || '',
      timestamp: m.timestamp || Date.now()
    })) || []
)

async function handleRewindConfirm() {
  const option = chatStore.rewindState.selectedOption
  const messageId = chatStore.rewindState.selectedMessageId

  if (!messageId) return

  if (option === 'summarize') {
    chatStore.summarizeTurn(
      chatStore.currentSessionId || '',
      messageId,
      chatStore.rewindState.summarizeFeedback
    )
    chatStore.setShowRewindDialog(false)
    chatStore.resetRewindState()
  } else if (option === 'cancel') {
    chatStore.setShowRewindDialog(false)
    chatStore.resetRewindState()
  } else if (option === 'both' || option === 'code') {
    // Show code rewind confirmation dialog for code-related modes
    await openCodeRewindConfirm()
  } else {
    // conversation mode - no code changes, proceed directly
    executeRewind()
  }
}

async function openCodeRewindConfirm() {
  if (!chatStore.rewindState.selectedMessageId || !chatStore.currentSessionId) return

  if (chatStore.turnChangeCards.length === 0) {
    await chatStore.loadTurnCheckpoints(
      chatStore.currentSessionId,
      chatStore.workingDirectory || undefined
    )
  }

  const files = await chatStore.loadFilesToRewind(
    chatStore.currentSessionId,
    chatStore.rewindState.selectedMessageId
  )

  if (files.length > 0) {
    chatStore.setFilesToRewind(files)
    chatStore.setShowCodeConfirm(true)
  } else {
    // No files to rollback, proceed directly
    executeRewind()
  }
}

function handleCodeRewindConfirm() {
  chatStore.setShowCodeConfirm(false)
  executeRewind()
}

function handleCodeRewindCancel() {
  chatStore.setShowCodeConfirm(false)
  // Return to main rewind dialog, don't close it
}

async function executeRewind() {
  const option = chatStore.rewindState.selectedOption
  const messageId = chatStore.rewindState.selectedMessageId

  if (!messageId) return

  try {
    await chatStore.rewindSession(
      chatStore.currentSessionId || '',
      messageId,
      option as 'both' | 'conversation' | 'code'
    )
    chatStore.setShowRewindDialog(false)
    chatStore.resetRewindState()
  } catch (err: any) {
    console.error('[ChatPanel] Rewind failed:', err)
  }
}

function handleRewindCancel() {
  chatStore.resetRewindState()
}

function handleMessageSelect(messageId: string) {
  showMessageSelector.value = false
  chatStore.setRewindSelectedMessage(messageId)
  chatStore.setShowRewindDialog(true)
}

function handleOpenRewind() {
  showMessageSelector.value = true
}

function handleMessageRewind(message: Message) {
  chatStore.setRewindSelectedMessage(message.id)
  chatStore.setShowRewindDialog(true)
}

const chatCommands = useChatCommands({
  sessionId: chatStore.currentSessionId || '',
  messages: chatStore.currentMessages,
  onOpenSkills: () => {
    handleOpenSkills()
  },
  onOpenRewind: () => {
    handleOpenRewind()
  },
})

const currentSession = computed(() => chatStore.currentSession)
const provider = computed(() => llmState.provider.value)
const isConfigured = computed(() => llmState.isConfigured.value)

// Check if current tab is a terminal tab
const isTerminalTab = computed(() =>
  appStore.activeCenterTab.startsWith('terminal-')
)

/** At least one conversation is bound to a real folder (sidebar / CLI cwd), not only default chat */
const hasWorkspaceContext = computed(() =>
  chatStore.sessions.some((s) => !!(s.workingDirectory && String(s.workingDirectory).trim()))
)

/** No folder context in chat/projects list, or app has not bound a project root yet */
const showNoProjectWelcome = computed(() => {
  if (isTerminalTab.value) return false
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
    if (!has) {
      // 只移除当前项目相关的会话
      const sessionsToRemove = chatStore.sessions.filter(s =>
        pathsEqual(s.workingDirectory || '', root)
      )
      sessionsToRemove.forEach(s => chatStore.deleteSession(s.id))

      if (pathsEqual(appStore.projectRoot, root)) {
        appStore.closeProject()
        chatStore.switchProject('')
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
  if (chatStore.currentSessionId) {
    void contextUsageStore.refresh(chatStore.currentSessionId)
  }
})

watch(
  () => [chatStore.currentSessionId, chatStore.isLoading] as const,
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
  await chatStore.switchModel(model)
  
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
  await chatStore.switchAgent(agent)
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

  console.log('[ChatPanel] Calling chatStore.sendMessage...')
  await chatStore.sendMessage(messageContent, userContent, {
    files: attachments.files,
    images: attachments.images
  })
  console.log('[ChatPanel] chatStore.sendMessage done')
}

// 处理停止/中断
async function handleStop() {
  console.log('[ChatPanel] Stopping...')
  try {
    await chatStore.abort()
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
  await chatStore.addMessage({
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
  await chatStore.addMessage({
    role: 'assistant',
    content: result
  })
}

// 导入新的命令系统
import { BUILT_IN_COMMANDS, COMMAND_PROMPTS, findCommand, type CommandKind } from '@/lib/constants/commands'

// 执行斜杠命令
async function executeSlashCommand(command: string, args: string): Promise<string> {
  const workingDir = chatStore.workingDirectory
  const cmd = findCommand(command)

  // 使用新的命令系统处理
  switch (command.toLowerCase()) {
    case 'help':
      return generateHelpMessage()

    case 'clear':
    case 'reset':
    case 'new':
      // 先中断任何正在进行的请求，重置 loading 状态
      await chatStore.abort()
      // 清除当前会话的消息
      if (chatStore.currentSession) {
        chatStore.currentSession.messages = []
        chatStore.currentSession.title = t('common.newChat')
      }
      return '对话已清除。'

    case 'cost':
      return generateCostMessage()

    case 'context':
      showContextModal.value = true
      return ''

    case 'terminal':
      // 打开终端标签
      appStore.openTerminalTab(args || undefined)
      return '已打开终端。'

    case 'diff':
      // 获取 git diff 并展示
      await fetchAndShowDiff()
      return ''

    case 'settings':
      // 打开设置面板
      window.dispatchEvent(new CustomEvent('open-settings'))
      return '已打开设置面板。'

    case 'skills':
      // 打开技能管理器
      window.dispatchEvent(new CustomEvent('open-skills-manager'))
      return '已打开技能管理器。'

    case 'mcp':
      // 打开 MCP 管理器
      window.dispatchEvent(new CustomEvent('open-mcp-manager'))
      return '已打开 MCP 服务器管理器。'

    case 'rewind':
    case 'checkpoint':
      handleOpenRewind()
      return ''

    case 'theme': {
      const currentTheme = settingsStore.appearance.theme
      const isDark = currentTheme === 'dark' || currentTheme === 'anthropic-dark'
      settingsStore.updateAppearance({ theme: isDark ? 'light' : 'dark' })
      return isDark ? '已切换到浅色主题。' : '已切换到深色主题。'
    }

    case 'vim':
      return 'Vim 模式切换功能开发中。'

    case 'keybindings':
      return generateKeybindingsMessage()

    default: {
      const cmdDef = findCommand(command)
      if (cmdDef && (cmdDef.kind === 'sdk_command' || cmdDef.kind === 'codepilot_command')) {
        const fullCommand = args ? `/${command} ${args}` : `/${command}`
        const userContent = fullCommand
        await chatStore.sendMessage(userContent, fullCommand, {
          files: [],
          images: []
        })
        return ''
      }
      return `未知命令: /${command}\n输入 /help 查看可用命令。`
    }
  }
}

// 生成帮助信息
function generateHelpMessage(): string {
  const immediate = BUILT_IN_COMMANDS.filter((c) => c.immediate || c.kind === 'immediate')
  const sdk = BUILT_IN_COMMANDS.filter((c) => c.kind === 'sdk_command')
  const codepilot = BUILT_IN_COMMANDS.filter((c) => c.kind === 'codepilot_command')

  return `## Available Commands

### Instant Commands
${immediate.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### SDK Commands (sent to Claude Code)
${sdk.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### CodePilot Commands (expanded before sending)
${codepilot.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}

### Custom Skills
Skills from \`~/.claude/commands/\` and project \`.claude/commands/\` are also available via \`/\`.

**Tips:**
- Type \`/\` to browse commands and skills
- Type \`@\` to mention files
- Use Shift+Enter for new line
- Select a project folder to enable file operations`
}

// 获取并展示 Git Diff
async function fetchAndShowDiff() {
  const workingDir = chatStore.workingDirectory
  if (!workingDir) {
    await chatStore.addMessage({
      role: 'assistant',
      content: '未打开项目文件夹，无法执行 diff 命令。'
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
  const messages = chatStore.currentMessages
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
    return `## Token Usage\n\nNo messages yet. Send a message to see token usage estimates.`
  }

  return `## Token Usage (Estimated)

| Metric | Count |
|--------|-------|
| Input tokens | ${totalInput.toLocaleString()} |
| Output tokens | ${totalOutput.toLocaleString()} |
| **Total tokens** | **${totalTokens.toLocaleString()}** |
| Turns | ${turnCount} |

*Note: These are rough estimates based on character count. Actual token counts may vary.*`
}

// 生成上下文信息
function generateContextMessage(): string {
  const session = chatStore.currentSession
  if (!session) return '当前没有活动会话。'

  const messageCount = session.messages.length
  const userMessages = session.messages.filter((m) => m.role === 'user').length
  const assistantMessages = session.messages.filter((m) => m.role === 'assistant').length

  let context = `## Current Context

| Metric | Value |
|--------|-------|
| Total messages | ${messageCount} |
| User messages | ${userMessages} |
| Assistant messages | ${assistantMessages} |
`

  if (session.workingDirectory) {
    context += `| Working directory | \`${session.workingDirectory}\` |`
  }

  return context
}

function generateKeybindingsMessage(): string {
  return `## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Enter | Send message |
| Shift+Enter | New line |
| / | Open command palette |
| @ | Mention file |
| Escape | Close menu / Remove badge |
| ↑↓ | Navigate menu |
| Tab | Accept suggestion |
| Ctrl+Z | Undo |`
}

// 处理打开技能管理器
function handleOpenSkills() {
  window.dispatchEvent(new CustomEvent('open-skills-manager'))
}

// 处理工具提交（AskUserQuestion / 任何 behavior:'ask' 工具）
//
// 卡片现在传的是「更新后的 updatedInput」（含 answers / plan / 等等），
// 直接对应 engine PermissionAllowResult.updatedInput 的语义。
// 我们走新的 control_response 通道：chatStore.allowPermission。
async function handleToolSubmit(messageId: string, toolId: string, updatedInput: Record<string, unknown>) {
  console.log('[ChatPanel] Tool submit:', { messageId, toolId, updatedInput })

  if (chatStore.hasPendingPermissionForToolUse(toolId)) {
    await chatStore.allowPermission(messageId, toolId, updatedInput)
    return
  }

  // Fallback：极少数遗留路径下没有 pending permission（例如 engine 端走
  // 工具自调用流程，permission 已被自动批准），把 answers 当作 tool_result 推回。
  const answers = (updatedInput?.answers as Record<string, string> | undefined) ?? {}
  await chatStore.submitToolAnswer(messageId, toolId, answers)
}

// 处理工具跳过（AskUserQuestion / 任何 behavior:'ask' 工具）
async function handleToolSkip(messageId: string, toolId: string) {
  console.log('[ChatPanel] Tool skip:', { messageId, toolId })

  if (chatStore.hasPendingPermissionForToolUse(toolId)) {
    await chatStore.denyPermission(messageId, toolId, 'User skipped the questions')
    return
  }
  // Fallback for legacy path
  await chatStore.skipToolAnswer(messageId, toolId)
}

async function handleNewSession() {
  if (chatStore.currentSessionId && chatStore.currentSession) {
    appStore.openSessionTab(chatStore.currentSessionId, chatStore.currentSession.title)
  }

  const session = chatStore.createSession(t('common.newChat'))
  appStore.openSessionTab(session.id, session.title)
}

function handleSwitchSession(sessionId: string) {
  chatStore.selectSession(sessionId)
  if (chatStore.workingDirectory && chatStore.workingDirectory !== appStore.projectRoot) {
    appStore.setProjectRoot(chatStore.workingDirectory)
    settingsStore.projectRoot = chatStore.workingDirectory
    settingsStore.saveSettings()
  }
}

function handleCloseTab(tabId: string) {
  const tab = appStore.centerTabs.find(t => t.id === tabId)
  if (tab?.sessionId) {
    chatStore.deactivateSession(tab.sessionId)
  }
  appStore.closeSessionTab(tabId)
}

async function handleRestoreHistorySession(session: any) {
  try {
    const claudeCode = api.claudeCode
    if (!claudeCode || !session?.sessionId) return

    const existingSession = chatStore.sessions.find(s => s.id === session.sessionId)

    if (existingSession) {
      console.log('[ChatPanel] Reusing existing session:', session.sessionId)
      chatStore.selectSession(session.sessionId)
      appStore.openSessionTab(session.sessionId, existingSession.title)
      showHistoryModal.value = false
      await nextTick()
      const reusedProjectPath = existingSession.workingDirectory || session.projectPath
      try {
        await chatStore.loadTurnCheckpoints(session.sessionId, reusedProjectPath)
      } catch (err) {
        console.warn('[ChatPanel] loadTurnCheckpoints failed:', err)
      }
      return
    }

    const fullSession = await claudeCode.getFullSession(session.projectPath, session.sessionId)
    if (!fullSession?.messages) return

    const restoredSession = chatStore.createSession(
      session.metadata?.customTitle ||
      (session.firstUserMessage ? session.firstUserMessage.slice(0, 60) : '历史会话恢复'),
      session.projectPath,
      session.sessionId
    )

    const restoredMessages = buildMessagesFromHistory(fullSession.messages)

    for (const msg of restoredMessages) {
      chatStore.addMessage(msg, restoredSession.id)
    }

    for (const raw of fullSession.messages) {
      chatStore.recordTeammateMessage(raw, restoredSession.id)
    }

    showHistoryModal.value = false

    // 历史会话加载后显式触发轮次变更卡片加载，避免依赖 MessageList watcher
    // 的时序（destructured props / 异步消息追加可能导致 watcher 未在合适时机触发）。
    await nextTick()
    try {
      await chatStore.loadTurnCheckpoints(restoredSession.id, session.projectPath)
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

.chat-panel-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
    font-size: 15px;
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
  background: rgba(99, 102, 241, 0.1);
  color: var(--accent-primary, #6366f1);
  border: 1px solid rgba(99, 102, 241, 0.3);

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
  background: #ffffff;
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

/* 暗色主题适配 */
:global(.dark) .diff-modal {
  background: #1a1a2e;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.diff-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  background: #f8fafc;

  :global(.dark) & {
    border-bottom-color: #2d3748;
    background: #16162a;
  }

  h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #1a202c;

    :global(.dark) & {
      color: #e2e8f0;
    }
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
  color: #64748b;
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: #e2e8f0;
    color: #1a202c;
  }

  :global(.dark) & {
    color: #94a3b8;

    &:hover {
      background: #2d3748;
      color: #e2e8f0;
    }
  }
}

.diff-modal-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #ffffff;

  :global(.dark) & {
    background: #1a1a2e;
  }
}

.diff-loading,
.diff-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #64748b;
  font-size: 13px;

  :global(.dark) & {
    color: #94a3b8;
  }
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
</style>
