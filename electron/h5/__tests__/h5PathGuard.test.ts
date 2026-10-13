// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { H5PathGuard } from '../h5PathGuard'

const IS_WIN = process.platform === 'win32'

/**
 * The gate in front of `/api/fs/*`: which paths a token holder may read.
 *
 * `realpathSync` is part of the contract here — a link is judged as its target —
 * so these cases run against a real temp tree instead of a stubbed `fs`.
 */
describe('H5PathGuard', () => {
  let box = ''
  let root = ''
  let outside = ''

  beforeAll(() => {
    box = mkdtempSync(join(tmpdir(), 'spacecode-guard-'))
    root = join(box, 'project')
    outside = join(box, 'elsewhere')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'Mixed'), { recursive: true })
    mkdirSync(outside, { recursive: true })
    writeFileSync(join(root, 'src', 'file.ts'), 'x', 'utf-8')
    writeFileSync(join(outside, 'id_rsa'), 'private', 'utf-8')
  })

  afterAll(() => {
    rmSync(box, { recursive: true, force: true })
  })

  function guardWith(...candidates: Array<string | null | undefined>): H5PathGuard {
    const guard = new H5PathGuard()
    for (const candidate of candidates) guard.addRoot(candidate)
    return guard
  }

  it('fails closed when no root has been registered', () => {
    expect(guardWith().check(join(root, 'src', 'file.ts'))).toMatchObject({
      allowed: false,
      reason: 'no-roots',
    })
  })

  it('ignores an empty, blank or non-string root rather than trusting it', () => {
    const guard = guardWith(null, undefined, '', '   ')

    expect(guard.rootCount).toBe(0)
    expect(guard.check(root).allowed).toBe(false)
  })

  it('allows the root itself, with or without a trailing separator', () => {
    const guard = guardWith(root)
    const sep = root.includes('\\') ? '\\' : '/'

    expect(guard.check(root).allowed).toBe(true)
    expect(guard.check(root + sep).allowed).toBe(true)
  })

  it('allows anything below the root, including paths that do not exist yet', () => {
    const guard = guardWith(root)

    expect(guard.check(join(root, 'src', 'file.ts')).allowed).toBe(true)
    expect(guard.check(join(root, 'not-created-yet')).allowed).toBe(true)
  })

  it('refuses a sibling directory that merely shares a prefix', () => {
    const guard = guardWith(root)

    expect(guard.check(`${root}-backup`)).toMatchObject({ allowed: false, reason: 'outside-roots' })
    expect(guard.check(outside)).toMatchObject({ allowed: false, reason: 'outside-roots' })
  })

  it('refuses a dot-segment walk out of the root', () => {
    const guard = guardWith(root)

    expect(guard.check(join(root, 'src', '..', '..', 'elsewhere', 'id_rsa')).allowed).toBe(false)
  })

  it('resolves a relative path against the process cwd, not the root', () => {
    const guard = guardWith(root)

    // `src` exists under the root, but a bare relative path names the cwd's
    // `src`, which is not registered.
    expect(guard.check('src').allowed).toBe(false)
  })

  it('registers a symlinked root as its target', () => {
    const link = join(root, 'linked')
    symlinkSync(join(root, 'src'), link)
    const guard = guardWith(link)

    expect(guard.check(join(root, 'src', 'file.ts')).allowed).toBe(true)
    expect(guard.check(outside).allowed).toBe(false)
  })

  it('judges a symlink by its target, in both directions', () => {
    const escape = join(root, 'escape')
    const inner = join(root, 'inner-link')
    symlinkSync(join(outside, 'id_rsa'), escape)
    symlinkSync(join(root, 'src', 'file.ts'), inner)
    const guard = guardWith(root)

    expect(guard.check(escape)).toMatchObject({ allowed: false, reason: 'outside-roots' })
    expect(guard.check(inner).allowed).toBe(true)
  })

  it('accepts several roots and keeps the set free of duplicates', () => {
    const guard = guardWith(root)
    guard.addRoot(outside)
    guard.addRoot(root)

    expect(guard.rootCount).toBe(2)
    expect(guard.check(outside).allowed).toBe(true)
    expect(guard.check(join(root, 'src')).allowed).toBe(true)
  })

  it.skipIf(!IS_WIN)('compares case-insensitively on Windows', () => {
    const guard = guardWith(root)

    // Unresolvable by realpath, so the comparison itself is what is tested.
    expect(guard.check(join(root, 'MISSING-FILE').toLowerCase()).allowed).toBe(true)
  })

  it.skipIf(IS_WIN)('stays case-sensitive elsewhere', () => {
    const guard = guardWith(root)

    expect(guard.check(join(root, 'mixed')).allowed).toBe(false)
  })
})
