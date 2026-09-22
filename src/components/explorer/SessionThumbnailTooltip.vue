<template>
  <Teleport to="body">
    <Transition name="thumbnail-fade">
      <div
        v-if="visible"
        ref="tooltipRef"
        class="session-thumbnail-tooltip"
        :style="tooltipStyle"
        @mouseenter="$emit('tooltip-enter')"
        @mouseleave="$emit('tooltip-leave')"
      >
        <!-- 对话预览区 -->
        <div v-if="previewMessages.length > 0" class="preview-section">
          <div
            v-for="(msg, idx) in previewMessages"
            :key="idx"
            class="preview-message"
            :class="msg.role"
          >
            <span class="preview-role">{{ getRoleLabel(msg.role) }}</span>
            <span class="preview-text">{{ msg.content }}</span>
          </div>
        </div>
        <div v-else-if="previewLoading" class="preview-loading">
          <span class="loading-spinner"></span>
          {{ t('explorer.thumbnailLoading') }}
        </div>
        <div v-else class="preview-empty">
          {{ t('explorer.thumbnailNoMessages') }}
        </div>

        <!-- 元信息区 -->
        <div class="meta-section">
          <!-- Workspace -->
          <div v-if="session.workingDirectory" class="meta-row">
            <span class="meta-label">
              <Folder :size="12" />
              {{ t('explorer.thumbnailWorkspace') }}
            </span>
            <span class="meta-value" :title="session.workingDirectory">
              {{ workspaceName }}
            </span>
          </div>

          <!-- Branch -->
          <div v-if="branch" class="meta-row">
            <span class="meta-label">
              <GitBranch :size="12" />
              {{ t('explorer.thumbnailBranch') }}
            </span>
            <span class="meta-value">{{ branch }}</span>
          </div>

          <!-- Provider -->
          <div v-if="displayProvider" class="meta-row">
            <span class="meta-label">
              <Server :size="12" />
              {{ t('explorer.thumbnailProvider') }}
            </span>
            <span class="meta-value">{{ displayProvider }}</span>
          </div>

          <!-- Model -->
          <div v-if="displayModel" class="meta-row">
            <span class="meta-label">
              <Cpu :size="12" />
              {{ t('explorer.thumbnailModel') }}
            </span>
            <span class="meta-value">{{ displayModel }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Session, Message } from '@/types'
import { Folder, GitBranch, Server, Cpu } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import { useSettingsStore } from '@/stores/settings'
import { buildMessagesFromHistory } from '@/utils/sessionRestore'

const { t } = useI18n()

interface Props {
  session: Session
  visible: boolean
  /** 触发元素（用于定位 tooltip） */
  targetRect: DOMRect | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'tooltip-enter': []
  'tooltip-leave': []
}>()

const settingsStore = useSettingsStore()
const tooltipRef = ref<HTMLDivElement>()
const branch = ref('')
const branchLoading = ref(false)

// ── 异步加载的预览消息 ──
// 会话列表是懒加载的：session.messages 可能为空或被截断。
// hover 时如果本地消息不足，从磁盘 JSONL 异步加载。
const asyncPreviewMessages = ref<{ role: string; content: string }[]>([])
const previewLoading = ref(false)
let previewLoadAbort: AbortController | null = null

// ── 对话预览 ──
// 优先使用本地 messages（已 hydrate 的会话），不足时回退到异步加载的结果
const previewMessages = computed(() => {
  // 1. 先尝试从本地 session.messages 提取
  const localMsgs = extractPreviewFromMessages(props.session.messages || [])
  if (localMsgs.length > 0) return localMsgs

  // 2. 本地为空时使用异步加载的结果
  return asyncPreviewMessages.value
})

/** 检查消息是否有效（有非空文本且非合成占位消息） */
function isValidMessage(m: Message): boolean {
  if (m.role !== 'user' && m.role !== 'assistant') return false
  if (!m.content || !m.content.trim()) return false
  const text = m.content.trim()
  if (
    text === '[Request interrupted by user]' ||
    text === '[Request interrupted by user for tool use]' ||
    text === '(no content)'
  ) {
    return false
  }
  return true
}

/**
 * 从 Message[] 中提取对话预览：
 * 只取第一条 user 消息和第一条 assistant 消息
 */
function extractPreviewFromMessages(msgs: Message[]): { role: string; content: string }[] {
  const result: { role: string; content: string }[] = []

  // 第一条 user
  const firstUser = msgs.find(m => m.role === 'user' && isValidMessage(m))
  if (firstUser) {
    result.push({ role: 'user', content: truncateText(firstUser.content, 150) })
  }

  // 第一条 assistant
  const firstAssistant = msgs.find(m => m.role === 'assistant' && isValidMessage(m))
  if (firstAssistant) {
    result.push({ role: 'assistant', content: truncateText(firstAssistant.content, 150) })
  }

  return result
}

// ── 从磁盘异步加载会话预览 ──
async function loadPreviewFromDisk() {
  const session = props.session
  if (!session.workingDirectory || !session.id) return

  // 取消上一次的加载
  if (previewLoadAbort) {
    previewLoadAbort.abort()
  }
  const ac = new AbortController()
  previewLoadAbort = ac

  previewLoading.value = true
  try {
    const claudeCode = api.claudeCode
    if (!claudeCode?.getFullSession) return

    const fullSession = await claudeCode.getFullSession(session.workingDirectory, session.id)
    if (ac.signal.aborted) return

    if (!fullSession?.messages || !Array.isArray(fullSession.messages)) return

    // 使用 buildMessagesFromHistory 解析 JSONL 消息
    const restored = buildMessagesFromHistory(fullSession.messages as any[])
    if (ac.signal.aborted) return

    // 从恢复的消息中提取预览
    asyncPreviewMessages.value = extractPreviewFromMessages(restored as Message[])
  } catch {
    // 静默失败，tooltip 会显示 "暂无对话内容"
  } finally {
    if (!ac.signal.aborted) {
      previewLoading.value = false
    }
  }
}

// ── 当 tooltip 变可见时，如果本地消息不足，异步加载 ──
watch(
  () => [props.visible, props.session.id] as const,
  ([isVisible, sessionId]) => {
    if (!isVisible || !sessionId) {
      asyncPreviewMessages.value = []
      previewLoading.value = false
      return
    }

    // 如果本地 messages 已有内容，不需要异步加载
    const localMsgs = extractPreviewFromMessages(props.session.messages || [])
    if (localMsgs.length > 0) return

    // 本地为空，从磁盘加载
    loadPreviewFromDisk()
  },
  { immediate: true }
)

// ── Workspace 名称 ──
const workspaceName = computed(() => {
  const wd = props.session.workingDirectory
  if (!wd) return ''
  const parts = wd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || wd
})

// ── Provider：优先使用 session 自身的 provider，回退到 settings 全局 ──
const displayProvider = computed(() => {
  if (props.session.provider) return props.session.provider
  return settingsStore.provider || ''
})

// ── Model：优先使用 session.model，回退到 settingsStore.lastSelectedModel ──
const displayModel = computed(() => {
  if (props.session.model) return props.session.model
  if (settingsStore.lastSelectedModel) return settingsStore.lastSelectedModel
  return ''
})

// ── Branch：当 session 有 workingDirectory 时异步获取 git 分支 ──
watch(
  () => [props.visible, props.session.workingDirectory] as const,
  ([isVisible, wd]) => {
    if (!isVisible || !wd) {
      branch.value = ''
      return
    }
    // 防重复加载
    if (branchLoading.value) return
    branchLoading.value = true
    api.git
      .getStatus(wd)
      .then(status => {
        branch.value = status?.branch || ''
      })
      .catch(() => {
        branch.value = ''
      })
      .finally(() => {
        branchLoading.value = false
      })
  },
  { immediate: true }
)

// ── Tooltip 定位 ──
const tooltipStyle = ref<Record<string, string>>({})

watch(
  () => [props.visible, props.targetRect] as const,
  async ([isVisible]) => {
    if (!isVisible || !props.targetRect) {
      return
    }
    await nextTick()
    updatePosition()
  },
  { immediate: true }
)

function updatePosition() {
  if (!props.targetRect) return

  const rect = props.targetRect
  const sidebarWidth = 280 // 侧边栏预估宽度
  const tooltipWidth = 300
  const gap = 8
  const viewportHeight = window.innerHeight

  // 默认放在右侧
  let left = rect.right + gap
  let top = rect.top

  // 右侧空间不足时放左侧
  if (left + tooltipWidth > window.innerWidth) {
    left = rect.left - tooltipWidth - gap
    // 如果左侧也不够，就贴右边缘
    if (left < 0) {
      left = window.innerWidth - tooltipWidth - gap
    }
  }

  // 如果放右侧但会超出 sidebar 宽度范围（看起来还在侧边栏内），则强制右移
  if (left < sidebarWidth && rect.right + gap + tooltipWidth <= window.innerWidth) {
    left = rect.right + gap
  }

  // 确保 tooltip 不超出视口底部
  const tooltipEl = tooltipRef.value
  const tooltipHeight = tooltipEl?.offsetHeight || 200
  if (top + tooltipHeight > viewportHeight) {
    top = Math.max(8, viewportHeight - tooltipHeight - 8)
  }

  tooltipStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    zIndex: '9998',
  }
}

// 滚动时更新位置
function handleScroll() {
  if (props.visible) {
    updatePosition()
  }
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, true)
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll, true)
  if (previewLoadAbort) previewLoadAbort.abort()
})

// ── 工具函数 ──
function truncateText(text: string, maxLen: number): string {
  if (!text) return ''
  const cleaned = text.replace(/\n/g, ' ').trim()
  if (cleaned.length <= maxLen) return cleaned
  return cleaned.slice(0, maxLen) + '...'
}

function getRoleLabel(role: string): string {
  switch (role) {
    case 'user':
      return t('explorer.thumbnailRoleUser')
    case 'assistant':
      return t('explorer.thumbnailRoleAssistant')
    case 'system':
      return t('explorer.thumbnailRoleSystem')
    default:
      return role
  }
}
</script>

<style lang="scss" scoped>
.session-thumbnail-tooltip {
  width: 300px;
  background: var(--bg-elevated, #ffffff);
  border: 1px solid var(--surface-border, rgba(0, 0, 0, 0.08));
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-xl, 0 16px 48px rgba(0, 0, 0, 0.16));
  overflow: hidden;
  pointer-events: auto;
}

.preview-section {
  max-height: 180px;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--surface-border, rgba(0, 0, 0, 0.06));

  &::-webkit-scrollbar {
    width: 4px;
  }
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--surface-border, rgba(0, 0, 0, 0.1));
    border-radius: 2px;
  }
}

.preview-message {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
  border-radius: var(--radius-sm, 6px);
  font-size: 12px;
  line-height: 1.5;

  &.user {
    background: var(--surface-glass, rgba(0, 0, 0, 0.02));
  }

  &.assistant {
    background: transparent;
  }
}

.preview-role {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted, #6b7280);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.preview-text {
  color: var(--text-secondary, #4b5563);
  word-break: break-word;
}

.preview-empty {
  padding: 16px 12px;
  text-align: center;
  font-size: 12px;
  color: var(--text-muted, #9ca3af);
  border-bottom: 1px solid var(--surface-border, rgba(0, 0, 0, 0.06));
}

.preview-loading {
  padding: 16px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted, #9ca3af);
  border-bottom: 1px solid var(--surface-border, rgba(0, 0, 0, 0.06));
}

.loading-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--accent-primary, #3b82f6);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.meta-section {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
}

.meta-label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-muted, #6b7280);
  font-weight: 500;
  flex-shrink: 0;
}

.meta-value {
  color: var(--text-secondary, #4b5563);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

// Tooltip 淡入淡出动画
.thumbnail-fade-enter-active,
.thumbnail-fade-leave-active {
  transition: opacity 120ms ease-out, transform 120ms ease-out;
}

.thumbnail-fade-enter-from,
.thumbnail-fade-leave-to {
  opacity: 0;
  transform: translateX(-4px);
}
</style>
