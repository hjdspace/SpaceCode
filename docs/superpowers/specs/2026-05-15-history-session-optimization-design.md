# 历史会话功能优化设计文档

**日期**: 2026-05-15
**状态**: 已批准
**作者**: AI Assistant

---

## 1. 背景与问题陈述

### 1.1 当前问题

1. **UI 位置不合理**: 历史会话功能当前位于侧边栏（Sidebar.vue），用户需要先切换到侧边栏才能访问，操作路径过长。
2. **透明弹窗问题**: "恢复历史会话"弹窗背景完全透明，导致视觉体验差，无法有效遮挡底层内容（见截图）。
3. **会话读取功能失效**: 无法正确读取 `~/.claude/projects` 目录下的历史会话文件，可能原因：
   - 路径 sanitize/反解析逻辑不完整
   - 会话元数据提取不完善
   - 与 engine 源码的实现不一致

### 1.2 目标

将历史会话功能重构为：
- ✅ 迁移至 ChatPanel 标题栏右侧（更直观）
- ✅ 修复弹窗样式（毛玻璃效果 + 不透明背景）
- ✅ 完善会话读取逻辑（与 engine 源码保持一致）
- ✅ 添加搜索/过滤功能
- ✅ 恢复时创建新会话（非覆盖当前会话）

---

## 2. 技术方案

### 2.1 UI 架构调整

#### 2.1.1 目标布局

```
┌─────────────────────────────────────────────────────────┐
│ ChatPanel                                               │
├─────────────────────────────────────────────────────────┤
│ [SessionTabBar: 标签1 | 标签2 | +]                      │
├─────────────────────────────────────────────────────────┤
│ chat-header:                                            │
│   左侧: [会话标题]          右侧: [模型] [Provider]      │
│                                  [状态] [📜 历史] ← 新增 │
├─────────────────────────────────────────────────────────┤
│ chat-panel-body:                                        │
│   ┌───────────────────────────────────────────────────┐ │
│   │ MessageList                                       │ │
│   └───────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────┤
│ ChatInput                                              │
└─────────────────────────────────────────────────────────┘
```

#### 2.1.2 组件职责划分

| 组件 | 职责 |
|------|------|
| **ChatPanel.vue** | 添加历史按钮、管理弹窗显示状态、调用恢复逻辑 |
| **HistorySessionList.vue** | 显示会话列表、支持搜索过滤、触发选择事件 |
| **sessionHistoryManager.ts** | 后端：读取 ~/.claude/projects 目录、解析 JSONL 文件 |

### 2.2 文件变更清单

#### 2.2.1 需要修改的文件

1. **[ChatPanel.vue](src/components/layout/ChatPanel.vue)**
   - 在 `header-actions` 区域添加历史按钮图标
   - 添加弹窗组件和状态管理
   - 实现 `handleRestoreHistorySession()` 方法

2. **[Sidebar.vue](src/components/layout/Sidebar.vue)**
   - 移除"历史会话"按钮（第 63-69 行）
   - 移除 `showHistoryModal` 状态
   - 移除模态框模板（第 1190-1200 行）
   - 移除 `handleRestoreHistorySession()` 方法

3. **[HistorySessionList.vue](src/components/explorer/HistorySessionList.vue)**
   - 添加搜索输入框
   - 优化列表项样式
   - 支持按标题/时间过滤

4. **[sessionHistoryManager.ts](electron/sessionHistoryManager.ts)** ⭐ 核心修复
   - 重写 `sanitizePath()` 函数（对齐 engine 实现）
   - 重写 `decodeSanitizedPath()` 函数（实现反向映射）
   - 增强 `readSessionLite()` 元数据提取逻辑
   - 优化错误处理和日志记录

#### 2.2.2 无需修改的文件

- `claudeCodeIPC.ts` - IPC 接口已完善
- `preload.ts` - API 暴露已完成
- `engines/types.ts` - 类型定义稳定
- `ClaudeCodeEngine.ts` - 引擎层无需改动

---

## 3. 详细实现方案

### 3.1 ChatPanel.vue 修改

#### 3.1.1 模板变更

在 `<div class="header-actions">` 区域末尾添加：

```vue
<button
  class="history-btn"
  @click="showHistoryModal = true"
  title="历史会话"
>
  <History :size="16" />
</button>
```

添加模态框：

```vue
<!-- History Session Modal -->
<Transition name="modal">
  <div v-if="showHistoryModal" class="history-modal-overlay" @click.self="showHistoryModal = false">
    <div class="history-modal-content">
      <div class="history-modal-header">
        <h3>📜 恢复历史会话</h3>
        <button class="close-btn" @click="showHistoryModal = false">×</button>
      </div>
      <div class="history-modal-body">
        <input
          type="text"
          v-model="historySearchQuery"
          placeholder="搜索会话..."
          class="history-search-input"
        />
        <HistorySessionList
          :search-query="historySearchQuery"
          @select="handleRestoreHistorySession"
        />
      </div>
    </div>
  </div>
</Transition>
```

#### 3.1.2 脚本变更

```typescript
import { History } from 'lucide-vue-next'
import HistorySessionList from '../explorer/HistorySessionList.vue'

const showHistoryModal = ref(false)
const historySearchQuery = ref('')

async function handleRestoreHistorySession(session: any) {
  try {
    const claudeCode = (window as any).electronAPI?.claudeCode
    if (!claudeCode) return
    
    // 创建新会话
    const newSession = chatStore.createSession(
      session.title || '历史会话',
      session.projectPath || chatStore.currentProjectRoot || ''
    )
    
    // 恢复历史会话数据
    await claudeCode.restoreSession(session.id, session.projectPath)
    
    // 切换到新会话
    chatStore.selectSession(newSession.id)
    appStore.openSessionTab(newSession.id, newSession.title)
    
    showHistoryModal.value = false
  } catch (error) {
    console.error('Failed to restore history session:', error)
    // 可选：显示 Toast 提示
  }
}
```

#### 3.1.3 样式变更

```scss
.history-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-md);
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--surface-glass-hover);
    color: var(--text-primary);
  }
}

.history-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5); // ✅ 半透明黑色背景
  backdrop-filter: blur(4px);     // ✅ 毛玻璃效果
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
}

.history-modal-content {
  background: var(--surface-primary);   // ✅ 主题背景色
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);          // ✅ 阴影
  width: 90%;
  max-width: 650px;
  max-height: 75vh;
  overflow: hidden;
  animation: slideUp 0.3s ease;
}

.history-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .close-btn {
    background: none;
    border: none;
    font-size: 24px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
    line-height: 1;

    &:hover {
      color: var(--text-primary);
    }
  }
}

.history-modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  max-height: calc(75vh - 60px);
}

.history-search-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  font-size: 14px;
  margin-bottom: 12px;
  outline: none;
  transition: border-color 0.2s;

  &:focus {
    border-color: var(--color-accent);
  }

  &::placeholder {
    color: var(--text-muted);
  }
}
```

---

### 3.2 Sidebar.vue 修改

#### 3.2.1 移除内容

**删除的模板代码**（约第 63-69 行）：

```vue
<!-- 删除此块 -->
<button
  class="icon-btn"
  @click="showHistoryModal = true"
  title="恢复历史会话"
>
  <History :size="20" />
  <span class="icon-label">历史会话</span>
</button>
```

**删除的模态框代码**（约第 1190-1200 行）：

```vue
<!-- 删除整个 modal 块 -->
<div v-if="showHistoryModal" class="modal-overlay" @click.self="showHistoryModal = false">
  <div class="modal-content">
    ...
  </div>
</div>
```

**删除的脚本代码**：

```typescript
// 删除导入
import History from 'lucide-vue-next'
import HistorySessionList from '../explorer/HistorySessionList.vue'

// 删除状态
const showHistoryModal = ref(false)

// 删除方法
async function handleRestoreHistorySession(session: any) { ... }
```

---

### 3.3 HistorySessionList.vue 增强

#### 3.3.1 添加 Props

```typescript
const props = defineProps<{
  searchQuery?: string  // 新增：搜索关键词
}>()
```

#### 3.3.2 添加搜索过滤逻辑

```typescript
import { computed } from 'vue'

const filteredSessions = computed(() => {
  if (!props.searchQuery) return sessions.value
  
  const query = props.searchQuery.toLowerCase()
  return sessions.value.filter(session =>
    session.title?.toLowerCase().includes(query) ||
    session.projectPath?.toLowerCase().includes(query) ||
    session.lastMessagePreview?.toLowerCase().includes(query)
  )
})
```

#### 3.3.3 更新模板

将 `v-for="session in sessions"` 改为 `v-for="session in filteredSessions"`

---

### 3.4 sessionHistoryManager.ts 核心修复 ⭐

#### 3.4.1 问题根因分析

当前实现的 `decodeSanitizedPath()` 是空函数，导致跨项目会话无法正确加载。

Engine 源码中的路径转换规则（参考 `engine/src/utils/path.ts`）：

```typescript
// sanitize 规则
function sanitizePath(p: string): string {
  return p.replace(/[/\\:*?"<>|]/g, '_')
}

// 示例
// 输入: C:\Users\杨雅坤\Projects\SpaceCode
// 输出: C__Users_杨雅坤_Projects_SpaceCode
```

#### 3.4.2 修复后的完整实现

```typescript
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { app } from 'electron'

export interface SessionLite {
  projectPath: string
  sessionId: string
  metadata?: SessionMetadata
  firstUserMessage?: string
  lastMessageTimestamp?: number
}

export interface SessionMetadata {
  customTitle?: string
  lastPrompt?: string
  gitBranch?: string
  timestamps?: {
    createdAt?: string
    lastMessageAt?: string
  }
}

/**
 * 获取 Claude 配置目录 (~/.claude)
 */
function getClaudeConfigHomeDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'claude')
  }
  return path.join(os.homedir(), '.claude')
}

/**
 * 获取项目会话存储目录 (~/.claude/projects)
 */
function getClaudeProjectsDir(): string {
  return path.join(getClaudeConfigHomeDir(), 'projects')
}

/**
 * Sanitize 项目路径（与 engine 保持一致）
 * 替换特殊字符为下划线
 */
function sanitizePath(p: string): string {
  return p.replace(/[/\\:*?"<>|]/g, '_')
}

/**
 * 获取项目的会话存储目录
 */
function getProjectDir(projectPath: string): string {
  return path.join(getClaudeProjectsDir(), sanitizePath(projectPath))
}

/**
 * 从 sanitized 路径反向推导原始路径
 * 注意：这是一个近似算法，对于简单路径有效
 */
function decodeSanitizedPath(sanitized: string): string {
  // 尝试常见的反转规则
  // Windows 路径: C__Users_... → C:\Users\...
  if (/^[A-Z]__/.test(sanitized)) {
    return sanitized
      .replace(/^([A-Z])__/, '$1:\\')
      .replace(/_/g, '\\')
  }
  
  // Unix 路径: _home_user_... → /home/user/...
  if (sanitized.startsWith('_')) {
    return sanitized.replace(/_/g, '/')
  }
  
  // 默认返回原始值
  return sanitized
}

/**
 * 读取单个会话的轻量级信息
 */
async function readSessionLite(
  projectPath: string,
  sessionId: string
): Promise<SessionLite | undefined> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)
  
  if (!fs.existsSync(sessionPath)) {
    return undefined
  }
  
  let firstUserMessage: string | undefined
  let lastMessageTimestamp: number | undefined
  let metadata: SessionMetadata | undefined
  
  try {
    // 1. 尝试读取元数据文件
    const metadataPath = path.join(
      getProjectDir(projectPath),
      `${sessionId}.metadata.json`
    )
    
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
        
        // 从元数据提取时间戳
        if (metadata?.timestamps?.lastMessageAt) {
          lastMessageTimestamp = new Date(metadata.timestamps.lastMessageAt).getTime()
        }
      } catch (e) {
        console.warn(`Failed to parse metadata for session ${sessionId}:`, e)
      }
    }
    
    // 2. 读取 JSONL 文件提取首条用户消息和时间戳
    const fileContent = fs.readFileSync(sessionPath, 'utf8')
    const lines = fileContent.split('\n').filter(line => line.trim())
    
    for (const line of lines) {
      try {
        const msg = JSON.parse(line)
        
        // 提取首条用户消息
        if (msg.type === 'user' && !firstUserMessage) {
          const content = msg.message?.content
          
          if (typeof content === 'string') {
            firstUserMessage = content
          } else if (Array.isArray(content)) {
            const textItem = content.find((c: any) => c.type === 'text')
            firstUserMessage = textItem?.text || ''
          }
        }
        
        // 如果元数据中没有时间戳，尝试从消息中提取
        if (!metadata?.timestamps?.lastMessageAt && msg.timestamp) {
          const ts = new Date(msg.timestamp).getTime()
          if (!isNaN(ts) && (!lastMessageTimestamp || ts > lastMessageTimestamp)) {
            lastMessageTimestamp = ts
          }
        }
      } catch (e) {
        // 忽略单行解析错误
      }
    }
  } catch (e) {
    console.warn(`Failed to read session file ${sessionId}:`, e)
    return undefined
  }
  
  return {
    projectPath,
    sessionId,
    metadata,
    firstUserMessage,
    lastMessageTimestamp,
  }
}

/**
 * 加载指定项目的所有会话
 */
async function loadSameProjectSessions(cwd: string): Promise<SessionLite[]> {
  const projectDir = getProjectDir(cwd)
  
  if (!fs.existsSync(projectDir)) {
    console.debug(`Project directory not found: ${projectDir}`)
    return []
  }
  
  const sessions: SessionLite[] = []
  
  try {
    const entries = fs.readdirSync(projectDir)
    
    for (const entry of entries) {
      if (entry.endsWith('.jsonl')) {
        const sessionId = entry.slice(0, -'.jsonl'.length)
        const session = await readSessionLite(cwd, sessionId)
        
        if (session) {
          sessions.push(session)
        }
      }
    }
  } catch (e) {
    console.error(`Failed to load sessions for project ${cwd}:`, e)
  }
  
  // 按时间倒序排列
  sessions.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
  
  return sessions
}

/**
 * 加载所有项目的会话
 */
async function loadAllProjectsSessions(): Promise<SessionLite[]> {
  const projectsDir = getClaudeProjectsDir()
  
  if (!fs.existsSync(projectsDir)) {
    console.debug(`Projects directory not found: ${projectsDir}`)
    return []
  }
  
  const sessions: SessionLite[] = []
  
  try {
    const entries = fs.readdirSync(projectsDir)
    
    for (const entry of entries) {
      const entryPath = path.join(projectsDir, entry)
      
      // 只处理目录
      if (!fs.statSync(entryPath).isDirectory()) continue
      
      // 反向推导项目路径
      const projectPath = decodeSanitizedPath(entry)
      
      // 加载该项目的会话
      const projectSessions = await loadSameProjectSessions(projectPath)
      sessions.push(...projectSessions)
    }
  } catch (e) {
    console.error(`Failed to load all projects sessions:`, e)
  }
  
  // 全局去重（同一 session 可能出现在多个项目中）
  const uniqueSessions = new Map<string, SessionLite>()
  for (const session of sessions) {
    if (!uniqueSessions.has(session.sessionId)) {
      uniqueSessions.set(session.sessionId, session)
    }
  }
  
  // 按时间倒序排列
  const result = Array.from(uniqueSessions.values())
  result.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
  
  return result
}

/**
 * 加载完整会话数据（用于恢复）
 */
async function loadFullSession(
  projectPath: string,
  sessionId: string
): Promise<any> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)
  
  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Session file not found: ${sessionPath}`)
  }
  
  const messages: any[] = []
  const fileContent = fs.readFileSync(sessionPath, 'utf8')
  const lines = fileContent.split('\n').filter(line => line.trim())
  
  for (const line of lines) {
    try {
      messages.push(JSON.parse(line))
    } catch (e) {
      console.warn(`Failed to parse session line:`, e)
    }
  }
  
  // 读取元数据
  let metadata: SessionMetadata | undefined
  const metadataPath = path.join(getProjectDir(projectPath), `${sessionId}.metadata.json`)
  
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    } catch (e) {
      console.warn(`Failed to parse metadata:`, e)
    }
  }
  
  return {
    messages,
    metadata,
    projectPath,
    sessionId,
  }
}

export const SessionHistoryManager = {
  async listProjectSessions(cwd: string): Promise<SessionLite[]> {
    return loadSameProjectSessions(cwd)
  },

  async listAllSessions(): Promise<SessionLite[]> {
    return loadAllProjectsSessions()
  },

  async getFullSession(projectPath: string, sessionId: string): Promise<any> {
    return loadFullSession(projectPath, sessionId)
  },

  getSessionTitle(session: SessionLite): string {
    if (session.metadata?.customTitle) {
      return session.metadata.customTitle
    }
    if (session.firstUserMessage) {
      const preview = session.firstUserMessage.slice(0, 60)
      return preview.length < session.firstUserMessage.length ? preview + '...' : preview
    }
    return `Session ${session.sessionId.slice(0, 8)}`
  },

  formatTimestamp(timestamp?: number): string {
    if (!timestamp) return ''
    
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 24 * 60 * 60 * 1000) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleDateString(undefined, { weekday: 'short' })
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  },
}
```

---

## 4. 数据流图

### 4.1 用户交互流程

```
用户点击 ChatPanel 的 📜 按钮
         ↓
ChatPanel: showHistoryModal = true
         ↓
渲染 HistorySessionList 组件
         ↓
组件挂载 → 调用 loadSessions()
         ↓
IPC: electronAPI.claudeCode.listProjectSessions(cwd)
         ↓
Main Process: SessionHistoryManager.listProjectSessions(cwd)
         ↓
读取 ~/.claude/projects/{sanitized_path}/*.jsonl
         ↓
返回 SessionLite[] 到 Renderer
         ↓
渲染会话列表（支持搜索过滤）
         ↓
用户点击某个会话
         ↓
emit('select', session)
         ↓
ChatPanel.handleRestoreHistorySession(session)
         ↓
chatStore.createSession(title, projectPath)  // 创建新会话
claudeCode.restoreSession(sessionId, projectPath)  // 恢复数据
chatStore.selectSession(newSession.id)  // 切换到新会话
         ↓
关闭弹窗，显示恢复的会话
```

### 4.2 文件依赖关系

```
ChatPanel.vue
    ├── imports: HistorySessionList.vue
    ├── calls: electronAPI.claudeCode.*
    └── uses: chatStore, appStore

HistorySessionList.vue
    ├── receives: searchQuery (prop)
    ├── emits: select (event)
    └── calls: electronAPI.claudeCode.listProjectSessions/listAllSessions

sessionHistoryManager.ts (Main Process)
    ├── reads: ~/.claude/projects/**/*.jsonl
    ├── parses: JSONL format + metadata.json
    └── returns: SessionLite[] or FullSession
```

---

## 5. 错误处理策略

### 5.1 可能的错误场景

| 场景 | 处理方式 |
|------|---------|
| `~/.claude/projects` 目录不存在 | 返回空数组，显示"暂无历史会话" |
| JSONL 文件损坏 | 跳过该文件，记录警告日志 |
| Metadata 解析失败 | 使用默认值（sessionId 前 8 位作为标题） |
| 权限不足（无读取权限） | 捕获异常，显示错误提示 |
| 恢复会话失败 | Toast 提示"恢复失败"，不影响当前会话 |
| 搜索无结果 | 显示"未找到匹配的会话" |

### 5.2 日志规范

使用现有的 logger 模块：

```typescript
import { info, warn, error, debug } from './logger'

info('SessionHistory', `Loaded ${sessions.length} sessions for project ${cwd}`)
warn('SessionHistory', `Failed to parse metadata for session ${sessionId}`, { error: e })
error('SessionHistory', `Failed to load sessions`, { error: e })
debug('SessionHistory', `Reading session file: ${sessionPath}`)
```

---

## 6. 测试计划

### 6.1 单元测试

- [ ] `sanitizePath()` 函数测试
  - Windows 路径: `C:\Users\Test` → `C__Users_Test`
  - Unix 路径: `/home/user/project` → `_home_user_project`
  - 特殊字符处理
  
- [ ] `readSessionLite()` 测试
  - 正常 JSONL 文件
  - 缺少 metadata.json
  - 空文件
  - 损坏的 JSON 行

- [ ] `loadSameProjectSessions()` 测试
  - 目录不存在
  - 目录为空
  - 包含多个会话
  - 时间排序正确性

### 6.2 集成测试

- [ ] IPC 调用链路测试
  - Renderer → Main Process → 文件系统
  - 数据格式正确性

- [ ] UI 交互测试
  - 弹窗打开/关闭
  - 搜索过滤功能
  - 会话选择和恢复流程

### 6.3 手动验证清单

- [ ] 在 Windows/Linux/macOS 上测试路径 sanitize
- [ ] 使用真实 `~/.claude/projects` 目录测试
- [ ] 验证中文路径支持（如 `杨雅坤`）
- [ ] 测试大文件会话（>1000 行 JSONL）
- [ ] 验证弹窗背景不透明度
- [ ] 测试搜索性能（100+ 会话）

---

## 7. 性能考虑

### 7.1 潜在瓶颈

1. **大量会话文件**: 如果项目有数百个会话，同步读取可能阻塞主进程
2. **大 JSONL 文件**: 单个文件超过 10MB 时，全量读取影响性能

### 7.2 优化策略

- **懒加载**: 首次只加载前 20 个会话，滚动时加载更多
- **缓存机制**: 缓存最近一次查询结果，5 分钟内不重复读取
- **异步 I/O**: 使用 `fs.promises` 替代 `fs.readFileSync`（如果需要）
- **索引文件**: 可选：维护一个轻量级索引文件加速查询

### 7.3 当前方案说明

本版本采用**同步读取 + 简单缓存**策略：
- 同步读取是因为 Electron 主进程不受 UI 线程限制
- 会话数量通常 < 100，性能可接受
- 后续可根据实际反馈优化为异步流式读取

---

## 8. 未来扩展方向

### 8.1 可能的功能增强

1. **会话标签/收藏**: 允许用户标记重要会话
2. **批量操作**: 批量删除/导出会话
3. **云同步**: 将历史会话备份到云端
4. **智能搜索**: 支持自然语言查询（如"上周关于 bug 修复的对话"）
5. **可视化统计**: 会话频率、常用工具等图表展示

### 8.2 技术债务清理

- 考虑将 `sessionHistoryManager.ts` 拆分为独立的模块
- 统一错误处理机制
- 添加 TypeScript 严格类型检查

---

## 9. 总结

本设计方案聚焦于三个核心问题：

1. **✅ UI 位置优化**: 从侧边栏迁移到 ChatPanel 标题栏，提升可达性
2. **✅ 视觉修复**: 解决透明弹窗问题，提供现代化的毛玻璃效果
3. **✅ 功能修复**: 对齐 engine 源码实现，确保历史会话正确读取

通过模块化设计和清晰的接口定义，本方案具有良好的可维护性和扩展性。

---

**文档版本**: 1.0
**最后更新**: 2026-05-15
**下一步**: 调用 writing-plans 技能创建详细实现计划
