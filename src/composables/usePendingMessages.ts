// src/composables/usePendingMessages.ts
// 排队消息的召回/删除/立即发送。全部按 editorSessionId（本输入框绑定的会话）寻址，
// 而非全局 currentSessionId：分屏与侧边任务会同时存在多个 ChatInput 实例，
// 用全局 id 会串到别的会话。

import { computed, nextTick, type Ref } from 'vue'
import { useTurnStore } from '@/stores/turn'
import type { PendingMessage } from '@/stores/turn/types'
import type { AllAttachments, Attachment, ImageAttachment } from './types'

interface UsePendingMessagesOptions {
  sessionId: Ref<string | null>
  inputText: Ref<string>
  editorRef: Ref<HTMLElement | null>
  attachedFiles: Ref<Attachment[]>
  attachedImages: Ref<ImageAttachment[]>
  collectAllAttachments: (files: Attachment[], images: ImageAttachment[]) => AllAttachments
  focusEditor: () => void
  onSend: (content: string, attachments: AllAttachments) => void
}

export function usePendingMessages(options: UsePendingMessagesOptions) {
  const turnStore = useTurnStore()
  const {
    sessionId,
    inputText,
    editorRef,
    attachedFiles,
    attachedImages,
    collectAllAttachments,
    focusEditor,
    onSend,
  } = options

  const currentPendingMessages = computed(() => {
    const sid = sessionId.value
    if (!sid) return []
    return turnStore.getPendingMessages(sid)
  })

  /** 排队消息摊回编辑器：召回按钮与空输入框按 ↑ 共用这一份恢复逻辑 */
  function applyPendingSnapshot(msg: PendingMessage) {
    inputText.value = msg.content
    if (editorRef.value) {
      editorRef.value.innerText = msg.content
    }
    attachedFiles.value = msg.attachments.map(f => ({ ...f }))
    attachedImages.value = msg.images.map(img => ({ ...img }))
    nextTick(() => focusEditor())
  }

  function recallPendingMsg(msgId: string) {
    const sid = sessionId.value
    if (!sid) return
    const recalled = turnStore.recallPendingMessage(sid, msgId)
    if (recalled) applyPendingSnapshot(recalled)
  }

  function removePendingMsg(msgId: string) {
    const sid = sessionId.value
    if (sid) turnStore.removePendingMessage(sid, msgId)
  }

  function sendPendingNow(msgId: string) {
    const sid = sessionId.value
    if (!sid) return
    const recalled = turnStore.recallPendingMessage(sid, msgId)
    if (!recalled) return
    const allAttachments = collectAllAttachments(
      recalled.attachments.map(f => ({ ...f })),
      recalled.images.map(img => ({ ...img })),
    )
    onSend(recalled.content, allAttachments)
  }

  return {
    currentPendingMessages,
    applyPendingSnapshot,
    recallPendingMsg,
    removePendingMsg,
    sendPendingNow,
  }
}
