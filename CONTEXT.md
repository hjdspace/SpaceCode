# SpaceCode

A desktop AI coding assistant built with Electron + Vue 3, with mobile browser access capability.

## Language

**H5 Access**:
The feature that allows a phone browser to access the SpaceCode frontend over the local network, by scanning a QR code containing an HTTP URL with an access token.
_Avoid_: Mobile web, remote access, web client

**H5 Server**:
An HTTP + WebSocket server embedded in the Electron main process that serves the Vue frontend as static files and proxies API/WebSocket requests to the Claude Code engine.
_Avoid_: Sidecar, mobile server

**H5 Adapter**:
A drop-in replacement for `window.electronAPI.claudeCode` that routes IPC-style calls over HTTP REST and WebSocket when the frontend runs in a browser (H5 mode) instead of Electron.
_Avoid_: API shim, transport layer

**Mirror Session**:
The connection mode where the H5 client follows the desktop's currently active chat session, sharing the same `sessionId` and `projectPath`. The phone is an extension of the desktop, not an independent client.
_Avoid_: Shared session, linked session

**Engine**:
The Claude Code CLI subprocess (or alternative engine like Pi) managed by `EngineFactory` / `ClaudeCodeProcessPool` that processes chat messages and emits streaming events.
_Avoid_: CLI, backend

**Engine Gateway**:
The deep module that owns engine lookup (`findEngineForSession`), dispatch, capability checks, structured call logging, and error wrapping for all engine operations. Both IPC handlers (`claudeCodeIPC.ts`) and H5 Server routes delegate to it instead of calling `IEngine` directly. It is the calling-side counterpart to the Engine concept — the seam where transport (IPC or HTTP/WS) ends and engine operations begin.
_Avoid_: engineService (conflicts with legacy `h5EngineService` name), engineManager, dispatcher (too narrow — Gateway also owns logging and errors, not just dispatch)

**Turn**:
One conversational cycle keyed by `sessionId`: a user message is sent, the Engine streams an assistant response (text, thinking, tool calls, tool results, permission requests), and the cycle settles on completion, abort, or error. Multiple turns can be live concurrently across panes, each keyed by its session.
_Avoid_: Round, exchange, message cycle, request/response
