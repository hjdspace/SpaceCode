# 聊天界面增强实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 优化聊天界面，展示工具调用和思考过程，支持 Markdown 渲染和响应式布局。

**架构：** 新增 ReasoningCard、ToolCallCard 等组件，扩展 Message 类型，更新 chat store 以提取和存储 thinking 内容和工具调用详情。

**技术栈：** Vue 3 + TypeScript + Pinia + SCSS

---

## 文件结构

### 新增文件

- `src/components/chat/ReasoningCard.vue` - 思考过程展示卡片
- `src/components/chat/ToolCallCard.vue` - 单个工具调用卡片
- `src/components/chat/ToolCallList.vue` - 工具调用列表
- `src/components/chat/MessageMetadata.vue` - 消息元数据展示

### 修改文件

- `src/types/index.ts` - 扩展 Message、ToolCall 类型，新增 ReasoningBlock、MessageMetadata
- `src/components/chat/MessageItem.vue` - 重构消息布局，集成新组件
- `src/stores/chat.ts` - 更新事件处理器，提取 thinking 内容

---

## 任务 1：扩展类型定义

**文件：**
- 修改：`src/types/index.ts`

- [ ] **步骤 1：添加 ReasoningBlock 接口**

```typescript
export interface ReasoningBlock {
  content: string
  startTime: number
  endTime?: number
  isExpanded?: boolean
}
```

- [ ] **步骤 2：扩展 ToolCall 接口**

```typescript
export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
  output?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  startTime?: number
  endTime?: number
}
```

- [ ] **步骤 3：添加 MessageMetadata 接口**

```typescript
export interface MessageMetadata {
  model?: string
  inputTokens?: number
  outputTokens?: number
  duration?: number
}
```

- [ ] **步骤 4：扩展 Message 接口**

```typescript
export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  reasoning?: ReasoningBlock
  toolCalls?: ToolCall[]
  metadata?: MessageMetadata
}
```

- [ ] **步骤 5：Commit**

```bash
git add src/types/index.ts
git commit -m "feat(types): extend Message type with reasoning, toolCalls, and metadata"
```

---

## 任务 2：创建 ReasoningCard 组件

**文件：**
- 创建：`src/components/chat/ReasoningCard.vue`

- [ ] **步骤 1：创建组件基础结构**

```vue
<template>
  <div class="reasoning-card" :class="{ 'is-thinking': isThinking, 'is-expanded': isExpanded }">
    <div class="reasoning-header" @click="toggleExpand">
      <Lightbulb :size="16" class="reasoning-icon" />
      <span class="reasoning-title">
        <template v-if="isThinking">
          思考中...
          <span class="thinking-time">({{ elapsedTime }}s)</span>
        </template>
        <template v-else>
          思考了 {{ duration }} 秒
        </template>
      </span>
      <ChevronDown v-if="!isThinking" :size="16" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    <div v-show="isExpanded || isThinking" class="reasoning-content">
      <MarkdownRenderer :content="reasoning.content" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ReasoningBlock } from '@/types'
import { Lightbulb, ChevronDown } from 'lucide-vue-next'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  reasoning: ReasoningBlock
}>()

const isExpanded = ref(props.reasoning.isExpanded ?? true)
const isThinking = computed(() => !props.reasoning.endTime)

const elapsedTime = computed(() => {
  const now = Date.now()
  const start = props.reasoning.startTime
  return ((now - start) / 1000).toFixed(1)
})

const duration = computed(() => {
  if (!props.reasoning.endTime) return 0
  return ((props.reasoning.endTime - props.reasoning.startTime) / 1000).toFixed(1)
})

function toggleExpand() {
  if (!isThinking.value) {
    isExpanded.value = !isExpanded.value
  }
}

// 思考中时自动刷新时间
let interval: number | null = null
watch(isThinking, (thinking) => {
  if (thinking) {
    interval = window.setInterval(() => {}, 100)
  } else if (interval) {
    clearInterval(interval)
    interval = null
  }
}, { immediate: true })
</script>

<style lang="scss" scoped>
.reasoning-card {
  margin: 8px 0;
  border-radius: 8px;
  border-left: 3px solid #6366f1;
  background: rgba(99, 102, 241, 0.05);
  overflow: hidden;
}

.reasoning-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: rgba(99, 102, 241, 0.08);
  }
}

.reasoning-icon {
  color: #6366f1;
  flex-shrink: 0;
}

.reasoning-title {
  flex: 1;
  font-size: 14px;
  color: #4b5563;
  font-weight: 500;
}

.thinking-time {
  color: #6b7280;
  font-weight: normal;
}

.expand-icon {
  color: #9ca3af;
  transition: transform 0.3s ease;

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.reasoning-content {
  padding: 0 12px 12px 36px;
  font-size: 14px;
  color: #4b5563;
  line-height: 1.6;
}

.is-thinking .reasoning-header {
  cursor: default;
}
</style>
```

- [ ] **步骤 2：Commit**

```bash
git add src/components/chat/ReasoningCard.vue
git commit -m "feat(chat): add ReasoningCard component for displaying thinking process"
```

---

## 任务 3：创建 ToolCallCard 组件

**文件：**
- 创建：`src/components/chat/ToolCallCard.vue`

- [ ] **步骤 1：创建组件基础结构**

```vue
<template>
  <div class="tool-call-card" :class="statusClass">
    <div class="tool-call-header" @click="toggleExpand">
      <div class="tool-icon-wrapper">
        <Loader2 v-if="toolCall.status === 'running'" :size="16" class="spin-icon" />
        <Check v-else-if="toolCall.status === 'completed'" :size="16" />
        <X v-else-if="toolCall.status === 'error'" :size="16" />
        <Clock v-else :size="16" />
      </div>
      <span class="tool-name">{{ toolCall.name }}</span>
      <span class="tool-status">{{ statusText }}</span>
      <span v-if="duration" class="tool-duration">{{ duration }}s</span>
      <ChevronDown :size="16" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>
    
    <div v-show="isExpanded" class="tool-call-details">
      <div class="tool-section">
        <div class="section-label">📥 输入参数</div>
        <pre class="code-block"><code>{{ formattedInput }}</code></pre>
      </div>
      
      <div v-if="toolCall.output" class="tool-section">
        <div class="section-label">📤 输出结果</div>
        <pre class="code-block"><code>{{ formattedOutput }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Loader2, Check, X, Clock, ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'

const props = defineProps<{
  toolCall: ToolCall
}>()

const isExpanded = ref(false)

const statusClass = computed(() => `status-${props.toolCall.status}`)

const statusText = computed(() => {
  const map = {
    pending: '等待中',
    running: '执行中',
    completed: '已完成',
    error: '出错'
  }
  return map[props.toolCall.status]
})

const duration = computed(() => {
  if (!props.toolCall.startTime) return null
  const end = props.toolCall.endTime || Date.now()
  return ((end - props.toolCall.startTime) / 1000).toFixed(1)
})

const formattedInput = computed(() => {
  return JSON.stringify(props.toolCall.input, null, 2)
})

const formattedOutput = computed(() => {
  if (!props.toolCall.output) return ''
  try {
    const parsed = JSON.parse(props.toolCall.output)
    return JSON.stringify(parsed, null, 2)
  } catch {
    return props.toolCall.output
  }
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<style lang="scss" scoped>
.tool-call-card {
  border-radius: 8px;
  border: 1px solid var(--surface-border);
  background: var(--surface-card);
  overflow: hidden;
  transition: all 0.3s ease;

  &.status-running {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.05);
  }

  &.status-completed {
    border-color: #22c55e;
    background: rgba(34, 197, 94, 0.05);
  }

  &.status-error {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.05);
  }

  &.status-pending {
    border-color: #9ca3af;
    opacity: 0.8;
  }
}

.tool-call-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: rgba(0, 0, 0, 0.02);
  }
}

.tool-icon-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  flex-shrink: 0;

  .status-running & {
    color: #3b82f6;
  }

  .status-completed & {
    color: #22c55e;
  }

  .status-error & {
    color: #ef4444;
  }

  .status-pending & {
    color: #9ca3af;
  }
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.tool-name {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.tool-status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-secondary);
}

.tool-duration {
  font-size: 12px;
  color: var(--text-secondary);
}

.expand-icon {
  color: #9ca3af;
  transition: transform 0.3s ease;

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.tool-call-details {
  padding: 0 12px 12px;
  border-top: 1px solid var(--surface-border);
}

.tool-section {
  margin-top: 12px;

  &:first-child {
    margin-top: 8px;
  }
}

.section-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.code-block {
  background: var(--surface-code);
  border-radius: 6px;
  padding: 10px;
  margin: 0;
  font-size: 13px;
  font-family: 'JetBrains Mono', monospace;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
}
</style>
```

- [ ] **步骤 2：Commit**

```bash
git add src/components/chat/ToolCallCard.vue
git commit -m "feat(chat): add ToolCallCard component for displaying tool calls"
```

---

## 任务 4：创建 ToolCallList 组件

**文件：**
- 创建：`src/components/chat/ToolCallList.vue`

- [ ] **步骤 1：创建组件基础结构**

```vue
<template>
  <div class="tool-call-list">
    <div class="tool-list-header">
      <Wrench :size="14" />
      <span>工具调用 ({{ toolCalls.length }})</span>
    </div>
    <div class="tool-list-content">
      <ToolCallCard
        v-for="tool in toolCalls"
        :key="tool.id"
        :tool-call="tool"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Wrench } from 'lucide-vue-next'
import ToolCallCard from './ToolCallCard.vue'

defineProps<{
  toolCalls: ToolCall[]
}>()
</script>

<style lang="scss" scoped>
.tool-call-list {
  margin: 8px 0;
}

.tool-list-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  padding: 0 4px;
}

.tool-list-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
```

- [ ] **步骤 2：Commit**

```bash
git add src/components/chat/ToolCallList.vue
git commit -m "feat(chat): add ToolCallList component"
```

---

## 任务 5：创建 MessageMetadata 组件

**文件：**
- 创建：`src/components/chat/MessageMetadata.vue`

- [ ] **步骤 1：创建组件基础结构**

```vue
<template>
  <div v-if="showMetadata" class="message-metadata">
    <span v-if="metadata.model">{{ metadata.model }}</span>
    <span v-if="tokenText">{{ tokenText }}</span>
    <span v-if="metadata.duration">{{ (metadata.duration / 1000).toFixed(1) }}s</span>
  </div>
</template>

<script setup lang="ts">
import type { MessageMetadata } from '@/types'
import { computed } from 'vue'

const props = defineProps<{
  metadata?: MessageMetadata
}>()

const showMetadata = computed(() => {
  return props.metadata && (props.metadata.model || props.metadata.inputTokens || props.metadata.duration)
})

const tokenText = computed(() => {
  if (!props.metadata) return ''
  const { inputTokens, outputTokens } = props.metadata
  if (inputTokens && outputTokens) {
    return `${inputTokens.toLocaleString()} + ${outputTokens.toLocaleString()} tokens`
  } else if (inputTokens) {
    return `${inputTokens.toLocaleString()} tokens`
  } else if (outputTokens) {
    return `${outputTokens.toLocaleString()} tokens`
  }
  return ''
})
</script>

<style lang="scss" scoped>
.message-metadata {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  font-size: 12px;
  color: #9ca3af;
  border-top: 1px solid var(--surface-border);

  span:not(:last-child)::after {
    content: '·';
    margin-left: 8px;
    opacity: 0.6;
  }
}
</style>
```

- [ ] **步骤 2：Commit**

```bash
git add src/components/chat/MessageMetadata.vue
git commit -m "feat(chat): add MessageMetadata component"
```

---

## 任务 6：重构 MessageItem 组件

**文件：**
- 修改：`src/components/chat/MessageItem.vue`

- [ ] **步骤 1：读取现有文件内容**

运行：`cat src/components/chat/MessageItem.vue`

- [ ] **步骤 2：更新模板部分**

```vue
<template>
  <div class="message-item" :class="[message.role]">
    <div class="message-avatar">
      <User v-if="message.role === 'user'" :size="16" />
      <Bot v-else :size="16" />
    </div>
    
    <div class="message-body">
      <div class="message-header">
        <span class="role-label">{{ message.role === 'user' ? 'You' : 'Claude' }}</span>
        <span class="timestamp">{{ formatTime(message.timestamp) }}</span>
      </div>
      
      <!-- 思考过程 -->
      <ReasoningCard v-if="message.reasoning" :reasoning="message.reasoning" />
      
      <!-- 工具调用 -->
      <ToolCallList v-if="message.toolCalls?.length" :tool-calls="message.toolCalls" />
      
      <!-- 消息内容 -->
      <div class="message-content">
        <MarkdownRenderer 
          v-if="message.role === 'assistant'" 
          :content="message.content" 
        />
        <p v-else>{{ message.content }}</p>
      </div>
      
      <!-- 元数据 -->
      <MessageMetadata v-if="message.role === 'assistant'" :metadata="message.metadata" />
    </div>
  </div>
</template>
```

- [ ] **步骤 3：更新 script 部分**

```typescript
<script setup lang="ts">
import type { Message } from '@/types'
import { User, Bot } from 'lucide-vue-next'
import MarkdownRenderer from '../common/MarkdownRenderer.vue'
import ReasoningCard from './ReasoningCard.vue'
import ToolCallList from './ToolCallList.vue'
import MessageMetadata from './MessageMetadata.vue'

defineProps<{
  message: Message
}>()

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })    
}
</script>
```

- [ ] **步骤 4：更新 style 部分**

添加响应式样式：

```scss
@media (max-width: 768px) {
  .message-item {
    gap: 8px;
    padding: 12px 0;
  }

  .message-body {
    max-width: 100%;
  }

  .message-content {
    font-size: 14px;
  }
}
```

- [ ] **步骤 5：Commit**

```bash
git add src/components/chat/MessageItem.vue
git commit -m "feat(chat): refactor MessageItem to integrate ReasoningCard, ToolCallList, and MessageMetadata"
```

---

## 任务 7：更新 chat store

**文件：**
- 修改：`src/stores/chat.ts`

- [ ] **步骤 1：添加 reasoning 提取逻辑**

在 `handleStreamEvent` 函数中添加：

```typescript
const handleStreamEvent = (streamEvent: any) => {
  if (isCompleted) return
  const event = streamEvent.event || streamEvent
  
  // 处理文本增量
  if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta?.text) {
    accumulatedContent += event.delta.text
    streamingContent.value = accumulatedContent
    nextTick(() => {
      updateMessage(assistantMessageId, { content: accumulatedContent })
    })
  }
  
  // 处理 reasoning 增量
  if (event.type === 'content_block_delta' && event.delta?.type === 'reasoning_delta' && event.delta?.reasoning) {
    const session = sessions.value.find(s => s.id === currentSessionId.value)
    if (session) {
      const msg = session.messages.find(m => m.id === assistantMessageId)
      if (msg) {
        if (!msg.reasoning) {
          msg.reasoning = {
            content: '',
            startTime: Date.now(),
            isExpanded: true
          }
        }
        msg.reasoning.content += event.delta.reasoning
        saveToStorage()
      }
    }
  }
}
```

- [ ] **步骤 2：更新 tool use 处理逻辑**

修改 `handleToolUse`：

```typescript
const handleToolUse = (toolUse: any) => {
  const session = sessions.value.find(s => s.id === currentSessionId.value)
  if (session) {
    const msg = session.messages.find(m => m.id === assistantMessageId)
    if (msg) {
      if (!msg.toolCalls) msg.toolCalls = []
      msg.toolCalls.push({
        id: toolUse.id || crypto.randomUUID(),
        name: toolUse.name,
        input: toolUse.input || {},
        status: 'running',
        startTime: Date.now()
      })
      saveToStorage()
    }
  }
}
```

- [ ] **步骤 3：更新 tool result 处理逻辑**

修改 `handleToolResult`：

```typescript
const handleToolResult = (toolResult: any) => {
  const session = sessions.value.find(s => s.id === currentSessionId.value)
  if (session) {
    const msg = session.messages.find(m => m.id === assistantMessageId)
    if (msg?.toolCalls) {
      const toolCall = msg.toolCalls.find(tc => tc.id === toolResult.tool_use_id)
      if (toolCall) {
        toolCall.status = toolResult.is_error ? 'error' : 'completed'
        toolCall.output = toolResult.output
        toolCall.endTime = Date.now()
        saveToStorage()
      }
    }
  }
}
```

- [ ] **步骤 4：添加 reasoning 完成处理**

在 `handleResult` 中添加：

```typescript
const handleResult = (result: any) => {
  if (isCompleted) return
  isCompleted = true
  streamingContent.value = ''
  isLoading.value = false
  
  // 标记 reasoning 完成
  const session = sessions.value.find(s => s.id === currentSessionId.value)
  if (session) {
    const msg = session.messages.find(m => m.id === assistantMessageId)
    if (msg?.reasoning && !msg.reasoning.endTime) {
      msg.reasoning.endTime = Date.now()
      msg.reasoning.isExpanded = false
    }
    // 添加元数据
    msg.metadata = {
      model: settingsStore.config.model,
      duration: Date.now() - msg.timestamp
    }
    saveToStorage()
  }
  
  cleanup()
  resolve()
}
```

- [ ] **步骤 5：Commit**

```bash
git add src/stores/chat.ts
git commit -m "feat(chat): update chat store to extract and store reasoning and tool call details"
```

---

## 任务 8：验证和测试

- [ ] **步骤 1：运行类型检查**

运行：`npx vue-tsc --noEmit`
预期：无类型错误

- [ ] **步骤 2：运行构建**

运行：`npm run build`
预期：构建成功

- [ ] **步骤 3：手动测试**

1. 发送消息触发工具调用
2. 验证工具调用卡片显示正确
3. 验证思考过程提取和显示（如果 API 支持）
4. 验证响应式布局

- [ ] **步骤 4：Commit**

```bash
git commit -m "test: verify chat UI enhancement implementation"
```

---

## 自检清单

- [ ] 所有类型定义正确扩展
- [ ] 新组件可以正确导入和使用
- [ ] MessageItem 正确集成新组件
- [ ] chat store 正确提取和存储数据
- [ ] 响应式布局适配正确
- [ ] 构建无错误

---

## 执行选项

**计划已完成并保存到 `docs/superpowers/plans/2025-04-24-chat-ui-enhancement.md`。两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

**选哪种方式？**
