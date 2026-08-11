<template>
  <div class="tool-card" :class="statusClass">
    <div class="tool-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Loader2 v-if="toolCall.status === 'running'" :size="14" class="tool-icon status-running" />
      <X v-else-if="toolCall.status === 'error'" :size="14" class="tool-icon status-error" />
      <Terminal v-else :size="14" class="tool-icon status-completed" />
      <span class="tool-label">{{ t('toolCards.bash') }}</span>
      <template v-if="commandPreview">
        <span class="tool-separator">·</span>
        <span class="tool-target">{{ commandPreview }}</span>
      </template>
      <span v-if="duration" class="tool-meta">{{ duration }}s</span>
      <div class="tool-actions">
        <button
          v-if="canUseTerminal"
          class="action-btn"
          :title="t('toolCards.bashRunInTerminal')"
          @click.stop="openInTerminalPage"
        >
          <Monitor :size="14" />
        </button>
        <ChevronDown :size="14" class="tool-chevron" :class="{ 'is-expanded': isExpanded }" />
      </div>
    </div>

    <div v-if="isExpanded" class="tool-body">
      <div class="tool-section">
        <div class="tool-section-header">{{ t('toolCards.bashOutput') }}</div>
        <div class="tool-section-body">
          <div class="terminal-window">
            <div class="terminal-titlebar">
              <div class="traffic-lights">
                <span class="light red"></span>
                <span class="light yellow"></span>
                <span class="light green"></span>
              </div>
              <span class="terminal-title">bash — {{ commandPreview || toolCall.input.command }}</span>
              <span v-if="toolCall.status === 'running'" class="terminal-status-badge running">{{ t('toolCards.bashRunning') }}</span>
              <span v-else-if="toolCall.status === 'completed'" class="terminal-status-badge completed">{{ t('toolCards.bashCompleted') }}</span>
              <span v-else-if="toolCall.status === 'error'" class="terminal-status-badge error">{{ t('toolCards.bashError') }}</span>
            </div>
            <div class="terminal-content">
              <div class="term-command">
                <span class="term-prompt">$</span>
                <span v-if="cwdDisplay" class="term-cwd">{{ cwdDisplay }}</span>
                <span class="term-cmd-text">{{ toolCall.input.command }}</span>
              </div>
              <div v-if="toolCall.output" class="term-output" :class="{ 'error-output': toolCall.status === 'error' }">{{ truncatedOutput }}<span v-if="toolCall.status === 'running'" class="cursor"></span></div>
              <div v-else-if="toolCall.status === 'running'" class="cursor-line"><span class="cursor"></span></div>
              <div v-if="showExitCode" class="term-exit" :class="{ 'error-exit': toolCall.status === 'error' }">
                {{ t('toolCards.bashExitCode', { code: exitCode }) }}
                <span v-if="isTruncated" class="truncated-hint">· {{ t('toolCards.bashOutputTruncated') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Terminal, ChevronDown, Monitor, Loader2, X } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useChatSessionStore } from '@/stores/chatSession'
import { useAppStore } from '@/stores/app'

const props = defineProps<{ toolCall: ToolCall }>()

const sessionStore = useChatSessionStore()
const appStore = useAppStore()
const { t } = useI18n()
const isExpanded = ref(false)

const workingDirectory = computed(() => {
  return sessionStore.workingDirectory || undefined
})

// 简化显示：取路径最后一段，形如 ~/spacecode
const cwdDisplay = computed(() => {
  const cwd = workingDirectory.value
  if (!cwd) return null
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length ? '~/' + parts[parts.length - 1] : null
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
const isTruncated = computed(() => {
  const out = props.toolCall.output || ''
  return out.length > MAX_OUTPUT_LEN
})

const truncatedOutput = computed(() => {
  const out = props.toolCall.output || ''
  if (out.length <= MAX_OUTPUT_LEN) return out
  return out.slice(0, MAX_OUTPUT_LEN)
})

const showExitCode = computed(() => {
  return props.toolCall.status === 'completed' || props.toolCall.status === 'error'
})

// ToolCall 未携带退出码字段，按状态推断：completed=0，error=1
const exitCode = computed(() => {
  return props.toolCall.status === 'error' ? 1 : 0
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

function openInTerminalPage() {
  const cmd = props.toolCall.input?.command
  appStore.openTerminalTab(cmd, undefined, workingDirectory.value)
}
</script>

<style lang="scss" scoped>
@use './tool-card.scss' as *;

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

.term-command {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 4px;
}

.term-prompt {
  color: #4ade80;
  flex-shrink: 0;
  user-select: none;
}

.term-cwd {
  color: #60a5fa;
  flex-shrink: 0;
}

.term-cmd-text {
  color: #e6edf3;
  word-break: break-all;
  white-space: pre-wrap;
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

.cursor-line {
  margin-top: 2px;
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
</style>
