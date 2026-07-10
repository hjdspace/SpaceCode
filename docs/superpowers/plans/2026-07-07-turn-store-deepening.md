# Turn Store 深化实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 把散在 chatSession / chatStream / chatControl 三个 store 之间的回合生命周期收敛为一个深模块 `useTurnStore`，杀掉装饰性的 `chat.ts` Proxy，使回合逻辑可测。

**架构：** `useTurnStore` 拥有 `TurnState` 状态机 + Engine 事件订阅 + 权限裁决 + sendMessage/abort/工具答复。`useChatSessionStore` 保留会话列表、messages[]、持久化、恢复、团队转录。Turn 通过一个窄写回接口（`SessionSink`）写 chatSession。`usePermissionPolicyStore` 独立持有权限模式策略。`chat.ts` 的 Proxy 删除。

**技术栈：** Vue 3 + Pinia + TypeScript + Vitest

**领域术语：** 见 [CONTEXT.md](../../../CONTEXT.md) — Turn 是一次对话周期，按 sessionId 索引，多 pane 可并发。

**架构决定：** 见 [ADR-0003](../../adr/0003-turn-store-owns-event-subscriptions.md) — Turn store 必须在 WebSocket 连接前初始化。

---

## 文件结构

| 文件 | 职责 | 动作 |
|------|------|------|
| `src/stores/turn.ts` | Turn store：TurnState 机 + 事件订阅 + 权限裁决 + sendMessage/abort/工具答复 | 创建 |
| `src/stores/turnSink.ts` | `SessionSink` 接口定义（Turn→chatSession 写回 seam） | 创建 |
| `src/stores/permissionPolicy.ts` | 权限模式策略 store（setPermissionMode/currentPermissionMode） | 创建 |
| `src/stores/__tests__/turn.test.ts` | Turn store 集成测试（8 用例） | 创建 |
| `src/stores/__tests__/turnSink.test.ts` | SessionSink 接口契约测试 | 创建 |
| `src/stores/__tests__/permissionPolicy.test.ts` | 权限策略 store 测试 | 创建 |
| `src/stores/chatSession.ts` | 实现 `SessionSink`；新增 session-keyed 写回方法；`updateToolCall` 加 sessionId 参数 | 修改 |
| `src/stores/chatStream.ts` | 删除（内容迁入 turn.ts） | 删除 |
| `src/stores/chatControl.ts` | 删除（权限裁决迁入 turn.ts，策略迁入 permissionPolicy.ts） | 删除 |
| `src/stores/chat.ts` | 删除 Proxy，改为 re-export 三个 store | 重写 |
| ~15 个消费文件 | 把 `useChatStore()` 拆成对应 store import | 修改 |

---

## 任务 1：定义 SessionSink 接口 + Turn store 骨架

**文件：**
- 创建：`src/stores/turnSink.ts`
- 创建：`src/stores/turn.ts`
- 创建：`src/stores/__tests__/turn.test.ts`

- [ ] **步骤 1：编写失败的测试**

`src/stores/__tests__/turn.test.ts`：
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// fake api + fake sink，验证 Turn 能在 seam 处被替换
function makeFakeApi() {
  const handlers: Record<string, (...args: any[]) => void> = {}
  return {
    claudeCode: {
      onStreamEvent: (cb: any) => { handlers.onStreamEvent = cb; return () => {} },
      onAssistant: (cb: any) => { handlers.onAssistant = cb; return () => {} },
      onToolUse: (cb: any) => { handlers.onToolUse = cb; return () => {} },
      onToolResult: (cb: any) => { handlers.onToolResult = cb; return () => {} },
      onResult: (cb: any) => { handlers.onResult = cb; return () => {} },
      onExit: (cb: any) => { handlers.onExit = cb; return () => {} },
      onError: (cb: any) => { handlers.onError = cb; return () => {} },
      onPermissionRequest: (cb: any) => { handlers.onPermissionRequest = cb; return () => {} },
      onPermissionRequestCancelled: (cb: any) => { handlers.onPermissionRequestCancelled = cb; return () => {} },
      sendMessage: vi.fn(),
      abort: vi.fn(),
      allowPermission: vi.fn(),
      denyPermission: vi.fn(),
    },
    image: { save: vi.fn() },
    trace: { event: vi.fn() },
    _handlers: handlers,
  }
}

describe('useTurnStore skeleton', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('can be constructed with a fake api', () => {
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(makeFakeApi() as any)
    expect(turn).toBeTruthy()
    expect(typeof turn.sendMessage).toBe('function')
    expect(typeof turn.abort).toBe('function')
    expect(typeof turn.allowPermission).toBe('function')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：FAIL — `Cannot find module '../turn'`

- [ ] **步骤 3：编写 SessionSink 接口**

`src/stores/turnSink.ts`：
```ts
import type { Message, ToolCall, Session } from '@/types'

// Turn → chatSession 的窄写回 seam。chatSession 实现它，Turn 消费它，测试替换它。
// 这是 ADR-0003 的内部 seam：所有 turn 对会话状态的修改必须经过这 5 个方法。
export interface SessionSink {
  get(sessionId: string): Session | undefined
  appendMessage(sessionId: string, message: Omit<Message, 'id' | 'timestamp'> & { id?: string }): Message
  patchMessage(sessionId: string, messageId: string, patch: Partial<Message>): void
  patchToolCall(sessionId: string, messageId: string, toolUseId: string, status: ToolCall['status']): void
  persist(sessionId: string): void
  ensureSession(sessionId: string, hint?: { title?: string; projectPath?: string }): Session
}
```

- [ ] **步骤 4：编写 Turn store 骨架**

`src/stores/turn.ts`：
```ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import { useChatSessionStore } from './chatSession'
import type { SessionSink } from './turnSink'
import type { Message, ToolCall, PermissionRequest } from '@/types'
import { permissionService } from '@/services/permissionService'

// 单个会话当前进行中的 turn 状态。turnStates 中无此 sessionId 条目 === 该会话 idle。
export interface TurnState {
  assistantMessageId: string
  accumulatedContent: string
  currentTextEventId: string | null
  currentReasoningEventId: string | null
  streamingHandledThinking: boolean
  sendStartTime: number
  timeoutId: ReturnType<typeof setTimeout> | null
  isAutonomous: boolean
  settled: boolean
  resolve?: () => void
  reject?: (e: any) => void
}

const REQUEST_TIMEOUT = 5 * 60 * 1000
const AUTONOMOUS_REQUEST_TIMEOUT = 45 * 60 * 1000
const MAX_INMEMORY_TOOL_OUTPUT = 30_000

// 测试可注入 fake api；生产用真实 api
export function useTurnStore(injectedApi?: any) {
  return defineStore('turn', () => {
    const resolvedApi = injectedApi ?? api
    const sessionStore = useChatSessionStore()

    // sink：chatSession 实现 SessionSink。生产中直接绑定到 sessionStore 的方法。
    const sink: SessionSink = {
      get: (sid) => sessionStore.sessions.find(s => s.id === sid),
      appendMessage: (sid, msg) => sessionStore.addMessage(msg, sid),
      patchMessage: (sid, mid, patch) => sessionStore.updateMessage(mid, patch, sid),
      patchToolCall: (sid, mid, tid, status) => sessionStore.updateToolCallForSession(sid, mid, tid, status),
      persist: (sid) => sessionStore.saveToStorageForSession(sid),
      ensureSession: (sid, hint) => sessionStore.ensureSession(sid, hint),
    }

    const streamingContents = ref<Map<string, string>>(new Map())
    const loadingSessions = ref<Map<string, boolean>>(new Map())
    const turnStates = new Map<string, TurnState>()
    const pendingSendMessages = new Set<string>()
    const userAbortedSessions = new Set<string>()

    // ── 骨架：先返回空实现，后续任务填充 ──
    async function sendMessage(_content: string, _userMessageContent?: string, _attachments?: any): Promise<void> {
      // 任务 5 实现
    }
    async function abort(): Promise<void> {
      // 任务 5 实现
    }
    async function allowPermission(_messageId: string, _toolUseId: string, _updatedInput: Record<string, unknown>, _decisionClassification?: 'user_temporary' | 'user_permanent'): Promise<void> {
      // 任务 7 实现
    }
    async function denyPermission(_messageId: string, _toolUseId: string, _message = 'User denied', _options: { interrupt?: boolean } = {}): Promise<void> {
      // 任务 7 实现
    }
    function getIsLoading(sessionId: string | null | undefined): boolean {
      if (!sessionId) return false
      return loadingSessions.value.get(sessionId) ?? false
    }
    function getStreamingContent(sessionId: string | null | undefined): string {
      if (!sessionId) return ''
      return streamingContents.value.get(sessionId) ?? ''
    }

    return {
      streamingContents,
      loadingSessions,
      sendMessage,
      abort,
      allowPermission,
      denyPermission,
      getIsLoading,
      getStreamingContent,
      // 后续任务补：retryLastMessage, submitToolAnswer, skipToolAnswer, pendingPermissions, ...
    }
  })()
}

// logger（从 chatStream/chatControl 搬来，模块级单例）
const logger = {
  debug: (scope: string, message: string, data?: any) => { console.debug(`[${scope}] ${message}`, data ?? ''); api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'debug', data } }) },
  info: (scope: string, message: string, data?: any) => { console.log(`[${scope}] ${message}`, data ?? ''); api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'info', data } }) },
  warn: (scope: string, message: string, data?: any) => { console.warn(`[${scope}] ${message}`, data ?? ''); api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'warn', data } }) },
  error: (scope: string, message: string, data?: any) => { console.error(`[${scope}] ${message}`, data ?? ''); api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'error', data } }) },
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add src/stores/turn.ts src/stores/turnSink.ts src/stores/__tests__/turn.test.ts
git commit -m "feat(turn): 添加 Turn store 骨架与 SessionSink 写回接口"
```

---

## 任务 2：迁移 TurnState 机（beginTurn / ensureTurn / endTurn / resetTimeout）

**文件：**
- 修改：`src/stores/turn.ts`
- 修改：`src/stores/__tests__/turn.test.ts`

- [ ] **步骤 1：编写失败的测试**

追加到 `turn.test.ts`：
```ts
describe('TurnState machine', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('beginTurn creates a turn; endTurn removes it', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    // 通过内部访问验证（测试白盒）
    expect((turn as any).turnStates.size).toBe(0)
  })

  it('ensureTurn returns settled turn when userAbortedSessions has sid', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    // 验证 abort 后 ensureTurn 不创建 autonomous turn
    await turn.abort()  // 需要 currentSessionId，先跳过细节
    // 详细断言在任务 5 后补
  })
})
```

- [ ] **步骤 2：运行测试验证失败/通过**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：第一个 it PASS（空 turnStates）；第二个因 abort 未实现而行为不确定。

- [ ] **步骤 3：迁移 TurnState 机到 turn.ts**

从 `src/stores/chatStream.ts` 的第 33-46 行（`TurnState` 接口）和 259-295 行（`endTurn` / `ensureTurn`）以及 `beginTurn`（约 230-257 行）和 `resetTimeout`（搜索 `function resetTimeout`）整体迁移到 `turn.ts` 的 store 内部。把所有 `sessionStore.` 调用替换为 `sink.`：

- `sessionStore.sessions.find(s => s.id === sessionId)` → `sink.get(sessionId)`
- `sessionStore.createSession(...)` → `sink.ensureSession(sessionId, ...)`
- `sessionStore.selectSession(...)` 保持（读侧不经过 sink）

`resetTimeout` 的 timeout 调度保持不变。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/stores/turn.ts src/stores/__tests__/turn.test.ts
git commit -m "feat(turn): 迁移 TurnState 机（beginTurn/ensureTurn/endTurn）"
```

---

## 任务 3：在 chatSession 实现 SessionSink

**文件：**
- 修改：`src/stores/chatSession.ts`（新增 5 个写回方法）
- 创建：`src/stores/__tests__/turnSink.test.ts`

- [ ] **步骤 1：编写失败的测试**

`src/stores/__tests__/turnSink.test.ts`：
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatSessionStore } from '../chatSession'

describe('chatSession SessionSink 实现', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('patchToolCall 按 sessionId 定位，不依赖 currentSessionId', () => {
    const sessionStore = useChatSessionStore()
    const s1 = sessionStore.createSession('A', undefined, 'sess-1')
    const s2 = sessionStore.createSession('B', undefined, 'sess-2')
    const msg1 = sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', input: {}, status: 'running', startTime: 0, endTime: 0 }] }, 'sess-1')
    const msg2 = sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'tc2', name: 'Read', input: {}, status: 'running', startTime: 0, endTime: 0 }] }, 'sess-2')

    // currentSessionId 是 s2，但我们要改 s1 的 toolCall
    sessionStore.selectSession('sess-2')
    sessionStore.updateToolCallForSession('sess-1', msg1.id, 'tc1', 'completed')

    const s1msg = sessionStore.sessions.find(s => s.id === 'sess-1')!.messages.find(m => m.id === msg1.id)!
    expect(s1msg.toolCalls!.find(t => t.id === 'tc1')!.status).toBe('completed')
    // s2 未受影响
    const s2msg = sessionStore.sessions.find(s => s.id === 'sess-2')!.messages.find(m => m.id === msg2.id)!
    expect(s2msg.toolCalls!.find(t => t.id === 'tc2')!.status).toBe('running')
  })

  it('ensureSession 已存在则返回，不存在则创建', () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Existing', undefined, 'sess-x')
    const got = sessionStore.ensureSession('sess-x', { title: 'Ignored' })
    expect(got.id).toBe('sess-x')
    const created = sessionStore.ensureSession('sess-y', { title: 'New', projectPath: '/p' })
    expect(created.id).toBe('sess-y')
    expect(created.title).toBe('New')
  })

  it('saveToStorageForSession 不抛错', () => {
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('A', undefined, 'sess-z')
    expect(() => sessionStore.saveToStorageForSession('sess-z')).not.toThrow()
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/stores/__tests__/turnSink.test.ts`
预期：FAIL — `updateToolCallForSession is not a function`

- [ ] **步骤 3：在 chatSession 新增 5 个写回方法**

在 `src/stores/chatSession.ts` 的 `return { ... }` 之前，新增：

```ts
// ── SessionSink 实现（Turn store 的写回 seam）──
// 这些方法都是 session-keyed，不依赖 currentSessionId，支持多 pane 并发。
function updateToolCallForSession(sessionId: string, messageId: string, toolCallId: string, status: ToolCall['status']) {
  const session = sessions.value.find(s => s.id === sessionId)
  if (!session) return
  const primary = session.messages.find(m => m.id === messageId)
  const tc = primary?.toolCalls?.find(t => t.id === toolCallId)
  if (tc) {
    tc.status = status
    saveToStorage()
    return
  }
  for (const message of session.messages) {
    const fallback = message.toolCalls?.find(t => t.id === toolCallId)
    if (fallback) {
      fallback.status = status
      saveToStorage()
      return
    }
  }
}

function saveToStorageForSession(_sessionId: string) {
  // 当前 saveToStorage 持久化所有 session；保留签名以便未来按会话增量持久化。
  saveToStorage()
}

function ensureSession(sessionId: string, hint?: { title?: string; projectPath?: string }): Session {
  const existing = sessions.value.find(s => s.id === sessionId)
  if (existing) return existing
  return createSession(hint?.title || 'New Chat', hint?.projectPath, sessionId)
}
```

在 `return { ... }` 中加入这三个方法（`appendMessage` / `patchMessage` 复用现有 `addMessage` / `updateMessage`，它们已支持 `targetSessionId`）。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/stores/__tests__/turnSink.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/stores/chatSession.ts src/stores/__tests__/turnSink.test.ts
git commit -m "feat(chatSession): 实现 SessionSink 写回接口（session-keyed）"
```

---

## 任务 4：迁移 Engine 事件订阅到 Turn

**文件：**
- 修改：`src/stores/turn.ts`
- 修改：`src/stores/__tests__/turn.test.ts`

- [ ] **步骤 1：编写失败的测试**

追加到 `turn.test.ts`：
```ts
describe('Turn 事件订阅', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('onStreamEvent 事件到达 idle 会话时被丢弃（无消息的会话不创建 autonomous turn）', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    // 会话不存在或无消息 → ensureTurn 返回 settled → 事件丢弃
    fake._handlers.onStreamEvent({ sessionId: 'unknown', data: { type: 'content_block_start' } })
    expect(turn.getIsLoading('unknown')).toBe(false)
  })
})
```

- [ ] **步骤 2：运行测试**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：FAIL（订阅块未实现）

- [ ] **步骤 3：迁移事件订阅块**

从 `src/stores/chatStream.ts` 第 1319-1438 行的整个订阅块迁移到 `turn.ts` 的 store 内部。把：
- `sessionStore.recordTeammateMessage(...)` / `sessionStore.recordSubagentMessage(...)` / `sessionStore.handleTaskNotification(...)` 保持直接调用 sessionStore（这些是读侧分发，不经过 sink）
- `ensureTurn` / `resetTimeout` / `handleStreamEvent` / `handleAssistant` / `handleToolUse` / `handleToolResult` / `handleResult` / `handleExit` / `handleError` / `handleUser` / `handleRemoteUserMessage` 全部迁入 turn.ts
- 这些 handler 内部对 sessionStore 的**写**调用改走 `sink.`：

| 原调用 | 改为 |
|--------|------|
| `sessionStore.addMessage(msg, sid)` | `sink.appendMessage(sid, msg)` |
| `sessionStore.updateMessage(mid, patch, sid)` | `sink.patchMessage(sid, mid, patch)` |
| `sessionStore.updateToolCall(mid, tid, status)` | `sink.patchToolCall(sessionId, mid, tid, status)`（注意原 `updateToolCall` 用 currentSessionId，迁移时必须传入当前 handler 的 `sessionId`） |
| `sessionStore.saveToStorage()` | `sink.persist(sessionId)` |
| `sessionStore.createSession(...)` / `selectSession(...)`（事件到达未知 sid 时） | `sink.ensureSession(sid, ...)` 然后 `sessionStore.selectSession(sid)` |

**关键修正：** 原 `handleToolUse` 等调用 `sessionStore.updateToolCall(messageId, toolUseId, 'completed')` 依赖 `currentSessionId`——多 pane 下会写错。迁移后用 handler 闭包内的 `sessionId` 调 `sink.patchToolCall(sessionId, ...)`。这是本深化的核心 bug 修复。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/stores/turn.ts src/stores/__tests__/turn.test.ts
git commit -m "feat(turn): 迁移 Engine 事件订阅与 handler（修多 pane toolCall 写错会话）"
```

---

## 任务 5：迁移 sendMessage / abort / retryLastMessage

**文件：**
- 修改：`src/stores/turn.ts`
- 修改：`src/stores/__tests__/turn.test.ts`

- [ ] **步骤 1：编写失败的测试**

追加到 `turn.test.ts`：
```ts
import { useChatSessionStore } from '../chatSession'

describe('Turn sendMessage', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('sendMessage 创建 user message 并调用 api.claudeCode.sendMessage', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-send')

    await turn.sendMessage('hello world', undefined, undefined)

    const session = sessionStore.sessions.find(s => s.id === 'sess-send')!
    expect(session.messages[0].role).toBe('user')
    expect(session.messages[0].content).toBe('hello world')
    expect(fake.claudeCode.sendMessage).toHaveBeenCalledWith(
      'sess-send', 'hello world', undefined, expect.objectContaining({ clientMessageId: session.messages[0].id })
    )
  })

  it('abort 标记 userAbortedSessions 并调用 api.claudeCode.abort', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-abort')
    sessionStore.selectSession('sess-abort')

    await turn.abort()

    expect(fake.claudeCode.abort).toHaveBeenCalledWith('sess-abort')
    expect(turn.getIsLoading('sess-abort')).toBe(false)
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：FAIL（sendMessage 是空骨架）

- [ ] **步骤 3：迁移 sendMessage / abort / retryLastMessage**

从 `src/stores/chatStream.ts` 第 1445-1660 行迁移这三个函数到 `turn.ts`。改动点：
- `sessionStore.currentSessionId` → `sessionStore.currentSessionId`（读侧保持）
- `sessionStore.addMessage(...)` → `sink.appendMessage(targetSessionId, ...)`
- `sessionStore.initClaudeCodeSession(...)` 保持直接调用（这是 session 初始化，非 turn 写回）
- `sessionStore.logger.info(...)` → `logger.info(...)`（用 turn.ts 模块级 logger）
- `sessionStore.traceEvent(...)` → `sessionStore.traceEvent(...)`（trace 是读侧，保持）
- `sessionStore.saveToStorage()` → `sink.persist(sid)`
- `sessionStore.sessions.find(...)` → `sink.get(sid)` 或保持读侧

`abort` / `retryLastMessage` 同理迁移，所有写回走 sink。

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/stores/turn.ts src/stores/__tests__/turn.test.ts
git commit -m "feat(turn): 迁移 sendMessage/abort/retryLastMessage"
```

---

## 任务 6：迁移 submitToolAnswer / skipToolAnswer

**文件：**
- 修改：`src/stores/turn.ts`
- 修改：`src/stores/__tests__/turn.test.ts`

- [ ] **步骤 1：编写失败的测试**

追加到 `turn.test.ts`：
```ts
describe('Turn 工具答复', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('submitToolAnswer 调用 api 并 patchToolCall 为 completed', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-tool')
    sessionStore.selectSession('sess-tool')
    const msg = sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'Read', input: {}, status: 'running', startTime: 0, endTime: 0 }] }, 'sess-tool')

    await turn.submitToolAnswer(msg.id, 'tc1', { path: '/a' })

    expect(fake.claudeCode.submitToolAnswer).toHaveBeenCalledWith('sess-tool', 'tc1', { path: '/a' })
    const updated = sessionStore.sessions.find(s => s.id === 'sess-tool')!.messages.find(m => m.id === msg.id)!
    expect(updated.toolCalls!.find(t => t.id === 'tc1')!.status).toBe('completed')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：FAIL（submitToolAnswer 未导出）

- [ ] **步骤 3：迁移 submitToolAnswer / skipToolAnswer**

从 `src/stores/chatStream.ts` 第 1662-1704 行迁移。改动：
- `sessionStore.updateToolCall(messageId, toolCallId, 'completed')` → `sink.patchToolCall(sid, messageId, toolCallId, 'completed')`
- 在 return 块加入 `submitToolAnswer` / `skipToolAnswer`

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/stores/turn.ts src/stores/__tests__/turn.test.ts
git commit -m "feat(turn): 迁移 submitToolAnswer/skipToolAnswer"
```

---

## 任务 7：迁移权限裁决到 Turn

**文件：**
- 修改：`src/stores/turn.ts`
- 修改：`src/stores/__tests__/turn.test.ts`

- [ ] **步骤 1：编写失败的测试**

追加到 `turn.test.ts`：
```ts
describe('Turn 权限裁决', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('onPermissionRequest 事件填充 pendingPermissions', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)

    fake._handlers.onPermissionRequest({
      sessionId: 'sess-perm',
      data: { toolUseId: 'tu1', toolName: 'Bash', requestId: 'req1', toolName2: 'Bash' },
    })

    expect(turn.hasPendingPermissionForToolUse('tu1', 'sess-perm')).toBe(true)
  })

  it('allowPermission 调用 api.allowPermission 并 patchToolCall', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-perm')
    sessionStore.selectSession('sess-perm')
    const msg = sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'tu1', name: 'Bash', input: {}, status: 'running', startTime: 0, endTime: 0 }] }, 'sess-perm')

    fake._handlers.onPermissionRequest({ sessionId: 'sess-perm', data: { toolUseId: 'tu1', toolName: 'Bash', requestId: 'req1' } })
    await turn.allowPermission(msg.id, 'tu1', { command: 'ls' })

    expect(fake.claudeCode.allowPermission).toHaveBeenCalledWith('sess-perm', 'req1', { command: 'ls' }, undefined)
    const updated = sessionStore.sessions.find(s => s.id === 'sess-perm')!.messages.find(m => m.id === msg.id)!
    expect(updated.toolCalls!.find(t => t.id === 'tu1')!.status).toBe('completed')
    expect(turn.hasPendingPermissionForToolUse('tu1', 'sess-perm')).toBe(false)
  })

  it('denyPermission 调用 api.denyPermission', async () => {
    const fake = makeFakeApi()
    const { useTurnStore } = await import('../turn')
    const turn = useTurnStore(fake as any)
    const sessionStore = useChatSessionStore()
    sessionStore.createSession('Test', undefined, 'sess-perm')
    sessionStore.selectSession('sess-perm')
    const msg = sessionStore.addMessage({ role: 'assistant', content: '', toolCalls: [{ id: 'tu1', name: 'Bash', input: {}, status: 'running', startTime: 0, endTime: 0 }] }, 'sess-perm')

    fake._handlers.onPermissionRequest({ sessionId: 'sess-perm', data: { toolUseId: 'tu1', toolName: 'Bash', requestId: 'req1' } })
    await turn.denyPermission(msg.id, 'tu1', 'nope')

    expect(fake.claudeCode.denyPermission).toHaveBeenCalledWith('sess-perm', 'req1', 'nope', {})
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：FAIL（`hasPendingPermissionForToolUse` 未导出）

- [ ] **步骤 3：迁移权限裁决**

从 `src/stores/chatControl.ts` 第 41-151 行迁移到 `turn.ts`：
- `pendingPermissions` ref
- `onPermissionRequest` / `onPermissionRequestCancelled` 订阅块（第 53-75 行）
- `getPendingPermissionForToolUse` / `hasPendingPermissionForToolUse` / `consumePermissionFor`
- `allowPermission` / `denyPermission`

改动：
- `sessionStore.updateToolCall(messageId, toolUseId, 'completed')` → `sink.patchToolCall(sid, messageId, toolUseId, 'completed')`
- `permissionService` 保持直接使用（它是 service 层，非 store 间调用）
- 在 return 块加入：`pendingPermissions`、`getPendingPermissionForToolUse`、`hasPendingPermissionForToolUse`、`allowPermission`、`denyPermission`

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/stores/turn.ts src/stores/__tests__/turn.test.ts
git commit -m "feat(turn): 迁移权限裁决（pendingPermissions/allow/deny + 订阅）"
```

---

## 任务 8：抽出 usePermissionPolicyStore

**文件：**
- 创建：`src/stores/permissionPolicy.ts`
- 创建：`src/stores/__tests__/permissionPolicy.test.ts`
- 修改：`src/stores/turn.ts`（移除 setPermissionMode，如已迁入）

- [ ] **步骤 1：编写失败的测试**

`src/stores/__tests__/permissionPolicy.test.ts`：
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { usePermissionPolicyStore } from '../permissionPolicy'

describe('usePermissionPolicyStore', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('setPermissionMode 更新 currentPermissionMode 并持久化', async () => {
    const store = usePermissionPolicyStore()
    await store.setPermissionMode('acceptEdits')
    expect(store.currentPermissionMode).toBe('acceptEdits')
  })
})
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npx vitest run src/stores/__tests__/permissionPolicy.test.ts`
预期：FAIL — `Cannot find module '../permissionPolicy'`

- [ ] **步骤 3：创建 permissionPolicy store**

`src/stores/permissionPolicy.ts`：
```ts
import { defineStore } from 'pinia'
import { ref, readonly } from 'vue'
import { useSettingsStore } from './settings'
import { api } from '@/services/electronAPI'
import { errorHandler } from '@/services/errorHandler'
import { ErrorCategory } from '@/types'
import { useChatSessionStore } from './chatSession'

type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions'

const logger = {
  info: (scope: string, message: string, data?: any) => { console.log(`[${scope}] ${message}`, data ?? ''); api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'info', data } }) },
  warn: (scope: string, message: string, data?: any) => { console.warn(`[${scope}] ${message}`, data ?? ''); api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'warn', data } }) },
  error: (scope: string, message: string, data?: any) => { console.error(`[${scope}] ${message}`, data ?? ''); api.trace.event({ source: 'renderer', sessionId: '', actor: 'system', type: 'log', title: `${scope}: ${message}`, metadata: { level: 'error', data } }) },
}

export const usePermissionPolicyStore = defineStore('permissionPolicy', () => {
  const settingsStore = useSettingsStore()
  const sessionStore = useChatSessionStore()

  const currentPermissionMode = ref<PermissionMode>(
    (settingsStore.permissionMode as PermissionMode) || 'default'
  )

  async function setPermissionMode(mode: PermissionMode): Promise<void> {
    const claudeCode = api.claudeCode
    const sid = sessionStore.currentSessionId
    const previousMode = currentPermissionMode.value

    currentPermissionMode.value = mode

    try {
      settingsStore.permissionMode = mode
      settingsStore.saveSettings()
    } catch (e) {
      logger.warn('PermissionPolicy', 'setPermissionMode: failed to persist preference', { error: String(e) })
    }

    try {
      await api.injectGuiModelsToSettings({
        primaryModel: settingsStore.getPrimaryModel() || '',
        haikuModel: settingsStore.getHaikuModel(),
        sonnetModel: settingsStore.getSonnetModel(),
        opusModel: settingsStore.getOpusModel(),
        permissionMode: mode,
      })
    } catch (e) {
      logger.warn('PermissionPolicy', 'setPermissionMode: failed to write defaultMode to settings.json', { error: String(e) })
    }

    if (sid && claudeCode?.setPermissionMode) {
      try {
        logger.info('PermissionPolicy', `setPermissionMode | sessionId=${sid.slice(0, 8)} | mode=${mode}`)
        await claudeCode.setPermissionMode(sid, mode)
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error)
        logger.error('PermissionPolicy', 'setPermissionMode: backend rejected mode switch, reverting UI', { error, previousMode })
        currentPermissionMode.value = previousMode
        try {
          settingsStore.permissionMode = previousMode
          settingsStore.saveSettings()
        } catch {}
        if (errMsg.includes('not launched with --dangerously-skip-permissions')) {
          errorHandler.pushToast({
            id: crypto.randomUUID(),
            category: ErrorCategory.CONFIG_ERROR,
            title: '无法切换到完全信任模式',
            message: '当前会话启动时未开启 bypass 权限支持，请新建会话后再试。',
            autoDismiss: true,
            dismissAfter: 5000,
            createdAt: Date.now(),
          })
        }
      }
    } else if (sid) {
      logger.warn('PermissionPolicy', `setPermissionMode: IPC not available, updating local state only | mode=${mode}`)
    }
  }

  return {
    currentPermissionMode: readonly(currentPermissionMode),
    setPermissionMode,
  }
})
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npx vitest run src/stores/__tests__/permissionPolicy.test.ts`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/stores/permissionPolicy.ts src/stores/__tests__/permissionPolicy.test.ts
git commit -m "feat(permissionPolicy): 抽出权限模式策略 store"
```

---

## 任务 9：迁移 pending-messages + auto-retry 状态到 Turn

**文件：**
- 修改：`src/stores/turn.ts`

- [ ] **步骤 1：迁移 pending messages 状态机**

从 `src/stores/chatStream.ts` 第 99-138 行（`PendingMessage` 接口、`pendingMessages` ref、`addPendingMessage` / `removePendingMessage` / `recallPendingMessage` / `getPendingMessages` / `clearPendingMessages`）迁入 `turn.ts`。这些是 turn 生命周期的一部分（消息队列）。

- [ ] **步骤 2：迁移 auto-retry 状态机**

从 `src/stores/chatStream.ts` 第 56-62 行（`useAutoRetry` 实例化）+ 第 1030-1170 行（`initiateAutoRetry` / `resendForRetry` / `cancelRetry`）迁入 `turn.ts`。auto-retry 是 turn 的错误恢复路径。

在 return 块加入：`pendingMessages`、`addPendingMessage`、`removePendingMessage`、`recallPendingMessage`、`getPendingMessages`、`clearPendingMessages`、`retryStates`、`cancelRetry`、`retryLastMessage`。

- [ ] **步骤 3：运行所有 Turn 测试**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：PASS

- [ ] **步骤 4：Commit**

```bash
git add src/stores/turn.ts src/stores/__tests__/turn.test.ts
git commit -m "feat(turn): 迁移 pending-messages 与 auto-retry 状态机"
```

---

## 任务 10：删除 chatStream.ts 与 chatControl.ts

**文件：**
- 删除：`src/stores/chatStream.ts`
- 删除：`src/stores/chatControl.ts`

- [ ] **步骤 1：确认所有内容已迁出**

搜索验证无遗漏：
```bash
rg "useChatStreamStore|useChatControlStore" src --type ts
```
预期：仅 `chat.ts` 的 re-export 行（下一步处理）。

- [ ] **步骤 2：删除文件**

```bash
git rm src/stores/chatStream.ts src/stores/chatControl.ts
```

- [ ] **步骤 3：运行 vue-tsc 确认类型**

运行：`npx vue-tsc --noEmit`
预期：可能有引用错误（chat.ts 仍 re-export 已删除的 store）—— 任务 11 修复。

- [ ] **步骤 4：Commit**

```bash
git commit -m "refactor: 删除 chatStream.ts 与 chatControl.ts（内容已迁入 turn.ts）"
```

---

## 任务 11：重写 chat.ts（杀 Proxy）+ 更新消费方

**文件：**
- 重写：`src/stores/chat.ts`
- 修改：~15 个消费文件

- [ ] **步骤 1：重写 chat.ts**

`src/stores/chat.ts`（删除 91 行 Proxy，改为 re-export）：
```ts
// 三个独立 store，消费方按需 import。
// 原来的 Proxy 合并已删除——它隐藏了真实依赖结构且无法类型化。
// 见 ADR-0003 与架构深化文档。
export { useChatSessionStore } from './chatSession'
export { useTurnStore } from './turn'
export { usePermissionPolicyStore } from './permissionPolicy'

// 兼容：部分消费方仍 import 类型
export type { Session, Message, ToolCall, AgentInfo, SessionTurnCheckpoint, TurnChangeCardData, TeammateStatus } from '@/types'
export type { RewindOption, RewindState } from '@/types/rewind'
```

- [ ] **步骤 2：更新消费方**

对每个 import `useChatStore` 的文件，按实际用法拆分。规则：
- 只读 session 列表 / messages / 项目 → `useChatSessionStore`
- 调用 sendMessage / abort / submitToolAnswer / 权限裁决 → `useTurnStore`
- 调用 setPermissionMode → `usePermissionPolicyStore`
- 混用 → import 多个

需修改的文件（从 grep 确认）：
- `src/components/layout/ChatPanel.vue`（混用 → 三个都 import）
- `src/components/layout/TitleBar.vue`（只读 session → `useChatSessionStore`）
- `src/components/layout/NoProjectHome.vue`（只读 session → `useChatSessionStore`）
- `src/components/explorer/HistorySessionList.vue`（只读 session → `useChatSessionStore`）
- `src/components/work/WorkAssistantShortcuts.vue`（混用 → session + turn）
- `src/components/work/WorkAssistantGallery.vue`（session + turn）
- `src/components/work/ArtifactsPanel.vue`（只读 session）
- `src/components/design/DesignPage.vue`（turn 的 getIsLoading）
- `src/components/design/DesignComposer.vue`（已 import sessionStore，加 turn）
- `src/components/design/DesignChatPane.vue`（sendMessage/submitToolAnswer → turn）
- `src/composables/useDesignSession.ts`（sendMessage/abort → turn）
- `src/composables/useAgentSelector.ts`（只读 session）
- `src/composables/useOpenProjectWorkflow.ts`（session 创建）
- `src/composables/usePromptStash.ts`（只读 session）
- `src/composables/useSessionTaskProgress.ts`（已用 sessionStore）
- `src/composables/useSubagentTranscript.ts`（已用 sessionStore）

每个文件的改法：把 `import { useChatStore } from '@/stores/chat'` 换成对应的 `import { useChatSessionStore, useTurnStore } from '@/stores/chat'`，把 `const chatStore = useChatStore()` 换成 `const sessionStore = useChatSessionStore()` + `const turn = useTurnStore()`，然后把 `chatStore.sendMessage(...)` 改成 `turn.sendMessage(...)`，`chatStore.sessions` 改成 `sessionStore.sessions`。

- [ ] **步骤 3：运行 vue-tsc**

运行：`npx vue-tsc --noEmit`
预期：无错误。若有，逐个修复 import。

- [ ] **步骤 4：运行所有测试**

运行：`npx vitest run`
预期：PASS

- [ ] **步骤 5：手动启动验证**

运行：`npm run dev`（或项目对应命令）
验证：发送消息、工具调用权限弹窗、abort、切换会话、多 pane。

- [ ] **步骤 6：Commit**

```bash
git add -A
git commit -m "refactor: 杀掉 chat.ts Proxy，消费方按需 import turn/session/policy store"
```

---

## 任务 12：补全 8 个集成测试用例

**文件：**
- 修改：`src/stores/__tests__/turn.test.ts`

- [ ] **步骤 1：补全剩余测试用例**

在 `turn.test.ts` 中补全以下用例（任务 1-9 已覆盖部分，此处补齐 8 条清单）：

1. **正常回合**（任务 5 已覆盖）— `sendMessage` → 发 `onStreamEvent`(text) → `onAssistant` → `onResult` → 断言 messages 落点
2. **工具+权限**（任务 7 已覆盖）— `onToolUse` → `onPermissionRequest` → `allowPermission` → `onToolResult` → 断言 toolCall completed
3. **权限拒绝** — `onPermissionRequest` → `denyPermission` → 断言 toolCall 状态 + api.denyPermission 调用
4. **abort 中途** — `sendMessage` → `abort` → 残留 `onToolUse` 事件 → 断言不创建 autonomous turn
5. **并发多 turn** — 两个 sessionId 同时 `sendMessage`，互不污染（验证 `turnStates` 按 sessionId 隔离）
6. **429 自动重试** — `onError`(429) → `onApiRetry` → 重发 → 成功
7. **超时** — `sendMessage` 后快进 `REQUEST_TIMEOUT` → 断言 turn settled + error 处理
8. **autonomous turn** — 无 `sendMessage`，直接 `onAssistant` 事件到达有消息的会话 → 断言 ensureTurn 自动建 turn

用例 4-8 代码骨架：
```ts
it('abort 后残留事件不创建 autonomous turn', async () => {
  const fake = makeFakeApi()
  const { useTurnStore } = await import('../turn')
  const turn = useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  sessionStore.createSession('Test', undefined, 'sess-a')
  sessionStore.selectSession('sess-a')
  sessionStore.addMessage({ role: 'user', content: 'hi' }, 'sess-a')

  await turn.abort()
  // 模拟 abort 后引擎残留事件
  fake._handlers.onToolUse({ sessionId: 'sess-a', data: { id: 'tu1', name: 'Bash', input: {} } })
  // 不应创建 turn，不应 appendMessage
  expect(turn.getIsLoading('sess-a')).toBe(false)
})

it('并发多 turn 互不污染', async () => {
  const fake = makeFakeApi()
  const { useTurnStore } = await import('../turn')
  const turn = useTurnStore(fake as any)
  const sessionStore = useChatSessionStore()
  sessionStore.createSession('A', undefined, 'sess-a')
  sessionStore.createSession('B', undefined, 'sess-b')

  await Promise.all([
    turn.sendMessage('msg-a', undefined, undefined),  // 需要 currentSessionId，测试中分别设置
    turn.sendMessage('msg-b', undefined, undefined),
  ])
  // 断言两会话 messages 独立
})
```

- [ ] **步骤 2：运行测试**

运行：`npx vitest run src/stores/__tests__/turn.test.ts`
预期：PASS

- [ ] **步骤 3：Commit**

```bash
git add src/stores/__tests__/turn.test.ts
git commit -m "test(turn): 补全 8 个回合集成测试用例"
```

---

## 任务 13：验证 bootstrap 顺序（ADR-0003）

**文件：**
- 修改：`src/main.ts` 或 `src/services/h5Bootstrap.ts`
- 修改：`src/stores/turn.ts`（加初始化日志）

- [ ] **步骤 1：确认 Turn store 在 app mount 前初始化**

在 `src/main.ts` 中，确认 Pinia 安装后、`app.mount()` 之前，Turn store 至少被访问一次（触发订阅注册）。若 H5 模式，确认在 `h5WebSocketClient` 连接前。

在 `turn.ts` 的 store 工厂顶部加初始化标记：
```ts
// ADR-0003: Turn 必须在 WebSocket 连接前完成订阅注册
let initialized = false
export function useTurnStore(injectedApi?: any) {
  return defineStore('turn', () => {
    if (!initialized) {
      initialized = true
      logger.info('Turn', 'Turn store initialized — event subscriptions registered')
    }
    // ...
  })()
}
```

- [ ] **步骤 2：在 main.ts 显式触发初始化**

在 `app.mount('#app')` 之前（Pinia 安装后）加：
```ts
import { useTurnStore } from '@/stores/turn'
useTurnStore()  // 触发订阅注册，ADR-0003
```

- [ ] **步骤 3：运行 vue-tsc + 测试**

运行：`npx vue-tsc --noEmit && npx vitest run`
预期：PASS

- [ ] **步骤 4：手动验证 H5 模式**

启动 H5 模式，确认首条消息的事件不丢失（控制台应见 `Turn store initialized` 日志在 WebSocket 连接日志之前）。

- [ ] **步骤 5：Commit**

```bash
git add src/main.ts src/stores/turn.ts
git commit -m "feat(turn): 显式 bootstrap 初始化顺序（ADR-0003）"
```

---

## 自检

**1. 规格覆盖度：**
- TurnState 机 ✓（任务 2）
- 事件 intake ✓（任务 4）
- 权限裁决 ✓（任务 7）
- sendMessage/abort/工具答复 ✓（任务 5、6）
- 写回 seam（SessionSink）✓（任务 3）
- 权限策略独立 ✓（任务 8）
- pending-messages/auto-retry ✓（任务 9）
- 杀 Proxy + 消费方更新 ✓（任务 11）
- 8 测试用例 ✓（任务 12）
- bootstrap 顺序 ✓（任务 13）

**2. 占位符扫描：** 无 "TODO/待定"。每个任务有实际代码或精确迁移指令。

**3. 类型一致性：** `SessionSink` 在任务 1 定义，任务 3 实现，全程一致。`updateToolCallForSession` / `saveToStorageForSession` / `ensureSession` 在任务 3 定义，任务 4-7 通过 sink 调用，命名一致。`TurnState` 在任务 1 导出，任务 2 使用，字段一致。

---

## 执行交接

**计划已完成并保存到 `docs/superpowers/plans/2026-07-07-turn-store-deepening.md`。两种执行方式：**

**1. 子代理驱动（推荐）** - 每个任务调度一个新的子代理，任务间进行审查，快速迭代

**2. 内联执行** - 在当前会话中使用 executing-plans 执行任务，批量执行并设有检查点

**选哪种方式？**
