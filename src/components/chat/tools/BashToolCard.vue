<template>
  <div class="bash-tool-card" :class="[statusClass, { 'has-terminal': showTerminal }]">
    <div class="bash-header" @click="toggleExpand">
      <div class="bash-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="14" class="spin-icon" />
        <X v-else-if="toolCall.status === 'error'" :size="14" />
        <Terminal v-else :size="14" />
      </div>
      <span class="bash-label">Bash</span>
      <span v-if="commandPreview" class="bash-cmd-preview">{{ commandPreview }}</span>
      <span v-if="duration" class="bash-duration">{{ duration }}s</span>
      <div class="header-actions">
        <button
          v-if="canUseTerminal && !showTerminal"
          class="action-btn"
          @click.stop="enableTerminal"
          title="在终端中运行"
        >
          <Monitor :size="14" />
        </button>
        <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
      </div>
    </div>

    <div v-if="isExpanded" class="bash-body">
      <div class="bash-command-block">
        <div class="block-label">$ Command</div>
        <pre class="code-block command-text"><code>{{ toolCall.input.command }}</code></pre>
      </div>

      <!-- 内嵌终端模式 -->
      <div v-if="showTerminal" class="bash-terminal-block">
        <div class="block-label">
          Terminal
          <span v-if="terminalStatus === 'running'" class="terminal-status running">Running</span>
          <span v-else-if="terminalStatus === 'completed'" class="terminal-status completed">Completed</span>
          <span v-else-if="terminalStatus === 'error'" class="terminal-status error">Error</span>
        </div>
        <EmbeddedTerminal
          ref="embeddedTerminalRef"
          :tool-call-id="toolCall.id"
          :cwd="workingDirectory"
          :auto-command="toolCall.input.command"
          :height="terminalHeight"
          @ready="onTerminalReady"
          @exit="onTerminalExit"
          @error="onTerminalError"
        />
      </div>

      <!-- 普通文本输出模式 -->
      <div v-else-if="toolCall.output" class="bash-output-block">
        <div class="block-label">Output</div>
        <pre class="code-block output-text" :class="{ 'error-output': toolCall.status === 'error' }"><code>{{ truncatedOutput }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Terminal, ChevronDown, Monitor, Loader2, X } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import EmbeddedTerminal from '@/components/terminal/EmbeddedTerminal.vue'

const props = defineProps<{ toolCall: ToolCall }>()

const chatStore = useChatStore()
const isExpanded = ref(false)
const showTerminal = ref(false)
const terminalStatus = ref<'running' | 'completed' | 'error' | 'idle'>('idle')
const embeddedTerminalRef = ref<InstanceType<typeof EmbeddedTerminal> | null>(null)

const terminalHeight = ref(12)

const workingDirectory = computed(() => {
  return chatStore.workingDirectory || undefined
})

const canUseTerminal = computed(() => {
  const cmd = props.toolCall.input?.command || ''
  const interactiveCommands = [
    'npm', 'yarn', 'pnpm', 'npx',
    'git',
    'docker',
    'python', 'python3', 'node',
    'make', 'cmake',
    'ssh',
    'vim', 'vi', 'nano',
  ]
  const cmdLower = cmd.toLowerCase().trim()
  return interactiveCommands.some(ic => cmdLower.startsWith(ic))
})

const statusClass = computed(() => `status-${props.toolCall.status}`)

const commandPreview = computed(() => {
  const cmd = props.toolCall.input?.command
  if (!cmd) return null
  return cmd.length > 50 ? cmd.slice(0, 50) + '...' : cmd
})

const duration = computed(() => {
  if (!props.toolCall.startTime) return null
  const end = props.toolCall.endTime || Date.now()
  return ((end - props.toolCall.startTime) / 1000).toFixed(1)
})

const MAX_OUTPUT_LEN = 3000
const truncatedOutput = computed(() => {
  const out = props.toolCall.output || ''
  if (out.length <= MAX_OUTPUT_LEN) return out
  return out.slice(0, MAX_OUTPUT_LEN) + '\n... (output truncated)'
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

function enableTerminal() {
  showTerminal.value = true
  terminalStatus.value = 'running'
}

function onTerminalReady(terminalId: string) {
  console.log('[BashToolCard] Terminal ready:', terminalId)
  terminalStatus.value = 'running'
}

function onTerminalExit(code: number) {
  console.log('[BashToolCard] Terminal exited with code:', code)
  terminalStatus.value = code === 0 ? 'completed' : 'error'
}

function onTerminalError(message: string) {
  console.error('[BashToolCard] Terminal error:', message)
  terminalStatus.value = 'error'
}

watch(() => props.toolCall.isInteractive, (isInteractive) => {
  if (isInteractive && !showTerminal.value) {
    showTerminal.value = true
    terminalStatus.value = 'running'
  }
}, { immediate: true })

watch(() => props.toolCall.status, (status) => {
  if (status === 'running' && canUseTerminal.value && !showTerminal.value) {
    showTerminal.value = true
    terminalStatus.value = 'running'
  }
}, { immediate: true })
</script>

<style lang="scss" scoped>
.bash-tool-card {
  border-radius: 6px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  overflow: hidden; font-size: 13px;
}
.bash-header {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; cursor: pointer;
  &:hover { background: rgba(255,255,255,0.03); }
}
.bash-icon-wrapper {
  width: 22px; height: 22px; border-radius: 4px;
  background: rgba(34, 197, 94, 0.12);
  color: #4ade80; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.bash-label { font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #4ade80; flex-shrink: 0; }
.bash-cmd-preview { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--text-secondary); }
.bash-duration { color: var(--text-tertiary); font-size: 11px; flex-shrink: 0; }
.expand-icon { color: var(--text-tertiary); transition: transform 0.15s; &.is-expanded { transform: rotate(180deg); } }

.bash-body { border-top: 1px solid var(--surface-border); }
.bash-command-block, .bash-output-block { padding: 10px 12px; }
.block-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-tertiary); margin-bottom: 6px; font-weight: 500; }
.code-block { margin: 0; padding: 10px 12px; border-radius: 4px; font-size: 12px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
.command-text { background: #0d1117; color: #f0f6fc; }
.output-text { background: #0d1117; color: #c9d1d9; max-height: 400px; overflow-y: auto; }
.error-output { color: #f87171; background: rgba(248,113,113,0.08); }

.status-running .bash-icon-wrapper { background: rgba(59, 130, 246, 0.12); color: #60a5fa; }
.status-error .bash-icon-wrapper { background: rgba(239, 68, 68, 0.12); color: #f87171; }
.spin-icon { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }
}

.bash-terminal-block {
  border-top: 1px solid var(--surface-border);
  padding: 10px 12px;
}

.terminal-status {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 8px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;

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

.bash-tool-card.has-terminal {
  .bash-header {
    background: rgba(59, 130, 246, 0.05);
  }
}
</style>
