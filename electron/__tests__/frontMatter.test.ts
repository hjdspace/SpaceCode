// @vitest-environment node
/**
 * Tests for the shared YAML front-matter parser.
 *
 * The parser was extracted from diverged copies in `skillsService.ts` and
 * `agentsService.ts`. Only the `agentsService` copy tolerated CRLF, and 106 of
 * the 138 front-matter files in `resources/skills-lib/` use CRLF — so the skills scan path
 * silently saw `null` for the majority of its own library. The last block below
 * asserts the property that was broken.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseYamlFrontMatter } from '../infra/frontMatter'

describe('parseYamlFrontMatter', () => {
  it('parses LF front matter', () => {
    const content = '---\nname: my-skill\ndescription: does things\n---\n\n# Body\n'

    expect(parseYamlFrontMatter(content)).toEqual({
      name: 'my-skill',
      description: 'does things',
    })
  })

  it('parses CRLF front matter', () => {
    const content = '---\r\nname: my-skill\r\ndescription: does things\r\n---\r\n\r\n# Body\r\n'

    expect(parseYamlFrontMatter(content)).toEqual({
      name: 'my-skill',
      description: 'does things',
    })
  })

  it('does not leave trailing carriage returns in CRLF values', () => {
    const parsed = parseYamlFrontMatter('---\r\nname: my-skill\r\n---\r\n')

    expect(parsed?.name).toBe('my-skill')
  })

  it('returns null when there is no front matter block', () => {
    expect(parseYamlFrontMatter('# Just a heading\n\nBody text')).toBeNull()
  })

  it('requires the block to open on the first line', () => {
    expect(parseYamlFrontMatter('\n---\nname: x\n---\n')).toBeNull()
  })

  it('returns null for an unterminated block', () => {
    expect(parseYamlFrontMatter('---\nname: x\n')).toBeNull()
  })

  it('parses inline arrays and unwraps quoted items', () => {
    const parsed = parseYamlFrontMatter('---\ntags: [alpha, "beta", \'gamma\']\n---\n')

    expect(parsed?.tags).toEqual(['alpha', 'beta', 'gamma'])
  })

  it('drops blank items from inline arrays', () => {
    const parsed = parseYamlFrontMatter('---\ntools: [Read, , Write]\n---\n')

    expect(parsed?.tools).toEqual(['Read', 'Write'])
  })

  it('parses a block list into an array', () => {
    const content = '---\ntools:\n  - Read\n  - Write\n  - Edit\nallowed-tools: x\n---\n'

    expect(parseYamlFrontMatter(content)).toEqual({
      tools: ['Read', 'Write', 'Edit'],
      'allowed-tools': 'x',
    })
  })

  it('unwraps quoted block list items', () => {
    const content = "---\ntags:\n  - 'one'\n  - \"two\"\n---\n"

    expect(parseYamlFrontMatter(content)?.tags).toEqual(['one', 'two'])
  })

  it('keeps a bare key as an empty string when no list follows', () => {
    const content = '---\nsummary:\nname: x\n---\n'

    expect(parseYamlFrontMatter(content)).toEqual({ summary: '', name: 'x' })
  })

  it('unwraps quoted scalar values', () => {
    const content = "---\ndescription: 'a quoted description'\nmodel: \"opus\"\n---\n"

    expect(parseYamlFrontMatter(content)).toEqual({
      description: 'a quoted description',
      model: 'opus',
    })
  })

  it('ignores lines without a colon', () => {
    const content = '---\nname: x\njust some prose\nversion: 1\n---\n'

    expect(parseYamlFrontMatter(content)).toEqual({ name: 'x', version: '1' })
  })

  it('does not consume content after the closing fence', () => {
    const content = '---\nname: x\n---\n\ncolor: should-not-be-parsed\n'

    expect(parseYamlFrontMatter(content)?.color).toBeUndefined()
  })

  it('parses a realistic SKILL.md header', () => {
    const content = [
      '---',
      'name: algorithmic-art',
      'description: Creating algorithmic art using p5.js with seeded randomness',
      'version: 1.0.0',
      'tags:',
      '  - creative',
      '  - p5.js',
      '---',
      '',
      '# Algorithmic Art',
    ].join('\n')

    expect(parseYamlFrontMatter(content)).toEqual({
      name: 'algorithmic-art',
      description: 'Creating algorithmic art using p5.js with seeded randomness',
      version: '1.0.0',
      tags: ['creative', 'p5.js'],
    })
  })

  describe('the bundled skill library', () => {
    /**
     * Every `.md` with a front-matter fence under the given library root.
     *
     * `filename` narrows the walk to one basename — `SKILL.md` for skill
     * definitions. Command definitions (`commands/*.md`) and demo scripts also
     * carry front matter but are named by their filename, so they declare no
     * `name` and must not be judged by the skill contract.
     */
    function frontMatterDocs(root: string, filename?: string, limit = 400): string[] {
      const found: string[] = []
      const walk = (dir: string): void => {
        if (found.length >= limit) return
        let entries: string[]
        try {
          entries = readdirSync(dir)
        } catch {
          return
        }
        for (const entry of entries) {
          if (found.length >= limit) return
          const full = join(dir, entry)
          let isDir = false
          try {
            isDir = statSync(full).isDirectory()
          } catch {
            continue
          }
          if (isDir) {
            walk(full)
          } else if (entry.endsWith('.md') && (!filename || entry === filename)) {
            const raw = readFileSync(full, 'utf-8')
            if (raw.startsWith('---')) found.push(raw)
          }
        }
      }
      walk(root)
      return found
    }

    it('parses front matter for every document in skills-lib', () => {
      const docs = frontMatterDocs(join(process.cwd(), 'resources', 'skills-lib'))

      expect(docs.length).toBeGreaterThan(0)

      const unparsed = docs.filter(doc => parseYamlFrontMatter(doc) === null)
      expect(unparsed).toHaveLength(0)
    })

    it('parses front matter for every document in agents-lib', () => {
      const docs = frontMatterDocs(join(process.cwd(), 'resources', 'agents-lib'))

      expect(docs.length).toBeGreaterThan(0)

      const unparsed = docs.filter(doc => parseYamlFrontMatter(doc) === null)
      expect(unparsed).toHaveLength(0)
    })

    it('resolves a name for every skill definition in skills-lib', () => {
      const docs = frontMatterDocs(join(process.cwd(), 'resources', 'skills-lib'), 'SKILL.md')

      expect(docs.length).toBeGreaterThan(0)

      // Front matter that parses but yields no `name` would still leave the
      // skills scan path without metadata, which is the failure this fixes.
      const nameless = docs.filter(doc => {
        const parsed = parseYamlFrontMatter(doc)
        return !parsed || typeof parsed.name !== 'string' || parsed.name.trim() === ''
      })

      expect(nameless).toHaveLength(0)
    })
  })
})
