/** 票 08 测试共用：不依赖第三方库的最小 ZIP 读取器（与写出器互相独立）。 */
import { inflateRawSync } from 'zlib'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50

export interface ReadEntry {
  name: string
  method: number
  crc: number
  utf8: boolean
  data: Buffer
}

function eocdOffset(buf: Buffer): number {
  for (let p = buf.length - 22; p >= 0; p--) {
    if (buf.readUInt32LE(p) === SIG_EOCD) return p
  }
  throw new Error('EOCD not found — 不是合法 ZIP')
}

/** 按中央目录 → 本地头 → 数据段还原每个条目，校验 CRC 与解压后长度。 */
export function readZip(buf: Buffer): ReadEntry[] {
  const eocd = eocdOffset(buf)
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)

  const entries: ReadEntry[] = []
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error(`central header ${i} 签名错误`)
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')

    if (buf.readUInt32LE(local) !== SIG_LOCAL) throw new Error(`local header ${name} 签名错误`)
    if (buf.readUInt32LE(local + 14) !== crc) throw new Error(`local header ${name} CRC 与中央目录不一致`)
    const localNameLen = buf.readUInt16LE(local + 26)
    const localExtraLen = buf.readUInt16LE(local + 28)
    const dataStart = local + 30 + localNameLen + localExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)
    const data = method === 8 ? inflateRawSync(raw) : raw
    if (data.length !== uncompSize) throw new Error(`${name} 解压后长度不符`)

    entries.push({ name, method, crc, utf8: (flags & 0x0800) !== 0, data })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export function entryNames(buf: Buffer): string[] {
  return readZip(buf).map(e => e.name)
}
