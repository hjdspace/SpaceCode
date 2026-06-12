<template>
  <div class="workflow-editor">
    <!-- Toolbar -->
    <div class="workflow-toolbar">
      <button class="btn btn-secondary" @click="createNewWorkflow">
        <Plus :size="14" />
        {{ t('agents.newWorkflow') }}
      </button>
    </div>

    <!-- Workflow List (when no workflow is selected) -->
    <div v-if="!currentWorkflow" class="workflow-list">
      <div v-for="wf in workflows" :key="wf.id" class="workflow-card">
        <div class="wf-info">
          <h4 class="wf-name">{{ wf.name }}</h4>
          <p class="wf-desc">{{ wf.description || t('agents.noDescription') }}</p>
          <span class="wf-meta">{{ wf.nodes.length }} 个节点 · {{ formatDate(wf.updatedAt) }}</span>
        </div>
        <div class="wf-actions">
          <button class="btn btn-ghost" @click="editWorkflow(wf)">
            <Pencil :size="14" />
          </button>
          <button class="btn btn-primary-sm" @click="runWorkflow(wf)">
            <Play :size="14" />
            {{ t('agents.run') }}
          </button>
          <button class="btn btn-ghost" @click="exportWorkflow(wf)">
            <Download :size="14" />
          </button>
          <button class="btn btn-danger-ghost" @click="deleteWorkflow(wf.id)">
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
      <div v-if="workflows.length === 0" class="empty-state">
        <Workflow :size="32" class="empty-icon" />
        <p>{{ t('agents.noWorkflows') }}</p>
        <button class="btn btn-primary" @click="createNewWorkflow">
          <Plus :size="14" />
          {{ t('agents.createWorkflow') }}
        </button>
      </div>
    </div>

    <!-- Canvas Editor (when a workflow is selected) -->
    <div v-else class="workflow-canvas-container">
      <!-- Header bar -->
      <div class="canvas-header">
        <button class="back-btn" @click="currentWorkflow = null">
          <ArrowLeft :size="16" />
        </button>
        <input v-model="currentWorkflow.name" class="wf-title-input" />
        <div class="canvas-actions">
          <button class="btn btn-secondary" @click="saveCurrentWorkflow">
            <Save :size="14" />
            {{ t('agents.save') }}
          </button>
        </div>
      </div>

      <div class="canvas-main">
        <!-- Left: Node palette -->
        <div class="node-sidebar">
          <h4 class="sidebar-title">组件</h4>
          <div class="node-type-list">
            <div
              v-for="nt in nodeTypes"
              :key="nt.type"
              class="node-type-item"
              draggable="true"
              @dragstart="handleDragStart(nt.type, $event)"
            >
              <div class="node-type-icon" :class="`icon-${nt.type}`">
                <component :is="nt.icon" :size="16" />
              </div>
              <div class="node-type-info">
                <span class="node-type-label">{{ nt.label }}</span>
                <span class="node-type-desc">{{ nt.desc }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Center: Canvas -->
        <div class="canvas-body" ref="canvasRef" @drop="handleDrop" @dragover.prevent @click="handleCanvasClick">
          <svg class="edges-layer">
            <defs>
              <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                <polygon points="0 0, 8 3, 0 6" fill="var(--text-muted)" />
              </marker>
            </defs>
            <!-- Existing edges -->
            <line
              v-for="edge in currentWorkflow.edges"
              :key="edge.id"
              :x1="getNodePort(edge.source, 'out').x"
              :y1="getNodePort(edge.source, 'out').y"
              :x2="getNodePort(edge.target, 'in').x"
              :y2="getNodePort(edge.target, 'in').y"
              stroke="var(--text-muted)"
              stroke-width="1.5"
              marker-end="url(#arrowhead)"
              class="edge-line"
              @click.stop="removeEdge(edge.id)"
            />
            <!-- Temp edge while connecting -->
            <line
              v-if="tempEdge"
              :x1="tempEdge.x1"
              :y1="tempEdge.y1"
              :x2="tempEdge.x2"
              :y2="tempEdge.y2"
              stroke="var(--accent-primary)"
              stroke-width="1.5"
              stroke-dasharray="4 4"
            />
          </svg>

          <div
            v-for="node in currentWorkflow.nodes"
            :key="node.id"
            :ref="el => setNodeEl(node.id, el)"
            :data-node-id="node.id"
            class="workflow-node"
            :class="[`node-${node.type}`, { selected: selectedNodeId === node.id }]"
            :style="{ left: node.position.x + 'px', top: node.position.y + 'px' }"
            @mousedown.stop="startDrag(node, $event)"
            @click.stop="selectNode(node.id)"
            @contextmenu.prevent="showNodeMenu($event, node.id)"
          >
            <!-- Input port -->
            <div class="node-port port-in" @mousedown.stop="startConnect(node.id, 'in', $event)"></div>
            <!-- Output port -->
            <div class="node-port port-out" @mousedown.stop="startConnect(node.id, 'out', $event)"></div>
            <div class="node-header">
              <component :is="getNodeIcon(node.type)" :size="12" />
              <span class="node-label">{{ getNodeLabel(node) }}</span>
              <button class="node-delete-btn" @click.stop="removeNode(node.id)" title="删除节点">
                <X :size="10" />
              </button>
            </div>
            <div v-if="node.type === 'agent'" class="node-body">
              {{ node.data.agentName || '未选择 Agent' }}
            </div>
            <div v-else-if="node.type === 'condition'" class="node-body">
              {{ node.data.condition || '未设置条件' }}
            </div>
            <div v-else-if="node.type === 'merge'" class="node-body">
              {{ node.data.strategy === 'summarize' ? 'LLM 总结' : '直接拼接' }}
            </div>
          </div>
        </div>

        <!-- Right: Properties panel -->
        <div class="properties-panel" :class="{ visible: selectedNode }">
          <template v-if="selectedNode">
            <div class="panel-header">
              <h4 class="panel-title">{{ getNodeLabel(selectedNode) }} 属性</h4>
              <button class="panel-close" @click="selectedNodeId = null">
                <X :size="14" />
              </button>
            </div>
            <div class="panel-body">
              <!-- Common: label -->
              <div class="prop-group">
                <label class="prop-label">显示名称</label>
                <input v-model="selectedNode.data.label" class="prop-input" placeholder="自定义名称" />
              </div>

              <!-- Agent node -->
              <div v-if="selectedNode.type === 'agent'" class="prop-group">
                <label class="prop-label">Agent</label>
                <select v-model="selectedNode.data.agentName" class="prop-select">
                  <option value="">选择 Agent</option>
                  <option v-for="a in agentsStore.libraryAgents" :key="a.name" :value="a.name">{{ a.name }}</option>
                </select>
                <label class="prop-label">输入模板</label>
                <textarea v-model="selectedNode.data.inputTemplate" class="prop-textarea" rows="3"
                  placeholder="可用变量：{{prevOutput}}, {{input}}" />
              </div>

              <!-- Condition node -->
              <div v-else-if="selectedNode.type === 'condition'" class="prop-group">
                <label class="prop-label">条件描述</label>
                <textarea v-model="selectedNode.data.condition" class="prop-textarea" rows="3"
                  placeholder="自然语言条件描述，由 LLM 判断" />
                <div class="prop-hint">条件为真走下方第一个出口，为假走第二个出口</div>
              </div>

              <!-- Merge node -->
              <div v-else-if="selectedNode.type === 'merge'" class="prop-group">
                <label class="prop-label">合并策略</label>
                <select v-model="selectedNode.data.strategy" class="prop-select">
                  <option value="concat">直接拼接</option>
                  <option value="summarize">LLM 总结</option>
                </select>
                <label v-if="selectedNode.data.strategy === 'summarize'" class="prop-label">总结提示词</label>
                <textarea
                  v-if="selectedNode.data.strategy === 'summarize'"
                  v-model="selectedNode.data.prompt"
                  class="prop-textarea" rows="2"
                  placeholder="总结时的提示词（可选）"
                />
              </div>

              <!-- Delete -->
              <div class="prop-group prop-actions">
                <button class="btn btn-danger-ghost" @click="removeNode(selectedNode.id)">
                  <Trash2 :size="12" /> 删除此节点
                </button>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="panel-empty">
              <MousePointer :size="20" />
              <p>点击节点查看属性</p>
              <p class="panel-hint">拖拽左侧组件到画布添加节点，从节点的连接点拖到另一个节点即可连线</p>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Context menu -->
    <div
      v-if="contextMenu.visible"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <button class="menu-item" @click="removeNode(contextMenu.nodeId!); contextMenu.visible = false">
        <Trash2 :size="12" /> 删除节点
      </button>
    </div>

    <!-- Workflow Runner Modal -->
    <WorkflowRunner
      v-if="runningWorkflow"
      :workflow="runningWorkflow"
      @close="runningWorkflow = null"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Plus, Pencil, Play, Download, Trash2, ArrowLeft, Save, X, MousePointer,
  Bot, GitBranch, Merge, LogIn, LogOut, Workflow
} from 'lucide-vue-next'
import { useAgentsStore } from '@/stores/agents'
import { useAppStore } from '@/stores/app'
import WorkflowRunner from './WorkflowRunner.vue'

const { t } = useI18n()
const agentsStore = useAgentsStore()
const appStore = useAppStore()
const electronAPI = (window as any).electronAPI

interface WorkflowNode {
  id: string
  type: 'agent' | 'condition' | 'merge' | 'input' | 'output'
  position: { x: number; y: number }
  data: Record<string, any>
}

interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourcePort?: 'true' | 'false' | 'default'
}

interface WorkflowDef {
  id: string
  name: string
  description?: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  createdAt: string
  updatedAt: string
}

const workflows = ref<WorkflowDef[]>([])
const currentWorkflow = ref<WorkflowDef | null>(null)
const selectedNodeId = ref<string | null>(null)
const runningWorkflow = ref<WorkflowDef | null>(null)
const canvasRef = ref<HTMLElement | null>(null)
const connectFrom = ref<{ nodeId: string; port: string } | null>(null)
const tempEdge = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
let connectOnMove: ((e: MouseEvent) => void) | null = null
let connectOnUp: ((e: MouseEvent) => void) | null = null
const contextMenu = reactive({ visible: false, x: 0, y: 0, nodeId: null as string | null })

const selectedNode = computed(() => {
  if (!currentWorkflow.value || !selectedNodeId.value) return null
  return currentWorkflow.value.nodes.find(n => n.id === selectedNodeId.value) || null
})

const nodeTypes = [
  { type: 'input', label: '输入', desc: '工作流入口', icon: LogIn },
  { type: 'agent', label: 'Agent', desc: '执行 AI Agent', icon: Bot },
  { type: 'condition', label: '条件', desc: '条件分支判断', icon: GitBranch },
  { type: 'merge', label: '聚合', desc: '合并多个分支', icon: Merge },
  { type: 'output', label: '输出', desc: '工作流出口', icon: LogOut },
]

let dragNodeType = ''
let dragNode: WorkflowNode | null = null
let dragOffset = { x: 0, y: 0 }
let dragOnMove: ((e: MouseEvent) => void) | null = null
let dragOnUp: (() => void) | null = null

function getNodeIcon(type: string) {
  const map: Record<string, any> = { input: LogIn, agent: Bot, condition: GitBranch, merge: Merge, output: LogOut }
  return map[type] || Bot
}

function getNodeLabel(node: WorkflowNode) {
  const labels: Record<string, string> = { input: '输入', agent: 'Agent', condition: '条件', merge: '聚合', output: '输出' }
  return node.data?.label || labels[node.type] || node.type
}

const nodeSizes = reactive<Record<string, { w: number; h: number }>>({})

function setNodeEl(nodeId: string, el: any) {
  if (!el) return
  nodeSizes[nodeId] = { w: el.offsetWidth, h: el.offsetHeight }
}

function getNodePort(nodeId: string, port: 'in' | 'out') {
  const node = currentWorkflow.value?.nodes.find(n => n.id === nodeId)
  if (!node) return { x: 0, y: 0 }
  const size = nodeSizes[nodeId] || { w: 140, h: 70 }
  const cx = node.position.x + size.w / 2
  if (port === 'in') return { x: cx, y: node.position.y }
  return { x: cx, y: node.position.y + size.h }
}

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前'
  return d.toLocaleDateString()
}

function selectNode(nodeId: string) {
  selectedNodeId.value = nodeId
  contextMenu.visible = false
}

function handleCanvasClick() {
  selectedNodeId.value = null
  contextMenu.visible = false
}

function handleDragStart(type: string, event: DragEvent) {
  dragNodeType = type
  event.dataTransfer?.setData('text/plain', type)
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  if (!currentWorkflow.value || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const id = `node-${Date.now()}`
  const data: Record<string, any> = {}
  if (dragNodeType === 'merge') data.strategy = 'concat'
  if (dragNodeType === 'agent') data.agentName = ''
  currentWorkflow.value.nodes.push({ id, type: dragNodeType as any, position: { x, y }, data })
}

function startDrag(node: WorkflowNode, event: MouseEvent) {
  // 清理上一次可能残留的监听器
  if (dragOnMove) window.removeEventListener('mousemove', dragOnMove)
  if (dragOnUp) window.removeEventListener('mouseup', dragOnUp)
  dragNode = node
  dragOffset = { x: event.clientX - node.position.x, y: event.clientY - node.position.y }
  dragOnMove = (e: MouseEvent) => {
    if (!dragNode) return
    dragNode.position.x = Math.max(0, e.clientX - dragOffset.x)
    dragNode.position.y = Math.max(0, e.clientY - dragOffset.y)
  }
  dragOnUp = () => {
    dragNode = null
    window.removeEventListener('mousemove', dragOnMove!)
    window.removeEventListener('mouseup', dragOnUp!)
    dragOnMove = null
    dragOnUp = null
  }
  window.addEventListener('mousemove', dragOnMove)
  window.addEventListener('mouseup', dragOnUp)
}

function startConnect(nodeId: string, port: string, _event: MouseEvent) {
  // 清理上一次可能残留的监听器
  if (connectOnMove) window.removeEventListener('mousemove', connectOnMove)
  if (connectOnUp) window.removeEventListener('mouseup', connectOnUp)
  connectFrom.value = { nodeId, port }
  const nodePort = getNodePort(nodeId, port as 'in' | 'out')
  tempEdge.value = { x1: nodePort.x, y1: nodePort.y, x2: nodePort.x, y2: nodePort.y }

  connectOnMove = (e: MouseEvent) => {
    if (!tempEdge.value || !canvasRef.value) return
    const rect = canvasRef.value.getBoundingClientRect()
    tempEdge.value.x2 = e.clientX - rect.left
    tempEdge.value.y2 = e.clientY - rect.top
  }
  connectOnUp = (e: MouseEvent) => {
    window.removeEventListener('mousemove', connectOnMove!)
    window.removeEventListener('mouseup', connectOnUp!)
    connectOnMove = null
    connectOnUp = null
    tempEdge.value = null
    // 落点所在节点：通过 DOM 命中识别（端口或节点主体都可）
    if (connectFrom.value && currentWorkflow.value) {
      const el = (e.target as HTMLElement)?.closest('[data-node-id]') as HTMLElement | null
      const targetId = el?.dataset.nodeId
      if (targetId && targetId !== connectFrom.value.nodeId) {
        const sourceId = connectFrom.value.nodeId
        const exists = currentWorkflow.value.edges.some(ed => ed.source === sourceId && ed.target === targetId)
        if (!exists) {
          currentWorkflow.value.edges.push({
            id: `edge-${Date.now()}`,
            source: sourceId,
            target: targetId,
          })
        }
      }
    }
    connectFrom.value = null
  }
  window.addEventListener('mousemove', connectOnMove)
  window.addEventListener('mouseup', connectOnUp)
}

function removeNode(nodeId: string) {
  if (!currentWorkflow.value) return
  currentWorkflow.value.nodes = currentWorkflow.value.nodes.filter(n => n.id !== nodeId)
  currentWorkflow.value.edges = currentWorkflow.value.edges.filter(e => e.source !== nodeId && e.target !== nodeId)
  if (selectedNodeId.value === nodeId) selectedNodeId.value = null
}

function removeEdge(edgeId: string) {
  if (!currentWorkflow.value) return
  currentWorkflow.value.edges = currentWorkflow.value.edges.filter(e => e.id !== edgeId)
}

function showNodeMenu(event: MouseEvent, nodeId: string) {
  contextMenu.visible = true
  contextMenu.x = event.clientX
  contextMenu.y = event.clientY
  contextMenu.nodeId = nodeId
}

function createNewWorkflow() {
  const id = `wf-${Date.now()}`
  currentWorkflow.value = {
    id,
    name: '新编排',
    nodes: [
      { id: 'node-input', type: 'input', position: { x: 80, y: 150 }, data: {} },
      { id: 'node-output', type: 'output', position: { x: 600, y: 150 }, data: {} },
    ],
    edges: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function editWorkflow(wf: WorkflowDef) {
  currentWorkflow.value = JSON.parse(JSON.stringify(wf))
}

function runWorkflow(wf: WorkflowDef) {
  runningWorkflow.value = wf
}

async function saveCurrentWorkflow() {
  if (!currentWorkflow.value) return
  try {
    await electronAPI?.agents?.saveWorkflow(currentWorkflow.value)
    await loadWorkflows()
  } catch (err) {
    console.error('Failed to save workflow:', err)
  }
}

async function deleteWorkflow(id: string) {
  if (!confirm(t('agents.deleteWorkflowConfirm'))) return
  try {
    await electronAPI?.agents?.deleteWorkflow(id)
    await loadWorkflows()
  } catch (err) {
    console.error('Failed to delete workflow:', err)
  }
}

async function exportWorkflow(wf: WorkflowDef) {
  const scope = confirm('导出到全局目录？(取消则导出到项目目录)') ? 'global' : 'project'
  const cwd = appStore.projectRoot || undefined
  try {
    const result = await electronAPI?.agents?.exportWorkflow(wf.id, scope, cwd)
    if (result) alert(`已导出到 ${result.path}`)
  } catch (err) {
    console.error('Failed to export workflow:', err)
  }
}

async function loadWorkflows() {
  try {
    const data = await electronAPI?.agents?.listWorkflows()
    workflows.value = data?.workflows || []
  } catch (err) {
    console.error('Failed to load workflows:', err)
  }
}

onMounted(() => {
  loadWorkflows()
  const cwd = appStore.projectRoot || undefined
  agentsStore.fetchLibrary(cwd)
})

onUnmounted(() => {
  if (dragOnMove) window.removeEventListener('mousemove', dragOnMove)
  if (dragOnUp) window.removeEventListener('mouseup', dragOnUp)
  if (connectOnMove) window.removeEventListener('mousemove', connectOnMove)
  if (connectOnUp) window.removeEventListener('mouseup', connectOnUp)
})
</script>

<style lang="scss" scoped>
.workflow-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.workflow-toolbar {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.workflow-list {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.workflow-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--bg-secondary);
}

.wf-info { flex: 1; min-width: 0; }
.wf-name { font-size: var(--font-size-base); font-weight: 600; color: var(--text-primary); margin: 0 0 4px; }
.wf-desc { font-size: 12px; color: var(--text-muted); margin: 0 0 4px; }
.wf-meta { font-size: 11px; color: var(--text-muted); }

.wf-actions { display: flex; gap: 6px; flex-shrink: 0; }

.workflow-canvas-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.canvas-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
  background: var(--bg-secondary);
}

.back-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: var(--radius-sm); border: none;
  background: transparent; color: var(--text-muted); cursor: pointer;
  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.wf-title-input {
  flex: 1; border: none; background: transparent; font-size: var(--font-size-base);
  font-weight: 600; color: var(--text-primary);
  &:focus { outline: none; }
}

.canvas-actions { display: flex; gap: 6px; }

.canvas-main {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

// Left sidebar: node palette
.node-sidebar {
  width: 200px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-default);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.sidebar-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted);
  margin: 0;
  padding: 12px 14px 8px;
}

.node-type-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 8px 12px;
}

.node-type-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-default);
  background: var(--bg-primary);
  cursor: grab;
  transition: all var(--transition-fast);
  &:hover { border-color: var(--accent-primary); background: var(--bg-hover); }
  &:active { cursor: grabbing; }
}

.node-type-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &.icon-input { background: rgba(16, 185, 129, 0.12); color: #10b981; }
  &.icon-agent { background: rgba(59, 130, 246, 0.12); color: #3b82f6; }
  &.icon-condition { background: rgba(245, 158, 11, 0.12); color: #f59e0b; }
  &.icon-merge { background: rgba(139, 92, 246, 0.12); color: #8b5cf6; }
  &.icon-output { background: rgba(107, 114, 128, 0.12); color: #6b7280; }
}

.node-type-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.node-type-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.node-type-desc {
  font-size: 10px;
  color: var(--text-muted);
  line-height: 1.3;
}

// Center: Canvas
.canvas-body {
  flex: 1;
  position: relative;
  overflow: auto;
  background: var(--bg-primary);
  background-image: radial-gradient(circle, var(--border-default) 1px, transparent 1px);
  background-size: 20px 20px;
  min-height: 0;
}

.edges-layer {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
}

.edge-line {
  pointer-events: stroke;
  cursor: pointer;
  &:hover { stroke: #ef4444; stroke-width: 2.5; }
}

.workflow-node {
  position: absolute;
  min-width: 140px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--bg-secondary);
  cursor: grab;
  user-select: none;
  transition: box-shadow 0.15s;
  z-index: 1;

  &:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  &.selected { border-color: var(--accent-primary); box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2); z-index: 2; }

  &.node-input { border-left: 3px solid #10b981; }
  &.node-output { border-left: 3px solid #6b7280; }
  &.node-agent { border-left: 3px solid #3b82f6; }
  &.node-condition { border-left: 3px solid #f59e0b; }
  &.node-merge { border-left: 3px solid #8b5cf6; }
}

.node-port {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--bg-tertiary);
  border: 2px solid var(--border-default);
  z-index: 3;
  cursor: crosshair;
  transition: background 0.15s, border-color 0.15s, transform 0.15s;

  &:hover {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
    transform: scale(1.3);
  }
}

.port-in {
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  &:hover { transform: translateX(-50%) scale(1.3); }
}

.port-out {
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  &:hover { transform: translateX(-50%) scale(1.3); }
}

.node-header {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px; font-size: 11px; font-weight: 600;
  color: var(--text-secondary); border-bottom: 1px solid var(--border-default);
}

.node-label { flex: 1; }

.node-delete-btn {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 3px; border: none;
  background: transparent; color: var(--text-muted); cursor: pointer;
  opacity: 0; transition: all var(--transition-fast);
  &:hover { background: rgba(239, 68, 68, 0.12); color: #ef4444; }
  .workflow-node:hover & { opacity: 1; }
}

.node-body {
  padding: 6px 10px; font-size: 11px; color: var(--text-muted);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// Right: Properties panel
.properties-panel {
  width: 260px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-default);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  transition: width 0.2s;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-default);
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.5px; color: var(--text-muted); margin: 0;
}

.panel-close {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px; border-radius: var(--radius-xs); border: none;
  background: transparent; color: var(--text-muted); cursor: pointer;
  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.panel-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.panel-empty {
  padding: 40px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--text-muted);
  text-align: center;
  font-size: 12px;
  p { margin: 0; }
}

.prop-group { display: flex; flex-direction: column; gap: 6px; }
.prop-label { font-size: 11px; font-weight: 500; color: var(--text-muted); }
.prop-input, .prop-select, .prop-textarea {
  width: 100%; padding: 6px 8px; border-radius: var(--radius-xs);
  border: 1px solid var(--border-default); background: var(--bg-primary);
  color: var(--text-primary); font-size: 12px;
  &:focus { outline: none; border-color: var(--accent-primary); }
}
.prop-textarea { resize: vertical; font-family: inherit; }
.prop-hint { font-size: 10px; color: var(--text-muted); line-height: 1.4; }
.prop-actions { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border-default); }

// Context menu
.context-menu {
  position: fixed;
  z-index: 100;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  padding: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  min-width: 140px;
}

.menu-item {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 8px 12px; border: none; border-radius: var(--radius-xs);
  background: transparent; color: #ef4444; font-size: 12px; cursor: pointer;
  &:hover { background: rgba(239, 68, 68, 0.08); }
}

.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: var(--radius-sm); font-size: 12px;
  font-weight: 500; border: none; cursor: pointer; transition: all var(--transition-fast);

  &.btn-primary { background: var(--accent-primary); color: white; &:hover { background: var(--accent-primary-hover); } }
  &.btn-primary-sm { background: var(--accent-primary); color: white; padding: 4px 10px; &:hover { background: var(--accent-primary-hover); } }
  &.btn-secondary {
    background: var(--bg-secondary); border: 1px solid var(--border-default); color: var(--text-primary);
    &:hover { border-color: var(--accent-primary); }
    &.active { border-color: var(--accent-primary); color: var(--accent-primary); background: rgba(59, 130, 246, 0.08); }
  }
  &.btn-ghost { background: transparent; color: var(--text-muted); &:hover { background: var(--bg-hover); color: var(--text-primary); } }
  &.btn-danger-ghost { background: transparent; color: var(--text-muted); &:hover { background: rgba(239,68,68,0.08); color: #ef4444; } }
  &.btn-sm { padding: 4px 8px; font-size: 11px; }
}

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 40px; color: var(--text-muted); font-size: 13px;
}
.empty-icon { opacity: 0.3; }
</style>
