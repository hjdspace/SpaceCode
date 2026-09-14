# Session orchestration graph: one-shot pipeline of context-isolated chat sessions

SpaceCode adds a canvas-based session orchestration feature. Multi-node parallel fan-out
requires more concurrent engine sessions than the old process-pool cap of 3 could hold;
suspension-based eviction would interrupt streaming output and make dependency-trigger
ordering non-deterministic. We decided to raise the engine process pool's
MAX_PROCESSES from 3 to 20 (both Claude Code and Pi pools) AND have the orchestration
layer own its own concurrency gate (default 20, aligned with the pool) that queues
ready-but-over-cap nodes until a slot frees.

Rationale for 20 over the old 3: orchestration graphs routinely fan out more than three
parallel branches, and the eviction machinery (suspend + resume) interacts badly with
DAG dependency triggers. The gate stays as a second line of defense — the orchestration
layer must never depend on the pool's eviction to schedule correctly.

## Decision points (from the grilling session 2026-09-14)

- **One-shot pipeline**: each Run creates fresh sessions per node; re-running the graph
  creates new sessions. Nodes are not persistent chat workspaces.
- **Trigger-only edges**: no data flows between nodes. The user authors each node's
  prompt independently. Placeholder-based output passing was deferred.
- **Node settles when its turn settles**: a node is "done" when the engine reports the
  turn ended (onResult), regardless of output content. No output-based success/failure
  detection.
- **Failure semantics**: failed node → downstream nodes skipped; parallel branches keep
  running. Retry re-runs the failed node with a fresh session and auto-resumes skipped
  descendants.
- **Manual Run button**: a graph starts only when the user clicks Run. All zero-in-degree
  nodes start simultaneously (parallel). No auto-ignition on first message.
- **Permission follows global policy**: nodes run under whatever permission mode the
  user's global setting dictates. For unattended runs the user opts into bypass globally.
- **Reuse the session system**: orchestration node sessions are ordinary chat sessions in
  the existing chatSession store (sidebar-listed, persisted, resumable). The graph
  structure itself persists in localStorage alongside them.
- **Graph locked while running**: nodes/edges cannot be added or removed during a Run.
  Running nodes may receive follow-up messages (queued via the existing pending-message
  queue) and may be stopped (stop = failure semantics).
- **Vue Flow** for the canvas; the orchestration opens as a closable center tab
  (same pattern as terminal tabs), not a fullscreen overlay.
- **Node = embedded ChatPanel**: the shrunk node card renders the real ChatPanel (CSS
  scaled); expand opens an in-canvas Drawer, not a separate window or tab.
