# Turn store owns Engine event subscriptions and must initialize before WebSocket connects

## Context

An architecture review is deepening the chat pipeline: the `Turn` store (consolidating `chatStream` + the permission half of `chatControl`) will own the Engine event subscriptions — `onAssistant`, `onToolUse`, `onToolResult`, `onStreamEvent`, `onPermissionRequest`, `onPermissionRequestCancelled`. These were previously registered at module load inside the two separate stores. ADR-0002 already established that H5-mode listeners must register before the H5 WebSocket connects; moving the subscriptions into `Turn` moves the owner of that invariant.

## Decision

The `Turn` store initializes at app bootstrap, before `h5WebSocketClient` connects and before any user action can trigger a turn. The ordering invariant is part of `Turn`'s interface contract, documented at the store definition — not just relied upon at the call site.

## Rationale

- If `Turn` lazy-initializes (e.g. via code-splitting) or initializes after the WebSocket connects, early Engine events are silently lost — a turn's first `stream_event` / `onAssistant` arrives with no listener registered.
- The invariant was previously implicit in Pinia's module-load order; promoting it to `Turn`'s contract prevents a future reviewer from lazy-loading the store and silently regressing H5 mode and first-event races.
- Tests that drive a turn must construct `Turn` with a fake `api.claudeCode` before emitting events — which is exactly the shape that makes the turn lifecycle testable through its interface.

## Consequences

- `Turn` cannot be lazily loaded or code-split.
- The bootstrap sequence becomes explicit and documented: app init → `Turn` store init → H5 WebSocket connect → Vue app mount.
- `Turn`'s interface is the test surface: a fake `api.claudeCode` adapter at the seam lets tests drive a full turn (send → stream → tool_use → permission → tool_result → settle) without 30+ method mocks.
