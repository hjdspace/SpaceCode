import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MarkdownRenderer from '../MarkdownRenderer.vue'

const apiMocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  readFileAsBase64: vi.fn(),
  // 组件链路会实例化 settings/terminal store (app → chatSession → settings),
  // store 初始化调用这些 api; 缺失会产生 unhandled rejection / stderr 噪音
  loadGuiSettings: vi.fn(),
  getEnv: vi.fn(),
  terminalOnExit: vi.fn(),
}))

vi.mock('@/services/electronAPI', () => ({
  api: {
    readFile: apiMocks.readFile,
    readFileAsBase64: apiMocks.readFileAsBase64,
    loadGuiSettings: apiMocks.loadGuiSettings,
    getEnv: apiMocks.getEnv,
    terminal: { onExit: apiMocks.terminalOnExit },
  },
}))

describe('MarkdownRenderer file links', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    apiMocks.readFile.mockResolvedValue('content')
    apiMocks.readFileAsBase64.mockResolvedValue(null)
    apiMocks.loadGuiSettings.mockResolvedValue({ success: false })
    apiMocks.getEnv.mockResolvedValue(undefined)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  async function renderAndGetLinks(content: string) {
    const wrapper = mount(MarkdownRenderer, {
      props: { content },
      global: { plugins: [createPinia()] },
    })
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    const links = wrapper.findAll('.file-link').map(l => ({
      path: l.attributes('data-file-path'),
      line: l.attributes('data-line-number'),
      end: l.attributes('data-end-line-number'),
      text: l.text(),
    }))
    wrapper.unmount()
    return links
  }

  it('matches line numbers and ranges', async () => {
    const links = await renderAndGetLinks('修改见 src/stores/app.ts:42 以及 electron/main.ts:10-25 的处理')
    expect(links).toHaveLength(2)
    expect(links[0]).toMatchObject({ path: 'src/stores/app.ts', line: '42', text: 'stores/app.ts:42' })
    expect(links[1]).toMatchObject({ path: 'electron/main.ts', line: '10', end: '25', text: 'electron/main.ts:10-25' })
  })

  it('matches absolute windows paths', async () => {
    const links = await renderAndGetLinks('参见 D:\\doc\\AI\\SpaceCode\\package.json 的依赖')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ path: 'D:\\doc\\AI\\SpaceCode\\package.json', text: 'SpaceCode/package.json' })
  })

  it('normalizes 第N行 references', async () => {
    const links = await renderAndGetLinks('问题在 src/utils/helper.ts 第42行')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ path: 'src/utils/helper.ts', line: '42' })
  })

  it('links path-shaped references inside inline code', async () => {
    const links = await renderAndGetLinks('配置在 `./vite.config.ts`，实现在 `src/a/b.ts:1-2`')
    expect(links).toHaveLength(2)
    expect(links[0]).toMatchObject({ path: './vite.config.ts' })
    expect(links[1]).toMatchObject({ path: 'src/a/b.ts', line: '1', end: '2' })
  })

  it('does not link bare library names or pseudo-paths inside inline code', async () => {
    // 无目录段且不在白名单的裸名更像库名/属性访问而非文件
    const links = await renderAndGetLinks('用 `three.js` 与 `phaser.js`，读取 `process.env`，入口 `main.ts`')
    expect(links).toHaveLength(0)
  })

  it('does not link bare names in inline code as partial matches of longer tokens', async () => {
    const links = await renderAndGetLinks('配置在 `vite-package.json` 里，参见 `package.jsonx` 文档')
    expect(links).toHaveLength(0)
  })

  it('links well-known root config files by bare name inside inline code', async () => {
    const links = await renderAndGetLinks('依赖声明在 `package.json`，类型配置在 `tsconfig.json`，见 `README.md:10-20`')
    expect(links).toHaveLength(3)
    expect(links[0]).toMatchObject({ path: 'package.json' })
    expect(links[1]).toMatchObject({ path: 'tsconfig.json' })
    expect(links[2]).toMatchObject({ path: 'README.md', line: '10', end: '20' })
  })

  it('skips paths inside code blocks', async () => {
    const links = await renderAndGetLinks('```\nimport x from "src/a.ts"\n```\n\n正文提到 src/b.ts')
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ path: 'src/b.ts' })
  })

  it('does not double-wrap and is idempotent across re-renders', async () => {
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '见 src/a.ts 和 src/b.ts:5' },
      global: { plugins: [createPinia()] },
    })
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.findAll('.file-link')).toHaveLength(2)
    await wrapper.setProps({ content: '见 src/a.ts 和 src/b.ts:5 加一句' })
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.findAll('.file-link')).toHaveLength(2)
    expect(wrapper.findAll('.file-link .file-link')).toHaveLength(0)
    wrapper.unmount()
  })

  it('validates file links on initial mount without waiting for content changes', async () => {
    apiMocks.readFile.mockResolvedValueOnce(null)
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '参见 src/utils/missing.ts 的说明' },
      global: { plugins: [createPinia()] },
    })
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(apiMocks.readFile).toHaveBeenCalledWith('src/utils/missing.ts')
    expect(wrapper.find('.file-link').classes()).toContain('file-link--invalid')
    wrapper.unmount()
  })

  it('recovers an invalid link once the file is created later', async () => {
    apiMocks.readFile.mockResolvedValueOnce(null)
    const wrapper = mount(MarkdownRenderer, {
      props: { content: '参见 src/utils/missing.ts 的说明' },
      global: { plugins: [createPinia()] },
    })
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.find('.file-link').classes()).toContain('file-link--invalid')

    // 文件在会话期间被创建: 后续内容变更触发尾随帧重查, 链接应恢复可点击
    apiMocks.readFile.mockResolvedValue('content')
    await wrapper.setProps({ content: '参见 src/utils/missing.ts 的说明(已创建)' })
    // 等待 80ms 节流间隔后的尾随帧完成重渲染与重校验
    await new Promise(r => setTimeout(r, 120))
    expect(wrapper.find('.file-link').classes()).not.toContain('file-link--invalid')
    wrapper.unmount()
  })
})
