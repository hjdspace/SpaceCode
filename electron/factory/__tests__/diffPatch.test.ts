// @vitest-environment node
/**
 * 行级补丁解析：把 `git diff --unified` 输出还原为分块补丁（hunk 头 + 带行号的
 * 增/删/上下文行），识别二进制与重命名，并按行/字节/总量上限截断。
 */
import { describe, it, expect } from 'vitest'
import {
  buildDiffFiles,
  expandNumstatPath,
  parsePatchOutput,
  type NumstatEntry,
} from '../diffPatch'

describe('parsePatchOutput', () => {
  it('parses a modified file into hunks with both-side line numbers', () => {
    const raw = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,3 +1,4 @@ function foo() {',
      ' line1',
      '-line2',
      '+line2b',
      '+line2c',
      ' line3',
      '',
    ].join('\n')

    expect(parsePatchOutput(raw)).toEqual([
      {
        path: 'src/a.ts',
        kind: 'patch',
        truncated: false,
        hunks: [
          {
            header: '@@ -1,3 +1,4 @@ function foo() {',
            lines: [
              { kind: 'ctx', oldLine: 1, newLine: 1, text: 'line1' },
              { kind: 'del', oldLine: 2, text: 'line2' },
              { kind: 'add', newLine: 2, text: 'line2b' },
              { kind: 'add', newLine: 3, text: 'line2c' },
              { kind: 'ctx', oldLine: 3, newLine: 4, text: 'line3' },
            ],
          },
        ],
      },
    ])
  })

  it('keeps indentation after the diff marker', () => {
    const raw = [
      'diff --git a/f.ts b/f.ts',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1,1 +1,2 @@',
      '  indented ctx',
      '+    indented add',
      '',
    ].join('\n')

    const lines = parsePatchOutput(raw)[0].hunks[0].lines
    expect(lines[0].text).toBe(' indented ctx')
    expect(lines[1].text).toBe('    indented add')
  })

  it('handles new files (adds only) and deleted files (dels only)', () => {
    const raw = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1,2 @@',
      '+one',
      '+two',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-x',
      '-y',
    ].join('\n')

    const [created, removed] = parsePatchOutput(raw)
    expect(created.hunks[0].lines).toEqual([
      { kind: 'add', newLine: 1, text: 'one' },
      { kind: 'add', newLine: 2, text: 'two' },
    ])
    expect(removed.hunks[0].lines).toEqual([
      { kind: 'del', oldLine: 1, text: 'x' },
      { kind: 'del', oldLine: 2, text: 'y' },
    ])
  })

  it('detects binary files without hunks', () => {
    const raw = [
      'diff --git a/assets/logo.png b/assets/logo.png',
      'index 3333333..4444444 100644',
      'Binary files a/assets/logo.png and b/assets/logo.png differ',
    ].join('\n')

    expect(parsePatchOutput(raw)).toEqual([
      { path: 'assets/logo.png', kind: 'binary', truncated: false, hunks: [] },
    ])
  })

  it('detects a pure rename and keeps the old path', () => {
    const raw = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 100%',
      'rename from src/old.ts',
      'rename to src/new.ts',
    ].join('\n')

    expect(parsePatchOutput(raw)).toEqual([
      {
        path: 'src/new.ts',
        kind: 'renamed',
        truncated: false,
        hunks: [],
        oldPath: 'src/old.ts',
      },
    ])
  })

  it('treats a rename with content changes as a patch file', () => {
    const raw = [
      'diff --git a/a.ts b/b.ts',
      'similarity index 90%',
      'rename from a.ts',
      'rename to b.ts',
      'index 1111111..2222222 100644',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n')

    const parsed = parsePatchOutput(raw)
    expect(parsed[0]).toMatchObject({
      path: 'b.ts',
      kind: 'patch',
      oldPath: 'a.ts',
      hunks: [{ lines: [{ kind: 'del' }, { kind: 'add' }] }],
    })
    // 行号取自 @@ -1 +1 @@（计数缺省为 1）。
    expect(parsed[0].hunks[0].lines[0].oldLine).toBe(1)
    expect(parsed[0].hunks[0].lines[1].newLine).toBe(1)
  })

  it('ignores no-newline markers', () => {
    const raw = [
      'diff --git a/f.ts b/f.ts',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1 +1 @@',
      '-plain',
      '+kept',
      '\\ No newline at end of file',
    ].join('\n')

    expect(parsePatchOutput(raw)[0].hunks[0].lines).toHaveLength(2)
  })

  it('parses multiple files in output order', () => {
    const raw = [
      'diff --git a/one.ts b/one.ts',
      '--- a/one.ts',
      '+++ b/one.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git a/two.md b/two.md',
      '--- a/two.md',
      '+++ b/two.md',
      '@@ -1 +1,2 @@',
      ' same',
      '+added',
    ].join('\n')

    const parsed = parsePatchOutput(raw)
    expect(parsed.map((file) => file.path)).toEqual(['one.ts', 'two.md'])
  })

  it('truncates a single file at the line limit and keeps parsing later files', () => {
    const raw = [
      'diff --git a/big.ts b/big.ts',
      '--- a/big.ts',
      '+++ b/big.ts',
      '@@ -1,4 +1,4 @@',
      ' c1',
      ' c2',
      ' c3',
      ' c4',
      'diff --git a/small.ts b/small.ts',
      '--- a/small.ts',
      '+++ b/small.ts',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n')

    const parsed = parsePatchOutput(raw, { maxLinesPerFile: 3 })
    expect(parsed[0]).toMatchObject({ path: 'big.ts', kind: 'patch', truncated: true })
    // hunk 头占 1 行，正文保留 2 行。
    expect(parsed[0].hunks[0].lines).toHaveLength(2)
    expect(parsed[1]).toMatchObject({ path: 'small.ts', truncated: false })
    expect(parsed[1].hunks[0].lines).toHaveLength(2)
  })

  it('truncates a file when the next line would break the byte budget', () => {
    const raw = [
      'diff --git a/long.ts b/long.ts',
      '--- a/long.ts',
      '+++ b/long.ts',
      '@@ -1,2 +1,2 @@',
      '-tiny',
      '+' + 'x'.repeat(80),
    ].join('\n')

    const parsed = parsePatchOutput(raw, { maxBytesPerFile: 32 })
    expect(parsed[0].truncated).toBe(true)
    const lines = parsed[0].hunks[0].lines
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('tiny')
  })

  it('drops patches beyond the task-level total line budget', () => {
    const block = (name: string) => [
      `diff --git a/${name} b/${name}`,
      `--- a/${name}`,
      `+++ b/${name}`,
      '@@ -1,3 +1,3 @@',
      ` ${name}-1`,
      ` ${name}-2`,
      ` ${name}-3`,
    ].join('\n')
    const parsed = parsePatchOutput([block('one'), block('two')].join('\n'), {
      maxTotalLines: 4,
    })

    // 第一个文件放满预算（头 + 3 行），第二个文件整块被丢弃但保留 truncated 标记。
    expect(parsed[0].hunks[0].lines).toHaveLength(3)
    expect(parsed[0].truncated).toBe(false)
    expect(parsed[1]).toMatchObject({ kind: 'patch', truncated: true, hunks: [] })
  })

  it('applies the task-level byte budget across files', () => {
    const block = (name: string) => [
      `diff --git a/${name} b/${name}`,
      `--- a/${name}`,
      `+++ b/${name}`,
      '@@ -1 +1 @@',
      ` ${'x'.repeat(10)}`,
    ].join('\n')
    const parsed = parsePatchOutput([block('one'), block('two')].join('\n'), {
      maxBytesPerFile: 1000,
      maxTotalBytes: 20,
    })

    // 文件头行都在预算内；正文超长行谁也进不来，两个文件都带截断标记。
    expect(parsed[0].hunks[0].lines).toHaveLength(0)
    expect(parsed[0].truncated).toBe(true)
    expect(parsed[1].hunks).toHaveLength(0)
    expect(parsed[1].truncated).toBe(true)
  })

  it('keeps a content-bearing rename as a patch file when the budget drops it', () => {
    const raw = [
      'diff --git a/old.ts b/new.ts',
      'similarity index 90%',
      'rename from old.ts',
      'rename to new.ts',
      '--- a/new.ts',
      '+++ b/new.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n')

    // 预算耗尽时不能说「内容无变化」：必须保持 patch + truncated。
    const parsed = parsePatchOutput(raw, { maxTotalLines: 0 })
    expect(parsed[0]).toMatchObject({
      path: 'new.ts',
      kind: 'patch',
      truncated: true,
      hunks: [],
      oldPath: 'old.ts',
    })
  })

  it('treats header-lookalike lines inside a hunk as content', () => {
    const raw = [
      'diff --git a/f.conf b/f.conf',
      '--- a/f.conf',
      '+++ b/f.conf',
      '@@ -1,1 +1,1 @@',
      '--- diff marker',
      '+++ b/evil.ts',
    ].join('\n')

    const parsed = parsePatchOutput(raw)
    expect(parsed[0].path).toBe('f.conf')
    expect(parsed[0].hunks[0].lines).toEqual([
      { kind: 'del', oldLine: 1, text: '-- diff marker' },
      { kind: 'add', newLine: 1, text: '++ b/evil.ts' },
    ])
  })

  it('tolerates junk before the first file header', () => {
    expect(parsePatchOutput('warning: in the working copy...\n')).toEqual([])
    expect(parsePatchOutput('')).toEqual([])
  })
})

describe('expandNumstatPath', () => {
  it('expands braced rename paths', () => {
    expect(expandNumstatPath('src/{old.ts => new.ts}')).toEqual({
      path: 'src/new.ts',
      oldPath: 'src/old.ts',
    })
    // git 的常见写法：公共后缀在花括号外，两侧都成立。
    expect(expandNumstatPath('src/{a => b}.ts')).toEqual({
      path: 'src/b.ts',
      oldPath: 'src/a.ts',
    })
  })

  it('expands non-braced rename paths', () => {
    expect(expandNumstatPath('docs/a.md => docs/b.md')).toEqual({
      path: 'docs/b.md',
      oldPath: 'docs/a.md',
    })
  })

  it('keeps plain paths untouched', () => {
    expect(expandNumstatPath('src/a.ts')).toEqual({ path: 'src/a.ts' })
  })
})

describe('buildDiffFiles', () => {
  const entry = (
    path: string,
    additions: number,
    deletions: number,
    binary = false,
  ): NumstatEntry => ({ path, additions, deletions, binary })

  it('merges numstat counts with parsed patches by path', () => {
    const patched = parsePatchOutput([
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n'))

    expect(buildDiffFiles([entry('src/a.ts', 1, 1)], patched)).toEqual([
      {
        path: 'src/a.ts',
        additions: 1,
        deletions: 1,
        kind: 'patch',
        truncated: false,
        hunks: patched[0].hunks,
      },
    ])
  })

  it('matches braced numstat rename entries against the new path', () => {
    const patched = parsePatchOutput([
      'diff --git a/src/{old.ts => new.ts} b/src/{old.ts => new.ts}',
      'similarity index 100%',
      'rename from src/old.ts',
      'rename to src/new.ts',
    ].join('\n'))

    const files = buildDiffFiles([entry('src/{old.ts => new.ts}', 0, 0)], patched)
    expect(files).toEqual([
      {
        path: 'src/new.ts',
        additions: 0,
        deletions: 0,
        kind: 'renamed',
        truncated: false,
        hunks: [],
        oldPath: 'src/old.ts',
      },
    ])
  })

  it('marks unmatched text entries as missing and binary ones as binary', () => {
    const files = buildDiffFiles(
      [entry('src/a.ts', 3, 1), entry('assets/logo.png', 0, 0, true)],
      [],
    )
    expect(files.map((file) => file.kind)).toEqual(['missing', 'binary'])
    expect(files.map((file) => file.path)).toEqual(['src/a.ts', 'assets/logo.png'])
  })

  it('keeps numstat order and drops patch files missing from numstat', () => {
    const patched = parsePatchOutput([
      'diff --git a/ghost.ts b/ghost.ts',
      '--- a/ghost.ts',
      '+++ b/ghost.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n'))

    const files = buildDiffFiles([entry('one.ts', 1, 0), entry('two.md', 0, 1)], patched)
    expect(files.map((file) => file.path)).toEqual(['one.ts', 'two.md'])
    expect(files.every((file) => file.kind === 'missing')).toBe(true)
  })
})
