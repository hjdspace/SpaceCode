# H5 Server calls engine directly, not via renderer process relay

## Context

The H5 Server needs to send chat messages, abort requests, and permission responses to the Claude Code engine, and receive streaming events back. The original plan (from `h5-webui-access-plan.md`) proposed relaying H5 client messages through the renderer process: H5 message → H5Server → `mainWindow.webContents.send('h5:relay')` → renderer → `api.claudeCode.sendMessage()` → IPC → engine. Event forwarding used `ipcMain.on('claude-code:stream_event')`, which listens for renderer→main messages — the wrong direction, since engine events flow main→renderer via `mainWindow.webContents.send()`.

## Decision

The H5 Server calls the engine API directly via `EngineFactory` / `ClaudeCodeProcessPool`, bypassing the renderer process entirely. For event forwarding, a callback hook is added to `ClaudeCodeProcessPool.routeEvent()` so the H5 Server can register as a listener and broadcast events to connected WebSocket clients.

## Rationale

- The renderer process relay adds a round-trip with no benefit — the engine API is already accessible from the main process.
- If the renderer window is minimized, unloaded, or the renderer is busy, H5 functionality would break under the relay approach.
- The original plan's `ipcMain.on()` event forwarding was architecturally incorrect (wrong IPC direction).
- Direct engine access reuses the same code paths as the existing `claudeCodeIPC.ts` handlers.

## Consequences

- Engine call logic currently embedded in `ipcMain.handle()` callbacks in `claudeCodeIPC.ts` needs to be extracted into reusable functions that both IPC handlers and H5 Server can call.
- `ClaudeCodeProcessPool.routeEvent()` gains an event listener hook, slightly increasing coupling between the process pool and H5 Server.
