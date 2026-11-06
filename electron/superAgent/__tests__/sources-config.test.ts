// @vitest-environment node
/**
 * T24 #93：项目级 Source 配置解析与装配。
 *  - 未配置/结构非法 → 不启动任何 Source（与现状一致）；
 *  - 启用的飞书 IM 必须带 bot open_id 与 chat 允许列表；
 *  - 凭据复用 electron/im 的适配器配置边界，缺失时给稳定错误码；
 *  - T25 #97：GitHub PR 段（repo / prs / automationAccounts / maxAutomationRounds）
 *    按项目配置装配；凭据复用既有 gh CLI 通路，缺失不静默。
 */
import { describe, expect, it } from 'vitest'
import { buildExternalSources } from '../sources/assembly'
import {
  FEISHU_IM_SOURCE_ID,
  parseSuperAgentSourcesConfig,
  type SuperAgentSourcesConfig,
} from '../sources/config'
import { GITHUB_PR_SOURCE_ID } from '../sources/githubPr'

const VALID: SuperAgentSourcesConfig = {
  enabled: [FEISHU_IM_SOURCE_ID],
  feishuIm: {
    botOpenId: 'ou_bot',
    chats: ['oc_chat'],
    pollIntervalMs: 500,
  },
}

const GITHUB: SuperAgentSourcesConfig = {
  enabled: [GITHUB_PR_SOURCE_ID],
  githubPr: {
    repo: 'acme/app',
    prs: ['acme/app#42'],
    automationAccounts: ['copilot-pull-request-reviewer[bot]'],
    pollIntervalMs: 500,
  },
}

function errorCodeOf(run: () => unknown): string {
  let code = ''
  try {
    run()
  } catch (err) {
    code = (err as { code?: string }).code ?? ''
  }
  return code
}

describe('parseSuperAgentSourcesConfig', () => {
  it('treats absent config as not configured', () => {
    expect(parseSuperAgentSourcesConfig(undefined).kind).toBe('absent')
    expect(parseSuperAgentSourcesConfig(null).kind).toBe('absent')
  })

  it('accepts a valid feishu-im config', () => {
    const parsed = parseSuperAgentSourcesConfig(VALID)
    expect(parsed.kind).toBe('configured')
    if (parsed.kind !== 'configured') return
    expect(parsed.config).toEqual(VALID)
  })

  it('rejects non-object and missing enabled list', () => {
    expect(parseSuperAgentSourcesConfig('nope').kind).toBe('invalid')
    expect(parseSuperAgentSourcesConfig({}).kind).toBe('invalid')
    expect(parseSuperAgentSourcesConfig({ enabled: 'feishu-im' }).kind).toBe('invalid')
    expect(parseSuperAgentSourcesConfig({ enabled: ['feishu-im', 1] }).kind).toBe('invalid')
  })

  it('rejects enabled feishu-im without bot open_id or chat allowlist', () => {
    expect(
      parseSuperAgentSourcesConfig({
        enabled: [FEISHU_IM_SOURCE_ID],
        feishuIm: { botOpenId: '   ', chats: ['oc_chat'] },
      }).kind,
    ).toBe('invalid')
    expect(
      parseSuperAgentSourcesConfig({
        enabled: [FEISHU_IM_SOURCE_ID],
        feishuIm: { botOpenId: 'ou_bot', chats: [] },
      }).kind,
    ).toBe('invalid')
    expect(
      parseSuperAgentSourcesConfig({
        enabled: [FEISHU_IM_SOURCE_ID],
        feishuIm: { botOpenId: 'ou_bot', chats: ['oc_chat', ''] },
      }).kind,
    ).toBe('invalid')
    expect(
      parseSuperAgentSourcesConfig({
        enabled: [FEISHU_IM_SOURCE_ID],
        feishuIm: { botOpenId: 'ou_bot', chats: ['oc_chat'], pollIntervalMs: 0 },
      }).kind,
    ).toBe('invalid')
  })

  it('accepts a valid github-pr config', () => {
    const parsed = parseSuperAgentSourcesConfig(GITHUB)
    expect(parsed.kind).toBe('configured')
    if (parsed.kind !== 'configured') return
    expect(parsed.config).toEqual(GITHUB)
  })

  it('rejects github-pr without repo/prs or with PRs outside the repo', () => {
    const base = { enabled: [GITHUB_PR_SOURCE_ID] }
    expect(
      parseSuperAgentSourcesConfig({
        ...base,
        githubPr: { prs: ['acme/app#42'] },
      }).kind,
    ).toBe('invalid')
    expect(
      parseSuperAgentSourcesConfig({
        ...base,
        githubPr: { repo: 'acme/app', prs: [] },
      }).kind,
    ).toBe('invalid')
    expect(
      parseSuperAgentSourcesConfig({
        ...base,
        githubPr: { repo: 'acme/app', prs: ['other/app#42'] },
      }).kind,
    ).toBe('invalid')
    expect(
      parseSuperAgentSourcesConfig({
        ...base,
        githubPr: { repo: 'acme/app', prs: ['acme/app'] },
      }).kind,
    ).toBe('invalid')
    // 启用 GitHub PR 但没给出业务参数（repo/prs）时无法安全轮询。
    expect(parseSuperAgentSourcesConfig(base).kind).toBe('invalid')
  })

  it('rejects invalid automation accounts and automation rounds', () => {
    const base = { enabled: [GITHUB_PR_SOURCE_ID] }
    expect(
      parseSuperAgentSourcesConfig({
        ...base,
        githubPr: {
          repo: 'acme/app',
          prs: ['acme/app#42'],
          automationAccounts: ['bot', ''],
        },
      }).kind,
    ).toBe('invalid')
    expect(
      parseSuperAgentSourcesConfig({
        ...base,
        githubPr: { repo: 'acme/app', prs: ['acme/app#42'], maxAutomationRounds: 0 },
      }).kind,
    ).toBe('invalid')
  })
})

describe('buildExternalSources', () => {
  it('builds nothing when feishu-im is not enabled', () => {
    expect(buildExternalSources({ config: { enabled: [] } })).toEqual([])
  })

  it('rejects enabled feishu-im without its detail config', () => {
    expect(
      errorCodeOf(() =>
        buildExternalSources({
          config: { enabled: [FEISHU_IM_SOURCE_ID] },
        }),
      ),
    ).toBe('sourceConfigInvalid')
  })

  it('rejects when IM credential boundary returns no app credentials', () => {
    expect(
      errorCodeOf(() =>
        buildExternalSources({
          config: VALID,
          loadFeishuCredentials: () => ({ appId: '', appSecret: '' }),
        }),
      ),
    ).toBe('sourceCredentialsMissing')
  })

  it('builds the feishu-im source with credentials from the injected boundary', () => {
    const sources = buildExternalSources({
      config: VALID,
      loadFeishuCredentials: () => ({ appId: 'cli_a', appSecret: 'secret' }),
    })
    expect(sources.map((source) => source.id)).toEqual([FEISHU_IM_SOURCE_ID])
  })

  it('rejects enabled github-pr without its detail config', () => {
    expect(
      errorCodeOf(() =>
        buildExternalSources({ config: { enabled: [GITHUB_PR_SOURCE_ID] } }),
      ),
    ).toBe('sourceConfigInvalid')
  })

  it('rejects when the gh credential boundary returns no token', () => {
    expect(
      errorCodeOf(() =>
        buildExternalSources({ config: GITHUB, loadGithubToken: () => null }),
      ),
    ).toBe('sourceCredentialsMissing')
  })

  it('builds the github-pr source with the token from the injected boundary', () => {
    const sources = buildExternalSources({
      config: GITHUB,
      loadGithubToken: () => 'gho_token',
    })
    expect(sources.map((source) => source.id)).toEqual([GITHUB_PR_SOURCE_ID])
  })

  it('builds both configured sources side by side', () => {
    const sources = buildExternalSources({
      config: {
        enabled: [FEISHU_IM_SOURCE_ID, GITHUB_PR_SOURCE_ID],
        feishuIm: VALID.feishuIm,
        githubPr: GITHUB.githubPr,
      },
      loadFeishuCredentials: () => ({ appId: 'cli_a', appSecret: 'secret' }),
      loadGithubToken: () => 'gho_token',
    })
    expect(sources.map((source) => source.id)).toEqual([FEISHU_IM_SOURCE_ID, GITHUB_PR_SOURCE_ID])
  })
})
