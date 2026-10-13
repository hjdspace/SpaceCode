// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { redactSecretsInJson } from '../h5ConfigRedactor'

/**
 * What the H5 server may hand out of `~/.claude/gui-settings.json`: the same
 * document, minus anything that reads like a credential.
 */
describe('redactSecretsInJson', () => {
  function redact(value: unknown): unknown {
    const out = redactSecretsInJson(JSON.stringify(value))

    return out === null ? out : JSON.parse(out)
  }

  it('keeps a credential-free document as it was', () => {
    const settings = { authMethod: 'anthropic_compatible', model: 'sonnet', pet: { nickname: 'Bo' } }

    expect(redact(settings)).toEqual(settings)
  })

  it.each([
    'apiKey',
    'api_key',
    'APIKEY',
    'anthropicApiKey',
    'accessKey',
    'authToken',
    'token',
    'clientSecret',
    'password',
    'privateKey',
    'credentials',
    'bearer',
    'authorization',
  ])('drops the credential field %s wherever it sits', (key) => {
    const out = redact({ anthropicConfig: { baseUrl: 'https://x.test', [key]: 'sk-live' } }) as {
      anthropicConfig: Record<string, unknown>
    }

    expect(out.anthropicConfig).toEqual({ baseUrl: 'https://x.test' })
  })

  it('leaves a lookalike setting alone', () => {
    const settings = { theme: 'dark', modelNames: ['sonnet'], lastSyncAt: 1_700_000_000 }

    expect(redact(settings)).toEqual(settings)
  })

  it('walks arrays of provider profiles too', () => {
    const out = redact({ profiles: [{ name: 'work', apiKey: 'a' }, { name: 'home', apiKey: 'b' }] }) as {
      profiles: Array<Record<string, unknown>>
    }

    expect(out.profiles).toEqual([{ name: 'work' }, { name: 'home' }])
  })

  it('drops a subtree deeper than the walk goes instead of guessing', () => {
    let deep: Record<string, unknown> = { apiKey: 'bottom' }
    for (let i = 0; i < 12; i += 1) deep = { nest: deep }

    expect(JSON.stringify(redact(deep))).not.toContain('bottom')
  })

  it('answers null for a document it cannot parse', () => {
    // Fail closed: an uninspectable file is not forwarded.
    expect(redactSecretsInJson('{oops')).toBeNull()
    expect(redactSecretsInJson('')).toBeNull()
  })

  it('handles a scalar document', () => {
    expect(redactSecretsInJson('"just a string"')).toBe('"just a string"')
    expect(redactSecretsInJson('null')).toBe('null')
  })
})
