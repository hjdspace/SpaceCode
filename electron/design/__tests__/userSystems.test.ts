// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import {
  buildDraftDesignMd,
  createUserDesignSystem,
  deleteUserDesignSystem,
  DesignSystemStoreError,
  isSafeDesignSystemId,
  listUserDesignSystemIds,
  normalizeHexColor,
  slugifyDesignSystemTitle,
} from '../userSystems'
import { extractColors, renderDesignSystemShowcase } from '../showcase'

// 回滚用例要制造「第二次写失败」，只能拦下 writeFile
const mockState = vi.hoisted(() => ({ failOnSuffix: '' }))
vi.mock('fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('fs/promises')>()
  const writeFileMock = vi.fn(async (target: string | URL | number, ...rest: unknown[]) => {
    if (typeof target === 'string' && mockState.failOnSuffix && target.endsWith(mockState.failOnSuffix)) {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    }
    return (real.writeFile as (a: unknown, b: unknown, c: unknown) => Promise<void>)(target, ...rest as [unknown, unknown])
  })
  return { ...real, default: { ...real, writeFile: writeFileMock }, writeFile: writeFileMock }
})

let userRoot: string

beforeEach(() => {
  userRoot = mkdtempSync(path.join(tmpdir(), 'spacecode-user-systems-'))
  mockState.failOnSuffix = ''
})

afterEach(() => {
  rmSync(userRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
})

describe('slugifyDesignSystemTitle', () => {
  it('ASCII 标题压成小写连字符', () => {
    expect(slugifyDesignSystemTitle('  My Warm  UI!! ')).toBe('my-warm-ui')
    expect(slugifyDesignSystemTitle('Stripe')).toBe('stripe')
  })

  it('纯中文标题转不出 ASCII 时用兜底 slug，而不是拼出空目录名', () => {
    expect(slugifyDesignSystemTitle('暖调编辑部')).toBe('custom-design-system')
    // 中英混排仍可提取拉丁部分
    expect(slugifyDesignSystemTitle('暖调 Editorial')).toBe('editorial')
  })

  it('超长标题截到 64 且不留下悬空连字符', () => {
    const slug = slugifyDesignSystemTitle(`a${'b'.repeat(200)}c`)
    expect(slug.length).toBeLessThanOrEqual(64)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('normalizeHexColor', () => {
  it('补 # 前缀、展开三位并统一小写', () => {
    expect(normalizeHexColor('#D66F4D', '#000')).toBe('#d66f4d')
    expect(normalizeHexColor('abc', '#000')).toBe('#aabbcc')
  })

  it('非法值退回兜底色', () => {
    expect(normalizeHexColor('#12345', '#000001')).toBe('#000001')
    expect(normalizeHexColor('rebeccapurple', '#000001')).toBe('#000001')
    expect(normalizeHexColor(undefined, '#000001')).toBe('#000001')
  })
})

describe('isSafeDesignSystemId', () => {
  it('放行常规目录名，挡掉点段与分隔符', () => {
    expect(isSafeDesignSystemId('my-warm-ui')).toBe(true)
    expect(isSafeDesignSystemId('a.b_c-1')).toBe(true)
    expect(isSafeDesignSystemId('.')).toBe(false)
    expect(isSafeDesignSystemId('..')).toBe(false)
    expect(isSafeDesignSystemId('../evil')).toBe(false)
    expect(isSafeDesignSystemId('a/b')).toBe(false)
    expect(isSafeDesignSystemId('')).toBe(false)
    expect(isSafeDesignSystemId(undefined)).toBe(false)
  })
})

describe('buildDraftDesignMd', () => {
  const palette = {
    bg: '#fbfaf7',
    surface: '#ffffff',
    fg: '#1f1d1b',
    accent: '#d66f4d',
    muted: '#706b65',
    border: '#ddd8d0',
  }

  it('标题/分类/描述进正文，九个分节齐备', () => {
    const md = buildDraftDesignMd('暖调编辑部', 'Editorial', '杂志感的暖米色排版。', palette)
    expect(md).toContain('# 暖调编辑部')
    expect(md).toContain('> Category: Editorial')
    expect(md).toContain('杂志感的暖米色排版。')
    for (let n = 1; n <= 9; n += 1) {
      expect(md).toContain(`## ${n}. `)
    }
  })

  it('色板行能被 showcase 的角色查找命中，预览不会退到猜色', () => {
    const md = buildDraftDesignMd('Warm', 'Custom', 'summary', palette)
    const roleOf = (hex: string) => extractColors(md).find((c) => c.value === hex)?.role ?? ''
    expect(roleOf('#fbfaf7')).toMatch(/background/i)
    expect(roleOf('#ffffff')).toMatch(/surface/i)
    expect(roleOf('#1f1d1b')).toMatch(/primary text/i)
    expect(roleOf('#d66f4d')).toMatch(/accent/i)
    expect(roleOf('#706b65')).toMatch(/secondary text/i)
    expect(roleOf('#ddd8d0')).toMatch(/border/i)
  })

  it('showcase 渲染出的页面带上用户的强调色', () => {
    const md = buildDraftDesignMd('Warm Editorial', 'Custom', 'summary', palette)
    const html = renderDesignSystemShowcase('warm-editorial', md)
    expect(html).toContain('Warm Editorial')
    expect(html.toLowerCase()).toContain('#d66f4d')
  })
})

describe('createUserDesignSystem', () => {
  it('写出 DESIGN.md / tokens.css / manifest.json 三件套', async () => {
    const created = await createUserDesignSystem(
      userRoot,
      { title: 'My Warm UI', summary: '暖米底', accentColor: '#D66F4D' },
      new Set(),
    )
    expect(created).toEqual({
      id: 'my-warm-ui',
      name: 'My Warm UI',
      category: 'Custom',
      description: '暖米底',
    })

    const dir = path.join(userRoot, 'my-warm-ui')
    expect(existsSync(path.join(dir, 'DESIGN.md'))).toBe(true)
    const tokensCss = readFileSyncText(path.join(dir, 'tokens.css'))
    expect(tokensCss).toContain('--accent: #d66f4d')
    const manifest = JSON.parse(readFileSyncText(path.join(dir, 'manifest.json')))
    expect(manifest).toMatchObject({ id: 'my-warm-ui', name: 'My Warm UI', category: 'Custom', source: { type: 'user' } })
  })

  it('未填描述时给出可用兜底，不留下空白段落', async () => {
    const created = await createUserDesignSystem(userRoot, { title: 'Bare' }, new Set())
    expect(created.description).toContain('Bare')
  })

  it('空标题直接报错且不建目录', async () => {
    await expect(createUserDesignSystem(userRoot, { title: '   ' }, new Set())).rejects.toThrow(DesignSystemStoreError)
    expect(readdirSync(userRoot)).toEqual([])
  })

  it('同名不覆盖：第二次拿到 -2 后缀，两份内容互不影响', async () => {
    const first = await createUserDesignSystem(userRoot, { title: 'Duplicated', summary: 'A' }, new Set())
    const second = await createUserDesignSystem(userRoot, { title: 'Duplicated', summary: 'B' }, new Set())
    expect([first.id, second.id]).toEqual(['duplicated', 'duplicated-2'])
    expect(readFileSyncText(path.join(userRoot, 'duplicated', 'DESIGN.md'))).toContain('A')
    expect(readFileSyncText(path.join(userRoot, 'duplicated-2', 'DESIGN.md'))).toContain('B')
  })

  it('预留名单里的 slug 直接让位，避免遮蔽随包预设', async () => {
    const created = await createUserDesignSystem(userRoot, { title: 'Stripe' }, new Set(['stripe']))
    expect(created.id).toBe('stripe-2')
  })

  it('写文件失败时回滚自己抢注的目录', async () => {
    const winner = path.join(userRoot, 'half-written')
    mkdirSync(winner, { recursive: true })
    // 抢注方按名单让位到 -2，回滚只该动 -2 那一份
    mockState.failOnSuffix = 'manifest.json'
    await expect(
      createUserDesignSystem(userRoot, { title: 'Half Written' }, new Set(['half-written'])),
    ).rejects.toThrow(/EACCES/)
    expect(existsSync(winner)).toBe(true)
    expect(existsSync(path.join(userRoot, 'half-written-2'))).toBe(false)
  })
})

describe('listUserDesignSystemIds', () => {
  it('目录还不存在时返回空列表', async () => {
    expect(await listUserDesignSystemIds(path.join(userRoot, 'not-yet'))).toEqual([])
  })

  it('跳过文件与点开头的目录', async () => {
    mkdirSync(path.join(userRoot, 'real-one'))
    mkdirSync(path.join(userRoot, '.DS_Store'))
    writeFileSync(path.join(userRoot, 'loose.txt'), 'x')
    expect(await listUserDesignSystemIds(userRoot)).toEqual(['real-one'])
  })
})

describe('deleteUserDesignSystem', () => {
  it('删掉自建目录', async () => {
    await createUserDesignSystem(userRoot, { title: 'Doomed' }, new Set())
    await deleteUserDesignSystem(userRoot, 'doomed')
    expect(existsSync(path.join(userRoot, 'doomed'))).toBe(false)
  })

  it('目录不存在时报错，不静默成功', async () => {
    await expect(deleteUserDesignSystem(userRoot, 'ghost')).rejects.toThrow(/not-found/)
  })

  it('非法 id 报 invalid-id，穿越串也进不去', async () => {
    for (const bad of ['..', '.', '../outside', 'a/b']) {
      await expect(deleteUserDesignSystem(userRoot, bad)).rejects.toThrow(/invalid-id/)
    }
  })

  it('用户库根目录本身不会被删', async () => {
    await expect(deleteUserDesignSystem(userRoot, 'nested/../..')).rejects.toThrow(/invalid-id/)
    expect(existsSync(userRoot)).toBe(true)
  })
})

function readFileSyncText(file: string): string {
  return readFileSync(file, 'utf-8')
}
