/**
 * 根据扩展名判断文件是否为二进制（不可编辑/不可复制为文本）。
 * 覆盖常见二进制格式；未知扩展名默认视为文本。
 */
const BINARY_EXTENSIONS = new Set([
  // 图片
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp', 'avif', 'tif', 'tiff', 'svgz',
  // 音视频
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'mp4', 'avi', 'mkv', 'mov', 'webm', 'flv',
  // 归档
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'jar', 'war',
  // 可执行 / 库
  'exe', 'dll', 'so', 'dylib', 'bin', 'msi', 'apk', 'app', 'deb', 'rpm', 'wasm',
  // 文档
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  // 字体
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // 数据 / 其他
  'db', 'sqlite', 'sqlite3', 'class', 'pyc', 'o', 'a', 'lib', 'obj', 'pdb', 'iso', 'dmg', 'dat',
])

export function isBinaryFilePath(filePath: string): boolean {
  const name = filePath.split(/[\\/]/).pop() || ''
  const dotIndex = name.lastIndexOf('.')
  if (dotIndex <= 0) return false
  const ext = name.slice(dotIndex + 1).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}
