<template>
  <div class="orchestration-canvas">
    <!-- 工具栏 -->
    <div class="orchestration-toolbar">
      <button
        class="toolbar-btn"
        :class="{ active: showMinimap }"
        @click="toggleMinimap"
        :title="t('orchestration.toggleMinimap')"
      >
        <MapIcon :size="16" />
        <span>{{ t('orchestration.minimap') }}</span>
      </button>
      <button
        class="toolbar-btn"
        @click="handleCreateNode"
        :title="t('orchestration.addNode')"
      >
        <Plus :size="16" />
        <span>{{ t('orchestration.addNode') }}</span>
      </button>
    </div>

    <!-- Vue Flow 画布 -->
    <div
      class="orchestration-flow-wrapper"
      @dblclick.self="handleCanvasDblClick"
    >
      <VueFlow
        v-model:nodes="flowNodes"
        :default-viewport="{ zoom: 1, x: 0, y: 0 }"
        :min-zoom="0.2"
        :max-zoom="4"
        :delete-key-code="null"
        fit-view-on-init
        @nodes-change="onNodesChange"
      >
        <template #node-task="nodeProps">
          <TaskNodeCard
            :id="nodeProps.id"
            :data="nodeProps.data"
            @remove="handleRemoveNode"
            @open-drawer="handleOpenDrawer"
            @update-draft="handleUpdateDraft"
          />
        </template>

        <Background v-if="showBackground" />
        <MiniMap v-if="showMinimap" pannable zoomable />
      </VueFlow>

      <!-- 空画布引导提示 -->
      <div v-if="taskNodes.length === 0" class="orchestration-empty-guide">
        <div class="empty-guide-icon">
          <Workflow :size="48" />
        </div>
        <h3>{{ t('orchestration.emptyTitle') }}</h3>
        <p>{{ t('orchestration.emptyDesc') }}</p>
        <button class="empty-guide-btn" @click="handleCreateFirstNode">
          <Plus :size="16" />
          {{ t('orchestration.createFirstNode') }}
        </button>
      </div>

      <!-- 节点抽屉 -->
      <NodeDrawer
        :session-id="drawerSessionId"
        @close="handleCloseDrawer"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, type Node as FlowNode } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { Background } from '@vue-flow/background'
import { Map as MapIcon, Workflow, Plus } from 'lucide-vue-next'
import { useOrchestrationCanvas } from '@/composables/useOrchestrationCanvas'
import TaskNodeCard from './TaskNodeCard.vue'
import NodeDrawer from './NodeDrawer.vue'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'

const { t } = useI18n()
const {
  showMinimap,
  toggleMinimap,
  taskNodes,
  createTaskNode,
  removeTaskNode,
  setDraft,
  updateNodePosition,
  reloadFromStorage,
} = useOrchestrationCanvas()

const showBackground = ref(true)

// ── 初始加载：从 localStorage 恢复节点 ──
reloadFromStorage()

// ── Vue Flow 节点同步 ──
// 将 composable 的 taskNodes 映射为 Vue Flow 的 Node[] 格式
const flowNodes = ref<FlowNode[]>(
  taskNodes.value.map(n => ({
    id: n.id,
    type: 'task',
    position: n.position,
    data: { sessionId: n.sessionId, draft: n.draft },
  })),
)

// composable → Vue Flow 双向同步
watch(
  taskNodes,
  (nodes) => {
    flowNodes.value = nodes.map(n => ({
      id: n.id,
      type: 'task',
      position: n.position,
      data: { sessionId: n.sessionId, draft: n.draft },
    }))
  },
  { deep: true },
)

// Vue Flow 位置变更 → composable
function onNodesChange(changes: any[]) {
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      updateNodePosition(change.id, { x: change.position.x, y: change.position.y })
    }
  }
}

// ── 创建节点 ──
function handleCreateNode() {
  // 随机偏移避免完全重叠
  const offsetX = Math.random() * 100
  const offsetY = Math.random() * 100
  createTaskNode({ x: 200 + offsetX, y: 150 + offsetY })
}

function handleCreateFirstNode() {
  createTaskNode({ x: 300, y: 200 })
}

// 画布空白双击创建节点
function handleCanvasDblClick(e: MouseEvent) {
  // 仅在直接双击画布背景时触发（不是节点内部）
  const target = e.target as HTMLElement
  if (target.classList.contains('vue-flow__pane') || target.classList.contains('orchestration-flow-wrapper')) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    createTaskNode({ x, y })
  }
}

// ── 删除节点 ──
function handleRemoveNode(nodeId: string) {
  removeTaskNode(nodeId)
}

// ── 草稿更新 ──
function handleUpdateDraft(nodeId: string, draft: string) {
  setDraft(nodeId, draft)
  // 同步到 flowNodes 的 data
  const node = flowNodes.value.find((n: any) => n.id === nodeId)
  if (node) (node as any).data = { ...(node as any).data, draft }
}

// ── 抽屉 ──
const drawerSessionId = ref('')

function handleOpenDrawer(nodeId: string) {
  const node = taskNodes.value.find(n => n.id === nodeId)
  if (node) {
    drawerSessionId.value = node.sessionId
  }
}

function handleCloseDrawer() {
  drawerSessionId.value = ''
}
</script>

<style lang="scss" scoped>
.orchestration-canvas {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--bg-secondary, #1a1a2e);
}

.orchestration-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--surface-border);
  background: var(--surface-glass);
  flex-shrink: 0;
  z-index: 10;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--surface-border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;

  &:hover {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }

  &.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }
}

.orchestration-flow-wrapper {
  flex: 1;
  min-height: 0;
  position: relative;
}

// Vue Flow 需要明确宽高
.orchestration-flow-wrapper :deep(.vue-flow) {
  width: 100%;
  height: 100%;
}

.orchestration-empty-guide {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
  pointer-events: none;
  z-index: 5;

  .empty-guide-icon {
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-lg);
    background: var(--surface-glass);
    border: 1px solid var(--surface-border);
    color: var(--accent-primary);
    margin-bottom: 8px;
  }

  h3 {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  p {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
    max-width: 260px;
    line-height: 1.5;
  }

  .empty-guide-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    margin-top: 6px;
    font-size: 13px;
    font-weight: 500;
    color: white;
    background: var(--accent-primary);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: all 0.15s ease;
    pointer-events: auto;
    font-family: inherit;

    &:hover {
      background: var(--accent-primary-hover);
      transform: scale(1.03);
      box-shadow: 0 0 12px var(--accent-primary-glow);
    }

    &:active {
      transform: scale(0.98);
    }
  }
}
</style>
