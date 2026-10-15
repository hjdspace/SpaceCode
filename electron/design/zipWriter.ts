/**
 * 最小 ZIP 写出器（store + deflate）— 只用 node:zlib，不引第三方依赖。
 *
 * 只做写归档所需的子集：无目录条目、无 Zip64、无注释。设计产物是 KB~MB 级、
 * 条目个位数，标准头部字段足够；超出 4GB/65535 条目的场景不存在，所以不实现。
 * 条目名强制为 POSIX 相对路径：绝对路径与 `..` 会让解压端写到目标目录之外（zip slip）。
 */
import { deflateRawSync } from 'zlib'

export interface ZipEntryInput {
  /** POSIX 相对路径，如 `assets/app.js` */
  name: string
  data: Buffer
  /** 归档内记录的时间戳，默认取文件 mtime */
  mtime?: Date
}

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const VERSION = 20
const FLAG_UTF8 = 0x0800
const METHOD_STORE = 0
const METHOD_DEFLATE = 8
/** 归档属性：archive 位 + 0644 权限（解压端非 Windows 时用它还原模式） */
const FILE_EXTERNAL_ATTRS = 0x20 | (0o644 << 16)
const DOS_MIN_YEAR = 1980

const CRC_TABLE = new Uint32Array(
  Array.from({ length: 256 }, (_unused, i) => {
    let c = i
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    return c >>> 0
  }),
)

function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c = (CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)) >>> 0
  }
  return (c ^ 0xffffffff) >>> 0
}

/** DOS 时间格式：年月日各占位，秒只到 2 秒精度。 */
function dosStamp(date: Date): { time: number; day: number } {
  const safe = date.getFullYear() >= DOS_MIN_YEAR ? date : new Date(DOS_MIN_YEAR, 0, 1)
  return {
    time: (safe.getHours() << 11) | (safe.getMinutes() << 5) | Math.floor(safe.getSeconds() / 2),
    day:
      ((safe.getFullYear() - DOS_MIN_YEAR) << 9) |
      ((safe.getMonth() + 1) << 5) |
      safe.getDate(),
  }
}

function assertSafeEntryName(name: string): void {
  const invalid =
    !name ||
    name.startsWith('/') ||
    name.includes('\\') ||
    /^[a-z]:/i.test(name) ||
    name.split('/').some(segment => segment === '..')
  if (invalid) throw new Error(`Invalid ZIP entry name: ${JSON.stringify(name)}`)
}

export function writeZip(entries: ZipEntryInput[], now = new Date()): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    assertSafeEntryName(entry.name)
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const deflated = deflateRawSync(entry.data, { level: 9 })
    const useDeflate = deflated.length < entry.data.length
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE
    const payload = useDeflate ? deflated : entry.data
    const crc = crc32(entry.data)
    const stamp = dosStamp(entry.mtime ?? now)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE(VERSION, 4)
    central.writeUInt16LE(VERSION, 6)
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.day, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(FILE_EXTERNAL_ATTRS, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)

    offset += local.length + nameBuf.length + payload.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralDirectory, eocd])
}
