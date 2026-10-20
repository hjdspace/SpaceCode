import { resolvePiExtensionEntry } from './piExtensionPackage'

const TAG = 'PiPlanModeExtension'

/**
 * plan 模式的权限闸扩展。Pi 不内置权限闸（1.3.0 的 docs/security.md 仍写着
 * "does not ask for approval before every tool call"），也没有可以拼的 `--permission-mode`
 * 旗子 —— 能把「界面说 plan、实际照写不误」扭过来的通道，是用 `--extension` 强制加载这个
 * 扩展，再由宿主把它的 RPC 对话框应答掉 (issue #45)。
 */
export const PLAN_MODE_PACKAGE = '@narumitw/pi-plan-mode'

/** 扩展没有启动旗子（README: "There is no startup flag."），进出模式只能发这两条命令。 */
export const PLAN_MODE_ENTER_COMMAND = '/plan start'
export const PLAN_MODE_EXIT_COMMAND = '/plan exit'

/** 包清单 `pi.extensions` 指向的入口；Pi 的 jiti 直接吃 TypeScript。 */
const ENTRY_SEGMENTS = ['dist', 'index.ts']

/**
 * 解析权限闸扩展入口；null = 这台机器上没有可加载的副本。
 *
 * 候选序列与 asar 规则都在 resolvePiExtensionEntry 里，和 subagents 扩展读的是同一份口径。
 */
export function resolvePlanModeExtensionPath(): string | null {
  return resolvePiExtensionEntry(PLAN_MODE_PACKAGE, ENTRY_SEGMENTS, TAG)
}
