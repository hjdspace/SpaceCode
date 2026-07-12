/**
 * usePromptStash - Prompt stash/restore logic extracted from ChatInput.vue
 *
 * Manages:
 * - Stash decision (has content → stash, empty → restore)
 * - Stash data creation
 * - Stash hint display
 */
import { ref } from 'vue'
import { useChatSessionStore } from '@/stores/chatSession'
import type { Attachment, ImageAttachment } from '@/composables/types'

// ── Pure logic (exported for testing) ──────────────────────────

export interface StashData {
  text: string
  attachments: Attachment[]
  images: ImageAttachment[]
  editorHtml: string
}

/** Determine stash action based on current state */
export function resolveStashAction(
  content: string,
  hasAttachments: boolean,
  hasImages: boolean,
  hasExistingStash: boolean
): 'stash' | 'restore' | 'none' {
  const hasContent = content.trim().length > 0 || hasAttachments || hasImages
  if (!hasContent && hasExistingStash) return 'restore'
  if (hasContent) return 'stash'
  return 'none'
}

/** Create stash data from current editor state */
export function createStashData(
  text: string,
  attachments: Attachment[],
  images: ImageAttachment[],
  editorHtml: string
): StashData {
  return {
    text,
    attachments: attachments.map(f => ({ ...f })),
    images: images.map(img => ({ ...img })),
    editorHtml,
  }
}

// ── Composable ─────────────────────────────────────────────────

export function usePromptStash() {
  const sessionStore = useChatSessionStore()
  const showStashHint = ref(false)

  function handleStash(
    content: string,
    attachedFiles: Attachment[],
    attachedImages: ImageAttachment[],
    editorHtml: string,
    onClear: () => void,
    onRestore: () => void
  ) {
    const sid = sessionStore.currentSessionId
    if (!sid) return

    const action = resolveStashAction(
      content,
      attachedFiles.length > 0,
      attachedImages.length > 0,
      sessionStore.hasStash(sid)
    )

    if (action === 'restore') {
      onRestore()
      return
    }

    if (action === 'stash') {
      const stash = createStashData(content, attachedFiles, attachedImages, editorHtml)
      sessionStore.stashPrompt(sid, stash)
      onClear()
      showStashHint.value = true
      setTimeout(() => { showStashHint.value = false }, 2500)
    }
  }

  function restoreStash(
    editorRef: HTMLElement | null,
    onRestoreFiles: (files: Attachment[]) => void,
    onRestoreImages: (images: ImageAttachment[]) => void,
    onRestoreText: (text: string) => void,
    onFocus: () => void
  ) {
    const sid = sessionStore.currentSessionId
    if (!sid) return

    const stash = sessionStore.getStash(sid)
    if (!stash) return

    if (editorRef && stash.editorHtml) {
      editorRef.innerHTML = stash.editorHtml
    }

    onRestoreFiles(stash.attachments.map(f => ({ ...f })))
    onRestoreImages(stash.images.map(img => ({ ...img })))
    onRestoreText(stash.text)

    sessionStore.clearStash(sid)
    showStashHint.value = false
    onFocus()
  }

  return {
    showStashHint,
    handleStash,
    restoreStash,
  }
}
