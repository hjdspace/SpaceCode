# 子代理工具卡片 UI 重设计与实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 [`AgentToolCard.vue`](file:///D:/AI/SpaceCode/src/components/chat/tools/AgentToolCard.vue) 从紫色圆角卡片改为时间线内可展开的行内文本行；折叠态显示小机器人图标 +「子智能体」+ Agent 类型 + 任务描述，展开态显示「提示词」与「子智能体输出」两个区块，并支持流式展示子代理实时输出。

**架构：** 新增 `useSubagentTranscript` composable，封装「当前 session → toolUseId → teammateId → teammateTranscripts」的查询，使 `AgentToolCard.vue` 既能渲染工具结果，也能订阅同个子代理的 sidechain 实时消息。UI 层复用现有主题变量与 `MarkdownRenderer`，保持与 [`ToolCallCard.vue`](file:///D:/AI/SpaceCode/src/components/chat/ToolCallCard.vue) 详情区域风格一致。

**技术栈：** Vue 3 + TypeScript + Pinia + vue-i18n + lucide-vue-next

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/composables/useSubagentTranscript.ts` | 新建：根据 `toolUseId` 从当前 session 获取对应子代理的实时转录消息数组。 |
| `src/components/chat/tools/AgentToolCard.vue` | 修改：重写模板与样式，改为行内可展开行；集成提示词与流式输出渲染。 |
| `src/i18n/locales/zh-CN.ts` | 修改：更新 `toolCards.agent` 为「子智能体」，新增 `agentOutput` 键。 |
| `src/i18n/locales/en-US.ts` | 修改：同步更新英文文案。 |

---

## 任务 1：新建 `useSubagentTranscript` composable

**文件：**
- 创建：`src/composables/useSubagentTranscript.ts`

**说明：** 封装查找逻辑，使 UI 组件不直接依赖 store 与 `teamTranscriptService` 的细节。返回一个响应式消息数组，当 sidechain 消息到达时自动更新。

- [ ] **步骤 1：编写 composable 实现**

```typescript
import type { Message } from '@/types'
import { useChatSessionStore } from '@/stores/chatSession'
import { teammateIdForParentToolUse, normalizeTeammateId } from '@/services/teamTranscriptService'
import { computed } from 'vue'

export function useSubagentTranscript(toolUseId: string) {
  const sessionStore = useChatSessionStore()

  const teammateId = computed(() => {
    const session = sessionStore.currentSession
    if (!session || !toolUseId) return null
    return teammateIdForParentToolUse(session.id, toolUseId) || normalizeTeammateId(toolUseId)
  })

  const messages = computed<Message[]>(() => {
    const session = sessionStore.currentSession
    if (!session || !teammateId.value) return []
    return session.teammateTranscripts?.[teammateId.value] || []
  })

  return { teammateId, messages }
}
```

- [ ] **步骤 2：检查类型与导入**

运行 `npx vue-tsc --noEmit` 或项目等效命令，预期无新增类型错误。

- [ ] **步骤 3：Commit**

```bash
git add src/composables/useSubagentTranscript.ts
git commit -m "feat: 添加 useSubagentTranscript composable 用于获取子代理实时转录"
```

---

## 任务 2：更新 i18n 文案

**文件：**
- 修改：`src/i18n/locales/zh-CN.ts`
- 修改：`src/i18n/locales/en-US.ts`

**说明：** 将折叠态标签从「Agent」改为「子智能体」，并新增「子智能体输出」标题。

- [ ] **步骤 1：修改中文 locale**

在 `src/i18n/locales/zh-CN.ts` 的 `toolCards` 对象中：

```typescript
agent: '子智能体',
agentDescription: '提示词',
agentResult: '子智能体输出',
```

- [ ] **步骤 2：修改英文 locale**

在 `src/i18n/locales/en-US.ts` 的 `toolCards` 对象中：

```typescript
agent: 'Sub-agent',
agentDescription: 'Prompt',
agentResult: 'Sub-agent output',
```

- [ ] **步骤 3：Commit**

```bash
git add src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat: 更新子代理工具卡片 i18n 文案"
```

---

## 任务 3：重构 `AgentToolCard.vue` 为行内可展开行

**文件：**
- 修改：`src/components/chat/tools/AgentToolCard.vue`

**说明：** 完全替换现有模板与样式。折叠态为文本行，展开态显示两个带标题的区块。

- [ ] **步骤 1：重写模板**

```vue
<template>
  <div class="agent-tool-row">
    <div class="agent-header" :class="{ 'is-expanded': isExpanded }" @click="toggleExpand">
      <Bot :size="14" class="agent-icon" :class="statusClass" />
      <span class="agent-label">{{ t('toolCards.agent') }}</span>
      <span class="agent-type">{{ agentTypeDisplay }}</span>
      <span class="agent-separator">·</span>
      <span class="agent-task">{{ taskSummary }}</span>
      <ChevronDown :size="14" class="expand-icon" :class="{ 'is-expanded': isExpanded }" />
    </div>

    <div v-if="isExpanded" class="agent-details">
      <div class="agent-section">
        <div class="section-label">{{ t('toolCards.agentDescription') }}</div>
        <pre class="prompt-block"><code>{{ promptText }}</code></pre>
      </div>
      <div class="agent-section">
        <div class="section-label">{{ t('toolCards.agentResult') }}</div>
        <div class="output-content">
          <MarkdownRenderer v-if="renderedOutput" :content="renderedOutput" />
          <div v-else-if="streamMessages.length" class="stream-messages">
            <div v-for="msg in streamMessages" :key="msg.id" class="stream-message">
              <MarkdownRenderer :content="msg.content" />
            </div>
          </div>
          <div v-else class="output-empty">{{ t('common.loading') }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
```

- [ ] **步骤 2：重写 script 逻辑**

```typescript
<script setup lang="ts">
import type { ToolCall } from '@/types'
import { Bot, ChevronDown } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import MarkdownRenderer from '@/components/common/MarkdownRenderer.vue'
import { parseAgentToolOutput } from '@/services/teamTranscriptService'
import { useSubagentTranscript } from '@/composables/useSubagentTranscript'

const props = defineProps<{ toolCall: ToolCall }>()
const isExpanded = ref(false)
const { t } = useI18n()
const { messages: streamMessages } = useSubagentTranscript(props.toolCall.id)

const statusClass = computed(() => `status-${props.toolCall.status}`)

const agentTypeDisplay = computed(() => {
  const type = props.toolCall.input?.agentType || props.toolCall.input?.type || 'general-purpose'
  return type === 'general-purpose' ? 'Agent' : String(type)
})

const taskSummary = computed(() => {
  const input = props.toolCall.input || {}
  const value = input.description || input.prompt || input.task || input.content || ''
  return typeof value === 'string' ? value : ''
})

const promptText = computed(() => {
  const input = props.toolCall.input || {}
  const value = input.prompt || input.description || input.task || input.content || ''
  return typeof value === 'string' ? value : JSON.stringify(input, null, 2)
})

const MAX_OUTPUT = 4000
const renderedOutput = computed(() => {
  if (streamMessages.value.length) return ''
  const o = props.toolCall.output || ''
  if (!o) return ''
  const { displayText } = parseAgentToolOutput(o)
  return displayText.length > MAX_OUTPUT ? displayText.slice(0, MAX_OUTPUT) + '\n\n...' : displayText
})

function toggleExpand() { isExpanded.value = !isExpanded.value }
</script>
```

- [ ] **步骤 3：重写样式**

```scss
<style lang="scss" scoped>
.agent-tool-row {
  display: inline-flex;
  flex-direction: column;
  max-width: 100%;
  font-size: 13px;
}

.agent-header {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);

  &:hover,
  &.is-expanded {
    background: var(--surface-glass-hover);
  }
}

.agent-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);

  &.status-running {
    color: var(--accent-tertiary);
    animation: spin 1s linear infinite;
  }

  &.status-completed {
    color: var(--success);
  }

  &.status-error {
    color: var(--error);
  }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.agent-label {
  font-size: 13px;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.agent-type {
  font-size: 13px;
  color: var(--accent-tertiary);
  font-weight: 500;
  flex-shrink: 0;
}

.agent-separator {
  font-size: 13px;
  color: var(--text-disabled);
  flex-shrink: 0;
}

.agent-task {
  font-size: 13px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.expand-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--text-muted);
  opacity: 0.5;
  transition: transform var(--transition-fast), opacity var(--transition-fast);

  &.is-expanded {
    transform: rotate(180deg);
  }
}

.agent-header:hover .expand-icon {
  opacity: 0.8;
}

.agent-details {
  margin-top: 4px;
  padding: 0 8px;
  animation: fadeIn 150ms ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.agent-section {
  margin-top: 12px;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--bg-secondary);
  overflow: hidden;

  &:first-child {
    margin-top: 0;
  }
}

.section-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-glass);
  border-bottom: 1px solid var(--surface-border);
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.prompt-block {
  margin: 0;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
  max-height: 320px;
  overflow-y: auto;
}

.output-content {
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  max-height: 360px;
  overflow-y: auto;
}

.output-empty {
  color: var(--text-muted);
  font-size: 13px;
}

.stream-messages {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.stream-message {
  &:not(:last-child) {
    border-bottom: 1px solid var(--surface-border);
    padding-bottom: 12px;
  }
}
</style>
```

- [ ] **步骤 4：运行类型检查**

运行 `npx vue-tsc --noEmit`，预期通过。

- [ ] **步骤 5：Commit**

```bash
git add src/components/chat/tools/AgentToolCard.vue
git commit -m "feat: 子代理工具卡片改为行内可展开行并支持流式输出"
```

---

## 任务 4：验证 UI

**文件：**
- 无需修改文件，仅验证。

**说明：** 启动开发服务器，手动检查三种状态（折叠、展开、运行中）和流式输出。

- [ ] **步骤 1：启动开发服务器**

```bash
npm run dev
```

- [ ] **步骤 2：打开应用并触发一个 Agent 工具调用**

观察：
1. 折叠态为行内文本行，无紫色卡片背景。
2. 点击后展开，显示「提示词」与「子智能体输出」两个区块。
3. 子代理运行时，输出区随 sidechain 消息实时追加内容。

- [ ] **步骤 3：截图或记录验证结果**

将验证截图保存到 `docs/superpowers/plans/2026-07-01-subagent-tool-card-redesign-validation.png`。

- [ ] **步骤 4：Commit 验证记录（可选）**

```bash
git add docs/superpowers/plans/2026-07-01-subagent-tool-card-redesign-validation.png
git commit -m "docs: 添加子代理工具卡片 UI 验证截图"
```

---

## 自检

**1. 规格覆盖度：**
- ✅ 折叠态改为文本行：任务 3 模板与样式。
- ✅ 小机器人图标：任务 3 使用 `Bot` 图标。
- ✅ 展开显示提示词：任务 3 的 `agent-section` 与 `promptText`。
- ✅ 展开显示子智能体输出：任务 3 的 `output-content`。
- ✅ 流式展示：任务 1 `useSubagentTranscript` + 任务 3 的 `streamMessages`。

**2. 占位符扫描：**
- 无「待定」「TODO」「后续实现」等模糊描述。
- 所有代码步骤均包含可直接使用的代码块。

**3. 类型一致性：**
- `useSubagentTranscript` 返回 `Message[]`，与 `teammateTranscripts` 类型一致。
- `AgentToolCard.vue` 仍接收 `ToolCall` prop，接口不变。

---

## 执行交接

**计划已完成并保存到 `docs/superpowers/plans/2026-07-01-subagent-tool-card-redesign.md`。两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

**选哪种方式？**
