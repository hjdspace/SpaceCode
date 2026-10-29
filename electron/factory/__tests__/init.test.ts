// @vitest-environment node
/**
 * 初始化落盘：五份 prompt 骨架、固定目录、backlog 与 .gitignore 幂等追加。
 * 重点是「重复初始化不破坏已有内容」——向导允许反复进入。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ensureFactoryGitignore, ensureFactoryLayout, writePromptSkeletons } from '../init'
import { FACTORY_IGNORE_ENTRIES } from '@/shared/factory'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'factory-init-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('writePromptSkeletons', () => {
  it('writes all five prompts with branch vars, completion signal and structured output', () => {
    writePromptSkeletons(dir)
    for (const key of ['plan', 'implement', 'review', 'fix', 'merge-conflict']) {
      const content = readFileSync(join(dir, '.spacecode/factory/prompts', `${key}.md`), 'utf-8')
      expect(content).toContain('{{SOURCE_BRANCH}}')
      expect(content).toContain('{{TARGET_BRANCH}}')
      expect(content).toContain('<promise>COMPLETE</promise>')
    }
    expect(readFileSync(join(dir, '.spacecode/factory/prompts/plan.md'), 'utf-8')).toContain('<plan>')
    expect(readFileSync(join(dir, '.spacecode/factory/prompts/review.md'), 'utf-8')).toContain('<review>')
  })

  it('does not overwrite an edited prompt on re-init', () => {
    writePromptSkeletons(dir)
    const path = join(dir, '.spacecode/factory/prompts/plan.md')
    writeFileSync(path, 'custom', 'utf-8')
    writePromptSkeletons(dir)
    expect(readFileSync(path, 'utf-8')).toBe('custom')
  })
})

describe('ensureFactoryLayout', () => {
  it('creates prompts/runs/logs directories', () => {
    ensureFactoryLayout(dir, { tracker: 'local' })
    for (const rel of ['prompts', 'runs', 'logs']) {
      expect(existsSync(join(dir, '.spacecode/factory', rel))).toBe(true)
    }
    expect(readFileSync(join(dir, '.spacecode/factory/backlog.json'), 'utf-8')).toBe('[]\n')
  })

  it('keeps an existing backlog and skips it for github tracker', () => {
    mkdirSync(join(dir, '.spacecode/factory'), { recursive: true })
    writeFileSync(join(dir, '.spacecode/factory/backlog.json'), '[{"id":"a"}]', 'utf-8')
    ensureFactoryLayout(dir, { tracker: 'github-issues' })
    expect(readFileSync(join(dir, '.spacecode/factory/backlog.json'), 'utf-8')).toBe('[{"id":"a"}]')
  })
})

describe('ensureFactoryGitignore', () => {
  it('creates .gitignore and appends all entries once', () => {
    ensureFactoryGitignore(dir)
    ensureFactoryGitignore(dir)
    const content = readFileSync(join(dir, '.gitignore'), 'utf-8')
    for (const entry of FACTORY_IGNORE_ENTRIES) {
      expect(content.split('\n').filter((line) => line.trim() === entry)).toHaveLength(1)
    }
  })

  it('preserves existing rules and tolerates missing trailing newline', () => {
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\ndist', 'utf-8')
    ensureFactoryGitignore(dir)
    const lines = readFileSync(join(dir, '.gitignore'), 'utf-8').split('\n')
    expect(lines[0]).toBe('node_modules/')
    expect(lines[1]).toBe('dist')
    expect(lines).toContain(FACTORY_IGNORE_ENTRIES[0])
  })
})
