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
 *  - watch(activePaneId) → 回写 sessionStore.currentSessionId / appStore.activeCenterTab，
 *    保持全局 LLM/CLI 状态一致。
 */
import { watch } from 'vue'
import { useSplitLayoutStore } from '@/stores/splitLayout'
import { useChatSessionStore } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import PaneNodeView from './PaneNodeView.vue'
import TerminalHost from './TerminalHost.vue'

const splitLayout = useSplitLayoutStore()
const sessionStore = useChatSessionStore()
const appStore = useAppStore()

/**
 * Active pane → 全局 current 同步：
 *  - 多 pane 时点击某 pane 会改 activePaneId；这里把该 pane 的 sessionId/terminalTabId
 *    回写到 sessionStore.currentSessionId / appStore.activeCenterTab，保证 ChatInput、
 *    ContextUsageChip、TitleBar 等仍引用 current 的 UI 行为正确。
 *  - 单 leaf 模式不会触发（activePaneId 不变）。
 *
 * 同时监听 active pane 的 content.tabId：当用户在 active pane 内切换标签页时
 * （SessionTabBar pane 模式只更新 pane content，不改全局），这里负责把新
 * tabId/sessionId 同步到全局，保证 sendMessage 等全局操作命中正确的会话。
 */
function syncActivePaneToGlobal() {
  const leaf = splitLayout.activePane
  if (!leaf) return
  const c = leaf.content
  if (c.kind === 'session' && c.tabId) {
    const sid = c.tabId.startsWith('session-') ? c.tabId.slice('session-'.length) : c.tabId
    if (sid && sessionStore.currentSessionId !== sid) {
      sessionStore.selectSession(sid)
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
}

// activePaneId 变化（点击不同 pane）→ 同步
watch(
  () => splitLayout.activePaneId,
  () => syncActivePaneToGlobal(),
)

// active pane 的 content.tabId 变化（pane 内切换标签）→ 同步
watch(
  () => splitLayout.activePane?.content?.tabId,
  () => syncActivePaneToGlobal(),
)

/**
 * 单 leaf 模式下，全局 activeCenterTab 变化时反向同步到 pane content。
 *
 * 问题场景：leaf kind 为 'session'（例如从分屏关闭后残留）时，
 * 点击侧边栏切换会话更新了 sessionStore.currentSessionId 和 appStore.activeCenterTab，
 * 但 pane content 的 tabId 未更新，导致 ChatPanel 仍通过 props.sessionId 显示旧会话。
 *
 * 'main' kind 的 leaf 跟随全局 currentSessionId，无需处理；
 * 多 leaf 模式下各 pane 独立，也不处理。
 */
watch(
  () => appStore.activeCenterTab,
  (tabId) => {
    if (!splitLayout.isSingleLeaf) return
    const leaf = splitLayout.activePane
    if (!leaf) return
    // 仅修正 'session' kind 的 leaf：当全局切到某个 session tab 时，
    // 确保 pane content 的 tabId 同步更新（'main' kind 跟随全局，无需处理）
    if (
      tabId.startsWith('session-') &&
      leaf.content.kind === 'session' &&
      leaf.content.tabId !== tabId
    ) {
      splitLayout.setPaneContent(leaf.id, { kind: 'session', tabId })
    }
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
