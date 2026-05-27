# 历史会话 Resume 机制修复实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 修复历史会话恢复功能，使点击历史会话后能正确复用原始 Session ID，通过 Claude Code CLI 的 `--resume` 机制让 LLM 获得完整上下文。

**架构：** 修改 `createSession()` 方法支持传入指定 Session ID → 重写 `handleRestoreHistorySession()` 使用原始 ID 创建/复用 Session → CLI 自动检测到已有 transcript 文件并使用 `--resume` 启动。

**技术栈：** Vue 3 (Composition API), TypeScript, Electron IPC, Claude Code CLI

---

## 文件结构

| 文件 | 职责 | 变更类型 |
|------|------|---------|
| `src/stores/chat.ts:423-452` | Session 状态管理，提供 `createSession()` 方法 | **修改** - 扩展方法签名 |
| `src/components/layout/ChatPanel.vue:573-621` | 历史会话恢复 UI 处理逻辑 | **修改** - 重写恢复函数 |
| `electron/sessionProcess.ts:822-836` | CLI 参数构建（已有 resume 逻辑） | **无需修改** - 自动适配 |

---

### 任务 1：扩展 createSession() 方法支持指定 Session ID

**文件：**
- 修改：`src/stores/chat.ts:423-452`

- [ ] **步骤 1：修改 createSession() 方法签名和实现**

将：
```typescript
function createSession(title = 'New Chat', workingDirectory?: string): Session {
  const session: Session = {
    id: crypto.randomUUID(),
    // ...
  }
```

改为：
```typescript
function createSession(title = 'New Chat', workingDirectory?: string, sessionId?: string): Session {
  const id = sessionId || crypto.randomUUID()
  
  const session: Session = {
    id,
    title,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    workingDirectory: workingDirectory || currentProjectRoot.value || undefined,
    processStatus: 'none',
    isTabOpen: true,
    lastActivityAt: Date.now()
  }
  
  sessions.value.unshift(session)
  currentSessionId.value = session.id
  saveToStorage()
  
  traceEvent({
    sessionId: session.id,
    actor: 'system',
    type: sessionId ? 'session_restored' : 'session_created',
    status: 'completed',
    title: sessionId ? 'Chat session restored from history' : 'Chat session created',
    metadata: { title: session.title, workingDirectory: session.workingDirectory },
  })
  
  return session
}
```

- [ ] **步骤 2：验证 TypeScript 编译无错误**

运行：`npx vue-tsc --noEmit`
预期：✅ 无类型错误

- [ ] **步骤 3：Commit**

```bash
git add src/stores/chat.ts
git commit -m "feat(chat): extend createSession to support custom session ID for history restore"
```

---

### 任务 2：重写 handleRestoreHistorySession() 实现原生 Resume

**文件：**
- 修改：`src/components/layout/ChatPanel.vue:573-621`

- [ ] **步骤 1：重写历史会话恢复逻辑**

将整个 `handleRestoreHistorySession` 函数（第 573-621 行）替换为：

```typescript
async function handleRestoreHistorySession(session: any) {
  try {
    const claudeCode = (window as any).electronAPI?.claudeCode
    if (!claudeCode || !session?.sessionId) return
    
    const existingSession = chatStore.sessions.find(s => s.id === session.sessionId)
    
    if (existingSession) {
      console.log('[ChatPanel] Reusing existing session:', session.sessionId)
      chatStore.selectSession(session.sessionId)
      appStore.openSessionTab(session.sessionId, existingSession.title)
      showHistoryModal.value = false
      return
    }
    
    const fullSession = await claudeCode.getFullSession(session.projectPath, session.sessionId)
    if (!fullSession?.messages) return
    
    const restoredSession = chatStore.createSession(
      session.metadata?.customTitle ||
      (session.firstUserMessage ? session.firstUserMessage.slice(0, 60) : '历史会话恢复'),
      session.projectPath,
      session.sessionId
    )
    
    for (const msg of fullSession.messages) {
      if (msg.type === 'user' && msg.message?.content) {
        let content = ''
        if (typeof msg.message.content === 'string') {
          content = msg.message.content
        } else if (Array.isArray(msg.message.content)) {
          const textItem = msg.message.content.find((c: any) => c.type === 'text')
          content = textItem?.text || ''
        }
        
        if (content.trim()) {
          chatStore.addMessage({ role: 'user', content }, restoredSession.id)
        }
      } else if (msg.type === 'assistant' && msg.message?.content) {
        let content = ''
        if (typeof msg.message.content === 'string') {
          content = msg.message.content
        } else if (Array.isArray(msg.message.content)) {
          content = msg.message.content.map((c: any) => 
            c.type === 'text' ? c.text : `[${c.type}]`
          ).join('\n')
        }
        
        if (content.trim()) {
          chatStore.addMessage({ role: 'assistant', content }, restoredSession.id)
        }
      }
    }
    
    showHistoryModal.value = false
    
    console.log(
      '[ChatPanel] History session restored with original ID:', 
      restoredSession.id, 
      '| Messages loaded:', 
      restoredSession.messages.length
    )
  } catch (error) {
    console.error('[ChatPanel] Failed to restore history session:', error)
  }
}
```

- [ ] **步骤 2：验证 addMessage 方法支持指定 sessionId**

检查 `chat.ts` 中的 `addMessage` 函数签名是否为：
```typescript
function addMessage(message: Omit<Message, 'id'>, sessionId?: string): void
```

如果第二个参数不存在或不是可选的，需要调整调用方式。

- [ ] **步骤 3：验证 Vue 组件编译无错误**

运行：`npx vite build`
预期：✅ 构建成功

- [ ] **步骤 4：Commit**

```bash
git add src/components/layout/ChatPanel.vue
git commit -m "fix(chat): rewrite history session restore to reuse original session ID"
```

---

### 任务 3：端到端验证与测试

**文件：**
- 验证：`electron/sessionProcess.ts:822-836`（无需修改，仅验证）
- 测试：手动功能测试

- [ ] **步骤 1：验证 CLI 参数构建逻辑**

确认 `sessionProcess.ts` 第 836 行的逻辑会在以下条件时自动使用 `--resume`：

```typescript
// 当 this.transcriptFileExists(config.cwd, this.sessionId) 返回 true 时
// 应该执行：args.push('--resume', this.sessionId)
```

预期：✅ 因为我们的 sessionId 现在是历史会话的原始 ID，对应的 jsonl 文件已存在

- [ ] **步骤 2：启动开发服务器进行功能测试**

运行：`npm run dev`
预期：✅ 开发服务器启动成功

- [ ] **步骤 3：手动测试场景 A - 首次恢复历史会话**

操作步骤：
1. 打开应用，点击"历史会话"按钮
2. 选择一个已有的历史会话（如 `7258a085-41af-42fb-b3bf-f9205a92e6d8`）
3. 观察控制台日志应显示：`[ChatPanel] History session restored with original ID: 7258a085-...`
4. 在恢复的会话中发送新消息："请继续之前的工作"

预期结果：
- ✅ 不再创建新的 jsonl 文件（如 `b9c3749f-...`）
- ✅ 新消息追加到 `7258a085-....jsonl`
- ✅ LLM 回复中包含对历史上下文的引用（如"关于你提到的'开始实施'..."）

- [ ] **步骤 4：手动测试场景 B - 重复点击同一历史会话**

操作步骤：
1. 恢复某个历史会话后，关闭该 tab
2. 再次打开历史会话列表，点击同一个会话

预期结果：
- ✅ 控制台显示：`[ChatPanel] Reusing existing session: <id>`
- ✅ 直接切换到已有 tab，不创建重复 session
- ✅ 不重复加载消息

- [ ] **步骤 5：手动测试场景 C - 正常新建会话不受影响**

操作步骤：
1. 点击"新建对话"按钮
2. 发送测试消息

预期结果：
- ✅ 创建全新的 UUID（非历史 ID）
- ✅ 使用 `--session-id` 而非 `--resume`
- ✅ 功能与修改前完全一致

- [ ] **步骤 6：最终 Commit（如有额外修复）**

```bash
git add -A
git commit -m "test: verify history session resume mechanism works correctly"
```

---

## 数据流验证清单

完成实施后，请验证以下数据流：

### 场景：用户恢复历史会话并发送消息

```
1. 用户点击历史会话 (ID: 7258a085-...)
   ↓
2. ChatPanel.handleRestoreHistorySession()
   ├── 检查 sessions 列表 → 未找到（首次）
   ├── 调用 getFullSession() 加载历史消息
   └── 调用 createSession(title, projectPath, '7258a085-...') ← 使用原始 ID
       ↓
3. chatStore.createSession()
   ├── session.id = '7258a085-...' （非随机 UUID）
   ├── 添加到 sessions.value
   └── 触发 traceEvent(type: 'session_restored')
       ↓
4. 用户在恢复的会话中输入新消息
   ↓
5. chatStore.sendMessage('7258a085-...', content)
   └── initClaudeCodeSession('7258a085-...')
       ↓
6. ClaudeCodeEngine.startSession('7258a085-...', config)
   └── ProcessPool.startSession('7258a085-...', sessionConfig)
       ↓
7. SessionProcess.buildArgs()
   ├── config.resumeSessionId? → 未设置
   ├── engineSessionId && suspended? → 否
   └── transcriptFileExists(cwd, '7258a085-...')? → ✅ 是！文件已存在
       ↓
   args.push('--resume', '7258a085-...')
       ↓
8. Claude Code CLI 启动
   ├── 读取 ~/.claude/projects/D--AI-SpaceCode/7258a085-....jsonl
   ├── 将所有历史消息注入 LLM 上下文窗口
   └── 新消息追加到同一 jsonl 文件
       ↓
9. ✅ LLM 完整理解历史上下文并正确回复！
```

---

## 回归测试检查点

- [ ] 新建对话功能正常（生成全新 UUID）
- [ ] 多 tab 切换正常
- [ ] 会话持久化/恢复正常（刷新页面后）
- [ ] 引擎切换正常（Claude Code ↔ Pi）
- [ ] 项目切换正常
- [ ] 会话删除正常
- [ ] 无 TypeScript 类型错误
- [ ] 无控制台警告/错误
- [ ] 内存泄漏检查（重复恢复同一会话）

---

## 成功标准

✅ **核心指标：**
- 点击历史会话后，CLI 使用 `--resume <original-session-id>` 启动
- LLM 能正确引用历史上下文（不再出现"我没有找到关于'开始实施'的具体上下文"）
- 不产生多余的 jsonl 文件

✅ **质量指标：**
- 代码变更量 < 100 行
- 无破坏性变更（向后兼容）
- 所有现有功能正常工作

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 历史会话 jsonl 文件被删除 | 低 | 高 | CLI 会报错，提示用户重新开始 |
| Session ID 冲突（极端情况） | 极低 | 中 | crypto.randomUUID() 保证唯一性 |
| 前端 Store 与 JSONL 数据不一致 | 低 | 中 | 新消息同步写入两边（已有逻辑） |
| 大型历史会话加载性能问题 | 中 | 低 | 可后续优化为懒加载（v0.3.7+） |

---

## 后续优化建议（不在本次范围）

1. **懒加载历史消息**：只在用户滚动到顶部时才加载旧消息
2. **虚拟滚动**：对于超长会话（>1000 条消息）优化渲染性能
3. **增量同步**：避免前端 Store 与 JSONL 的双重存储（需重构架构）
4. **会话合并**：支持将多个历史会话合并为一个上下文
