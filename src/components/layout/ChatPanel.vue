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
          <span class="agent-badge" v-if="chatStore.currentAgent" :title="chatStore.currentAgent">
            <span class="badge-dot agent-dot"></span>
            {{ chatStore.currentAgent }}
          </span>
          <span class="model-badge" v-if="currentModel" :title="currentModel">
            <span class="badge-dot"></span>
            {{ formatModelName(currentModel) }}
          </span>
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

        <MessageList
          v-else
          :messages="chatStore.currentMessages"
          :loading="chatStore.isLoading"
          @tool-submit="handleToolSubmit"
          @tool-skip="handleToolSkip"
        />
      </div>

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
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import MessageList from '../chat/MessageList.vue'
import ChatInput, { type Attachment, type ImageAttachment } from '../chat/ChatInput.vue'
import SessionTabBar from '../chat/SessionTabBar.vue'
import TerminalPanel from '../terminal/TerminalPanel.vue'
import NoProjectHome from './NoProjectHome.vue'
import ToastNotification from '../common/ToastNotification.vue'
import { initLLMService, llmState, updateConfig } from '@/services/llm'
import { pathsEqual } from '@/utils/recentProjectRoots'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const appStore = useAppStore()
const { t } = useI18n()

const electronAPI = (window as any).electronAPI

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
    await electronAPI?.injectGuiModelsToSettings?.({
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
  badge?: {
    command: string
    label: string
    description: string
    kind: string
  }
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
async function handleSlashCommand(command: string, args: string, attachments: Attachment[]) {
  console.log('[ChatPanel] Slash command:', command, args)

  // 添加用户输入的命令到消息列表
  const commandText = `/${command}${args ? ' ' + args : ''}`
  await chatStore.addMessage({
    role: 'user',
    content: commandText
  })

  // 执行命令
  const result = await executeSlashCommand(command, args)

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
      return generateContextMessage()

    case 'terminal':
      // 打开终端标签
      appStore.openTerminalTab(args || undefined)
      return '已打开终端。'

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

    default:
      return `未知命令: /${command}\n输入 /help 查看可用命令。`
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

// 处理打开技能管理器
function handleOpenSkills() {
  window.dispatchEvent(new CustomEvent('open-skills-manager'))
}

// 处理工具提交（AskUserQuestion）
async function handleToolSubmit(messageId: string, toolId: string, answers: Record<string, string>) {
  console.log('[ChatPanel] Tool submit:', { messageId, toolId, answers })
  
  // 将答案发送到后端
  await chatStore.submitToolAnswer(messageId, toolId, answers)
}

// 处理工具跳过（AskUserQuestion）
async function handleToolSkip(messageId: string, toolId: string) {
  console.log('[ChatPanel] Tool skip:', { messageId, toolId })
  
  // 通知后端用户跳过
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
</style>
