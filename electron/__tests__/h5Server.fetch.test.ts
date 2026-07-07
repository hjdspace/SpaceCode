// electron/__tests__/h5Server.fetch.test.ts
import { describe, it, expect } from 'vitest'
import { isAllowedFetchUrl } from '../h5FetchUrlValidator'

describe('h5Server proxyHttpFetch URL validation', () => {
  it('allows public http and https URLs', () => {
    expect(isAllowedFetchUrl('https://example.com/api')).toBe(true)
    expect(isAllowedFetchUrl('http://example.com/api')).toBe(true)
    expect(isAllowedFetchUrl('https://api.openai.com/v1/models')).toBe(true)
  })

  it('blocks localhost', () => {
    expect(isAllowedFetchUrl('http://localhost:3000/api')).toBe(false)
    expect(isAllowedFetchUrl('https://localhost/')).toBe(false)
  })

  it('blocks loopback IPv4 addresses', () => {
    expect(isAllowedFetchUrl('http://127.0.0.1:3000/api')).toBe(false)
    expect(isAllowedFetchUrl('http://127.0.0.1/')).toBe(false)
  })

  it('blocks private IPv4 ranges', () => {
    expect(isAllowedFetchUrl('http://10.0.0.1/')).toBe(false)
    expect(isAllowedFetchUrl('http://172.16.0.1/')).toBe(false)
    expect(isAllowedFetchUrl('http://172.31.255.255/')).toBe(false)
    expect(isAllowedFetchUrl('http://192.168.1.1/')).toBe(false)
  })

  it('blocks link-local IPv4 addresses', () => {
    expect(isAllowedFetchUrl('http://169.254.1.1/')).toBe(false)
  })

  it('blocks loopback and link-local IPv6 addresses', () => {
    expect(isAllowedFetchUrl('http://[::1]/')).toBe(false)
    expect(isAllowedFetchUrl('http://[fe80::1]/')).toBe(false)
    expect(isAllowedFetchUrl('http://[fc00::1]/')).toBe(false)
  })

  it('blocks IPv4-mapped IPv6 loopback addresses', () => {
    expect(isAllowedFetchUrl('http://[::ffff:127.0.0.1]/')).toBe(false)
  })

  it('blocks local and internal hostnames', () => {
    expect(isAllowedFetchUrl('http://foo.local/')).toBe(false)
    expect(isAllowedFetchUrl('http://server.internal/')).toBe(false)
    expect(isAllowedFetchUrl('http://server.corp/')).toBe(false)
    expect(isAllowedFetchUrl('http://server.home/')).toBe(false)
    expect(isAllowedFetchUrl('http://server.lan/')).toBe(false)
    expect(isAllowedFetchUrl('http://server.private/')).toBe(false)
    expect(isAllowedFetchUrl('http://server.intranet/')).toBe(false)
  })

  it('blocks URLs with credentials', () => {
    expect(isAllowedFetchUrl('http://user:pass@example.com/')).toBe(false)
  })

  it('blocks non-http protocols', () => {
    expect(isAllowedFetchUrl('ftp://example.com/')).toBe(false)
    expect(isAllowedFetchUrl('file:///etc/passwd')).toBe(false)
  })

  it('blocks malformed URLs', () => {
    expect(isAllowedFetchUrl('not-a-url')).toBe(false)
  })
})
