import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  hashDir,
  hashDirContents,
  isIgnoredEntry,
  sanitizeId,
  parseFrontmatterText,
  readFrontmatter,
  isSkillDir,
  inferSkillId,
  copyDirRecursive,
  createLink,
  buildFileTree,
  inspectPath,
  removePath,
  expandTilde,
  collectRelativeFiles,
  readRelativeFile,
  discoverAgentSkillPaths,
  sanitizeBasename,
  normalizePathKey,
} from '../fsutil'

// ── Test helpers ───────────────────────────────────────────────────

let tmpDir: string

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-mgr-test-'))
  return dir
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

// ── Tests ──────────────────────────────────────────────────────────

describe('fsutil', () => {
  beforeEach(() => {
    tmpDir = makeTmpDir()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── isIgnoredEntry ──────────────────────────────────────────────

  describe('isIgnoredEntry', () => {
    it('ignores known noise directories', () => {
      expect(isIgnoredEntry('.git')).toBe(true)
      expect(isIgnoredEntry('node_modules')).toBe(true)
      expect(isIgnoredEntry('target')).toBe(true)
      expect(isIgnoredEntry('__pycache__')).toBe(true)
      expect(isIgnoredEntry('.venv')).toBe(true)
      expect(isIgnoredEntry('venv')).toBe(true)
      expect(isIgnoredEntry('.idea')).toBe(true)
      expect(isIgnoredEntry('output')).toBe(true)
      expect(isIgnoredEntry('.DS_Store')).toBe(true)
    })

    it('ignores .tmp and .swp files', () => {
      expect(isIgnoredEntry('foo.tmp')).toBe(true)
      expect(isIgnoredEntry('bar.swp')).toBe(true)
    })

    it('does not ignore normal names', () => {
      expect(isIgnoredEntry('SKILL.md')).toBe(false)
      expect(isIgnoredEntry('src')).toBe(false)
      expect(isIgnoredEntry('README.md')).toBe(false)
    })
  })

  // ── hashDir ─────────────────────────────────────────────────────

  describe('hashDir', () => {
    it('produces stable hash for same content', () => {
      const dirA = path.join(tmpDir, 'skill-a')
      const dirB = path.join(tmpDir, 'skill-b')
      writeFile(path.join(dirA, 'SKILL.md'), '---\nname: Test\n---\n# Test')
      writeFile(path.join(dirB, 'SKILL.md'), '---\nname: Test\n---\n# Test')

      const hashA = hashDir(dirA)
      const hashB = hashDir(dirB)
      // Contents are the same but root dir names differ, so hashes differ
      expect(hashA).not.toBe(hashB)

      // hashDirContents should be the same (ignores root name)
      expect(hashDirContents(dirA)).toBe(hashDirContents(dirB))
    })

    it('produces same hash when called twice', () => {
      const dir = path.join(tmpDir, 'skill')
      writeFile(path.join(dir, 'SKILL.md'), 'content')
      const h1 = hashDir(dir)
      const h2 = hashDir(dir)
      expect(h1).toBe(h2)
    })

    it('excludes node_modules from hash', () => {
      const dir1 = path.join(tmpDir, 'skill1')
      writeFile(path.join(dir1, 'SKILL.md'), 'content')
      writeFile(path.join(dir1, 'node_modules', 'pkg', 'index.js'), 'noise')

      writeFile(path.join(tmpDir, 'skill1-copy', 'SKILL.md'), 'content')

      // hashDirContents ignores root name, so should match
      const hash1 = hashDirContents(dir1)
      const hash2 = hashDirContents(path.join(tmpDir, 'skill1-copy'))
      expect(hash1).toBe(hash2)
    })

    it('returns hex digest string', () => {
      const dir = path.join(tmpDir, 'skill')
      writeFile(path.join(dir, 'SKILL.md'), 'content')
      const hash = hashDir(dir)
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  // ── sanitizeId ─────────────────────────────────────────────────

  describe('sanitizeId', () => {
    it('keeps alphanumeric, dash, underscore', () => {
      expect(sanitizeId('my-skill_123')).toBe('my-skill_123')
    })

    it('replaces spaces with dashes', () => {
      expect(sanitizeId('my skill')).toBe('my-skill')
    })

    it('replaces dots and slashes with dashes', () => {
      expect(sanitizeId('my.skill/name')).toBe('my-skill-name')
    })

    it('trims leading/trailing dashes', () => {
      expect(sanitizeId('--my-skill--')).toBe('my-skill')
    })

    it('returns "skill" for empty input', () => {
      expect(sanitizeId('')).toBe('skill')
      expect(sanitizeId('   ')).toBe('skill')
    })
  })

  // ── parseFrontmatterText ───────────────────────────────────────

  describe('parseFrontmatterText', () => {
    it('parses simple key: value frontmatter', () => {
      const content = `---
name: My Skill
description: A test skill
---
# Body`
      const map = parseFrontmatterText(content)
      expect(map.get('name')).toBe('My Skill')
      expect(map.get('description')).toBe('A test skill')
    })

    it('returns empty map for no frontmatter', () => {
      const content = '# Just a body'
      const map = parseFrontmatterText(content)
      expect(map.size).toBe(0)
    })

    it('strips surrounding quotes', () => {
      const content = `---
name: "Quoted Name"
---
body`
      const map = parseFrontmatterText(content)
      expect(map.get('name')).toBe('Quoted Name')
    })

    it('handles single-quoted values', () => {
      const content = `---
name: 'Single Quoted'
---
body`
      const map = parseFrontmatterText(content)
      expect(map.get('name')).toBe('Single Quoted')
    })
  })

  // ── readFrontmatter / isSkillDir / inferSkillId ────────────────

  describe('readFrontmatter', () => {
    it('reads frontmatter from SKILL.md', () => {
      const dir = path.join(tmpDir, 'my-skill')
      writeFile(path.join(dir, 'SKILL.md'), `---
name: Test Skill
description: A description
---
# Test`)
      const fm = readFrontmatter(dir)
      expect(fm.map.get('name')).toBe('Test Skill')
      expect(fm.map.get('description')).toBe('A description')
    })

    it('returns empty frontmatter for missing SKILL.md', () => {
      const dir = path.join(tmpDir, 'no-skill')
      fs.mkdirSync(dir, { recursive: true })
      const fm = readFrontmatter(dir)
      expect(fm.map.size).toBe(0)
    })
  })

  describe('isSkillDir', () => {
    it('returns true for dir with SKILL.md', () => {
      const dir = path.join(tmpDir, 'skill')
      writeFile(path.join(dir, 'SKILL.md'), '# Test')
      expect(isSkillDir(dir)).toBe(true)
    })

    it('returns false for dir without SKILL.md', () => {
      const dir = path.join(tmpDir, 'not-a-skill')
      fs.mkdirSync(dir, { recursive: true })
      expect(isSkillDir(dir)).toBe(false)
    })
  })

  describe('inferSkillId', () => {
    it('uses frontmatter name when available', () => {
      const dir = path.join(tmpDir, 'dir-name')
      writeFile(path.join(dir, 'SKILL.md'), `---
name: Frontmatter Name
---
body`)
      expect(inferSkillId(dir)).toBe('Frontmatter-Name')
    })

    it('falls back to directory name', () => {
      const dir = path.join(tmpDir, 'my-cool-skill')
      writeFile(path.join(dir, 'SKILL.md'), '# No frontmatter')
      expect(inferSkillId(dir)).toBe('my-cool-skill')
    })
  })

  // ── copyDirRecursive ───────────────────────────────────────────

  describe('copyDirRecursive', () => {
    it('copies all files recursively', () => {
      const src = path.join(tmpDir, 'src')
      const dst = path.join(tmpDir, 'dst')
      writeFile(path.join(src, 'SKILL.md'), 'content')
      writeFile(path.join(src, 'sub', 'file.ts'), 'code')

      copyDirRecursive(src, dst)

      expect(fs.readFileSync(path.join(dst, 'SKILL.md'), 'utf-8')).toBe('content')
      expect(fs.readFileSync(path.join(dst, 'sub', 'file.ts'), 'utf-8')).toBe('code')
    })

    it('skips ignored entries', () => {
      const src = path.join(tmpDir, 'src')
      const dst = path.join(tmpDir, 'dst')
      writeFile(path.join(src, 'SKILL.md'), 'content')
      writeFile(path.join(src, 'node_modules', 'pkg', 'index.js'), 'noise')

      copyDirRecursive(src, dst)

      expect(fs.existsSync(path.join(dst, 'SKILL.md'))).toBe(true)
      expect(fs.existsSync(path.join(dst, 'node_modules'))).toBe(false)
    })
  })

  // ── createLink ─────────────────────────────────────────────────

  describe('createLink', () => {
    it('creates symlink on supported platforms', () => {
      const center = path.join(tmpDir, 'center-skill')
      const target = path.join(tmpDir, 'agent-skill')
      writeFile(path.join(center, 'SKILL.md'), 'content')

      const result = createLink(center, target, 'copy')

      if (result.actualMode === 'link') {
        expect(isSymlink(target)).toBe(true)
      } else {
        // Fallback to copy
        expect(fs.existsSync(path.join(target, 'SKILL.md'))).toBe(true)
      }
      expect(result.error).toBeNull()
    })

    it('returns error when target already exists', () => {
      const center = path.join(tmpDir, 'center-skill')
      const target = path.join(tmpDir, 'agent-skill')
      writeFile(path.join(center, 'SKILL.md'), 'content')
      fs.mkdirSync(target, { recursive: true })

      const result = createLink(center, target, 'copy')
      expect(result.error).not.toBeNull()
    })
  })

  // ── buildFileTree ──────────────────────────────────────────────

  describe('buildFileTree', () => {
    it('builds a tree from a directory', () => {
      const dir = path.join(tmpDir, 'skill')
      writeFile(path.join(dir, 'SKILL.md'), 'content')
      writeFile(path.join(dir, 'sub', 'file.ts'), 'code')

      const tree = buildFileTree(dir, 3)
      expect(tree).not.toBeNull()
      expect(tree!.nodeType).toBe('dir')
      expect(tree!.children).not.toBeNull()
      const names = tree!.children!.map((c) => c.name)
      expect(names).toContain('SKILL.md')
      expect(names).toContain('sub')
    })

    it('respects max depth', () => {
      const dir = path.join(tmpDir, 'skill')
      writeFile(path.join(dir, 'a', 'b', 'c', 'deep.md'), 'content')

      const tree = buildFileTree(dir, 1)
      expect(tree).not.toBeNull()
      // Should have 'a' dir but not go deeper than depth 1
      const aNode = tree!.children!.find((c) => c.name === 'a')
      expect(aNode).toBeDefined()
      // a's children should be null or empty due to depth limit
      if (aNode!.children) {
        expect(aNode!.children.length).toBe(0)
      }
    })
  })

  // ── inspectPath ────────────────────────────────────────────────

  describe('inspectPath', () => {
    it('returns missing for non-existent path', () => {
      const result = inspectPath(path.join(tmpDir, 'nonexistent'))
      expect(result.kind).toBe('missing')
    })

    it('returns dir for a directory', () => {
      const result = inspectPath(tmpDir)
      expect(result.kind).toBe('dir')
    })

    it('returns file for a file', () => {
      const filePath = path.join(tmpDir, 'test.txt')
      fs.writeFileSync(filePath, 'content')
      const result = inspectPath(filePath)
      expect(result.kind).toBe('file')
    })
  })

  // ── removePath ─────────────────────────────────────────────────

  describe('removePath', () => {
    it('removes a file', () => {
      const filePath = path.join(tmpDir, 'test.txt')
      fs.writeFileSync(filePath, 'content')
      removePath(filePath)
      expect(fs.existsSync(filePath)).toBe(false)
    })

    it('removes a directory tree', () => {
      const dir = path.join(tmpDir, 'subdir')
      writeFile(path.join(dir, 'file.txt'), 'content')
      removePath(dir)
      expect(fs.existsSync(dir)).toBe(false)
    })

    it('does nothing for non-existent path', () => {
      const nonExistent = path.join(tmpDir, 'nope')
      removePath(nonExistent) // should not throw
    })
  })

  // ── expandTilde ────────────────────────────────────────────────

  describe('expandTilde', () => {
    it('expands ~/ to home directory', () => {
      const expanded = expandTilde('~/skills')
      expect(expanded).toContain('skills')
      expect(expanded).not.toContain('~')
    })

    it('leaves absolute paths unchanged', () => {
      const abs = path.join(tmpDir, 'foo')
      expect(expandTilde(abs)).toBe(abs)
    })
  })

  // ── collectRelativeFiles ───────────────────────────────────────

  describe('collectRelativeFiles', () => {
    it('递归收集相对路径', () => {
      writeFile(path.join(tmpDir, 'SKILL.md'), 'root')
      writeFile(path.join(tmpDir, 'sub', 'nested.md'), 'nested')
      writeFile(path.join(tmpDir, 'sub', 'deep', 'leaf.txt'), 'leaf')

      expect([...collectRelativeFiles(tmpDir)].sort()).toEqual([
        'SKILL.md',
        path.join('sub', 'deep', 'leaf.txt'),
        path.join('sub', 'nested.md'),
      ])
    })

    it('目录不存在时返回空集合', () => {
      expect(collectRelativeFiles(path.join(tmpDir, 'nope')).size).toBe(0)
    })

    it('空目录返回空集合', () => {
      const empty = path.join(tmpDir, 'empty')
      fs.mkdirSync(empty)
      expect(collectRelativeFiles(empty).size).toBe(0)
    })

    it('跳过被忽略的目录与临时文件', () => {
      writeFile(path.join(tmpDir, 'keep.md'), 'keep')
      writeFile(path.join(tmpDir, 'node_modules', 'pkg', 'index.js'), 'noise')
      writeFile(path.join(tmpDir, '.git', 'config'), 'noise')
      writeFile(path.join(tmpDir, 'swap.swp'), 'noise')
      writeFile(path.join(tmpDir, 'partial.tmp'), 'noise')

      expect([...collectRelativeFiles(tmpDir)]).toEqual(['keep.md'])
    })

    it('不进入符号链接目录', () => {
      const real = path.join(tmpDir, 'real')
      writeFile(path.join(real, 'inside.md'), 'inside')
      writeFile(path.join(tmpDir, 'top.md'), 'top')
      const link = path.join(tmpDir, 'linked')
      let linked = false
      try {
        fs.symlinkSync(real, link, 'dir')
        linked = true
      } catch {
        // Windows 无符号链接权限时退化为只验证普通收集
      }

      const files = collectRelativeFiles(tmpDir)
      expect(files.has('top.md')).toBe(true)
      if (linked) {
        expect(files.has(path.join('real', 'inside.md'))).toBe(true)
        expect(files.has(path.join('linked', 'inside.md'))).toBe(false)
      }
    })
  })

  // ── readRelativeFile ───────────────────────────────────────────

  describe('readRelativeFile', () => {
    it('读出嵌套文件内容', () => {
      writeFile(path.join(tmpDir, 'sub', 'file.md'), '你好')
      expect(readRelativeFile(tmpDir, path.join('sub', 'file.md'))).toBe('你好')
    })

    it('文件不存在时返回 null', () => {
      expect(readRelativeFile(tmpDir, 'missing.md')).toBeNull()
    })

    it('基准目录不存在时返回 null', () => {
      expect(readRelativeFile(path.join(tmpDir, 'nope'), 'file.md')).toBeNull()
    })
  })

  // ── discoverAgentSkillPaths ────────────────────────────────────

  describe('discoverAgentSkillPaths', () => {
    function makeSkill(rel: string): string {
      const dir = path.join(tmpDir, rel)
      writeFile(path.join(dir, 'SKILL.md'), '# skill')
      return dir
    }

    it('非递归时只取直接子目录里的技能', () => {
      const top = makeSkill('top')
      makeSkill(path.join('nested', 'deep'))

      expect(discoverAgentSkillPaths(tmpDir, false, false)).toEqual([top])
    })

    it('递归时能取到嵌套技能', () => {
      const top = makeSkill('top')
      const deep = makeSkill(path.join('nested', 'deep'))

      expect(discoverAgentSkillPaths(tmpDir, true, false)).toEqual([top, deep].sort())
    })

    it('命中技能目录后不再向下递归', () => {
      const outer = makeSkill('outer')
      makeSkill(path.join('outer', 'inner'))

      expect(discoverAgentSkillPaths(tmpDir, true, false)).toEqual([outer])
    })

    it('跳过隐藏目录', () => {
      makeSkill(path.join('.hidden', 'skill'))
      const visible = makeSkill('visible')

      expect(discoverAgentSkillPaths(tmpDir, true, false)).toEqual([visible])
    })

    it('默认跳过 node_modules', () => {
      makeSkill(path.join('node_modules', 'pkg'))
      const visible = makeSkill('visible')

      expect(discoverAgentSkillPaths(tmpDir, true, false)).toEqual([visible])
    })

    it('includeDependencyDirs 时穿越 node_modules', () => {
      const dep = makeSkill(path.join('node_modules', 'pkg'))

      expect(discoverAgentSkillPaths(tmpDir, true, true)).toEqual([dep])
    })

    it('includeDependencyDirs 不影响其它被忽略的目录', () => {
      makeSkill(path.join('.git', 'skill'))
      makeSkill(path.join('target', 'skill'))

      expect(discoverAgentSkillPaths(tmpDir, true, true)).toEqual([])
    })

    it('普通文件不被当作技能目录', () => {
      writeFile(path.join(tmpDir, 'SKILL.md'), 'root file')
      writeFile(path.join(tmpDir, 'loose.txt'), 'loose')

      expect(discoverAgentSkillPaths(tmpDir, true, false)).toEqual([])
    })

    it('根目录不存在时返回空数组', () => {
      expect(discoverAgentSkillPaths(path.join(tmpDir, 'nope'), true, false)).toEqual([])
    })

    it('递归深度上限为 8 层', () => {
      const atLimit = makeSkill(path.join('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'limit'))
      makeSkill(path.join('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'deep'))

      expect(discoverAgentSkillPaths(tmpDir, true, false)).toEqual([atLimit])
    })

    it('结果按路径排序且非符号链接优先', () => {
      // 链接指向扫描根之外，否则会被 realpath 去重吃掉，观察不到排序
      const scanRoot = path.join(tmpDir, 'root')
      const inside = path.join(scanRoot, 'zeta')
      writeFile(path.join(inside, 'SKILL.md'), '# inside')
      const outside = path.join(tmpDir, 'outside', 'skill')
      writeFile(path.join(outside, 'SKILL.md'), '# outside')
      const link = path.join(scanRoot, 'alpha')
      let linked = false
      try {
        fs.symlinkSync(outside, link, 'dir')
        linked = true
      } catch {
        // 无符号链接权限时只验证排序
      }

      const found = discoverAgentSkillPaths(scanRoot, false, false)
      if (linked) {
        expect(found).toEqual([inside, link])
      } else {
        expect(found).toEqual([inside])
      }
    })

    it('指向同一真实路径的入口被去重', () => {
      const real = makeSkill('real')
      const link = path.join(tmpDir, 'alias')
      let linked = false
      try {
        fs.symlinkSync(real, link, 'dir')
        linked = true
      } catch {
        // 无符号链接权限时退化为验证真实目录本身
      }

      const found = discoverAgentSkillPaths(tmpDir, false, false)
      expect(found).toContain(real)
      if (linked) expect(found).toHaveLength(1)
    })
  })

  // ── sanitizeBasename ───────────────────────────────────────────

  describe('sanitizeBasename', () => {
    it('保留字母数字、dash 与下划线', () => {
      expect(sanitizeBasename('my-skill_2')).toBe('my-skill_2')
    })

    it('只取路径的最后一段', () => {
      expect(sanitizeBasename(path.join(tmpDir, 'parent', 'leaf'))).toBe('leaf')
    })

    it('任意非法字符都转成 dash（与 sanitizeId 不同）', () => {
      expect(sanitizeBasename('a@b')).toBe('a-b')
      expect(sanitizeId('a@b')).toBe('ab')
    })

    it('连续非法字符折叠成一个 dash', () => {
      expect(sanitizeBasename('a@@@b')).toBe('a-b')
    })

    it('去掉首尾 dash', () => {
      expect(sanitizeBasename('@lead')).toBe('lead')
      expect(sanitizeBasename('trail@')).toBe('trail')
      expect(sanitizeBasename('@both@')).toBe('both')
    })

    it('结果为空时回退到 skill', () => {
      expect(sanitizeBasename('@@@')).toBe('skill')
      expect(sanitizeBasename('')).toBe('skill')
    })

    it('中文字符按非法字符处理', () => {
      expect(sanitizeBasename('技能')).toBe('skill')
      expect(sanitizeBasename('a技能b')).toBe('a-b')
    })
  })

  // ── normalizePathKey ───────────────────────────────────────────

  describe('normalizePathKey', () => {
    it('折叠冗余的路径段', () => {
      const input = path.join('a', '..', 'b', '.', 'c')
      expect(normalizePathKey(input)).toBe(path.join('b', 'c'))
    })

    it('仅在 win32 上折叠大小写', () => {
      const input = path.join('MiXeD', 'Case')
      const expected = process.platform === 'win32' ? path.join('mixed', 'case') : input
      expect(normalizePathKey(input)).toBe(expected)
    })

    it('同一平台下等价路径得到同一个 key', () => {
      const a = normalizePathKey(path.join(tmpDir, 'x', '..', 'y'))
      const b = normalizePathKey(path.join(tmpDir, 'y'))
      expect(a).toBe(b)
    })
  })
})

// Helper
function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink()
  } catch {
    return false
  }
}
