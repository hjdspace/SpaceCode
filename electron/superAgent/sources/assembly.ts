/**
 * Source 装配（T24 #93）：把项目级 Source 配置变成可轮询的 ExternalSource 列表。
 *
 * 飞书凭据不另造存储：默认从 `electron/im` 的适配器配置边界读取
 * （环境变量 > ~/.claude/adapters.json > 默认值），与 IM 适配器共用同一份
 * app_id/app_secret。凭据缺失或业务参数缺失时抛稳定错误码，由 service 计入
 * 健康并保持不轮询，绝不带空凭据启动。
 *
 * T25 #97 GitHub PR：凭据同样不另造存储，默认走本仓既有 gh CLI 通路
 * （`gh auth token`）；运行期 token 失效由轮询失败进入 `source:github-pr`
 * 健康类别，不静默。
 */
import { execFileSync } from 'node:child_process'
import { loadConfig as loadImAdapterConfig } from '../../im/adapters/common/config'
import { superAgentError } from '../errors'
import { FEISHU_IM_SOURCE_ID, type SuperAgentSourcesConfig } from './config'
import { createFeishuImHttpClient, FeishuImSource } from './feishuIm'
import {
  createGithubPrHttpClient,
  GITHUB_PR_SOURCE_ID,
  GithubPrSource,
} from './githubPr'
import type { ExternalSource } from './types'

export interface FeishuImCredentials {
  appId: string
  appSecret: string
}

export interface BuildExternalSourcesOptions {
  config: SuperAgentSourcesConfig
  /** 凭据来源接缝；缺省复用 electron/im 的适配器配置。 */
  loadFeishuCredentials?: () => FeishuImCredentials
  /** GitHub 凭据来源接缝；缺省走 gh CLI（`gh auth token`）。 */
  loadGithubToken?: () => string | null
  /** 测试接缝：替换 fetch / API base，不触真实网络。 */
  fetch?: typeof fetch
  apiBase?: string
  githubApiBase?: string
}

function defaultFeishuCredentials(): FeishuImCredentials {
  const config = loadImAdapterConfig()
  return { appId: config.feishu.appId, appSecret: config.feishu.appSecret }
}

/** 复用既有 gh CLI 登录态；未安装/未登录时返回 null，由装配层报凭据缺失。 */
function defaultGithubToken(): string | null {
  try {
    const stdout = execFileSync(process.platform === 'win32' ? 'gh.exe' : 'gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    })
    const token = stdout.trim()
    return token === '' ? null : token
  } catch {
    return null
  }
}

function buildFeishu(options: BuildExternalSourcesOptions): ExternalSource {
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
  return new FeishuImSource(client, feishu.botOpenId)
}

function buildGithubPr(options: BuildExternalSourcesOptions): ExternalSource {
  const github = options.config.githubPr
  if (!github) {
    throw superAgentError('sourceConfigInvalid', { source: GITHUB_PR_SOURCE_ID })
  }
  const token = (options.loadGithubToken ?? defaultGithubToken)()
  if (token === null || token.trim() === '') {
    throw superAgentError('sourceCredentialsMissing', { source: GITHUB_PR_SOURCE_ID })
  }

  const client = createGithubPrHttpClient({
    token: token.trim(),
    prs: github.prs,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    ...(options.githubApiBase ? { apiBase: options.githubApiBase } : {}),
  })
  return new GithubPrSource(client, {
    ...(github.automationAccounts ? { automationAccounts: github.automationAccounts } : {}),
    ...(github.maxAutomationRounds ? { maxAutomationRounds: github.maxAutomationRounds } : {}),
  })
}

export function buildExternalSources(options: BuildExternalSourcesOptions): ExternalSource[] {
  const sources: ExternalSource[] = []
  if (options.config.enabled.includes(FEISHU_IM_SOURCE_ID)) {
    sources.push(buildFeishu(options))
  }
  if (options.config.enabled.includes(GITHUB_PR_SOURCE_ID)) {
    sources.push(buildGithubPr(options))
  }
  return sources
}
