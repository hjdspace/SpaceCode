<template>
  <div class="workflow-runner-overlay" @click.self="$emit('close')">
    <div class="workflow-runner">
      <div class="runner-header">
        <h3>{{ t('agents.runWorkflow') }}: {{ workflow.name }}</h3>
        <button class="close-btn" @click="$emit('close')">
          <X :size="16" />
        </button>
      </div>

      <div v-if="!isRunning && !isComplete" class="runner-input">
        <label class="input-label">{{ t('agents.inputPrompt') }}</label>
        <textarea v-model="inputPrompt" class="input-textarea" rows="4"
          :placeholder="t('agents.inputPlaceholder')" />
        <button class="btn btn-primary" @click="startExecution">
          <Play :size="14" />
          {{ t('agents.startExecution') }}
        </button>
      </div>

      <div class="runner-status">
        <div v-for="node in executionNodes" :key="node.id" class="exec-node" :class="`status-${node.status}`">
          <div class="exec-icon">
            <Loader2 v-if="node.status === 'running'" :size="14" class="spin" />
            <CheckCircle v-else-if="node.status === 'done'" :size="14" />
            <XCircle v-else-if="node.status === 'error'" :size="14" />
            <Circle v-else :size="14" />
          </div>
          <div class="exec-info">
            <span class="exec-label">{{ node.label }}</span>
            <span v-if="node.duration" class="exec-duration">{{ node.duration }}s</span>
          </div>
          <div v-if="node.output" class="exec-output">
            <pre>{{ truncatedOutput(node.output) }}</pre>
          </div>
        </div>
      </div>

      <div v-if="isRunning" class="runner-footer">
        <button class="btn btn-danger" @click="stopExecution">
          <Square :size="14" />
          {{ t('agents.stop') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { X, Play, Square, Loader2, CheckCircle, XCircle, Circle } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'

const { t } = useI18n()
const appStore = useAppStore()
const electronAPI = (window as any).electronAPI

interface WorkflowDef {
  id: string
  name: string
  nodes: any[]
  edges: any[]
}

const props = defineProps<{ workflow: WorkflowDef }>()
defineEmits<{ close: [] }>()

const inputPrompt = ref('')
const isRunning = ref(false)
const isComplete = ref(false)

interface ExecNode {
  id: string
  label: string
  status: 'pending' | 'running' | 'done' | 'error'
  output?: string
  duration?: number
}

const executionNodes = ref<ExecNode[]>([])

function truncatedOutput(output: string) {
  return output.length > 500 ? output.slice(0, 500) + '...' : output
}

async function startExecution() {
  isRunning.value = true
  isComplete.value = false

  // Build execution order from workflow topology
  const agentNodes = props.workflow.nodes
    .filter((n: any) => n.type === 'agent' || n.type === 'input' || n.type === 'output')
    .sort((a: any, b: any) => a.position.x - b.position.x)

  executionNodes.value = agentNodes.map((n: any) => ({
    id: n.id,
    label: n.data?.agentName || n.data?.label || n.type,
    status: 'pending' as const,
  }))

  let prevOutput = inputPrompt.value

  for (let i = 0; i < executionNodes.value.length; i++) {
    const execNode = executionNodes.value[i]
    const wfNode = agentNodes[i]

    if (wfNode.type === 'input') {
      execNode.status = 'done'
      execNode.output = inputPrompt.value
      continue
    }

    if (wfNode.type === 'output') {
      execNode.status = 'done'
      execNode.output = prevOutput
      continue
    }

    // Agent node — execute via Claude Code session
    execNode.status = 'running'
    const startTime = Date.now()

    try {
      const sessionId = `wf-${props.workflow.id}-${Date.now()}`
      const cwd = appStore.projectRoot || undefined

      // Start a session with the agent
      await electronAPI?.claudeCode?.startSession(sessionId, {
        cwd,
        agentType: wfNode.data?.agentName,
      })

      // Send the input
      const inputTemplate = wfNode.data?.inputTemplate || '{{input}}'
      const renderedInput = inputTemplate.replace(/\{\{prevOutput\}\}/g, prevOutput).replace(/\{\{input\}\}/g, inputPrompt.value)

      await electronAPI?.claudeCode?.sendMessage(sessionId, renderedInput)

      // Mark as done
      execNode.status = 'done'
      execNode.duration = Math.round((Date.now() - startTime) / 1000)
      execNode.output = `Agent ${wfNode.data?.agentName} executed successfully`
      prevOutput = execNode.output
    } catch (err) {
      execNode.status = 'error'
      execNode.output = (err as Error).message
    }
  }

  isRunning.value = false
  isComplete.value = true
}

function stopExecution() {
  isRunning.value = false
  isComplete.value = true
}
</script>

<style lang="scss" scoped>
.workflow-runner-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.workflow-runner {
  width: 600px;
  max-height: 80vh;
  background: var(--bg-primary);
  border-radius: 12px;
  border: 1px solid var(--border-default);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.runner-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-default);

  h3 { font-size: 14px; font-weight: 600; color: var(--text-primary); margin: 0; }
}

.close-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 6px; border: none;
  background: transparent; color: var(--text-muted); cursor: pointer;
  &:hover { background: var(--bg-hover); color: var(--text-primary); }
}

.runner-input {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.input-label {
  font-size: 12px; font-weight: 600; color: var(--text-muted);
}

.input-textarea {
  width: 100%; padding: 10px; border-radius: 6px;
  border: 1px solid var(--border-default); background: var(--bg-secondary);
  color: var(--text-primary); font-size: 13px; resize: vertical; font-family: inherit;
  &:focus { outline: none; border-color: var(--accent-primary); }
}

.runner-status {
  flex: 1;
  padding: 16px 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.exec-node {
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-default);
  background: var(--bg-secondary);

  &.status-running { border-color: rgba(59, 130, 246, 0.5); }
  &.status-done { border-color: rgba(16, 185, 129, 0.3); }
  &.status-error { border-color: rgba(239, 68, 68, 0.3); }
}

.exec-icon {
  display: inline-flex;
  margin-right: 8px;
  .status-running & { color: #3b82f6; }
  .status-done & { color: #10b981; }
  .status-error & { color: #ef4444; }
  .status-pending & { color: var(--text-muted); }
}

.exec-info {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.exec-label { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.exec-duration { font-size: 11px; color: var(--text-muted); }

.exec-output {
  margin-top: 8px;
  pre {
    font-size: 11px; line-height: 1.4; padding: 8px;
    border-radius: 4px; background: var(--bg-tertiary);
    color: var(--text-secondary); margin: 0;
    white-space: pre-wrap; max-height: 120px; overflow-y: auto;
  }
}

.runner-footer {
  padding: 12px 20px;
  border-top: 1px solid var(--border-default);
  display: flex;
  justify-content: flex-end;
}

.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 6px; font-size: 13px;
  font-weight: 500; border: none; cursor: pointer; transition: all 0.15s;

  &.btn-primary { background: var(--accent-primary); color: white; &:hover { background: var(--accent-primary-hover); } }
  &.btn-danger { background: #ef4444; color: white; &:hover { background: #dc2626; } }
}

.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
