<template>
  <div class="design-chat-pane">
    <!-- 消息列表：复用 MessageList，design 模式下助手消息走 buildBlocks 渲染 -->
    <div class="chat-body" ref="bodyRef">
      <div v-if="!activeSessionId" class="empty-state">
        <Palette :size="32" />
        <h2>{{ t('design.emptyChatTitle') }}</h2>
        <p>{{ t('design.emptyChatHint') }}</p>
      </div>
      <MessageList
        v-else
        :messages="activeMessages"
        :loading="isLoading"
        mode="design"
        @open-artifact="openArtifact"
        @submit-form="submitForm"
        @select-next="selectNext"
        @tool-submit="handleToolSubmit"
        @tool-skip="handleToolSkip"
      />
    </div>

    <!-- 输入区：复用 ChatInput，通过 slot 注入设计专用工具栏 -->
    <ChatInput
      @send="onSend"
      @stop="onStop"
      :is-sending="isLoading"
      :disabled="isLoading"
      :placeholder="t('design.emptyChatHint')"
    >
      <!-- toolbar 左侧扩展：模板选择器 -->
      <template #toolbar-extra>
        <TemplatePicker v-model="designStore.selectedTemplateId" />
      </template>
      <!-- 与项目/分支选择器同行：设计系统选择器 -->
      <template #context-extra>
        <DesignSystemPicker
          v-model="designStore.selectedDesignSystemId"
          :systems="designSystems"
          @update:model-value="onDesignSystemChange"
        />
      </template>
    </ChatInput>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Palette } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useTurnStore } from '@/stores/turn'
import { useChatSessionStore } from '@/stores/chatSession'
import { useDesignSession } from '@/composables/useDesignSession'
import { useMcpStore } from '@/stores/mcp'
import { api } from '@/services/electronAPI'
import MessageList from '@/components/chat/MessageList.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import type { AllAttachments } from '@/composables/types'
import type { DesignSystemSummary } from '@/services/electronAPI'
import TemplatePicker from './TemplatePicker.vue'
import DesignSystemPicker from './DesignSystemPicker.vue'

const { t } = useI18n()
const designStore = useDesignStore()
const turnStore = useTurnStore()
const chatSessionStore = useChatSessionStore()
const mcpStore = useMcpStore()
const { activeSessionId } = storeToRefs(designStore)
const { createDesignSession, submitQuestionForm, stopDesignGeneration, switchDesignSystem, buildDesignMessage } = useDesignSession()

const bodyRef = ref<HTMLElement | null>(null)
const designSystems = ref<DesignSystemSummary[]>([])

// ── loading 状态：直接复用 chatStream 的 loadingSessions ──
const isLoading = computed(() =>
  activeSessionId.value ? turnStore.getIsLoading(activeSessionId.value) : false
)

// ── 会话切换同步 ──────────────────────────────────────────────
watch(
  () => chatSessionStore.currentSessionId,
  (newSid) => {
    if (!newSid) {
      designStore.activeSessionId = null
      return
    }
    const session = chatSessionStore.sessions.find(s => s.id === newSid)
    if (session?.mode === 'design') {
      designStore.activeSessionId = newSid
      if (session.workingDirectory) {
        designStore.designWorkspace = session.workingDirectory
      }
    }
  },
  { immediate: true },
)

const activeMessages = computed(() => {
  if (!activeSessionId.value) return []
  return chatSessionStore.getSessionMessages(activeSessionId.value) || []
})

onMounted(async () => {
  designSystems.value = await api.design.listSystems()
  mcpStore.fetchServers()
})

// ── 发送消息：buildDesignMessage 添加 preamble 后走 turnStore.sendMessage ──
async function onSend(content: string, attachments: AllAttachments) {
  if (!activeSessionId.value) {
    await createDesignSession()
  }
  chatSessionStore.currentSessionId = activeSessionId.value!

  // 构建设计模式消息（添加模板/设计系统 preamble）
  const designContent = buildDesignMessage(content)

  // 处理附件信息（与 ChatPanel.handleSend 逻辑一致）
  let messageContent = designContent
  if (attachments.files.length > 0) {
    const attachmentInfo = attachments.files.map(att =>
      att.isFolder ? `[Folder: ${att.name}]` : `[File: ${att.name}]`
    ).join(', ')
    messageContent += `\n\nAttachments: ${attachmentInfo}`
  }
  if (attachments.images.length > 0) {
    const imageInfo = attachments.images.map(img => `[Image: ${img.name}]`).join(', ')
    messageContent += `\n\nImages: ${imageInfo}`
  }

  await turnStore.sendMessage(messageContent, content, {
    files: attachments.files,
    images: attachments.images,
  })
}

function onStop() {
  stopDesignGeneration()
}

function openArtifact(path: string) {
  designStore.addTab({ name: path.split('/').pop() || path, path, updatedAt: Date.now() })
}

function submitForm(answers: Record<string, unknown>) {
  submitQuestionForm(answers)
}

function selectNext(prompt: string) {
  onSend(prompt, { files: [], images: [] })
}

function handleToolSubmit(messageId: string, toolId: string, updatedInput: Record<string, unknown>) {
  const sid = activeSessionId.value
  if (!sid) return
  turnStore.submitToolAnswer(sid, messageId, toolId, updatedInput as Record<string, string>)
}

function handleToolSkip(messageId: string, toolId: string) {
  const sid = activeSessionId.value
  if (!sid) return
  turnStore.skipToolAnswer(sid, messageId, toolId)
}

function onDesignSystemChange(systemId: string | null) {
  const system = designSystems.value.find(s => s.id === systemId) || null
  switchDesignSystem(systemId, system?.name || null)
}
</script>

<style scoped lang="scss">
.design-chat-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.chat-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-muted);
  text-align: center;
  padding: 32px;

  h2 {
    font-size: 16px;
    margin: 12px 0 4px;
    color: var(--text-primary);
  }

  p {
    font-size: 13px;
  }
}
</style>
