// electron/h5FetchUrlValidator.ts
// URL 安全校验：阻止代理接口访问内网与敏感资源

import { isIP, isIPv4, isIPv6 } from 'net'
import { promises as dns } from 'dns'

export type HostResolver = (hostname: string) => Promise<string[]>

const systemResolver: HostResolver = async (hostname) => {
  const entries = await dns.lookup(hostname, { all: true, verbatim: true })
  return entries.map((entry) => entry.address)
}

function ipv4MappedToIp(ip: string): string | null {
  const tail = ip.slice(7)
  if (isIPv4(tail)) return tail
  const parts = tail.split(':')
  if (parts.length === 2) {
    const high = parseInt(parts[0], 16)
    const low = parseInt(parts[1], 16)
    if (Number.isNaN(high) || Number.isNaN(low)) return null
    return `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`
  }
  return null
}

export function isPrivateIp(ip: string): boolean {
  if (isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number)
    if (a === 127) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 0) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 192 && b === 0 && c === 0) return true
    if (a === 192 && b === 0 && c === 2) return true
    if (a === 198 && b >= 18 && b <= 19) return true
    if (a === 198 && b === 51 && c === 100) return true
    if (a === 203 && b === 0 && c === 113) return true
    if (a >= 224 && a <= 239) return true
    if (a >= 240) return true
    return false
  }

  if (isIPv6(ip)) {
    const normalized = ip.toLowerCase()
    if (normalized === '::1' || normalized === '::') return true
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true
    if (normalized.startsWith('::ffff:')) {
      const mapped = ipv4MappedToIp(normalized)
      return mapped ? isPrivateIp(mapped) : false
    }
    return false
  }

  return false
}

function isInternalHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true
  if (lower.endsWith('.local')) return true
  if (/^\d+$/.test(lower)) return true
  const ipLike = lower.replace(/\.[^.]+$/, '')
  if (isIP(ipLike) !== 0) return true
  const internalSuffixes = ['.internal', '.corp', '.home', '.lan', '.private', '.intranet']
  if (internalSuffixes.some(suffix => lower.endsWith(suffix))) return true
  return false
}

export function isAllowedFetchUrl(targetUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  if (parsed.username || parsed.password) return false
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname) !== 0) {
    return !isPrivateIp(hostname)
  }
  return !isInternalHostname(hostname)
}

/**
 * The literal check above only sees the hostname as written; a public name can
 * still point at an internal address (a crafted A record, or DNS rebinding), so
 * the resolved addresses are vetted as well. A name that resolves to nothing is
 * refused rather than handed to the upstream stack to resolve a second time.
 */
export async function isAllowedFetchUrlAfterResolution(
  targetUrl: string,
  resolveHost: HostResolver = systemResolver,
): Promise<boolean> {
  if (!isAllowedFetchUrl(targetUrl)) return false

  const hostname = new URL(targetUrl).hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname) !== 0) return true

  let addresses: string[]
  try {
    addresses = await resolveHost(hostname)
  } catch {
    return false
  }

  return addresses.length > 0 && !addresses.some(isPrivateIp)
}
