import { describe, it, expect } from 'vitest'
import { listDesignSystems, getSystemPreviewHtml, parseSwatchesFromTokensCss } from '../promptStack'
import * as path from 'path'

const extraResourcesPath = path.resolve(__dirname, '../../../')

describe('listDesignSystems', () => {
  it('返回 agentic 系统并包含 description 和 previewPages', async () => {
    const systems = await listDesignSystems(extraResourcesPath)
    const agentic = systems.find((s) => s.id === 'agentic')
    expect(agentic).toBeTruthy()
    expect(agentic!.name).toBe('Agentic')
    expect(agentic!.category).toBe('Themed & Unique')
    expect(agentic!.description).toContain('Agentic')
    expect(agentic!.previewPages).toBeInstanceOf(Array)
    expect(agentic!.previewPages.length).toBeGreaterThan(0)
  })
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
})

describe('getSystemPreviewHtml', () => {
  it('返回 agentic colors.html 且包含色板标记', async () => {
    const html = await getSystemPreviewHtml(extraResourcesPath, 'agentic', 'preview/colors.html')
    expect(html).toContain('Color roles')
    expect(html).toContain('--accent')
  })

  it('将本地样式表内联为 style 标签', async () => {
    const html = await getSystemPreviewHtml(extraResourcesPath, 'agentic', 'preview/colors.html')
    expect(html).not.toMatch(/<link[^>]*stylesheet/)
    expect(html).toContain('--bg:')
    expect(html).toContain('<style>')
  })
})
