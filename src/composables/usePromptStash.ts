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

// ── Per-session draft save/load decisions ──────────────────────
//
// Drafts (auto-saved unsent input) live in their own storage, separate from
// the Ctrl+S stash: the stash is auto-SENT when a turn completes, a draft
// must never be. Drafts are keyed by the session the editor content belongs
// to, not the global current session (which may already point at the next
// session by the time the draft is saved). Fresh conversations additionally
// get a "new chat" mirror so a draft survives being moved to a brand-new
// conversation — every "new chat" click creates a new session id, so a
// per-session key alone would never be found again.

export interface DraftSaveDecision {
  saveDraft: boolean
  saveMirror: boolean
  clearMirror: boolean
}

/**
 * Decide where the current editor draft goes when leaving session `sid`.
 * An empty editor always clears the session draft (it was sent or deleted).
 * @param hasContent editor has text or attachments
 * @param sid session the editor content belongs to (null = no session yet)
 * @param sessionMessageCount message count of `sid`'s session (null = unknown)
 * @param existingMirrorOwner owner of the current new-chat mirror
 *   (undefined = no mirror exists)
 */
export function resolveDraftSave(
  hasContent: boolean,
  sid: string | null,
  sessionMessageCount: number | null,
  existingMirrorOwner: string | null | undefined
): DraftSaveDecision {
  if (!hasContent) {
    // Empty editor: the draft was sent or deleted — drop the mirror if it
    // belongs to the session being left.
    return {
      saveDraft: false,
      saveMirror: false,
      clearMirror: existingMirrorOwner !== undefined && (existingMirrorOwner ?? null) === (sid ?? null),
    }
  }
  if (!sid) {
    return { saveDraft: false, saveMirror: true, clearMirror: false }
  }
  return {
    saveDraft: true,
    saveMirror: sessionMessageCount === 0,
    clearMirror: false,
  }
}

export type DraftLoadAction = 'draft' | 'stash' | 'mirror' | 'clear'

/**
 * Decide what to put in the editor when entering a session.
 * Priority: session draft > Ctrl+S stash (legacy restore) > new-chat mirror > clear.
 * @param mirrorUsable mirror exists AND is valid AND target session is fresh
 */
export function resolveDraftLoad(
  hasDraft: boolean,
  hasStash: boolean,
  mirrorUsable: boolean
): DraftLoadAction {
  if (hasDraft) return 'draft'
  if (hasStash) return 'stash'
  if (mirrorUsable) return 'mirror'
  return 'clear'
}

/**
 * A mirror is valid while its owner session is still a fresh (message-less)
 * conversation — once messages exist the draft was sent and must not
 * reappear in future new chats. Owner null = typed before any session existed.
 */
export function isMirrorValid(
  ownerSessionId: string | null,
  ownerSessionMessageCount: number | null
): boolean {
  if (!ownerSessionId) return true
  return ownerSessionMessageCount === 0
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
