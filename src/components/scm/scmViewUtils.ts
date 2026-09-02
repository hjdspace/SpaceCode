/**
 * Shared pure view helpers for SCM components.
 */
import type { ScmFile } from '@/stores/scm'

export function getLangIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'TS', tsx: 'TS', js: 'JS', jsx: 'JS',
    vue: 'Vue', py: 'PY', rs: 'RS', go: 'GO',
    java: 'JV', kt: 'KT', swift: 'SV',
    c: 'C', cpp: 'C++', h: 'H', hpp: 'H++',
    md: 'MD', json: 'JN', yaml: 'YM', yml: 'YM',
    html: 'HT', css: 'CS', scss: 'SC', less: 'LS',
    sh: 'SH', bash: 'Bash', sql: 'SQL', xml: 'XM',
    svg: 'SVG', png: 'IMG', jpg: 'IMG', gif: 'IMG',
  }
  return map[ext] || '?'
}

export function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || path
}

export function truncatePath(path: string, maxLen = 20): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  if (parts.length <= 1) return ''
  const dirParts = parts.slice(0, -1)
  const dirPath = dirParts.join('/')
  if (dirPath.length <= maxLen) return dirPath
  return '.../' + dirParts.slice(-2).join('/')
}

export function getStatusLetter(file: ScmFile): string {
  const map: Record<string, string> = {
    modified: 'M', added: 'A', deleted: 'D',
    renamed: 'R', copied: 'C', untracked: 'U',
    ignored: 'I', conflict: 'C',
  }
  return map[file.status] || file.statusCode
}

export interface ParsedRef { name: string; type: 'head' | 'local' | 'remote' | 'tag' }

export function parseRefs(refsStr: string): ParsedRef[] {
  const result: ParsedRef[] = []
  for (const part of refsStr.split(', ')) {
    const trimmed = part.trim()
    if (!trimmed || trimmed === 'HEAD') continue
    if (trimmed.startsWith('tag: ')) result.push({ name: trimmed.substring(5), type: 'tag' })
    else if (trimmed.startsWith('origin/')) result.push({ name: trimmed.replace('origin/', ''), type: 'remote' })
    else result.push({ name: trimmed, type: 'local' })
  }
  return result
}

export function getRelativeDate(dateStr: string): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d`
    return new Date(dateStr).toLocaleDateString()
  } catch { return '' }
}
