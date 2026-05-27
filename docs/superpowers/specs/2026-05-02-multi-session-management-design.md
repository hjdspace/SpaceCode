# Multi-Session Management Design

Date: 2026-05-02

## Overview

Implement multi-session management for the desktop application, allowing users to run multiple Claude Code CLI sessions concurrently. Background sessions continue executing while the user interacts with a different session. Sessions are displayed as browser-like tabs, and closing a tab does not terminate the session.

## Requirements

1. Support up to 3 concurrent CLI processes
2. Browser-like session tabs with switch/close functionality
3. Background sessions continue running when tab is not active
4. Closing a tab does not end the session
5. Session resume via Engine CLI `--resume` parameter
6. Lazy-load session recovery after app restart
7. Real-time state persistence to prevent data loss
8. Smooth tab switching without noticeable lag

## Architecture: Process Pool + Event Routing (Scheme A)

### Layer 1: Main Process

#### 1.1 SessionProcess Class (New File)

Encapsulates a single CLI process lifecycle. Replaces the single-process logic in the current `ClaudeCodeProcessManager`.

```
SessionProcess {
  sessionId: string              // GUI-side session ID
  engineSessionId: string | null // Engine CLI session ID (for --resume)
  process: ChildProcess | null
  config: SessionConfig
  status: 'starting' | 'active' | 'idle' | 'suspended' | 'exited'
  eventBuffer: SDKMessage[]      // Buffer events during background, replay on switch-back
  lastActivityAt: number         // For LRU eviction

  start(): Promise<void>         // Start CLI process
  resume(): Promise<void>        // Resume via --resume <engineSessionId>
  sendMessage(content): void     // Send user message to CLI stdin
  abort(): void                  // Send interrupt control_request
  suspend(): void                // Graceful stop (kill process, preserve engineSessionId)
  kill(): void                   // Force terminate
}
```

Key behaviors:
- `suspend()`: kills the process but preserves `engineSessionId`, sets status to `suspended`. Flushes buffered events to renderer before suspending.
- `resume()`: restarts CLI with `--resume <engineSessionId>` to restore conversation history.
- `status` transitions from `active` to `idle` automatically when a `result` event is received (conversation turn complete).

#### 1.2 ClaudeCodeProcessPool Class (Refactor ProcessManager)

```
ClaudeCodeProcessPool {
  processes: Map<string, SessionProcess>  // key = sessionId
  maxProcesses: 3
  mainWindow: BrowserWindow

  startSession(sessionId, config): Promise<void>
  resumeSession(sessionId): Promise<void>
  suspendSession(sessionId): void
  sendMessage(sessionId, content): void
  abortSession(sessionId): void
  killSession(sessionId): void
  getSessionStatus(sessionId): ProcessStatus
  getActiveSessions(): Array<{ sessionId, status, engineSessionId }>

  // Internal
  private evictIfNeeded(): SessionProcess | null  // LRU eviction
  private routeEvent(sessionId, event): void      // Route events with sessionId
}
```

Eviction strategy:
- When starting a new session and at capacity (3), auto-suspend the oldest `idle` process.
- If no idle processes exist, suspend the oldest `active` process that is not in the foreground tab.
- Suspended sessions auto-resume via `--resume` when the user switches back to their tab.

#### 1.3 IPC Interface Extensions (Refactor claudeCodeIPC.ts)

Existing interfaces modified to accept `sessionId`:

| IPC Interface | Change |
|--------------|--------|
| `claude-code:startSession` | Add `sessionId` parameter (GUI-side ID) |
| `claude-code:sendMessage` | Add `sessionId` parameter |
| `claude-code:abort` | Add `sessionId` parameter |
| `claude-code:stop` | Add `sessionId` parameter |
| `claude-code:suspendSession` | **New** — suspend specified session |
| `claude-code:resumeSession` | **New** — resume specified session |
| `claude-code:getSessionStatus` | **New** — query session process status |
| `claude-code:getActiveSessions` | **New** — get all active session list |

Event forwarding modified — all events carry `sessionId`:
- `claude-code:assistant` → `{ sessionId, data }`
- `claude-code:tool_use` → `{ sessionId, data }`
- `claude-code:tool_result` → `{ sessionId, data }`
- `claude-code:stream_event` → `{ sessionId, data }`
- `claude-code:result` → `{ sessionId, data }`
- `claude-code:exit` → `{ sessionId, code }`

### Layer 2: Renderer Process

#### 2.1 Session Type Extension

```typescript
export interface Session {
  id: string                          // GUI-side unique ID
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  workingDirectory?: string

  // New multi-session fields
  engineSessionId?: string            // Engine CLI session ID (for --resume)
  processStatus: 'none' | 'starting' | 'active' | 'idle' | 'suspended' | 'exited'
  isTabOpen: boolean                  // Whether a tab is open for this session
  lastActivityAt: number              // Last activity timestamp (for LRU)
}
```

#### 2.2 chat.ts Store Refactor

Core change: from "single active session" to "multi-session parallel".

Key modifications:
1. **Remove singleton logic in `initClaudeCodeSession()`** — no longer check `isSessionActive()` to decide reuse.
2. **`sendMessage()` refactor** — carry `sessionId`, pass to `claude-code:sendMessage` with sessionId.
3. **New `activateSession(sessionId)`** — switch to specified session:
   - If process status is `suspended`, call `claude-code:resumeSession`
   - If process status is `none` (new or post-restart), call `claude-code:startSession`
   - Set `currentSessionId = sessionId`
4. **New `deactivateSession(sessionId)`** — leave specified session (when closing tab):
   - Do NOT kill process, only mark `isTabOpen = false`
   - Process continues running in background
5. **Event listener refactor** — all IPC event callbacks dispatch to the corresponding session's messages by `sessionId`.
6. **Streaming content per-session isolation** — `streamingContent` changes from `ref<string>` to `Map<string, string>`.

#### 2.3 app.ts Store — Tab Management Refactor

Change `centerTabs` from a single fixed `'chat'` tab to dynamic session tabs:

```typescript
// Before
centerTabs = [{ id: 'chat', label: 'Chat', icon: MessageSquare, closable: false }]

// After
centerTabs = [
  { id: 'session-<uuid>', label: 'Session Title', icon: MessageSquare, closable: true, sessionId: '<uuid>' },
  // ... terminal tabs unchanged
]
```

New methods:
- `openSessionTab(sessionId, title)` — open a session tab
- `closeSessionTab(tabId)` — close tab (does not end session)
- `switchToSessionTab(sessionId)` — switch to the tab for a given session

#### 2.4 Session Metadata Persistence

Reuse Engine's `~/.claude/sessions/` storage. GUI side only persists lightweight metadata:

```typescript
interface SessionMetadata {
  id: string                  // GUI-side ID
  engineSessionId?: string    // Engine session ID
  title: string
  workingDirectory?: string
  createdAt: number
  updatedAt: number
  lastProcessStatus: ProcessStatus  // Last status before shutdown
  isTabOpen: boolean
}
```

Recovery logic after restart:
1. Load `SessionMetadata[]` from localStorage.
2. Display all sessions in the left sidebar list.
3. When user clicks a session, if `engineSessionId` exists, call `--resume` to restore.
4. Do NOT auto-start any CLI processes.

### Layer 3: UI Components

#### 3.1 Session Tab Bar

Add a tab bar above the chat content area (browser/VS Code editor tab style):

```
+-------------------------------------------------+
| [Tab: Session1 x] [Tab: Session2 x] [+]         |
+-------------------------------------------------+
| Chat Header (current session)                    |
| MessageList (current session)                    |
| ChatInput (current session)                      |
+-------------------------------------------------+
```

Tab bar behaviors:
- Click tab to switch session
- Click x to close tab (session continues in background)
- Click + to create new session
- Tab shows session status indicator (spinning circle for active, green dot for idle, yellow dot for suspended)
- Tab shows streaming response animation (spinning loader)

#### 3.2 Left Sidebar Session List Enhancement

Enhance existing `SessionList.vue` with:

**New status indicators**:
- Spinning circle animation: process `active` (generating response)
- Green dot: process `idle` (conversation turn complete, awaiting input)
- Yellow dot: process `suspended` (paused, needs resume)
- Gray dot: process `none` (not started or exited)

**Interaction enhancements**:
- Click session → if tab is open, switch to that tab; if tab is not open, open new tab and activate
- Right-click menu adds "Suspend Session" option (manual suspend)
- Right-click menu adds "Resume Session" option (for suspended sessions)

#### 3.3 Session State Toast Notifications

Show lightweight notifications when background session state changes:
- "Session X completed response" — background session received `result` event
- "Session X suspended (concurrency limit reached)" — evicted by LRU
- "Session X process exited unexpectedly" — background process crash

#### 3.4 ChatPanel Refactor

`ChatPanel.vue` dynamically renders the current tab's session content:
- `currentMessages` from `chatStore.currentMessages` (already computed by `currentSessionId`)
- `ChatInput` sends messages with current `sessionId`
- No need to reload messages on tab switch (already in store)

### Layer 4: Error Handling

#### 4.1 Process Error Handling

| Scenario | Strategy |
|----------|----------|
| CLI process crash (non-zero exit) | Mark `processStatus = 'exited'`, show error notification, preserve message history, offer "Restart" button |
| CLI process OOM killed by OS | Same as above, plus log recording |
| `--resume` fails (session file missing) | Notify user session data is lost, create new session as replacement |
| Network interruption causing API call failure | Engine retries internally; if ultimately fails, sends `result` with `isError`, handled normally |

#### 4.2 Concurrency Control Boundaries

| Scenario | Strategy |
|----------|----------|
| 3 active processes, user starts 4th | Auto-suspend oldest idle process; if no idle, suspend oldest active non-foreground process |
| User rapidly switches tabs | Debounce 300ms to avoid frequent resume/suspend |
| All tabs closed but background processes active | Processes continue running, sidebar shows status |
| Window closed with active processes | Show confirmation dialog: "N sessions are running. Confirm exit?" |

#### 4.3 Data Consistency

| Scenario | Strategy |
|----------|----------|
| Engine session file deleted externally | Catch `--resume` error, mark session as `orphaned`, notify user |
| GUI sessionId to engineSessionId mapping lost | Recover mapping from localStorage metadata |
| Messages not fully received before suspend | Wait for current `result` event before `suspend()` (5s timeout max); buffer incomplete events to `eventBuffer` |

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `electron/claudeCodeProcessManager.ts` | Major refactor | Replace single-process model with `SessionProcess` + `ClaudeCodeProcessPool` |
| `electron/claudeCodeIPC.ts` | Major refactor | Add sessionId to all IPC calls/events, add new endpoints |
| `electron/preload.ts` | Modify | Update `claudeCode.*` API signatures to include sessionId |
| `src/types/index.ts` | Modify | Extend Session type with multi-session fields |
| `src/stores/chat.ts` | Major refactor | Multi-session parallel model, per-session event routing |
| `src/stores/app.ts` | Modify | Dynamic session tab management |
| `src/components/layout/ChatPanel.vue` | Modify | Add tab bar, dynamic session rendering |
| `src/components/explorer/SessionList.vue` | Modify | Add process status indicators |
| `src/components/explorer/SessionListItem.vue` | Modify | Add spinning/green/yellow/gray status dots |
| `src/components/chat/SessionTabBar.vue` | New | Session tab bar component |
