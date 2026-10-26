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
| **Structure Lock (结构锁)** | While a Run is in progress the graph's structure is frozen: no Task Node or Edge may be added or removed, and Drafts of not-yet-started nodes stay editable. Layout is *not* part of the lock — a Task Node can be dragged and re-arranged at any time. |
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
| **Agent Registry** | The built-in list of known Agents (Claude Code, Pi, Codex, Cursor, Trae) and their Skill directory paths. Extensible with custom entries. |
| **Chat Agent (会话智能体)** | A persona a chat session runs as, defined by one `*.md` file under `.claude/agents` or pi's agent directories and chosen in the chat input. Not an **Agent** above (a tool SpaceCode distributes Skills to), and not the engine's `Agent` tool (which *delegates* to a fresh child session). _Avoid_: sub-agent, smart agent. |

## Voice Input (语音输入)

| Term | Definition |
| --- | --- |
| **Voice Input (语音输入)** | Converting speech captured by the local microphone into text placed in the active chat composer. Never sends the message by itself. _Avoid_: voice message, audio message, speech command. |
| **Recording Session (录音会话)** | One bounded recording episode from start to stop, cancel, or failure. Bound to exactly one chat composer and its chat session; leaving that session ends it. |
| **Live Transcript (实时转写)** | The provisional, continuously revised text shown while a Recording Session is active. Not part of the composer's durable content. |
| **Final Transcript (终稿)** | The text a Recording Session commits to the composer when it stops. The only transcript that becomes composer content. |
| **Speech Model (识别模型)** | The pinned, locally stored ASR model bundle Voice Input depends on. Downloaded on first use and integrity-checked before use. |

## Generative UI (生成式 UI)

| Term | Definition |
| --- | --- |
| **GenUI Card (生成式 UI 卡片)** | A live, interactive block the assistant produces, rendered in the conversation at the position of the message that produced it. Its state belongs to the card, not to the message. _Avoid_: widget, component, preview. |
| **Card Schema (卡片 Schema)** | The declarative document a GenUI Card is rendered from. The only artifact the assistant is asked to produce for a card. _Avoid_: config, template, page. |
| **Card Sandbox (卡片沙箱)** | The isolated execution environment a GenUI Card runs in. It has no network access and no handle on the app, its data, or other cards. |
| **Card Action (卡片动作)** | An operation a GenUI Card may ask SpaceCode to perform on the user's behalf: submit, copy, expand, open link. The app decides whether and how; the card never acts directly. |
| **Card Submission (卡片提交)** | The user completing a GenUI Card and submitting its payload. Produces a chat message carrying a human-readable summary plus the full payload for the model. |
| **GenUI Skill (生成式 UI 技能)** | The Skill that teaches an Agent the Card Schema protocol and output contract. Its presence is what enables card generation; it is distributed like any other Center Skill. |

## Operations

| Term | Definition |
| --- | --- |
| **Distribute (分发)** | Install a Center Skill into one or more Agent directories via link or copy. |
| **Adopt (接管)** | Import an unmanaged Agent Skill into the Center Library, optionally replacing the Agent's copy with a symlink. |
| **Revoke (撤销)** | Remove a Skill Pack's Claims from an Agent. Only deletes files when no Claims remain. |
| **Diagnose (诊断)** | Scan the Center Library and all Agent directories for issues: unmanaged, broken links, outdated copies, conflicts. |
| **Snapshot (快照)** | A JSON export of the entire Skill Manager state. Used for backup, debugging, and SQLite recovery. |
