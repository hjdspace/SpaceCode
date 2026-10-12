/**
 * useDraftPersistence — per-session draft save/restore orchestration.
 *
 * Extracted from ChatInput.vue to isolate the draft lifecycle from
 * editor event handling. The composable accepts the editor + attachment
 * refs it needs to read/write, keeping the seam narrow: callers provide
 * the state, this module provides the policy.
 */
import { ref, nextTick, type Ref } from 'vue'
import { useChatSessionStore } from '@/stores/chatSession'
import { useTurnStore } from '@/stores/turn'
import { resolveDraftSave, resolveDraftLoad, isMirrorValid } from '@/composables/usePromptStash'
import type { ImageAttachment, Attachment, TextQuoteAttachment } from '@/composables/types'

interface DraftData {
  text: string
  attachments: Attachment[]
  images: ImageAttachment[]
  quotes?: TextQuoteAttachment[]
  editorHtml: string
}

interface UseDraftPersistenceOptions {
  editorRef: Ref<HTMLElement | null>
  getEditorPlainText: () => string
  setEditorContent: (text: string) => void
  clearEditor: () => void
  autoResize: () => void
  focusEditor: () => void
  inputText: Ref<string>
  attachedFiles: Ref<Attachment[]>
  attachedImages: Ref<ImageAttachment[]>
  attachedQuotes: Ref<TextQuoteAttachment[]>
  draftScope: () => 'session' | 'none'
}

export function useDraftPersistence(options: UseDraftPersistenceOptions) {
  const sessionStore = useChatSessionStore()
  const editorSessionId = ref<string | null>(null)

  function buildDraftFromEditor(): DraftData {
    return {
      text: options.getEditorPlainText().trim(),
      attachments: options.attachedFiles.value.map(f => ({ ...f })),
      images: options.attachedImages.value.map(img => ({ ...img })),
      quotes: options.attachedQuotes.value.map(q => ({ ...q })),
      editorHtml: options.editorRef.value?.innerHTML || '',
    }
  }

  function saveDraftForSession(sid: string | null) {
    if (options.draftScope() === 'none') return
    const draft = buildDraftFromEditor()
    const hasDraft = draft.text.length > 0 || draft.attachments.length > 0 || draft.images.length > 0 || (draft.quotes?.length ?? 0) > 0
    const existingMirror = sessionStore.getNewChatDraft()
    const messageCount = sid ? (sessionStore.getSession(sid)?.messages.length ?? null) : null

    const decision = resolveDraftSave(hasDraft, sid, messageCount, existingMirror?.ownerSessionId)

    if (sid) {
      if (decision.saveDraft) {
        sessionStore.saveDraft(sid, draft)
      } else {
        sessionStore.clearDraft(sid)
      }
    }
    if (decision.clearMirror) {
      sessionStore.clearNewChatDraft()
    }
    if (decision.saveMirror) {
      sessionStore.setNewChatDraft(sid, draft)
    }
  }

  function loadDraftForSession(sid: string | null) {
    if (options.draftScope() === 'none') return
    const draft = sid ? sessionStore.getDraft(sid) : undefined
    const stash = sid ? sessionStore.getStash(sid) : undefined
    const mirror = sessionStore.getNewChatDraft()

    let mirrorUsable = false
    if (mirror) {
      const ownerCount = mirror.ownerSessionId
        ? (sessionStore.getSession(mirror.ownerSessionId)?.messages.length ?? null)
        : null
      const isFreshSession = !sid || (sessionStore.getSession(sid)?.messages.length ?? 0) === 0
      mirrorUsable = isMirrorValid(mirror.ownerSessionId, ownerCount) && isFreshSession
    }

    const action = resolveDraftLoad(!!draft, !!stash, mirrorUsable)

    if (action === 'draft' && draft) {
      restoreStashData(draft)
      return
    }
    if (action === 'stash' && stash) {
      restoreStashData(stash)
      return
    }
    if (action === 'mirror' && mirror) {
      restoreStashData(mirror.data)
      return
    }

    options.clearEditor()
    options.attachedFiles.value = []
    options.attachedImages.value = []
    options.attachedQuotes.value = []
    options.inputText.value = ''
  }

  function restoreStashData(stash: DraftData) {
    if (options.editorRef.value && stash.editorHtml) {
      options.editorRef.value.innerHTML = stash.editorHtml
    }
    options.attachedFiles.value = stash.attachments.map(f => ({ ...f }))
    options.attachedImages.value = stash.images.map(img => ({ ...img }))
    options.attachedQuotes.value = (stash.quotes ?? []).map(q => ({ ...q }))
    options.inputText.value = stash.text
    nextTick(() => {
      options.autoResize()
      options.focusEditor()
    })
  }

  return {
    editorSessionId,
    buildDraftFromEditor,
    saveDraftForSession,
    loadDraftForSession,
    restoreStashData,
  }
}
