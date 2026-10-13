// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { isAllowedFetchUrl, isAllowedFetchUrlAfterResolution, isPrivateIp } from '../h5FetchUrlValidator'

/**
 * The `/api/http/fetch` proxy's URL gate. The resolver is injected, so these
 * cases never touch real DNS — that is the seam the SSRF fix lives behind.
 *
 * The plain-literal refusals (loopback, private ranges, internal suffixes,
 * userinfo, non-http schemes) are already pinned by
 * `electron/__tests__/h5Server.fetch.test.ts`; this file adds what the
 * resolution step depends on.
 */
describe('isAllowedFetchUrl (what the resolver builds on)', () => {
  it.each([
    'http://2130706433/x',
    'http://0x7f000001/x',
  ])('refuses %s: the URL parser folds numeric hosts into IPv4 and the private answer is vetoed', (url) => {
    expect(isAllowedFetchUrl(url)).toBe(false)
  })

  it('refuses something that is not a URL at all', () => {
    expect(isAllowedFetchUrl('not a url')).toBe(false)
  })

  it('treats an IPv4-mapped IPv6 literal as the address it hides', () => {
    expect(isAllowedFetchUrl('http://[::ffff:7f00:1]/x')).toBe(false)
    expect(isPrivateIp('::ffff:1.2.3.4')).toBe(false)
    expect(isPrivateIp('fe80::1')).toBe(true)
    expect(isPrivateIp('fd00::1')).toBe(true)
    expect(isPrivateIp('100.64.0.1')).toBe(true)
  })
})

describe('isAllowedFetchUrlAfterResolution', () => {
  it('refuses a public name whose answer is internal', async () => {
    const resolver = vi.fn(async (): Promise<string[]> => ['127.0.0.1'])

    await expect(isAllowedFetchUrlAfterResolution('https://metadata.example/', resolver)).resolves.toBe(false)
  })

  it('refuses the cloud metadata address reached by name', async () => {
    const resolver = vi.fn(async (): Promise<string[]> => ['169.254.169.254'])

    await expect(isAllowedFetchUrlAfterResolution('http://evil.example/latest', resolver)).resolves.toBe(false)
  })

  it('refuses when any of several answers is internal', async () => {
    const resolver = vi.fn(async (): Promise<string[]> => ['93.184.216.34', '10.0.0.5'])

    await expect(isAllowedFetchUrlAfterResolution('https://multi.example/', resolver)).resolves.toBe(false)
  })

  it('allows a public name that answers publicly', async () => {
    const resolver = vi.fn(async (): Promise<string[]> => ['93.184.216.34'])

    await expect(isAllowedFetchUrlAfterResolution('https://example.com/models', resolver)).resolves.toBe(true)
    expect(resolver).toHaveBeenCalledWith('example.com')
  })

  it('refuses a name that resolves to nothing', async () => {
    const resolver = vi.fn(async (): Promise<string[]> => [])

    await expect(isAllowedFetchUrlAfterResolution('https://gone.example/', resolver)).resolves.toBe(false)
  })

  it('refuses when the lookup itself fails', async () => {
    const resolver = vi.fn(async (): Promise<string[]> => {
      throw new Error('ENOTFOUND')
    })

    await expect(isAllowedFetchUrlAfterResolution('https://broken.example/', resolver)).resolves.toBe(false)
  })

  it('does not resolve a host the literal check already rejected', async () => {
    const resolver = vi.fn(async (): Promise<string[]> => ['93.184.216.34'])

    await expect(isAllowedFetchUrlAfterResolution('http://localhost/x', resolver)).resolves.toBe(false)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('does not resolve an IP literal — there is nothing left to learn', async () => {
    const resolver = vi.fn(async (): Promise<string[]> => [])

    await expect(isAllowedFetchUrlAfterResolution('https://93.184.216.34/x', resolver)).resolves.toBe(true)
    await expect(isAllowedFetchUrlAfterResolution('https://127.0.0.1/x', resolver)).resolves.toBe(false)
    expect(resolver).not.toHaveBeenCalled()
  })
})
