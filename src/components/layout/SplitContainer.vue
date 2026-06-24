<template>
  <main class="split-container">
    <PaneNodeView :node="splitLayout.root" />

    <!--
      终端宿主：所有 TerminalContainer 在此挂载，通过 Teleport 投射到 pane 的挂载点。
      必须放在 PaneNodeView 之后，确保 leaf 的 mount-point div 已先入 DOM，
      避免 Teleport :to 解析时 document.querySelector 找不到目标。
    -->
    <TerminalHost />
  </main>
</template>

<script setup lang="ts">
/**
 * SplitContainer — 中央区分屏根容器
 *
 * 阶段 4 增加：
 *  - TerminalHost：在顶层用 <Teleport> 共享 TerminalContainer，避免 pane 之间
 *    挪动时 onUnmounted 触发 pty kill。
 *  - watch(activePaneId) → 回写 chatStore.currentSessionId / appStore.activeCenterTab，
 *    保持全局 LLM/CLI 状态一致。
 */
import { watch } from 'vue'
import { useSplitLayoutStore, findLeaf } from '@/stores/splitLayout'
import { useChatStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import PaneNodeView from './PaneNodeView.vue'
import TerminalHost from './TerminalHost.vue'

const splitLayout = useSplitLayoutStore()
const chatStore = useChatStore()
const appStore = useAppStore()

/**
 * Active pane → 全局 current 同步：
 *  - 多 pane 时点击某 pane 会改 activePaneId；这里把该 pane 的 sessionId/terminalTabId
 *    回写到 chatStore.currentSessionId / appStore.activeCenterTab，保证 ChatInput、
 *    ContextUsageChip、TitleBar 等仍引用 current 的 UI 行为正确。
 *  - 单 leaf 模式不会触发（activePaneId 不变）。
 */
watch(
  () => splitLayout.activePaneId,
  (paneId) => {
    if (!paneId) return
    const leaf = findLeaf(splitLayout.root, paneId)
    if (!leaf) return
    const c = leaf.content
    if (c.kind === 'session' && c.tabId) {
      const sid = c.tabId.startsWith('session-') ? c.tabId.slice('session-'.length) : c.tabId
      if (sid && chatStore.currentSessionId !== sid) {
        chatStore.selectSession(sid)
      }
      if (appStore.activeCenterTab !== c.tabId) {
        appStore.activeCenterTab = c.tabId
      }
    } else if (c.kind === 'terminal' && c.tabId) {
      if (appStore.activeCenterTab !== c.tabId) {
        appStore.activeCenterTab = c.tabId
      }
    }
    // kind='main' / 'empty' 不写回全局，避免循环
  },
)
</script>

<style lang="scss" scoped>
.split-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  position: relative;
}
</style>
