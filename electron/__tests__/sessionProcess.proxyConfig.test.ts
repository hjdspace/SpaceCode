/**
 * SessionProcess.buildProxyConfig 按需兜底启动代理的配置来源测试。
 *
 * 兜底路径必须从 ~/.claude/gui-settings.json 构建配置（与 reconcileProxyWithSettings
 * 等主动启动路径共用 buildProxyConfigFromSettings），不能从 SessionConfig 生成：
 * config.model 是别名（haiku/sonnet/opus），直接写进 modelMapping 会把别名当
 * 实际模型名转发给上游。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  guiSettingsJson: null as string | null,
}))

// 仅代理 gui-settings.json 的读取，其余 fs 调用透传真实实现
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return {
    ...actual,
    existsSync: (p: unknown) =>
      typeof p === 'string' && p.endsWith('gui-settings.json')
        ? mocks.guiSettingsJson !== null
        : actual.existsSync(p as never),
    readFileSync: (p: unknown, ...rest: unknown[]) =>
      typeof p === 'string' && p.endsWith('gui-settings.json')
        ? (mocks.guiSettingsJson ?? (actual.readFileSync as (...a: unknown[]) => string)(p, ...rest))
        : (actual.readFileSync as (...a: unknown[]) => string)(p, ...rest),
  }
})

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/tmp/spacecode-test-userdata'
      return '/tmp'
    }),
  },
}))

import { SessionProcess, SessionConfig } from '../sessionProcess'

function makeSessionConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    cwd: '/tmp',
    permissionMode: 'default',
    ...overrides,
  }
}

describe('SessionProcess.buildProxyConfig — on-demand fallback', () => {
  let proc: SessionProcess

  beforeEach(() => {
    mocks.guiSettingsJson = null
    proc = new SessionProcess('sess-proxy-fallback', makeSessionConfig({
      provider: 'openai',
      model: 'sonnet',
    }))
  })

  afterEach(() => {
    mocks.guiSettingsJson = null
    proc.removeAllListeners()
  })

  it('builds the mapping from gui-settings.json slot models, not the session alias', () => {
    mocks.guiSettingsJson = JSON.stringify({
      authMethod: 'openai_compatible',
      openaiConfig: {
        baseUrl: 'https://api.example/v1',
        apiKey: 'sk-test',
        haikuModel: 'kimi-k3-flash',
        sonnetModel: 'kimi-k3',
        opusModel: 'kimi-k3-pro',
      },
    })

    const cfg = (proc as any).buildProxyConfig()

    // config.model 是别名 'sonnet'，不能被当作实际模型名写进映射
    expect(cfg.upstreamProvider).toBe('openai_compatible')
    expect(cfg.upstreamBaseUrl).toBe('https://api.example/v1')
    expect(cfg.upstreamApiKey).toBe('sk-test')
    expect(cfg.modelMapping.haikuModel).toBe('kimi-k3-flash')
    expect(cfg.modelMapping.sonnetModel).toBe('kimi-k3')
    expect(cfg.modelMapping.opusModel).toBe('kimi-k3-pro')
    expect(cfg.modelMapping.defaultModel).toBe('kimi-k3')
  })

  it('returns null when gui-settings.json is missing', () => {
    expect((proc as any).buildProxyConfig()).toBeNull()
  })

  it('returns null when the settings lack provider credentials', () => {
    mocks.guiSettingsJson = JSON.stringify({
      authMethod: 'openai_compatible',
      openaiConfig: { baseUrl: '', apiKey: '' },
    })

    expect((proc as any).buildProxyConfig()).toBeNull()
  })
})
