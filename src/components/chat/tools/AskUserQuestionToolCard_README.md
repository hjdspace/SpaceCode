# AskUserQuestionToolCard 组件

## 概述

这是一个用于显示 `AskUserQuestion` 工具调用的Vue组件，实现了方案4的浮动气泡式设计。

## 组件位置

`/workspace/src/components/chat/tools/AskUserQuestionToolCard.vue`

## 功能特性

- ✅ 支持单个和多个问题
- ✅ 支持单选和多选模式
- ✅ 响应式设计，适配桌面和移动端
- ✅ 渐变背景和阴影效果
- ✅ 平滑的动画过渡
- ✅ 无障碍的键盘导航支持

## 数据结构

组件接收 `ToolCall` 类型的props：

```typescript
interface ToolCall {
  id: string
  name: string
  input: {
    questions: Array<{
      question: string      // 问题文本
      header: string        // 标签/芯片文本
      options: Array<{
        label: string       // 选项标签
        description?: string // 选项描述
        preview?: string    // 可选预览内容
      }>
      multiSelect?: boolean // 是否支持多选
    }>
  }
  status: 'pending' | 'running' | 'completed' | 'error'
}
```

## 事件

组件会触发以下事件：

- `submit` - 用户点击提交按钮时触发，携带答案对象
- `skip` - 用户点击跳过按钮时触发

## 使用示例

```vue
<template>
  <AskUserQuestionToolCard 
    :tool-call="toolCall"
    @submit="handleSubmit"
    @skip="handleSkip"
  />
</template>

<script setup>
import AskUserQuestionToolCard from './AskUserQuestionToolCard.vue'
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

function handleSubmit(answers) {
  console.log('用户答案:', answers)
  // 需要实现：将答案发送回后端
  // chatStore.submitAskUserQuestion(toolCall.id, answers)
}

function handleSkip() {
  console.log('用户跳过')
  // 需要实现：通知后端用户跳过
}
</script>
```

## 样式定制

组件使用CSS变量进行样式控制，确保与项目主题系统兼容：

- `--accent-primary` - 主强调色
- `--accent-secondary` - 次强调色
- `--surface-glass` - 玻璃态背景
- `--surface-border` - 边框颜色
- `--text-primary` - 主文本颜色
- `--text-secondary` - 次文本颜色
- `--text-muted` - 弱化文本颜色

## 待集成事项

1. **IPC通信** - 需要在主进程中添加处理submit和skip事件的处理器
2. **状态管理** - 需要在chat store中添加相应方法来处理答案提交
3. **生命周期** - 考虑是否需要将组件作为全局对话框显示

## 文件修改

- ✅ 新建：`src/components/chat/tools/AskUserQuestionToolCard.vue`
- ✅ 修改：`src/components/chat/tools/index.ts` - 注册组件
- ✅ 修改：`src/components/chat/ToolCallList.vue` - 添加图标和事件处理
- ✅ 修改：`src/components/chat/MessageItem.vue` - 事件转发

## 事件流

组件的完整事件流如下：
1. `AskUserQuestionToolCard` → 发出 `submit` 或 `skip` 事件
2. → `ToolCallList` 接收并转发 → 发出 `toolSubmit` 或 `toolSkip`
3. → `MessageItem` 接收并转发 → 发出 `toolSubmit` 或 `toolSkip`
4. → 需要在父组件（App.vue 或其他）中继续处理

## 后续步骤

1. 在 `electron/` 目录中添加IPC处理器来处理用户答案
2. 在 `src/stores/chat.ts` 中添加 `submitAskUserQuestion` 方法
3. 在 App.vue 或相关父组件中添加事件监听器
4. 测试组件的完整交互流程