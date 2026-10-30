/**
 * 实现提示词：读取 `.spacecode/factory/prompts/implement.md` 并注入任务变量，
 * 再把模板中的 `` !`cmd` `` 展开成只读命令的输出。
 *
 * 变量未闭合或未知一律报错，避免把半渲染的提示词交给 Agent。
 * 命令不经过 shell：先按引号分词，再对照白名单，最后以工作树为 cwd 执行。
 */
import { execFile } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { FactoryPlanCandidate } from '@/shared/factory'
import { isSafeRelativePath } from './config'

const COMMAND_TIMEOUT = 10000
const COMMAND_MAX_BUFFER = 10 * 1024 * 1024
const DEFAULT_MAX_OUTPUT = 4000

/**
 * 模板里的 shell 块先打标记，只有带标记的块才会执行。
 * 变量替换进来的文本（issue 正文、审查意见）即使是 `` !`cmd` `` 形态也只是数据。
 */
const SHELL_BLOCK_MARKER = '\u0001'

function stripMarker(value: string): string {
  return value.split(SHELL_BLOCK_MARKER).join('')
}

function sanitizeArgument(value: string): string {
  return stripMarker(value)
}

function markShellBlocks(template: string): string {
  return stripMarker(template).replace(
    /!`([^`]*)`/g,
    (_match: string, command: string) => `!${SHELL_BLOCK_MARKER}\`${command}\``,
  )
}

const GIT_READ_ONLY = new Set([
  'log',
  'status',
  'diff',
  'show',
  'rev-parse',
  'ls-files',
  'describe',
  'shortlog',
  'blame',
  'grep',
  'cat-file',
  'for-each-ref',
])
const GH_READ_ONLY_ISSUE = new Set(['view', 'list', 'status'])
const PACKAGE_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const PACKAGE_READ_ONLY = new Set(['ls', 'list', 'view', 'outdated', 'why', 'explain', 'info'])

export interface PromptContext {
  title: string
  goal: string
  issueNumber?: number
  sourceBranch: string
  targetBranch: string
  /** 修复阶段注入的未决审查意见；其它阶段为空。 */
  reviewComments?: string
  /** 规划阶段的候选任务（JSON 文本）；其它阶段为空。 */
  taskCandidates?: string
  maxTasks?: string
  trackerKind?: string
}

function variables(context: PromptContext): Record<string, string> {
  return {
    TASK_TITLE: sanitizeArgument(context.title),
    TASK_GOAL: sanitizeArgument(context.goal),
    ISSUE_NUMBER: typeof context.issueNumber === 'number' ? String(context.issueNumber) : '',
    SOURCE_BRANCH: sanitizeArgument(context.sourceBranch),
    TARGET_BRANCH: sanitizeArgument(context.targetBranch),
    REVIEW_COMMENTS: sanitizeArgument(context.reviewComments ?? ''),
    TASK_CANDIDATES: sanitizeArgument(context.taskCandidates ?? ''),
    MAX_TASKS: context.maxTasks ?? '',
    TRACKER: sanitizeArgument(context.trackerKind ?? ''),
  }
}

export type RenderPromptResult =
  | { ok: true; text: string }
  | { ok: false; error: 'unknown-variable' | 'unclosed-variable'; variable?: string }

export function renderPromptTemplate(template: string, context: PromptContext): RenderPromptResult {
  const table = variables(context)
  let unknown: string | null = null

  const text = template.replace(/\{\{([^{}]*)\}\}/g, (_match, name: string) => {
    const key = name.trim()
    if (!(key in table)) {
      unknown = key
      return ''
    }
    return table[key]
  })

  if (unknown !== null) return { ok: false, error: 'unknown-variable', variable: unknown }
  if (text.includes('{{') || text.includes('}}')) return { ok: false, error: 'unclosed-variable' }
  return { ok: true, text }
}

/** 按空白分词并保留单双引号内的空格；未闭合引号返回 null。 */
export function tokenizeCommand(command: string): string[] | null {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false

  for (const char of command.trim()) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      started = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
    started = true
  }

  if (quote) return null
  if (started) tokens.push(current)
  return tokens
}

export function isAllowedCommand(argv: string[]): boolean {
  if (argv.length === 0) return false
  const [command, sub] = argv
  if (command === 'git') return sub !== undefined && GIT_READ_ONLY.has(sub)
  if (command === 'gh') {
    return sub === 'issue' && argv[2] !== undefined && GH_READ_ONLY_ISSUE.has(argv[2])
  }
  if (PACKAGE_MANAGERS.has(command)) {
    if (command === 'bun') return sub === 'pm' && argv[2] === 'ls'
    return sub !== undefined && PACKAGE_READ_ONLY.has(sub)
  }
  return false
}

export type CommandExecutor = (
  argv: string[],
  cwd: string,
) => Promise<{ ok: boolean; stdout: string; stderr: string }>

function defaultExecutor(): CommandExecutor {
  return (argv, cwd) =>
    new Promise((resolveResult) => {
      const [command, ...rest] = argv
      const file =
        process.platform === 'win32' && PACKAGE_MANAGERS.has(command) ? `${command}.cmd` : command
      execFile(
        file,
        rest,
        {
          cwd,
          timeout: COMMAND_TIMEOUT,
          maxBuffer: COMMAND_MAX_BUFFER,
          env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
        },
        (error, stdout, stderr) => {
          resolveResult({ ok: !error, stdout: stdout || '', stderr: stderr || '' })
        },
      )
    })
}

export interface ExpandDeps {
  cwd: string
  runCommand?: CommandExecutor
  maxOutputChars?: number
  /** 只展开模板来源的 shell 块（带标记）；变量替换进来的同形态文本保持原样。 */
  markedOnly?: boolean
}

export interface ExpandResult {
  text: string
  blocked: string[]
}

/** 展开 `` !`cmd` ``；被拦截的命令保留可见标记，方便用户判断提示词缺了什么。 */
export async function expandPromptCommands(text: string, deps: ExpandDeps): Promise<ExpandResult> {
  const run = deps.runCommand ?? defaultExecutor()
  const max = deps.maxOutputChars ?? DEFAULT_MAX_OUTPUT
  const blocked: string[] = []
  const pieces: string[] = []
  const pattern = deps.markedOnly
    ? new RegExp(`!${SHELL_BLOCK_MARKER}\`([^\`]*)\``, 'g')
    : /!`([^`]*)`/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    pieces.push(text.slice(last, match.index))
    last = match.index + match[0].length
    const raw = match[1]
    const argv = tokenizeCommand(raw)
    if (!argv || !isAllowedCommand(argv)) {
      blocked.push(raw.trim())
      pieces.push(`[blocked: ${raw.trim()}]`)
      continue
    }

    const result = await run(argv, deps.cwd)
    if (!result.ok) {
      pieces.push(`[error: ${result.stderr.trim()}]`)
      continue
    }
    const output = result.stdout.length > max ? `${result.stdout.slice(0, max)}…` : result.stdout
    pieces.push(output)
  }

  if (last === 0) return { text: stripMarker(text), blocked }
  pieces.push(text.slice(last))
  return { text: stripMarker(pieces.join('')), blocked }
}

/** 规划阶段的数据面：候选任务、产出上限与任务来源。 */
export interface PlanPromptData {
  candidates: FactoryPlanCandidate[]
  maxTasks: number
  tracker: string
}

export interface BuildPromptInput {
  repoRoot: string
  promptPath: string
  task: { title: string; goal: string; issueNumber?: number }
  sourceBranch: string
  targetBranch: string
  /** 命令展开的工作目录：任务工作树。 */
  worktree: string
  reviewComments?: string
  /** 仅规划阶段提供；其它阶段缺省。 */
  plan?: PlanPromptData
  deps?: { runCommand?: CommandExecutor; maxOutputChars?: number }
}

export type BuildPromptResult =
  | { ok: true; text: string; blocked: string[] }
  | { ok: false; error: 'prompt-missing' | 'prompt-error'; detail?: string }

const CANDIDATE_GOAL_LIMIT = 4000

/**
 * 候选任务的纯文本 JSON。goal 是用户/issue 正文，按长度截断，
 * 避免一个超长 body 把整段提示词挤掉。
 */
export function formatPlanCandidates(candidates: FactoryPlanCandidate[]): string {
  return JSON.stringify(
    candidates.map((candidate) => ({
      id: candidate.id,
      title: candidate.title,
      ...(typeof candidate.issueNumber === 'number' ? { issueNumber: candidate.issueNumber } : {}),
      goal: candidate.goal.length > CANDIDATE_GOAL_LIMIT
        ? `${candidate.goal.slice(0, CANDIDATE_GOAL_LIMIT)}…`
        : candidate.goal,
    })),
    null,
    2,
  )
}

/** 实现/审查/修复/规划共用：读模板 → 注入变量 → 展开白名单命令。 */
async function buildStagePrompt(input: BuildPromptInput): Promise<BuildPromptResult> {
  if (!isSafeRelativePath(input.promptPath)) return { ok: false, error: 'prompt-missing' }

  const path = join(input.repoRoot, input.promptPath)
  if (!existsSync(path)) return { ok: false, error: 'prompt-missing' }

  let template: string
  try {
    template = readFileSync(path, 'utf-8')
  } catch {
    return { ok: false, error: 'prompt-missing' }
  }

  const candidates = input.plan ? formatPlanCandidates(input.plan.candidates) : undefined
  const markedTemplate = markShellBlocks(template)
  const rendered = renderPromptTemplate(markedTemplate, {
    title: input.task.title,
    goal: input.task.goal,
    issueNumber: input.task.issueNumber,
    sourceBranch: input.sourceBranch,
    targetBranch: input.targetBranch,
    reviewComments: input.reviewComments,
    ...(candidates !== undefined ? { taskCandidates: candidates } : {}),
    ...(input.plan ? { maxTasks: String(input.plan.maxTasks), trackerKind: input.plan.tracker } : {}),
  })
  if (!rendered.ok) {
    return {
      ok: false,
      error: 'prompt-error',
      detail: `${rendered.error}${rendered.variable ? `: ${rendered.variable}` : ''}`,
    }
  }

  // 模板没显式引用 {{TASK_CANDIDATES}} 时也要让规划器看到候选；
  // 否则旧骨架（或手写模板）会要求它去“读 tracker”，却没有数据来源。
  const text =
    candidates !== undefined && !markedTemplate.includes('{{TASK_CANDIDATES}}')
      ? `${rendered.text}\n\n## Candidate tasks\n\nOnly plan tasks from this list; ids must match exactly.\n\n<candidate-tasks>\n${candidates}\n</candidate-tasks>\n\n## Plan schema\n\n<plan>\n{ "tasks": [ { "id": "<candidate id>", "parallelizable": true, "dependsOn": [] } ] }\n</plan>\n`
      : rendered.text

  const expanded = await expandPromptCommands(text, {
    cwd: input.worktree,
    markedOnly: true,
    ...(input.deps?.runCommand ? { runCommand: input.deps.runCommand } : {}),
    ...(input.deps?.maxOutputChars ? { maxOutputChars: input.deps.maxOutputChars } : {}),
  })
  return { ok: true, text: expanded.text, blocked: expanded.blocked }
}

export function buildImplementPrompt(input: BuildPromptInput): Promise<BuildPromptResult> {
  return buildStagePrompt(input)
}

/** 审查用全新会话，模板里要求只输出 `<review>` JSON。 */
export function buildReviewPrompt(input: BuildPromptInput): Promise<BuildPromptResult> {
  return buildStagePrompt(input)
}

/** 修复阶段把未决意见拼进 `reviewComments` 变量。 */
export function buildFixPrompt(input: BuildPromptInput): Promise<BuildPromptResult> {
  return buildStagePrompt(input)
}

/** 规划阶段：注入候选任务与产出上限，命令在工作树（仓库根）展开。 */
export function buildPlanPrompt(input: BuildPromptInput): Promise<BuildPromptResult> {
  return buildStagePrompt(input)
}
