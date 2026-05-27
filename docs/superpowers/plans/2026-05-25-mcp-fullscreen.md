# MCP 管理器平铺模式实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 MCP 管理器从弹窗（Modal）模式改为平铺整个主聊天界面，与技能页面保持一致的交互体验

**架构：** 复用 SkillsManager 的实现模式，在 App.vue 的 center-content 中通过条件渲染切换显示 McpManager 组件，移除 Sidebar 中的 Modal 弹窗实现

**技术栈：** Vue 3 (Composition API), Pinia, TypeScript

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/stores/app.ts` | 修改 | 添加 `showMCPManager` 状态和开关方法 |
| `src/App.vue` | 修改 | 添加 McpManager 条件渲染 + 事件监听 |
| `src/components/layout/Sidebar.vue` | 修改 | 移除 McpManagerModal 导入和使用 |
| `src/components/mcp/McpManager.vue` | 检查/修改 | 确保有返回按钮功能 |

---

### 任务 1：在 app store 中添加 showMCPManager 状态

**文件：**
- 修改：`src/stores/app.ts:88-90`（在 showSkillsManager 附近）

- [ ] **步骤 1：添加状态声明**

在 `showSkillsManager` 声明之后（约第 89 行）添加：

```typescript
const showSkillsManager = ref(false)
const showTraceViewer = ref(false)
const showSettings = ref(false)
const showMCPManager = ref(false)  // 新增
```

- [ ] **步骤 2：在 return 对象中暴露状态和方法**

在 return 对象中（约第 470 行），在 `showSettings` 之后添加：

```typescript
return {
  // ... existing state
  showSkillsManager,
  showTraceViewer,
  showSettings,
  showMCPManager,  // 新增状态
  
  // ... existing methods
}
```

- [ ] **步骤 3：验证代码语法**

运行 TypeScript 类型检查确保无错误：
```bash
cd d:\AI\SpaceCode && npx vue-tsc --noEmit
```
预期：无类型错误

- [ ] **步骤 4：Commit**

```bash
git add src/stores/app.ts
git commit -m "feat: add showMCPManager state to app store"
```

---

### 任务 2：修改 App.vue 添加条件渲染逻辑

**文件：**
- 修改：`src/App.vue:30-34`（center-content 区域）
- 修改：`src/App.vue:44-47`（import 区域）
- 修改：`src/App.vue:175-180`（onMounted 事件监听）

- [ ] **步骤 1：导入 McpManager 组件**

在 import 区域（约第 44 行）的 SkillsManager 导入之后添加：

```typescript
import SkillsManager from './components/skills/SkillsManager.vue'
import McpManager from './components/mcp/McpManager.vue'  // 新增
```

- [ ] **步骤 2：修改条件渲染逻辑**

将 template 中的 center-content 部分（第 30-34 行）从：
```vue
<SettingsPanel v-if="appStore.showSettings" />
<SkillsManager v-else-if="appStore.showSkillsManager" />
<ChatPanel v-else-if="!appStore.showTraceViewer" />
<TraceViewer v-else />
```

改为：
```vue
<SettingsPanel v-if="appStore.showSettings" />
<SkillsManager v-else-if="appStore.showSkillsManager" />
<McpManager v-else-if="appStore.showMCPManager" />  <!-- 新增 -->
<ChatPanel v-else-if="!appStore.showTraceViewer" />
<TraceViewer v-else />
```

- [ ] **步骤 3：添加 open-mcp-manager 事件监听**

在 onMounted 中（约第 175 行），在 `open-skills-manager` 监听器之后添加：

```typescript
// 监听打开技能管理器事件
window.addEventListener('open-skills-manager', () => {
  appStore.showSkillsManager = true
})

// 监听打开 MCP 管理器事件（新增）
window.addEventListener('open-mcp-manager', () => {
  appStore.showMCPManager = true
})
```

- [ ] **步骤 4：验证组件渲染**

手动测试或运行开发服务器确认：
1. 输入 `/mcp` 命令后 center-panel 应显示 McpManager
2. 点击侧边栏 MCP 按钮应显示 McpManager
3. 按 Esc 或点击返回按钮应回到 ChatPanel

- [ ] **步骤 5：Commit**

```bash
git add src/App.vue
git commit -m "feat: integrate McpManager into App.vue conditional rendering"
```

---

### 任务 3：移除 Sidebar.vue 中的 McpManagerModal

**文件：**
- 修改：`src/components/layout/Sidebar.vue:251-254`（模板部分）
- 修改：`src/components/layout/Sidebar.vue:85`（import 部分）
- 修改：`src/components/layout/Sidebar.vue:265`（handleOpenMcp 函数）
- 修改：`src/components/layout/Sidebar.vue:112`（showMcpManager 状态声明）

- [ ] **步骤 1：移除 McpManagerModal 导入**

将第 85 行：
```typescript
import McpManager from '../mcp/McpManagerModal.vue'
```

删除或注释掉

- [ ] **步骤 2：移除模板中的 McpManager 使用**

删除第 251-254 行的模板代码：
```vue
<!-- MCP Manager Modal -->
<McpManager
  v-model="showMcpManager"
/>
```

- [ ] **步骤 3：移除 showMcpManager 本地状态**

删除第 112 行：
```typescript
const showMcpManager = ref(false)
```

- [ ] **步骤 4：修改 handleOpenMcp 函数**

将第 265-267 行：
```typescript
function handleOpenMcp() {
  showMcpManager.value = true
}
```

改为：
```typescript
function handleOpenMcp() {
  appStore.showMCPManager = true  // 改为使用全局状态
}
```

- [ ] **步骤 5：验证侧边栏功能**

确认：
1. 侧边栏不再渲染 Modal 弹窗
2. 点击 MCP 按钮触发全局状态变更
3. 无控制台错误或警告

- [ ] **步骤 6：Commit**

```bash
git add src/components/layout/Sidebar.vue
git commit -m "refactor: remove McpManagerModal from Sidebar, use global state"
```

---

### 任务 4：检查并适配 McpManager.vue 组件

**文件：**
- 检查/修改：`src/components/mcp/McpManager.vue:1-80`（模板和脚本部分）

- [ ] **步骤 1：读取并分析当前 McpManager.vue 结构**

检查以下关键点：
1. 是否有返回/关闭按钮？
2. 是否依赖任何 Modal 相关的 props 或样式？
3. 高度和布局是否自适应父容器？

预期发现：
- 当前组件可能缺少明确的返回按钮
- 样式可能针对 Modal 容器优化过

- [ ] **步骤 2：添加返回按钮（如果缺失）**

如果组件没有返回按钮，在 header 区域（第 5-15 行）添加：

```vue
<div class="mcp-header">
  <div class="header-content">
    <div class="header-left">
      <button class="back-btn" @click="handleClose" title="返回">
        <ArrowLeft :size="18" />
      </button>
      <div>
        <h1 class="title">...</h1>
        ...
      </div>
    </div>
    ...
  </div>
</div>
```

并在 script 中添加：
```typescript
import { ArrowLeft } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()

function handleClose() {
  appStore.showMCPManager = false
}
```

- [ ] **步骤 3：调整容器样式确保全屏填充**

检查 CSS，确保 `.mcp-manager` 样式为：
```scss
.mcp-manager {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
```

- [ ] **步骤 4：测试交互流程**

完整测试路径：
1. 从聊天界面输入 `/mcp` → 应平铺显示 McpManager
2. 点击侧边栏 MCP 按钮 → 应平铺显示 McpManager
3. 点击返回按钮 → 应回到 ChatPanel
4. 按 Esc 键 → 可选：是否支持 Esc 关闭？

- [ ] **步骤 5：Commit**

```bash
git add src/components/mcp/McpManager.vue
git commit -m "feat: adapt McpManager for fullscreen inline rendering"
```

---

### 任务 5：集成测试与验证

**文件：**
- 测试：手动测试所有入口点
- 验证：视觉一致性检查

- [ ] **步骤 1：测试 /mcp 斜杠命令**

在 ChatInput 中输入 `/mcp` 并回车：
- ✅ 预期：dispatchEvent('open-mcp-manager') 被触发
- ✅ 预期：App.vue 接收事件，设置 showMCPManager = true
- ✅ 预期：center-panel 显示 McpManager 组件（非弹窗）
- ✅ 预期：占据整个主聊天区域

- [ ] **步骤 2：测试侧边栏 MCP 按钮**

点击侧边栏 feature-nav 中的 MCP 按钮：
- ✅ 预期：调用 appStore.showMCPManager = true
- ✅ 预期：同上效果

- [ ] **步骤 3：测试返回功能**

在 McpManager 页面：
- ✅ 点击返回按钮 → 回到 ChatPanel
- ✅ 侧边栏仍可见（未隐藏）
- ✅ 无遮罩层或弹窗残留

- [ ] **步骤 4：对比 SkillsManager 一致性**

视觉对比检查：
- ✅ Header 样式一致（标题 + 返回按钮位置）
- ✅ 占据区域一致（100% width/height of center-panel）
- ✅ 交互模式一致（平铺 vs 弹窗）
- ✅ 过渡动画一致（可选，如有）

- [ ] **步骤 5：边界情况测试**

- ✅ 快速连续点击 MCP 和 Skills 按钮是否正常切换？
- ✅ 打开 MCP 后打开 Settings 是否正常？
- ✅ 窗口 resize 时布局是否正确响应？

- [ ] **步骤 6：最终 Commit（如有修复）**

```bash
git add -A
git commit -m "test: verify MCP manager fullscreen integration"
```

---

## 自检清单

### 规格覆盖度
- [x] 将 MCP 从弹窗改为平铺 → 任务 2、3
- [x] 与 SkillsManager 保持一致 → 任务 4、5
- [x] 支持所有入口点（/mcp 命令 + 侧边栏按钮）→ 任务 2、3
- [x] 返回功能正常 → 任务 4

### 占位符扫描
- [x] 无 "TODO"、"待定" 等占位符
- [x] 所有代码步骤包含实际代码片段
- [x] 所有命令可执行且路径精确

### 类型一致性
- [x] app.ts 中状态名 `showMCPManager` 在所有任务中一致
- [x] 事件名 `open-mcp-manager` 在所有任务中一致
- [x] 组件名 `McpManager` 引用一致

---

## 执行选项

**计划已完成并保存到 `docs/superpowers/plans/2026-05-25-mcp-fullscreen.md`。两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点供审查

**选哪种方式？**
