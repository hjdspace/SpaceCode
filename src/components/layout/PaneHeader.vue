<template>
  <!--
    PaneHeader — 单个 pane 顶部状态条（含分屏入口）
    --------------------------------------------------------
    单 leaf → 不渲染 header（分屏按钮已移至全局 TitleBar）
    多 leaf → 完整 header（状态点/标题/任务进度/分屏按钮/关闭）
  -->
  <header v-if="!isOnlyLeaf" class="pane-header" :class="{ active: isActive }">
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
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, ClipboardList, Loader2, Columns2, Rows2 } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { useSplitLayoutStore, type PaneLeaf, type PaneContent } from '@/stores/splitLayout'
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

/** 把 leaf 内容解析为「真正 chatStore 用的 sessionId」 */
const resolvedSessionId = computed(() => {
  const c = props.node.content
  if (c.kind === 'session') {
    const tid = c.tabId || ''
    return tid.startsWith('session-') ? tid.slice('session-'.length) : (tid === 'chat' ? (chatStore.currentSessionId || '') : tid)
  }
  if (c.kind === 'main') {
    const t = appStore.activeCenterTab || ''
    if (t.startsWith('session-')) return t.slice('session-'.length)
    return chatStore.currentSessionId || ''
  }
  return ''
})

const terminalTabId = computed(() => {
  const c = props.node.content
  if (c.kind === 'terminal') return c.tabId
  if (c.kind === 'main') {
    const t = appStore.activeCenterTab || ''
    if (t.startsWith('terminal-')) return t
  }
  return null
})

/** 标题 */
const title = computed(() => {
  const tid = terminalTabId.value
  if (tid) {
    const tab = appStore.centerTabs.find(t => t.id === tid)
    return tab?.label || 'Terminal'
  }
  const sid = resolvedSessionId.value
  if (sid) {
    const s = chatStore.sessions.find(ss => ss.id === sid)
    return s?.title || t('common.newChat', 'New Chat')
  }
  return t('common.newChat', 'New Chat')
})

const statusClass = computed(() => {
  const sid = resolvedSessionId.value
  if (!sid) return 'none'
  const s = chatStore.sessions.find(ss => ss.id === sid)
  if (!s) return 'none'
  switch (s.processStatus) {
    case 'active':
    case 'starting': return 'active'
    case 'idle': return 'idle'
    case 'suspended': return 'suspended'
    default: return 'none'
  }
})

const isLoading = computed(() => chatStore.getIsLoading?.(resolvedSessionId.value) ?? false)
const { progress: taskProgress } = useSessionTaskProgress(() => resolvedSessionId.value)

/**
 * 分屏时把当前 leaf 内容解析为真正可独立的内容对象。
 * - kind='main' → 跟随全局状态，分屏时必须转为具体 kind
 *   （session / terminal）才能实现每个 pane 独立切换。
 * - 否则直接复制原内容，确保新 leaf 拥有独立的数据引用。
 */
function resolveContentForSplit(): PaneContent {
  const c = props.node.content
  if (c.kind === 'main') {
    const tabId = appStore.activeCenterTab
    if (tabId.startsWith('terminal-')) {
      return { kind: 'terminal', tabId }
    }
    // session-xxx 或 'chat'
    return { kind: 'session', tabId }
  }
  return { ...c }
}

function onSplitRight() {
  // 先更新当前 leaf 内容（若为 kind='main' 则转为具体绑定），
  // 再分屏，确保两个 leaf 都有独立的内容引用
  const content = resolveContentForSplit()
  splitLayout.setPaneContent(props.node.id, content)
  splitLayout.splitPane(props.node.id, 'right', { ...content })
}
function onSplitBottom() {
  const content = resolveContentForSplit()
  splitLayout.setPaneContent(props.node.id, content)
  splitLayout.splitPane(props.node.id, 'bottom', { ...content })
}
function onClose() {
  splitLayout.closePane(props.node.id)
}
</script>

<style lang="scss" scoped>
/* ─── 多 leaf：完整 header ─────────────────────────────────────────────── */
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