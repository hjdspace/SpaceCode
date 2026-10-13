// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ProxyConfig } from '../../proxy/types'

/**
 * GUI settings → proxy config, the one mapping every start path shares (startup
 * auto-start, engineSource switch, settings-save reconcile in `settingsIpc`, and
 * `sessionProcess`'s on-demand fallback). A divergence here does not crash — it
 * silently points every outbound AI request at the wrong upstream dialect or the
 * wrong model, so each branch is pinned as a value, not as "did not throw".
 *
 * Contract under test:
 *   - `authMethod` picks *both* the settings block and the upstream dialect;
 *     `gemini_api` speaks OpenAI, the three Anthropic-ish methods speak
 *     Anthropic. A method with no matching block yields null (= no proxy).
 *   - Missing base URL or API key fails closed: a half-configured proxy would
 *     swallow traffic it cannot serve. Trimming happens *before* that check, so
 *     a whitespace-only key counts as absent.
 *   - `defaultModel` mirrors `sonnetModel` — the engine's unqualified request is
 *     a sonnet-class request; a config with only haiku/opus has no default.
 *   - host/port are constants; the GUI has no say.
 */

vi.mock('child_process', async () => {
  const kit = await import('./proxyTestKit')
  return { spawn: kit.fakeSpawn }
})

vi.mock('net', async () => {
  const kit = await import('./proxyTestKit')
  return { createServer: kit.fakeCreateServer }
})

vi.mock('http', async () => {
  const kit = await import('./proxyTestKit')
  return { get: kit.fakeHttpGet }
})

vi.mock('fs', async () => {
  const kit = await import('./proxyTestKit')
  return { existsSync: kit.fakeExistsSync }
})

vi.mock('electron', async () => {
  const kit = await import('./proxyTestKit')
  return {
    app: {
      get isPackaged() {
        return kit.appState.isPackaged
      },
      getPath: () => kit.appState.userData,
    },
  }
})

// `logger.ts` sits one level up — `./logger` would resolve inside __tests__ and
// silently miss the real module, letting the genuine logger write to disk.
vi.mock('../logger', async () => {
  const kit = await import('./proxyTestKit')
  return kit.loggerState
})

const { buildProxyConfigFromSettings } = await import('../proxyManager')

const BASE = {
  host: '127.0.0.1',
  port: 34567,
}

function openai(settings: Record<string, unknown>): Record<string, unknown> {
  return { authMethod: 'openai_compatible', openaiConfig: settings }
}

describe('buildProxyConfigFromSettings — fails closed', () => {
  it('has no proxy at all when no auth method is selected', () => {
    expect(buildProxyConfigFromSettings({})).toBeNull()
    expect(buildProxyConfigFromSettings({ authMethod: '' })).toBeNull()
  })

  it('ignores a fully populated provider block that the auth method does not name', () => {
    // sessionProcess builds this from a SessionConfig, where provider and
    // authMethod can disagree — the auth method wins, and disagreement means no proxy.
    const settings = { authMethod: 'openai_compatible', geminiConfig: { baseUrl: 'https://g.test/v1', apiKey: 'g-key' } }
    expect(buildProxyConfigFromSettings(settings)).toBeNull()
  })

  it('returns null for the auth method itself when its settings block is absent', () => {
    expect(buildProxyConfigFromSettings({ authMethod: 'openai_compatible' })).toBeNull()
    expect(buildProxyConfigFromSettings({ authMethod: 'gemini_api' })).toBeNull()
    expect(buildProxyConfigFromSettings({ authMethod: 'anthropic_compatible' })).toBeNull()
    expect(buildProxyConfigFromSettings({ authMethod: 'claudeai' })).toBeNull()
    expect(buildProxyConfigFromSettings({ authMethod: 'console' })).toBeNull()
  })

  it('returns null for an auth method it does not know even with a block present', () => {
    const settings = { authMethod: 'oauth', anthropicConfig: { baseUrl: 'https://a.test', apiKey: 'k' } }
    expect(buildProxyConfigFromSettings(settings)).toBeNull()
  })

  it('refuses a base URL that is missing, empty or only spaces', () => {
    for (const baseUrl of [undefined, '', '   ']) {
      expect(buildProxyConfigFromSettings(openai({ baseUrl, apiKey: 'real-key' }))).toBeNull()
    }
  })

  it('refuses an API key that is missing, empty or only spaces', () => {
    for (const apiKey of [undefined, '', '  \t ']) {
      expect(buildProxyConfigFromSettings(openai({ baseUrl: 'https://o.test/v1', apiKey }))).toBeNull()
    }
  })

  it('checks the trimmed values, so a padded-but-empty credential still fails closed', () => {
    const config = buildProxyConfigFromSettings(openai({ baseUrl: ' https://o.test/v1 ', apiKey: '   sk-live ' }))
    expect(config).not.toBeNull()
    expect(config?.upstreamBaseUrl).toBe('https://o.test/v1')
    expect(config?.upstreamApiKey).toBe('sk-live')
  })

  it.each(['anthropic_compatible', 'claudeai', 'console'] as const)(
    'refuses %s without a base URL or a key, even though the app never proxies those',
    (authMethod) => {
      expect(buildProxyConfigFromSettings({ authMethod, anthropicConfig: { baseUrl: '', apiKey: 'k' } })).toBeNull()
      expect(buildProxyConfigFromSettings({ authMethod, anthropicConfig: { baseUrl: 'https://a.test', apiKey: '' } })).toBeNull()
    },
  )

  it('throws instead of degrading when a credential is not a string', () => {
    // A settings file edited by hand (or by an older renderer) can hold a number;
    // `.trim()` then blows up inside the IPC handler that calls this.
    expect(() => buildProxyConfigFromSettings(openai({ baseUrl: 4200, apiKey: 'k' }))).toThrow(TypeError)
    expect(() => buildProxyConfigFromSettings(openai({ baseUrl: 'https://o.test', apiKey: 7 }))).toThrow(TypeError)
  })
})

describe('buildProxyConfigFromSettings — authMethod picks the upstream dialect', () => {
  const models = { haikuModel: 'small-k', sonnetModel: 'mid-k', opusModel: 'big-k' }

  it('maps openai_compatible onto the openai_compatible adapter', () => {
    const config = buildProxyConfigFromSettings(openai({ baseUrl: 'https://o.test/v1', apiKey: 'o-key', ...models }))
    expect(config).toEqual({
      ...BASE,
      upstreamProvider: 'openai_compatible',
      upstreamBaseUrl: 'https://o.test/v1',
      upstreamApiKey: 'o-key',
      modelMapping: { haikuModel: 'small-k', sonnetModel: 'mid-k', opusModel: 'big-k', defaultModel: 'mid-k' },
    })
  })

  it('maps gemini_api onto openai_compatible, not onto a gemini adapter', () => {
    const config = buildProxyConfigFromSettings({
      authMethod: 'gemini_api',
      geminiConfig: { baseUrl: 'https://generativelanguage.test/v1beta/openai', apiKey: 'g-key', sonnetModel: 'gemini-2.5-pro' },
    })
    expect(config).toEqual({
      ...BASE,
      upstreamProvider: 'openai_compatible',
      upstreamBaseUrl: 'https://generativelanguage.test/v1beta/openai',
      upstreamApiKey: 'g-key',
      modelMapping: { sonnetModel: 'gemini-2.5-pro', defaultModel: 'gemini-2.5-pro' },
    })
  })

  it.each(['anthropic_compatible', 'claudeai', 'console'] as const)(
    'maps %s onto the anthropic adapter reading anthropicConfig',
    (authMethod) => {
      const config = buildProxyConfigFromSettings({
        authMethod,
        anthropicConfig: { baseUrl: 'https://api.anthropic.test', apiKey: 'a-key', haikuModel: 'claude-haiku-4' },
      })
      expect(config).toEqual({
        ...BASE,
        upstreamProvider: 'anthropic',
        upstreamBaseUrl: 'https://api.anthropic.test',
        upstreamApiKey: 'a-key',
        modelMapping: { haikuModel: 'claude-haiku-4' },
      })
    },
  )

  it('prefers the block named by authMethod when several blocks are filled in', () => {
    const config = buildProxyConfigFromSettings({
      authMethod: 'openai_compatible',
      openaiConfig: { baseUrl: 'https://o.test/v1', apiKey: 'o-key' },
      geminiConfig: { baseUrl: 'https://g.test/v1', apiKey: 'g-key' },
      anthropicConfig: { baseUrl: 'https://a.test', apiKey: 'a-key' },
    })
    expect(config?.upstreamBaseUrl).toBe('https://o.test/v1')
    expect(config?.upstreamApiKey).toBe('o-key')
  })

  it('keeps a provider whose credentials are usable even when another block is broken', () => {
    const config = buildProxyConfigFromSettings({
      authMethod: 'gemini_api',
      geminiConfig: { baseUrl: 'https://g.test/v1', apiKey: 'g-key' },
      openaiConfig: { baseUrl: '', apiKey: '' },
    })
    expect(config?.upstreamProvider).toBe('openai_compatible')
    expect(config?.upstreamBaseUrl).toBe('https://g.test/v1')
  })

  it('maps all three anthropic slots and mirrors sonnet as the default', () => {
    const config = buildProxyConfigFromSettings({
      authMethod: 'anthropic_compatible',
      anthropicConfig: { baseUrl: 'https://a.test', apiKey: 'a-key', haikuModel: 'ah', sonnetModel: 'as', opusModel: 'ao' },
    })
    expect(config?.modelMapping).toEqual({ haikuModel: 'ah', sonnetModel: 'as', opusModel: 'ao', defaultModel: 'as' })
  })

  it('still answers null for a gemini or anthropic block with every field missing', () => {
    expect(buildProxyConfigFromSettings({ authMethod: 'gemini_api', geminiConfig: {} })).toBeNull()
    expect(buildProxyConfigFromSettings({ authMethod: 'console', anthropicConfig: {} })).toBeNull()
  })
})

describe('buildProxyConfigFromSettings — model mapping', () => {
  it('sends no model mapping keys when the slots were left blank', () => {
    const config = buildProxyConfigFromSettings(openai({ baseUrl: 'https://o.test/v1', apiKey: 'o-key' }))
    expect(config?.modelMapping).toEqual({})
  })

  it('fills every gemini slot and mirrors sonnet as the default', () => {
    const config = buildProxyConfigFromSettings({
      authMethod: 'gemini_api',
      geminiConfig: { baseUrl: 'https://g.test/v1', apiKey: 'g-key', haikuModel: 'gh', sonnetModel: 'gs', opusModel: 'go' },
    })
    expect(config?.modelMapping).toEqual({ haikuModel: 'gh', sonnetModel: 'gs', opusModel: 'go', defaultModel: 'gs' })
  })

  it('omits defaultModel when only haiku and opus are set, so the proxy cannot name a default', () => {
    const config = buildProxyConfigFromSettings(openai({ baseUrl: 'https://o.test/v1', apiKey: 'o-key', haikuModel: 'h', opusModel: 'o' }))
    expect(config?.modelMapping).toEqual({ haikuModel: 'h', opusModel: 'o' })
    expect(config?.modelMapping).not.toHaveProperty('defaultModel')
  })

  it('treats sonnet as the default model for every provider block', () => {
    for (const settings of [
      { authMethod: 'openai_compatible', openaiConfig: { baseUrl: 'https://o.test', apiKey: 'k', sonnetModel: ' s-1 ' } },
      { authMethod: 'gemini_api', geminiConfig: { baseUrl: 'https://o.test', apiKey: 'k', sonnetModel: ' s-1 ' } },
      { authMethod: 'claudeai', anthropicConfig: { baseUrl: 'https://o.test', apiKey: 'k', sonnetModel: ' s-1 ' } },
    ]) {
      expect(buildProxyConfigFromSettings(settings)?.modelMapping).toEqual({ sonnetModel: 's-1', defaultModel: 's-1' })
    }
  })

  it('writes a whitespace-only model as an empty string rather than dropping the key', () => {
    // modelMapper treats an empty mapping as absent (it checks truthiness), so the
    // traffic still falls through — but the key exists, and a consumer doing
    // `'haikuModel' in mapping` would read it as configured.
    const config = buildProxyConfigFromSettings(openai({ baseUrl: 'https://o.test/v1', apiKey: 'o-key', haikuModel: '   ', opusModel: '' }))
    expect(config?.modelMapping).toEqual({ haikuModel: '' })
  })

  it('throws when a model slot holds a non-string, same as the credential fields', () => {
    expect(() => buildProxyConfigFromSettings(openai({ baseUrl: 'https://o.test/v1', apiKey: 'o-key', sonnetModel: 5 }))).toThrow(TypeError)
  })
})

describe('buildProxyConfigFromSettings — listen address is fixed', () => {
  it('always binds loopback on 34567 whatever the settings claim', () => {
    const config = buildProxyConfigFromSettings({
      ...openai({ baseUrl: 'https://o.test/v1', apiKey: 'o-key' }),
      host: '0.0.0.0',
      port: 8080,
      proxyPort: 9999,
    }) as ProxyConfig
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(34567)
  })
})
