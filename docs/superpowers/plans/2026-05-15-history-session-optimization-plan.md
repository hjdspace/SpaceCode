# 历史会话功能优化 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将历史会话功能从侧边栏迁移到 ChatPanel 标题栏右侧，修复透明弹窗问题，完善会话读取逻辑（对齐 engine 源码），添加搜索功能，恢复时创建新会话。

**架构：**
- UI 层：ChatPanel.vue 添加历史按钮 + 模态框（毛玻璃效果）
- 组件层：HistorySessionList.vue 增强搜索过滤
- 后端层：sessionHistoryManager.ts 重写路径解析和会话读取逻辑
- 清理层：Sidebar.vue 移除旧的历史按钮和模态框

**技术栈：** Vue 3 (Composition API), TypeScript, Electron IPC, Lucide Icons, SCSS

---

## 文件结构

### 需要修改的文件

| 文件路径 | 操作 | 职责 |
|---------|------|------|
| `src/components/layout/ChatPanel.vue` | **修改** | 添加历史按钮、模态框、恢复逻辑 |
| `src/components/layout/Sidebar.vue` | **修改** | 移除旧历史按钮和模态框 |
| `src/components/explorer/HistorySessionList.vue` | **修改** | 添加搜索过滤功能 |
| `electron/sessionHistoryManager.ts` | **重写** | 核心修复：路径解析、会话读取 |

### 无需修改的文件

- `electron/claudeCodeIPC.ts` - IPC 接口已完善
- `electron/preload.ts` - API 暴露已完成
- `electron/engines/types.ts` - 类型定义稳定
- `electron/engines/ClaudeCodeEngine.ts` - 引擎层无需改动

---

## 任务清单

### 任务 1：重写 sessionHistoryManager.ts（核心修复）

**文件：**
- 修改：`electron/sessionHistoryManager.ts`

**目标：** 对齐 engine 源码的路径 sanitize 规则，完善会话读取逻辑

- [ ] **步骤 1：备份当前文件**

```bash
cp electron/sessionHistoryManager.ts electron/sessionHistoryManager.ts.backup
```

预期：创建备份文件

- [ ] **步骤 2：重写 sanitizePath 和路径工具函数**

在文件顶部替换所有工具函数为以下实现：

```typescript
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { info, warn, error, debug } from './logger'

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
 * Sanitize 项目路径（与 engine/src/utils/path.ts 保持一致）
 * 替换特殊字符 / \ : * ? " < > | 为下划线
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
```

验证：检查函数是否存在语法错误

- [ ] **步骤 3：实现 decodeSanitizedPath 反向映射**

```typescript
/**
 * 从 sanitized 路径反向推导原始路径
 * 处理常见模式：
 * - Windows: C__Users_... → C:\Users\...
 * - Unix: _home_user_... → /home/user/...
 */
function decodeSanitizedPath(sanitized: string): string {
  // Windows 路径模式: C__Users_...
  if (/^[A-Z]__/.test(sanitized)) {
    const driveLetter = sanitized[0]
    const rest = sanitized.slice(3).replace(/_/g, path.sep)
    return `${driveLetter}:${path.sep}${rest}`
  }
  
  // Unix 路径模式: _home_user_...
  if (sanitized.startsWith('_')) {
    return sanitized.replace(/_/g, path.sep)
  }
  
  // 默认返回原始值（可能已经是正确路径）
  return sanitized
}
```

测试用例：
```javascript
// Windows
sanitizePath('C:\\Users\\杨雅坤\\SpaceCode') 
// => 'C__Users_杨雅坤_SpaceCode'

decodeSanitizedPath('C__Users_杨雅坤_SpaceCode')
// => 'C:\\Users\\杨雅坤\\SpaceCode'

// Unix
sanitizePath('/home/user/project')
// => '_home_user_project'

decodeSanitizedPath('_home_user_project')
// => '/home/user/project'
```

- [ ] **步骤 4：实现 readSessionLite 函数**

```typescript
/**
 * 读取单个会话的轻量级信息
 * 提取首条用户消息、时间戳、元数据
 */
async function readSessionLite(
  projectPath: string,
  sessionId: string
): Promise<SessionLite | undefined> {
  const sessionPath = path.join(getProjectDir(projectPath), `${sessionId}.jsonl`)
  
  if (!fs.existsSync(sessionPath)) {
    debug('SessionHistory', `Session file not found: ${sessionPath}`)
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
        const raw = fs.readFileSync(metadataPath, 'utf8')
        metadata = JSON.parse(raw)
        
        // 从元数据提取时间戳
        if (metadata?.timestamps?.lastMessageAt) {
          lastMessageTimestamp = new Date(metadata.timestamps.lastMessageAt).getTime()
        }
        
        debug('SessionHistory', `Loaded metadata for session ${sessionId}`)
      } catch (e) {
        warn('SessionHistory', `Failed to parse metadata for ${sessionId}`, { error: String(e) })
      }
    }
    
    // 2. 读取 JSONL 文件提取首条用户消息和时间戳
    const fileContent = fs.readFileSync(sessionPath, 'utf8')
    const lines = fileContent.split('\n').filter(line => line.trim())
    
    for (const line of lines) {
      try {
        const msg = JSON.parse(line)
        
        // 提取首条用户消息（跳过系统消息等）
        if (msg.type === 'user' && !firstUserMessage) {
          const content = msg.message?.content
          
          if (typeof content === 'string') {
            firstUserMessage = content.trim()
          } else if (Array.isArray(content)) {
            const textItem = content.find((c: any) => c.type === 'text')
            firstUserMessage = textItem?.text?.trim() || ''
          }
          
          if (firstUserMessage) {
            debug('SessionHistory', `Found first user message for ${sessionId}: ${firstUserMessage.slice(0, 50)}...`)
          }
        }
        
        // 如果元数据中没有时间戳，尝试从消息中提取最新的
        if (!metadata?.timestamps?.lastMessageAt && msg.timestamp) {
          const ts = new Date(msg.timestamp).getTime()
          if (!isNaN(ts)) {
            if (!lastMessageTimestamp || ts > lastMessageTimestamp) {
              lastMessageTimestamp = ts
            }
          }
        }
      } catch (e) {
        // 忽略单行 JSON 解析错误（可能是非标准格式）
      }
    }
    
    if (lines.length === 0) {
      warn('SessionHistory', `Empty session file: ${sessionPath}`)
    }
    
  } catch (e) {
    error('SessionHistory', `Failed to read session file ${sessionPath}`, { error: String(e) })
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
```

- [ ] **步骤 5：实现 loadSameProjectSessions**

```typescript
/**
 * 加载指定项目的所有会话
 * @param cwd 项目工作目录
 * @returns 按时间倒序排列的会话列表
 */
async function loadSameProjectSessions(cwd: string): Promise<SessionLite[]> {
  const projectDir = getProjectDir(cwd)
  
  if (!fs.existsSync(projectDir)) {
    info('SessionHistory', `Project directory not found: ${projectDir}`)
    return []
  }
  
  const sessions: SessionLite[] = []
  
  try {
    const entries = fs.readdirSync(projectDir)
    info('SessionHistory', `Found ${entries.length} entries in ${projectDir}`)
    
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue
      
      const sessionId = entry.slice(0, -'.jsonl'.length)
      
      // 跳过临时文件和隐藏文件
      if (sessionId.startsWith('.') || sessionId.endsWith('.tmp')) continue
      
      const session = await readSessionLite(cwd, sessionId)
      if (session) {
        sessions.push(session)
      }
    }
  } catch (e) {
    error('SessionHistory', `Failed to load sessions for project ${cwd}`, { error: String(e) })
  }
  
  // 按时间倒序排列（最新在前）
  sessions.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
  
  info('SessionHistory', `Loaded ${sessions.length} sessions for project ${cwd}`)
  return sessions
}
```

- [ ] **步骤 6：实现 loadAllProjectsSessions**

```typescript
/**
 * 加载所有项目的会话
 * @returns 全局去重后的会话列表
 */
async function loadAllProjectsSessions(): Promise<SessionLite[]> {
  const projectsDir = getClaudeProjectsDir()
  
  if (!fs.existsSync(projectsDir)) {
    warn('SessionHistory', `Projects directory not found: ${projectsDir}`)
    return []
  }
  
  const allSessions: SessionLite[] = []
  
  try {
    const entries = fs.readdirSync(projectsDir)
    info('SessionHistory', `Found ${entries.length} project directories`)
    
    for (const entry of entries) {
      const entryPath = path.join(projectsDir, entry)
      
      // 只处理目录
      try {
        if (!fs.statSync(entryPath).isDirectory()) continue
      } catch {
        continue
      }
      
      // 反向推导项目路径
      const projectPath = decodeSanitizedPath(entry)
      
      // 加载该项目的会话
      const projectSessions = await loadSameProjectSessions(projectPath)
      allSessions.push(...projectSessions)
    }
  } catch (e) {
    error('SessionHistory', `Failed to load all projects`, { error: String(e) })
  }
  
  // 全局去重（同一 sessionId 可能出现在多个项目中）
  const uniqueSessions = new Map<string, SessionLite>()
  for (const session of allSessions) {
    if (!uniqueSessions.has(session.sessionId)) {
      uniqueSessions.set(session.sessionId, session)
    }
  }
  
  // 按时间倒序排列
  const result = Array.from(uniqueSessions.values())
  result.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0))
  
  info('SessionHistory', `Total unique sessions: ${result.length}`)
  return result
}
```

- [ ] **步骤 7：实现 loadFullSession 和导出 SessionHistoryManager**

```typescript
/**
 * 加载完整会话数据（用于恢复）
 * 包含完整消息历史和元数据
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
      warn('SessionHistory', `Failed to parse line in ${sessionId}`, { error: String(e) })
    }
  }
  
  // 读取元数据
  let metadata: SessionMetadata | undefined
  const metadataPath = path.join(getProjectDir(projectPath), `${sessionId}.metadata.json`)
  
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    } catch (e) {
      warn('SessionHistory', `Failed to parse metadata for ${sessionId}`, { error: String(e) })
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

    // 1 天内显示时间
    if (diff < 24 * 60 * 60 * 1000) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    // 1 周内显示星期
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      return date.toLocaleDateString(undefined, { weekday: 'short' })
    }
    // 其他显示日期
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  },
}
```

- [ ] **步骤 8：验证 TypeScript 编译**

运行：
```bash
cd d:/AI/SpaceCode && npx tsc --noEmit electron/sessionHistoryManager.ts
```

预期：无类型错误

- [ ] **步骤 9：Commit**

```bash
git add electron/sessionHistoryManager.ts
git commit -m "fix: rewrite session history manager to align with engine source"
```

---

### 任务 2：增强 HistorySessionList.vue（添加搜索功能）

**文件：**
- 修改：`src/components/explorer/HistorySessionList.vue`

**目标：** 添加搜索输入框和过滤逻辑

- [ ] **步骤 1：添加 searchQuery prop**

在 `<script setup>` 中添加：

```typescript
const props = defineProps<{
  searchQuery?: string  // 新增：来自父组件的搜索关键词
}>()
```

- [ ] **步骤 2：添加计算属性 filteredSessions**

```typescript
import { computed } from 'vue'

const filteredSessions = computed(() => {
  if (!props.searchQuery?.trim()) {
    return sessions.value
  }
  
  const query = props.searchQuery.toLowerCase().trim()
  
  return sessions.value.filter(session => {
    // 搜索标题
    if (session.title?.toLowerCase().includes(query)) return true
    
    // 搜索项目路径
    if (session.projectPath?.toLowerCase().includes(query)) return true
    
    // 搜索消息预览
    if (session.lastMessagePreview?.toLowerCase().includes(query)) return true
    
    return false
  })
})
```

- [ ] **步骤 3：更新模板使用 filteredSessions**

将第 30 行：
```vue
<div v-for="session in sessions" :key="session.id">
```
改为：
```vue
<div v-for="session in filteredSessions" :key="session.id">
```

- [ ] **步骤 4：添加空结果提示**

在 `<div v-else-if="sessions.length === 0">` 之后添加：

```vue
<div v-else-if="searchQuery && filteredSessions.length === 0" class="empty-state">
  <span>未找到匹配 "{{ searchQuery }}" 的会话</span>
</div>
```

- [ ] **步骤 5：优化样式**

在 `<style>` 中添加：

```scss
.empty-state {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}
```

- [ ] **步骤 6：Commit**

```bash
git add src/components/explorer/HistorySessionList.vue
git commit -m "feat: add search/filter functionality to history session list"
```

---

### 任务 3：修改 ChatPanel.vue（添加历史按钮和弹窗）

**文件：**
- 修改：`src/components/layout/ChatPanel.vue`

**目标：** 在标题栏右侧添加历史按钮，集成模态框

- [ ] **步骤 1：添加导入**

在文件顶部的 import 区域添加：

```typescript
import { History } from 'lucide-vue-next'
import HistorySessionList from '../explorer/HistorySessionList.vue'
```

- [ ] **步骤 2：添加状态变量**

在 `<script setup>` 中添加：

```typescript
const showHistoryModal = ref(false)
const historySearchQuery = ref('')
```

- [ ] **步骤 3：在 header-actions 中添加历史按钮**

在第 53 行（`</div>` 关闭 header-actions 之前）插入：

```vue
<button
  class="history-btn"
  @click="showHistoryModal = true"
  title="历史会话"
>
  <History :size="16" />
</button>
```

- [ ] **步骤 4：在 </main> 之前添加模态框模板**

```vue
<!-- History Session Modal -->
<Transition name="modal-fade">
  <div 
    v-if="showHistoryModal" 
    class="history-modal-overlay" 
    @click.self="showHistoryModal = false"
  >
    <div class="history-modal-content">
      <div class="history-modal-header">
        <h3>📜 恢复历史会话</h3>
        <button class="history-close-btn" @click="showHistoryModal = false">×</button>
      </div>
      
      <div class="history-modal-body">
        <!-- 搜索输入框 -->
        <input
          type="text"
          v-model="historySearchQuery"
          placeholder="🔍 搜索会话标题、路径..."
          class="history-search-input"
          autofocus
        />
        
        <!-- 会话列表 -->
        <HistorySessionList
          :search-query="historySearchQuery"
          @select="handleRestoreHistorySession"
        />
      </div>
    </div>
  </div>
</Transition>
```

- [ ] **步骤 5：实现 handleRestoreHistorySession 方法**

```typescript
async function handleRestoreHistorySession(session: any) {
  try {
    info('ChatPanel', `Restoring history session | id=${session.id} | title=${session.title}`)
    
    const claudeCode = (window as any).electronAPI?.claudeCode
    if (!claudeCode) {
      error('ChatPanel', 'claudeCode API not available')
      return
    }
    
    // 创建新会话（不覆盖当前会话）
    const workingDirectory = session.projectPath || chatStore.currentProjectRoot || ''
    const newSession = chatStore.createSession(
      session.title || '历史会话',
      workingDirectory
    )
    
    info('ChatPanel', `Created new session | id=${newSession.id} | title=${newSession.title}`)
    
    // 调用后端恢复历史会话数据
    await claudeCode.restoreSession(session.id, workingDirectory)
    
    // 切换到新会话
    chatStore.selectSession(newSession.id)
    appStore.openSessionTab(newSession.id, newSession.title)
    
    // 关闭弹窗
    showHistoryModal.value = false
    historySearchQuery.value = ''
    
    info('ChatPanel', `Successfully restored session | newSessionId=${newSession.id}`)
    
  } catch (err) {
    error('ChatPanel', `Failed to restore history session`, { error: String(err) })
    alert('恢复历史会话失败，请重试')
  }
}
```

- [ ] **步骤 6：添加模态框样式**

在 `<style lang="scss">` 中添加：

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

.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.history-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);  // ✅ 半透明黑色背景
  backdrop-filter: blur(4px);       // ✅ 毛玻璃效果
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.history-modal-content {
  background: var(--surface-primary);   // ✅ 使用主题背景色
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 
              0 10px 10px -5px rgba(0, 0, 0, 0.04);  // ✅ 阴影
  width: 90%;
  max-width: 650px;
  max-height: 75vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.history-modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--surface-secondary);

  h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .history-close-btn {
    background: none;
    border: none;
    font-size: 28px;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
    line-height: 1;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    transition: all 0.2s;

    &:hover {
      background: var(--surface-glass-hover);
      color: var(--text-primary);
    }
  }
}

.history-modal-body {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
}

.history-search-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  font-size: 14px;
  margin-bottom: 12px;
  outline: none;
  transition: all 0.2s ease;
  box-sizing: border-box;

  &:focus {
    border-color: #6366f1;  // Indigo accent color
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
  }

  &::placeholder {
    color: var(--text-muted);
  }
}
```

- [ ] **步骤 7：验证编译**

运行：
```bash
cd d:/AI/SpaceCode && npm run typecheck
# 或
npm run build
```

预期：无编译错误

- [ ] **步骤 8：Commit**

```bash
git add src/components/layout/ChatPanel.vue
git commit -m "feat: add history session button and modal to ChatPanel header"
```

---

### 任务 4：清理 Sidebar.vue（移除旧代码）

**文件：**
- 修改：`src/components/layout/Sidebar.vue`

**目标：** 移除侧边栏中的历史按钮和模态框（避免功能重复）

- [ ] **步骤 1：移除历史按钮模板**

删除第 63-69 行的按钮代码块：

```vue
<!-- 删除此块开始 -->
<button
  class="icon-btn"
  @click="showHistoryModal = true"
  title="恢复历史会话"
>
  <History :size="20" />
  <span class="icon-label">历史会话</span>
</button>
<!-- 删除此块结束 -->
```

- [ ] **步骤 2：移除模态框模板**

删除约第 1190-1200 行的整个 modal 块：

```vue
<!-- 删除整个块开始 -->
<div v-if="showHistoryModal" class="modal-overlay" @click.self="showHistoryModal = false">
  <div class="modal-content">
    <div class="modal-header">
      <h3>恢复历史会话</h3>
      <button class="close-btn" @click="showHistoryModal = false">×</button>
    </div>
    <div class="modal-body">
      <HistorySessionList @select="handleRestoreHistorySession" />
    </div>
  </div>
</div>
<!-- 删除整个块结束 -->
```

- [ ] **步骤 3：移除相关导入**

删除：
```typescript
import { History } from 'lucide-vue-next'  // 如果没有其他地方使用
import HistorySessionList from '../explorer/HistorySessionList.vue'
```

注意：如果其他地方还使用了这些导入，保留它们。

- [ ] **步骤 4：移除状态和方法**

删除：
```typescript
const showHistoryModal = ref(false)

async function handleRestoreHistorySession(session: any) { ... }
```

- [ ] **步骤 5：移除相关样式（如果有）**

查找并删除 `.modal-overlay`, `.modal-content`, `.modal-header`, `.modal-body`, `.close-btn` 等样式类（如果仅用于历史模态框）

- [ ] **步骤 6：验证编译**

运行：
```bash
npm run typecheck
```

预期：无错误（如果 History 图标在其他地方还有使用）

- [ ] **步骤 7：Commit**

```bash
git add src/components/layout/Sidebar.vue
git commit -m "refactor: remove legacy history session button and modal from sidebar"
```

---

### 任务 5：端到端测试和验证

**文件：**
- 无新文件（测试现有功能）

**目标：** 验证所有功能正常工作

- [ ] **步骤 1：启动开发服务器**

```bash
npm run dev
```

预期：应用正常启动，无控制台错误

- [ ] **步骤 2：手动验证 UI 变更**

检查项：
- [ ] ChatPanel 标题栏右侧出现 📜 历史按钮
- [ ] 点击按钮弹出模态框（不透明背景 + 毛玻璃效果）
- [ ] 侧边栏不再显示"历史会话"按钮
- [ ] 模态框包含搜索输入框
- [ ] 会话列表正常显示

- [ ] **步骤 3：验证搜索功能**

操作：
1. 打开历史会话弹窗
2. 输入搜索关键词（如"bug"、"优化"）
3. 验证列表实时过滤

预期：只显示匹配的会话，无匹配时显示提示文字

- [ ] **步骤 4：验证会话恢复流程**

操作：
1. 点击某个历史会话
2. 验证是否创建了新会话（非覆盖当前会话）
3. 验证新会话标签页打开
4. 验证历史消息加载成功

预期：新会话创建，历史数据加载完成

- [ ] **步骤 5：验证边界情况**

测试场景：
- [ ] 空项目（无历史会话时显示空状态）
- [ ] 大量会话（100+ 个，性能可接受）
- [ ] 中文路径支持（如 `C:\Users\杨雅坤\...`）
- [ ] 特殊字符路径
- [ ] 损坏的 JSONL 文件（应跳过而非崩溃）

- [ ] **步骤 6：检查浏览器控制台**

打开 DevTools Console，确认：
- 无红色错误
- 日志信息清晰（SessionHistory 相关日志）

- [ ] **步骤 7：最终 Commit（如有小修复）**

```bash
git add -A
git commit -m "test: verify history session optimization works correctly"
```

---

## 自检清单

### ✅ 规格覆盖度

| 需求 | 对应任务 | 状态 |
|------|---------|------|
| 迁移到 ChatPanel 标题栏 | 任务 3 | ✅ |
| 修复透明弹窗 | 任务 3（步骤 6） | ✅ |
| 完善 sessionHistoryManager | 任务 1 | ✅ |
| 添加搜索功能 | 任务 2 | ✅ |
| 恢复时创建新会话 | 任务 3（步骤 5） | ✅ |
| 移除侧边栏旧代码 | 任务 4 | ✅ |
| 端到端测试 | 任务 5 | ✅ |

### ✅ 占位符扫描

- [x] 无 "TODO" 或 "待定"
- [x] 所有代码步骤包含实际实现
- [x] 所有命令可执行
- [x] 无引用未定义的类型/方法

### ✅ 类型一致性

- [x] `SessionLite` 接口定义一致（task 1 → task 2）
- [x] 方法签名一致（`handleRestoreHistorySession` 参数类型）
- [x] Props 名称一致（`search-query` vs `searchQuery`）

---

## 执行顺序建议

**推荐顺序：** 任务 1 → 任务 2 → 任务 3 → 任务 4 → 任务 5

**原因：**
1. 先修复核心逻辑（sessionHistoryManager），确保数据层稳定
2. 再增强组件层（HistorySessionList 搜索）
3. 然后集成到 ChatPanel（UI 层）
4. 最后清理旧代码（Sidebar）
5. 最终端到端验证

每个任务完成后都进行 Commit，便于回滚和审查。

---

## 预估工作量

| 任务 | 预估时间 | 复杂度 |
|------|---------|--------|
| 任务 1：重写 sessionHistoryManager | 30-40 分钟 | ⭐⭐⭐ 高 |
| 任务 2：增强 HistorySessionList | 15-20 分钟 | ⭐⭐ 中 |
| 任务 3：修改 ChatPanel | 25-35 分钟 | ⭐⭐⭐ 高 |
| 任务 4：清理 Sidebar | 10-15 分钟 | ⭐ 低 |
| 任务 5：端到端测试 | 20-30 分钟 | ⭐⭐ 中 |
| **总计** | **100-140 分钟** | — |

---

## 风险和注意事项

### ⚠️ 潜在风险

1. **路径兼容性**: Windows/Linux/macOS 路径分隔符差异
   - 缓解：使用 `path.join()` 和 `path.sep` 而非硬编码
   
2. **大文件性能**: 单个 JSONL > 50MB 时可能卡顿
   - 缓解：当前版本采用同步读取，后续可优化为流式读取
   
3. **并发访问**: 多个窗口同时访问同一会话文件
   - 缓解：只读操作，风险较低

### 📝 注意事项

- 修改前务必备份（任务 1 步骤 1 已包含）
- 每个 Task 完成后立即 Commit
- 如遇编译错误，先检查 TypeScript 类型
- 测试时使用真实 `~/.claude/projects` 数据

---

**文档版本:** 1.0  
**最后更新:** 2026-05-15  
**设计文档:** [2026-05-15-history-session-optimization-design.md](../specs/2026-05-15-history-session-optimization-design.md)
