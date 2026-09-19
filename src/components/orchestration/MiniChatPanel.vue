<template>
  <div class="mini-chat-panel">
    <!-- 消息列表 -->
    <div class="mini-chat-messages">
      <MessageList
        :messages="messages"
        :loading="isLoading"
        @tool-submit="handleToolSubmit"
        @tool-skip="handleToolSkip"
        @rewind="handleRewind"
      />
    </div>

    <!-- 聊天输入框（完整功能：@ 上下文、/ 斜杠命令等） -->
    <div v-if="showInput" class="mini-chat-input">
      <ChatInput
        @send="handleSend"
        @slash-command="handleSlashCommand"
        @update:model="handleModelChange"
        @update:effort="handleEffortChange"
        @update:agent="handleAgentChange"
        @open-skills="handleOpenSkills"
        @stop="handleStop"
        :disabled="isInputDisabled"
        :is-sending="isLoading"
        :model-value="currentModel"
        :working-directory="workingDirectory"
        :placeholder="inputPlaceholder"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import { useSettingsStore } from '@/stores/settings'
import { initLLMService } from '@/services/llm'
import MessageList from '../chat/MessageList.vue'
import ChatInput, { type Attachment, type ImageAttachment } from '../chat/ChatInput.vue'
import type { Message } from '@/types'
import { BUILT_IN_COMMANDS, findCommand } from '@/lib/constants/commands'

interface AllAttachments {
  files: Attachment[]
  images: ImageAttachment[]
}

interface SendOptions {
  displayLabel?: string
}

const props = defineProps<{
  sessionId: string
  /** 是否显示输入框 */
  showInput?: boolean
  /** 输入框 placeholder */
  inputPlaceholder?: string
  /** 草稿模式 — 输入不发送，仅保存为草稿（pending 状态下为 true） */
  draftMode?: boolean
}>()

const emit = defineEmits<{
  /** 草稿模式下，用户"发送"时触发 — 将内容保存为节点草稿 */
  draftSave: [content: string]
}>()

const sessionStore = useChatSessionStore()
const turnStore = useTurnStore()
const settingsStore = useSettingsStore()

// ── 会话数据 ──
const session = computed(() => sessionStore.getSession(props.sessionId))
const messages = computed<Message[]>(() => {
  if (!session.value) return []
  return sessionStore.getDisplayMessages(props.sessionId)
})
const isLoading = computed(() => turnStore.getIsLoading(props.sessionId))
const workingDirectory = computed(() => {
  return sessionStore.getWorkingDirectory(props.sessionId) || ''
})

/** 输入框是否禁用 — 草稿模式下不禁用 */
const isInputDisabled = computed(() => {
  if (props.draftMode) return false
  return isLoading.value
})

// ── 模型 ──
const currentModel = ref('')

async function initModel() {
  await initLLMService()
  currentModel.value = settingsStore.config.model || ''
}
initModel()

watch(() => settingsStore.config.model, (newModel) => {
  if (newModel && newModel !== currentModel.value) {
    currentModel.value = newModel
  }
})

// ── ChatInput 事件处理 ──

function handleModelChange(model: string) {
  currentModel.value = model
}

async function handleEffortChange(effort: string) {
  const level = effort as 'low' | 'medium' | 'high' | 'max'
  settingsStore.effortLevel = level
  settingsStore.saveSettings()
}

async function handleAgentChange(agent: string) {
  await sessionStore.switchAgent(agent)
}

function handleOpenSkills() {
  window.dispatchEvent(new CustomEvent('open-skills-manager'))
}

async function handleSend(content: string, attachments: AllAttachments, options?: SendOptions) {
  const hasContent = content.trim().length > 0 || attachments.files.length > 0 || attachments.images.length > 0
  if (!hasContent) return

  // 草稿模式 — 不发送，将内容保存为草稿并显示在消息列表中
  if (props.draftMode) {
    let messageContent = content.trim()
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
    // 将草稿作为 user 消息添加到会话中（不发送给引擎）
    await sessionStore.addMessage({
      role: 'user',
      content: messageContent,
    }, props.sessionId)
    emit('draftSave', messageContent)
    return
  }

  // 正常模式 — 发送消息
  let messageContent = content.trim()

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
    : content.trim()
  const userContent = displayLabel !== messageContent ? displayLabel : undefined

  try {
    await turnStore.sendMessage(messageContent, userContent, {
      files: attachments.files,
      images: attachments.images,
    }, { sessionId: props.sessionId })
  } catch (error) {
    console.error('[MiniChatPanel] sendMessage failed:', error)
  }
}

async function handleSlashCommand(command: string, args: string, _attachments: AllAttachments, displayLabel?: string) {
  // 草稿模式下斜杠命令也仅保存为草稿
  if (props.draftMode) {
    const commandText = displayLabel || `/${command}${args ? ' ' + args : ''}`
    await sessionStore.addMessage({
      role: 'user',
      content: commandText,
    }, props.sessionId)
    emit('draftSave', commandText)
    return
  }

  const commandText = displayLabel || `/${command}${args ? ' ' + args : ''}`
  await sessionStore.addMessage({
    role: 'user',
    content: commandText,
  }, props.sessionId)

  const result = await executeSlashCommand(command, args)

  const cmd = command.toLowerCase()
  if (cmd === 'rewind' || cmd === 'checkpoint' || cmd === 'context' || cmd === 'diff') {
    return
  }

  if (result) {
    await sessionStore.addMessage({
      role: 'assistant',
      content: result,
    }, props.sessionId)
  }
}

async function executeSlashCommand(command: string, args: string): Promise<string> {
  switch (command.toLowerCase()) {
    case 'help':
      return generateHelpMessage()
    case 'clear':
    case 'reset':
    case 'new':
      await turnStore.abort()
      if (session.value) {
        session.value.messages = []
      }
      return 'Conversation cleared.'
    case 'settings':
      window.dispatchEvent(new CustomEvent('open-settings'))
      return 'Settings opened.'
    case 'skills':
      window.dispatchEvent(new CustomEvent('open-skills-manager'))
      return 'Skills manager opened.'
    default: {
      const cmdDef = findCommand(command)
      if (cmdDef && (cmdDef.kind === 'sdk_command' || cmdDef.kind === 'codepilot_command')) {
        const fullCommand = args ? `/${command} ${args}` : `/${command}`
        await turnStore.sendMessage(fullCommand, fullCommand, {
          files: [],
          images: [],
        }, { sessionId: props.sessionId })
        return ''
      }
      return `Unknown command: /${command}`
    }
  }
}

function generateHelpMessage(): string {
  const immediate = BUILT_IN_COMMANDS.filter((c) => c.immediate || c.kind === 'immediate')
  const sdk = BUILT_IN_COMMANDS.filter((c) => c.kind === 'sdk_command')
  return `## Commands\n\n### Instant\n${immediate.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}\n\n### SDK\n${sdk.map((c) => `- **/${c.name}** — ${c.description}`).join('\n')}`
}

async function handleStop() {
  try {
    await turnStore.abort()
  } catch (error) {
    console.error('[MiniChatPanel] Stop failed:', error)
  }
}

// ── 工具事件转发 ──
async function handleToolSubmit(messageId: string, toolId: string, updatedInput: Record<string, unknown>) {
  if (turnStore.hasPendingPermissionForToolUse(toolId)) {
    await turnStore.allowPermission(messageId, toolId, updatedInput)
    return
  }
  const answers = (updatedInput?.answers as Record<string, string> | undefined) ?? {}
  await turnStore.submitToolAnswer(props.sessionId, messageId, toolId, answers)
}

async function handleToolSkip(messageId: string, toolId: string) {
  if (turnStore.hasPendingPermissionForToolUse(toolId)) {
    await turnStore.denyPermission(messageId, toolId, 'User skipped')
    return
  }
  await turnStore.skipToolAnswer(props.sessionId, messageId, toolId)
}

function handleRewind(_message: Message) {
  // 编排节点中不支持 rewind
}
</script>

<style lang="scss" scoped>
.mini-chat-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.mini-chat-messages {
  // 必须是 flex 容器：MessageList 内部靠 flex:1 + min-height:0 建立滚动高度链，
  // 父级若是普通块盒，滚动容器会退化成"内容有多高就多高"而被外层裁掉 —— 表现为无法滚动。
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.mini-chat-input {
  flex-shrink: 0;
  border-top: 1px solid var(--surface-border, rgba(255, 255, 255, 0.06));

  :deep(.chat-input-container) {
    padding: 6px 8px 8px;
  }

  :deep(.input-wrapper) {
    padding: 8px;
    border-radius: 12px;
  }

  :deep(.inline-editor) {
    font-size: 12px;
    max-height: 80px;
  }

  :deep(.input-toolbar) {
    gap: 4px;
  }

  :deep(.toolbar-btn) {
    padding: 3px 6px;
    font-size: 11px;
  }

  :deep(.add-btn) {
    width: 24px;
    height: 24px;
  }

  :deep(.model-btn .model-name) {
    max-width: 60px;
    font-size: 11px;
  }

  :deep(.model-btn .model-mode-pill) {
    display: none;
  }

  :deep(.send-btn) {
    width: 26px;
    height: 26px;
  }

  :deep(.optimize-btn) {
    width: 26px;
    height: 26px;
  }

  :deep(.context-toolbar-row) {
    display: none;
  }

  :deep(.pending-messages-bar) {
    padding: 0 8px 4px;
  }

  :deep(.pending-message-item) {
    padding: 3px 8px;
    font-size: 11px;
  }
}
</style>
