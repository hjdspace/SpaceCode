/**
 * 初始化落盘：目录、backlog、五份 prompt 骨架、.gitignore 幂等追加。
 *
 * 一切操作都可重复执行：向导允许已配置的仓库再次进入，
 * 重复初始化只能补充缺失项，不能覆盖用户已修改的 prompt 或排序过的 backlog。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { FACTORY_IGNORE_ENTRIES, FACTORY_PROMPT_KEYS, type FactoryPromptKey } from '@/shared/factory'

export const FACTORY_ROOT = '.spacecode/factory'

const COMMON_FOOTER = `## Working agreement
- Source branch: {{SOURCE_BRANCH}}
- Target branch: {{TARGET_BRANCH}}
- Never push to the target branch; commit only inside the task worktree.
- When the stage is finished (success or a documented blocker), end your turn with exactly:
  <promise>COMPLETE</promise>
`

const PROMPT_SKELETONS: Record<FactoryPromptKey, string> = {
  plan: `# Plan

You are the planner for one run of the factory pipeline.

## Input
- Read open tasks from the configured tracker (issue label or local backlog).
- Skip tasks that are already done, cancelled, or blocked on another task.

## Rules
- Only propose tasks that can run in parallel in separate worktrees.
- Give each task a stable, lowercase branch slug (kebab-case).

## Structured output
Emit exactly one \`<plan>\` block and nothing after it:

<plan>
{ "tasks": [ { "issueNumber": 412, "title": "...", "parallelizable": true, "branchSlug": "session-refresh", "dependsOn": [] } ] }
</plan>

${COMMON_FOOTER}`,

  implement: `# Implement

You are the implementer. Work only inside the task worktree on {{SOURCE_BRANCH}}.

## Steps
1. Read the task goal. Do not invent scope beyond it.
2. Implement the change with the repository's existing conventions.
3. Run the project verify command and fix what it reports.
4. Commit with a descriptive message; leave the worktree clean.

## Report
Summarize the commits you made and any remaining risk before finishing.

${COMMON_FOOTER}`,

  review: `# Review

You are the reviewer. Review the diff of {{SOURCE_BRANCH}} against {{TARGET_BRANCH}}
in an isolated context: do not reuse the implementer's assumptions.

## Structured output
Emit exactly one \`<review>\` block:

<review>
{ "verdict": "approved" | "needs_changes", "summary": "...", "comments": [ { "file": "...", "line": 1, "severity": "blocker" | "suggestion", "body": "..." } ] }
</review>

Approve only when the change meets the task and the verify command passes.

${COMMON_FOOTER}`,

  fix: `# Fix

You are fixing review feedback or a failed verification on {{SOURCE_BRANCH}}.

## Pending review comments
{{REVIEW_COMMENTS}}

- Address every blocker comment; suggestions are optional.
- Re-run the verify command after each change.
- Keep the worktree clean and commit the fix.

${COMMON_FOOTER}`,

  'merge-conflict': `# Merge conflict

Resolve the conflict between {{SOURCE_BRANCH}} and {{TARGET_BRANCH}}.

- Preserve both intents where possible; never delete work just to silence the conflict.
- Re-run the verify command after resolution.
- Mention every resolved file in your summary.

${COMMON_FOOTER}`,
}

export function promptRelativePath(key: FactoryPromptKey): string {
  return `${FACTORY_ROOT}/prompts/${key}.md`
}

/** 写入缺失的 prompt 骨架；已存在的文件保持原样。 */
export function writePromptSkeletons(repoRoot: string): void {
  const dir = join(repoRoot, FACTORY_ROOT, 'prompts')
  mkdirSync(dir, { recursive: true })
  for (const key of FACTORY_PROMPT_KEYS) {
    const path = join(dir, `${key}.md`)
    if (!existsSync(path)) writeFileSync(path, PROMPT_SKELETONS[key], 'utf-8')
  }
}

export function ensureFactoryLayout(
  repoRoot: string,
  options: { tracker: 'local' | 'github-issues' },
): void {
  const root = join(repoRoot, FACTORY_ROOT)
  for (const sub of ['prompts', 'runs', 'logs']) mkdirSync(join(root, sub), { recursive: true })
  if (options.tracker === 'local') {
    const backlog = join(root, 'backlog.json')
    if (!existsSync(backlog)) writeFileSync(backlog, '[]\n', 'utf-8')
  }
}

/**
 * 幂等追加工作树/运行日志/事件日志目录。按整行匹配，避免把
 * `.spacecode/worktrees/foo` 之类误判为已存在。
 */
export function ensureFactoryGitignore(repoRoot: string): void {
  const path = join(repoRoot, '.gitignore')
  const existing = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  const lines = existing === '' ? [] : existing.split(/\r?\n/)
  const present = new Set(lines.map((line) => line.trim()))

  const missing = FACTORY_IGNORE_ENTRIES.filter((entry) => !present.has(entry))
  if (missing.length === 0) return

  const needsNewline = existing !== '' && !existing.endsWith('\n')
  const block = `${missing.join('\n')}\n`
  writeFileSync(path, needsNewline ? `${existing}\n${block}` : `${existing}${block}`, 'utf-8')
}
