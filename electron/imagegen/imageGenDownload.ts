/**
 * 不受信 HTTP 响应处理 —— 有界读取与「供应商给的 URL」的下载闸门。
 *
 * 供应商响应和它给出的 URL 一律按不受信输入处理（ADR 0019 决策 13）：
 *  - 响应体有界：先看 content-length，再在流上兜底，超限即中止读取，不吃满内存。
 *  - 下载 URL：拒非 http(s)、拒内嵌凭证、拒重定向、始终拒云元数据与内网地址；
 *    DNS 解析后校验全部地址，再钉定已校验的 IP 连接（防 DNS rebinding 的 TOCTOU）。
 *  - 下载请求不携带供应商凭证头：那是另一个域，凭证不该跟过去。
 *
 * 零 fs、零 electron：fetch 与 DNS 解析由参数注入，可独立测试。
 */
import { lookup } from 'dns/promises'
import { BlockList, isIP } from 'net'
import { Agent, buildConnector } from 'undici'

/** 单张图片字节上限：覆盖 4K 图，又高于 OpenAI 单图 25MB 的输入约束。 */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024
/** JSON 响应上限：要装得下单张最大图的 base64（约 4/3 倍）再加包装开销。 */
export const MAX_JSON_BYTES = 64 * 1024 * 1024

export type LookupImpl = (hostname: string) => Promise<Array<{ address: string; family: number }>>

/**
 * 有界读取响应体。content-length 超限先行拒绝（不读 body）；没有或撒谎时
 * 在流上逐块累计兜底，超限即取消流并抛错。
 */
export async function readBoundedBody(res: Response, cap: number): Promise<Buffer> {
  const declared = res.headers.get('content-length')
  if (declared !== null && Number(declared) > cap) {
    await res.body?.cancel()
    throw new Error(`Response body exceeds the ${cap} byte limit.`)
  }
  if (!res.body) return Buffer.alloc(0)

  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel().catch(() => {})
      throw new Error(`Response body exceeds the ${cap} byte limit.`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/**
 * 内网 / 环回 / 链路本地 / 云元数据地址一律拒绝。供应商给的 URL 可能指向
 * 169.254.169.254 这类元数据端点，或解析到内网 —— 那是 SSRF，不是图片下载。
 */
const BLOCKED = new BlockList()
BLOCKED.addSubnet('0.0.0.0', 8, 'ipv4') // 本网络
BLOCKED.addSubnet('10.0.0.0', 8, 'ipv4') // 私有
BLOCKED.addSubnet('100.64.0.0', 10, 'ipv4') // CGNAT（含阿里云元数据 100.100.100.200）
BLOCKED.addSubnet('127.0.0.0', 8, 'ipv4') // 环回
BLOCKED.addSubnet('169.254.0.0', 16, 'ipv4') // 链路本地（含 169.254.169.254 元数据）
BLOCKED.addSubnet('172.16.0.0', 12, 'ipv4') // 私有
BLOCKED.addSubnet('192.0.0.0', 24, 'ipv4') // IETF 协议分配
BLOCKED.addSubnet('192.0.2.0', 24, 'ipv4') // TEST-NET-1
BLOCKED.addSubnet('192.88.99.0', 24, 'ipv4') // 6to4 中继
BLOCKED.addSubnet('192.168.0.0', 16, 'ipv4') // 私有
BLOCKED.addSubnet('198.18.0.0', 15, 'ipv4') // 基准测试
BLOCKED.addSubnet('198.51.100.0', 24, 'ipv4') // TEST-NET-2
BLOCKED.addSubnet('203.0.113.0', 24, 'ipv4') // TEST-NET-3
BLOCKED.addSubnet('224.0.0.0', 4, 'ipv4') // 组播
BLOCKED.addSubnet('240.0.0.0', 4, 'ipv4') // 保留（含 255.255.255.255）
BLOCKED.addAddress('::', 'ipv6') // 未指定
BLOCKED.addAddress('::1', 'ipv6') // 环回
BLOCKED.addSubnet('fe80::', 10, 'ipv6') // 链路本地
BLOCKED.addSubnet('fc00::', 7, 'ipv6') // ULA（含 fd00:ec2::254 AWS IPv6 元数据）
BLOCKED.addSubnet('ff00::', 8, 'ipv6') // 组播
BLOCKED.addSubnet('64:ff9b::', 96, 'ipv6') // NAT64 well-known 前缀：内嵌 IPv4，可编码元数据地址
BLOCKED.addSubnet('2002::', 16, 'ipv6') // 6to4：内嵌 IPv4，可编码内网/元数据地址

const METADATA_HOSTS = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  'instance-data.ec2.internal',
])

/** IPv4-mapped IPv6（::ffff:127.0.0.1）要按 IPv4 判，否则能绕过 v4 黑名单。 */
export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(address)
  if (mapped) return BLOCKED.check(mapped[1], 'ipv4')
  const family = isIP(address)
  if (family === 4) return BLOCKED.check(address, 'ipv4')
  if (family === 6) return BLOCKED.check(address, 'ipv6')
  return true // 不是合法 IP 字面量：保守拒绝
}

/** URL.hostname 对 IPv6 带方括号、对 FQDN 可能带尾点；判定前都剥掉（尾点与无尾点解析等价）。 */
function bareHost(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '')
}

/** 校验下载 URL 的协议、凭证与字面量地址；DNS 解析后的地址校验在下载时做。 */
export function validateDownloadUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('Image download URL is not a valid URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Image download URL must use http or https.')
  }
  if (url.username || url.password) {
    throw new Error('Image download URL must not embed credentials.')
  }
  const host = bareHost(url.hostname)
  if (METADATA_HOSTS.has(host)) {
    throw new Error('Image download URL points at a cloud metadata endpoint.')
  }
  if (isIP(host) && isBlockedAddress(host)) {
    throw new Error('Image download URL points at a blocked address.')
  }
  return url
}

const defaultLookup: LookupImpl = async hostname => {
  const records = await lookup(hostname, { all: true, verbatim: true })
  return records.map(record => ({ address: record.address, family: record.family }))
}

/**
 * 钉定连接器：TCP 连到已校验的 address，但 TLS SNI 与 Host 头仍是原 hostname。
 * 这样既消除「校验后再解析」的 TOCTOU（DNS rebinding），又不破坏证书校验。
 */
export function pinnedDispatcher(hostname: string, address: string): Agent {
  const connect = buildConnector({})
  return new Agent({
    connect: (opts, cb) => connect({ ...opts, hostname: address, host: address, servername: hostname }, cb),
  })
}

export interface DownloadOptions {
  signal: AbortSignal
  fetchImpl: typeof fetch
  lookupImpl?: LookupImpl
}

/** 把 promise 纳入 signal：signal 中止即拒绝，避免 DNS 等不受 fetch 超时约束的步骤挂死。 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error('Image download aborted.'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error('Image download aborted.'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      err => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

/** 下载供应商给的图片 URL：校验 → 解析并校验全部地址 → 钉定连接 → 有界读取。 */
export async function downloadImage(rawUrl: string, options: DownloadOptions): Promise<Buffer> {
  const { signal, fetchImpl, lookupImpl = defaultLookup } = options
  const url = validateDownloadUrl(rawUrl)
  const host = bareHost(url.hostname)

  let address: string
  if (isIP(host)) {
    address = host // 字面量已在 validateDownloadUrl 校验
  } else {
    // DNS 也可能挂死：纳入同一个 signal 超时，否则恶意解析器能把这次调用永久挂起。
    const records = await raceAbort(lookupImpl(host), signal)
    if (records.length === 0) throw new Error('Image download host did not resolve.')
    for (const record of records) {
      if (isBlockedAddress(record.address)) {
        throw new Error('Image download host resolved to a blocked address.')
      }
    }
    address = records[0].address
  }

  const dispatcher = pinnedDispatcher(url.hostname, address)
  try {
    const init: RequestInit & { dispatcher: Agent } = { signal, redirect: 'error', dispatcher }
    const res = await fetchImpl(rawUrl, init)
    if (res.status >= 300 && res.status < 400) {
      throw new Error(`Image download refused a redirect (HTTP ${res.status}).`)
    }
    if (!res.ok) throw new Error(`Failed to download generated image (HTTP ${res.status}).`)
    return await readBoundedBody(res, MAX_IMAGE_BYTES)
  } finally {
    await dispatcher.close()
  }
}