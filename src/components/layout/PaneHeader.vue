<template>
  <header class="pane-header" :class="{ active: isActive }">
    <!-- 左：状态点 + 标题 -->
    <div class="pane-header-left">
      <span class="pane-status" :class="statusClass">
        <span v-if="statusClass === 'active'" class="spinner" />
      </span>
      <span class="pane-title" :title="title">{{ title }}</span>
    </div>

    <!-- 中：任务进度 / 流式指示 -->
    <div class="pane-header-center">
      <span
        v-if="taskProgress.total > 0"
        class="pane-chip pane-chip-tasks"
        :title="t('splitLayout.taskProgress', 'Task progress')"
      >
        <ClipboardList :size="11" />
        {{ taskProgress.completed }}/{{ taskProgress.total }}
      </span>
      <span
        v-else-if="isLoading"
        class="pane-chip pane-chip-loading"
      >
        <Loader2 :size="11" class="spin" />
        {{ t('chat.thinking', 'Working…') }}
      </span>
    </div>

    <!-- 右：分屏 / 关闭按钮 -->
    <div class="pane-header-actions">
      <button
        v-if="canSplit"
        class="pane-btn"
        :title="t('splitLayout.splitRight', 'Open on the right')"
        @click.stop="onSplitRight"
      >
        <Columns2 :size="13" />
      </button>
      <button
        v-if="canSplit"
        class="pane-btn"
        :title="t('splitLayout.splitBottom', 'Open below')"
        @click.stop="onSplitBottom"
      >
        <Rows2 :size="13" />
      </button>
      <button
        v-if="!isOnlyLeaf"
        class="pane-btn pane-btn-close"
        :title="t('splitLayout.closePane', 'Close pane')"
        @click.stop="onClose"
      >
        <X :size="13" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
/**
 * PaneHeader — 单个 pane 顶部状态条
 *
 * 阶段 3 职责：
 *  - 显示该 pane 所绑定会话的运行状态（active/idle/suspended/none）和任务进度。
 *  - 提供拆分（右/下）与关闭按钮。
 *  - 单 leaf 模式下整个 header 隐藏（由 PaneLeafView 控制显示时机），避免侵入现状 UI。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, ClipboardList, Loader2, Columns2, Rows2 } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSplitLayoutStore, type PaneLeaf } from '@/stores/splitLayout'
import { useSessionTaskProgress } from '@/composables/useSessionTaskProgress'

const props = defineProps<{
  node: PaneLeaf
}>()

const { t } = useI18n()
const chatStore = useChatStore()
const appStore = useAppStore()
const splitLayout = useSplitLayoutStore()

const isActive = computed(() => splitLayout.activePaneId === props.node.id)
const canSplit = computed(() => splitLayout.canSplit)
const isOnlyLeaf = computed(() => splitLayout.leafCount === 1)

/** 把 leaf 内容解析为「真正 chatStore 用的 sessionId」（kind=session → tabId 去前缀；
 *  kind=main → 跟随全局 currentSessionId） */
const resolvedSessionId = computed(() => {
  const c = props.node.content
  if (c.kind === 'session') {
    const t = c.tabId || ''
    return t.startsWith('session-') ? t.slice('session-'.length) : (t === 'chat' ? (chatStore.currentSessionId || '') : t)
  }
  if (c.kind === 'main') {
    // 跟随全局 active center tab
    const t = appStore.activeCenterTab || ''
    if (t.startsWith('session-')) return t.slice('session-'.length)
    return chatStore.currentSessionId || ''
  }
  return ''
})

/** 处于该 pane 的终端 tab id（如果是终端类型） */
const terminalTabId = computed(() => {
  const c = props.node.content
  if (c.kind === 'terminal') return c.tabId
  if (c.kind === 'main') {
    const t = appStore.activeCenterTab || ''
    if (t.startsWith('terminal-')) return t
  }
  return null
})

/** 标题：会话标题 / 终端 label / 'New Chat' */
const title = computed(() => {
  if (terminalTabId.value) {
    const tab = appStore.centerTabs.find(t => t.id === terminalTabId.value)
    return tab?.label || 'Terminal'
  }
  const sid = resolvedSessionId.value
  if (sid) {
    const s = chatStore.sessions.find(ss => ss.id === sid)
    return s?.title || t('common.newChat', 'New Chat')
  }
  return t('common.newChat', 'New Chat')
})

/** 状态点：active=spinner / idle=green / suspended=yellow / none=grey */
const statusClass = computed(() => {
  const sid = resolvedSessionId.value
  if (!sid) return 'none'
  const s = chatStore.sessions.find(ss => ss.id === sid)
  if (!s) return 'none'
  switch (s.processStatus) {
    case 'active':
    case 'starting':
      return 'active'
    case 'idle':
      return 'idle'
    case 'suspended':
      return 'suspended'
    default:
      return 'none'
  }
})

const isLoading = computed(() => chatStore.getIsLoading?.(resolvedSessionId.value) ?? false)

const { progress: taskProgress } = useSessionTaskProgress(() => resolvedSessionId.value)

function onSplitRight() {
  // 同 pane 内容复制一份到右侧
  splitLayout.splitPane(props.node.id, 'right', { ...props.node.content })
}
function onSplitBottom() {
  splitLayout.splitPane(props.node.id, 'bottom', { ...props.node.content })
}
function onClose() {
  splitLayout.closePane(props.node.id)
}
</script>

<style lang="scss" scoped>
.pane-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  min-height: 30px;
  padding: 0 8px;
  background: var(--surface-glass, rgba(0,0,0,0.03));
  border-bottom: 1px solid var(--surface-border, #e5e7eb);
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  user-select: none;
  position: relative;

  &.active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: var(--accent-primary, #3b82f6);
  }
}

.pane-header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
}

.pane-status {
  width: 10px;
  height: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &.active .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid var(--accent-primary, #3b82f6);
    border-top-color: transparent;
    border-radius: 50%;
    animation: pane-spin 0.8s linear infinite;
  }
  &.idle::after,
  &.suspended::after,
  &.none::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  &.idle::after      { background: var(--status-success, #22c55e); }
  &.suspended::after { background: var(--status-warning, #eab308); }
  &.none::after      { background: var(--text-muted, #9ca3af); }
}

@keyframes pane-spin { to { transform: rotate(360deg); } }

.pane-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #111827);
  font-weight: 500;
}

.pane-header-center {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.pane-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--surface-glass, rgba(0,0,0,0.04));
  border: 1px solid var(--surface-border, transparent);

  &.pane-chip-loading {
    color: var(--accent-primary, #3b82f6);
  }
}

.spin { animation: pane-spin 1s linear infinite; }

.pane-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 0 auto;
}

.pane-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-muted, #9ca3af);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--surface-glass-hover, rgba(0,0,0,0.06));
    color: var(--text-primary, #111827);
  }

  &.pane-btn-close:hover {
    color: var(--status-danger, #ef4444);
  }
}
</style>
