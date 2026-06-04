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
            <img v-if="img.previewUrl" :src="img.previewUrl" :alt="img.name" @click="showImagePreview(img)" />
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
        
        <!-- 消息内容容器（包含回滚按钮和内容） -->
        <div class="message-content-wrapper">
          <button
            v-if="showRewindButton"
            class="rewind-button"
            :title="t('chat.rewind')"
            :aria-label="t('chat.rewind')"
            @click="handleRewindClick"
          >
            <RotateCcw :size="14" />
          </button>
          
          <!-- 消息内容 -->
          <div class="message-content" v-if="message.content">
            <MarkdownRenderer 
              v-if="message.role === 'assistant'" 
              :content="message.content" 
            />
            <p v-else class="user-text" v-html="renderedUserContent" @copy="handleUserCopy"></p>
          </div>
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
import { User, Bot, RotateCcw, CheckCircle, XCircle, X, Globe, FileText } from 'lucide-vue-next'
import { computed, ref } from 'vue'
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
}>()

const isHovered = ref(false)
const previewImage = ref<ImageAttachment | null>(null)

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

const showRewindButton = computed(() => {
  if (!isHovered.value) return false
  if (props.message.role !== 'user') return false
  if (props.canRewind === false) return false
  return true
})

function handleMouseEnter() {
  isHovered.value = true
}

function handleMouseLeave() {
  isHovered.value = false
}

function handleRewindClick() {
  emit('rewind', props.message)
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
  font-size: 12px;

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
  font-size: 12px;

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
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .timestamp {
    font-size: 11px;
    color: var(--text-muted);
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
    font-size: 11px;
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
  font-size: 14px;
  line-height: 1.6;
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
    font-size: 12px;
    line-height: 1.4;
    vertical-align: baseline;
    white-space: nowrap;

    .chip-icon {
      font-size: 12px;
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
    font-size: 12px;
    line-height: 1.4;
    vertical-align: baseline;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);

    .chip-source-icon {
      font-size: 12px;
      line-height: 1;
    }

    .chip-label {
      font-weight: 600;
    }

    .chip-source-tag {
      font-size: 10px;
      opacity: 0.7;
    }

    &.kind-sdk_command {
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
      border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.5);
      color: var(--accent-primary);
    }

    &.kind-codepilot_command {
      background: rgba(245, 158, 11, 0.08);
      border-color: rgba(245, 158, 11, 0.5);
      color: #f59e0b;
    }

    &.kind-agent_skill {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.5);
      color: #10b981;
    }

    &.kind-slash_command {
      background: rgba(99, 102, 241, 0.08);
      border-color: rgba(99, 102, 241, 0.5);
      color: #6366f1;
    }
  }
}

.message-content {
  font-size: 14px;
  line-height: 1.6;
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
    font-size: 12px;
    line-height: 1.4;
    vertical-align: baseline;
    white-space: nowrap;

    .chip-icon {
      font-size: 12px;
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
    font-size: 12px;
    line-height: 1.4;
    vertical-align: baseline;
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace);

    .chip-source-icon {
      font-size: 12px;
      line-height: 1;
    }

    .chip-label {
      font-weight: 600;
    }

    .chip-source-tag {
      font-size: 10px;
      opacity: 0.7;
    }

    &.kind-sdk_command {
      background: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.08);
      border-color: rgba(var(--accent-primary-rgb, 59, 130, 246), 0.5);
      color: var(--accent-primary);
    }

    &.kind-codepilot_command {
      background: rgba(245, 158, 11, 0.08);
      border-color: rgba(245, 158, 11, 0.5);
      color: #f59e0b;
    }

    &.kind-agent_skill {
      background: rgba(16, 185, 129, 0.08);
      border-color: rgba(16, 185, 129, 0.5);
      color: #10b981;
    }

    &.kind-slash_command {
      background: rgba(99, 102, 241, 0.08);
      border-color: rgba(99, 102, 241, 0.5);
      color: #6366f1;
    }
  }
}

// 消息内容容器（用于放置回滚按钮和消息内容）
.message-content-wrapper {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.rewind-button {
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
  opacity: 0;
  transition: opacity 0.2s ease, background-color 0.2s ease, color 0.2s ease;
  z-index: 1;
  padding: 0;
  flex-shrink: 0;
  margin-top: 12px; // 与消息内容的padding对齐

  &:hover {
    background: var(--accent-primary);
    color: white;
    border-color: var(--accent-primary);
  }
}

.message-item:hover .rewind-button {
  opacity: 1;
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
  font-size: 12px;
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
  font-size: 12px;

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
    font-size: 14px;
  }

  .message-header {
    margin-bottom: 4px;

    .role-label {
      font-size: 12px;
    }

    .timestamp {
      font-size: 10px;
    }
  }

  .rewind-button {
    width: 20px;
    height: 20px;
    margin-top: 10px; // 调整移动端的margin
  }
}
</style>
