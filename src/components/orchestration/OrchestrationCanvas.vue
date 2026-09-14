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
        :disabled="isRunning"
        @click="handleCreateNode"
        :title="t('orchestration.addNode')"
      >
        <Plus :size="16" />
        <span>{{ t('orchestration.addNode') }}</span>
      </button>

      <!-- 运行控制 -->
      <div class="toolbar-spacer"></div>

      <!-- 运行 / 停止按钮 -->
      <button
        v-if="!isRunning"
        class="toolbar-btn run-btn"
        :disabled="!canRun"
        @click="handleRun"
        :title="t('orchestration.run')"
      >
        <PlayIcon :size="16" />
        <span>{{ t('orchestration.run') }}</span>
      </button>
      <button
        v-else
        class="toolbar-btn stop-btn"
        @click="handleStop"
        :title="t('orchestration.stop')"
      >
        <SquareIcon :size="14" />
        <span>{{ t('orchestration.stop') }}</span>
      </button>

      <!-- 进度条 -->
      <div v-if="isRunning || progress.completed > 0" class="toolbar-progress">
        <span class="progress-text">
          {{ progress.completed }} / {{ progress.total }}
        </span>
        <div class="progress-bar">
          <div
            class="progress-bar-fill"
            :style="{ width: progressPercent + '%' }"
          ></div>
        </div>
      </div>

      <!-- 空草稿提示 -->
      <Transition name="edge-error-fade">
        <div v-if="emptyDraftNodeIds.length > 0 && !isRunning" class="empty-draft-hint">
          {{ t('orchestration.emptyDraftHint') }}
        </div>
      </Transition>
    </div>

    <!-- Vue Flow 画布 -->
    <div
      class="orchestration-flow-wrapper"
      @dblclick.self="handleCanvasDblClick"
    >
      <VueFlow
        v-model:nodes="flowNodes"
        v-model:edges="flowEdges"
        :default-viewport="{ zoom: 1, x: 0, y: 0 }"
        :min-zoom="0.2"
        :max-zoom="4"
        :delete-key-code="isRunning ? [] : ['Backspace', 'Delete']"
        :nodes-draggable="!isRunning"
        :edges-updatable="!isRunning"
        fit-view-on-init
        @nodes-change="onNodesChange"
        @edges-change="onEdgesChange"
        @connect="onConnect"
      >
        <template #node-task="nodeProps">
          <TaskNodeCard
            :id="nodeProps.id"
            :data="nodeProps.data"
            :status="getNodeStatus(nodeProps.id)"
            :is-running="isRunning"
            :is-empty-draft="emptyDraftNodeIds.includes(nodeProps.id)"
            :has-pending-permission="hasPendingPermissionForNode(nodeProps.id)"
            @remove="handleRemoveNode"
            @open-drawer="handleOpenDrawer"
            @update-draft="handleUpdateDraft"
            @stop-node="handleStopNode"
            @retry-node="handleRetryNode"
            @add-message="handleAddMessage"
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

      <!-- 环预防 / 自环提示 toast -->
      <Transition name="edge-error-fade">
        <div v-if="edgeErrorVisible" class="edge-error-toast">
          {{ edgeError }}
        </div>
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { VueFlow, type Node as FlowNode, type Edge as FlowEdge, type Connection, MarkerType } from '@vue-flow/core'
import { MiniMap } from '@vue-flow/minimap'
import { Background } from '@vue-flow/background'
import { Map as MapIcon, Workflow, Plus, Play as PlayIcon, Square as SquareIcon } from 'lucide-vue-next'
import { useOrchestrationCanvas } from '@/composables/useOrchestrationCanvas'
import { useOrchestrationRun } from '@/composables/useOrchestrationRun'
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
  edges,
  createTaskNode,
  removeTaskNode,
  setDraft,
  updateNodePosition,
  createEdge,
  removeEdge,
  canCreateEdge,
  reloadFromStorage,
} = useOrchestrationCanvas()

const {
  isRunning,
  canRun,
  emptyDraftNodeIds,
  progress,
  getNodeStatus,
  startRun,
  stopRun,
  stopNode,
  retryNode,
  addNodeMessage,
  hasPendingPermissionForNode,
} = useOrchestrationRun()

const showBackground = ref(true)

// ── 初始加载 ──
reloadFromStorage()

// ── Vue Flow 节点同步 ──
const flowNodes = ref<FlowNode[]>(
  taskNodes.value.map(n => ({
    id: n.id,
    type: 'task',
    position: n.position,
    data: { sessionId: n.sessionId, draft: n.draft },
  })),
)

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

// ── Vue Flow Edge 同步 ──
const flowEdges = ref<FlowEdge[]>(
  edges.value.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    markerEnd: MarkerType.ArrowClosed,
  })),
)

watch(
  edges,
  (eds) => {
    flowEdges.value = eds.map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      markerEnd: MarkerType.ArrowClosed,
    }))
  },
  { deep: true },
)

// Vue Flow 位置变更 → composable
function onNodesChange(changes: any[]) {
  if (isRunning.value) return // 运行中锁结构
  for (const change of changes) {
    if (change.type === 'position' && change.position) {
      updateNodePosition(change.id, { x: change.position.x, y: change.position.y })
    }
  }
}

// ── Edge 事件处理 ──

function onConnect(connection: Connection) {
  if (isRunning.value) return // 运行中锁结构
  const { source, target } = connection
  if (source === target) {
    edgeError.value = t('orchestration.selfLoopDetected')
    showEdgeError()
    return
  }
  if (!canCreateEdge(source, target)) {
    edgeError.value = t('orchestration.cycleDetected')
    showEdgeError()
    return
  }
  createEdge(source, target)
}

function onEdgesChange(changes: any[]) {
  if (isRunning.value) return // 运行中锁结构
  for (const change of changes) {
    if (change.type === 'remove') {
      removeEdge(change.id)
    }
  }
}

// ── 环预防提示 toast ──
const edgeError = ref('')
const edgeErrorVisible = ref(false)
let edgeErrorTimer: ReturnType<typeof setTimeout> | null = null

function showEdgeError() {
  edgeErrorVisible.value = true
  if (edgeErrorTimer) clearTimeout(edgeErrorTimer)
  edgeErrorTimer = setTimeout(() => {
    edgeErrorVisible.value = false
  }, 3000)
}

// ── 进度百分比 ──
const progressPercent = computed(() => {
  if (progress.value.total === 0) return 0
  return Math.round((progress.value.completed / progress.value.total) * 100)
})

// ── 创建节点 ──
function handleCreateNode() {
  if (isRunning.value) return
  const offsetX = Math.random() * 100
  const offsetY = Math.random() * 100
  createTaskNode({ x: 200 + offsetX, y: 150 + offsetY })
}

function handleCreateFirstNode() {
  createTaskNode({ x: 300, y: 200 })
}

function handleCanvasDblClick(e: MouseEvent) {
  if (isRunning.value) return
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
  if (isRunning.value) return
  removeTaskNode(nodeId)
}

// ── 草稿更新 ──
function handleUpdateDraft(nodeId: string, draft: string) {
  setDraft(nodeId, draft)
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

// ── 运行控制 ──
async function handleRun() {
  if (!canRun.value || isRunning.value) return
  await startRun()
}

async function handleStop() {
  await stopRun()
}

// ── 单节点停止 ──
async function handleStopNode(nodeId: string) {
  await stopNode(nodeId)
}

// ── 失败节点重试 ──
async function handleRetryNode(nodeId: string) {
  await retryNode(nodeId)
}

// ── 运行中节点追加消息 ──
function handleAddMessage(nodeId: string, content: string) {
  addNodeMessage(nodeId, content)
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

  &:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--surface-glass-hover);
  }

  &.active {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
    background: color-mix(in srgb, var(--accent-primary) 10%, transparent);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &.run-btn {
    color: #fff;
    background: #22c55e;
    border-color: #22c55e;

    &:hover:not(:disabled) {
      background: #16a34a;
    }
  }

  &.stop-btn {
    color: #fff;
    background: var(--danger, #ef4444);
    border-color: var(--danger, #ef4444);

    &:hover {
      background: #dc2626;
    }
  }
}

.toolbar-spacer {
  flex: 1;
}

.toolbar-progress {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;

  .progress-text {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .progress-bar {
    width: 80px;
    height: 6px;
    background: var(--surface-border);
    border-radius: 3px;
    overflow: hidden;

    .progress-bar-fill {
      height: 100%;
      background: var(--accent-primary, #6366f1);
      border-radius: 3px;
      transition: width 0.3s ease;
    }
  }
}

.empty-draft-hint {
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--danger, #ef4444);
  white-space: nowrap;
}

.orchestration-flow-wrapper {
  flex: 1;
  min-height: 0;
  position: relative;
}

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

// ── Edge error toast ──
.edge-error-toast {
  position: absolute;
  top: 50px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 500;
  color: #fff;
  background: var(--danger, #ef4444);
  border-radius: var(--radius-md, 8px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 50;
  pointer-events: none;
  white-space: nowrap;
}

.edge-error-fade-enter-active,
.edge-error-fade-leave-active {
  transition: all 0.3s ease;
}

.edge-error-fade-enter-from,
.edge-error-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(-10px);
}
</style>
