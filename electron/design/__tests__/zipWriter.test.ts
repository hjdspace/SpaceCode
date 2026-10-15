// @vitest-environment node
/**
 * ZIP 写出器 — 票 08：导出 ZIP 必须产出真实、可被标准解压工具读取的字节流。
 *
 * 断言走 __tests__/zipReader.ts 的独立解析器（中央目录 → 本地头 → 数据段），
 * 校验的是外部工具能看到的东西，而不是写出器的内部结构。
 */
import { describe, it, expect } from 'vitest'
import { randomBytes } from 'crypto'
import { writeZip } from '../zipWriter'
import { readZip } from './zipReader'

describe('writeZip', () => {
  it('产出可解析的条目，内容原样还原', () => {
    const entries = readZip(
      writeZip([
        { name: 'index.html', data: Buffer.from('<html>hello</html>', 'utf8') },
        { name: 'assets/app.js', data: Buffer.from('console.log(1)', 'utf8') },
      ]),
    )
    expect(entries.map(e => e.name)).toEqual(['index.html', 'assets/app.js'])
    expect(entries[0].data.toString('utf8')).toBe('<html>hello</html>')
    expect(entries[1].data.toString('utf8')).toBe('console.log(1)')
  })

  it('CRC32 采用标准校验值', () => {
    // "123456789" 的 CRC-32 是业界已知检查值 0xCBF43926
    const [entry] = readZip(writeZip([{ name: 'a.txt', data: Buffer.from('123456789', 'utf8') }]))
    expect(entry.crc).toBe(0xcbf43926)
  })

  it('可压缩内容走 deflate，压不动的回退 store', () => {
    const random = randomBytes(2000)

    const entries = readZip(
      writeZip([
        { name: 'text.txt', data: Buffer.from('a'.repeat(2000), 'utf8') },
        { name: 'random.bin', data: random },
      ]),
    )
    expect(entries[0].method).toBe(8)
    expect(entries[1].method).toBe(0)
    expect(entries[1].data.equals(random)).toBe(true)
  })

  it('空归档仍是合法 ZIP', () => {
    expect(readZip(writeZip([]))).toEqual([])
  })

  it('非 ASCII 条目名带 UTF-8 标志并原样保留', () => {
    const [entry] = readZip(writeZip([{ name: '设计稿/首页.css', data: Buffer.from('body{}', 'utf8') }]))
    expect(entry.name).toBe('设计稿/首页.css')
    expect(entry.utf8).toBe(true)
  })

  it('拒绝越界条目名（zip slip）', () => {
    for (const name of ['/etc/passwd', '../escape.txt', 'a/../../escape.txt', 'C:\\Windows\\evil.dll', '']) {
      expect(() => writeZip([{ name, data: Buffer.from('x') }]), name).toThrow()
    }
  })
})
