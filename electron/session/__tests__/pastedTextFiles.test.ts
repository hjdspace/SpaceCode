// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { pastedTextDir, savePastedText } from '../pastedTextFiles'
import { STALE_TEMP_ARTIFACT_MAX_AGE_MS, sweepStaleTempArtifacts } from '../tempArtifacts'

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'spacecode-pasted-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('savePastedText', () => {
  it('写进 <root>/pasted 下的唯一 txt，内容原样保留', () => {
    const text = '第一行\n第二行\r\n第三行'
    const filePath = savePastedText(text, root)

    expect(path.dirname(filePath)).toBe(pastedTextDir(root))
    expect(path.basename(filePath)).toMatch(/^pasted-[0-9a-f-]{36}\.txt$/)
    expect(fs.readFileSync(filePath, 'utf8')).toBe(text)
  })

  it('每次落盘文件名不同', () => {
    const first = savePastedText('same', root)
    const second = savePastedText('same', root)

    expect(first).not.toBe(second)
  })
})

describe('粘贴件与临时产物清扫', () => {
  it('24h TTL 清扫不会带走粘贴件（历史消息还要能打开）', () => {
    const filePath = savePastedText('old pasted text', root)
    const stale = new Date(Date.now() - STALE_TEMP_ARTIFACT_MAX_AGE_MS * 2)
    fs.utimesSync(filePath, stale, stale)

    const result = sweepStaleTempArtifacts(STALE_TEMP_ARTIFACT_MAX_AGE_MS, root)

    expect(result.removed).toBe(0)
    expect(fs.existsSync(filePath)).toBe(true)
  })
})
