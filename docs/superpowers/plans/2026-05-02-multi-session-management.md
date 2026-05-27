# Multi-Session Management 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现多会话管理功能，支持最多 3 个 CLI 进程并发运行，会话以浏览器风格 Tab 展示，关闭 Tab 不终止后台进程。

**架构：** 进程池 + 事件路由。将单例 `ClaudeCodeProcessManager` 重构为 `SessionProcess` + `ClaudeCodeProcessPool`，所有 IPC 事件携带 `sessionId`，渲染进程按 `sessionId` 分发到对应会话。

**技术栈：** Electron (ipcMain/ipcRenderer)、Vue 3 (Pinia stores)、TypeScript

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/types/index.ts` | 修改 | 扩展 Session 类型，添加多会话字段 |
| `electron/sessionProcess.ts` | 创建 | 封装单个 CLI 进程生命周期 |
| `electron/claudeCodeProcessPool.ts` | 创建 | 进程池管理，LRU 淘汰，事件路由 |
| `electron/claudeCodeIPC.ts` | 重构 | IPC 接口支持 sessionId，新增 suspend/resume 端点 |
| `electron/preload.ts` | 修改 | 更新 claudeCode.* API 签名，添加 sessionId 参数 |
| `src/stores/chat.ts` | 重构 | 多会话并行模型，按 sessionId 事件路由 |
| `src/stores/app.ts` | 修改 | 动态会话 Tab 管理 |
| `src/components/chat/SessionTabBar.vue` | 创建 | 会话 Tab 栏组件 |
| `src/components/explorer/SessionListItem.vue` | 修改 | 添加进程状态指示器（旋转/绿/黄/灰） |
| `src/components/layout/ChatPanel.vue` | 修改 | 集成 Tab 栏，动态渲染当前会话 |

---

### 任务 1：扩展 Session 类型

**文件：**
- 修改：`src/types/index.ts`

- [ ] **步骤 1：在 Session 接口中添加多会话字段**

在 `src/types/index.ts` 中添加 `ProcessStatus` 类型，并在 `Session` 接口中添加多会话字段：

```typescript
export type ProcessStatus = 'none' | 'starting' | 'active' | 'idle' | 'suspended' | 'exited'

export interface Session {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  workingDirectory?: string
  engineSessionId?: string
  processStatus: ProcessStatus
  isTabOpen: boolean
  lastActivityAt: number
}
```

- [ ] **步骤 2：验证类型编译**

运行：`cd d:\AI\claude-code-gui && npx vue-tsc --noEmit 2>&1 | head -20`
预期：可能有其他文件因 Session 新增必填字段而报类型错误，后续任务会修复。

- [ ] **步骤 3：Commit**

```bash
git add src/types/index.ts
git commit -m "feat: extend Session type with multi-session fields"
```

---

### 任务 2：创建 SessionProcess 类

**文件：**
- 创建：`electron/sessionProcess.ts`

- [ ] **步骤 1：创建 SessionProcess 类**

创建 `electron/sessionProcess.ts`，从现有 `claudeCodeProcessManager.ts` 中提取单进程逻辑。该类封装单个 CLI 子进程的完整生命周期：启动、发送消息、中断、暂停（保留 engineSessionId）、恢复（通过 --resume）、终止。

关键设计点：
- `status` 字段跟踪进程状态：`starting` → `active` → `idle`（收到 result 事件时）→ `suspended`（被暂停）→ `exited`
- `engineSessionId` 从 CLI 的 `system.init` 消息中提取，用于 `--resume`
- `suspend()` 方法 kill 进程但保留 `engineSessionId`，`resume()` 方法用 `--resume <engineSessionId>` 重启
- `buildArgs()` 中，当 `status === 'suspended'` 且有 `engineSessionId` 时，自动追加 `--resume` 参数
- 事件通过 `EventEmitter` 的 `message` 事件统一发出，由 ProcessPool 路由

代码逻辑复用自现有 `claudeCodeProcessManager.ts` 中的 `resolveBunPath()`、`resolveCliCommand()`、`buildArgs()`、`buildEnv()`、`findGitBashPath()`、`getMacroDefines()`、`getFeatureArgs()` 等方法，保持完全一致。

- [ ] **步骤 2：验证编译**

运行：`cd d:\AI\claude-code-gui && npx tsc --noEmit electron/sessionProcess.ts --skipLibCheck`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add electron/sessionProcess.ts
git commit -m "feat: create SessionProcess class for single CLI process lifecycle"
```

---

### 任务 3：创建 ClaudeCodeProcessPool 类

**文件：**
- 创建：`electron/claudeCodeProcessPool.ts`

- [ ] **步骤 1：创建进程池类**

创建 `electron/claudeCodeProcessPool.ts`。核心职责：

- `processes: Map<string, SessionProcess>` — 以 sessionId 为 key 管理所有进程实例
- `MAX_PROCESSES = 3` — 并发上限
- `startSession(sessionId, config)` — 创建 SessionProcess 并启动，超限时自动淘汰
- `resumeSession(sessionId)` — 对 suspended 进程执行 resume
- `suspendSession(sessionId)` — 暂停指定进程
- `sendMessage(sessionId, content)` — 向指定进程发送消息
- `abortSession(sessionId)` — 中断指定进程当前轮次
- `killSession(sessionId)` — 终止并移除进程
- `getSessionStatus(sessionId)` — 查询进程状态
- `getActiveSessions()` — 获取所有活跃会话列表
- `evictIfNeeded()` — LRU 淘汰：优先淘汰最早 idle 的进程，其次淘汰最早 active 的非前台进程
- `routeEvent(sessionId, eventType, data)` — 通过 `mainWindow.webContents.send` 将事件路由到渲染进程，事件格式为 `{ sessionId, data }`

- [ ] **步骤 2：验证编译**

运行：`cd d:\AI\claude-code-gui && npx tsc --noEmit electron/claudeCodeProcessPool.ts --skipLibCheck`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add electron/claudeCodeProcessPool.ts
git commit -m "feat: create ClaudeCodeProcessPool with LRU eviction and event routing"
```

---

### 任务 4：重构 claudeCodeIPC.ts

**文件：**
- 修改：`electron/claudeCodeIPC.ts`

- [ ] **步骤 1：重写 claudeCodeIPC.ts 使用 ProcessPool**

将 `electron/claudeCodeIPC.ts` 完整替换。核心变化：

1. 将 `manager: ClaudeCodeProcessManager` 替换为 `pool: ClaudeCodeProcessPool`
2. 所有 IPC handle 方法添加 `sessionId` 参数
3. 新增 IPC 端点：
   - `claude-code:suspendSession` — 暂停指定会话
   - `claude-code:resumeSession` — 恢复指定会话
   - `claude-code:getSessionStatus` — 查询会话状态
   - `claude-code:getActiveSessions` — 获取所有活跃会话
4. `isSessionActive` 改为接受可选 `sessionId` 参数
5. 移除旧的事件转发逻辑（ProcessPool 内部已处理路由）
6. 保留 `listAgents` 不变
7. 导出 `getPool()` 替代 `getManager()`

- [ ] **步骤 2：验证编译**

运行：`cd d:\AI\claude-code-gui && npx tsc --noEmit electron/claudeCodeIPC.ts --skipLibCheck`
预期：无错误

- [ ] **步骤 3：Commit**

```bash
git add electron/claudeCodeIPC.ts
git commit -m "feat: refactor claudeCodeIPC to use ProcessPool with sessionId routing"
```

---

### 任务 5：更新 preload.ts

**文件：**
- 修改：`electron/preload.ts`

- [ ] **步骤 1：更新 claudeCode API 签名**

在 `electron/preload.ts` 的 `claudeCode` 对象中，修改所有方法签名添加 `sessionId` 参数，并新增方法：

- `startSession(sessionId, config)` — 添加 sessionId 参数
- `sendMessage(sessionId, content)` — 添加 sessionId 参数
- `abort(sessionId)` — 添加 sessionId 参数
- `stop(sessionId)` — 添加 sessionId 参数
- `suspendSession(sessionId)` — 新增
- `resumeSession(sessionId)` — 新增
- `getSessionStatus(sessionId)` — 新增
- `getActiveSessions()` — 新增
- `isSessionActive(sessionId?)` — 添加可选 sessionId 参数

所有事件监听器回调签名改为 `(data: { sessionId: string; data: any }) => void`：
- `onAssistant`、`onUser`、`onToolUse`、`onToolResult`、`onResult`、`onStreamEvent`、`onLog`、`onExit`
- 新增 `onSuspended` — 监听会话被 LRU 淘汰事件

- [ ] **步骤 2：验证编译**

运行：`cd d:\AI\claude-code-gui && npx vue-tsc --noEmit 2>&1 | head -20`
预期：chat.ts 等文件因 API 签名变更报错，下一个任务修复。

- [ ] **步骤 3：Commit**

```bash
git add electron/preload.ts
git commit -m "feat: update preload.ts with sessionId-aware claudeCode API"
```

---

### 任务 6：重构 chat.ts Store

**文件：**
- 修改：`src/stores/chat.ts`

这是最复杂的任务。核心变化：从"单会话活跃"改为"多会话并行"，所有 IPC 调用和事件监听都按 sessionId 路由。

- [ ] **步骤 1：修改核心状态**

1. 将 `streamingContent` 从 `ref('')` 改为 `ref<Map<string, string>>(new Map())`
2. 将 `isLoading` 从 `ref(false)` 改为 `ref<Map<string, boolean>>(new Map())`
3. 添加计算属性保持向后兼容：

```typescript
const streamingContents = ref<Map<string, string>>(new Map())
const loadingSessions = ref<Map<string, boolean>>(new Map())

const isLoading = computed(() =>
  currentSessionId.value ? (loadingSessions.value.get(currentSessionId.value) ?? false) : false
)
const streamingContent = computed(() =>
  currentSessionId.value ? (streamingContents.value.get(currentSessionId.value) ?? '') : ''
)
```

- [ ] **步骤 2：修改 createSession 初始化多会话字段**

在 `createSession` 函数中，为新 Session 对象添加 `processStatus: 'none'`、`isTabOpen: true`、`lastActivityAt: Date.now()` 字段。

- [ ] **步骤 3：重写 initClaudeCodeSession 为多会话版本**

函数签名改为 `initClaudeCodeSession(sessionId: string)`：
- 不再检查全局 `isSessionActive()`
- 通过 `claudeCode.getSessionStatus(sessionId)` 检查指定会话是否已运行
- 调用 `claudeCode.startSession(sessionId, config)` 启动指定会话
- 更新 `session.processStatus` 状态

- [ ] **步骤 4：重写 sendMessage 为多会话版本**

核心变化：
- 所有事件监听器回调中检查 `event.sessionId === targetSessionId`，只处理当前会话的事件
- `claudeCode.sendMessage(targetSessionId, content)` 携带 sessionId
- `loadingSessions` 和 `streamingContents` 按 sessionId 设置/清除
- `result` 事件处理中更新 `session.processStatus = 'idle'`
- `error` 处理中更新 `session.processStatus = 'exited'`

- [ ] **步骤 5：修改 addMessage 和 updateMessage 支持 targetSessionId**

两个函数添加可选的 `targetSessionId` 参数，默认使用 `currentSessionId`。更新 `session.lastActivityAt`。

- [ ] **步骤 6：修改 abort 和 selectSession**

- `abort()` 使用 `currentSessionId` 调用 `claudeCode.abort(sid)`
- `selectSession()` 保持不变

- [ ] **步骤 7：添加 activateSession 和 deactivateSession**

```typescript
async function activateSession(sessionId: string): Promise<void> {
  const session = sessions.value.find(s => s.id === sessionId)
  if (!session) return
  currentSessionId.value = sessionId
  if (session.workingDirectory) currentProjectRoot.value = session.workingDirectory

  if (session.processStatus === 'suspended') {
    const claudeCode = electronAPI?.claudeCode
    if (claudeCode) {
      session.processStatus = 'starting'
      saveToStorage()
      await claudeCode.resumeSession(sessionId)
      session.processStatus = 'active'
      saveToStorage()
    }
  } else if (session.processStatus === 'none' || session.processStatus === 'exited') {
    await initClaudeCodeSession(sessionId)
  }
}

function deactivateSession(sessionId: string): void {
  const session = sessions.value.find(s => s.id === sessionId)
  if (session) {
    session.isTabOpen = false
    saveToStorage()
  }
}
```

- [ ] **步骤 8：修改 switchAgent 和 deleteSession**

- `switchAgent` 使用 `claudeCode.stop(sid)` 和 `initClaudeCodeSession(sid)`
- `deleteSession` 先调用 `claudeCode.stop(sessionId)`，再清理 `loadingSessions` 和 `streamingContents`

- [ ] **步骤 9：更新 return 导出**

添加 `activateSession`、`deactivateSession`。

- [ ] **步骤 10：验证编译**

运行：`cd d:\AI\claude-code-gui && npx vue-tsc --noEmit 2>&1 | head -20`
预期：Sidebar.vue 等引用旧 API 的组件可能报错，后续任务修复。

- [ ] **步骤 11：Commit**

```bash
git add src/stores/chat.ts
git commit -m "feat: refactor chat store for multi-session parallel model"
```

---

### 任务 7：重构 app.ts Store — Tab 管理

**文件：**
- 修改：`src/stores/app.ts`

- [ ] **步骤 1：修改 CenterTab 类型添加 sessionId**

在 `CenterTab` 接口中添加 `sessionId?: string` 字段。

- [ ] **步骤 2：添加会话 Tab 管理方法**

在 `useAppStore` 中添加：
- `openSessionTab(sessionId, title)` — 打开会话 tab（如已存在则切换）
- `closeSessionTab(tabId)` — 关闭 tab（不终止会话进程）
- `switchToSessionTab(sessionId)` — 切换到指定会话的 tab
- `updateSessionTabTitle(sessionId, title)` — 更新 tab 标题

- [ ] **步骤 3：修改 closeCenterTab**

关闭会话 tab 时不终止进程，只从 `centerTabs` 中移除。切换到下一个可用的会话 tab。

- [ ] **步骤 4：更新 return 导出**

添加新方法到 return 对象。

- [ ] **步骤 5：验证编译**

运行：`cd d:\AI\claude-code-gui && npx vue-tsc --noEmit 2>&1 | head -20`

- [ ] **步骤 6：Commit**

```bash
git add src/stores/app.ts
git commit -m "feat: add session tab management to app store"
```

---

### 任务 8：创建 SessionTabBar 组件

**文件：**
- 创建：`src/components/chat/SessionTabBar.vue`

- [ ] **步骤 1：创建 SessionTabBar 组件**

创建 `src/components/chat/SessionTabBar.vue`。核心功能：

- 显示所有会话 tab（从 `appStore.centerTabs` 中过滤 `sessionId` 存在的 tab）
- 每个 tab 显示：状态指示器 + 标题 + 关闭按钮
- 状态指示器：
  - `active`/`starting`：旋转圈圈动画（CSS spinner）
  - `idle`：绿色圆点
  - `suspended`：黄色圆点
  - `none`/`exited`：灰色圆点
- 点击 tab 切换会话
- 点击 × 关闭 tab（emit `close-tab` 事件）
- 点击 + 创建新会话（emit `new-session` 事件）
- 活跃 tab 底部有蓝色指示条

Props: 无（从 store 获取数据）
Emits: `new-session`、`switch-session(sessionId)`、`close-tab(tabId)`

- [ ] **步骤 2：Commit**

```bash
git add src/components/chat/SessionTabBar.vue
git commit -m "feat: create SessionTabBar component with status indicators"
```

---

### 任务 9：增强 SessionListItem 状态指示器

**文件：**
- 修改：`src/components/explorer/SessionListItem.vue`

- [ ] **步骤 1：添加 processStatus prop**

在 Props 接口中添加 `processStatus` 字段：

```typescript
processStatus: 'none' | 'starting' | 'active' | 'idle' | 'suspended' | 'exited'
```

- [ ] **步骤 2：替换模板中的状态指示器**

替换现有 `status-indicator` 区域，根据 `processStatus` 显示不同指示器：
- `active`/`starting`：旋转圈圈（CSS spinner，与 Tab 栏一致）
- `idle`：绿色圆点
- `suspended`：黄色圆点
- `none`/`exited`：不显示（或灰色圆点）
- `needsApproval`：保留现有的 Bell 图标

- [ ] **步骤 3：添加对应 CSS**

添加 `.spinning-indicator`、`.idle-indicator`、`.suspended-indicator` 样式，与 SessionTabBar 保持一致。

- [ ] **步骤 4：更新 SessionList.vue 传递 processStatus**

在 `SessionList.vue` 中，给 `SessionListItem` 传递 `:process-status` prop，从 session 对象中读取 `processStatus` 字段。

- [ ] **步骤 5：验证编译**

运行：`cd d:\AI\claude-code-gui && npx vue-tsc --noEmit 2>&1 | head -20`

- [ ] **步骤 6：Commit**

```bash
git add src/components/explorer/SessionListItem.vue src/components/explorer/SessionList.vue
git commit -m "feat: add process status indicators to SessionListItem"
```

---

### 任务 10：重构 ChatPanel 集成 Tab 栏

**文件：**
- 修改：`src/components/layout/ChatPanel.vue`

- [ ] **步骤 1：集成 SessionTabBar**

在 `ChatPanel.vue` 模板中，在 `chat-header` 上方添加 `SessionTabBar`：

```html
<main class="chat-panel">
  <SessionTabBar
    @new-session="handleNewSession"
    @switch-session="handleSwitchSession"
    @close-tab="handleCloseTab"
  />
  <div class="chat-header">
    ...
  </div>
  ...
</main>
```

- [ ] **步骤 2：实现事件处理方法**

```typescript
import SessionTabBar from '../chat/SessionTabBar.vue'

async function handleNewSession() {
  const session = chatStore.createSession('New Chat')
  appStore.openSessionTab(session.id, session.title)
  await chatStore.activateSession(session.id)
}

async function handleSwitchSession(sessionId: string) {
  await chatStore.activateSession(sessionId)
}

function handleCloseTab(tabId: string) {
  const tab = appStore.centerTabs.find(t => t.id === tabId)
  if (tab?.sessionId) {
    chatStore.deactivateSession(tab.sessionId)
  }
  appStore.closeSessionTab(tabId)
}
```

- [ ] **步骤 3：修改 handleSend**

确保 `handleSend` 中的 `chatStore.sendMessage` 使用当前 `chatStore.currentSessionId`（已在任务 6 中修改为自动使用 currentSessionId）。

- [ ] **步骤 4：修改 handleStop**

确保 `handleStop` 使用 `chatStore.abort()`（已在任务 6 中修改为按 currentSessionId 操作）。

- [ ] **步骤 5：验证编译**

运行：`cd d:\AI\claude-code-gui && npx vue-tsc --noEmit 2>&1 | head -20`

- [ ] **步骤 6：Commit**

```bash
git add src/components/layout/ChatPanel.vue
git commit -m "feat: integrate SessionTabBar into ChatPanel"
```

---

### 任务 11：更新 Sidebar 会话交互

**文件：**
- 修改：`src/components/layout/Sidebar.vue`

- [ ] **步骤 1：修改 handleSelectSession**

点击左侧会话列表时，同时打开/切换 tab：

```typescript
async function handleSelectSession(sessionId: string) {
  chatStore.selectSession(sessionId)
  appStore.switchToSessionTab(sessionId)
  await chatStore.activateSession(sessionId)
}
```

- [ ] **步骤 2：修改 handleNewChat**

创建新会话时同时打开 tab：

```typescript
async function handleNewChat() {
  creatingChat.value = true
  try {
    const workingDirectory = chatStore.currentProjectRoot || chatStore.currentSession?.workingDirectory
    const session = chatStore.createSession('New Chat', workingDirectory)
    appStore.openSessionTab(session.id, session.title)
    await chatStore.activateSession(session.id)
    window.dispatchEvent(new CustomEvent('session-created'))
  } catch (error) {
    console.error('Failed to create session:', error)
  } finally {
    creatingChat.value = false
  }
}
```

- [ ] **步骤 3：修改 handleDeleteSession**

删除会话时同时关闭 tab：

```typescript
async function handleDeleteSession(e: MouseEvent, sessionId: string) {
  e.preventDefault()
  e.stopPropagation()
  if (!confirm('Delete this conversation?')) return
  try {
    const tab = appStore.centerTabs.find(t => t.sessionId === sessionId)
    if (tab) appStore.closeSessionTab(tab.id)
    await chatStore.deleteSession(sessionId)
  } catch (error) {
    console.error('Failed to delete session:', error)
  }
}
```

- [ ] **步骤 4：修改 handleCreateSessionInProject**

在项目下创建会话时同时打开 tab：

```typescript
function handleCreateSessionInProject(e: MouseEvent, workingDirectory: string) {
  e.stopPropagation()
  try {
    chatStore.switchProject(workingDirectory)
    const session = chatStore.createSession('New Chat', workingDirectory)
    appStore.openSessionTab(session.id, session.title)
    window.dispatchEvent(new CustomEvent('session-created'))
  } catch (error) {
    console.error('Failed to create session in project:', error)
  }
}
```

- [ ] **步骤 5：传递 processStatus 到 SessionList**

在 Sidebar 模板中，给 `SessionList` 组件传递会话的 `processStatus`（通过 Session 内的字段，SessionList → SessionListItem 自动传递）。

- [ ] **步骤 6：验证编译**

运行：`cd d:\AI\claude-code-gui && npx vue-tsc --noEmit 2>&1 | head -20`

- [ ] **步骤 7：Commit**

```bash
git add src/components/layout/Sidebar.vue
git commit -m "feat: update Sidebar session interactions for multi-session"
```

---

### 任务 12：会话元数据持久化与恢复

**文件：**
- 修改：`src/stores/chat.ts`

- [ ] **步骤 1：修改 saveToStorage 保存 SessionMetadata**

在 `saveToStorage` 中，除了保存完整的 sessions 数据外，额外保存一份轻量的 `SessionMetadata` 到 localStorage：

```typescript
const SESSION_META_KEY = 'chat_session_meta_v1'

interface SessionMetadata {
  id: string
  engineSessionId?: string
  title: string
  workingDirectory?: string
  createdAt: number
  updatedAt: number
  lastProcessStatus: ProcessStatus
  isTabOpen: boolean
}

function saveSessionMeta(sessions: Session[]) {
  const meta: SessionMetadata[] = sessions.map(s => ({
    id: s.id,
    engineSessionId: s.engineSessionId,
    title: s.title,
    workingDirectory: s.workingDirectory,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    lastProcessStatus: s.processStatus,
    isTabOpen: s.isTabOpen
  }))
  try {
    localStorage.setItem(SESSION_META_KEY, JSON.stringify(meta))
  } catch {}
}
```

- [ ] **步骤 2：修改 loadSessionsFromStorage 恢复多会话字段**

在加载 sessions 时，确保 `processStatus`、`isTabOpen`、`lastActivityAt` 字段有默认值：

```typescript
function loadSessionsFromStorage(): Session[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const data = saved.startsWith('C:') || saved.startsWith('R:')
        ? decompressData(saved)
        : saved
      const sessions = JSON.parse(data)
      return (sessions || []).map((s: any) => ({
        ...s,
        processStatus: s.processStatus || 'none',
        isTabOpen: s.isTabOpen ?? false,
        lastActivityAt: s.lastActivityAt || s.updatedAt || s.createdAt
      }))
    }
  } catch (e) {
    console.error('[ChatStore] Failed to load sessions:', e)
  }
  return []
}
```

- [ ] **步骤 3：添加应用启动时的会话恢复逻辑**

在 store 初始化时，将所有 `isTabOpen` 为 true 的会话标记为 `processStatus: 'none'`（懒加载，不自动启动 CLI 进程）：

```typescript
// 在 store 创建后执行
sessions.value.forEach(s => {
  if (s.processStatus !== 'none' && s.processStatus !== 'exited') {
    s.processStatus = 'none'
  }
})
```

- [ ] **步骤 4：验证编译**

运行：`cd d:\AI\claude-code-gui && npx vue-tsc --noEmit 2>&1 | head -20`

- [ ] **步骤 5：Commit**

```bash
git add src/stores/chat.ts
git commit -m "feat: add session metadata persistence and lazy-load recovery"
```

---

### 任务 13：集成测试与修复

**文件：**
- 可能修改：所有上述文件

- [ ] **步骤 1：运行完整类型检查**

运行：`cd d:\AI\claude-code-gui && npx vue-tsc --noEmit`
预期：零错误。如有错误，逐一修复。

- [ ] **步骤 2：启动开发服务器进行手动测试**

运行：`cd d:\AI\claude-code-gui && npm run dev`

手动测试清单：
1. 创建新会话 → Tab 栏出现新 tab → 左侧列表显示新会话
2. 发送消息 → 旋转圈圈动画 → 收到回复后变为绿色圆点
3. 创建第二个会话 → 两个 tab 并存 → 切换 tab 无卡顿
4. 关闭一个 tab → 进程继续运行（左侧列表仍显示活跃状态）
5. 创建第三个会话 → 三个进程并发
6. 创建第四个会话 → 最早 idle 的会话被暂停（黄色圆点）
7. 切换到被暂停的会话 → 自动 resume → 恢复对话
8. 重启应用 → 会话列表恢复 → 点击会话时才启动 CLI

- [ ] **步骤 3：修复发现的问题**

根据手动测试结果修复 bug。

- [ ] **步骤 4：最终 Commit**

```bash
git add -A
git commit -m "fix: resolve integration issues for multi-session management"
```

---

## 自检

**1. 规格覆盖度：**
- ✅ 最多 3 个并发进程 → 任务 3（MAX_PROCESSES = 3）+ 任务 4（evictIfNeeded）
- ✅ 浏览器风格 Tab → 任务 8（SessionTabBar）+ 任务 10（ChatPanel 集成）
- ✅ 关闭 Tab 不终止会话 → 任务 7（closeSessionTab）+ 任务 10（handleCloseTab）
- ✅ --resume 恢复 → 任务 2（SessionProcess.resume）+ 任务 6（activateSession）
- ✅ 懒加载恢复 → 任务 12（持久化与恢复）
- ✅ 实时状态保存 → 任务 12（saveSessionMeta）
- ✅ 错误处理 → 任务 6（processStatus 状态管理）+ 任务 13（集成测试）
- ✅ 状态指示器 → 任务 8（Tab 栏）+ 任务 9（SessionListItem）

**2. 占位符扫描：** 无 TODO/TBD/待定内容。✅

**3. 类型一致性：**
- `ProcessStatus` 类型在 `types/index.ts`、`sessionProcess.ts`、`chat.ts`、`SessionTabBar.vue`、`SessionListItem.vue` 中一致使用 ✅
- `sessionId` 参数在 IPC、preload、store 中一致传递 ✅
- `Session` 接口的新字段在所有使用处都有初始化 ✅
