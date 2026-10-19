/**
 * useQuoteAttachments — 引用文本附件（选中文本浮条"添加到对话"）的列表状态。
 *
 * 悬停浮窗的可见性与定位不在这里：那是 QuoteAttachmentsBar.vue 的视图职责，
 * 宿主要读的只有列表本身（发送时序列化成 blockquote 前缀、草稿与 stash 也读写它）。
 */
import { ref } from 'vue'
import type { TextQuoteAttachment } from '@/composables/types'

export function useQuoteAttachments() {
  const attachedQuotes = ref<TextQuoteAttachment[]>([])

  function addQuoteAttachment(quote: { id: string; text: string }) {
    if (!attachedQuotes.value.some(q => q.id === quote.id)) {
      attachedQuotes.value.push({ ...quote })
    }
  }

  function removeQuoteAttachment(id: string) {
    const idx = attachedQuotes.value.findIndex(q => q.id === id)
    if (idx >= 0) attachedQuotes.value.splice(idx, 1)
  }

  function clearQuotes() {
    attachedQuotes.value = []
  }

  return {
    attachedQuotes,
    addQuoteAttachment,
    removeQuoteAttachment,
    clearQuotes,
  }
}
