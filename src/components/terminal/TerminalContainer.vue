<template>
  <div class="terminal-container" ref="containerRef"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api } from '@/services/electronAPI'
import { useTerminalStore } from '@/stores/terminal'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  tabId: string
}>()

const emit = defineEmits<{
  ready: []
  error: [message: string]
  exit: [code: number]
}>()

const containerRef = ref<HTMLElement | null>(null)
const terminalStore = useTerminalStore()

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let terminalId: string | null = null

let removeDataListener: (() => void) | null = null
let removeExitListener: (() => void) | null = null
let resizeObserver: ResizeObserver | null = null
let contextmenuHandler: ((e: Event) => void) | null = null

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
    white: '#171717',
    brightBlack: '#525252',
    brightRed: '#ef4444',
    brightGreen: '#22c55e',
    brightYellow: '#f59e0b',
    brightBlue: '#3b82f6',
    brightMagenta: '#8b5cf6',
    brightCyan: '#06b6d4',
    brightWhite: '#171717',
  }
}

/**
 * 从剪贴板读取文本并粘贴到终端
 */
async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (text && terminalId) {
      api.terminal.write(terminalId, text)
    }
  } catch (e) {
    console.warn('[TerminalContainer] Paste failed:', e)
  }
}

async function initTerminal() {
  if (!containerRef.value) {
    emit('error', 'Terminal container not available')
    return
  }

  const tab = terminalStore.tabs.find(t => t.id === props.tabId)
  if (!tab) {
    emit('error', 'Tab not found')
    return
  }

  try {
    // 检查是否已有存活的终端实例（切换页面后重新挂载的场景）
    const existingInstance = terminalStore.instances.get(props.tabId)
    const existingTerminalId = existingInstance?.terminalId ?? null
    const isAlive = existingInstance?.isAlive ?? false
    const isReconnect = existingTerminalId !== null && isAlive

    if (isReconnect && existingTerminalId) {
      // 重连到已有的 pty 进程，不创建新终端
      terminalId = existingTerminalId
    } else {
      // 创建新的 pty 进程
      const plainEnv = tab.env ? JSON.parse(JSON.stringify(tab.env)) : undefined
      const result = await api.terminal.create({
        cwd: tab.cwd,
        env: plainEnv
      })

      if (!result.id) {
        emit('error', result.error || 'Failed to create terminal')
        return
      }

      terminalId = result.id
      terminalStore.setInstanceTerminalId(props.tabId, terminalId)
    }

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

    terminal.open(containerRef.value)

    await nextTick()
    setTimeout(() => {
      try {
        fitAddon?.fit()
      } catch (e) {
        // Ignore fit errors
      }
    }, 50)

    // 右键菜单：有选区时复制，无选区时粘贴
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
            console.warn('[TerminalContainer] Copy failed:', err)
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
      // Ctrl+Shift+V (通用粘贴快捷键) 或 Ctrl+V (在终端上下文中粘贴)
      if ((event.ctrlKey && event.shiftKey && event.key === 'V') ||
          (event.ctrlKey && !event.shiftKey && event.key === 'v')) {
        if (event.type === 'keydown') {
          pasteFromClipboard()
        }
        return false // 阻止默认行为
      }
      // Ctrl+Shift+C (复制快捷键)
      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        // 允许默认行为（浏览器/xterm 自带的选区复制）
        return true
      }
      return true
    })

    terminal.onData((data: string) => {
      if (terminalId) {
        api.terminal.write(terminalId, data)
      }
    })

    removeDataListener = api.terminal.onData((id: string, data: string) => {
      if (id === terminalId && terminal) {
        terminal.write(data)
      }
    })

    removeExitListener = api.terminal.onExit((id: string, exitCode: number) => {
      if (id === terminalId) {
        terminalStore.markInstanceDead(props.tabId)
        emit('exit', exitCode)
      }
    })

    terminal.onResize(({ cols, rows }) => {
      if (terminalId) {
        api.terminal.resize(terminalId, cols, rows)
      }
    })

    resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon?.fit()
      } catch (e) {
        // Ignore fit errors during resize
      }
    })
    resizeObserver.observe(containerRef.value)

    // 重连时触发 resize 以让 shell 重绘提示符
    if (isReconnect && terminalId) {
      setTimeout(() => {
        try {
          const cols = terminal?.cols
          const rows = terminal?.rows
          if (cols && rows && terminalId) {
            api.terminal.resize(terminalId, cols, rows)
          }
        } catch (e) {
          // Ignore
        }
      }, 100)
    }

    terminalStore.setTabReady(props.tabId, true)
    emit('ready')

    // 仅对新创建的终端执行自动命令（重连时不重复执行）
    if (!isReconnect && tab.autoCommand && terminalId) {
      setTimeout(() => {
        api.terminal.runCommand(terminalId!, tab.autoCommand!)
      }, 800)
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
    api.terminal.runCommand(terminalId, command)
  }
}

function clear() {
  terminal?.clear()
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
  // 不在此处杀死 pty 进程 —— 终端可能在切换页面后重新挂载
  // pty 进程在 terminalStore.closeTab() 时统一杀死
  removeDataListener?.()
  removeExitListener?.()
  resizeObserver?.disconnect()
  themeObserver.disconnect()

  // 移除右键菜单监听
  if (contextmenuHandler && containerRef.value) {
    containerRef.value.removeEventListener('contextmenu', contextmenuHandler)
  }
  contextmenuHandler = null

  terminal?.dispose()
  terminal = null
  fitAddon = null
})

defineExpose({ focus, runCommand, clear })
</script>

<style lang="scss" scoped>
.terminal-container {
  width: 100%;
  height: 100%;
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
</style>
