<template>
  <div class="embedded-terminal" ref="containerRef" :style="containerStyle">
    <div v-if="!isReady" class="terminal-loading">
      <span class="loading-text">Initializing terminal...</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useTerminalStore } from '@/stores/terminal'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  toolCallId: string
  cwd?: string
  autoCommand?: string
  height?: number
}>()

const emit = defineEmits<{
  ready: [terminalId: string]
  exit: [code: number]
  error: [message: string]
}>()

const terminalStore = useTerminalStore()
const containerRef = ref<HTMLElement | null>(null)
const isReady = ref(false)

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let terminalId: string | null = null
let removeDataListener: (() => void) | undefined
let removeExitListener: (() => void) | undefined
let contextmenuHandler: ((e: Event) => void) | null = null

const containerStyle = computed(() => ({
  minHeight: `${(props.height || 12) * 20 + 16}px`
}))

function getTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  return isDark ? {
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#c9d1d9',
    cursorAccent: '#0d1117',
    selectionBackground: 'rgba(59, 130, 246, 0.3)',
    black: '#0d1117',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#f59e0b',
    blue: '#3b82f6',
    magenta: '#8b5cf6',
    cyan: '#06b6d4',
    white: '#c9d1d9',
    brightBlack: '#525252',
    brightRed: '#f87171',
    brightGreen: '#4ade80',
    brightYellow: '#fbbf24',
    brightBlue: '#60a5fa',
    brightMagenta: '#a78bfa',
    brightCyan: '#22d3ee',
    brightWhite: '#c9d1d9',
  } : {
    background: '#f6f8fa',
    foreground: '#1f2328',
    cursor: '#1f2328',
    cursorAccent: '#f6f8fa',
    selectionBackground: 'rgba(37, 99, 235, 0.2)',
    black: '#1f2328',
    red: '#dc2626',
    green: '#16a34a',
    yellow: '#d97706',
    blue: '#2563eb',
    magenta: '#7c3aed',
    cyan: '#0891b2',
    white: '#1f2328',
    brightBlack: '#525252',
    brightRed: '#ef4444',
    brightGreen: '#22c55e',
    brightYellow: '#f59e0b',
    brightBlue: '#3b82f6',
    brightMagenta: '#8b5cf6',
    brightCyan: '#06b6d4',
    brightWhite: '#1f2328',
  }
}

async function initTerminal() {
  if (!containerRef.value) {
    emit('error', 'Terminal container not available')
    return
  }

  terminalStore.createEmbeddedInstance(props.toolCallId, props.cwd)

  try {
    const electronAPI = window.electronAPI
    const result = await electronAPI?.terminal?.create({
      cwd: props.cwd,
      env: undefined
    })

    if (!result?.id) {
      emit('error', result?.error || 'Failed to create terminal')
      return
    }

    terminalId = result.id

    if (!terminalId) {
      emit('error', 'Failed to create terminal: no terminal ID returned')
      return
    }

    terminalStore.setEmbeddedTerminalId(props.toolCallId, terminalId)

    terminal = new Terminal({
      theme: getTheme(),
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace",
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 2000,
      allowProposedApi: true,
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
      cols: 80,
      rows: props.height || 12,
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    terminal.open(containerRef.value)

    await nextTick()

    const containerEl = containerRef.value
    if (containerEl) {
      contextmenuHandler = async (e: Event) => {
        e.preventDefault()
        const selection = terminal?.getSelection()
        if (selection) {
          // 有选区 → 复制到剪贴板
          try {
            await navigator.clipboard.writeText(selection)
            terminal?.clearSelection()
          } catch (err) {
            console.warn('[EmbeddedTerminal] Copy failed:', err)
          }
        } else {
          // 无选区 → 粘贴
          await pasteFromClipboard()
        }
      }
      containerEl.addEventListener('contextmenu', contextmenuHandler)
    }

    // 粘贴快捷键支持：Ctrl+Shift+V 和 Ctrl+V
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if ((event.ctrlKey && event.shiftKey && event.key === 'V') ||
          (event.ctrlKey && !event.shiftKey && event.key === 'v')) {
        if (event.type === 'keydown') {
          pasteFromClipboard()
        }
        return false
      }
      return true
    })

    terminal.onData((data: string) => {
      if (terminalId) {
        electronAPI?.terminal?.write(terminalId, data)
      }
    })

    removeDataListener = electronAPI?.terminal?.onData((id: string, data: string) => {
      if (id === terminalId && terminal) {
        terminal.write(data)
      }
    })

    removeExitListener = electronAPI?.terminal?.onExit((id: string, exitCode: number) => {
      if (id === terminalId) {
        terminalStore.markEmbeddedInstanceDead(props.toolCallId)
        emit('exit', exitCode)
      }
    })

    terminal.onResize(({ cols, rows }) => {
      if (terminalId) {
        electronAPI?.terminal?.resize(terminalId, cols, rows)
      }
    })

    isReady.value = true
    if (terminalId) {
      emit('ready', terminalId)
    }

    if (props.autoCommand && terminalId) {
      setTimeout(() => {
        electronAPI?.terminal?.runCommand(terminalId!, props.autoCommand!)
      }, 500)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    emit('error', message)
  }
}

function focus() {
  terminal?.focus()
}

function runCommand(command: string) {
  if (terminalId) {
    const electronAPI = window.electronAPI
    electronAPI?.terminal?.runCommand(terminalId, command)
  }
}

function clear() {
  terminal?.clear()
}

/**
 * 从剪贴板读取文本并粘贴到终端
 */
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (text && terminalId) {
      const electronAPI = window.electronAPI
      electronAPI?.terminal?.write(terminalId, text)
    }
  } catch (e) {
    console.warn('[EmbeddedTerminal] Paste failed:', e)
  }
}

function write(data: string) {
  if (terminalId) {
    const electronAPI = window.electronAPI
    electronAPI?.terminal?.write(terminalId, data)
  }
}

const themeObserver = new MutationObserver(() => {
  if (terminal) {
    terminal.options.theme = getTheme()
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
  terminalStore.destroyEmbeddedInstance(props.toolCallId)
  removeDataListener?.()
  removeExitListener?.()
  themeObserver.disconnect()
  if (contextmenuHandler && containerRef.value) {
    containerRef.value.removeEventListener('contextmenu', contextmenuHandler)
  }
  contextmenuHandler = null
  terminal?.dispose()
  terminal = null
  fitAddon = null
})

defineExpose({ focus, runCommand, clear, write })
</script>

<style lang="scss" scoped>
.embedded-terminal {
  background: var(--bg-primary, #0d1117);
  border-radius: 6px;
  overflow: hidden;
  position: relative;
  border: 1px solid var(--surface-border);

  :deep(.xterm) {
    padding: 8px;
  }

  :deep(.xterm-viewport) {
    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-track {
      background: transparent;
    }
    &::-webkit-scrollbar-thumb {
      background: var(--border-default);
      border-radius: 3px;
      &:hover {
        background: var(--text-muted);
      }
    }
  }
}

.terminal-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 200px;
  color: var(--text-secondary);
  font-size: 13px;
}

.loading-text {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
</style>
