<template>
  <div class="design-chat-pane">
    <!-- TODO: design session tab bar -->
    <div class="chat-body" ref="bodyRef">
      <div v-if="!activeSessionId" class="empty-state">
        <Palette :size="32" />
        <h2>{{ t('design.emptyChatTitle') }}</h2>
        <p>{{ t('design.emptyChatHint') }}</p>
      </div>
      <div v-else class="messages-container">
        <MessageItem
          v-for="msg in activeMessages"
          :key="msg.id"
          :message="msg"
          mode="design"
          @open-artifact="openArtifact"
          @submit-form="submitForm"
          @select-next="selectNext"
        />
      </div>
    </div>
    <!-- TODO: RetryIndicator 待接入重试状态（design 模式当前走 designSession 流式监听，不依赖 chat 重试） -->
    <DesignComposer @send="onSend" @stop="onStop" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Palette } from 'lucide-vue-next'
import { useDesignStore } from '@/stores/design'
import { useChatStore, useChatSessionStore } from '@/stores/chat'
import { useDesignSession } from '@/composables/useDesignSession'
import MessageItem from '@/components/chat/MessageItem.vue'
import DesignComposer from './DesignComposer.vue'
import type { Message } from '@/types'

const { t } = useI18n()
const designStore = useDesignStore()
const chatStore = useChatStore()
const chatSessionStore = useChatSessionStore()
const { activeSessionId } = storeToRefs(designStore)
const { createDesignSession, submitQuestionForm, stopDesignGeneration } = useDesignSession()

const bodyRef = ref<HTMLElement | null>(null)

const activeMessages = computed<Message[]>(() => {
  if (!activeSessionId.value) return []
  return chatSessionStore.getSessionMessages(activeSessionId.value) || []
})

// 新消息时滚动到底部
watch(activeMessages, () => {
  nextTick(() => {
    if (bodyRef.value) bodyRef.value.scrollTop = bodyRef.value.scrollHeight
  })
}, { deep: true })

async function onSend(content: string) {
  if (!activeSessionId.value) {
    await createDesignSession()
  }
  chatSessionStore.currentSessionId = activeSessionId.value!
  await chatStore.sendMessage(content)
}
function onStop() { stopDesignGeneration() }
function openArtifact(path: string) {
  designStore.addTab({ name: path.split('/').pop() || path, path, updatedAt: Date.now() })
}
function submitForm(answers: any) { submitQuestionForm(answers) }
function selectNext(prompt: string) { onSend(prompt) }
</script>

<style scoped lang="scss">
.design-chat-pane { display: flex; flex-direction: column; height: 100%; background: var(--bg-primary); }
.chat-body { flex: 1; overflow-y: auto; padding: 12px; }
.messages-container { display: flex; flex-direction: column; gap: 12px; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); text-align: center; padding: 32px; h2 { font-size: 16px; margin: 12px 0 4px; color: var(--text-primary); } p { font-size: 13px; } }
</style>
