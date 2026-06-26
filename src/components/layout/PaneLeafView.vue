<template>
  <div
    class="pane-leaf"
    :class="{ active: isActive, 'multi-leaf': multiLeaf }"
    @mousedown="onActivate"
    @dragover.prevent="onDragOver"
    @dragleave="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- PaneHeader：始终渲染；单 leaf 时以浮动小按钮组形式出现，不侵入标题栏 -->
    <PaneHeader :node="node" />

    <div class="pane-leaf-body">
      <!-- 'main'：跟随 appStore.activeCenterTab 渲染当前内容（与改造前 ChatPanel 行为完全一致） -->
      <ChatPanel v-if="node.content.kind === 'main'" />

      <!-- 'session'：明确绑定 sessionId -->
      <ChatPanel
        v-else-if="node.content.kind === 'session'"
        :session-id="resolvedSessionId"
        :pane-id="node.id"
      />

      <!-- 'terminal'：Teleport 目标。实际的 TerminalContainer 由 SplitContainer > TerminalHost 投射进来。
           这样切换 pane 归属时跨父级移动而不被 unmount，pty 不会被 kill。 -->
      <div
        v-else-if="node.content.kind === 'terminal'"
        :id="`pane-terminal-mount-${node.id}`"
        class="pane-terminal-mount"
      />

      <!-- 'empty'：空槽位占位 + 自救按钮 -->
      <div v-else class="pane-empty">
        <div class="pane-empty-body">
          <span class="pane-empty-hint">{{ t('splitLayout.emptyPaneHint', 'Drop a tab here') }}</span>
          <div class="pane-empty-actions">
            <button class="pane-empty-btn" @click.stop="handleNewSession">
              <MessageSquarePlus :size="14" />
              {{ t('common.newChat', 'New Chat') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Drop zone 高亮指示（拖动 tab 进入时显示） -->
    <Transition name="pane-drop-fade">
      <div
        v-if="dropZone"
        class="pane-drop-overlay"
        :class="`drop-${dropZone}`"
      />
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessageSquarePlus } from 'lucide-vue-next'
import { useSplitLayoutStore, type PaneLeaf, type PaneContent } from '@/stores/splitLayout'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import ChatPanel from './ChatPanel.vue'
import PaneHeader from './PaneHeader.vue'

const props = defineProps<{
  node: PaneLeaf
}>()

const { t } = useI18n()
const splitLayout = useSplitLayoutStore()
const appStore = useAppStore()
const chatStore = useChatStore()

const isActive = computed(() => splitLayout.activePaneId === props.node.id)
const multiLeaf = computed(() => !splitLayout.isSingleLeaf)

/** 把 'session-<id>' 形式的 tabId 还原为 sessionId（与 app store 的 openSessionTab 约定一致） */
const resolvedSessionId = computed(() => {
  const tabId = props.node.content.tabId || ''
  if (tabId.startsWith('session-')) return tabId.slice('session-'.length)
  if (tabId === 'chat') return ''
  return tabId
})

function onActivate() {
  splitLayout.setActivePane(props.node.id)
}

/** 空 pane → 创建新会话并填入此 pane */
function handleNewSession() {
  const session = chatStore.createSession()
  if (!session) return
  const tabId = `session-${session.id}`
  // 确认 centerTabs 里有此 tab
  appStore.openSessionTab(session.id, session.title)
  splitLayout.setPaneContent(props.node.id, { kind: 'session', tabId })
  splitLayout.setActivePane(props.node.id)
  appStore.activeCenterTab = tabId
}

// ─── Drag & Drop ───────────────────────────────────────────────────────────

type DropZone = 'center' | 'left' | 'right' | 'top' | 'bottom'
const dropZone = ref<DropZone | null>(null)

/** 根据光标位置判断目标 drop zone：5 等分（中心区 60%，四周各占 20%） */
function pickZone(e: DragEvent, el: HTMLElement): DropZone {
  const rect = el.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height
  const margin = 0.2
  if (!splitLayout.canSplit) return 'center'
  if (x < margin && y > margin && y < 1 - margin) return 'left'
  if (x > 1 - margin && y > margin && y < 1 - margin) return 'right'
  if (y < margin && x > margin && x < 1 - margin) return 'top'
  if (y > 1 - margin && x > margin && x < 1 - margin) return 'bottom'
  return 'center'
}

function onDragOver(e: DragEvent) {
  const types = e.dataTransfer?.types
  if (!types || !Array.from(types).includes('application/spacecode-tab')) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropZone.value = pickZone(e, e.currentTarget as HTMLElement)
}

function onDragLeave(e: DragEvent) {
  const related = e.relatedTarget as Node | null
  const root = e.currentTarget as HTMLElement
  if (!related || !root.contains(related)) {
    dropZone.value = null
  }
}

function onDrop(e: DragEvent) {
  const payload = e.dataTransfer?.getData('application/spacecode-tab')
  const zone = dropZone.value
  dropZone.value = null
  if (!payload) return
  let data: { tabId: string } | null = null
  try { data = JSON.parse(payload) } catch { return }
  if (!data?.tabId) return

  const newContent: PaneContent = data.tabId.startsWith('terminal-')
    ? { kind: 'terminal', tabId: data.tabId }
    : { kind: 'session', tabId: data.tabId }

  if (!zone || zone === 'center') {
    splitLayout.setPaneContent(props.node.id, newContent)
    splitLayout.setActivePane(props.node.id)
    appStore.activeCenterTab = data.tabId
    return
  }

  if (!splitLayout.canSplit) return
  const newPaneId = splitLayout.splitPane(props.node.id, zone, newContent)
  if (newPaneId) {
    appStore.activeCenterTab = data.tabId
  }
}
</script>

<style lang="scss" scoped>
.pane-leaf {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &:not(.multi-leaf) {
    // 单 leaf 无边框（保持现状透明感）
    border: none;
    border-radius: 0;
  }

  &.multi-leaf {
    border: 1px solid var(--surface-border, transparent);
    border-radius: var(--radius-md, 6px);

    &.active {
      border-color: var(--accent-primary, #3b82f6);
      box-shadow: 0 0 0 1px var(--accent-primary, #3b82f6) inset;
    }
  }
}

.pane-leaf-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.pane-terminal-mount {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.pane-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted, #9ca3af);
  font-size: 13px;
}

.pane-empty-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.pane-empty-hint {
  padding: 8px 16px;
  border: 1px dashed var(--surface-border, #e5e7eb);
  border-radius: var(--radius-md, 6px);
  opacity: 0.6;
}

.pane-empty-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--surface-border, #e5e7eb);
  border-radius: var(--radius-md, 6px);
  background: var(--bg-secondary, rgba(0,0,0,0.04));
  color: var(--text-primary, #111827);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    background: var(--bg-hover, rgba(0,0,0,0.08));
    border-color: var(--accent-primary, #3b82f6);
    color: var(--accent-primary, #3b82f6);
  }
}

/* ── Drop zone overlay ──────────────────────────────────────────────────── */
.pane-drop-overlay {
  position: absolute;
  pointer-events: none;
  background: color-mix(in srgb, var(--accent-primary, #3b82f6) 25%, transparent);
  border: 2px solid var(--accent-primary, #3b82f6);
  z-index: 20;
  transition: all 0.15s ease;

  &.drop-center { inset: 0; }
  &.drop-left   { left: 0;  top: 0; bottom: 0; width: 50%; }
  &.drop-right  { right: 0; top: 0; bottom: 0; width: 50%; }
  &.drop-top    { left: 0;  top: 0; right: 0;  height: 50%; }
  &.drop-bottom { left: 0;  bottom: 0; right: 0; height: 50%; }
}

.pane-drop-fade-enter-active,
.pane-drop-fade-leave-active {
  transition: opacity 0.12s ease;
}
.pane-drop-fade-enter-from,
.pane-drop-fade-leave-to {
  opacity: 0;
}
</style>
