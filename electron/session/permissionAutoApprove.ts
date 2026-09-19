/**
 * 主机侧 bypass 闸门。
 *
 * 引擎的权限管线中，声明 requiresUserInteraction() 的工具（ExitPlanMode 等）走
 * bypass 免疫分支：permissions.ts 的 step 1e 在 step 2a 的 bypass 判定之前 return ask。
 * 也就是说，即使会话处于 bypassPermissions，引擎仍会发出
 * control_request: can_use_tool，等待宿主裁决。
 *
 * 本模块给出宿主的裁决口径：当**用户选定的模式**为完全信任时，模式切换类工具的
 * ask 由宿主自动放行，避免弹出一个既无信息量（通用权限卡只 dump 输入 JSON、不含
 * 计划正文）、又会把无人值守会话挂死的审批卡。
 *
 * 刻意**不**纳入的工具：
 *  - AskUserQuestion：需要真实用户输入，自动放行等于吞掉问题，必须继续弹。
 *  - EnterPlanMode：引擎在 bypass 下已由 step 2a 自动放行，不会到达宿主。
 */

/** 完全信任模式下可自动放行的「模式切换类」工具 */
export const EXIT_PLAN_MODE_TOOL_NAME = 'ExitPlanMode'

/**
 * 是否应由宿主自动放行这条权限请求。
 *
 * 判定依据是**用户选定的模式**（SessionProcess.currentPermissionMode），不是引擎的
 * 当前模式：模型自主进入 plan 模式后引擎模式会变成 'plan'，但用户意图仍是完全信任。
 * 若把引擎的 system/status permissionMode 广播同步进该字段，本闸门会在 plan 阶段失效。
 *
 * @param mode     用户选定的权限模式
 * @param toolName 引擎请求授权的工具名
 */
export function shouldAutoApprovePermission(
  mode: string,
  toolName: string,
): boolean {
  return mode === 'bypassPermissions' && toolName === EXIT_PLAN_MODE_TOOL_NAME
}
