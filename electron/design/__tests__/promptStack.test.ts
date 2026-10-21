import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listDesignSystems, getSystemPreviewHtml, getSystemShowcaseHtml, getSystemFile, getSystemTokensHtml, parseSwatchesFromTokensCss, readDesignSystemAssets, registerPromptStackHandlers, type DesignSystemSummary } from '../promptStack'
import * as path from 'path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const extraResourcesPath = path.resolve(__dirname, '../../../resources/')

// registerPromptStackHandlers 在模块顶层 import ipcMain；jsdom 下 electron 包导出的是
// 可执行文件路径字符串，named import 得到 undefined —— 注册测试必须 mock。
const mockState = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockState.ipcHandle },
}))

// ─────────────────────────── 临时夹具 ───────────────────────────
// design-systems-lib 的目录结构：resources/design-systems-lib/<id>/{DESIGN.md,tokens.css,...}
let libRoot: string
let scratch: string[]

function makeSystem(id: string, files: Record<string, string> = {}): string {
  // 被测函数都把 extraResourcesPath 拼上 design-systems-lib 段，夹具必须建在同一层
  const dir = path.join(libRoot, 'design-systems-lib', id)
  mkdirSync(dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

function makeLibRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'spacecode-prompt-stack-'))
  mkdirSync(path.join(root, 'design-systems-lib'), { recursive: true })
  return root
}

beforeEach(() => {
  libRoot = makeLibRoot()
  scratch = []
  mockState.ipcHandle.mockClear()
})

afterEach(() => {
  for (const dir of [libRoot, ...scratch]) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('listDesignSystems（随仓库资源）', () => {
  it('返回 agentic 系统并包含 description 和 previewPages', async () => {
    const systems = await listDesignSystems(extraResourcesPath)
    const agentic = systems.find((s) => s.id === 'agentic')
    expect(agentic).toBeTruthy()
    expect(agentic!.name).toBe('Agentic')
    expect(agentic!.category).toBe('Themed & Unique')
    expect(agentic!.description).toContain('Agentic')
    expect(agentic!.previewPages).toBeInstanceOf(Array)
    expect(agentic!.previewPages.length).toBeGreaterThan(0)
  }, 60000)
})

describe('parseSwatchesFromTokensCss', () => {
  it('替换所有 var() 引用后再判断是否为颜色值', () => {
    const css = `
      --bg: var(--neutral-1);
      --surface: var(--neutral-2) #ffffff;
      --fg: var(--neutral-12) var(--neutral-13) #000000;
      --accent: #3b82f6;
    `
    const swatches = parseSwatchesFromTokensCss(css)
    const names = swatches.map((s) => s.name)
    expect(names).toContain('--surface')
    expect(names).toContain('--fg')
    expect(names).toContain('--accent')
    expect(names).not.toContain('--bg')
    expect(swatches.find((s) => s.name === '--surface')!.value).toBe('#ffffff')
    expect(swatches.find((s) => s.name === '--fg')!.value).toBe('#000000')
  })

  it('同名变量只收第一次出现', () => {
    const css = `
      --accent: #111111;
      --accent: #222222;
    `
    expect(parseSwatchesFromTokensCss(css)).toEqual([{ name: '--accent', value: '#111111' }])
  })

  it('纯字面非颜色值（如长度/字号）被丢弃', () => {
    const css = `
      --radius: 12px;
      --accent: rgb(59 130 246);
    `
    expect(parseSwatchesFromTokensCss(css).map((s) => s.name)).toEqual(['--accent'])
  })

  it('rgb / hsl 形式同样认作颜色', () => {
    const css = `
      --a: rgb(10, 20, 30);
      --b: hsl(210deg 60% 50%);
    `
    const names = parseSwatchesFromTokensCss(css).map((s) => s.name)
    expect(names).toEqual(['--a', '--b'])
  })

  it('优先色板排最前，非优先色板之间按字典序', () => {
    const css = `
      --zeta: #001;
      --alpha: #002;
      --accent: #003;
      --bg: #004;
    `
    const names = parseSwatchesFromTokensCss(css).map((s) => s.name)
    expect(names).toEqual(['--bg', '--accent', '--alpha', '--zeta'])
  })

  it('最多保留 8 个色板', () => {
    const css = Array.from({ length: 12 }, (_, i) => `--c${i}: #10${i.toString().padStart(2, '0')}0;`).join('\n')
    expect(parseSwatchesFromTokensCss(css)).toHaveLength(8)
  })
})

// ─────────────────────────── 资产读取与回退 ───────────────────────────

describe('readDesignSystemAssets', () => {
  it('三个资产都存在时原样读取', async () => {
    makeSystem('full', {
      'DESIGN.md': '# Full design rules',
      'tokens.css': ':root { --accent: #123456; }',
      'manifest.json': '{"name":"Full"}',
    })
    const assets = await readDesignSystemAssets(path.join(libRoot, 'design-systems-lib'), 'full')
    expect(assets.designMd).toBe('# Full design rules')
    expect(assets.tokensCss).toContain('--accent: #123456')
    expect(assets.componentsManifest).toBe('{"name":"Full"}')
  })

  it('DESIGN.md 缺失时回退到通用占位规则', async () => {
    makeSystem('no-md', { 'tokens.css': ':root{}' })
    const assets = await readDesignSystemAssets(path.join(libRoot, 'design-systems-lib'), 'no-md')
    expect(assets.designMd).toContain('[DESIGN RULES FOR NO-MD]')
    expect(assets.designMd).toContain('no-md style')
  })

  it('tokens.css 缺失时回退到默认 token', async () => {
    makeSystem('no-css', { 'DESIGN.md': 'rules' })
    const assets = await readDesignSystemAssets(path.join(libRoot, 'design-systems-lib'), 'no-css')
    expect(assets.tokensCss).toContain('--color-primary: #000')
    expect(assets.componentsManifest).toBe('')
  })

  it('整个目录都不存在时全部走回退', async () => {
    const assets = await readDesignSystemAssets(path.join(libRoot, 'design-systems-lib'), 'ghost')
    expect(assets.designMd).toContain('GHOST')
    expect(assets.tokensCss).toContain('--color-primary')
    expect(assets.componentsManifest).toBe('')
  })
})

describe('getSystemFile', () => {
  it('存在则返回文件内容', async () => {
    makeSystem('f1', { 'system/note.txt': 'hello file' })
    expect(await getSystemFile(libRoot, 'f1', 'system/note.txt')).toBe('hello file')
  })

  it('不存在时返回空串而不是抛错', async () => {
    expect(await getSystemFile(libRoot, 'f1', 'system/missing.txt')).toBe('')
  })
})

describe('getSystemPreviewHtml（夹具版，覆盖分支）', () => {
  it('页面不存在返回空串', async () => {
    makeSystem('p0', {})
    expect(await getSystemPreviewHtml(libRoot, 'p0', 'preview/none.html')).toBe('')
  })

  it('本地样式表与脚本被内联，内联后的本地图片改写为 file:// 绝对路径', async () => {
    makeSystem('p1', {
      'preview/page.html': [
        '<html><head>',
        '<link rel="stylesheet" href="style.css">',
        '<script src="app.js"></script>',
        '</head><body>',
        '<img src="logo.png">',
        '</body></html>',
      ].join('\n'),
      'preview/style.css': '.page { color: red; }',
      'preview/app.js': 'console.log("app");',
      'preview/logo.png': 'fake-png',
    })
    const html = await getSystemPreviewHtml(libRoot, 'p1', 'preview/page.html')
    expect(html).toContain('<style>.page { color: red; }</style>')
    expect(html).toContain('<script>console.log("app");</script>')
    expect(html).toMatch(/src="file:\/\/[^"]*logo\.png"/)
    expect(html).not.toMatch(/<link[^>]*stylesheet/)
    // 替换发生在原位：style 在 </head> 之前，而不是被丢弃后拼到文档末尾
    expect(html.indexOf('<style>')).toBeLessThan(html.indexOf('</head>'))
  })

  it('同一文档内的多个本地样式表各自内联到原位（replaceAsync 多资源回归）', async () => {
    makeSystem('p1b', {
      'preview/page.html': [
        '<html><head>',
        '<link rel="stylesheet" href="a.css">',
        '<link rel="stylesheet" href="b.css">',
        '</head><body>done</body></html>',
      ].join('\n'),
      'preview/a.css': '.a {}',
      'preview/b.css': '.b {}',
    })
    const html = await getSystemPreviewHtml(libRoot, 'p1b', 'preview/page.html')
    expect(html).toContain('<style>.a {}</style>')
    expect(html).toContain('<style>.b {}</style>')
    expect(html.indexOf('<style>.a {}</style>')).toBeLessThan(html.indexOf('<style>.b {}</style>'))
    expect(html.indexOf('<style>.b {}</style>')).toBeLessThan(html.indexOf('</head>'))
  })

  it('非 stylesheet 的 link、外链协议资源保持原样不被内联', async () => {
    makeSystem('p2', {
      'preview/page.html': [
        '<html><head>',
        '<link rel="icon" href="favicon.ico">',
        '<link rel="stylesheet" href="https://cdn.example.com/remote.css">',
        '<link rel="stylesheet" href="missing.css">',
        '<script src="https://cdn.example.com/remote.js"></script>',
        '</head><body></body></html>',
      ].join('\n')
    })
    const html = await getSystemPreviewHtml(libRoot, 'p2', 'preview/page.html')
    // 非样式表 link 不被内联，仍是 <link>（相对 href 会被最终改写成 file:// 绝对路径）
    expect(html).toMatch(/<link rel="icon" href="file:\/\/[^\"]*favicon\.ico">/)
    // 外链协议资源既不内联也不改写
    expect(html).toContain('href="https://cdn.example.com/remote.css"')
    expect(html).toContain('<script src="https://cdn.example.com/remote.js"></script>')
    // 指向不存在文件的样式表保底不内联，仍是 <link>
    expect(html).toMatch(/<link rel="stylesheet" href="file:\/\/[^\"]*missing\.css">/)
    expect(html).not.toContain('<style>')
  })

  it('data: 协议的图片不被改写', async () => {
    makeSystem('p3', {
      'preview/page.html': '<html><body><img src="data:image/png;base64,AAA"></body></html>',
    })
    const html = await getSystemPreviewHtml(libRoot, 'p3', 'preview/page.html')
    expect(html).toContain('src="data:image/png;base64,AAA"')
  })
})

describe('getSystemShowcaseHtml（夹具版，覆盖回退链）', () => {
  it('无 DESIGN.md 时按候选顺序回退到第一个存在的预览页', async () => {
    makeSystem('s1', {
      'system/kit.html': '<html><body><h1>kit</h1></body></html>',
      'components.html': '<html><body>components</body></html>',
    })
    const html = await getSystemShowcaseHtml(libRoot, 's1')
    expect(html).toContain('kit')
    expect(html).not.toContain('components')
  })

  it('连候选页都没有时返回空串', async () => {
    makeSystem('s2', { 'random.txt': 'x' })
    expect(await getSystemShowcaseHtml(libRoot, 's2')).toBe('')
  })
})

describe('getSystemTokensHtml', () => {
  it('无 tokens.css 返回空串', async () => {
    makeSystem('t0', {})
    expect(await getSystemTokensHtml(libRoot, 't0')).toBe('')
  })

  it('从 tokens.css 生成色板网格与变量表，值中的 < 被转义', async () => {
    makeSystem('t1', {
      'tokens.css': ':root { --accent: #3b82f6; --code: "<script>"; }',
    })
    const html = await getSystemTokensHtml(libRoot, 't1')
    expect(html).toContain('Design Tokens')
    expect(html).toContain('--accent')
    expect(html).toContain('--code')
    // 只转义 <，> 原样保留：文本节点里没有 </ 序列就闭合不了标签，已足够安全
    expect(html).toContain('&lt;script>')
  })

  it('色板文字颜色按亮度选择：浅底黑字、深底白字', async () => {
    makeSystem('t2', {
      'tokens.css': ':root { --light: #9a9a9a; --dark: #999999; }',
    })
    const html = await getSystemTokensHtml(libRoot, 't2')
    // #9a9a9a 亮度 0.604 > 0.6 → 黑字；#999999 亮度恰好 0.6 → 白字
    expect(html).toContain('background:#9a9a9a;color:#000')
    expect(html).toContain('background:#999999;color:#fff')
  })

  it('4 位 hex 解析出 NaN 通道时按深色处理', async () => {
    makeSystem('t3', {
      'tokens.css': ':root { --odd: #1234; }',
    })
    const html = await getSystemTokensHtml(libRoot, 't3')
    expect(html).toContain('background:#1234;color:#fff')
  })
})

describe('listDesignSystems（夹具版，覆盖清单回退）', () => {
  it('无 manifest 的目录回退到目录名 + General，色板来自 tokens.css', async () => {
    makeSystem('bare', { 'tokens.css': ':root { --bg: #ffffff; }' })
    const systems = await listDesignSystems(libRoot)
    const bare = systems.find((s) => s.id === 'bare')
    expect(bare!.name).toBe('bare')
    expect(bare!.category).toBe('General')
    expect(bare!.swatches).toEqual([{ name: '--bg', value: '#ffffff' }])
    expect(bare!.previewPages).toEqual([])
  })

  it('design-tokens.json 的 type=color 色板优先于 tokens.css', async () => {
    makeSystem('json-tokens', {
      'tokens.css': ':root { --bg: #ffffff; }',
      'design-tokens.json': JSON.stringify({
        tokens: [
          { name: '--accent', value: '#3b82f6', type: 'color' },
          { name: '--spacing', value: '8px', type: 'dimension' },
        ],
      }),
    })
    const systems = await listDesignSystems(libRoot)
    expect(systems.find((s) => s.id === 'json-tokens')!.swatches).toEqual([
      { name: '--accent', value: '#3b82f6' },
    ])
  })

  it('officialUrl 优先级：manifest.officialUrl > manifest.website > 预设表', async () => {
    makeSystem('official', { 'manifest.json': JSON.stringify({ name: 'O', officialUrl: 'https://official.example' }) })
    makeSystem('website', { 'manifest.json': JSON.stringify({ name: 'W', website: 'https://website.example' }) })
    makeSystem('stripe', { 'manifest.json': JSON.stringify({ name: 'Stripe Clone' }) })
    const systems = await listDesignSystems(libRoot)
    expect(systems.find((s) => s.id === 'official')!.officialUrl).toBe('https://official.example')
    expect(systems.find((s) => s.id === 'website')!.officialUrl).toBe('https://website.example')
    expect(systems.find((s) => s.id === 'stripe')!.officialUrl).toBe('https://stripe.com')
  })

  it('manifest 里的 preview.pages 与 description 原样带出', async () => {
    makeSystem('rich', {
      'manifest.json': JSON.stringify({
        name: 'Rich',
        category: 'Showcase',
        description: 'A rich system',
        preview: { pages: [{ path: 'preview/app.html', role: 'app', title: 'App' }] },
      }),
    })
    const systems: DesignSystemSummary[] = await listDesignSystems(libRoot)
    const rich = systems.find((s) => s.id === 'rich')!
    expect(rich.description).toBe('A rich system')
    expect(rich.previewPages).toEqual([{ path: 'preview/app.html', role: 'app', title: 'App' }])
  })

  it('点开头的目录被跳过', async () => {
    makeSystem('.hidden', { 'tokens.css': ':root{}' })
    makeSystem('visible', {})
    const systems = await listDesignSystems(libRoot)
    expect(systems.map((s) => s.id)).toEqual(['visible'])
  })

  it('坏 manifest 不拖垮目录枚举，回退到目录名', async () => {
    makeSystem('broken', { 'manifest.json': '{not json' })
    const systems = await listDesignSystems(libRoot)
    const broken = systems.find((s) => s.id === 'broken')
    expect(broken!.name).toBe('broken')
    expect(broken!.category).toBe('General')
  })
})

// ─────────────────────────── IPC 注册 ───────────────────────────

function handlerOf(channel: string): (...args: unknown[]) => unknown {
  const ipcHandle = mockState.ipcHandle
  const call = ipcHandle.mock.calls.find(([name]) => name === channel)
  if (!call) throw new Error(`channel not registered: ${channel} (registered: ${ipcHandle.mock.calls.map((c) => c[0]).join(', ')})`)
  return call[1] as (...args: unknown[]) => unknown
}

const DESIGN_CHANNELS = [
  'design:compose-prompt-stack',
  'design:list-systems',
  'design:get-system-preview',
  'design:get-system-file',
  'design:get-system-showcase',
  'design:get-system-tokens-html',
]

describe('registerPromptStackHandlers', () => {
  it('注册全部 6 个 design 通道', () => {
    registerPromptStackHandlers(libRoot)
    expect(mockState.ipcHandle).toHaveBeenCalledTimes(6)
    for (const channel of DESIGN_CHANNELS) {
      expect(mockState.ipcHandle).toHaveBeenCalledWith(channel, expect.any(Function))
    }
  })

  it('compose 带设计系统时把 DESIGN.md / tokens.css / manifest 组装进提示词栈', async () => {
    makeSystem('fixture', {
      'DESIGN.md': '# Fixture design rules',
      'tokens.css': ':root { --accent: #abcdef; }',
      'manifest.json': '{"name":"Fixture"}',
    })
    registerPromptStackHandlers(libRoot)
    const prompt = (await handlerOf('design:compose-prompt-stack')(null, {
      designSystemId: 'fixture',
      skillBody: 'SKILL BODY',
      skillName: 'fixture-skill',
      locale: 'en-US',
    })) as string

    expect(prompt).toContain('# Fixture design rules')
    expect(prompt).toContain('--accent: #abcdef')
    expect(prompt).toContain('[SESSION MODE: DESIGN WORKFLOW]')
    expect(prompt).toContain('execution_profile: filesystem')
    expect(prompt).toContain('"en-US"')
    expect(prompt).toContain('SKILL BODY')
    // 挂了设计系统就不再注入视觉方向库
    expect(prompt).not.toContain('[VISUAL DIRECTIONS LIBRARY]')
  })

  it('compose 不带设计系统时注入视觉方向库回退', async () => {
    registerPromptStackHandlers(libRoot)
    const prompt = (await handlerOf('design:compose-prompt-stack')(null, {
      locale: 'zh-CN',
    })) as string
    expect(prompt).toContain('[VISUAL DIRECTIONS LIBRARY]')
  })

  it('list-systems 走真实目录，目录不可读时回退到 4 个内置系统', async () => {
    registerPromptStackHandlers(libRoot)
    const systems = (await handlerOf('design:list-systems')()) as DesignSystemSummary[]
    expect(systems).toEqual([])

    // 清掉上一次注册，让 handlerOf 只能取到指向不可读路径的新 handler
    mockState.ipcHandle.mockClear()
    registerPromptStackHandlers(path.join(libRoot, 'does-not-exist'))
    const fallback = (await handlerOf('design:list-systems')()) as DesignSystemSummary[]
    expect(fallback.map((s) => s.id)).toEqual(['stripe', 'linear-app', 'vercel', 'apple'])
  })

  it('preview / file / showcase / tokens-html 四个通道原样委托', async () => {
    makeSystem('delegate', {
      'DESIGN.md': '# Delegate rules',
      'preview/app.html': '<html><body>delegate page</body></html>',
      'tokens.css': ':root { --accent: #123456; }',
    })
    registerPromptStackHandlers(libRoot)

    expect(await handlerOf('design:get-system-preview')(null, 'delegate', 'preview/app.html')).toContain('delegate page')
    expect(await handlerOf('design:get-system-file')(null, 'delegate', 'DESIGN.md')).toBe('# Delegate rules')
    expect(await handlerOf('design:get-system-showcase')(null, 'delegate')).toBeTruthy()
    expect(await handlerOf('design:get-system-tokens-html')(null, 'delegate')).toContain('--accent')
  })
})
