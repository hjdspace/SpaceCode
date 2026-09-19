# 完全信任模式下 ExitPlanMode 审批无法跳过的行为分析与修复方案

> 范围声明：本方案**不修改 `engine/`（只读子项目）**，全部改动落在 Electron 主进程。
> 参考实现来自同机另一个 Electron + CLI 宿主项目（下称「参考宿主」），其做法已在本机验证，本文只提炼结论，不复述其代码。

**状态：已落地。** 改动文件：

| 文件 | 变更 |
|---|---|
| `electron/session/permissionAutoApprove.ts` | 新增：闸门纯函数 `shouldAutoApprovePermission` |
| `electron/session/sessionProcess.ts` | 接入：`permission_request` 监听器头部加闸门分支 + import |
| `tests/electron/permissionAutoApprove.test.ts` | 新增：7 个用例（判定表 + 回包形状 + pending 清理） |

验证：`vue-tsc --noEmit` EXIT 0；`vitest run` 全量通过（详见 §7）。

---

## 1. 结论摘要（TL;DR）

| 问题 | 结论 |
|---|---|
| 引擎为什么在 `bypassPermissions` 下仍然 ask `ExitPlanMode`？ | **设计如此**。引擎的权限管线中，`requiresUserInteraction()` 工具走的是 bypass 免疫分支（step 1e），它在 bypass 判定（step 2a）**之前**返回。 |
| 弹窗是谁弹的？ | **宿主自己的选择**，不是引擎要求。主进程 `SessionProcess` 对 `can_use_tool` 零模式判断，无条件转发给渲染层，渲染层无条件渲染 `PermissionRequestCard`。 |
| 这个行为合理吗？ | **一半合理，落地形态不合理**。计划审批作为产品级同意门有其价值，但当前弹出的是**通用工具权限卡片**（不含计划正文），在完全信任模式下既无信息量、又会把无人值守的会话挂死；且与同模式下 `EnterPlanMode` 已被自动放行的事实自相矛盾（能进不能出）。判定为**缺陷**。 |
| 怎么修？ | 在主进程 `SessionProcess` 的 `can_use_tool` 入口加一个**主机侧 bypass 闸门**：`用户选定模式 == bypassPermissions` 且工具属于「模式切换类」时，直接 `allow` 并**不向渲染层发事件**。 |
| 关键约束 | 回 allow 时**必须省略 `updatedInput` 与 `updatedPermissions`**。省略 `updatedPermissions` 才能让引擎自己的 plan 退出事务完整跑完（详见 §5.4）。 |

---

## 2. 现象与复现路径

1. 会话以「完全信任 ⚠️」(即 `bypassPermissions`) 启动或切换到位。
2. 模型（自主或经用户要求）调用 `EnterPlanMode` → 被自动放行，无弹窗（**行为正确**）。
3. 模型完成探索、调用 `ExitPlanMode` 提交计划。
4. **异常点**：UI 弹出 `PermissionRequestCard`，标题 `Exit plan mode`，内容区是 `{}` 或 `{"allowedPrompts":[…]}` 的 JSON 转储，需人工点击「允许」才会继续。
5. 若无人在场（长任务 / IM / H5 / 无人值守），该轮对话**永久阻塞**：引擎在等 `control_response`，宿主侧无超时兜底。

---

## 3. 根因剖析（带全路径与行号）

### 3.1 引擎侧：ask 是刻意为之，且 bypass 免疫

入口：`D:\AI\SpaceCode\engine\src\utils\permissions\permissions.ts` → `hasPermissionsToUseToolInner()`

```
step 1c  tool.checkPermissions()            → ExitPlanMode 无条件返回 { behavior: 'ask' }
step 1e  requiresUserInteraction && ask     → 【直接 return ask】   ← bypass 免疫点
step 1f  content-specific ask rule          → bypass 免疫
step 1g  safetyCheck                        → bypass 免疫
step 2a  shouldBypassPermissions → allow    ← 只有走到这里才被 bypass 放行
```

- `permissions.ts:1251-1257`（step 1e）：工具声明 `requiresUserInteraction()` 且返回 `ask` 时立刻返回，**永远到不了 step 2a 的 bypass 分支**（`permissions.ts:1289-1302`）。
- `D:\AI\SpaceCode\engine\packages\builtin-tools\src\tools\ExitPlanModeTool\ExitPlanModeV2Tool.ts:185-194`：非 Teammate 时 `requiresUserInteraction()` 恒为 `true`。
- 同文件 `:221-239`：非 Teammate 时 `checkPermissions()` 恒为 `{ behavior: 'ask', message: 'Exit plan mode?' }`，不看模式。

因此，引擎在 `bypassPermissions` 下**确实会**发出 `control_request: can_use_tool (tool_name=ExitPlanMode)`。这一点与参考宿主一致——参考宿主修复「最高权限仍要求审批」时，**刻意保留**了 step 1e 分支，只把 bypass 判定提前到 ask 规则（1b/1f/1g）之前。换句话说：**业界实现也认为「必须用户交互的工具」不应被 bypass 吞掉**。

引擎侧还有两点值得注意：

- `ExitPlanModeV2Tool.ts:357-403`（`call()`）：退出动作本身承担了模式恢复与状态清理——`setHasExitedPlanMode(true)`、`setNeedsPlanModeExitAttachment(true)`、`restoreMode = prePlanMode ?? 'default'`、清空 `prePlanMode`。**入口条件写作 `if (prev.toolPermissionContext.mode !== 'plan') return prev`**，这是后面方案设计的关键约束。
- `engine/src/utils/permissions/permissionSetup.ts:608-615`：经控制通道（`set_permission_mode`）切到 `plan` 时，`transitionPermissionMode()` 会走 `prepareContextForPlanMode()`，把当时的模式 stash 进 `prePlanMode`。所以「从完全信任进入 plan」时 `prePlanMode === 'bypassPermissions'`，退出后能**自动恢复**为完全信任——这一点是明确的，无需宿主干预。

### 3.2 宿主侧：整条转发链没有任何模式意识

| 环节 | 文件 | 行为 |
|---|---|---|
| 协议解析 | `electron/session/controlProtocol.ts:519-525` | `routeInbound()` 收到 `can_use_tool` → 存入 pending → `emit('permission_request')`。无模式判断。 |
| 会话进程 | `electron/session/sessionProcess.ts:189-219` | 记 trace → `emit('permission_request')`。无模式判断。 |
| 进程池 | `electron/engine/claudeCodeProcessPool.ts:390-401` | `routeEvent(sessionId, 'permission_request', data)` 原样透传。 |
| 渲染层 | `src/stores/turn/index.ts:940-951` | `permissionService.addPermissionRequest(...)`。无模式判断。 |
| UI | `src/components/chat/tools/PermissionRequestCard.vue` | `status === 'pending'` 即渲染「拒绝 / 总是允许 / 允许」。 |

把这条链与 `src/lib/tool-registry.ts:313-320` 对照可知：`ExitPlanMode` 的 `hasSpecialUI: false`，卡片走 `else` 分支只做 JSON 转储——**用户看不到计划正文**。

### 3.3 期望行为 vs 实际行为

| 维度 | 期望 | 实际 |
|---|---|---|
| 引擎 | 在 bypass 下仍 ask 模式切换类工具（受信任度不影响「能进不能出」的陷阱防护） | ✅ 一致 |
| 宿主 | 完全信任 = 不再需要人工确认任何工具请求；模式切换类 ask 由宿主按用户模式自动裁决 | ❌ 无任何模式判断 |
| UI | —（完全信任下不应出现审批卡） | ❌ 弹通用权限卡，且不含计划内容 |
| 结果 | 无人值守可跑完 | ❌ 无超时阻塞，整轮 hang |
| 模式自洽性 | 同模式内 `EnterPlanMode` 自动放行 ⇒ `ExitPlanMode` 也应自动放行 | ❌ 能进不能出（引擎源码注释里称之为 "plan mode isn't a trap" 的正是这种情况） |

**判定：不合理。** 理由按重要性排序：

1. **模式内自相矛盾**：完全信任下 `EnterPlanMode` 被引擎 step 2a 自动放行（无弹窗），却拦 `ExitPlanMode`。官方把「能进不能出」明确定义为陷阱并主动禁用入口；我们的宿主反倒制造了这个陷阱。
2. **门槛无信息量**：卡片只显示工具名与输入 JSON，不显示计划正文，用户无法据此做出「批准/驳回」判断——这是纯摩擦，不是有效同意门。
3. **阻塞而非打扰**：引擎在等 `control_response`，宿主无超时；IM / H5 / 长任务场景直接挂死整个 turn，属于功能性故障。

**需要保留的合理部分**：计划审批作为产品级同意门本身有价值。正确的演进方向不是删掉它，而是（a）完全信任下自动放行；（b）其他模式下改用**专门的计划预览界面**（含「批准并继续 / 批准并自动接受编辑 / 驳回并继续规划」选项），而不是复用通用权限卡。本方案只做 (a)，(b) 列为可选后续项（§8）。

---

## 4. 方案总览

在**主进程** `SessionProcess` 的 `can_use_tool` 入口插入一道闸门：

```
引擎 stdout ──control_request: can_use_tool──▶ ControlProtocolHandler
                                                   │
                                                   ▼
                                    ┌───────────────────────────────┐
                                    │ 主机侧 bypass 闸门（新增）      │
                                    │ mode===bypassPermissions       │
                                    │   && tool===ExitPlanMode ?     │
                                    └───────┬───────────────┬───────┘
                                       是   │               │  否
                                            ▼               ▼
                            controlProtocol.allowPermission   emit('permission_request')
                             （不发渲染层、不弹卡）              （原有链路不变）
```

### 4.1 为什么放在主进程，而不是渲染层

- **覆盖度**：三条适配器链路（桌面渲染层、`h5Server`、`imServer`）都汇聚到 `engineGateway → ProcessPool → SessionProcess`。闸门放在 `SessionProcess` 一处即可全覆盖；放渲染层则 H5/IM 仍会弹。
- **权威性**：`SessionProcess.currentPermissionMode` 是主进程唯一权威；渲染层 `permissionPolicy` store 在多 pane 场景下只是第二份真相。

### 4.2 判定依据必须是「用户选定模式」，不是「引擎当前模式」

模型自主进入 plan 模式后，引擎模式变为 `plan`（`prePlanMode='bypassPermissions'`），但**用户意图仍是完全信任**。因此闸门读 `this.currentPermissionMode`——它只由启动配置与用户主动切换写入（`sessionProcess.ts:183`、`:687-695`），**不会**被引擎的 `system/status permissionMode` 广播污染。这一点必须在实现时注释清楚，否则后续若有人「顺手」把引擎广播同步进 `currentPermissionMode`，闸门会在 plan 阶段失效（`mode === 'plan'` → 弹窗回归）。

---

## 5. 落地实现

### 5.1 新增纯函数模块（可单测的接缝）

新文件：`D:\AI\SpaceCode\electron\session\permissionAutoApprove.ts`

```ts
/**
 * 主机侧 bypass 闸门。
 *
 * 引擎的权限管线中，声明 requiresUserInteraction() 的工具（ExitPlanMode 等）走
 * bypass 免疫分支：permissions.ts step 1e 在 step 2a 的 bypass 判定之前 return ask。
 * 也就是说，即使会话处于 bypassPermissions，引擎仍会发出
 * control_request: can_use_tool，等待宿主裁决。
 *
 * 本模块给出宿主的裁决口径：当**用户选定的模式**为完全信任时，模式切换类工具的
 * ask 由宿主自动放行，避免弹出一个既无信息量、又会把无人值守会话挂死的审批卡。
 *
 * 刻意**不**包含的工具：
 *  - AskUserQuestion：需要真实用户输入，放行等于吞掉问题，必须继续弹。
 *  - EnterPlanMode：引擎在 bypass 下已由 step 2a 自动放行，不会到达宿主。
 */

/** 完全信任模式下可自动放行的「模式切换类」工具 */
export const EXIT_PLAN_MODE_TOOL_NAME = 'ExitPlanMode'

/**
 * 是否应由宿主自动放行这条权限请求。
 *
 * @param mode     用户选定的权限模式（SessionProcess.currentPermissionMode），
 *                 不是引擎当前模式——模型自主进入 plan 时引擎模式为 'plan'，
 *                 但用户意图仍是完全信任。
 * @param toolName 引擎请求授权的工具名。
 */
export function shouldAutoApprovePermission(
  mode: string,
  toolName: string,
): boolean {
  return mode === 'bypassPermissions' && toolName === EXIT_PLAN_MODE_TOOL_NAME
}
```

> 只做「一个模式 + 一个工具」的判定，不引入配置项或可插拔策略：符合 AGENTS.md「仅实现请求的功能，不添加额外抽象或配置项」。

### 5.2 接入点：`electron/session/sessionProcess.ts`

在 `constructor` 内、**现有 `permission_request` 监听器的最前面**插入闸门（原监听器位于 `:189-219`，改动只在头部加分支，其余逻辑不动）：

```ts
import { shouldAutoApprovePermission } from './permissionAutoApprove'

// ... 构造函数内，紧接 this.controlProtocol.on('sdk_message', ...) 之后

this.controlProtocol.on('permission_request', (req: CanUseToolRequest) => {
  // ── 主机侧 bypass 闸门 ──
  // 完全信任模式下，引擎仍会对模式切换类工具（ExitPlanMode）发 ask——
  // 这是引擎刻意的 bypass 免疫分支（permissions.ts step 1e）。
  // 此处按**用户选定模式**裁决：直接 allow，不向渲染层发事件，不弹审批卡。
  // 判定依据刻意使用 currentPermissionMode（用户意图）而非引擎当前模式：
  // 模型自主进入 plan 后引擎模式为 'plan'，但用户意图仍是完全信任。
  if (shouldAutoApprovePermission(this.currentPermissionMode, req.toolName)) {
    info(
      'SessionProcess',
      `[${this.sessionId.slice(0, 8)}] bypass auto-approve | tool=${req.toolName} | requestId=${req.requestId.slice(0, 8)}`,
    )
    traceEvent({
      sessionId: this.sessionId,
      engineSessionId: this.engineSessionId || undefined,
      actor: 'system',
      type: 'permission_request',
      status: 'completed',
      title: `Permission auto-approved (bypassPermissions): ${req.toolName}`,
      input: { tool_name: req.toolName, input: req.input, tool_use_id: req.toolUseId },
      metadata: {
        requestId: req.requestId,
        autoApproved: true,
        mode: this.currentPermissionMode,
      },
    })
    this.lastActivityAt = Date.now()
    try {
      // 关键：两个可选参数都省略。
      //  - updatedInput 省略 → ControlProtocolHandler 回填原始 input
      //    （引擎侧 updatedInput 是 full-replace；发 {} 虽会被兜底成原输入，
      //      但省略更直白）。
      //  - updatedPermissions 省略 → 让引擎自己的 plan 退出事务完整执行。
      //    若这里塞一个 { type: 'setMode', mode: 'bypassPermissions' }，
      //    ExitPlanModeV2Tool.call() 会因 mode 已不是 'plan' 而直接 return prev，
      //    hasExitedPlanMode / plan-exit attachment / prePlanMode 清理全部丢失。
      this.controlProtocol.allowPermission(req.requestId, undefined, 'user_permanent')
    } catch (e) {
      warn(
        'SessionProcess',
        `[${this.sessionId.slice(0, 8)}] bypass auto-approve failed | tool=${req.toolName} | requestId=${req.requestId.slice(0, 8)}`,
        { error: String(e) },
      )
    }
    return
  }

  // ── 以下为原有逻辑，保持不变 ──
  info(/* ... 原有 permission_request 日志 ... */)
  // ...
})
```

同步更新 `permissionAutoApprove.ts` 的 import 与 `SessionProcess` 顶部已有的 `traceEvent` / `info` / `warn` 引入（`sessionProcess.ts` 已引入这三者，无需新增）。

### 5.3 端到端行为（改后）

| 场景 | 用户选定模式 | 引擎模式 | 结果 |
|---|---|---|---|
| 完全信任下模型自主进 plan 再 exit | `bypassPermissions` | `plan` → 退出后 `bypassPermissions` | **无弹窗**；计划正文以 `ExitPlanMode` 工具结果回显在时间线；退出后自动回到完全信任 |
| 用户手动切到 plan 再 exit | `plan` | `plan` → 退出后 `prePlanMode`（切换前的模式） | 弹审批卡（**保持现状**，符合用户显式选择） |
| 完全信任下 `AskUserQuestion` | `bypassPermissions` | 任意 | 仍弹问答卡（**刻意不跳过**，需要真实用户输入） |
| 显式 deny 规则命中的工具 | 任意 | 任意 | 引擎在 step 1d 直接 deny，根本不发 `can_use_tool`，宿主无从推翻 |
| 完全信任下 `Bash` / `Edit` 等 | `bypassPermissions` | 任意 | 引擎 step 2a 已自动放行，不会到达宿主 |

### 5.4 为什么不能「顺手」带上 `updatedPermissions`

`engine/src/utils/permissions/PermissionPromptToolResultSchema.ts:95-106` 表明：宿主回传的 `updatedPermissions` 会**先于**工具执行写入 `toolPermissionContext`。而 `ExitPlanModeV2Tool.call()`（`:357-403`）的退出事务以 `mode === 'plan'` 为前置条件。若我们在回复里塞 `{ type: 'setMode', mode: 'bypassPermissions', destination: 'session' }`：

1. `applyPermissionUpdate` 先把 mode 改成 `bypassPermissions`（`PermissionUpdate.ts:59-67`）；
2. 随后 `call()` 发现 `mode !== 'plan'` → `return prev`，退出事务被**整体跳过**：
   - `setHasExitedPlanMode(true)` 未执行；
   - `setNeedsPlanModeExitAttachment(true)` 未执行（模型可能仍以为自己在 plan 模式）；
   - `prePlanMode` 未清理。

这正是参考宿主在「批准计划时显式下发模式」那次修复中需要**同时修改引擎**才能收拾的半应用状态。我们的引擎版本没有对应的兜底，所以本方案的结论是：**省略 `updatedPermissions`，把模式恢复交给引擎自己的事务**。而 `prePlanMode` 已被正确 stash（§3.1 末），恢复结果就是完全信任，无需宿主干预。

### 5.5 被否决的替代方案

| 方案 | 否决理由 |
|---|---|
| 渲染层闸门（`src/stores/turn/index.ts` 的 `onPermissionRequest` 内判断 `policyStore.currentPermissionMode`） | H5 / IM 链路不经过渲染层，覆盖不全；多 pane 下模式状态有第二份真相。 |
| 引擎侧补丁（把 step 1e 挪到 2a 之后） | 违反「不修改 engine」约束；且会连带放行 `AskUserQuestion`，语义错误。 |
| 回传 `updatedPermissions: [setMode]` 固定模式 | §5.4：会短路引擎退出事务，制造比原问题更隐蔽的状态不一致。 |
| 给 `ExitPlanMode` 建专门的计划审批弹窗，完全信任下也弹 | 有价值但属独立特性（见 §8）；不解决「无人值守挂死」这一核心故障。 |

---

## 6. 测试清单

### 6.1 新增单测（已落地）

文件：`D:\AI\SpaceCode\tests\electron\permissionAutoApprove.test.ts`（沿用该目录的 `node:assert/strict` 风格）。两组用例：

**`describe('shouldAutoApprovePermission')` —— 判定表**

| 用例 | 期望 |
|---|---|
| `bypassPermissions` + `ExitPlanMode` | `true` |
| `bypassPermissions` + `AskUserQuestion` | `false`（需真实用户输入） |
| `bypassPermissions` + `Bash`/`Edit`/`Write`/`Read`/`EnterPlanMode` | `false`（引擎侧自会裁决） |
| `default`/`plan`/`acceptEdits`/`dontAsk` + `ExitPlanMode` | `false`（保留人工审批） |
| `''`/`'BYPASSPERMISSIONS'`/`'auto'` + `ExitPlanMode` | `false`（大小写不宽容、未知模式不误放行） |

**`describe('auto-approve reply shape')` —— 跨真实接缝锁住两条不变量**

用真实的 `ControlProtocolHandler` 喂入一条 ExitPlanMode 的 `can_use_tool`（input 含 `plan` / `planFilePath`），再按 `SessionProcess` 的写法调 `allowPermission(requestId, undefined, 'user_permanent')`，断言：

1. 出站 `control_response.response.updatedInput` **等于原始 input**（省略 → handler 回填，引擎侧 full-replace 语义下计划不被清空）；
2. `'updatedPermissions' in response.response === false`（绝不携带 `setMode`，避免短路引擎退出事务）；
3. 应答后 `getPendingPermissionRequestIds()` 为空、`getPendingPermissionRequest()` 为 `undefined`（不会与后续 `control_cancel_request` 重复触发）。

### 6.2 现有测试不应受影响

- `tests/electron/controlProtocol.test.ts`
- `tests/electron/sessionProcess.protocol.test.ts`

闸门只加在 `SessionProcess` 的监听器头部，`ControlProtocolHandler` 自身语义未变，两者应保持全绿。

### 6.3 手工 / 端到端验证

1. 以「完全信任 ⚠️」新建会话，让模型 `EnterPlanMode` → 出计划 → `ExitPlanMode`。
2. 断言：
   - 会话日志出现 `bypass auto-approve | tool=ExitPlanMode`（`~/.claude/debug/` 下当日日志 + 会话 trace）；
   - UI **没有**出现审批卡片；
   - 模式选择器仍显示「完全信任 ⚠️」（退出后未被降级为 `default`）；
   - 紧接着的写操作不再触发任何审批。
3. 反向断言：把模式切到「默认」后再走一遍 plan → exit，审批卡片**照旧出现**，点「允许」后一切正常。

---

## 7. 验证结果

```sh
node node_modules/vue-tsc/bin/vue-tsc.js --noEmit   # 等价 npm run build 的类型检查部分
node node_modules/vitest/vitest.mjs run              # 等价 npm run test
node node_modules/vite/bin/vite.js build             # 等价 npm run build 的 vite 部分
```

> 本机 `npm run <script>` 会被沙箱的安全策略拦截（触发 wsl.exe 黑名单），故直接调用二进制。

| 命令 | 结果 |
|---|---|
| `vue-tsc --noEmit` | **EXIT 0** |
| `vitest run` | **168 文件 / 1857 用例全通过**（含新增的 7 个用例） |
| `vite build` | **EXIT 0**；`dist-electron/main.js` 已包含闸门（校验 `bypass auto-approve` 日志串在产物中） |

> 备注：全量测试首跑曾出现 `src/components/settings/__tests__/MemorySettings.test.ts` 的一个
> 「Test timed out in 5000ms」——在 168 个 worker 并发下该用例的时序断言被拖垮。单独运行该文件
> 11/11 通过（3.5s），复跑全量亦 168/168 全绿，属既有的测试脆弱性，与本次改动无关。

---

## 8. 可选后续项（不在本次改动范围）

1. **专用计划审批界面**：为 `ExitPlanMode` 提供计划正文渲染 + 「批准并继续 / 批准并自动接受编辑 / 批准并跳过全部审批 / 驳回并继续规划」四个选项。参考宿主正是这样做的（把批准与模式 pin 绑定在同一动作里），但**必须配套引擎侧的退出事务修复**（§5.4），否则会引入半应用状态。当前 `src/lib/tool-registry.ts` 里 `ExitPlanMode` 的 `hasSpecialUI: false` 需要一并改为 `true`。
2. **宿主侧权限请求超时**：引擎可能在 `can_use_tool` 上无限等待。给 `SessionProcess` 的 pending 权限请求加一个可见的超时兜底（超时后按 deny + 明确的 decisionReason 回复，避免整轮静默挂死）。这是与本次问题同源的健壮性缺口。
3. **`currentPermissionMode` 的注释性保护**：在字段声明处标注「此字段是用户意图，禁止被引擎 `system/status.permissionMode` 广播覆盖」，防止后续改动破坏 §4.2 的前提。
