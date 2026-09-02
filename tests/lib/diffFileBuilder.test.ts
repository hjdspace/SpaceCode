/**
 * Tests for diff patch utilities (src/services/diffFileBuilder.ts).
 */
import { describe, it, expect } from 'vitest'
import {
  splitPatch,
  parsePatchFileName,
  buildHunkPatch,
  computePatchStats,
  getDiffLang,
  createDiffViewData,
  buildUntrackedPatch,
} from '@/services/diffFileBuilder'

const SAMPLE_PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1234567..89abcde 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' line1',
  '-old line',
  '+new line',
  '+added line',
  ' line2',
  '@@ -20,3 +21,4 @@',
  ' ctx',
  '-removed',
  '+added2',
  ' ctx2',
].join('\n')

describe('splitPatch', () => {
  it('splits header from hunk blocks', () => {
    const { header, hunks } = splitPatch(SAMPLE_PATCH)
    expect(header.split('\n').length).toBe(4)
    expect(hunks.length).toBe(2)
    expect(hunks[0]!.startsWith('@@ -1,3 +1,4 @@')).toBe(true)
    expect(hunks[1]!.startsWith('@@ -20,3 +21,4 @@')).toBe(true)
  })

  it('handles patches with no hunks', () => {
    const { header, hunks } = splitPatch('diff --git a/x b/x\n')
    expect(hunks).toEqual([])
    expect(header).toContain('diff --git')
  })
})

describe('parsePatchFileName', () => {
  it('extracts file names from ---/+++ lines', () => {
    const { oldName, newName } = parsePatchFileName(SAMPLE_PATCH.split('\n').slice(0, 4).join('\n'))!
    expect(oldName).toBe('src/a.ts')
    expect(newName).toBe('src/a.ts')
  })

  it('handles /dev/null for new files', () => {
    const header = 'diff --git a/new.ts b/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/new.ts'
    const r = parsePatchFileName(header)!
    expect(r.oldName).toBe('new.ts')
    expect(r.newName).toBe('new.ts')
  })

  it('strips timestamps after tab', () => {
    const header = '--- a/x.ts\t2026-01-01 00:00:00\n+++ b/x.ts\t2026-01-02 00:00:00'
    const r = parsePatchFileName(header)!
    expect(r.oldName).toBe('x.ts')
  })

  it('returns null without ---/+++ lines', () => {
    expect(parsePatchFileName('diff --git a/x b/x')).toBeNull()
  })
})

describe('buildHunkPatch', () => {
  it('keeps the header and only selected hunks', () => {
    const patch = buildHunkPatch(SAMPLE_PATCH, [1])
    const lines = patch.split('\n')
    expect(lines[0]).toBe('diff --git a/src/a.ts b/src/a.ts')
    expect(patch).toContain('@@ -20,3 +21,4 @@')
    expect(patch).not.toContain('@@ -1,3 +1,4 @@')
    expect(patch).not.toContain('new line')
    expect(patch).toContain('added2')
  })

  it('supports multiple selected hunks in order', () => {
    const patch = buildHunkPatch(SAMPLE_PATCH, [1, 0])
    expect(patch.indexOf('@@ -20,3 +21,4 @@')).toBeGreaterThan(-1)
    expect(patch.indexOf('@@ -1,3 +1,4 @@')).toBeGreaterThan(-1)
    expect(patch.split('\n').filter(l => l.startsWith('@@')).length).toBe(2)
  })

  it('returns empty string for empty selection', () => {
    expect(buildHunkPatch(SAMPLE_PATCH, [])).toBe('')
  })

  it('ignores out-of-range indexes', () => {
    expect(buildHunkPatch(SAMPLE_PATCH, [5, -1])).toBe('')
  })
})

describe('computePatchStats', () => {
  it('counts additions and deletions', () => {
    expect(computePatchStats(SAMPLE_PATCH)).toEqual({ additions: 3, deletions: 2 })
  })

  it('returns zeros for binary patches', () => {
    const binary = 'diff --git a/img.png b/img.png\nBinary files a/img.png and b/img.png differ\n'
    expect(computePatchStats(binary)).toEqual({ additions: 0, deletions: 0 })
  })
})

describe('getDiffLang', () => {
  it('maps extensions to highlight.js languages', () => {
    expect(getDiffLang('a.ts')).toBe('typescript')
    expect(getDiffLang('src/x.vue')).toBe('vue')
    expect(getDiffLang('y.py')).toBe('python')
  })

  it('returns empty string for unknown extensions', () => {
    expect(getDiffLang('file.unknownext')).toBe('')
  })

  it('handles windows paths', () => {
    expect(getDiffLang('src\\a.ts')).toBe('typescript')
  })
})

describe('createDiffViewData', () => {
  it('builds DiffView data from a raw patch', () => {
    const data = createDiffViewData(SAMPLE_PATCH, 'src/a.ts')
    expect(data.oldFile.fileName).toBe('src/a.ts')
    expect(data.newFile.fileName).toBe('src/a.ts')
    expect(data.oldFile.fileLang).toBe('typescript')
    expect(data.hunks.length).toBe(2)
  })

  it('attaches content for untracked files', () => {
    const data = createDiffViewData('', 'new.ts', { newContent: 'line1\nline2' })
    expect(data.newFile.content).toBe('line1\nline2')
    expect(data.oldFile.fileName).toBe('new.ts')
  })
})

describe('buildUntrackedPatch', () => {
  it('builds a valid new-file patch with one hunk of additions', () => {
    const patch = buildUntrackedPatch('src/new.ts', 'line1\nline2')
    expect(patch).toContain('diff --git a/src/new.ts b/src/new.ts')
    expect(patch).toContain('new file mode 100644')
    expect(patch).toContain('--- /dev/null')
    expect(patch).toContain('+++ b/src/new.ts')
    expect(patch).toContain('@@ -0,0 +1,2 @@')
    expect(patch).toContain('+line1')
    expect(patch).toContain('+line2')
    // single hunk header
    expect(patch.split('\n').filter(l => l.startsWith('@@')).length).toBe(1)
  })

  it('computes correct stats from the synthesized patch', () => {
    const patch = buildUntrackedPatch('a.txt', 'x\ny')
    expect(computePatchStats(patch)).toEqual({ additions: 2, deletions: 0 })
  })

  it('is applicable via buildHunkPatch (hunk staging ready)', () => {
    const patch = buildUntrackedPatch('a.ts', 'const x = 1')
    const single = buildHunkPatch(patch, [0])
    expect(single).toContain('@@ -0,0 +1,1 @@')
  })

  it('returns empty patch for empty content', () => {
    expect(buildUntrackedPatch('a.ts', '')).toBe('')
  })

  it('normalizes windows paths', () => {
    const patch = buildUntrackedPatch('src\\win.ts', 'a')
    expect(patch).toContain('+++ b/src/win.ts')
  })
})
