/**
 * File-type icon lookup. The table lives in fileIcons.json so the icon-subset
 * generator (scripts/generate-file-icons.mjs) reads the exact same source.
 */
import iconMap from './fileIcons.json'

const NAMES = iconMap.names as Record<string, string>
const PATTERNS = iconMap.patterns as [string, string][]
const EXTENSIONS = iconMap.extensions as Record<string, string>

export const FILE_ICON_PREFIX: string = iconMap.prefix
export const FILE_ICON_DEFAULT: string = iconMap.default

export function getFileIconName(fileName: string): string {
  const lower = fileName.toLowerCase()

  const exact = NAMES[lower]
  if (exact) return exact

  for (const [needle, icon] of PATTERNS) {
    if (lower.includes(needle)) return icon
  }

  const dot = lower.lastIndexOf('.')
  const extension = dot > 0 ? lower.slice(dot + 1) : ''
  return EXTENSIONS[extension] ?? FILE_ICON_DEFAULT
}

export function getFileIcon(fileName: string): string {
  return `${FILE_ICON_PREFIX}:${getFileIconName(fileName)}`
}
