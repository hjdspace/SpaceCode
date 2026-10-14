/** 产物文件展示与预览路由用的纯函数：扩展名→图标、字节→可读大小、扩展名→用哪种预览器。 */

/** 交给内置浏览器渲染的产物（webview tab） */
const HTML_PREVIEW_EXTS = new Set(['html', 'htm'])

/**
 * 交给 officecli 渲染的办公文档（office-preview tab）。
 * 这批扩展名是二进制格式，走文本 `openFile` 只会在右侧面板显示乱码。
 */
const OFFICE_PREVIEW_EXTS = new Set(['pptx', 'docx', 'xlsx', 'pdf'])

function extOfPath(filePath: string): string {
  const name = filePath.split(/[\\/]/).pop() || ''
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function isHtmlPreviewPath(filePath: string): boolean {
  return HTML_PREVIEW_EXTS.has(extOfPath(filePath))
}

export function isOfficePreviewPath(filePath: string): boolean {
  return OFFICE_PREVIEW_EXTS.has(extOfPath(filePath))
}

export function iconFor(ext: string): string {
  const map: Record<string, string> = {
    pptx: '📊', ppt: '📊',
    docx: '📝', doc: '📝',
    xlsx: '📈', xls: '📈', csv: '📈',
    pdf: '📄',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    md: '📋', txt: '📋',
    html: '🌐', htm: '🌐',
    json: '🔧',
  }
  return map[ext] || '📁'
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
