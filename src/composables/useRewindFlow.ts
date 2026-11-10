/**
 * Rewind Flow Hook
 *
 * 从 ChatPanel 抽出的 rewind（回退）流程：消息选择器、回退确认、代码回退确认与编辑重发。
 */

import { computed, ref, type Ref } from 'vue'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import type { Attachment, ImageAttachment } from '@/composables/types'
import type { Message, Session } from '@/types'

export interface UseRewindFlowOptions {
  paneSessionId: Ref<string>
  paneSession: Ref<Session | null | undefined>
  paneWorkingDirectory: Ref<string>
  paneIsLoading: Ref<boolean>
  handleSend: (content: string, attachments: { files: Attachment[]; images: ImageAttachment[] }) => Promise<void>
}

export function useRewindFlow(options: UseRewindFlowOptions) {
  const sessionStore = useChatSessionStore()
  const turnStore = useTurnStore()
  const { paneSessionId, paneSession, paneWorkingDirectory, paneIsLoading, handleSend } = options

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

  async function handleEditResend(messageId: string, newContent: string) {
    const sid = paneSessionId.value
    if (!sid) return

    // 中断当前正在进行的请求（如果有）
    if (paneIsLoading.value) {
      await turnStore.abort()
    }

    // 裁剪会话消息到目标用户消息之前（仅裁剪对话，不回退代码）
    // 直接操作 session.messages 避免 rewindSession 的 pendingInputText 副作用
    const session = sessionStore.getSession(sid)
    if (session) {
      const targetIndex = session.messages.findIndex(m => m.id === messageId)
      if (targetIndex >= 0) {
        session.messages = session.messages.slice(0, targetIndex)
        sessionStore.saveToStorage()
      }
    }

    // 用修改后的文本重新发送
    await handleSend(newContent, { files: [], images: [] })
  }

  return {
    showMessageSelector,
    rewindSelectedMessageContent,
    userMessages,
    handleRewindConfirm,
    handleCodeRewindConfirm,
    handleCodeRewindCancel,
    handleRewindCancel,
    handleMessageSelect,
    handleOpenRewind,
    handleMessageRewind,
    handleEditResend,
  }
}
