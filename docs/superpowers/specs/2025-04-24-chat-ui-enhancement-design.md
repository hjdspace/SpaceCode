# 聊天界面增强设计文档

## 概述

优化 Claude Code Desktop 的聊天界面，展示工具调用、思考过程等关键信息，参考 Codex、Cursor 等现代 AI IDE 的交互设计。

## 目标

- 展示工具调用的完整生命周期（输入、执行中、输出）
- 展示模型的思考过程（reasoning/thinking）
- 支持 Markdown 渲染和代码高亮
- 响应式布局适配

## 非目标

- 时间线视图（暂不实现）
- Skill 调用详细步骤展示（当前无数据支持）
- 工具参数/结果复制功能（暂不实现）

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  MessageItem (消息容器)                                      │
│  ├─ MessageHeader (角色、时间戳)                             │
│  ├─ ReasoningCard (思考过程)                                 │
│  ├─ ToolCallList (工具调用列表)                              │
│  │   └─ ToolCallCard (单个工具调用)                          │
│  ├─ MessageContent (消息内容)                                │
│  └─ MessageMetadata (元数据: 模型、tokens、耗时)              │
└─────────────────────────────────────────────────────────────┘
```

## 数据模型扩展

```typescript
// src/types/index.ts

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  
  // 新增字段
  reasoning?: ReasoningBlock
  toolCalls?: ToolCall[]
  metadata?: MessageMetadata
}

export interface ReasoningBlock {
  content: string
  startTime: number
  endTime?: number
  isExpanded?: boolean
}

export interface ToolCall {
  id: string
  name: string
  input: Record<string, any>
  output?: string
  status: 'pending' | 'running' | 'completed' | 'error'
  startTime?: number
  endTime?: number
}

export interface MessageMetadata {
  model?: string
  inputTokens?: number
  outputTokens?: number
  duration?: number
}
```

## 组件设计

### 1. ReasoningCard (思考过程卡片)

**功能：**
- 展示模型的思考过程
- 执行中自动展开，完成后可折叠
- 显示思考耗时
- 支持 Markdown 渲染

**视觉设计：**
- 背景：淡紫色半透明 `rgba(99, 102, 241, 0.05)`
- 左边框：3px solid `#6366f1`
- 字体：14px，正常字体（非斜体）
- 图标：💭 或灯泡图标

**状态：**
- `thinking`: 显示"思考中..." + 动画 + 已用时间
- `completed`: 显示"思考了 X 秒" + 可展开查看详情

### 2. ToolCallCard (工具调用卡片)

**功能：**
- 展示单个工具调用的完整信息
- 可展开/折叠查看输入参数和输出结果
- 显示执行状态和耗时

**视觉设计：**

| 状态 | 边框颜色 | 图标 | 背景 |
|------|----------|------|------|
| pending | `#9ca3af` (灰) | ⏳ | 默认 |
| running | `#3b82f6` (蓝) | 🔄 旋转 | 淡蓝背景 |
| completed | `#22c55e` (绿) | ✅ | 淡绿背景 |
| error | `#ef4444` (红) | ❌ | 淡红背景 |

**布局：**
```
┌─ [图标] 工具名称 ─────────────── [状态] [展开/折叠] ─┐
│                                                     │
│  [折叠状态：只显示上面一行]                           │
├─────────────────────────────────────────────────────┤
│  📥 输入参数                                         │
│  ```json                                            │
│  { "pattern": "**/*.ts" }                           │
│  ```                                                │
├─────────────────────────────────────────────────────┤
│  📤 输出结果                                         │
│  ```json                                            │
│  ["src/index.ts", "src/utils.ts"]                   │
│  ```                                                │
└─────────────────────────────────────────────────────┘
```

### 3. ToolCallList (工具调用列表)

**功能：**
- 管理多个工具调用的展示
- 支持同时显示多个运行中的工具
- 按时间顺序排列

**布局：**
- 垂直堆叠多个 ToolCallCard
- 间距：8px

### 4. MessageMetadata (消息元数据)

**功能：**
- 展示消息的元信息
- 位于消息底部

**展示内容：**
```
Claude 3.7 Sonnet · 2,341 tokens · 5.2s
```

**视觉设计：**
- 字体：12px，灰色
- 对齐：右对齐
- 分隔符：· (中间点)

## 响应式布局

### 桌面端 (>1024px)

```
┌─────────────────────────────────────────────────────────────┐
│  [头像] 消息内容区域 (max-width: 85%)                        │
│         ┌─ ReasoningCard ─────────────────────────────┐    │
│         ├─ ToolCallList ──────────────────────────────┤    │
│         │  ├─ ToolCallCard                            │    │
│         │  └─ ToolCallCard                            │    │
│         ├─ MessageContent                             │    │
│         └─ MessageMetadata (右对齐)                    │    │
└─────────────────────────────────────────────────────────────┘
```

### 平板端 (768px-1024px)

- 与桌面端类似
- 卡片宽度占满消息区域

### 移动端 (<768px)

```
┌─────────────────────────────────────────────┐
│  [头像]                                     │
│  ┌─ ReasoningCard (折叠) ─────────────────┐ │
│  │ 💭 思考中... (1.2s)                    │ │
│  └─────────────────────────────────────────┘ │
│  ┌─ ToolCallList ─────────────────────────┐ │
│  │ ⏳ Glob · 0.3s                         │ │
│  │ 🔄 Grep · 1.2s                         │ │
│  └─────────────────────────────────────────┘ │
│  消息内容...                                 │
│                              模型 · tokens · 时间 │
└─────────────────────────────────────────────┘
```

**移动端适配：**
- 工具调用简化为单行展示
- 思考过程默认折叠
- 元数据字体更小

## 状态管理更新

### chat.ts Store 更新

1. **提取 thinking 内容**
   - 从 stream_event 中识别 reasoning 类型的事件
   - 存储到 message.reasoning

2. **更新 toolCalls 结构**
   - 添加 startTime/endTime
   - 支持存储 output

3. **计算 metadata**
   - 记录模型名称
   - 统计 tokens（如果 API 返回）
   - 计算总耗时

## 样式规范

### 颜色变量

```scss
// 思考卡片
--reasoning-bg: rgba(99, 102, 241, 0.05);
--reasoning-border: #6366f1;
--reasoning-text: #4b5563;

// 工具调用状态
--tool-pending: #9ca3af;
--tool-running: #3b82f6;
--tool-running-bg: rgba(59, 130, 246, 0.05);
--tool-success: #22c55e;
--tool-success-bg: rgba(34, 197, 94, 0.05);
--tool-error: #ef4444;
--tool-error-bg: rgba(239, 68, 68, 0.05);

// 元数据
--metadata-text: #9ca3af;
```

### 动画

```scss
// 思考中动画
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

// 旋转动画
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

// 卡片展开/折叠
transition: all 0.3s ease;
```

## 交互细节

1. **ReasoningCard**
   - 点击头部展开/折叠
   - 执行中不可折叠
   - 展开后显示完整内容

2. **ToolCallCard**
   - 点击头部展开/折叠
   - 展开后显示输入/输出
   - 代码块支持语法高亮

3. **流式更新**
   - 思考内容实时追加
   - 工具状态实时更新
   - 平滑滚动到底部

## 文件清单

### 新增文件

- `src/components/chat/ReasoningCard.vue`
- `src/components/chat/ToolCallCard.vue`
- `src/components/chat/ToolCallList.vue`
- `src/components/chat/MessageMetadata.vue`

### 修改文件

- `src/types/index.ts` - 扩展类型定义
- `src/components/chat/MessageItem.vue` - 重构消息布局
- `src/stores/chat.ts` - 更新事件处理

## 测试要点

1. 思考过程正确提取和展示
2. 工具调用状态流转正确
3. Markdown 和代码高亮正常
4. 响应式布局适配正确
5. 流式更新平滑无闪烁
