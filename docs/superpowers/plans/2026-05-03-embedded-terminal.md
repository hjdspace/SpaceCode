# 内嵌终端功能实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 Bash 工具卡片中嵌入可交互的实时终端，替代当前的静态文本输出方式

**架构：** 创建独立的 `EmbeddedTerminal` 组件，复用现有的 `TerminalContainer` 核心逻辑，通过 `terminal.ts` store 管理内嵌终端实例的生命周期。BashToolCard 在检测到需要交互的命令时，动态创建内嵌终端实例。

**技术栈：** Vue 3 + TypeScript + Pinia + xterm.js + Electron Terminal API

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/components/terminal/EmbeddedTerminal.vue` | 内嵌终端组件，封装终端创建、数据流、生命周期管理 |
| `src/stores/terminal.ts` | 扩展 store，添加内嵌终端实例管理 |
| `src/components/chat/tools/BashToolCard.vue` | 改造为支持内嵌终端模式，集成 EmbeddedTerminal |
| `src/types/index.ts` | 扩展 ToolCall 类型，添加终端相关字段 |

---

## 任务 1：扩展类型定义

**文件：**
- 修改：`src/types/index.ts:15-25`

- [ ] **步骤 1：在 ToolCall 接口中添加终端相关字段**

```typescript
export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
  output?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  startTime?: number
  endTime?: number
  // 新增字段
  terminalId?: string        // 关联的终端实例 ID
  isInteractive?: boolean    // 是否以内嵌终端方式执行
}
```

- [ ] **步骤 2：Commit**

```bash
git add src/types/index.ts
git commit -m "types: 为 ToolCall 添加终端相关字段"
```

---

## 任务 2：扩展 Terminal Store

**文件：**
- 修改：`src/stores/terminal.ts`

- [ ] **步骤 1：在 store 中添加内嵌终端管理状态**

在 `src/stores/terminal.ts` 中，在 `counter` 定义后添加：

```typescript
// 内嵌终端实例管理
const embeddedInstances = ref<Map<string, EmbeddedTerminalInstance>>(new Map())

export interface EmbeddedTerminalInstance {
  id: string           // 格式：embedded-{toolCallId}
  toolCallId: string   // 关联的 ToolCall ID
  terminalId: string   // 后端终端 ID
  isAlive: boolean
  cwd?: string
}
```

- [ ] **步骤 2：添加内嵌终端管理方法**

在 `closeTab` 函数后添加：

```typescript
// ===== 内嵌终端管理方法 =====

function createEmbeddedInstance(toolCallId: string, cwd?: string): string | null {
  const id = `embedded-${toolCallId}`
  
  const instance: EmbeddedTerminalInstance = {
    id,
    toolCallId,
    terminalId: '',  // 将在终端创建后设置
    isAlive: false,
    cwd
  }
  
  embeddedInstances.value.set(toolCallId, instance)
  return id
}

function setEmbeddedTerminalId(toolCallId: string, terminalId: string): void {
  const instance = embeddedInstances.value.get(toolCallId)
  if (instance) {
    instance.terminalId = terminalId
    instance.isAlive = true
  }
}

function markEmbeddedInstanceDead(toolCallId: string): void {
  const instance = embeddedInstances.value.get(toolCallId)
  if (instance) {
    instance.isAlive = false
  }
}

function destroyEmbeddedInstance(toolCallId: string): void {
  const instance = embeddedInstances.value.get(toolCallId)
  if (instance && instance.terminalId) {
    api.terminal.kill(instance.terminalId)
  }
  embeddedInstances.value.delete(toolCallId)
}

function getEmbeddedInstance(toolCallId: string): EmbeddedTerminalInstance | null {
  return embeddedInstances.value.get(toolCallId) || null
}
```

- [ ] **步骤 3：在 return 语句中导出新增方法**

在 store 的 return 对象中添加：

```typescript
return {
  // ... 现有导出
  
  // 内嵌终端
  embeddedInstances,
  createEmbeddedInstance,
  setEmbeddedTerminalId,
  markEmbeddedInstanceDead,
  destroyEmbeddedInstance,
  getEmbeddedInstance,
}
```

- [ ] **步骤 4：Commit**

```bash
git add src/stores/terminal.ts
git commit -m "feat(terminal): 添加内嵌终端实例管理功能"
```

---

## 任务 3：创建 EmbeddedTerminal 组件

**文件：**
- 创建：`src/components/terminal/EmbeddedTerminal.vue`

- [ ] **步骤 1：创建组件文件并编写模板**

```vue
<template>
  <div class="embedded-terminal" ref="containerRef" :style="containerStyle">
    <div v-if="!isReady" class="terminal-loading">
      <span class="loading-text">Initializing terminal...</span>
    </div>
  </div>
</template>
```

- [ ] **步骤 2：编写 script setup 部分**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, computed } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api } from '@/services/electronAPI'
import { useTerminalStore } from '@/stores/terminal'
import '@xterm/xterm/css/xterm.css'

const props = defineProps<{
  toolCallId: string
  cwd?: string
  autoCommand?: string
  height?: number  // 默认高度（行数）
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
let removeDataListener: (() => void) | null = null
let removeExitListener: (() => void) | null = null

const containerStyle = computed(() => ({
  minHeight: `${(props.height || 12) * 20 + 16}px`  // 每行约20px + padding
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

  // 创建 store 中的内嵌实例记录
  terminalStore.createEmbeddedInstance(props.toolCallId, props.cwd)

  try {
    const result = await api.terminal.create({
      cwd: props.cwd,
      env: undefined
    })

    if (!result.id) {
      emit('error', result.error || 'Failed to create terminal')
      return
    }

    terminalId = result.id
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
    
    // 内嵌终端不需要 fit，使用固定行列数
    
    // 右键复制选中文本
    const containerEl = containerRef.value
    if (containerEl) {
      containerEl.addEventListener('contextmenu', async (e: Event) => {
        const selection = terminal?.getSelection()
        if (selection) {
          await navigator.clipboard.writeText(selection)
        }
        e.preventDefault()
      })
    }

    // 用户输入转发到终端
    terminal.onData((data: string) => {
      if (terminalId) {
        api.terminal.write(terminalId, data)
      }
    })

    // 监听终端输出
    removeDataListener = api.terminal.onData((id: string, data: string) => {
      if (id === terminalId && terminal) {
        terminal.write(data)
      }
    })

    // 监听终端退出
    removeExitListener = api.terminal.onExit((id: string, exitCode: number) => {
      if (id === terminalId) {
        terminalStore.markEmbeddedInstanceDead(props.toolCallId)
        emit('exit', exitCode)
      }
    })

    // 监听终端大小变化
    terminal.onResize(({ cols, rows }) => {
      if (terminalId) {
        api.terminal.resize(terminalId, cols, rows)
      }
    })

    isReady.value = true
    emit('ready', terminalId)

    // 如果有自动执行命令，延迟执行
    if (props.autoCommand && terminalId) {
      setTimeout(() => {
        api.terminal.runCommand(terminalId!, props.autoCommand!)
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
    api.terminal.runCommand(terminalId, command)
  }
}

function clear() {
  terminal?.clear()
}

function write(data: string) {
  if (terminalId) {
    api.terminal.write(terminalId, data)
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
  terminal?.dispose()
  terminal = null
  fitAddon = null
})

defineExpose({ focus, runCommand, clear, write })
</script>
```

- [ ] **步骤 3：编写样式部分**

```vue
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
```

- [ ] **步骤 4：Commit**

```bash
git add src/components/terminal/EmbeddedTerminal.vue
git commit -m "feat(terminal): 创建内嵌终端组件 EmbeddedTerminal"
```

---

## 任务 4：改造 BashToolCard 组件

**文件：**
- 修改：`src/components/chat/tools/BashToolCard.vue`

- [ ] **步骤 1：修改模板部分，添加内嵌终端支持**

将模板部分替换为：

```vue
<template>
  <div class="bash-tool-card" :class="[statusClass, { 'has-terminal': showTerminal }]">
    <div class="bash-header" @click="toggleExpand">
      <div class="bash-icon-wrapper"><Terminal :size="14" /></div>
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

    <div v-show="isExpanded" class="bash-body">
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
```

- [ ] **步骤 2：修改 script setup 部分**

```vue
<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Terminal, ChevronDown, Monitor } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import EmbeddedTerminal from '@/components/terminal/EmbeddedTerminal.vue'

const props = defineProps<{ toolCall: ToolCall }>()

const chatStore = useChatStore()
const isExpanded = ref(true)  // 默认展开以显示终端
const showTerminal = ref(false)
const terminalStatus = ref<'running' | 'completed' | 'error' | 'idle'>('idle')
const embeddedTerminalRef = ref<InstanceType<typeof EmbeddedTerminal> | null>(null)

// 终端高度（行数）
const terminalHeight = ref(12)

// 工作目录
const workingDirectory = computed(() => {
  return chatStore.workingDirectory || undefined
})

// 判断命令是否适合使用终端（交互式命令或长时间运行的命令）
const canUseTerminal = computed(() => {
  const cmd = props.toolCall.input?.command || ''
  // 以下命令适合使用终端
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

// 如果工具调用标记为交互式，自动启用终端
watch(() => props.toolCall.isInteractive, (isInteractive) => {
  if (isInteractive && !showTerminal.value) {
    showTerminal.value = true
    terminalStatus.value = 'running'
  }
}, { immediate: true })

// 如果命令正在运行且适合终端，自动启用
watch(() => props.toolCall.status, (status) => {
  if (status === 'running' && canUseTerminal.value && !showTerminal.value) {
    showTerminal.value = true
    terminalStatus.value = 'running'
  }
}, { immediate: true })
</script>
```

- [ ] **步骤 3：修改样式部分，添加终端相关样式**

在 `<style>` 部分添加：

```scss
/* 在原有样式基础上添加 */

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

/* 有终端时的卡片样式 */
.bash-tool-card.has-terminal {
  .bash-header {
    background: rgba(59, 130, 246, 0.05);
  }
}
```

- [ ] **步骤 4：Commit**

```bash
git add src/components/chat/tools/BashToolCard.vue
git commit -m "feat(bash): 集成内嵌终端到 BashToolCard"
```

---

## 任务 5：验证和测试

**文件：**
- 所有修改的文件

- [ ] **步骤 1：运行 TypeScript 类型检查**

```bash
npm run typecheck
# 或
npx vue-tsc --noEmit
```

预期：无类型错误

- [ ] **步骤 2：运行 ESLint 检查**

```bash
npm run lint
```

预期：无 lint 错误

- [ ] **步骤 3：构建项目**

```bash
npm run build
```

预期：构建成功

- [ ] **步骤 4：Commit 最终版本**

```bash
git add .
git commit -m "feat: 完成内嵌终端功能实现"
```

---

## 自检清单

- [x] **规格覆盖度**：所有需求都有对应任务
  - 内嵌终端组件创建 ✓
  - Store 扩展 ✓
  - BashToolCard 改造 ✓
  - 类型定义扩展 ✓

- [x] **占位符扫描**：无 "TODO"、"待定"、"后续实现"

- [x] **类型一致性**：
  - `EmbeddedTerminalInstance` 接口在 store 中定义
  - `ToolCall` 扩展字段在 types 中定义
  - 组件 props 类型一致

---

## 执行选项

**计划已完成并保存到 `docs/superpowers/plans/2026-05-03-embedded-terminal.md`。两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

**选哪种方式？**
