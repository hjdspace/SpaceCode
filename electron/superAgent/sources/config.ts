/**
 * 项目级 Source 配置（T24 #93）。
 *
 * 配置落在 project.json 的 `sources` 字段：Store 对未知字段原样保留，
 * 因此新增该字段不需要提升 schemaVersion。未配置或结构非法一律视为
 * 「不启用任何 Source」—— 与接入前的行为完全一致（不启动任何轮询）。
 *
 * 飞书凭据不在这里：app_id/app_secret 复用 electron/im 的适配器配置边界
 * （`electron/im/adapters/common/config.ts`），本配置只保存业务侧参数
 * （bot open_id、chat 允许列表等）。
 */
export const FEISHU_IM_SOURCE_ID = 'feishu-im'

export interface SuperAgentFeishuImSourceConfig {
  /** 飞书 bot 自身的 open_id：@bot 判定与丢弃自身消息都依赖它。 */
  botOpenId: string
  /** 监听的 chat_id 允许列表（对应准入表的 channels）。 */
  chats: string[]
  /** 轮询间隔（毫秒）；缺省沿用 Ingestor 默认值。 */
  pollIntervalMs?: number
  /** 触发断档全量重拉的飞书 API 错误码（如分页/时间过滤参数失效）。 */
  gapErrorCodes?: number[]
}

export interface SuperAgentSourcesConfig {
  /** 启用的 Source id（当前仅 feishu-im）。 */
  enabled: string[]
  feishuIm?: SuperAgentFeishuImSourceConfig
}

export type SourcesConfigParseResult =
  | { kind: 'absent' }
  | { kind: 'configured'; config: SuperAgentSourcesConfig }
  | { kind: 'invalid'; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function parseFeishuIm(raw: unknown): SuperAgentFeishuImSourceConfig | string {
  if (!isRecord(raw)) return 'invalid-feishu-im'
  if (!isNonEmptyString(raw.botOpenId)) return 'missing-bot-open-id'
  if (!Array.isArray(raw.chats) || raw.chats.length === 0) return 'missing-chats'
  if (!raw.chats.every((chat) => isNonEmptyString(chat))) return 'invalid-chats'
  if (raw.pollIntervalMs !== undefined && !isPositiveInteger(raw.pollIntervalMs)) {
    return 'invalid-poll-interval'
  }
  if (
    raw.gapErrorCodes !== undefined &&
    (!Array.isArray(raw.gapErrorCodes) ||
      !raw.gapErrorCodes.every((code) => isPositiveInteger(code)))
  ) {
    return 'invalid-gap-error-codes'
  }
  const config: SuperAgentFeishuImSourceConfig = {
    botOpenId: raw.botOpenId,
    chats: raw.chats as string[],
  }
  if (raw.pollIntervalMs !== undefined) config.pollIntervalMs = raw.pollIntervalMs
  if (raw.gapErrorCodes !== undefined) config.gapErrorCodes = raw.gapErrorCodes as number[]
  return config
}

/** 解析 project.json 的 `sources` 字段；非法配置不抛错，交由调用方决定是否上报健康。 */
export function parseSuperAgentSourcesConfig(raw: unknown): SourcesConfigParseResult {
  if (raw === undefined || raw === null) return { kind: 'absent' }
  if (!isRecord(raw)) return { kind: 'invalid', reason: 'not-an-object' }
  if (!Array.isArray(raw.enabled) || !raw.enabled.every((id) => isNonEmptyString(id))) {
    return { kind: 'invalid', reason: 'invalid-enabled' }
  }

  const config: SuperAgentSourcesConfig = {
    enabled: raw.enabled as string[],
  }
  if (raw.feishuIm !== undefined) {
    const feishu = parseFeishuIm(raw.feishuIm)
    if (typeof feishu === 'string') return { kind: 'invalid', reason: feishu }
    config.feishuIm = feishu
  }
  // 启用飞书但没给出业务参数时无法安全轮询（bot open_id/chat 范围都缺）。
  if (config.enabled.includes(FEISHU_IM_SOURCE_ID) && config.feishuIm === undefined) {
    return { kind: 'invalid', reason: 'missing-feishu-im' }
  }
  return { kind: 'configured', config }
}
