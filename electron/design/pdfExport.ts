/**
 * 设计产物导出 PDF — 票 08。
 *
 * 用一个隐藏的离屏窗口跑真实 Chromium 排版：页面从预览服务器加载（与用户在预览里
 * 看到的一致，相对 CSS/JS 同源命中产物目录），再 printToPDF 落盘。
 * 生成页是不可信内容，所以窗口不带 preload、sandbox 打开并拒绝弹窗。
 */
import { existsSync, writeFileSync } from 'fs'
import { basename, dirname, extname, join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { BrowserWindow } from 'electron'
import { previewServer } from '../infra/previewServer'

/** 等 Web 字体就绪，否则中文与自定义字体会打印成回退字形。 */
async function waitForFonts(contents: BrowserWindow['webContents']): Promise<void> {
  try {
    await contents.executeJavaScript('document.fonts.ready.then(() => true)')
  } catch {
    // 字体状态取不到就按当前渲染打印
  }
}

async function renderUrlFor(htmlPath: string): Promise<string> {
  if (!previewServer.getPort()) await previewServer.start()
  const url = previewServer.toPreviewUrl(htmlPath)
  // 预览服务器给不出登记 URL（极端路径）时退回 file://：排版仍由 Chromium 完成
  return url ?? pathToFileURL(htmlPath).href
}

/** 渲染 HTML 并写出同名 .pdf 到产物目录，返回产物路径。 */
export async function exportPdf(htmlPath: string): Promise<string> {
  const target = resolve(htmlPath)
  // 先确认产物在盘上：否则预览服务会 404，而 404 页面照样能打印成一份"成功"的 PDF
  if (!existsSync(target)) throw new Error(`Artifact not found: ${target}`)
  const url = await renderUrlFor(target)
  const offscreen = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })

  try {
    offscreen.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await offscreen.webContents.loadURL(url)
    await waitForFonts(offscreen.webContents)
    const pdf = await offscreen.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
    })
    if (pdf.byteLength === 0) throw new Error('Print to PDF returned an empty document')

    const output = join(dirname(target), `${basename(target, extname(target))}.pdf`)
    writeFileSync(output, pdf)
    return output
  } finally {
    offscreen.destroy()
  }
}
