const STORAGE_KEY = 'app_recent_project_roots_v1'
const MAX_ENTRIES = 24

export function normalizeProjectPathKey(path: string): string {
  return path
    .trim()
    .replace(/[/\\]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase()
}

export function pathsEqual(a: string, b: string): boolean {
  return normalizeProjectPathKey(a) === normalizeProjectPathKey(b)
}

export function getRecentProjectRoots(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed)
      ? parsed.filter((p): p is string => typeof p === 'string' && p.length > 0)
      : []
  } catch {
    return []
  }
}

export function recordRecentProjectRoot(path: string): void {
  if (!path?.trim()) return
  try {
    const key = normalizeProjectPathKey(path)
    const prev = getRecentProjectRoots()
    const next = [path, ...prev.filter((p) => normalizeProjectPathKey(p) !== key)].slice(0, MAX_ENTRIES)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota */
  }
}
