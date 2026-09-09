<template>
  <div class="tool-card" :class="statusClass">
    <!-- 折叠态头部 -->
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="isRunning" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <FileOutput v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.taskOutput') }}</span>
      <template v-if="taskIdDisplay">
        <span class="tool-separator">·</span>
        <span class="tool-target">{{ taskIdDisplay }}</span>
      </template>
      <span v-if="statusBadge" class="task-status-badge" :class="statusBadgeClass">{{ statusBadge }}</span>
      <span v-if="duration" class="tool-meta">{{ duration }}s</span>
      <div class="tool-actions">
        <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
      </div>
    </div>

    <!-- 折叠态预览 -->
    <div v-if="!isExpanded && outputPreview" class="task-preview">
      <div class="preview-text">{{ outputPreview }}</div>
    </div>

    <!-- 展开态详情 -->
    <div v-if="isExpanded" class="tool-body">
      <!-- 元信息栏 -->
      <div class="task-meta-bar">
        <span v-if="parsedTaskType" class="task-type-tag" :class="taskTypeTagClass">
          {{ parsedTaskType }}
        </span>
        <span class="meta-divider"></span>
        <span class="meta-item">{{ t('toolCards.taskOutputTaskId') }}: {{ taskIdDisplay }}</span>
        <span class="meta-divider"></span>
        <span v-if="parsedStatus" class="meta-item">{{ parsedStatus }}</span>
        <span v-if="parsedExitCode !== null" class="meta-divider"></span>
        <span v-if="parsedExitCode !== null" class="meta-item">{{ t('toolCards.taskOutputExitCode') }}: {{ parsedExitCode }}</span>
      </div>

      <!-- 输入参数 -->
      <div v-if="hasInputParams" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.taskOutputInputParams') }}</div>
        <div class="input-params">
          <div v-if="taskIdInput" class="param-row">
            <span class="param-key">task_id:</span>
            <span class="param-value mono">{{ taskIdInput }}</span>
          </div>
          <div class="param-row">
            <span class="param-key">block:</span>
            <span class="param-value">{{ blockInput }}</span>
          </div>
          <div v-if="timeoutInput" class="param-row">
            <span class="param-key">timeout:</span>
            <span class="param-value">{{ timeoutInput }}ms</span>
          </div>
        </div>
      </div>

      <!-- 等待状态 (timeout / not_ready) -->
      <div v-if="isWaiting" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.taskOutputStatus') }}</div>
        <div class="waiting-state">
          <div class="waiting-spinner"></div>
          <div class="waiting-text">{{ waitingText }}</div>
          <div v-if="waitingHint" class="waiting-hint">{{ waitingHint }}</div>
        </div>
      </div>

      <!-- 无任务数据 (task 为 null) -->
      <div v-else-if="!parsedTask" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.taskOutputStatus') }}</div>
        <div class="no-task">{{ t('toolCards.taskOutputNoTask') }}</div>
      </div>

      <!-- local_bash: 终端窗口渲染 -->
      <template v-else-if="parsedTaskType === 'local_bash'">
        <div v-if="parsedDescription" class="tool-section">
          <div class="tool-section-header">{{ t('toolCards.taskOutputRemoteCommand') }}</div>
          <div class="input-params">
            <div class="param-row">
              <span class="param-value mono">{{ parsedDescription }}</span>
            </div>
          </div>
        </div>
        <div v-if="parsedOutput" class="tool-section">
          <div class="tool-section-header">{{ t('toolCards.taskOutputOutput') }}</div>
          <div class="tool-section-body">
            <div class="terminal-window">
              <div class="terminal-titlebar">
                <div class="traffic-lights">
                  <span class="light red"></span>
                  <span class="light yellow"></span>
                  <span class="light green"></span>
                </div>
                <span class="terminal-title">{{ taskIdDisplay }} — {{ parsedDescription || 'bash' }}</span>
                <span v-if="isRunning" class="terminal-status-badge running">{{ t('toolCards.bashRunning') }}</span>
                <span v-else-if="toolCall.status === 'completed'" class="terminal-status-badge completed">{{ t('toolCards.bashCompleted') }}</span>
                <span v-else-if="toolCall.status === 'error'" class="terminal-status-badge error">{{ t('toolCards.bashError') }}</span>
              </div>
              <div class="terminal-content">
                <div v-if="parsedOutput" class="term-output" :class="{ 'error-output': toolCall.status === 'error' || parsedError }">{{ truncatedOutput }}<span v-if="isRunning" class="cursor"></span></div>
                <div v-if="showExitCode" class="term-exit" :class="{ 'error-exit': parsedExitCode !== 0 }">
                  {{ t('toolCards.bashExitCode', { code: parsedExitCode ?? 0 }) }}
                  <span v-if="isOutputTruncated" class="truncated-hint">· {{ t('toolCards.bashOutputTruncated') }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- local_agent: 提示词 + 结果渲染 -->
      <template v-else-if="parsedTaskType === 'local_agent'">
        <div v-if="parsedPrompt" class="tool-section">
          <div class="tool-section-header">{{ t('toolCards.agentDescription') }}</div>
          <div class="tool-section-body">
            <pre class="prompt-block"><code>{{ parsedPrompt }}</code></pre>
          </div>
        </div>
        <div v-if="parsedOutput || parsedResult" class="tool-section">
          <div class="tool-section-header">{{ t('toolCards.agentResult') }}</div>
          <div class="tool-section-body">
            <div v-if="parsedResult" class="agent-result-content">
              <MarkdownRenderer :content="truncatedResult" />
            </div>
            <div v-else-if="parsedOutput" class="agent-result-content">
              <MarkdownRenderer :content="truncatedOutput" />
            </div>
            <div v-else class="output-empty">
              {{ isRunning ? t('common.loading') : t('toolCards.agentNoOutput') }}
            </div>
          </div>
        </div>
      </template>

      <!-- remote_agent: 远程命令 + 输出 -->
      <template v-else-if="parsedTaskType === 'remote_agent'">
        <div v-if="parsedPrompt" class="tool-section">
          <div class="tool-section-header">{{ t('toolCards.taskOutputRemoteCommand') }}</div>
          <div class="tool-section-body">
            <pre class="prompt-block"><code>{{ parsedPrompt }}</code></pre>
          </div>
        </div>
        <div v-if="parsedOutput" class="tool-section">
          <div class="tool-section-header">{{ t('toolCards.taskOutputOutput') }}</div>
          <div class="tool-section-body">
            <pre class="remote-output"><code>{{ truncatedOutput }}</code></pre>
          </div>
        </div>
      </template>

      <!-- 默认渲染 -->
      <template v-else>
        <div v-if="parsedOutput" class="tool-section">
          <div class="tool-section-header">{{ t('toolCards.taskOutputOutput') }}</div>
          <div class="tool-section-body">
            <pre class="remote-output"><code>{{ truncatedOutput }}</code></pre>
          </div>
        </div>
      </template>

      <!-- 错误块 -->
      <div v-if="parsedError" class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.taskOutputError') }}</div>
        <div class="error-block">{{ parsedError }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { FileOutput, ChevronDown, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const { t } = useI18n()

const MAX_OUTPUT_LEN = 3000

// ── 状态计算 ──
const statusClass = computed(() => `status-${props.toolCall.status}`)
const isRunning = computed(() => props.toolCall.status === 'running' || props.toolCall.status === 'pending')

const duration = computed(() => {
  if (!props.toolCall.startTime) return null
  const end = props.toolCall.endTime || Date.now()
  return ((end - props.toolCall.startTime) / 1000).toFixed(1)
})

// ── 输入参数 ──
const taskIdInput = computed(() => {
  const v = props.toolCall.input?.task_id
  return typeof v === 'string' ? v : ''
})

const blockInput = computed(() => {
  const v = props.toolCall.input?.block
  if (v === undefined) return 'true'
  return String(v)
})

const timeoutInput = computed(() => {
  const v = props.toolCall.input?.timeout
  if (v === undefined || v === null) return ''
  return String(v)
})

const hasInputParams = computed(() => {
  return !!(taskIdInput.value || blockInput.value || timeoutInput.value)
})

const taskIdDisplay = computed(() => taskIdInput.value || '')

// ── XML 输出解析 ──
interface ParsedTaskData {
  retrievalStatus: 'success' | 'timeout' | 'not_ready' | ''
  taskId: string
  taskType: string
  status: string
  exitCode: number | null
  output: string
  error: string
  description: string
  prompt: string
  result: string
}

function parseXmlOutput(raw: string): ParsedTaskData {
  const data: ParsedTaskData = {
    retrievalStatus: '',
    taskId: '',
    taskType: '',
    status: '',
    exitCode: null,
    output: '',
    error: '',
    description: '',
    prompt: '',
    result: '',
  }

  if (!raw) return data

  const extract = (tag: string): string => {
    // Match <tag>content</tag>, handling multi-line and self-closing
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i')
    const m = raw.match(re)
    return m ? m[1].trim() : ''
  }

  data.retrievalStatus = extract('retrieval_status') as ParsedTaskData['retrievalStatus']
  data.taskId = extract('task_id')
  data.taskType = extract('task_type')
  data.status = extract('status')
  data.output = extract('output')
  data.error = extract('error')
  data.description = extract('description')
  data.prompt = extract('prompt')
  data.result = extract('result')

  const exitCodeStr = extract('exit_code')
  if (exitCodeStr) {
    const code = parseInt(exitCodeStr, 10)
    if (!isNaN(code)) data.exitCode = code
  }

  return data
}

const parsed = computed<ParsedTaskData>(() => parseXmlOutput(props.toolCall.output || ''))

const parsedTask = computed(() => {
  const p = parsed.value
  if (!p.taskId && !p.taskType && !p.status && !p.output) return null
  return p
})

const parsedTaskType = computed(() => parsed.value.taskType || '')
const parsedStatus = computed(() => parsed.value.status || '')
const parsedExitCode = computed(() => parsed.value.exitCode)
const parsedOutput = computed(() => parsed.value.output || '')
const parsedError = computed(() => parsed.value.error || '')
const parsedDescription = computed(() => parsed.value.description || '')
const parsedPrompt = computed(() => parsed.value.prompt || '')
const parsedResult = computed(() => parsed.value.result || '')

// ── 输出截断 ──
const isOutputTruncated = computed(() => parsedOutput.value.length > MAX_OUTPUT_LEN)
const truncatedOutput = computed(() => {
  const out = parsedOutput.value
  if (out.length <= MAX_OUTPUT_LEN) return out
  return out.slice(0, MAX_OUTPUT_LEN)
})

const truncatedResult = computed(() => {
  const out = parsedResult.value
  if (out.length <= MAX_OUTPUT_LEN) return out
  return out.slice(0, MAX_OUTPUT_LEN)
})

// ── 折叠态预览 ──
const outputPreview = computed(() => {
  const out = parsedOutput.value || parsedResult.value
  if (!out) return ''
  const lines = out.split('\n').filter(l => l.trim())
  return lines.slice(0, 2).join('\n').slice(0, 200)
})

// ── 等待状态 ──
const isWaiting = computed(() => {
  const rs = parsed.value.retrievalStatus
  return rs === 'timeout' || rs === 'not_ready'
})

const waitingText = computed(() => {
  const rs = parsed.value.retrievalStatus
  if (rs === 'timeout') return t('toolCards.taskOutputTimeout')
  if (rs === 'not_ready') return t('toolCards.taskOutputNotReady')
  return ''
})

const waitingHint = computed(() => {
  const rs = parsed.value.retrievalStatus
  if (rs === 'timeout') return t('toolCards.taskOutputTimeoutHint')
  if (rs === 'not_ready') return t('toolCards.taskOutputNotReadyHint')
  return ''
})

// ── 状态徽章 ──
const statusBadge = computed(() => {
  const rs = parsed.value.retrievalStatus
  const ts = parsed.value.status || props.toolCall.status

  if (rs === 'timeout') return t('toolCards.taskOutputBadgeTimeout')
  if (rs === 'not_ready') return t('toolCards.taskOutputBadgeNotReady')

  if (ts === 'running' || ts === 'pending' || props.toolCall.status === 'running' || props.toolCall.status === 'pending')
    return t('toolCards.agentStatusRunning')
  if (ts === 'failed' || props.toolCall.status === 'error')
    return t('toolCards.agentStatusFailed')
  if (ts === 'completed' || ts === 'success' || props.toolCall.status === 'completed')
    return t('toolCards.agentStatusDone')

  return ''
})

const statusBadgeClass = computed(() => {
  const rs = parsed.value.retrievalStatus
  if (rs === 'timeout') return 'badge-timeout'
  if (rs === 'not_ready') return 'badge-not-ready'

  const ts = parsed.value.status || props.toolCall.status
  if (ts === 'running' || ts === 'pending' || props.toolCall.status === 'running' || props.toolCall.status === 'pending')
    return 'badge-running'
  if (ts === 'failed' || props.toolCall.status === 'error')
    return 'badge-failed'
  if (ts === 'completed' || ts === 'success' || props.toolCall.status === 'completed')
    return 'badge-done'

  return ''
})

// ── 任务类型标签 ──
const taskTypeTagClass = computed(() => {
  switch (parsedTaskType.value) {
    case 'local_bash': return 'type-bash'
    case 'local_agent': return 'type-agent'
    case 'remote_agent': return 'type-remote'
    default: return ''
  }
})

// ── 退出码 ──
const showExitCode = computed(() => {
  return parsedExitCode.value !== null &&
    (props.toolCall.status === 'completed' || props.toolCall.status === 'error')
})

// ── 交互 ──
function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

/* ── 状态徽章 ── */
.task-status-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 10px;
  line-height: 1.4;

  &.badge-running {
    background: color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent);
    color: var(--warning, #f59e0b);
  }

  &.badge-done {
    background: color-mix(in srgb, var(--success, #22c55e) 12%, transparent);
    color: var(--success, #22c55e);
  }

  &.badge-failed {
    background: color-mix(in srgb, var(--error, #ef4444) 12%, transparent);
    color: var(--error, #ef4444);
  }

  &.badge-timeout {
    background: color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent);
    color: var(--warning, #f59e0b);
  }

  &.badge-not-ready {
    background: color-mix(in srgb, var(--accent-tertiary, #7c3aed) 12%, transparent);
    color: var(--accent-tertiary, #7c3aed);
  }
}

/* ── 折叠态预览 ── */
.task-preview {
  padding: 2px 8px 4px 28px;
  max-width: 100%;
}

.preview-text {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary, var(--text-muted));
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--font-mono);
}

/* ── 元信息栏 ── */
.task-meta-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
  flex-wrap: wrap;
}

.meta-item {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
}

.meta-divider {
  width: 1px;
  height: 12px;
  background: var(--surface-border-strong);
  flex-shrink: 0;
}

/* ── 任务类型标签 ── */
.task-type-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;

  &.type-bash {
    background: rgba(34, 197, 94, 0.12);
    color: #4ade80;
  }

  &.type-agent {
    background: rgba(139, 92, 246, 0.12);
    color: #a78bfa;
  }

  &.type-remote {
    background: rgba(249, 115, 22, 0.12);
    color: #fb923c;
  }
}

/* ── 输入参数 ── */
.input-params {
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-secondary);
}

.param-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.param-key {
  color: var(--text-muted);
  font-weight: 500;
  flex-shrink: 0;
  min-width: 80px;
}

.param-value {
  color: var(--text-secondary);
  word-break: break-all;

  &.mono {
    font-family: var(--font-mono);
  }
}

/* ── 终端窗口（local_bash） ── */
.terminal-window {
  background: #0d1117;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  overflow: hidden;
}

.terminal-titlebar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #161b22;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.traffic-lights {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.light {
  width: 11px;
  height: 11px;
  border-radius: 50%;

  &.red { background: #ff5f56; }
  &.yellow { background: #ffbd2e; }
  &.green { background: #27c93f; }
}

.terminal-title {
  flex: 1;
  text-align: center;
  font-size: 11px;
  color: #8b949e;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-status-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  flex-shrink: 0;

  &.running {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
  }

  &.completed {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }

  &.error {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }
}

.terminal-content {
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  color: #c9d1d9;
  max-height: 400px;
  overflow-y: auto;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
}

.term-output {
  color: #c9d1d9;
  white-space: pre-wrap;
  word-break: break-all;
  margin-top: 2px;

  &.error-output {
    color: #f87171;
  }
}

.cursor {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: #c9d1d9;
  vertical-align: text-bottom;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% { opacity: 0; }
}

.term-exit {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed rgba(255, 255, 255, 0.08);
  font-size: 11px;
  color: #6e7681;

  &.error-exit {
    color: #8b949e;
  }
}

.truncated-hint {
  margin-left: 8px;
  color: #6e7681;
}

/* ── Agent 输出（local_agent） ── */
.prompt-block {
  margin: 0;
  padding: 10px 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  background: var(--code-bg, #0d1117);
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  max-height: 320px;
  overflow-y: auto;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: var(--surface-border-strong); border-radius: 3px; }
}

.agent-result-content {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  max-height: 360px;
  overflow-y: auto;

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: var(--surface-border-strong); border-radius: 3px; }
}

.output-empty {
  color: var(--text-muted);
  font-size: 13px;
  padding: 4px 0;
}

/* ── Remote 输出 ── */
.remote-output {
  margin: 0;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
  background: transparent;
  color: var(--text-secondary);

  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: var(--surface-border-strong); border-radius: 3px; }

  code {
    display: block;
    padding: 10px 12px;
    background: var(--code-bg, #0d1117);
    border-radius: 6px;
    color: var(--code-fg, #c9d1d9);
  }
}

/* ── 等待状态 ── */
.waiting-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 12px;
  gap: 8px;
}

.waiting-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--surface-border-strong);
  border-top-color: var(--accent-tertiary, #7c3aed);
  border-radius: 50%;
  animation: tool-spin 0.8s linear infinite;
}

.waiting-text {
  font-size: 13px;
  color: var(--text-muted);
}

.waiting-hint {
  font-size: 11px;
  color: var(--text-disabled, var(--text-muted));
  text-align: center;
}

/* ── 无任务数据 ── */
.no-task {
  padding: 16px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

/* ── 错误块 ── */
.error-block {
  padding: 12px;
  color: var(--error, #ef4444);
  font-size: 13px;
  line-height: 1.6;
  background: color-mix(in srgb, var(--error, #ef4444) 6%, transparent);
}
</style>
