<template>
  <div class="session-tab-bar" v-if="tabs.length > 0">
    <div class="tabs-container">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="session-tab"
        :class="{ active: tab.id === activeTabId }"
        draggable="true"
        @click="handleTabClick(tab)"
        @dragstart="onTabDragStart($event, tab)"
      >
        <span class="tab-status" :class="getStatusClass(tab.sessionId)">
          <span v-if="getStatusClass(tab.sessionId) === 'active'" class="spinner"></span>
        </span>
        <span class="tab-label">{{ tab.label || t('common.newChat') }}</span>
        <button class="tab-close" @click.stop="handleClose(tab.id)" :title="t('sessionTab.closeTab')">
          <X :size="12" />
        </button>
      </div>
    </div>
    <button class="new-tab-btn" @click="$emit('new-session')" :title="t('sessionTab.newSession')">
      <Plus :size="14" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useAppStore, type CenterTab } from '@/stores/app'
import { useChatSessionStore } from '@/stores/chatSession'
import { useSplitLayoutStore, type PaneContent } from '@/stores/splitLayout'
import { useI18n } from 'vue-i18n'
import { X, Plus } from 'lucide-vue-next'

const props = defineProps<{
  /** 当前 pane 的 id；提供时启用 pane 级独立切换，不修改全局状态 */
  paneId?: string
  /** 当前 pane 激活的 tabId（覆盖全局 activeCenterTab 用于高亮显示） */
  activeTabIdOverride?: string
}>()

const appStore = useAppStore()
const sessionStore = useChatSessionStore()
const splitLayout = useSplitLayoutStore()
const { t } = useI18n()

const emit = defineEmits<{
  'new-session': []
  'switch-session': [sessionId: string]
  'close-tab': [tabId: string]
}>()

const tabs = computed<CenterTab[]>(() =>
  appStore.centerTabs.filter(t => t.id !== 'chat')
)

/** 分屏模式下使用 pane 自己的 tabId，非分屏模式回退到全局 activeCenterTab */
const activeTabId = computed(() => props.activeTabIdOverride || appStore.activeCenterTab)

function getStatusClass(sessionId?: string): string {
  if (!sessionId) return 'none'
  const session = sessionStore.sessions.find(s => s.id === sessionId)
  if (!session) return 'none'
  switch (session.processStatus) {
    case 'active': return 'active'
    case 'idle': return 'idle'
    case 'suspended': return 'suspended'
    case 'starting': return 'active'
    default: return 'none'
  }
}

function isTerminalTab(tab: CenterTab): boolean {
  return tab.id.startsWith('terminal-')
}

function handleTabClick(tab: CenterTab) {
  if (props.paneId) {
    // ── 分屏模式：只更新当前 pane 的内容，不直接修改全局状态 ──
    // SplitContainer 的 watcher 会自动把 active pane 的内容同步到全局
    const content: PaneContent = tab.id.startsWith('terminal-')
      ? { kind: 'terminal', tabId: tab.id }
      : { kind: 'session', tabId: tab.id }
    splitLayout.setPaneContent(props.paneId, content)
    splitLayout.setActivePane(props.paneId)
    // 通知 ChatPanel 更新 workingDirectory 等 pane 级状态
    if (tab.sessionId) {
      emit('switch-session', tab.sessionId)
    }
    return
  }
  // ── 非分屏模式：原有行为，直接修改全局状态 ──
  appStore.activeCenterTab = tab.id
  if (tab.sessionId) {
    sessionStore.selectSession(tab.sessionId)
    emit('switch-session', tab.sessionId)
  }
}

/**
 * 拖拽 tab 到 pane —— 通过自定义 MIME 类型传递 tab 信息，由
 * PaneLeafView.onDrop 接收并执行 split/replace。
 */
function onTabDragStart(e: DragEvent, tab: CenterTab) {
  if (!e.dataTransfer) return
  const payload = JSON.stringify({ tabId: tab.id, sessionId: tab.sessionId ?? null })
  e.dataTransfer.setData('application/spacecode-tab', payload)
  // 同时设置 text/plain 作为 fallback（部分浏览器调试用）
  e.dataTransfer.setData('text/plain', tab.label || tab.id)
  e.dataTransfer.effectAllowed = 'move'
}

function handleClose(tabId: string) {
  emit('close-tab', tabId)
}
</script>

<style lang="scss" scoped>
.session-tab-bar {
  display: flex;
  align-items: center;
  background: var(--surface-glass, rgba(0,0,0,0.03));
  border-bottom: 1px solid var(--surface-border, #e5e7eb);
  padding: 0 8px;
  height: 36px;
  min-height: 36px;
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;

  &::-webkit-scrollbar {
    height: 0;
  }
}

.tabs-container {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  overflow-x: auto;
}

.session-tab {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: var(--radius-sm, 4px) var(--radius-sm, 4px) 0 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  white-space: nowrap;
  max-width: 180px;
  transition: all 0.15s ease;
  position: relative;

  &:hover {
    background: var(--surface-glass-hover, rgba(0,0,0,0.05));
    color: var(--text-primary, #111827);
  }

  &.active {
    background: var(--surface-glass-active, rgba(0,0,0,0.08));
    color: var(--text-primary, #111827);
    font-weight: 500;

    &::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent-primary, #3b82f6);
    }
  }
}

.tab-status {
  width: 12px;
  height: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &.active .spinner {
    width: 10px;
    height: 10px;
    border: 2px solid var(--accent-primary, #3b82f6);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  &.idle::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--status-success, #22c55e);
  }

  &.suspended::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--status-warning, #eab308);
  }

  &.none::after {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted, #9ca3af);
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted, #9ca3af);
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
  flex-shrink: 0;

  &:hover {
    background: var(--surface-glass-hover, rgba(0,0,0,0.1));
    color: var(--text-primary, #111827);
  }

  .session-tab:hover &,
  .session-tab.active & {
    opacity: 1;
  }
}

.new-tab-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted, #9ca3af);
  border-radius: var(--radius-sm, 4px);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s ease;

  &:hover {
    background: var(--surface-glass-hover, rgba(0,0,0,0.05));
    color: var(--text-primary, #111827);
  }
}
</style>
