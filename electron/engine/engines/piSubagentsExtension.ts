import { resolvePiExtensionEntry } from './piExtensionPackage'

const TAG = 'PiSubagentsExtension'

/**
 * Pi 的 agent 体系。pi 自己不做子代理（README.md:19 "Pi ships with powerful defaults
 * but skips features like sub-agents and plan mode"），1.3.0 也没有 `--agent` 旗子可拼 ——
 * 唯一能把「所选 agent」变成引擎里真实存在的东西的通道，还是 `--extension` 强制加载 (issue #46)。
 *
 * 注意这个扩展只读 `.pi/agents`、`.agents/agents` 与 `$PI_CODING_AGENT_DIR/agents`，
 * 从不读 `.claude/agents`。所以它给的是「委派能力 + pi 原生定义一等待遇」，而把 `.claude`
 * 里的人设落到本会话，靠的是 PiSessionProcess 的 `--append-system-prompt` 注入。
 */
export const SUBAGENTS_PACKAGE = '@tintinweb/pi-subagents'

/** 包清单 `pi.extensions` 指向的入口；扩展把 TypeScript 源码一起发了出来，jiti 直接吃。 */
const ENTRY_SEGMENTS = ['src', 'index.ts']

/** 解析子代理扩展入口；null = 这台机器上没有可加载的副本。 */
export function resolveSubagentsExtensionPath(): string | null {
  return resolvePiExtensionEntry(SUBAGENTS_PACKAGE, ENTRY_SEGMENTS, TAG)
}
