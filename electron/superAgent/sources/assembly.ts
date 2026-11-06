/**
 * Source 装配（T24 #93）：把项目级 Source 配置变成可轮询的 ExternalSource 列表。
 *
 * 飞书凭据不另造存储：默认从 `electron/im` 的适配器配置边界读取
 * （环境变量 > ~/.claude/adapters.json > 默认值），与 IM 适配器共用同一份
 * app_id/app_secret。凭据缺失或业务参数缺失时抛稳定错误码，由 service 计入
 * 健康并保持不轮询，绝不带空凭据启动。
 */
import { loadConfig as loadImAdapterConfig } from '../../im/adapters/common/config'
import { superAgentError } from '../errors'
import { FEISHU_IM_SOURCE_ID, type SuperAgentSourcesConfig } from './config'
import { createFeishuImHttpClient, FeishuImSource } from './feishuIm'
import type { ExternalSource } from './types'

export interface FeishuImCredentials {
  appId: string
  appSecret: string
}

export interface BuildExternalSourcesOptions {
  config: SuperAgentSourcesConfig
  /** 凭据来源接缝；缺省复用 electron/im 的适配器配置。 */
  loadFeishuCredentials?: () => FeishuImCredentials
  /** 测试接缝：替换 fetch / API base，不触真实网络。 */
  fetch?: typeof fetch
  apiBase?: string
}

function defaultFeishuCredentials(): FeishuImCredentials {
  const config = loadImAdapterConfig()
  return { appId: config.feishu.appId, appSecret: config.feishu.appSecret }
}

export function buildExternalSources(options: BuildExternalSourcesOptions): ExternalSource[] {
  if (!options.config.enabled.includes(FEISHU_IM_SOURCE_ID)) return []

  const feishu = options.config.feishuIm
  if (!feishu) {
    throw superAgentError('sourceConfigInvalid', { source: FEISHU_IM_SOURCE_ID })
  }
  const credentials = (options.loadFeishuCredentials ?? defaultFeishuCredentials)()
  if (credentials.appId.trim() === '' || credentials.appSecret.trim() === '') {
    throw superAgentError('sourceCredentialsMissing', { source: FEISHU_IM_SOURCE_ID })
  }

  const client = createFeishuImHttpClient({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    chats: feishu.chats,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.apiBase ? { apiBase: options.apiBase } : {}),
    ...(feishu.gapErrorCodes ? { gapErrorCodes: feishu.gapErrorCodes } : {}),
  })
  return [new FeishuImSource(client, feishu.botOpenId)]
}
