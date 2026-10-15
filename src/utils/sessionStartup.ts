import type { SessionStartupFingerprint } from '@/types'

export type StartupConfigField = 'systemPrompt' | 'agent' | 'credential'

export interface DesiredStartupConfig {
  /** 未指定（undefined）表示本次调用没有声明该配置，不参与对账。 */
  systemPrompt?: string
  agent?: string
  apiKey?: string
  /** 代理模式下引擎侧只拿占位 Key，真实 Key 属于本地代理，不在这里对账。 */
  usesProxy: boolean
}

/**
 * cyrb53 —— 确定性、非加密哈希，只用于判断"配置换没换"。
 * systemPrompt 是几 KB 的提示词栈、apiKey 是凭据，两者都不能明文进入会话存储
 * （localStorage / gui-settings 镜像）或日志；指纹不是访问控制，不替代密钥保管。
 */
function hashStartupValue(value: string | undefined): string {
  const input = value ?? ''
  let h1 = 0xdeadbeef
  let h2 = 0x4162fe10
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** 与 diffStartupConfig 共用同一哈希口径，保证记录与实际下发一致。 */
export function buildStartupFingerprint(desired: DesiredStartupConfig): SessionStartupFingerprint {
  return {
    systemPrompt: hashStartupValue(desired.systemPrompt),
    agent: hashStartupValue(desired.agent),
    credential: desired.usesProxy ? undefined : hashStartupValue(desired.apiKey),
  }
}

/**
 * 运行中的引擎进程无法接收新的 systemPrompt / agent（只在 startSession 时下发为 CLI
 * 参数）或新凭据（只在 spawn 时注入环境变量），因此这些字段一旦与实际下发值不一致
 * 就必须重启。旧会话没有指纹时视为"未知"，与 provider 快照同策略：重启一次以对账。
 */
export function diffStartupConfig(
  applied: SessionStartupFingerprint | undefined,
  desired: DesiredStartupConfig,
): StartupConfigField[] {
  const changed: StartupConfigField[] = []
  if (desired.systemPrompt !== undefined
    && hashStartupValue(desired.systemPrompt) !== applied?.systemPrompt) {
    changed.push('systemPrompt')
  }
  if (desired.agent !== undefined
    && hashStartupValue(desired.agent) !== applied?.agent) {
    changed.push('agent')
  }
  if (!desired.usesProxy
    && hashStartupValue(desired.apiKey) !== applied?.credential) {
    changed.push('credential')
  }
  return changed
}
