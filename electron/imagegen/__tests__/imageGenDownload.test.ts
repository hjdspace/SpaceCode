// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createServer } from 'http'
import { AddressInfo } from 'net'
import { downloadImage, isBlockedAddress, MAX_IMAGE_BYTES, pinnedDispatcher, readBoundedBody, validateDownloadUrl } from '../imageGenDownload'

/** 带读取计数的流，用来断言「超限即中止读取」而不是把整个 body 吃进内存。 */
function countingStream(chunkSize: number, chunks: number) {
  let pulls = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1
      if (pulls > chunks) {
        controller.close()
        return
      }
      controller.enqueue(new Uint8Array(chunkSize).fill(0x61))
    },
  })
  return { stream, pulls: () => pulls }
}

describe('readBoundedBody', () => {
  it('content-length 超限时先行拒绝，且不读取 body', async () => {
    const { stream, pulls } = countingStream(4, 100)
    const res = new Response(stream, { headers: { 'content-length': '1000' } })

    await expect(readBoundedBody(res, 10)).rejects.toThrow(/limit/i)
    expect(pulls()).toBe(0)
  })

  it('content-length 在限内时正常读完', async () => {
    const res = new Response('hello', { headers: { 'content-length': '5' } })
    const bytes = await readBoundedBody(res, 10)
    expect(bytes.toString()).toBe('hello')
  })

  it('没有 content-length 时在流上兜底：超限中止，读取有界', async () => {
    const { stream, pulls } = countingStream(8, 1000)
    const res = new Response(stream)

    await expect(readBoundedBody(res, 10)).rejects.toThrow(/limit/i)
    // 8 字节/块，上限 10：读到第 2 块（16 字节）即中止，不会拉完 1000 块。
    expect(pulls()).toBeLessThanOrEqual(3)
  })

  it('无 content-length 且未超限时读完全部字节', async () => {
    const { stream } = countingStream(4, 2)
    const res = new Response(stream)
    const bytes = await readBoundedBody(res, 100)
    expect(bytes.length).toBe(8)
  })
})

describe('validateDownloadUrl', () => {
  it('普通 https URL 放行', () => {
    expect(validateDownloadUrl('https://cdn.example.com/a.png').hostname).toBe('cdn.example.com')
  })

  it('拒绝非 http(s) 协议', () => {
    for (const url of ['ftp://host/a.png', 'file:///etc/passwd', 'data:image/png;base64,AA==', 'gopher://host/']) {
      expect(() => validateDownloadUrl(url)).toThrow(/http/i)
    }
  })

  it('拒绝 URL 内嵌凭证', () => {
    expect(() => validateDownloadUrl('https://user:pass@cdn.example.com/a.png')).toThrow(/credential/i)
    expect(() => validateDownloadUrl('https://user@cdn.example.com/a.png')).toThrow(/credential/i)
  })

  it('拒绝云元数据主机名', () => {
    for (const host of ['metadata.google.internal', 'metadata.goog', 'metadata', 'instance-data']) {
      expect(() => validateDownloadUrl(`http://${host}/latest/meta-data/`)).toThrow(/metadata/i)
    }
  })

  it('拒绝字面量内网/环回/链路本地/元数据 IP（含 IPv6）', () => {
    const blocked = [
      'http://169.254.169.254/latest/meta-data/', // AWS/Azure/GCP 元数据
      'http://100.100.100.200/latest/meta-data/', // 阿里云元数据
      'http://127.0.0.1/a.png',
      'http://10.0.0.1/a.png',
      'http://192.168.1.1/a.png',
      'http://172.16.0.1/a.png',
      'http://[::1]/a.png',
      'http://[fd00:ec2::254]/latest/meta-data/', // AWS IPv6 元数据
      'http://[fe80::1]/a.png',
    ]
    for (const url of blocked) {
      expect(() => validateDownloadUrl(url)).toThrow(/blocked|metadata/i)
    }
  })

  it('拒绝内嵌 IPv4 的 IPv6 过渡地址（NAT64 / 6to4 编码元数据 169.254.169.254）', () => {
    for (const url of ['http://[64:ff9b::a9fe:a9fe]/latest/meta-data/', 'http://[2002:a9fe:a9fe::]/latest/meta-data/']) {
      expect(() => validateDownloadUrl(url)).toThrow(/blocked|metadata/i)
    }
  })

  it('拒绝带尾点的元数据主机名（DNS 尾点与无尾点等价）', () => {
    expect(() => validateDownloadUrl('http://metadata.google.internal./latest/meta-data/')).toThrow(/metadata/i)
  })

  it('字面量公网 IP 放行', () => {
    expect(validateDownloadUrl('https://8.8.8.8/a.png').hostname).toBe('8.8.8.8')
  })

  it('非法 URL 拒绝', () => {
    expect(() => validateDownloadUrl('not a url')).toThrow()
  })
})

describe('isBlockedAddress', () => {
  it('IPv4-mapped IPv6 按内嵌的 IPv4 判定，不能绕过 v4 黑名单', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false)
  })

  it('不是合法 IP 字面量时保守拒绝', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(true)
  })
})

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])

function fakeFetch(responses: Array<Response | (() => Response)>): typeof fetch {
  let call = 0
  return vi.fn(async () => {
    const next = responses[Math.min(call, responses.length - 1)]
    call += 1
    return typeof next === 'function' ? next() : next
  }) as unknown as typeof fetch
}

function calls(fetchImpl: typeof fetch): Array<[string, RequestInit]> {
  return (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown as Array<[string, RequestInit]>
}

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]
const signal = AbortSignal.timeout(5000)

describe('downloadImage', () => {
  it('DNS 解析到内网/元数据地址 → 拒绝，且不发请求', async () => {
    for (const address of ['127.0.0.1', '169.254.169.254', '10.1.2.3', 'fd00:ec2::254']) {
      const fetchImpl = fakeFetch([new Response(PNG_BYTES)])
      const lookupImpl = async () => [{ address, family: address.includes(':') ? 6 : 4 }]
      await expect(downloadImage('https://cdn.example.com/a.png', { signal, fetchImpl, lookupImpl })).rejects.toThrow(/blocked/i)
      expect(calls(fetchImpl)).toHaveLength(0)
    }
  })

  it('多条 DNS 记录里只要有一条内网就拒绝（防 rebinding 混入）', async () => {
    const fetchImpl = fakeFetch([new Response(PNG_BYTES)])
    const lookupImpl = async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]
    await expect(downloadImage('https://cdn.example.com/a.png', { signal, fetchImpl, lookupImpl })).rejects.toThrow(/blocked/i)
    expect(calls(fetchImpl)).toHaveLength(0)
  })

  it('DNS 空结果 → 拒绝', async () => {
    const fetchImpl = fakeFetch([new Response(PNG_BYTES)])
    await expect(downloadImage('https://cdn.example.com/a.png', { signal, fetchImpl, lookupImpl: async () => [] })).rejects.toThrow()
    expect(calls(fetchImpl)).toHaveLength(0)
  })

  it('DNS 解析挂死时受 signal 超时约束，不永久挂起这次调用', async () => {
    const fetchImpl = fakeFetch([new Response(PNG_BYTES)])
    const hangingLookup = () => new Promise<Array<{ address: string; family: number }>>(() => {})
    const shortSignal = AbortSignal.timeout(50)
    await expect(
      downloadImage('https://cdn.example.com/a.png', { signal: shortSignal, fetchImpl, lookupImpl: hangingLookup }),
    ).rejects.toThrow()
    expect(calls(fetchImpl)).toHaveLength(0)
  }, 2000)

  it('公网地址 → 下载字节，请求拒重定向、不带凭证头、带钉定 dispatcher', async () => {
    const fetchImpl = fakeFetch([new Response(PNG_BYTES, { status: 200 })])
    const bytes = await downloadImage('https://cdn.example.com/a.png', { signal, fetchImpl, lookupImpl: publicLookup })

    expect(bytes.equals(PNG_BYTES)).toBe(true)
    const [url, init] = calls(fetchImpl)[0]
    expect(url).toBe('https://cdn.example.com/a.png')
    expect(init.redirect).toBe('error')
    expect((init.headers ?? {}) as Record<string, string>).not.toHaveProperty('Authorization')
    expect((init as { dispatcher?: unknown }).dispatcher).toBeDefined()
  })

  it('字面量内网 IP 在 DNS 之前就被拒', async () => {
    const fetchImpl = fakeFetch([new Response(PNG_BYTES)])
    const lookupImpl = vi.fn(publicLookup)
    await expect(downloadImage('http://169.254.169.254/a.png', { signal, fetchImpl, lookupImpl })).rejects.toThrow()
    expect(lookupImpl).not.toHaveBeenCalled()
    expect(calls(fetchImpl)).toHaveLength(0)
  })

  it('3xx 重定向应答 → 拒绝', async () => {
    const fetchImpl = fakeFetch([new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })])
    await expect(downloadImage('https://cdn.example.com/a.png', { signal, fetchImpl, lookupImpl: publicLookup })).rejects.toThrow(/redirect/i)
  })

  it('下载 HTTP 错误 → 拒绝', async () => {
    const fetchImpl = fakeFetch([new Response('gone', { status: 403 })])
    await expect(downloadImage('https://cdn.example.com/a.png', { signal, fetchImpl, lookupImpl: publicLookup })).rejects.toThrow(/403/)
  })

  it('下载体 content-length 超限 → 拒绝', async () => {
    const fetchImpl = fakeFetch([new Response(PNG_BYTES, { headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) } })])
    await expect(downloadImage('https://cdn.example.com/a.png', { signal, fetchImpl, lookupImpl: publicLookup })).rejects.toThrow(/limit/i)
  })
})

describe('pinnedDispatcher — 真实连接钉定', () => {
  it('连接落到钉定地址，Host 头仍是原域名', async () => {
    const server = createServer((req, res) => {
      res.end(`host=${req.headers.host}`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port

    // 故意把一个不存在域名钉到本机：若钉定生效，请求会到达本地服务器且 Host 保持原域名。
    const dispatcher = pinnedDispatcher('pin-test.example.com', '127.0.0.1')
    try {
      const res = await fetch(`http://pin-test.example.com:${port}/`, { dispatcher } as RequestInit)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe(`host=pin-test.example.com:${port}`)
    } finally {
      await dispatcher.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})