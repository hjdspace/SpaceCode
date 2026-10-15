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

/**
 * 新生成的交付物里值得自动打开右侧预览的那些。
 *
 * 只算办公文档与 HTML：文本/代码/图片在会话里点卡片再看更符合习惯，
 * 每写一个 .ts 就抢走右面板只会变成噪音。
 */
export function isAutoPreviewPath(filePath: string): boolean {
  return isOfficePreviewPath(filePath) || isHtmlPreviewPath(filePath)
}

/**
 * 打开 Office 预览时默认进哪种模式。
 *
 * watch 模式由 officecli 起本地实时服务器，LLM 编辑文档过程中右侧预览自动刷新；
 * pdf 不在 officecli watch 的支持范围内，回退到一次性 HTML 渲染。
 */
export function resolveOfficePreviewMode(filePath: string): 'html' | 'watch' {
  return extOfPath(filePath) === 'pdf' ? 'html' : 'watch'
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
