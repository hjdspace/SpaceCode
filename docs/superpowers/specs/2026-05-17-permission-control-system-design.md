# 权限控制系统设计规格

**日期：** 2026-05-17
**状态：** ✅ 已批准
**方案：** 方案A - 通用权限审批卡片组件

---

## 1. 背景与问题

### 1.1 现状分析

Engine端已实现完整的权限控制体系：
- **4种权限模式**：`default`、`plan`、`acceptEdits`、`bypassPermissions`
- **权限请求机制**：通过 `control_request: can_use_tool` 发起权限审批
- **IPC通信层**：`setPermissionMode`、`allowPermission`、`denyPermission` 已实现

前端现状：
- ✅ `chat.ts` Store已有 `pendingPermissions` Map和权限处理方法
- ✅ [AskUserQuestionToolCard.vue](../../src/components/chat/tools/AskUserQuestionToolCard.vue) 实现了问题卡片
- ❌ **缺少权限模式选择器UI**
- ❌ **缺少通用权限审批卡片**（Edit/Bash等工具的权限请求无法展示）

### 1.2 用户需求

1. **模式切换UI**：在聊天输入框工具栏添加权限模式下拉选择器
2. **权限审批卡片**：当Engine发起`permission_request`时，在消息流中内嵌显示审批卡片
3. **响应式设计**：前端仅负责UI展示，审批逻辑由Engine根据当前模式决定

---

## 2. 设计目标

### 2.1 核心功能

- [x] 四种权限模式的可视化切换
- [x] 通用权限审批卡片（支持所有工具类型）
- [x] 无缝集成现有架构（IPC、Store、组件系统）
- [x] 响应式交互（允许/拒绝/始终允许）

### 2.2 非功能性需求

- **性能**：权限状态变更实时响应（<100ms）
- **可维护性**：单一职责，高复用性
- **扩展性**：支持未来新增工具类型
- **一致性**：符合项目现有UI规范

---

## 3. 架构设计

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (Vue 3)                          │
│                                                             │
│  ┌─────────────────┐    ┌──────────────────────────┐       │
│  │ ChatInput.vue   │    │ MessageList.vue          │       │
│  │ ┌─────────────┐ │    │ ┌────────────────────┐   │       │
│  │ │ Permission  │ │    │ │ MessageItem        │   │       │
│  │ │ ModeSelector│ │    │ │ ┌────────────────┐ │   │       │
│  │ └──────┬──────┘ │    │ │ │PermissionRequest│ │   │       │
│  │        │        │    │ │ │    Card.vue     │ │   │       │
│  │        ▼        │    │ │ └────────────────┘ │   │       │
│  │  setPermission  │    │ └────────────────────┘   │       │
│  │  Mode(mode)     │    │         ▲                │       │
│  └────────┬────────┘    └─────────┬────────────────┘       │
│           │                      │                         │
│           ▼                      ▼                         │
│  ┌─────────────────────────────────────────┐               │
│  │            chat.ts (Pinia Store)        │               │
│  │  - pendingPermissions: Map              │               │
│  │  - allowPermission()                   │               │
│  │  - denyPermission()                    │               │
│  │  - currentPermissionMode: ref          │               │  ← 新增
│  │  - setPermissionMode()                 │               │  ← 新增
│  └──────────────────┬──────────────────────┘               │
│                     │ IPC                                  │
└─────────────────────┼──────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│                   Electron Main Process                     │
│  claudeCodeIPC.ts → ClaudeCodeEngine                        │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 数据流时序

```
用户选择模式 → Store.setPermissionMode() → IPC → Engine更新模式
                                                                    ↓
用户发送消息 → Engine处理 → 判断是否需要权限 → 发起permission_request
                                                                    ↓
IPC推送 → Store.onPermissionRequest() → 更新pendingPermissions
                                                                    ↓
MessageList检测变化 → 渲染PermissionRequestCard → 用户操作
                                                                    ↓
Store.allowPermission/denyPermission() → IPC → Engine执行/拒绝
```

---

## 4. 组件详细设计

### 4.1 PermissionModeSelector.vue

**位置：** [ChatInput.vue](../../src/components/chat/ChatInput.vue) 工具栏左侧  
**职责：** 提供四种权限模式的可视化选择  

#### Props/State

```typescript
interface Props {
  // 无props，从chatStore读取当前模式
}

// 内部状态
const currentMode = ref<PermissionMode>('default')  // 从store读取
const isOpen = ref(false)  // 下拉菜单开关
```

#### 模式配置

```typescript
interface ModeOption {
  value: PermissionMode
  label: string
  description: string
  icon: Component
  color: string  // CSS变量引用
}

const modes: ModeOption[] = [
  {
    value: 'default',
    label: '默认模式',
    description: '敏感操作需确认',
    icon: Shield,
    color: 'var(--accent-primary)'
  },
  {
    value: 'plan',
    label: '计划模式',
    description: '只读，禁止写入',
    icon: Eye,
    color: 'var(--info-primary)'
  },
  {
    value: 'acceptEdits',
    label: '自动编辑',
    description: '文件修改自动放行',
    icon: Edit3,
    color: 'var(--success-primary)'
  },
  {
    value: 'bypassPermissions',
    label: '完全信任 ⚠️',
    description: '所有操作自动放行',
    icon: Zap,
    color: 'var(--warning-primary)'
  }
]
```

#### UI交互

- 点击触发按钮展开下拉菜单
- 选择模式后立即调用 `setPermissionMode()` 并关闭菜单
- 当前选中项显示勾选标记
- `bypassPermissions` 模式显示额外警告标识

#### 样式规范

- 高度：32px（与工具栏其他按钮一致）
- 图标尺寸：16px
- 下拉菜单宽度：280px
- 动画：Transition（dropdown类）
- 响应式：移动端全宽显示

---

### 4.2 PermissionRequestCard.vue

**位置：** 内嵌于消息流（[MessageList.vue](../../src/components/chat/MessageList.vue)）  
**职责：** 展示待处理的权限请求并提供操作按钮  

#### Props

```typescript
interface Props {
  messageId: string      // 所属消息ID
  toolUseId: string      // 工具调用ID（用于查找pending permission）
  toolName: string       // 工具名称（Edit/Bash/Write/Read）
  input: Record<string, unknown>  // 工具输入参数
}
```

#### 内部状态

```typescript
const status = ref<'pending' | 'processing' | 'completed' | 'denied'>('pending')
const isProcessing = ref(false)
```

#### 工具类型映射

```typescript
// 图标映射
const toolIconMap = {
  'Edit': FileEdit,
  'Write': FileEdit,
  'Read': FileText,
  'Bash': Terminal,
  'default': Shield
}

// 显示名称映射
const toolDisplayNameMap = {
  'Edit': '编辑文件',
  'Write': '写入文件', 
  'Read': '读取文件',
  'Bash': '执行命令',
  'default': '工具调用'
}
```

#### 动态内容渲染策略

| 工具类型 | 展示内容 | 子组件 |
|---------|---------|--------|
| **Edit/Write** | 文件路径 + Diff预览 | `FileInfo` + `DiffPreview` |
| **Bash** | 命令文本 + 安全警告 | `CommandPreview` |
| **Read** | 文件路径 + 操作说明 | `FileInfo` |
| **其他** | 通用JSON信息展示 | `GenericToolInfo` |

> **注意：** 初期版本可简化为纯文本展示，后续迭代增加Diff预览等高级功能。

#### 操作按钮逻辑

```typescript
async function handleAllow() {
  isProcessing.value = true
  status.value = 'processing'
  try {
    await chatStore.allowPermission(messageId, toolUseId, input)
    status.value = 'completed'
  } catch (error) {
    status.value = 'pending'  // 回退到待处理状态
  } finally {
    isProcessing.value = false
  }
}

async function handleDeny() {
  isProcessing.value = true
  status.value = 'processing'
  try {
    await chatStore.denyPermission(messageId, toolUseId)
    status.value = 'denied'
  } catch (error) {
    status.value = 'pending'
  } finally {
    isProcessing.value = false
  }
}

async function handleAlwaysAllow() {
  // "始终允许"使用 permanent classification
  await chatStore.allowPermission(messageId, toolUseId, input, 'user_permanent')
}
```

#### 条件渲染规则

- **"始终允许"按钮**：仅在 `['Edit', 'Read', 'Write']` 工具类型显示
- **危险指示器**：`Bash`工具显示 ⚠️ 图标
- **禁用状态**：处理中时禁用所有按钮

#### 样式规范

- 卡片宽度：100%（自适应消息流容器）
- 圆角：12px（与其他卡片一致）
- 边框：1px solid var(--surface-border)
- 背景：var(--surface-glass)
- 悬停效果：微妙的阴影提升
- 状态颜色：
  - pending: 默认样式
  - processing: 加载动画
  - completed: 绿色边框 + ✓图标
  - denied: 红色边框 + ✕图标

---

## 4.5 国际化（i18n）支持

### 4.5.1 现有i18n架构

项目使用 **vue-i18n** 实现国际化：
- 语言文件位置：`src/i18n/locales/{zh-CN,en-US}.ts`
- 使用方式：`const { t } = useI18n()` + `t('key.path')`
- 现有命名空间：`common`、`settings`、`chat`、`sidebar`、`chatInput`

**新增命名空间：** `permission`（权限相关翻译）

### 4.5.2 PermissionModeSelector i18n

#### zh-CN.ts 新增内容

```typescript
// 在 chatInput 对象内或新增 permission 对象
permission: {
  // 模式选择器
  modeSelector: {
    title: '权限模式',
    default: '默认模式',
    defaultDesc: '敏感操作需确认',
    plan: '计划模式',
    planDesc: '只读，禁止写入',
    acceptEdits: '自动编辑',
    acceptEditsDesc: '文件修改自动放行',
    bypassPermissions: '完全信任 ⚠️',
    bypassPermissionsDesc: '所有操作自动放行',
  },
  
  // 权限审批卡片
  card: {
    // 工具类型显示名
    toolNames: {
      Edit: '编辑文件',
      Write: '写入文件',
      Read: '读取文件',
      Bash: '执行命令',
      default: '工具调用',
    },
    
    // 操作按钮
    actions: {
      allow: '允许',
      deny: '拒绝',
      alwaysAllow: '始终允许',
      processing: '处理中...',
      completed: '已批准',
      denied: '已拒绝',
    },
    
    // 状态提示
    status: {
      dangerWarning: '⚠️ 需要确认',
      requestPending: '等待审批...',
    },
    
    // 错误信息
    errors: {
      allowFailed: '批准权限失败',
      denyFailed: '拒绝权限失败',
      ipcUnavailable: '权限服务不可用',
    },
  },
}
```

#### en-US.ts 新增内容

```typescript
permission: {
  modeSelector: {
    title: 'Permission Mode',
    default: 'Default',
    defaultDesc: 'Confirm sensitive operations',
    plan: 'Plan Mode',
    planDesc: 'Read-only, no writes',
    acceptEdits: 'Auto Edit',
    acceptEditsDesc: 'Auto-approve file edits',
    bypassPermissions: 'Full Trust ⚠️',
    bypassPermissionsDesc: 'Auto-approve all operations',
  },
  
  card: {
    toolNames: {
      Edit: 'Edit File',
      Write: 'Write File',
      Read: 'Read File',
      Bash: 'Run Command',
      default: 'Tool Call',
    },
    
    actions: {
      allow: 'Allow',
      deny: 'Deny',
      alwaysAllow: 'Always Allow',
      processing: 'Processing...',
      completed: 'Approved',
      denied: 'Denied',
    },
    
    status: {
      dangerWarning: '⚠️ Requires Confirmation',
      requestPending: 'Awaiting approval...',
    },
    
    errors: {
      allowFailed: 'Failed to approve permission',
      denyFailed: 'Failed to deny permission',
      ipcUnavailable: 'Permission service unavailable',
    },
  },
}
```

### 4.5.3 组件中使用i18n

#### PermissionModeSelector.vue 示例

```vue
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useChatStore } from '@/stores/chat'

const { t } = useI18n()
const chatStore = useChatStore()

// 模式配置使用i18n
const modes = [
  {
    value: 'default' as const,
    label: t('permission.modeSelector.default'),
    description: t('permission.modeSelector.defaultDesc'),
    icon: Shield,
  },
  {
    value: 'plan' as const,
    label: t('permission.modeSelector.plan'),
    description: t('permission.modeSelector.planDesc'),
    icon: Eye,
  },
  // ... 其他模式
]
</script>

<template>
  <div class="mode-dropdown">
    <div class="dropdown-header">{{ t('permission.modeSelector.title') }}</div>
    <button 
      v-for="mode in modes" 
      :class="{ active: currentMode === mode.value }"
    >
      {{ mode.label }}
      <span class="mode-desc">{{ mode.description }}</span>
    </button>
  </div>
</template>
```

#### PermissionRequestCard.vue 示例

```vue
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'

const { t } = useI18n()

// 动态获取工具显示名称
const toolDisplayName = computed(() => {
  const key = `permission.card.toolNames.${props.toolName}`
  // 如果有对应翻译则使用，否则回退到原始toolName
  return t(key, props.toolName)
})
</script>

<template>
  <div class="permission-request-card">
    <!-- 使用i18n -->
    <span class="tool-badge">{{ toolDisplayName }}</span>
    
    <div class="card-actions">
      <button class="deny">{{ t('permission.card.actions.deny') }}</button>
      <button class="allow primary">{{ t('permission.card.actions.allow') }}</button>
    </div>
  </div>
</template>
```

### 4.5.4 i18n最佳实践

1. **Key命名规范**
   - 使用点分法：`namespace.section.item`
   - 语义化：`permission.modeSelector.default` 而非 `permission.ms.default`

2. **Fallback策略**
   ```typescript
   // 带fallback的t()调用
   t('permission.card.toolNames.Edit', 'Edit')  // 第二个参数为fallback值
   ```

3. **复数与变量**
   ```typescript
   // 支持插值
   thinkingFor: '思考了 {duration}s',  // 已有示例
   
   // 权限卡片可扩展
   toolCallWithId: '工具调用 #{id}',
   ```

4. **测试覆盖**
   - 单元测试验证中英文切换正常
   - 截图对比测试确保布局不受文本长度影响

---

## 5. Store层扩展

### 5.1 chat.ts 新增内容

#### 新增状态

```typescript
import type { PermissionMode } from '@/electron/engines/types'

// 权限模式状态
const currentPermissionMode = ref<PermissionMode>('default')
```

#### 新增方法

```typescript
/**
 * 切换当前会话的权限模式
 * @param mode - 目标模式（default/plan/acceptEdits/bypassPermissions）
 */
async function setPermissionMode(mode: PermissionMode): Promise<void> {
  const sid = currentSessionId.value
  if (!sid) return
  
  const claudeCode = electronAPI?.claudeCode
  if (!claudeCode?.setPermissionMode) {
    logger.error('ChatStore', 'setPermissionMode: IPC not available')
    return
  }
  
  try {
    logger.info('ChatStore', `setPermissionMode | sessionId=${sid.slice(0, 8)} | mode=${mode}`)
    await claudeCode.setPermissionMode(sid, mode)
    currentPermissionMode.value = mode
  } catch (error) {
    logger.error('ChatStore', 'setPermissionMode failed', { error })
    throw error
  }
}
```

#### 导出更新

```typescript
return {
  // ... 已有导出
  
  // 权限模式（新增）
  currentPermissionMode: readonly(currentPermissionMode),
  setPermissionMode,
}
```

---

## 6. 集成点详解

### 6.1 ChatInput.vue 集成

**修改位置：** 工具栏左侧（+号按钮之前）

```vue
<template>
  <div class="input-toolbar">
    <div class="toolbar-left">
      <!-- 新增：权限模式选择器 -->
      <PermissionModeSelector />
      
      <!-- 现有：+号按钮 -->
      <button class="toolbar-btn" @click="handleAdd">...</button>
      
      <!-- 其他工具栏项... -->
    </div>
    
    <!-- 右侧：模型选择 + 发送按钮 -->
    <div class="toolbar-right">...</div>
  </div>
</template>

<script setup lang="ts">
import PermissionModeSelector from './PermissionModeSelector.vue'
</script>
```

### 6.2 MessageList.vue 集成

**核心逻辑：** 遍历消息列表时检测每条消息的toolCalls是否有pending permission

```vue
<template>
  <div class="message-list">
    <div v-for="msg in messages" :key="msg.id" class="message-wrapper">
      <!-- 消息本体 -->
      <MessageItem :message="msg" @tool-submit="handleToolSubmit" />
      
      <!-- 权限审批卡片（条件渲染） -->
      <template v-for="toolCall in msg.toolCalls" :key="`perm-${toolCall.id}`">
        <PermissionRequestCard
          v-if="hasPendingPermission(msg.id, toolCall.id)"
          :messageId="msg.id"
          :toolUseId="toolCall.id"
          :toolName="toolCall.name"
          :input="toolCall.input"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
import PermissionRequestCard from './tools/PermissionRequestCard.vue'

const chatStore = useChatStore()

function hasPendingPermission(messageId: string, toolUseId: string): boolean {
  return chatStore.hasPendingPermissionForToolUse(toolUseId)
}
</script>
```

**渲染时机：**
- 当 `chatStore.pendingPermissions` Map更新时（响应式触发）
- 仅渲染有对应pending request的toolCall
- 自动跟随消息位置（保持对话上下文）

---

## 7. 文件清单与改动量

### 7.1 新建文件（2个）

| 文件路径 | 用途 | 预估行数 |
|---------|------|---------|
| `src/components/chat/PermissionModeSelector.vue` | 权限模式选择器 | ~150 |
| `src/components/chat/tools/PermissionRequestCard.vue` | 通用权限审批卡片 | ~250 |

### 7.2 修改文件（5个）

| 文件路径 | 修改内容 | 改动量 |
|---------|---------|--------|
| [src/stores/chat.ts](../../src/stores/chat.ts) | 新增状态+方法 | +30行 |
| [src/components/chat/ChatInput.vue](../../src/components/chat/ChatInput.vue) | 集成选择器组件 | +15行 |
| [src/components/chat/MessageList.vue](../../src/components/chat/MessageList.vue) | 集成权限卡片渲染 | +40行 |
| [src/i18n/locales/zh-CN.ts](../../src/i18n/locales/zh-CN.ts) | 新增permission命名空间翻译 | +60行 |
| [src/i18n/locales/en-US.ts](../../src/i18n/locales/en-US.ts) | 新增permission命名空间翻译 | +60行 |

**总计：** 新建~400行，修改~205行

---

## 8. 实现计划（Phase划分）

### Phase 1: 基础设施（Store层 + i18n）✅
- [ ] 扩展 `chat.ts` 添加 `currentPermissionMode` 和 `setPermissionMode()`
- [ ] 新增 `permission` 命名空间到 `zh-CN.ts` 和 `en-US.ts`
- [ ] 单元测试：验证IPC调用和状态更新
- [ ] **验收标准：** 可通过代码调用切换模式，i18n key完整

### Phase 2: 模式选择器UI 🎨
- [ ] 创建 `PermissionModeSelector.vue` 组件（使用i18n）
- [ ] 实现4种模式的视觉差异化（图标/颜色/描述）
- [ ] 集成到 `ChatInput.vue` 工具栏
- [ ] 测试下拉菜单交互、响应式布局、中英文切换
- [ ] **验收标准：** 可视化切换4种模式，即时生效，双语正常

### Phase 3: 权限审批卡片 🃏
- [ ] 创建 `PermissionRequestCard.vue` 通用模板（使用i18n）
- [ ] 实现 Edit/Write/Bash 三种工具类型的差异化展示
- [ ] 集成到 `MessageList.vue` 自动检测逻辑
- [ ] 实现Allow/Deny/AlwaysAllow三种操作（使用i18n文案）
- [ ] 添加处理中/完成/拒绝的状态反馈
- [ ] **验收标准：** Engine发起请求时自动显示卡片，操作后正确回调

### Phase 4: 打磨与测试 🔍
- [ ] 全流程测试：切换模式→发送消息→触发权限→审批→结果
- [ ] 边界情况：并发请求、超时取消、网络错误
- [ ] 移动端适配测试
- [ ] 性能测试：大量权限请求时的渲染性能
- [ ] **验收标准：** 所有场景稳定运行，无明显性能问题

---

## 9. 技术风险与缓解措施

### 9.1 风险矩阵

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| IPC通信延迟导致UI卡顿 | 中 | 低 | 异步处理+loading状态 |
| 并发多个权限请求 | 中 | 中 | 队列管理+独立状态追踪 |
| Engine端取消请求 | 低 | 中 | 监听`permission_request_cancelled`事件 |
| 新工具类型未覆盖 | 低 | 高 | 降级为通用展示+日志警告 |

### 9.2 兜底策略

- **IPC失败**：显示错误提示toast，回退到上一模式
- **未知工具类型**：使用`GenericToolInfo`展示原始JSON
- **超时无响应**：30s后自动隐藏卡片并提示用户

---

## 10. 未来迭代方向（Out of Scope）

本设计聚焦核心功能，以下特性考虑在未来版本实现：

- [ ] **Diff预览增强**：Edit操作的代码高亮和行级diff对比
- [ ] **命令安全分析**：Bash命令的AST解析和风险评估
- [ ] **批量审批**：多选+批量Allow/Deny
- [ ] **权限历史记录**：查看本次会话的所有授权决策
- [ ] **自定义规则编辑器**：可视化配置`.claude/settings.json`
- [ ] **团队权限同步**：projectSettings层面的协作权限管理

---

## 11. 验收标准总结

### 功能完整性
- [x] 4种权限模式均可切换且生效
- [x] Edit/Bash/Write/Read工具的权限请求正确展示
- [x] Allow/Deny/AlwaysAllow操作正确回传Engine
- [x] 处理状态实时反馈（pending→processing→completed/denied）

### 用户体验
- [x] 模式选择器位置合理，操作直观
- [x] 权限卡片信息清晰，操作明确
- [x] 错误情况有友好提示
- [x] 响应流畅，无明显卡顿

### 代码质量
- [x] 组件单一职责，可复用
- [x] 类型完整，无any
- [x] 符合项目现有代码风格
- [x] 关键逻辑有单元测试

---

**文档版本：** 1.1 (新增i18n章节)
**最后更新：** 2026-05-17
**作者：** AI Assistant (Brainstorming Skill)
**批准人：** User
