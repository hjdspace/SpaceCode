<template>
  <div class="embedded-terminal" ref="containerRef" :style="containerStyle">
    <div v-if="!isReady" class="terminal-loading">
      <span class="loading-text">Initializing terminal...</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useAppStore } from '@/stores/app'
import { useTerminalStore } from '@/stores/terminal'
import { getTerminalTheme } from './terminalTheme'
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

const appStore = useAppStore()
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
      theme: getTerminalTheme(appStore.theme),
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

const stopThemeWatch = watch(() => appStore.theme, (theme) => {
  if (terminal) {
    terminal.options.theme = getTerminalTheme(theme)
  }
})

onMounted(async () => {
  await nextTick()
  await initTerminal()
})

onUnmounted(() => {
  terminalStore.destroyEmbeddedInstance(props.toolCallId)
  removeDataListener?.()
  removeExitListener?.()
  stopThemeWatch()
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
