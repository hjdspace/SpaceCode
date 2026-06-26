/** 产物文件展示用的纯函数：扩展名→图标、字节→可读大小。供 ArtifactsPanel 与 ArtifactSummaryCard 共用。 */

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
