# Turn store split into focused deep modules

## Context

`src/stores/turn.ts` (originally `chatStream.ts`) was a 1837-line god object owning turn lifecycle, event handling, timeline assembly, auto-retry, permission routing, and tool-answer IPC. The file mixed unrelated concerns: a `turnStates` Map, 9 event handler closures (~817 lines), 6 timeline assembly helpers, timeout management, and store-level actions (`sendMessage`, `abort`, `retryLastMessage`).

An architecture review (`improve-codebase-architecture` skill) identified this as the #2 deepening candidate: the store had too much surface area behind a single file, making it hard to test individual concerns and reason about event flow.

## Decision

Split `turn.ts` into a directory `src/stores/turn/` with 4 focused deep modules + an orchestration entry point:

| Module | Lines | Responsibility | Interface |
|--------|-------|---------------|-----------|
| `types.ts` | ~45 | Shared types, constants, `createSettledTurn()` | Pure data, no behavior |
| `timelineAssembler.ts` | ~83 | 6 timeline assembly functions on assistant messages | `createTimelineAssembler(sink): TimelineAssembler` |
| `turnStateMachine.ts` | ~140 | `turnStates` Map + `beginTurn`/`ensureTurn`/`endTurn`/`resetTimeout` | `createTurnStateMachine(opts): TurnStateMachine` |
| `eventHandlers.ts` | ~871 | 9 event handlers (`handleAssistant`, `handleToolResult`, `handleResult`, etc.) + `remoteUserContent` helper | `createEventHandlers(opts): EventReducer` |
| `index.ts` | ~888 | Orchestration: store factory, `sendMessage`/`abort`/`retryLastMessage`, permission routing, event subscription, auto-retry | `useTurnStore()` Pinia store |

### Key design patterns

1. **Factory with dependency injection**: Each module is a factory function (`createX(opts): X`) that accepts narrowed dependencies. This replaces closures-over-store-state with explicit parameter passing, making each module independently testable.

2. **Forward reference for circular dependency**: `TurnStateMachine.onTimeout` needs `handleResult`/`handleError` from `EventReducer`, while `EventReducer` needs `TurnStateMachine` for `turnStates`/`beginTurn`/`endTurn`. Solved with `let handlers: EventReducer | undefined` — state machine is created first with `onTimeout` referencing `handlers?.handleResult(...)`, then handlers are created and assigned. Runtime-safe because `onTimeout` only fires via `setTimeout`, which never triggers during synchronous initialization.

3. **Interface segregation**: `EventReducerOptions` narrows each dependency to its actual usage:
   - `logger: Logger` (4 methods) instead of the full `chatSession` store
   - `traceEvent: TraceEventFn` (one function) instead of the store
   - `updateTaskStateFromToolResult`, `loadTurnCheckpoints`, `selectSession` as individual functions
   - `getModel/getProvider/getBaseUrl` as zero-arg getters
   - `getClaudeCode/getArtifactsApi` as lazy getters (avoid capturing stale references)

4. **SessionSink seam** (ADR-0003): All four modules write to `chatSession` exclusively through the 6-method `SessionSink` interface, preserving the existing narrow write seam.

## Rationale

- **Testability**: Each module can be unit-tested in isolation with a fake `sink` and stub dependencies, without constructing the full Pinia store.
- **Cognitive load**: A reader can understand the event flow by reading `eventHandlers.ts` alone (871 lines) instead of navigating a 1837-line file mixing concerns.
- **Deep module property**: Each factory has a small interface (5-20 options) with substantial behavior behind it — the hallmark of a deep module.
- **No behavior change**: The extraction is purely structural. All 26 existing tests pass without modification, confirming behavioral equivalence.

## Consequences

- The `turn/` directory now contains 5 files. Importers use `@/stores/turn` (the `index.ts` barrel) — no external consumer needs to know about the internal split.
- Re-exports in `index.ts` preserve the public API: `TurnState`, `REQUEST_TIMEOUT`, `AUTONOMOUS_REQUEST_TIMEOUT`, `MAX_INMEMORY_TOOL_OUTPUT`.
- Adding a new engine event type (e.g. `onTokenCount`) requires adding a handler to `eventHandlers.ts` and wiring it in `index.ts`'s subscription section — two focused files instead of one 1837-line file.
- The `let handlers` forward reference is a deliberate pattern, documented with a comment explaining why it is runtime-safe. Future maintainers should not "fix" it by reordering declarations — the state machine must be created before the event handlers.
