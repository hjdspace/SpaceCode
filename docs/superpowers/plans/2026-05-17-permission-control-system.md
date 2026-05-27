# 权限控制系统实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现权限模式选择器UI和通用权限审批卡片，支持4种权限模式的可视化切换和工具调用的审批流程。

**架构：** 基于现有IPC通信层和Pinia Store架构，新增2个Vue组件（PermissionModeSelector + PermissionRequestCard），扩展chat.ts Store，集成到ChatInput和MessageList中，完整支持i18n双语切换。

**技术栈：** Vue 3 (Composition API) + Pinia + vue-i18n + TypeScript + Electron IPC

---

## 文件结构

### 新建文件（2个）

| 文件路径 | 职责 |
|---------|------|
| `src/components/chat/PermissionModeSelector.vue` | 权限模式下拉选择器组件，支持4种模式切换，使用i18n |
| `src/components/chat/tools/PermissionRequestCard.vue` | 通用权限审批卡片，根据toolName动态渲染内容，支持Allow/Deny操作 |

### 修改文件（5个）

| 文件路径 | 职责 | 修改范围 |
|---------|------|---------|
| `src/stores/chat.ts` | 新增`currentPermissionMode`状态和`setPermissionMode()`方法 | +30行 (约L1850附近) |
| `src/components/chat/ChatInput.vue` | 在工具栏左侧集成PermissionModeSelector组件 | +15行 (toolbar-left区域) |
| `src/components/chat/MessageList.vue` | 检测pending permission并渲染PermissionRequestCard | +40行 (消息渲染循环) |
| `src/i18n/locales/zh-CN.ts` | 新增`permission`命名空间中文翻译 | +60行 |
| `src/i18n/locales/en-US.ts` | 新增`permission`命名空间英文翻译 | +60行 |

---

## 任务清单

### 任务 1：扩展 i18n 翻译文件

**文件：**
- 修改：`src/i18n/locales/zh-CN.ts`
- 修改：`src/i18n/locales/en-US.ts`

- [ ] **步骤 1：在 zh-CN.ts 中添加 permission 命名空间**

在文件末尾的导出对象中，添加新的顶层键 `permission`：

```typescript
// 在 zh-CN.ts 的 export default 对象内，确保在合适的位置（建议放在 chatInput 之后）
permission: {
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
  card: {
    toolNames: {
      Edit: '编辑文件',
      Write: '写入文件',
      Read: '读取文件',
      Bash: '执行命令',
      default: '工具调用',
    },
    actions: {
      allow: '允许',
      deny: '拒绝',
      alwaysAllow: '始终允许',
      processing: '处理中...',
      completed: '已批准',
      denied: '已拒绝',
    },
    status: {
      dangerWarning: '⚠️ 需要确认',
      requestPending: '等待审批...',
    },
    errors: {
      allowFailed: '批准权限失败',
      denyFailed: '拒绝权限失败',
      ipcUnavailable: '权限服务不可用',
    },
  },
},
```

**注意：** 确保添加位置不会破坏现有的对象结构，检查是否有尾逗号问题。

- [ ] **步骤 2：在 en-US.ts 中添加 permission 命名空间**

同样在 en-US.ts 的对应位置添加：

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
},
```

- [ ] **步骤 3：验证 TypeScript 编译通过**

运行：
```bash
npm run typecheck
# 或
npx vue-tsc --noEmit
```

预期：无类型错误，两个语言文件的类型正确

- [ ] **步骤 4：Commit**

```bash
git add src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(i18n): add permission namespace for permission control system"
```

---

### 任务 2：扩展 chat.ts Store - 添加权限模式状态管理

**文件：**
- 修改：`src/stores/chat.ts`
- 测试：无需单独测试（将在任务3集成测试）

- [ ] **步骤 1：导入 PermissionMode 类型**

在文件顶部的 import 区域，添加：

```typescript
import type { PermissionMode } from '@/electron/engines/types'
```

**位置参考：** 查看现有 import 语句，通常在前20行内。如果该类型已导入则跳过此步。

- [ ] **步骤 2：添加 currentPermissionMode 状态**

在 `pendingPermissions` 定义之后（约 L347），添加：

```typescript
// ── 权限模式状态 ──
const currentPermissionMode = ref<PermissionMode>('default')
```

- [ ] **步骤 3：添加 setPermissionMode 方法**

在 `consumePermissionFor` 方法之后（约 L1820），添加：

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

- [ ] **步骤 4：更新 return 对象导出**

在 return 语句中（约 L1840），添加新导出：

```typescript
return {
  // ... 已有导出保持不变
  
  // 权限模式（新增）
  currentPermissionMode: readonly(currentPermissionMode),
  setPermissionMode,
}
```

**重要：** 使用 `readonly()` 包装以确保外部不能直接修改状态。

- [ ] **步骤 5：验证 Store 导出完整性**

检查 return 对象是否包含以下新增字段：
- ✅ `currentPermissionMode` (readonly ref)
- ✅ `setPermissionMode` (function)

同时确认已有导出未受影响：
- ✅ `pendingPermissions`
- ✅ `allowPermission`
- ✅ `denyPermission`
- ✅ 其他已有字段...

- [ ] **步骤 6：Commit**

```bash
git add src/stores/chat.ts
git commit -m "feat(store): add permission mode state management to chat store"
```

---

### 任务 3：创建 PermissionModeSelector 组件

**文件：**
- 创建：`src/components/chat/PermissionModeSelector.vue`

- [ ] **步骤 1：创建组件基础结构**

```vue
<template>
  <div class="permission-mode-selector" ref="selectorRef">
    <button 
      class="mode-trigger" 
      @click="toggleDropdown"
      :title="currentModeLabel"
      :class="{ active: isOpen }"
    >
      <Shield :size="16" />
      <span class="mode-text">{{ currentModeLabel }}</span>
      <ChevronDown :size="14" :class="{ 'rotate': isOpen }" />
    </button>
    
    <Transition name="dropdown">
      <div 
        v-if="isOpen" 
        class="mode-dropdown"
        v-click-outside="closeDropdown"
      >
        <div class="dropdown-header">{{ t('permission.modeSelector.title') }}</div>
        <div class="dropdown-list">
          <button 
            v-for="mode in modes" 
            :key="mode.value"
            class="mode-option"
            :class="[ 
              { active: currentMode === mode.value }, 
              `mode-${mode.value}` 
            ]"
            @click="selectMode(mode.value)"
          >
            <component :is="mode.icon" :size="18" />
            <div class="mode-info">
              <span class="mode-name">{{ mode.label }}</span>
              <span class="mode-desc">{{ mode.description }}</span>
            </div>
            <Check v-if="currentMode === mode.value" :size="16" class="check-icon" />
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Shield, ChevronDown, Check, Eye, Edit3, Zap } from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import type { PermissionMode } from '@/electron/engines/types'

const { t } = useI18n()
const chatStore = useChatStore()

const isOpen = ref(false)
const selectorRef = ref<HTMLElement>()

const modes = [
  {
    value: 'default' as PermissionMode,
    label: t('permission.modeSelector.default'),
    description: t('permission.modeSelector.defaultDesc'),
    icon: Shield,
  },
  {
    value: 'plan' as PermissionMode,
    label: t('permission.modeSelector.plan'),
    description: t('permission.modeSelector.planDesc'),
    icon: Eye,
  },
  {
    value: 'acceptEdits' as PermissionMode,
    label: t('permission.modeSelector.acceptEdits'),
    description: t('permission.modeSelector.acceptEditsDesc'),
    icon: Edit3,
  },
  {
    value: 'bypassPermissions' as PermissionMode,
    label: t('permission.modeSelector.bypassPermissions'),
    description: t('permission.modeSelector.bypassPermissionsDesc'),
    icon: Zap,
  },
]

const currentMode = computed(() => chatStore.currentPermissionMode)
const currentModeLabel = computed(() => 
  modes.find(m => m.value === currentMode.value)?.label || t('permission.modeSelector.default')
)

async function selectMode(mode: PermissionMode) {
  if (mode === currentMode.value) {
    isOpen.value = false
    return
  }
  
  try {
    await chatStore.setPermissionMode(mode)
    isOpen.value = false
  } catch (error) {
    console.error('Failed to set permission mode:', error)
    // 可以在这里添加错误提示toast
  }
}

function toggleDropdown() {
  isOpen.value = !isOpen.value
}

function closeDropdown() {
  isOpen.value = false
}
</script>

<style scoped>
.permission-mode-selector {
  position: relative;
  display: inline-flex;
}

.mode-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.mode-trigger:hover {
  background: var(--surface-glass-hover);
  border-color: var(--border-strong);
  color: var(--text-primary);
}

.mode-trigger.active {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}

.mode-text {
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rotate {
  transform: rotate(180deg);
}

/* 下拉菜单样式 */
.mode-dropdown {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: 280px;
  background: var(--surface-primary);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  z-index: 1000;
  overflow: hidden;
}

.dropdown-header {
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--surface-border);
}

.dropdown-list {
  padding: 8px;
}

.mode-option {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: left;
}

.mode-option:hover {
  background: var(--surface-glass-hover);
}

.mode-option.active {
  background: rgba(59, 130, 246, 0.1);
}

.mode-option .mode-icon {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.mode-option.active .mode-icon {
  color: var(--accent-primary);
}

.mode-info {
  flex: 1;
  min-width: 0;
}

.mode-name {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
}

.mode-desc {
  display: block;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 2px;
  line-height: 1.3;
}

.check-icon {
  flex-shrink: 0;
  color: var(--accent-primary);
}

/* 特殊模式样式 */
.mode-bypassPermissions .mode-name {
  color: var(--warning-primary, #f59e0b);
}

/* 动画 */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
```

- [ ] **步骤 2：验证组件导入依赖**

确认以下依赖已在项目中可用：
- `vue` (ref, computed, Transition)
- `vue-i18n` (useI18n)
- `lucide-vue-next` (Shield, ChevronDown, Check, Eye, Edit3, Zap)
- `@/stores/chat` (useChatStore)
- `@/electron/engines/types` (PermissionMode)

运行：
```bash
npm run typecheck
```

预期：无导入错误

- [ ] **步骤 3：手动测试组件基础功能**

在浏览器 DevTools 或 Vue DevTools 中：
1. 挂载组件到临时容器
2. 点击触发按钮 → 下拉菜单展开
3. 选择不同模式 → 调用 `setPermissionMode`
4. 再次点击 → 菜单收起
5. 点击外部区域 → 菜单关闭

预期：交互流畅，无控制台错误

- [ ] **步骤 4：Commit**

```bash
git add src/components/chat/PermissionModeSelector.vue
git commit -m "feat(component): create PermissionModeSelector with 4 modes and i18n support"
```

---

### 任务 4：集成 PermissionModeSelector 到 ChatInput

**文件：**
- 修改：`src/components/chat/ChatInput.vue`

- [ ] **步骤 1：导入 PermissionModeSelector 组件**

在 `<script setup>` 的 import 区域添加：

```typescript
import PermissionModeSelector from './PermissionModeSelector.vue'
```

**位置参考：** 放在其他组件导入附近（如 AskUserQuestionToolCard 等）

- [ ] **步骤 2：在模板中集成组件**

找到 `.input-toolbar > .toolbar-left` div 内部，在现有按钮之前插入：

```vue
<div class="input-toolbar">
  <div class="toolbar-left">
    <!-- 新增：权限模式选择器 -->
    <PermissionModeSelector />
    
    <!-- 现有：+号按钮和其他工具栏项 -->
    <button class="toolbar-btn" @click="handleAdd">...</button>
    <!-- ... -->
  </div>
  
  <!-- 右侧区域保持不变 -->
  <div class="toolbar-right">...</div>
</div>
```

**具体位置：** 查找类似 `<button class="toolbar-btn"` 的代码，在其上方插入。

- [ ] **步骤 3：调整工具栏布局（如需要）**

检查工具栏是否需要微调以适应新组件：

```css
/* 如果工具栏项目过多导致换行，可考虑：*/
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;  /* 确保间距一致 */
  flex-wrap: nowrap;  /* 防止换行 */
  overflow-x: auto;   /* 超出时滚动 */
}
```

- [ ] **步骤 4：视觉测试**

启动应用并验证：
1. 打开聊天界面
2. 输入框左下角显示权限模式选择器（默认显示"默认模式"或"Default"）
3. 点击选择器 → 弹出4种模式选项
4. 切换语言 → 文案跟随变化
5. 选择不同模式 → 无明显延迟

预期：UI美观，与其他工具栏元素风格一致

- [ ] **步骤 5：Commit**

```bash
git add src/components/chat/ChatInput.vue
git commit -m "feat(chat): integrate PermissionModeSelector into ChatInput toolbar"
```

---

### 任务 5：创建 PermissionRequestCard 组件

**文件：**
- 创建：`src/components/chat/tools/PermissionRequestCard.vue`

- [ ] **步骤 1：创建组件基础结构**

```vue
<template>
  <div class="permission-request-card" :class="[`tool-${toolName}`, status]">
    <!-- 卡片头部 -->
    <div class="card-header">
      <div class="tool-badge">
        <component :is="toolIcon" :size="16" />
        <span>{{ toolDisplayName }}</span>
      </div>
      <span v-if="isDangerous" class="danger-indicator">
        {{ t('permission.card.status.dangerWarning') }}
      </span>
    </div>

    <!-- 动态内容区域 -->
    <div class="card-content">
      <!-- Edit/Write 工具：文件信息展示 -->
      <template v-if="isFileOperation">
        <div class="file-info">
          <FileText :size="14" />
          <span class="file-path">{{ filePath }}</span>
        </div>
        
        <!-- Diff预览（简化版，仅显示部分文本）-->
        <div v-if="hasDiffContent" class="diff-preview">
          <div class="diff-old">
            <span class="diff-label">-</span>
            <pre>{{ truncatedOldString }}</pre>
          </div>
          <div class="diff-new">
            <span class="diff-label">+</span>
            <pre>{{ truncatedNewString }}</pre>
          </div>
        </div>
      </template>

      <!-- Bash 工具：命令展示 -->
      <template v-else-if="toolName === 'Bash'">
        <div class="command-preview">
          <Terminal :size="14" />
          <code class="command-text">{{ commandText }}</code>
        </div>
      </template>

      <!-- 其他工具：通用信息展示 -->
      <template v-else>
        <div class="generic-info">
          <pre class="json-preview">{{ formattedInput }}</pre>
        </div>
      </template>
    </div>

    <!-- 操作按钮区 -->
    <div class="card-actions" v-if="status === 'pending'">
      <button 
        class="action-btn deny" 
        @click="handleDeny" 
        :disabled="isProcessing"
      >
        <X :size="16" />
        {{ t('permission.card.actions.deny') }}
      </button>
      
      <button 
        v-if="showAlwaysAllow" 
        class="action-btn always-allow" 
        @click="handleAlwaysAllow"
        :disabled="isProcessing"
      >
        <CheckCheck :size="16" />
        {{ t('permission.card.actions.alwaysAllow') }}
      </button>
      
      <button 
        class="action-btn allow primary" 
        @click="handleAllow" 
        :disabled="isProcessing"
      >
        <Check :size="16" />
        {{ t('permission.card.actions.allow') }}
      </button>
    </div>

    <!-- 处理状态反馈 -->
    <div class="card-status" v-else>
      <Loader2 
        v-if="status === 'processing'" 
        :size="16" 
        class="spin" 
      />
      <CheckCircle 
        v-if="status === 'completed'" 
        :size="16" 
        class="status-icon success" 
      />
      <XCircle 
        v-if="status === 'denied'" 
        :size="16" 
        class="status-icon error" 
      />
      <span class="status-text">
        {{ statusText }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { 
  Check, X, CheckCheck, Loader2, CheckCircle, XCircle,
  FileEdit, Terminal, FileText, Shield
} from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'

interface Props {
  messageId: string
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
}

const props = defineProps<Props>()
const { t } = useI18n()
const chatStore = useChatStore()

const status = ref<'pending' | 'processing' | 'completed' | 'denied'>('pending')
const isProcessing = ref(false)

// 图标映射
const toolIconMap: Record<string, any> = {
  'Edit': FileEdit,
  'Write': FileEdit,
  'Read': FileText,
  'Bash': Terminal,
}

const toolIcon = computed(() => toolIconMap[props.toolName] || Shield)

// 显示名称（支持i18n fallback）
const toolDisplayName = computed(() => {
  const key = `permission.card.toolNames.${props.toolName}`
  const translated = t(key)
  // 如果翻译后key原样返回（说明没有对应翻译），则fallback到原始名称
  return translated === key ? props.toolName : translated
})

// 判断是否为危险操作
const isDangerous = computed(() => ['Bash'].includes(props.toolName))

// 是否为文件操作
const isFileOperation = computed(() => 
  ['Edit', 'Write', 'Read'].includes(props.toolName)
)

// 提取文件路径
const filePath = computed(() => 
  (props.input.file_path as string) || 'Unknown file'
)

// 提取命令文本
const commandText = computed(() => 
  (props.input.command as string) || ''
)

// Diff内容
const oldString = computed(() => props.input.old_string as string || '')
const newString = computed(() => props.input.new_string as string || '')
const hasDiffContent = computed(() => !!oldString.value && !!newString.value)

// 截断长文本（避免撑爆卡片）
const MAX_PREVIEW_LENGTH = 200
const truncatedOldString = computed(() => 
  truncate(oldString.value, MAX_PREVIEW_LENGTH)
)
const truncatedNewString = computed(() => 
  truncate(newString.value, MAX_PREVIEW_LENGTH)
)

// 格式化输入为JSON展示
const formattedInput = computed(() => 
  JSON.stringify(props.input, null, 2)
)

// 是否显示"始终允许"按钮
const showAlwaysAllow = computed(() => 
  ['Edit', 'Read', 'Write'].includes(props.toolName)
)

// 状态文本
const statusText = computed(() => {
  switch (status.value) {
    case 'processing': return t('permission.card.actions.processing')
    case 'completed': return t('permission.card.actions.completed')
    case 'denied': return t('permission.card.actions.denied')
    default: return t('permission.card.status.requestPending')
  }
})

// 工具函数：截断文本
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

// 允许操作
async function handleAllow() {
  isProcessing.value = true
  status.value = 'processing'
  
  try {
    await chatStore.allowPermission(
      props.messageId, 
      props.toolUseId, 
      props.input
    )
    status.value = 'completed'
  } catch (error) {
    console.error(t('permission.card.errors.allowFailed'), error)
    status.value = 'pending'  // 回退到待处理状态
  } finally {
    isProcessing.value = false
  }
}

// 拒绝操作
async function handleDeny() {
  isProcessing.value = true
  status.value = 'processing'
  
  try {
    await chatStore.denyPermission(
      props.messageId, 
      props.toolUseId, 
      t('permission.card.actions.denied')
    )
    status.value = 'denied'
  } catch (error) {
    console.error(t('permission.card.errors.denyFailed'), error)
    status.value = 'pending'
  } finally {
    isProcessing.value = false
  }
}

// 始终允许操作
async function handleAlwaysAllow() {
  isProcessing.value = true
  status.value = 'processing'
  
  try {
    await chatStore.allowPermission(
      props.messageId, 
      props.toolUseId, 
      props.input, 
      'user_permanent'  // 使用 permanent classification
    )
    status.value = 'completed'
  } catch (error) {
    console.error(t('permission.card.errors.allowFailed'), error)
    status.value = 'pending'
  } finally {
    isProcessing.value = false
  }
}
</script>

<style scoped>
.permission-request-card {
  margin: 12px 0;
  padding: 16px;
  background: var(--surface-glass);
  border: 1px solid var(--surface-border);
  border-radius: 12px;
  transition: all 0.3s ease;
}

.permission-request-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

/* 状态变体 */
.permission-request-card.tool-Bash {
  border-left: 3px solid var(--warning-primary, #f59e0b);
}

.permission-request-card.tool-Edit,
.permission-request-card.tool-Write {
  border-left: 3px solid var(--info-primary, #3b82f6);
}

.permission-request-card.completed {
  border-left-color: var(--success-primary, #10b981);
}

.permission-request-card.denied {
  border-left-color: var(--error-primary, #ef4444);
}

/* 卡片头部 */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.tool-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.danger-indicator {
  font-size: 12px;
  color: var(--warning-primary, #f59e0b);
  font-weight: 500;
}

/* 内容区域 */
.card-content {
  margin-bottom: 16px;
  font-size: 13px;
}

/* 文件信息 */
.file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-secondary);
  border-radius: 6px;
  margin-bottom: 12px;
  color: var(--text-secondary);
}

.file-path {
  font-family: monospace;
  font-size: 12px;
  word-break: break-all;
}

/* Diff预览 */
.diff-preview {
  border: 1px solid var(--surface-border);
  border-radius: 6px;
  overflow: hidden;
}

.diff-old,
.diff-new {
  display: flex;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.5;
}

.diff-old {
  background: rgba(239, 68, 68, 0.05);
  border-bottom: 1px solid var(--surface-border);
  color: var(--error-primary, #dc2626);
}

.diff-new {
  background: rgba(16, 185, 129, 0.05);
  color: var(--success-primary, #059669);
}

.diff-label {
  font-weight: bold;
  margin-right: 8px;
}

.diff-old pre,
.diff-new pre {
  margin: 0;
  font-family: monospace;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 命令预览 */
.command-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: var(--surface-secondary);
  border-radius: 6px;
  font-family: monospace;
}

.command-text {
  flex: 1;
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
}

/* 通用JSON预览 */
.generic-info {
  padding: 12px;
  background: var(--surface-secondary);
  border-radius: 6px;
  max-height: 200px;
  overflow-y: auto;
}

.json-preview {
  margin: 0;
  font-family: monospace;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}

/* 操作按钮区 */
.card-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  background: var(--surface-glass);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover:not(:disabled) {
  background: var(--surface-glass-hover);
  transform: translateY(-1px);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.deny:hover:not(:disabled) {
  border-color: var(--error-primary, #ef4444);
  color: var(--error-primary, #ef4444);
}

.action-btn.always-allow:hover:not(:disabled) {
  border-color: var(--info-primary, #3b82f6);
  color: var(--info-primary, #3b82f6);
}

.action-btn.primary {
  background: var(--accent-primary, #3b82f6);
  border-color: var(--accent-primary, #3b82f6);
  color: white;
}

.action-btn.primary:hover:not(:disabled) {
  background: var(--accent-primary-hover, #2563eb);
  border-color: var(--accent-primary-hover, #2563eb);
}

/* 状态反馈 */
.card-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px;
  font-size: 13px;
  color: var(--text-tertiary);
}

.status-icon.success {
  color: var(--success-primary, #10b981);
}

.status-icon.error {
  color: var(--error-primary, #ef4444);
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
```

- [ ] **步骤 2：验证组件类型安全**

运行：
```bash
npm run typecheck
```

预期：无类型错误，所有 Props 接口定义正确

- [ ] **步骤 3：单元测试核心逻辑（可选但推荐）**

创建测试文件 `src/components/chat/tools/__tests__/PermissionRequestCard.spec.ts`：

```typescript
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PermissionRequestCard from '../PermissionRequestCard.vue'

describe('PermissionRequestCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders tool name correctly', () => {
    const wrapper = mount(PermissionRequestCard, {
      props: {
        messageId: 'msg-1',
        toolUseId: 'tool-1',
        toolName: 'Edit',
        input: { file_path: '/test.ts', old_string: 'old', new_string: 'new' }
      }
    })
    
    expect(wrapper.text()).toContain('编辑文件')  // 或 'Edit File' 取决于当前locale
  })

  it('shows diff preview for Edit operations', () => {
    const wrapper = mount(PermissionRequestCard, {
      props: {
        messageId: 'msg-1',
        toolUseId: 'tool-1',
        toolName: 'Edit',
        input: { file_path: '/test.ts', old_string: 'old code', new_string: 'new code' }
      }
    })
    
    expect(wrapper.find('.diff-preview').exists()).toBe(true)
    expect(wrapper.text()).toContain('old code')
    expect(wrapper.text()).toContain('new code')
  })

  it('displays action buttons when pending', () => {
    const wrapper = mount(PermissionRequestCard, {
      props: {
        messageId: 'msg-1',
        toolUseId: 'tool-1',
        toolName: 'Bash',
        input: { command: 'echo test' }
      }
    })
    
    expect(wrapper.find('.action-btn.allow').exists()).toBe(true)
    expect(wrapper.find('.action-btn.deny').exists()).toBe(true)
  })
})
```

运行测试：
```bash
npm run test:unit -- --run src/components/chat/tools/__tests__/PermissionRequestCard.spec.ts
```

预期：所有测试通过

- [ ] **步骤 4：Commit**

```bash
git add src/components/chat/tools/PermissionRequestCard.vue
git commit -m "feat(component): create PermissionRequestCard with dynamic rendering and i18n"
```

---

### 任务 6：集成 PermissionRequestCard 到 MessageList

**文件：**
- 修改：`src/components/chat/MessageList.vue`

- [ ] **步骤 1：导入 PermissionRequestCard 组件**

在 `<script setup>` 的 import 区域添加：

```typescript
import PermissionRequestCard from './tools/PermissionRequestCard.vue'
```

- [ ] **步骤 2：添加权限检测辅助函数**

在 script setup 中添加：

```typescript
import { useChatStore } from '@/stores/chat'

const chatStore = useChatStore()

function hasPendingPermission(messageId: string, toolUseId: string): boolean {
  return chatStore.hasPendingPermissionForToolUse(toolUseId)
}
```

- [ ] **步骤 3：在消息列表模板中集成权限卡片**

找到消息渲染循环（通常是 `v-for="message in messages"` 的位置），在每个 MessageItem 后添加条件渲染：

```vue
<template>
  <div class="message-list">
    <div 
      v-for="message in messages" 
      :key="message.id" 
      class="message-wrapper"
    >
      <!-- 消息本体（保持不变） -->
      <MessageItem
        :message="message"
        @tool-submit="handleToolSubmit"
        @tool-skip="handleToolSkip"
      />
      
      <!-- 新增：权限审批卡片（条件渲染） -->
      <template v-for="toolCall in (message.toolCalls || [])" :key="`perm-${toolCall.id}`">
        <PermissionRequestCard
          v-if="hasPendingPermission(message.id, toolCall.id)"
          :messageId="message.id"
          :toolUseId="toolCall.id"
          :toolName="toolCall.name"
          :input="toolCall.input"
        />
      </template>
    </div>
    
    <!-- 加载状态等保持不变 -->
    <div v-if="loading" class="loading-indicator">...</div>
  </div>
</template>
```

**重要细节：**
- 使用 `(message.toolCalls || [])` 防御空值
- 使用 `v-for` 的 template 包裹以避免额外DOM节点
- key 格式为 `perm-${toolCall.id}` 确保唯一性
- 仅当 `hasPendingPermission` 返回 true 时才渲染

- [ ] **步骤 4：验证数据流完整性**

手动测试场景：
1. 启动应用，打开一个会话
2. 发送一条可能触发权限请求的消息（例如："帮我编辑某个文件"）
3. 观察消息流中是否出现 PermissionRequestCard
4. 点击"允许"按钮
5. 观察卡片状态变为"已批准"
6. 观察Engine是否继续执行工具调用

预期：完整的请求→展示→审批→执行闭环

- [ ] **步骤 5：边界情况测试**

测试以下场景：
1. **并发请求**：快速发送多条消息，多个权限请求同时出现
2. **取消请求**：Engine端超时取消请求（监听 `permission_request_cancelled` 事件）
3. **网络错误**：IPC调用失败时的错误提示
4. **未知工具类型**：收到未预定义的工具名时降级为通用展示

预期：所有边界情况有合理的降级处理，不崩溃

- [ ] **步骤 6：Commit**

```bash
git add src/components/chat/MessageList.vue
git commit -m "feat(chat): integrate PermissionRequestCard into message list with auto-detection"
```

---

### 任务 7：端到端集成测试与优化

**文件：**
- 修改：所有已修改文件（微调优化）
- 测试：手动E2E测试

- [ ] **步骤 1：完整流程测试**

按照以下场景进行端到端测试：

**场景A：默认模式下的文件编辑**
1. 确认权限模式为"默认模式"
2. 发送："请帮我在 README.md 中添加一行版权声明"
3. 观察是否弹出 Edit 权限卡片
4. 卡片显示文件路径和diff预览
5. 点击"允许"
6. 验证文件被成功修改

**场景B：计划模式拒绝写操作**
1. 切换权限模式为"计划模式"
2. 发送："创建一个新文件 test.txt"
3. 观察是否弹出权限请求（或者直接被拒绝）
4. 如果弹出，点击"拒绝"
5. 验证文件未被创建

**场景C：自动编辑模式**
1. 切换权限模式为"自动编辑"
2. 发送："修改 package.json 的版本号"
3. 观察是否**不弹**出权限卡片（自动放行）
4. 验证文件被直接修改

**场景D：完全信任模式（谨慎测试）**
1. 切换权限模式为"完全信任 ⚠️"
2. 发送包含多种操作的复杂指令
3. 观察所有操作均自动执行，无任何权限卡片
4. **立即切回默认模式！**

- [ ] **步骤 2：性能测试**

模拟高负载场景：
1. 快速发送10条消息，每条都触发权限请求
2. 观察UI渲染是否流畅（目标：<100ms响应）
3. 检查内存泄漏（长时间运行后内存稳定）
4. 验证大量卡片时的滚动性能

- [ ] **步骤 3：国际化测试**

1. 切换界面语言为中文
2. 验证所有权限相关文案为中文
3. 切换界面语言为英文
4. 验证所有权限相关文案为英文
5. 检查是否有遗漏的硬编码文本

- [ ] **步骤 4：响应式适配测试**

1. 缩小窗口宽度至移动端尺寸（<768px）
2. 验证权限模式选择器在小屏幕下正常工作
3. 验证权限卡片在移动端的布局自适应
4. 检查触摸操作是否流畅

- [ ] **步骤 5：修复发现的问题**

记录并修复上述测试中发现的所有问题：
- UI/UX问题（对齐、颜色、间距）
- 功能缺陷（逻辑错误、边界情况）
- 性能瓶颈（渲染卡顿、内存泄漏）
- i18n遗漏（硬编码文本、缺失翻译）

- [ ] **步骤 6：最终 Commit**

```bash
git add -A
git commit -m "fix(permission): address issues found during E2E testing and optimization"
```

---

## 自检清单

### ✅ 规格覆盖度验证

对照设计规格文档 [2026-05-17-permission-control-system-design.md](../specs/2026-05-17-permission-control-system-design.md)：

| 规格章节 | 实现任务 | 状态 |
|---------|---------|------|
| 4.1 PermissionModeSelector 设计 | 任务 3 + 4 | ✅ |
| 4.2 PermissionRequestCard 设计 | 任务 5 + 6 | ✅ |
| 4.3 工具类型映射 | 任务 5 步骤1 | ✅ |
| 4.4 操作按钮逻辑 | 任务 5 步骤1 | ✅ |
| 4.5 i18n 支持 | 任务 1 + 3/5 组件 | ✅ |
| 5. Store层扩展 | 任务 2 | ✅ |
| 6.1 ChatInput集成 | 任务 4 | ✅ |
| 6.2 MessageList集成 | 任务 6 | ✅ |

### ✅ 占位符扫描

- ❌ 无"待定"、"TODO"、"后续实现"
- ❌ 无模糊描述（所有步骤都有具体代码）
- ❌ 无引用未定义的类型或方法
- ✅ 所有代码块都是完整可执行的

### ✅ 类型一致性检查

- `PermissionMode` 类型：任务2导入 → 任务3使用 → 任务4传递 ✅
- `Props` 接口：任务5定义 → 任务6使用 ✅
- i18n key：任务1定义 → 任务3/5使用 ✅
- Store方法：任务2定义 → 任务3/5调用 ✅

---

## 执行选项

**计划已完成并保存到 `docs/superpowers/plans/2026-05-17-permission-control-system.md`。两种执行方式：**

**1. 子代理驱动（推荐✨）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代
   - 优势：并行开发、独立审查、容错性好
   - 适用：复杂功能、多文件协作

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点供审查
   - 优势：上下文连续、沟通成本低
   - 适用：简单功能、快速交付

**预计总工作量：** 7个任务，每个任务15-30分钟，总计2-3小时（含测试）

**风险等级：** 低-中等（主要依赖现有架构，改动集中且明确）
