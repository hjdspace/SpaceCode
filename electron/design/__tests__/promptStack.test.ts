import { describe, it, expect } from 'vitest'
import { listDesignSystems, getSystemPreviewHtml } from '../promptStack'
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

describe('getSystemPreviewHtml', () => {
  it('返回 agentic colors.html 且包含色板标记', async () => {
    const html = await getSystemPreviewHtml(extraResourcesPath, 'agentic', 'preview/colors.html')
    expect(html).toContain('Color roles')
    expect(html).toContain('--accent')
  })

  it('将相对路径替换为 file:// 绝对路径', async () => {
    const html = await getSystemPreviewHtml(extraResourcesPath, 'agentic', 'preview/colors.html')
    expect(html).not.toMatch(/href="\.\.\//)
    expect(html).toMatch(/href="file:\/\//)
  })
})
