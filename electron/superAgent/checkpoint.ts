/**
 * 检查点（T12 #82）：每轮 launch 前保存 HEAD、porcelain 清单与 diff/patch，
 * 作为共享目录下人工按文件显式回退的依据 —— 不是隔离边界（隔离靠 per-ticket worktree）。
 *
 * 回退语义（只回退「检查点时干净、当前被 worker 改动」的文件）：
 *  - 当前 untracked（worker 新增）→ 删除该文件；
 *  - 当前 modified/deleted（worker 改动/删除 tracked）→ `git checkout <checkpoint HEAD> -- <file>`；
 *  - 检查点前已脏（用户自己的改动）→ 拒绝回退（dirty-at-checkpoint）；
 *  - 当前已干净 → 跳过（clean）。
 */
import type { SuperAgentWorkspaceStatus } from './workspace'
import { superAgentError } from './errors'
import type { GitCommandRunner } from './workspace'

export interface SuperAgentCheckpoint {
  repoRoot: string
  savedAt: string
  head: string | null
  /** 保存时已脏文件（porcelain 解析出的路径，含 untracked）。 */
  entries: string[]
  /** 保存时的 porcelain 原文（审计）。 */
  statusText: string
  /** 保存时 `git diff HEAD`（审计，供人工比对）。 */
  patch: string | null
}

export type CheckpointSkipReason = 'dirty-at-checkpoint' | 'clean'

export interface CheckpointRollbackSkipped {
  file: string
  reason: CheckpointSkipReason
}

export interface CheckpointRollbackResult {
  rolled: string[]
  skipped: CheckpointRollbackSkipped[]
}

export interface SuperAgentCheckpointStore {
  /** 每轮 launch 前调用：保存该 repoRoot 最新检查点（覆盖旧值）。 */
  save(repoRoot: string, workspace: SuperAgentWorkspaceStatus): Promise<void>
  latest(repoRoot: string): SuperAgentCheckpoint | null
  /** 人工按文件显式回退；不整仓 reset，不做任何自动回滚。 */
  rollbackFiles(repoRoot: string, files: string[]): Promise<CheckpointRollbackResult>
}

export interface CheckpointStoreOptions {
  run: GitCommandRunner
  now?: () => Date
  /** 注入以便单测；默认 fs.rm。 */
  removeFile?: (path: string) => Promise<void>
  /** 注入以便单测；默认 fs.access。 */
  fileExists?: (path: string) => Promise<boolean>
}

/** porcelain 一行 → 路径；rename（"R  old -> new"）取目标路径；非 porcelain 行返回 null。 */
export function parsePorcelainEntry(line: string): string | null {
  if (line.length < 4) return null
  // porcelain 格式：前两字符为状态（[A-Z? ]），第三字符为空格
  if (line[2] !== ' ' || !/^[ A-Z?]{2}$/.test(line.slice(0, 2))) return null
  let path = line.slice(3)
  const arrow = path.indexOf(' -> ')
  if (arrow >= 0) path = path.slice(arrow + 4)
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
  const trimmed = path.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeFile(repoRoot: string, raw: string): string {
  const file = raw.trim().replace(/\\/g, '/')
  if (file.length === 0 || file.includes('..') || /^[a-zA-Z]:\//.test(file) || file.startsWith('/')) {
    throw superAgentError('checkpointInvalidFile', { repoRoot, file: raw })
  }
  return file
}

function joinPath(repoRoot: string, file: string): string {
  return `${repoRoot.replace(/[/\\]+$/, '')}/${file}`
}

export function createCheckpointStore(options: CheckpointStoreOptions): SuperAgentCheckpointStore {
  const { run } = options
  const now = options.now ?? (() => new Date())
  const removeFile =
    options.removeFile ??
    (async (path: string) => {
      const { rm } = await import('node:fs/promises')
      await rm(path, { force: true })
    })
  const fileExists =
    options.fileExists ??
    (async (path: string) => {
      const { access } = await import('node:fs/promises')
      await access(path)
      return true
    })

  const latestByRepo = new Map<string, SuperAgentCheckpoint>()

  async function save(repoRoot: string, workspace: SuperAgentWorkspaceStatus): Promise<void> {
    const patch = workspace.head
      ? await run(['diff', 'HEAD'], repoRoot)
      : Promise.resolve(null)
    const patchText = await patch
    const entries = workspace.statusText
      .split('\n')
      .map((line) => parsePorcelainEntry(line))
      .filter((entry): entry is string => entry !== null)
    latestByRepo.set(repoRoot, {
      repoRoot,
      savedAt: now().toISOString(),
      head: workspace.head,
      entries,
      statusText: workspace.statusText,
      patch: patchText && patchText.length > 0 ? patchText : null,
    })
  }

  function latest(repoRoot: string): SuperAgentCheckpoint | null {
    return latestByRepo.get(repoRoot) ?? null
  }

  async function rollbackFiles(repoRoot: string, files: string[]): Promise<CheckpointRollbackResult> {
    const checkpoint = latestByRepo.get(repoRoot)
    if (!checkpoint) {
      throw superAgentError('checkpointUnavailable', { repoRoot })
    }
    const checkpointDirty = new Set(checkpoint.entries.map((e) => e.replace(/\\/g, '/')))
    const rolled: string[] = []
    const skipped: CheckpointRollbackSkipped[] = []

    for (const raw of files) {
      const file = normalizeFile(repoRoot, raw)
      if (checkpointDirty.has(file)) {
        skipped.push({ file, reason: 'dirty-at-checkpoint' })
        continue
      }
      const statusText = await run(['status', '--porcelain'], repoRoot)
      const current = new Map<string, string>()
      for (const line of statusText.split('\n')) {
        const entry = parsePorcelainEntry(line)
        if (entry !== null) current.set(entry.replace(/\\/g, '/'), line.slice(0, 3))
      }
      const status = current.get(file)
      if (status === undefined) {
        skipped.push({ file, reason: 'clean' })
        continue
      }
      try {
        if (status.startsWith('??')) {
          // worker 新增的 untracked 文件 → 显式删除
          if (await fileExists(joinPath(repoRoot, file))) {
            await removeFile(joinPath(repoRoot, file))
          }
        } else if (checkpoint.head) {
          // worker 改动/删除的 tracked 文件 → 还原到检查点 HEAD 版本
          await run(['checkout', checkpoint.head, '--', file], repoRoot)
        } else {
          throw superAgentError('checkpointRollbackFailed', { repoRoot, file })
        }
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code: string }).code === 'checkpointRollbackFailed'
        ) {
          throw error
        }
        throw superAgentError('checkpointRollbackFailed', { repoRoot, file })
      }
      rolled.push(file)
    }
    return { rolled, skipped }
  }

  return { save, latest, rollbackFiles }
}
