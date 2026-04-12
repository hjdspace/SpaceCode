<template>
  <div class="terminal-panel" ref="panelRef">
    <div class="terminal-container" ref="terminalContainer"></div>
    <div v-if="error" class="terminal-error">
      <AlertCircle :size="16" />
      <span>{{ error }}</span>
    </div>
    <div v-if="!isReady && !error" class="terminal-loading">
      <div class="loading-spinner"></div>
      <span>Starting terminal...</span>
    </div>
    <div v-if="copyToast.show" class="copy-toast" :class="{ show: copyToast.show }">
      <Check :size="14" />
      <span>{{ copyToast.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { AlertCircle, Check } from 'lucide-vue-next'
import { api } from '@/services/electronAPI'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  autoCommand?: string
  cwd?: string
  env?: Record<string, string>
}>()

const emit = defineEmits<{
  ready: []
  error: [message: string]
  exit: [code: number]
}>()

const panelRef = ref<HTMLElement | null>(null)
const terminalContainer = ref<HTMLElement | null>(null)
const isReady = ref(false)
const error = ref<string | null>(null)
const copyToast = ref({
  show: false,
  message: '已复制到剪贴板'
})
let copyToastTimer: ReturnType<typeof setTimeout> | null = null

function showCopyToast(message: string = '已复制到剪贴板') {
  if (copyToastTimer) {
    clearTimeout(copyToastTimer)
  }
  copyToast.value = {
    show: true,
    message
  }
  copyToastTimer = setTimeout(() => {
    copyToast.value.show = false
  }, 2000)
}

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let terminalId: string | null = null
let removeDataListener: (() => void) | null = null
let removeExitListener: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null

function getTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  return isDark ? {
    background: '#0d0d0d',
    foreground: '#f5f5f5',
    cursor: '#f5f5f5',
    cursorAccent: '#0d0d0d',
    selectionBackground: 'rgba(59, 130, 246, 0.3)',
    black: '#0d0d0d',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#f59e0b',
    blue: '#3b82f6',
    magenta: '#8b5cf6',
    cyan: '#06b6d4',
    white: '#f5f5f5',
    brightBlack: '#525252',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#fbbf24',
    brightBlue: '#60a5fa',
    brightMagenta: '#a78bfa',
    brightCyan: '#22d3ee',
    brightWhite: '#f5f5f5',
  } : {
    background: '#ffffff',
    foreground: '#171717',
    cursor: '#171717',
    cursorAccent: '#ffffff',
    selectionBackground: 'rgba(37, 99, 235, 0.2)',
    black: '#171717',
    red: '#dc2626',
    green: '#16a34a',
    yellow: '#d97706',
    blue: '#2563eb',
    magenta: '#7c3aed',
    cyan: '#0891b2',
    white: '#f5f5f5',
    brightBlack: '#737373',
    brightRed: '#ef4444',
    brightGreen: '#22c55e',
    brightYellow: '#f59e0b',
    brightBlue: '#3b82f6',
    brightMagenta: '#8b5cf6',
    brightCyan: '#06b6d4',
    brightWhite: '#ffffff',
  }
}

async function initTerminal() {
  if (!terminalContainer.value) {
    error.value = 'Terminal container not available'
    emit('error', error.value)
    return
  }

  try {
    // Create terminal instance via IPC
    // Convert env to a plain object to avoid Vue reactive Proxy serialization error
    const plainEnv = props.env ? JSON.parse(JSON.stringify(props.env)) : undefined
    const result = await api.terminal.create({
      cwd: props.cwd,
      env: plainEnv
    })

    if (!result.id) {
      error.value = result.error || 'Failed to create terminal'
      emit('error', error.value)
      return
    }

    terminalId = result.id

    // Initialize xterm.js
    terminal = new Terminal({
      theme: getTheme(),
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace",
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 5000,
      allowProposedApi: true,
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminal.open(terminalContainer.value)

    // Fit after a short delay to ensure DOM is ready
    await nextTick()
    setTimeout(() => {
      try {
        fitAddon?.fit()
      } catch (e) {
        // Ignore fit errors
      }
    }, 50)

    // Right-click to copy selected text (VSCode-style)
    // Attach contextmenu handler on the terminal DOM element
    const containerEl = terminalContainer.value
    if (containerEl) {
      containerEl.addEventListener('contextmenu', async (e: Event) => {
        const selection = terminal?.getSelection()
        if (selection) {
          await navigator.clipboard.writeText(selection)
          showCopyToast('已复制到剪贴板')
        }
        e.preventDefault()
      })
    }

    // Forward user input to pty
    terminal.onData((data: string) => {
      if (terminalId) {
        api.terminal.write(terminalId, data)
      }
    })

    // Forward pty output to xterm
    removeDataListener = api.terminal.onData((id: string, data: string) => {
      if (id === terminalId && terminal) {
        terminal.write(data)
      }
    })

    // Handle terminal exit
    removeExitListener = api.terminal.onExit((id: string, exitCode: number) => {
      if (id === terminalId) {
        isReady.value = false
        emit('exit', exitCode)
      }
    })

    // Resize pty when xterm is resized
    terminal.onResize(({ cols, rows }) => {
      if (terminalId) {
        api.terminal.resize(terminalId, cols, rows)
      }
    })

    // Set up resize observer
    resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon?.fit()
      } catch (e) {
        // Ignore fit errors during resize
      }
    })
    resizeObserver.observe(panelRef.value!)

    isReady.value = true
    emit('ready')

    // Auto-run command if provided
    if (props.autoCommand && terminalId) {
      // Small delay to let the shell initialize
      setTimeout(() => {
        api.terminal.runCommand(terminalId!, props.autoCommand!)
      }, 800)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
    emit('error', error.value)
  }
}

function focus() {
  terminal?.focus()
}

function runCommand(command: string) {
  if (terminalId && isReady.value) {
    api.terminal.runCommand(terminalId, command)
  }
}

function clear() {
  terminal?.clear()
}

// Watch for theme changes
const themeObserver = new MutationObserver(() => {
  if (terminal) {
    terminal.options.theme = getTheme()
  }
})

// Watch for autoCommand changes after terminal is ready (e.g. when terminal tab already exists)
watch(() => props.autoCommand, (newCommand) => {
  if (newCommand && isReady.value && terminalId) {
    api.terminal.runCommand(terminalId, newCommand)
  }
})

onMounted(async () => {
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme']
  })
  await nextTick()
  await initTerminal()
})

onUnmounted(() => {
  // Clean up
  if (terminalId) {
    api.terminal.kill(terminalId)
  }
  removeDataListener?.()
  removeExitListener?.()
  resizeObserver?.disconnect()
  themeObserver.disconnect()
  terminal?.dispose()
  terminal = null
  fitAddon = null
  terminalId = null
  if (copyToastTimer) {
    clearTimeout(copyToastTimer)
  }
})

defineExpose({ focus, runCommand, clear })
</script>

<style lang="scss" scoped>
.terminal-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  background: var(--bg-primary);
}

.terminal-container {
  flex: 1;
  padding: 4px 8px;
  overflow: hidden;

  :deep(.xterm) {
    height: 100%;
  }

  :deep(.xterm-viewport) {
    &::-webkit-scrollbar {
      width: 8px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: var(--border-default);
      border-radius: var(--radius-full);
      &:hover {
        background: var(--text-muted);
      }
    }
  }
}

.terminal-error {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--error-glow);
  border: 1px solid var(--error);
  border-radius: var(--radius-md);
  color: var(--error);
  font-size: 12px;
  font-weight: 500;
  z-index: 10;
}

.terminal-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--text-muted);
  font-size: 13px;
}

.loading-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border-default);
  border-top-color: var(--accent-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.copy-toast {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%) translateY(-10px);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  z-index: 100;
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.2s ease;
  pointer-events: none;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

  &.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }

  svg {
    color: var(--accent-primary);
  }
}
</style>
