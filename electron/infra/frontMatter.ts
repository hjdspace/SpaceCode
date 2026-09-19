/**
 * Minimal YAML front-matter parser for Skill and Agent definition files.
 *
 * Handles the shapes the bundled libraries actually use:
 *  - LF **and** CRLF line endings. This is load-bearing: 106 of the 138
 *    front-matter files under `skills-lib/` use CRLF, and a `\n`-only matcher
 *    silently returns null for every one of them.
 *  - `key: value`
 *  - `key: [a, b]` inline arrays (quotes unwrapped, blank items dropped)
 *  - `key:` followed by an indented `- item` block list
 *
 * Returns null when the document has no front-matter block, or when parsing
 * throws. Values are returned as authored — no type coercion beyond the
 * array/quoted-string handling above.
 *
 * Extracted from diverged copies in `skillsService.ts` and `agentsService.ts`;
 * only the `agentsService` copy handled CRLF, so the skills scan path never saw
 * front matter for CRLF-authored skills.
 */
export function parseYamlFrontMatter(content: string): Record<string, any> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null

  try {
    const yaml = match[1]
    const result: Record<string, any> = {}
    const lines = yaml.split('\n').map(line => line.replace(/\r$/, ''))

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      // Block-list items are consumed by their key line; skip them and blanks.
      if (!line.trim() || /^\s+-\s/.test(line)) continue

      const colonIndex = line.indexOf(':')
      if (colonIndex === -1) continue

      const key = line.slice(0, colonIndex).trim()
      let value: string | string[] = line.slice(colonIndex + 1).trim()

      if (value === '') {
        // Possibly a YAML block list: following indented "- item" lines.
        const items: string[] = []
        let j = i + 1
        while (j < lines.length && /^\s+-\s/.test(lines[j])) {
          items.push(lines[j].replace(/^\s+-\s/, '').trim().replace(/^['"]|['"]$/g, ''))
          j++
        }
        if (items.length > 0) {
          result[key] = items
          i = j - 1
          continue
        }
        result[key] = ''
        continue
      }

      if (value.startsWith('[') && value.endsWith(']')) {
        value = value
          .slice(1, -1)
          .split(',')
          .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
      } else if (value.startsWith('"') || value.startsWith("'")) {
        value = value.slice(1, -1)
      }

      result[key] = value
    }

    return result
  } catch {
    return null
  }
}
