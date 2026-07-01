<template>
  <!--
    TerminalHost — 顶层终端宿主
    -------------------------------------------------------------------------
    所有 TerminalContainer 始终挂载在此（hostRef 内的隐藏槽位中），通过
    <Teleport> 投射到 pane 的挂载点：
      - 若 splitLayout 中存在 kind='terminal' 且 tabId 命中的 leaf  → 投射到该 pane 的 #pane-terminal-mount-<paneId>
      - 否则保留在 hostRef 内部（隐藏）—— Teleport target 用 hostRef 元素本身，
        避免空字符串 selector 导致 querySelector('') 报错。

    这样切换 pane 归属时 DOM 节点跨父级移动但 TerminalContainer 不会 unmount，
    onUnmounted 不被触发，后端 pty 不会被 kill。
  -->
  <div ref="hostRef" class="terminal-host" aria-hidden="true">
    <template v-for="tab in terminalStore.tabs" :key="tab.id">
      <Teleport v-if="hostRef" :to="resolveTarget(tab.id)">
        <div class="terminal-host-instance">
          <TerminalContainer :tab-id="tab.id" />
        </div>
      </Teleport>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTerminalStore } from '@/stores/terminal'
import { useSplitLayoutStore, collectLeaves } from '@/stores/splitLayout'
import TerminalContainer from '../terminal/TerminalContainer.vue'

const terminalStore = useTerminalStore()
const splitLayout = useSplitLayoutStore()
const hostRef = ref<HTMLElement | null>(null)

/**
 * 终端 tabId → pane 挂载点 selector 映射
 *  - 仅收集 kind='terminal' 且 tabId 已填写的 leaf
 */
const paneSlotMap = computed(() => {
  const map = new Map<string, string>()
  for (const leaf of collectLeaves(splitLayout.root)) {
    if (leaf.content.kind === 'terminal' && leaf.content.tabId) {
      map.set(leaf.content.tabId, `#pane-terminal-mount-${leaf.id}`)
    }
  }
  return map
})

/**
 * 解析 Teleport 的 to 目标：
 *  - 命中 pane 挂载点（且该 DOM 节点存在）→ 返回 selector 字符串
 *  - 否则 → 返回 hostRef 元素，让 Teleport 把节点留在 host 内
 *
 * 始终返回有效值，避免 Vue Teleport 调用 document.querySelector('') 报错。
 */
function resolveTarget(tabId: string): string | HTMLElement {
  const sel = paneSlotMap.value.get(tabId)
  if (sel) {
    // 验证 selector 对应 DOM 节点已存在（pane 可能尚未渲染）
    const el = document.querySelector(sel)
    if (el) return sel
  }
  // 兜底：保留在 host 内（隐藏区域），TerminalContainer 不会 unmount
  return hostRef.value as HTMLElement
}
</script>

<style lang="scss" scoped>
.terminal-host {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  visibility: hidden;
  pointer-events: none;
}

.terminal-host-instance {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
</style>
