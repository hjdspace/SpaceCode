/**
 * Diff patch utilities — pure functions operating on raw unified diff text.
 *
 * The `@git-diff-view/vue` DiffView component accepts
 * `data: { oldFile, newFile, hunks: string[] }`, so the renderer only needs
 * to split the raw `git diff` output into a header + hunk blocks.
 */

export interface SplitPatchResult {
  /** Lines before the first hunk header (`diff --git`, `index`, `---`, `+++`...). */
  header: string
  /** Hunk blocks, each starting with `@@ ... @@`. */
  hunks: string[]
}

/** Split a raw single-file patch into header and hunk blocks. */
export function splitPatch(raw: string): SplitPatchResult {
  const lines = raw.split('\n')
  const headerLines: string[] = []
  const hunks: string[] = []
  let currentHunk: string[] | null = null

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk.join('\n'))
      currentHunk = [line]
    } else if (currentHunk) {
      currentHunk.push(line)
    } else {
      headerLines.push(line)
    }
  }
  if (currentHunk) hunks.push(currentHunk.join('\n'))

  return { header: headerLines.join('\n'), hunks }
}

/**
 * Extract a/b file names from the patch header (`+++ b/path` line).
 * Returns null for paths that cannot be resolved (e.g. /dev/null).
 */
export function parsePatchFileName(header: string): { oldName: string; newName: string } | null {
  let oldName: string | null = null
  let newName: string | null = null
  for (const line of header.split('\n')) {
    if (oldName === null && line.startsWith('--- ')) {
      oldName = normalizePatchPath(line.slice(4))
    } else if (newName === null && line.startsWith('+++ ')) {
      newName = normalizePatchPath(line.slice(4))
    }
  }
  if (oldName === null && newName === null) return null
  return { oldName: oldName ?? newName ?? '', newName: newName ?? oldName ?? '' }
}

function normalizePatchPath(raw: string): string | null {
  const trimmed = raw.replace(/\r$/, '').trim()
  if (!trimmed || trimmed === '/dev/null') return null
  // Strip possible trailing timestamp ("path\t2026-01-01 ...")
  const path = trimmed.split('\t')[0] ?? trimmed
  if (path.startsWith('a/') || path.startsWith('b/')) return path.slice(2)
  return path
}

/**
 * Build a reduced patch containing only the selected hunks (same header).
 *
 * Hunk old-side line numbers are relative to the file, not to other hunks,
 * so dropping hunks keeps the remaining ones applicable — this is the same
 * principle used by GitLens for hunk staging.
 */
export function buildHunkPatch(raw: string, selectedHunkIndexes: number[]): string {
  const { header, hunks } = splitPatch(raw)
  if (selectedHunkIndexes.length === 0) return ''
  const selected = selectedHunkIndexes
    .filter(i => i >= 0 && i < hunks.length)
    .map(i => hunks[i]!)
  if (selected.length === 0) return ''
  return `${header}\n${selected.join('\n')}\n`
}

export interface PatchStats {
  additions: number
  deletions: number
}

/** Count +/- lines across all hunks (binary patches yield 0/0). */
export function computePatchStats(raw: string): PatchStats {
  const { hunks } = splitPatch(raw)
  let additions = 0
  let deletions = 0
  for (const hunk of hunks) {
    for (const line of hunk.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++
    }
  }
  return { additions, deletions }
}

/**
 * Synthesize a valid new-file patch for an untracked file (VSCode shows the
 * whole file as additions). The result is directly applicable with
 * `git apply --cached`, so hunk staging works on untracked files too.
 */
export function buildUntrackedPatch(fileName: string, content: string): string {
  if (!content) return ''
  const normalized = fileName.replace(/\\/g, '/')
  const contentLines = content.split('\n')
  // Drop the trailing empty entry produced by a final newline
  if (contentLines.length > 0 && contentLines[contentLines.length - 1] === '') {
    contentLines.pop()
  }
  if (contentLines.length === 0) return ''
  const lines = [
    `diff --git a/${normalized} b/${normalized}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${normalized}`,
    `@@ -0,0 +1,${contentLines.length} @@`,
    ...contentLines.map(l => `+${l}`),
  ]
  return lines.join('\n') + '\n'
}

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', vue: 'vue', py: 'python',
  rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  cs: 'csharp', php: 'php', rb: 'ruby', sh: 'shell', bash: 'shell',
  json: 'json', yml: 'yaml', yaml: 'yaml', md: 'markdown',
  html: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', xml: 'xml', toml: 'ini',
}

/** Map a file name to a highlight.js language identifier. */
export function getDiffLang(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? fileName
  const ext = base.includes('.') ? base.split('.').pop()!.toLowerCase() : ''
  return EXT_LANG_MAP[ext] ?? ''
}

/**
 * Build the `data` object consumed by the `@git-diff-view/vue` DiffView
 * component. For untracked/new files pass newContent to render all lines as
 * additions with real content; otherwise leave contents empty and let the
 * view render from hunks only.
 *
 * Each hunk string MUST carry the full unified-diff header (`diff --git`,
 * `---`, `+++`) and end with a trailing newline: the library's DiffParser
 * scans for the `---`/`+++` lines before reading hunks and silently yields
 * zero hunks from a bare `@@` block, and it parses each hunk string
 * independently — a missing trailing newline would desynchronize the hunk's
 * last line text (no `\n`) from the full-content lines (with `\n`).
 */
export function createDiffViewData(
  raw: string,
  fileName: string,
  opts?: { oldContent?: string; newContent?: string }
): { oldFile: { fileName: string; fileLang: string; content: string }; newFile: { fileName: string; fileLang: string; content: string }; hunks: string[] } {
  const { header, hunks } = splitPatch(raw)
  const parsed = parsePatchFileName(header)
  const name = fileName || parsed?.newName || parsed?.oldName || ''
  const lang = getDiffLang(name)
  return {
    oldFile: { fileName: parsed?.oldName || name, fileLang: lang, content: opts?.oldContent ?? '' },
    newFile: { fileName: parsed?.newName || name, fileLang: lang, content: opts?.newContent ?? '' },
    // `splitPatch` preserves the raw patch's final newline on the last hunk,
    // so normalize instead of appending a second one. The parser treats an
    // extra newline as an empty context line and can report a false mismatch.
    hunks: hunks.map(h => `${header}\n${h.replace(/\n+$/, '')}\n`),
  }
}
