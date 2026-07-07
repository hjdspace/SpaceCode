# H5 mode uses API-layer adaptation, not store-level changes

## Context

The frontend's chat logic lives directly in Pinia stores (`chatSession.ts`, `chatStream.ts`, `chatControl.ts`), which call `api.claudeCode.*` methods (IPC wrappers) extensively — over 30 call sites across stores and components. The original plan proposed modifying a `useChat.ts` composable to switch between IPC and HTTP/WebSocket, but that composable does not exist; the stores call `api.claudeCode` directly.

## Decision

Environment detection and adapter injection happen at the `electronAPI.ts` module level. When the app loads in a browser (detected by absence of `window.electronAPI` and presence of a `token` URL parameter), a `createH5Adapter()` function returns an object implementing the same `claudeCode` interface, backed by HTTP REST and WebSocket. This adapter is assigned to `electronAPI` before any Pinia store initializes, so stores and components call the adapter transparently without code changes.

## Rationale

- Changing 30+ call sites across stores and components is error-prone and invasive.
- The `api.claudeCode` getter (`get claudeCode() { return electronAPI?.claudeCode ?? null }`) is the single choke point — swapping it once adapts everything.
- Stores initialize eagerly when Pinia mounts; the adapter must be ready before that, which means module-level detection in `electronAPI.ts`.

## Consequences

- The H5 adapter must implement the full surface area of `claudeCode` methods used by stores (~15 core methods + ~10 event listeners). Non-core methods return degraded defaults.
- Event listeners (`onStreamEvent`, `onAssistant`, etc.) must be registered before WebSocket connects — they are queued and flushed on connection.
- The `electronAPI.ts` module gains H5-mode awareness, slightly increasing its responsibility beyond a pure IPC wrapper.
