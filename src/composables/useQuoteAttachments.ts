/**
 * useQuoteAttachments — manage text-quote attachments ("add to conversation"
 * from selected text) and their hover tooltip.
 *
 * Extracted from ChatInput.vue to isolate quote-chip state and tooltip
 * positioning from the main editor orchestration.
 */
import { ref, nextTick, type Ref } from 'vue'
import type { TextQuoteAttachment } from '@/composables/types'

export function useQuoteAttachments() {
  const attachedQuotes = ref<TextQuoteAttachment[]>([])
  const quoteTooltipRef = ref<HTMLElement | null>(null)
  const quoteTooltip = ref<{ visible: boolean; text: string; style: Record<string, string> }>({
    visible: false,
    text: '',
    style: {},
  })

  function addQuoteAttachment(quote: { id: string; text: string }) {
    if (!attachedQuotes.value.some(q => q.id === quote.id)) {
      attachedQuotes.value.push({ ...quote })
    }
  }

  function removeQuoteAttachment(id: string) {
    const idx = attachedQuotes.value.findIndex(q => q.id === id)
    if (idx >= 0) attachedQuotes.value.splice(idx, 1)
    hideQuoteTooltip()
  }

  function clearQuotes() {
    attachedQuotes.value = []
  }

  function showQuoteTooltip(quote: { id: string; text: string }, e: MouseEvent) {
    const chip = e.currentTarget as HTMLElement
    quoteTooltip.value = { visible: true, text: quote.text, style: { visibility: 'hidden' } }
    nextTick(() => positionQuoteTooltip(chip))
  }

  function hideQuoteTooltip() {
    quoteTooltip.value = { ...quoteTooltip.value, visible: false }
  }

  function positionQuoteTooltip(chip: HTMLElement) {
    const el = quoteTooltipRef.value
    if (!el) return
    const rect = chip.getBoundingClientRect()
    const gap = 6
    const margin = 8
    const width = el.offsetWidth
    const height = el.offsetHeight
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin)
    let top = rect.top - height - gap
    if (top < margin) top = rect.bottom + gap
    quoteTooltip.value = {
      visible: true,
      text: quoteTooltip.value.text,
      style: { position: 'fixed', top: `${top}px`, left: `${left}px`, visibility: 'visible' },
    }
  }

  return {
    attachedQuotes,
    quoteTooltipRef,
    quoteTooltip,
    addQuoteAttachment,
    removeQuoteAttachment,
    clearQuotes,
    showQuoteTooltip,
    hideQuoteTooltip,
  }
}
