# SpaceCode Domain Model

> This is a glossary. It defines the ubiquitous language across SpaceCode features.
> No implementation details. No specs. Just terms and their definitions.

## Session Orchestration (会话编排)

| Term | Definition |
| --- | --- |
| **Orchestration Graph (编排图)** | A user-authored DAG of Task Nodes connected by Edges, run as a one-shot pipeline. _Avoid_: canvas workflow, pipeline plan. |
| **Task Node (任务节点)** | A canvas card that executes exactly one prompt against a fresh, context-isolated chat session per run. Reuses the ordinary session system (appears in the sidebar). _Avoid_: agent node, job. |
| **Edge (依赖连线)** | A trigger-only dependency: the target node starts after the source node's turn settles. No data flows across an Edge. |
| **Draft (节点草稿)** | The prompt text a user types into a node's chat window before the graph runs. Sent as the node's first message only on Run. |
| **Run (运行)** | One execution of an entire graph. Each Run creates fresh sessions for every node; results are viewable by expanding the node. |
| **Node Status** | A Task Node's lifecycle state within a Run: `pending` → `running` → `settled`, or `failed` / `skipped`. A node is `settled` when its turn ends normally — regardless of whether the LLM's output reads as success. |
| **Failure Propagation (失败传播)** | On node failure, downstream nodes become `skipped`; unrelated parallel branches keep running. Retry re-runs the failed node and auto-resumes its skipped descendants. |
| **Concurrency Gate (并发闸门)** | The orchestration layer's own cap on simultaneously `running` nodes; ready-but-over-cap nodes queue. Independent from the engine process pool's eviction. |
| **Drawer (节点抽屉)** | The in-canvas expanded view of a Task Node showing the full chat session with streaming output. _Avoid_: modal, popup window. |

## Skill Manager

## Core Terms

| Term | Definition |
| --- | --- |
| **Center Library (中心库)** | SpaceCode's unified local Skill repository at `~/.spacecode/skills`. The single source of truth for all managed Skills. |
| **Center Skill (中心库 Skill)** | A Skill directory that has been imported into the Center Library and has a database record. Its directory name is the default Skill ID. |
| **Agent Skill (Agent Skill)** | A Skill that lives in an Agent's own directory. May be managed (has a Target record) or unmanaged (orphan file). |
| **Target** | A single Skill's installation record in a single Agent's directory. Records the actual install mode (link or copy), hash, and status. |
| **Claim** | The reason a Target exists. Either `direct` (user installed it individually) or `pack` (installed via a Skill Pack). One Target can have multiple Claims. |
| **Skill Pack (技能包)** | A named group of Center Skill IDs. Not bound to any Agent. Can be applied to and revoked from multiple Agents. |
| **link** | A symlink in the Agent directory pointing to the Center Library Skill. Center Library updates propagate automatically. |
| **copy** | A recursive file copy of the Center Library Skill into the Agent directory. Requires explicit sync afterward. |
| **Unmanaged (未管理)** | A Skill file exists in an Agent directory or the Center Library, but the database has no trusted record for it. |
| **Copy Divergence (copy 分叉)** | Both the Center Library Skill and the Agent's copy have changed. Cannot be auto-resolved. |

## Agent Registry

| Term | Definition |
| --- | --- |
| **Agent** | A coding assistant tool that has its own Skills directory. SpaceCode manages Skill distribution to Agents. |
| **Agent Registry** | The built-in list of known Agents (Claude Code, Codex, Cursor, Trae) and their Skill directory paths. Extensible with custom entries. |

## Operations

| Term | Definition |
| --- | --- |
| **Distribute (分发)** | Install a Center Skill into one or more Agent directories via link or copy. |
| **Adopt (接管)** | Import an unmanaged Agent Skill into the Center Library, optionally replacing the Agent's copy with a symlink. |
| **Revoke (撤销)** | Remove a Skill Pack's Claims from an Agent. Only deletes files when no Claims remain. |
| **Diagnose (诊断)** | Scan the Center Library and all Agent directories for issues: unmanaged, broken links, outdated copies, conflicts. |
| **Snapshot (快照)** | A JSON export of the entire Skill Manager state. Used for backup, debugging, and SQLite recovery. |
