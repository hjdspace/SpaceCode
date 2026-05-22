import { describe, it, beforeEach, afterEach, mock } from 'node:test'
import assert from 'node:assert/strict'

describe('Local Library Backend Helpers', () => {
  describe('parseYamlFrontMatter', () => {
    const parseYamlFrontMatter = (content: string): Record<string, any> | null => {
      try {
        const match = content.match(/^---\n([\s\S]*?)\n---/)
        if (!match) return null

        const yaml = match[1]
        const result: Record<string, any> = {}

        for (const line of yaml.split('\n')) {
          if (!line.trim() || line.startsWith('#')) continue
          const colonIndex = line.indexOf(':')
          if (colonIndex === -1) continue

          const key = line.slice(0, colonIndex).trim()
          let value: string | string[] = line.slice(colonIndex + 1).trim()

          if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
            value = (value as string).slice(1, -1).split(',').map(item => item.trim().replace(/^['"]|['"]$/g, ''))
          } else if (typeof value === 'string' && (value.startsWith('"') || value.startsWith("'"))) {
            value = (value as string).slice(1, -1)
          }

          result[key] = value
        }

        return result
      } catch (err) {
        return null
      }
    }

    it('should parse valid YAML front matter', () => {
      const content = `---
name: test-skill
description: A test skill
category: development
tags: [test, example]
---

# Content here`

      const result = parseYamlFrontMatter(content)
      assert.deepEqual(result, {
        name: 'test-skill',
        description: 'A test skill',
        category: 'development',
        tags: ['test', 'example']
      })
    })

    it('should return null for content without front matter', () => {
      const content = '# Just a regular markdown file'
      const result = parseYamlFrontMatter(content)
      assert.equal(result, null)
    })

    it('should handle empty front matter', () => {
      const content = `---
---

Content`
      const result = parseYamlFrontMatter(content)
      assert.ok(result === null || Object.keys(result || {}).length === 0)
    })

    it('should parse tags array correctly', () => {
      const content = `---
tags: [react, vue, angular]
---

Content`
      const result = parseYamlFrontMatter(content)
      assert.deepEqual(result?.tags, ['react', 'vue', 'angular'])
    })
  })

  describe('inferCategory', () => {
    const inferCategory = (skillPath: string, content: string): string => {
      const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (frontMatterMatch) {
        const categoryMatch = frontMatterMatch[1].match(/category:\s*(.+)/i)
        if (categoryMatch) {
          return categoryMatch[1].trim()
        }
      }

      const dirName = skillPath.split(/[\\/]/).slice(-2)[0]?.toLowerCase()
      const dirCategories: Record<string, string> = {
        'frontend': 'frontend-design',
        'design': 'frontend-design',
        'ui': 'frontend-design',
        'canvas': 'frontend-design',
        'office': 'office',
        'excel': 'office',
        'word': 'office',
        'docx': 'office',
        'pptx': 'office',
        'pdf': 'office',
        'development': 'development',
        'dev': 'development',
        'code': 'development',
        'api': 'development',
        'ai': 'ai-ml',
        'ml': 'ai-ml',
        'machine-learning': 'ai-ml',
        'mcp': 'ai-ml',
        'devops': 'devops',
        'docker': 'devops',
        'kubernetes': 'devops',
        'ci': 'devops',
        'creative': 'creative',
        'art': 'creative',
        'algorithmic': 'creative',
        'communication': 'communication',
        'comms': 'communication',
        'internal-comms': 'communication'
      }

      for (const [keyword, category] of Object.entries(dirCategories)) {
        if (dirName?.includes(keyword)) {
          return category
        }
      }

      const contentLower = content.toLowerCase()
      const keywordCategories: Record<string, string> = {
        'react': 'frontend-design',
        'vue': 'frontend-design',
        'angular': 'frontend-design',
        'css': 'frontend-design',
        'tailwind': 'frontend-design',
        'component': 'frontend-design',
        'ui design': 'frontend-design',
        'excel': 'office',
        'spreadsheet': 'office',
        'document': 'office',
        'word': 'office',
        'powerpoint': 'office',
        'presentation': 'office',
        'pdf': 'office',
        'python': 'development',
        'javascript': 'development',
        'typescript': 'development',
        'node.js': 'development',
        'api': 'development',
        'database': 'development',
        'machine learning': 'ai-ml',
        'deep learning': 'ai-ml',
        'neural network': 'ai-ml',
        'llm': 'ai-ml',
        'openai': 'ai-ml',
        'docker': 'devops',
        'kubernetes': 'devops',
        'deployment': 'devops',
        'ci/cd': 'devops',
        'pipeline': 'devops'
      }

      for (const [keyword, category] of Object.entries(keywordCategories)) {
        if (contentLower.includes(keyword)) {
          return category
        }
      }

      return 'other'
    }

    it('should infer category from YAML front matter', () => {
      const content = `---
category: ai-ml
---

AI/ML content`
      const result = inferCategory('/some/path/skill.md', content)
      assert.equal(result, 'ai-ml')
    })

    it('should infer category from directory name', () => {
      const content = 'Some frontend code'
      const result = inferCategory('/path/to/frontend/skill.md', content)
      assert.equal(result, 'frontend-design')
    })

    it('should infer category from content keywords - React', () => {
      const content = 'This skill helps with React component development'
      const result = inferCategory('/path/to/custom/skill.md', content)
      assert.equal(result, 'frontend-design')
    })

    it('should infer category from content keywords - Docker', () => {
      const content = 'Docker container management and deployment'
      const result = inferCategory('/path/to/custom/skill.md', content)
      assert.equal(result, 'devops')
    })

    it('should default to "other" category', () => {
      const content = 'Some generic content'
      const result = inferCategory('/path/to/random/skill.md', content)
      assert.equal(result, 'other')
    })
  })

  describe('Custom Directory Management Logic', () => {
    it('should add new directory to list', () => {
      const existingDirs = ['/existing']
      const newDir = '/new/path'

      if (!existingDirs.includes(newDir)) {
        existingDirs.push(newDir)
      }

      assert.ok(existingDirs.includes('/new/path'))
      assert.equal(existingDirs.length, 2)
    })

    it('should not add duplicate directory', () => {
      const existingDirs = ['/duplicate']
      const duplicateDir = '/duplicate'

      if (!existingDirs.includes(duplicateDir)) {
        existingDirs.push(duplicateDir)
      }

      assert.equal(existingDirs.filter(d => d === '/duplicate').length, 1)
    })

    it('should remove existing directory from list', () => {
      let directories = ['/keep', '/remove']
      directories = directories.filter(d => d !== '/remove')

      assert.deepEqual(directories, ['/keep'])
      assert.equal(directories.length, 1)
    })
  })
})
