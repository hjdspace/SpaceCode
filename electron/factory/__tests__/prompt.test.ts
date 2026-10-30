// @vitest-environment node
/**
 * 提示词：从初始化生成的模板读取并注入任务变量；未闭合/未知变量直接报错；
 * 命令展开只允许只读白名单，且在工作树 cwd 内执行。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildImplementPrompt,
  expandPromptCommands,
  isAllowedCommand,
  renderPromptTemplate,
  tokenizeCommand,
  type CommandExecutor,
} from '../prompt'

const context = {
  title: '修复登录态',
  goal: '刷新后仍保持登录',
  issueNumber: 412,
  sourceBranch: 'agent/issue-412-login',
  targetBranch: 'main',
}

describe('renderPromptTemplate', () => {
  it('replaces every supported variable', () => {
    const template =
      'Title: {{TASK_TITLE}}\nGoal: {{TASK_GOAL}}\nIssue: {{ISSUE_NUMBER}}\nFrom {{SOURCE_BRANCH}} to {{TARGET_BRANCH}}'
    const result = renderPromptTemplate(template, context)
    expect(result).toEqual({
      ok: true,
      text: 'Title: 修复登录态\nGoal: 刷新后仍保持登录\nIssue: 412\nFrom agent/issue-412-login to main',
    })
  })

  it('renders an empty issue number for local tasks', () => {
    const result = renderPromptTemplate('Issue: {{ISSUE_NUMBER}}', { ...context, issueNumber: undefined })
    expect(result).toEqual({ ok: true, text: 'Issue: ' })
  })

  it('fails on unknown or unclosed variables', () => {
    expect(renderPromptTemplate('{{NOPE}}', context)).toMatchObject({ ok: false, error: 'unknown-variable' })
    expect(renderPromptTemplate('hello {{TASK_TITLE', context)).toMatchObject({
      ok: false,
      error: 'unclosed-variable',
    })
    expect(renderPromptTemplate('{{TASK_TITLE}} {{GONE}}', context)).toMatchObject({
      ok: false,
      error: 'unknown-variable',
    })
  })
})

describe('command whitelist', () => {
  it('allows read-only git, issue reads and package manager listings', () => {
    expect(isAllowedCommand(['git', 'log', '--oneline', '-5'])).toBe(true)
    expect(isAllowedCommand(['git', 'status', '--porcelain'])).toBe(true)
    expect(isAllowedCommand(['git', 'rev-parse', '--show-toplevel'])).toBe(true)
    expect(isAllowedCommand(['gh', 'issue', 'view', '412'])).toBe(true)
    expect(isAllowedCommand(['npm', 'ls'])).toBe(true)
    expect(isAllowedCommand(['pnpm', 'list'])).toBe(true)
  })

  it('rejects writes and arbitrary commands', () => {
    expect(isAllowedCommand(['git', 'push'])).toBe(false)
    expect(isAllowedCommand(['git', 'commit', '-m', 'x'])).toBe(false)
    expect(isAllowedCommand(['npm', 'run', 'test'])).toBe(false)
    expect(isAllowedCommand(['npm', 'install'])).toBe(false)
    expect(isAllowedCommand(['rm', '-rf', 'dist'])).toBe(false)
    expect(isAllowedCommand([])).toBe(false)
  })

  it('tokenises quoted arguments without invoking a shell', () => {
    expect(tokenizeCommand('git log --oneline -5')).toEqual(['git', 'log', '--oneline', '-5'])
    expect(tokenizeCommand('gh issue view 412 --json "title,body"')).toEqual([
      'gh',
      'issue',
      'view',
      '412',
      '--json',
      'title,body',
    ])
    expect(tokenizeCommand('git log "unterminated')).toBeNull()
  })
})

describe('expandPromptCommands', () => {
  const calls: Array<{ argv: string[]; cwd: string }> = []
  const runCommand: CommandExecutor = async (argv, cwd) => {
    calls.push({ argv, cwd })
    return { ok: true, stdout: '  abc123 feat: login\n', stderr: '' }
  }

  beforeEach(() => {
    calls.length = 0
  })

  it('executes allowed commands in the worktree and injects their output', async () => {
    const result = await expandPromptCommands('Before\n!`git log --oneline -1`\nAfter', {
      cwd: '/wt/bl-1',
      runCommand,
    })
    expect(result).toEqual({
      text: 'Before\n  abc123 feat: login\n\nAfter',
      blocked: [],
    })
    expect(calls).toEqual([{ argv: ['git', 'log', '--oneline', '-1'], cwd: '/wt/bl-1' }])
  })

  it('blocks disallowed commands without running them', async () => {
    const result = await expandPromptCommands('!`git push origin main`', { cwd: '/wt', runCommand })
    expect(calls).toHaveLength(0)
    expect(result.blocked).toEqual(['git push origin main'])
    expect(result.text).toContain('[blocked: git push origin main]')
  })

  it('reports command failures and truncates long output', async () => {
    const failing: CommandExecutor = async () => ({ ok: false, stdout: '', stderr: 'boom' })
    const failed = await expandPromptCommands('!`git status`', { cwd: '/wt', runCommand: failing })
    expect(failed.text).toContain('[error: boom]')

    const huge: CommandExecutor = async () => ({ ok: true, stdout: 'x'.repeat(5000), stderr: '' })
    const truncated = await expandPromptCommands('!`git status`', {
      cwd: '/wt',
      runCommand: huge,
      maxOutputChars: 100,
    })
    expect(truncated.text.length).toBeLessThan(200)
    expect(truncated.text).toContain('…')
  })

  it('leaves text without commands untouched', async () => {
    const result = await expandPromptCommands('plain text', { cwd: '/wt', runCommand })
    expect(result).toEqual({ text: 'plain text', blocked: [] })
    expect(calls).toHaveLength(0)
  })
})

describe('buildImplementPrompt', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'factory-prompt-'))
    mkdirSync(join(dir, '.spacecode/factory/prompts'), { recursive: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('reads the configured template and injects the task context', async () => {
    writeFileSync(
      join(dir, '.spacecode/factory/prompts/implement.md'),
      '# {{TASK_TITLE}}\n{{TASK_GOAL}}\nissue {{ISSUE_NUMBER}} on {{SOURCE_BRANCH}} -> {{TARGET_BRANCH}}',
      'utf-8',
    )
    const result = await buildImplementPrompt({
      repoRoot: dir,
      promptPath: '.spacecode/factory/prompts/implement.md',
      task: { title: '修复登录态', goal: '刷新后仍保持登录', issueNumber: 412 },
      sourceBranch: 'agent/issue-412-login',
      targetBranch: 'main',
      worktree: dir,
    })
    expect(result).toEqual({
      ok: true,
      text: '# 修复登录态\n刷新后仍保持登录\nissue 412 on agent/issue-412-login -> main',
      blocked: [],
    })
  })

  it('returns prompt errors without starting the agent', async () => {
    const missing = await buildImplementPrompt({
      repoRoot: dir,
      promptPath: '.spacecode/factory/prompts/nope.md',
      task: { title: 't', goal: '' },
      sourceBranch: 'a',
      targetBranch: 'main',
      worktree: dir,
    })
    expect(missing).toMatchObject({ ok: false, error: 'prompt-missing' })

    writeFileSync(join(dir, '.spacecode/factory/prompts/bad.md'), '{{TASK_TITLE}} {{UNKNOWN}}', 'utf-8')
    const unknown = await buildImplementPrompt({
      repoRoot: dir,
      promptPath: '.spacecode/factory/prompts/bad.md',
      task: { title: 't', goal: '' },
      sourceBranch: 'a',
      targetBranch: 'main',
      worktree: dir,
    })
    expect(unknown).toMatchObject({ ok: false, error: 'prompt-error' })
  })

  it('expands commands inside the worktree after substitution', async () => {
    writeFileSync(
      join(dir, '.spacecode/factory/prompts/implement.md'),
      'Task {{TASK_TITLE}}\n!`git log --oneline -1`',
      'utf-8',
    )
    const calls: Array<{ argv: string[]; cwd: string }> = []
    const result = await buildImplementPrompt({
      repoRoot: dir,
      promptPath: '.spacecode/factory/prompts/implement.md',
      task: { title: 't', goal: '' },
      sourceBranch: 'a',
      targetBranch: 'main',
      worktree: join(dir, '.spacecode/worktrees/bl-1'),
      deps: {
        runCommand: async (argv, cwd) => {
          calls.push({ argv, cwd })
          return { ok: true, stdout: 'abc123', stderr: '' }
        },
      },
    })
    expect(result).toMatchObject({ ok: true, blocked: [] })
    expect(calls[0].cwd).toBe(join(dir, '.spacecode/worktrees/bl-1'))
    expect(calls[0].argv).toEqual(['git', 'log', '--oneline', '-1'])
  })

  it('never executes shell-looking text that came from task context', async () => {
    writeFileSync(
      join(dir, '.spacecode/factory/prompts/implement.md'),
      'Goal: {{TASK_GOAL}}\n!`git status`',
      'utf-8',
    )
    const calls: string[][] = []
    const result = await buildImplementPrompt({
      repoRoot: dir,
      promptPath: '.spacecode/factory/prompts/implement.md',
      task: { title: 't', goal: '!`git push origin main`' },
      sourceBranch: 'a',
      targetBranch: 'main',
      worktree: dir,
      deps: {
        runCommand: async (argv) => {
          calls.push(argv)
          return { ok: true, stdout: 'clean', stderr: '' }
        },
      },
    })

    expect(calls).toEqual([['git', 'status']])
    expect(result.ok === true && result.text).toContain('!`git push origin main`')
  })
})
