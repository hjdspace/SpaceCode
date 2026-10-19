# 权限模式按会话归属，不做全局单值

## Status

Accepted。部分取代 [ADR 0010](0010-session-orchestration-one-shot-dag.md) 里「Permission follows global policy」那一条。

## Context

`permissionPolicy` store 用**一个** `ref` 存权限模式（`currentPermissionMode`），初始值取自持久化的 `settings.permissionMode`，全应用共享。所有会话的输入框、所有下发路径都读这一个值。

后果是跨会话串扰，且不只是显示层：

1. 会话 A 选「完全信任」正在跑任务；用户开会话 B，切到「计划模式」并发起任务。切换写的是全局值，只对 `currentSessionId`（B）下发。
2. 用户点回 A → `selectSession` → `syncPermissionMode` 的语义是「若该会话进程意图 ≠ **全局偏好**，就把全局偏好下发给该会话」。A 的意图是 `bypassPermissions`，全局已被 B 改成 `plan` → 条件成立 → 向 A 的引擎 stdin 写 `set_permission_mode(plan)`。`claudeCodeProcessPool.setPermissionMode` 只要进程在跑就立刻下发，不看轮次是否进行中。
3. A 正在实现的这一轮，下一个 API 请求就落在 plan 模式下：工具集收窄为只读 + ExitPlanMode，`getPlanModeAttachments` 注入 plan_mode 提醒 → 模型「自己」调用了 ExitPlanMode。
4. 同一次下发还把 `SessionProcess.currentPermissionMode`（用户意图）也改写成 `plan`，而完全信任的宿主侧自动放行闸门正是读这个字段（见 [exit-plan-mode-bypass-auto-approve.md](../exit-plan-mode-bypass-auto-approve.md) §4.2）→ 闸门失效，ExitPlanMode 的 ask 被推到渲染层弹审批卡。

现象即：**会话 A 凭空调用 ExitPlanMode，且它的输入框显示成计划模式。**

镜像方向更危险：A 在 plan / default，B 切「完全信任」→ 回到 A 会把 A 强推到 bypassPermissions，A 的文件改动不再经任何确认；若 A 启动时没带 `--dangerously-skip-permissions`，控制请求被引擎拒绝后进程池会**以 bypass 重启 A 的进程**（`--resume` 保历史）。B 的一次点击提权并重启了 A。

同一条全局写入链还顺带改写 `~/.claude/settings.json` 的 `permissions.defaultMode`，把所有不带 `--permission-mode` 的启动（终端里直接跑的 CLI）一起带走。

## Decision

1. **真源挂在 Session 上**：`Session.permissionMode?: PermissionMode`，随会话落盘。`permissionPolicy` store 退为读写入口 —— `getPermissionMode(sessionId)` / `setPermissionMode(sessionId, mode)`，不再持有模式值本身。
2. **`settings.permissionMode` 退为初值**：只在会话自己从没切过模式时兜底；在某个会话里切模式**不再**改写它，也不再写 `~/.claude/settings.json`。
3. **对账口径跟着改**：`syncPermissionMode` 比对**目标会话自己的**模式；`initClaudeCodeSession` 的启动参数用会话自己的模式；专业助手的 `permission` 落在它新建的那个会话上。
4. **UI 按 pane 会话显示**：`PermissionModeSelector` 接 `sessionId`，由 `ChatInput` 用 `editorSessionId`（分屏/侧边任务已经在用同一个按会话寻址的 id）喂进去。此前 ChatPanel 给 pane 绑了 messages / loading / cwd / model，唯独模式漏了 —— 它读的是全局值。
5. **轮次进行中的主动切换仍立即生效**（不改成轮次末生效）。会话级化之后，隐式对账不会再拿别的会话的模式去打正在跑的会话，剩下唯一的轮次中途改模式来源是用户对本会话的显式操作，那是他要求的语义。
6. **旧会话**没有该字段 → 取 `settings.permissionMode` 作为初值，用户在各会话里切过一次之后各自独立。不做一次性迁移写入。

## Rationale

- 权限模式决定的是「哪个进程被允许改文件」，天然属于会话；全局单值把作用域和归属分开了，归属就丢了。
- 主进程早就按会话存：`claudeCodeProcessPool.pendingPermissionModes` 以 sessionId 为键，`SessionProcess.currentPermissionMode` 是每进程字段，IPC 契约首参就是 sessionId。串扰出在渲染层只有一份值，把会话维度压平成了「最后一个动过的人」。
- 显示与真源必须同源：输入框读全局、下发也读全局，所以「显示变了」和「引擎真被改了」是同一个 bug 的两面，只修显示会留下失控的进程。

## Consequences

- `permissionPolicy.currentPermissionMode` 这个导出消失。读它的地方（定时任务弹窗取默认权限、`syncPermissionMode`、启动参数）改为显式传 sessionId 或用 `defaultPermissionMode`。
- 会话切换不再隐式提权/降权：回到一个正在跑的会话不会再下发 `set_permission_mode`。
- 「新会话用什么模式」= 上次在设置里留下的默认值，而不是上一个会话最后选的东西。行为可预期，代价是用户切会话时看到的模式可能各不相同。
- ADR 0010 的编排节点权限改为跟随发起会话的模式（节点本身就是普通 chat session），不再是全局。
- 遗留同族问题（本 ADR 未处理）：`PermissionRequestCard` / `AgentTimeline` / `ChatPanel.handleToolSubmit` 仍按 `currentSessionId` 回退查 pending 权限；移动端与 IM 入口改模式后，渲染层记的会话值会与之不一致，下次对账可能把远程改动覆盖回去。两者都按同一口径（显式 sessionId）收敛即可。

## Alternatives considered

- **只让 `syncPermissionMode` 跳过运行中的会话**。最小改动，但输入框显示仍是全局共用，A/B 互相错乱没解决；且回到一个已挂起的会话照样被改模式。
- **轮次进行中一律不下发，改由 `result` 时机对账**。挡住了串扰，但把「用户对当前会话的显式切换」也推迟了，且没解决显示与启动参数仍是全局的问题。作为后续加固可再评估。
- **保留全局值 + 每会话覆盖（override 表）**。两套真源，读取要先查覆盖再回落全局，跨会话写入到底算哪一层说不清。直接把会话本身当唯一真源更短。
