<template>
  <div
    class="message-item"
    :class="[message.role, { notification: isTaskNotification }]"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <div class="message-avatar">
      <User v-if="message.role === 'user'" :size="16" />
      <Bot v-else :size="16" />
    </div>

    <div class="message-body">
      <div v-if="isTaskNotification" class="task-notification-card" :class="message.metadata?.status">
        <CheckCircle v-if="message.metadata?.status === 'completed'" :size="14" />
        <XCircle v-else :size="14" />
        <span>{{ message.content }}</span>
      </div>

      <template v-else>
        <div class="message-header">
          <span class="role-label">{{ message.role === 'user' ? t('chat.you') : message.role === 'system' ? 'System' : t('chat.claude') }}</span>
          <span class="timestamp">{{ formatTime(message.timestamp) }}</span>
        </div>
        
        <!-- 图片附件 -->
        <div v-if="message.imageAttachments?.length" class="image-attachments">
          <div 
            v-for="img in message.imageAttachments" 
            :key="img.id"
            class="image-attachment"
          >
            <img
              v-if="img.previewUrl"
              :src="img.previewUrl"
              :alt="img.name"
              loading="lazy"
              decoding="async"
              @click="showImagePreview(img)"
            />
            <div v-else class="image-placeholder" :title="img.name">{{ img.mimeType || 'image' }}</div>
            <span class="image-name">{{ img.name }}</span>
          </div>
        </div>
        
        <!-- 思考过程 -->
        <ReasoningCard v-if="message.reasoning" :reasoning="message.reasoning" />
        
        <!-- 工具调用 -->
        <ToolCallList
          v-if="message.toolCalls?.length"
          :tool-calls="message.toolCalls"
          @tool-submit="handleToolSubmit"
          @tool-skip="handleToolSkip"
        />
        
        <!-- 用户消息 + 助手消息：bubble 渲染 -->
        <div class="message-content" v-if="message.content && !isEditing">
          <MarkdownRenderer
            v-if="message.role === 'assistant'"
            :content="message.content"
          />
          <p v-else class="user-text" v-html="renderedUserContent" @copy="handleUserCopy"></p>
        </div>

        <!-- 用户消息编辑模式 -->
        <div v-if="isEditing" class="message-edit-area">
          <textarea
            ref="editTextareaRef"
            v-model="editContent"
            class="edit-textarea"
            rows="3"
            @keydown="handleEditKeydown"
          ></textarea>
          <div class="edit-actions">
            <button
              class="edit-cancel-btn"
              :title="t('common.cancel')"
              @click="handleEditCancel"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              class="edit-send-btn"
              :disabled="!editContent.trim()"
              :title="t('chat.resend')"
              @click="handleEditSend"
            >
              <SendHorizontal :size="14" />
              <span>{{ t('chat.resend') }}</span>
            </button>
          </div>
        </div>

        <!-- 用户消息操作栏：回滚 + 编辑 + 复制（始终占据空间，hover 时淡入显示） -->
        <div
          v-if="message.role === 'user' && message.content && !isEditing"
          class="message-action-bar"
          :class="{ 'is-visible': isHovered }"
        >
          <button
            v-if="canRewind !== false"
            class="action-button"
            :title="t('chat.rewind')"
            :aria-label="t('chat.rewind')"
            @click="handleRewindClick"
          >
            <RotateCcw :size="13" />
          </button>
          <button
            class="action-button"
            :title="t('chat.editMessage')"
            :aria-label="t('chat.editMessage')"
            @click="handleEditClick"
          >
            <Pencil :size="13" />
          </button>
          <button
            class="action-button"
            :title="copied ? t('chat.copied') : t('chat.copyMessage')"
            :aria-label="t('chat.copyMessage')"
            @click="handleCopyClick"
          >
            <Check v-if="copied" :size="13" />
            <Copy v-else :size="13" />
          </button>
        </div>
        
        <!-- 元数据 -->
        <MessageMetadata v-if="message.role === 'assistant' && message.metadata" :metadata="message.metadata" />

        <!-- 工作台快捷入口: 识别输出中的 localhost/URL/本地 HTML/Markdown -->
        <div v-if="workbenchTargets.length" class="workbench-hint-bar">
          <button
            v-for="target in workbenchTargets"
            :key="target.kind + '::' + target.value"
            class="workbench-hint-btn"
            :title="target.value"
            @click="openInWorkbench(target)"
          >
            <Globe v-if="target.kind === 'url'" :size="13" />
            <FileText v-else :size="13" />
            <span class="hint-label">{{ target.label }}</span>
            <span class="hint-action">{{ t('workbench.openInWorkbench') }}</span>
          </button>
        </div>
      </template>
    </div>

    <!-- 图片预览灯箱 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="previewImage" class="image-preview-overlay" @click="closeImagePreview">
          <button class="image-preview-close" :aria-label="t('common.close')" @click="closeImagePreview">
            <X :size="20" />
          </button>
          <img
            class="image-preview-full"
            :src="previewImage.previewUrl"
            :alt="previewImage.name"
            @click.stop
          />
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { Message, ImageAttachment } from '@/types'
import { User, Bot, RotateCcw, CheckCircle, XCircle, X, Globe, FileText, Copy, Check, Pencil, SendHorizontal } from 'lucide-vue-next'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import ReasoningCard from './ReasoningCard.vue'
import ToolCallList from './ToolCallList.vue'
import MessageMetadata from './MessageMetadata.vue'
import { renderContentWithAttachments } from '@/utils/mention-chips'
import { detectWorkbenchTargets, type WorkbenchTarget } from '@/utils/workbench-targets'
import { useAppStore } from '@/stores/app'

const { t } = useI18n()
const appStore = useAppStore()

const props = defineProps<{
  message: Message
  canRewind?: boolean
}>()

const emit = defineEmits<{
  toolSubmit: [messageId: string, toolId: string, updatedInput: Record<string, unknown>]
  toolSkip: [messageId: string, toolId: string]
  rewind: [message: Message]
  editResend: [message: Message, newContent: string]
}>()

const isHovered = ref(false)
const previewImage = ref<ImageAttachment | null>(null)
const copied = ref(false)
const isEditing = ref(false)
const editContent = ref('')
const editTextareaRef = ref<HTMLTextAreaElement | null>(null)

let copyTimer: ReturnType<typeof setTimeout> | undefined

const isTaskNotification = computed(() => props.message.metadata?.kind === 'task-notification')

const workbenchTargets = computed<WorkbenchTarget[]>(() => {
  if (props.message.role !== 'assistant') return []
  return detectWorkbenchTargets(props.message.content || '')
})

function openInWorkbench(target: WorkbenchTarget) {
  if (target.kind === 'url') {
    appStore.openWebview(target.value)
  } else {
    appStore.openFile(target.value)
  }
}

function handleMouseEnter() {
  isHovered.value = true
}

function handleMouseLeave() {
  isHovered.value = false
}

function handleRewindClick() {
  emit('rewind', props.message)
}

function handleEditClick() {
  editContent.value = props.message.content || ''
  isEditing.value = true
  nextTick(() => {
    editTextareaRef.value?.focus()
    editTextareaRef.value?.setSelectionRange(editContent.value.length, editContent.value.length)
  })
}

function handleEditCancel() {
  isEditing.value = false
  editContent.value = ''
}

function handleEditSend() {
  const trimmed = editContent.value.trim()
  if (!trimmed) return
  isEditing.value = false
  emit('editResend', props.message, trimmed)
}

function handleEditKeydown(e: KeyboardEvent) {
  // Enter 发送，Shift+Enter 换行
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleEditSend()
  } else if (e.key === 'Escape') {
    e.preventDefault()
    handleEditCancel()
  }
}

function handleCopyClick() {
  const text = props.message.content || ''
  if (!text) return
  navigator.clipboard.writeText(text).then(() => {
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  })
}

const renderedUserContent = computed(() =>
  renderContentWithAttachments(props.message.content || '', props.message.imageAttachments)
)

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })    
}

function showImagePreview(img: ImageAttachment) {
  previewImage.value = img
}

function closeImagePreview() {
  previewImage.value = null
}

function handleToolSubmit(toolId: string, updatedInput: Record<string, unknown>) {
  emit('toolSubmit', props.message.id, toolId, updatedInput)
}

function handleToolSkip(toolId: string) {
  emit('toolSkip', props.message.id, toolId)
}

/**
 * Serialize a DOM node tree into plain text, replacing mention chip elements
 * with their original `@file:"<path>"` / `@folder:"<path>"` / `@image:"<id>"`
 * markers and command chip elements with their original
 * `/cmd:"<name>":<kind>:<source>` markers. Browsers (especially Chromium)
 * treat `display: inline-flex` chips as block boxes during clipboard plain-text
 * serialization, which inserts spurious newlines around each chip. By overriding
 * the copy event we keep the output format identical to the original input — so
 * pasting back into the chat editor preserves both content and chip rendering.
 */
function serializeNodeForCopy(node: Node): string {
  let out = ''
  for (const child of Array.from(node.childNodes)) {
    if (child instanceof HTMLElement && child.classList.contains('mention-chip')) {
      const imageId = child.getAttribute('data-image-id')
      const path = child.getAttribute('data-path')
      const isFolder = child.getAttribute('data-is-folder') === 'true'
      if (imageId) {
        out += `@image:"${imageId}"`
      } else if (path) {
        out += isFolder ? `@folder:"${path}"` : `@file:"${path}"`
      } else {
        // Fallback: use visible chip name if attributes are missing.
        out += child.textContent || ''
      }
    } else if (child instanceof HTMLElement && child.classList.contains('command-chip')) {
      const cmd = child.getAttribute('data-command')
      const kind = child.getAttribute('data-kind')
      const source = child.getAttribute('data-source')
      if (cmd && kind && source) {
        out += `/cmd:"${cmd.slice(1)}":${kind}:${source}`
      } else {
        out += child.textContent || ''
      }
    } else if (child.nodeType === Node.TEXT_NODE) {
      out += child.textContent || ''
    } else if (child instanceof HTMLElement) {
      out += serializeNodeForCopy(child)
      if (child.tagName === 'BR') out += '\n'
    }
  }
  return out
}

function handleUserCopy(e: ClipboardEvent) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return
  const range = selection.getRangeAt(0)
  if (range.collapsed) return

  const container = e.currentTarget as HTMLElement
  // Only intercept when the entire selection is contained within this user
  // message; otherwise fall back to the browser's default copy behaviour.
  if (!container.contains(range.commonAncestorContainer)) return

  const fragment = range.cloneContents()
  const text = serializeNodeForCopy(fragment)
  if (!text) return

  e.preventDefault()
  e.clipboardData?.setData('text/plain', text)
}
</script>

<style lang="scss" scoped>
.message-item.notification {
  padding: 8px 0;

  .message-avatar {
    display: none;
  }

  .message-body {
    width: 100%;
  }
}

.task-notification-card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: center;
  max-width: 100%;
  margin: 0 auto;
  padding: 8px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--text-sm);

  &.completed {
    color: var(--success);
    border-color: rgba(34, 197, 94, 0.35);
  }

  &.failed {
    color: var(--error);
    border-color: rgba(239, 68, 68, 0.35);
  }
}

.message-item {
  display: flex;
  gap: 12px;
  padding: 16px 0;
  position: relative;

  & + .message-item.notification {
  padding: 8px 0;

  .message-avatar {
    display: none;
  }

  .message-body {
    width: 100%;
  }
}

.task-notification-card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: center;
  max-width: 100%;
  margin: 0 auto;
  padding: 8px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--text-sm);

  &.completed {
    color: var(--success);
    border-color: rgba(34, 197, 94, 0.35);
  }

  &.failed {
    color: var(--error);
    border-color: rgba(239, 68, 68, 0.35);
  }
}

.message-item {
    border-top: 1px solid var(--surface-border);
  }

  &.user {
    flex-direction: row-reverse;

    .message-avatar {
      background: var(--accent-primary);
      color: white;
    }

    .message-body {
      align-items: flex-end;
    }

    .message-header {
      flex-direction: row-reverse;
    }

    .message-content {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border-radius: var(--radius-lg);
      padding: 12px 16px;
      border: 1px solid var(--surface-border);

      p {
        color: var(--text-primary);
      }
    }
  }

  &.assistant {
    .message-avatar {
      background: var(--surface-glass);
      color: var(--accent-primary);
      border: 1px solid var(--surface-border);
    }
  }
}

.message-avatar {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-md);
  @include flex-center;
  flex-shrink: 0;
}

.message-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;

  .role-label {
    font-size: var(--text-md);
    font-weight: var(--font-weight-semibold);
    color: var(--text-primary);
  }

  .timestamp {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
}

.image-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}

.image-attachment {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  background: var(--bg-secondary);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  padding: 4px;
  cursor: pointer;
  transition: border-color 0.2s ease;

  &:hover {
    border-color: var(--accent-primary);
  }

  img {
    max-width: 120px;
    max-height: 120px;
    border-radius: 4px;
    object-fit: cover;
  }

  .image-name {
    font-size: var(--text-2xs);
    color: var(--text-muted);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

// 图片预览灯箱
.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  background: rgba(0, 0, 0, 0.8);
  cursor: zoom-out;
}

.image-preview-full {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
  cursor: default;
}

.image-preview-close {
  position: fixed;
  top: 20px;
  right: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  transition: background 0.15s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.25);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.message-content {
  font-size: var(--text-base);
  line-height: var(--leading-chat);
  color: var(--text-primary);
  user-select: text;

  p {
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    user-select: text;
  }

  // Inline mention chips inside user-authored messages.
  :deep(.mention-chip) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    margin: 0 2px;
    background: var(--bg-secondary);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    vertical-align: baseline;
    white-space: nowrap;

    .chip-icon {
      font-size: var(--text-sm);
      line-height: 1;
      flex-shrink: 0;
    }

    .chip-name {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &.is-folder {
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
      border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.3);
      color: var(--accent-primary);
    }
  }
}

.message-content {
  font-size: var(--text-base);
  line-height: var(--leading-chat);
  color: var(--text-primary);
  user-select: text;

  p {
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
    user-select: text;
  }

  // Inline mention chips inside user-authored messages.
  :deep(.mention-chip) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    margin: 0 2px;
    background: var(--bg-secondary);
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    vertical-align: baseline;
    white-space: nowrap;

    .chip-icon {
      font-size: var(--text-sm);
      line-height: 1;
      flex-shrink: 0;
    }

    .chip-name {
      max-width: 260px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    &.is-folder {
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
      border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.3);
      color: var(--accent-primary);
    }
  }

  :deep(.command-chip) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border: 1px solid var(--surface-border);
    border-radius: 4px;
    font-size: var(--text-sm);
    line-height: var(--leading-normal);
    vertical-align: baseline;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);

    .chip-source-icon {
      font-size: 1em;
      line-height: 1;
      display: inline-flex;
      align-items: center;
    }

    .chip-label {
      font-weight: var(--font-weight-semibold);
    }

    .chip-source-tag {
      font-size: var(--text-2xs);
      opacity: 0.7;
    }

    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.1);
    border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.35);
    color: var(--accent-primary);
  }
}

// 用户消息操作栏（回滚 + 复制）
// 始终占据空间，默认隐藏，hover 时淡入显示
.message-action-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  height: 24px;
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
  transition: opacity 0.2s ease, visibility 0.2s ease;

  // 用户消息右对齐
  .message-item.user & {
    justify-content: flex-end;
  }

  &.is-visible {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }
}

.action-button {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary);
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
  padding: 0;
  flex-shrink: 0;

  &:hover {
    background: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }
}

.workbench-hint-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.workbench-hint-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 10px;
  border-radius: var(--radius-md);
  border: 1px solid rgba(var(--accent-primary-rgb, 59, 130, 246), 0.3);
  background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.06);
  color: var(--accent-primary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color 0.15s ease, border-color 0.15s ease;

  &:hover {
    background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.14);
    border-color: var(--accent-primary);
  }

  .hint-label {
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
  }

  .hint-action {
    color: var(--text-muted);
    flex-shrink: 0;
  }
}

// 响应式布局
@media (max-width: 768px) {
  .message-item.notification {
  padding: 8px 0;

  .message-avatar {
    display: none;
  }

  .message-body {
    width: 100%;
  }
}

.task-notification-card {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  align-self: center;
  max-width: 100%;
  margin: 0 auto;
  padding: 8px 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--text-sm);

  &.completed {
    color: var(--success);
    border-color: rgba(34, 197, 94, 0.35);
  }

  &.failed {
    color: var(--error);
    border-color: rgba(239, 68, 68, 0.35);
  }
}

.message-item {
    gap: 8px;
    padding: 12px 0;
  }

  .message-avatar {
    width: 24px;
    height: 24px;
  }

  .message-content {
    font-size: var(--text-base);
  }

  .message-header {
    margin-bottom: 4px;

    .role-label {
      font-size: var(--text-sm);
    }

    .timestamp {
      font-size: var(--text-2xs);
    }
  }

  .action-button {
    width: 20px;
    height: 20px;
  }
}

// 用户消息编辑模式
.message-edit-area {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 16px;
  background: var(--bg-tertiary);
  border: 1px solid var(--accent-primary);
  border-radius: var(--radius-lg);
}

.edit-textarea {
  width: 100%;
  min-height: 60px;
  max-height: 300px;
  resize: vertical;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: var(--text-base);
  font-family: inherit;
  line-height: var(--leading-chat);
  outline: none;
  padding: 0;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.edit-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.edit-cancel-btn {
  padding: 4px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--surface-border);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

.edit-send-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 14px;
  border-radius: var(--radius-md);
  border: none;
  background: var(--accent-primary);
  color: white;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
  cursor: pointer;
  transition: opacity 0.2s ease;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
</style>
