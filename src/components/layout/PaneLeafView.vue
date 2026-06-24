<template>
  <div
    class="pane-leaf"
    :class="{ active: isActive, 'single': singleLeaf }"
    @mousedown="onActivate"
  >
    <!-- 内容路由：阶段 2 只有 'main' / 'session' / 'terminal' / 'empty' 四种 -->
    <!-- 'main'：跟随 appStore.activeCenterTab 渲染当前内容（与改造前 ChatPanel 行为完全一致） -->
    <ChatPanel v-if="node.content.kind === 'main'" />

    <!-- 'session'：明确绑定 sessionId（阶段 3 多 leaf 才会用到） -->
    <ChatPanel
      v-else-if="node.content.kind === 'session'"
      :session-id="resolvedSessionId"
      :pane-id="node.id"
    />

    <!-- 'terminal'：阶段 2 暂时复用 TerminalPanel（其内部用 v-for+v-show 多实例）。
         阶段 4 会改造为 Teleport，以支持多 pane 同时显示不同 terminal tab。 -->
    <TerminalPanel v-else-if="node.content.kind === 'terminal'" />

    <!-- 'empty'：空槽位占位（阶段 3 加交互） -->
    <div v-else class="pane-empty">
      <span class="pane-empty-hint">{{ t('splitLayout.emptyPaneHint', 'Drop a tab here') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSplitLayoutStore, type PaneLeaf } from '@/stores/splitLayout'
import ChatPanel from './ChatPanel.vue'
import TerminalPanel from '../terminal/TerminalPanel.vue'

const props = defineProps<{
  node: PaneLeaf
}>()

const { t } = useI18n()
const splitLayout = useSplitLayoutStore()

const isActive = computed(() => splitLayout.activePaneId === props.node.id)
const singleLeaf = computed(() => splitLayout.isSingleLeaf)

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

  // 多 leaf 模式下给非 active pane 一个轻边框；单 leaf 不显示边框（与现状视觉一致）
  &:not(.single) {
    border: 1px solid var(--surface-border, transparent);
    border-radius: var(--radius-md, 6px);
  }

  &.active:not(.single) {
    border-color: var(--accent-primary, #3b82f6);
    box-shadow: 0 0 0 1px var(--accent-primary, #3b82f6) inset;
  }
}

.pane-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted, #9ca3af);
  font-size: 13px;
}

.pane-empty-hint {
  padding: 8px 16px;
  border: 1px dashed var(--surface-border, #e5e7eb);
  border-radius: var(--radius-md, 6px);
}
</style>
