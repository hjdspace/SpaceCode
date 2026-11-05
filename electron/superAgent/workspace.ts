/**
 * 共享目录脏区探针（T05 #75）。
 *
 * launch 前的检查只做「提示 + 现状注入」：脏区不阻断派工（定案），
 * 由 Scheduler 把现状写进 Worker 首条消息。禁止自动 reset/stash。
 * git 不可用时降级为稳定说明文本，不向上抛错、不假装干净。
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { SUPER_AGENT_CONTEXT_BUDGETS } from './context'

export interface SuperAgentWorkspaceStatus {
  dirty: boolean
  /** git status --porcelain 条目原文；干净时为空串。 */
  statusText: string
  /** 当前分支名；git 不可用时为 null。 */
  head: string | null
  /** 逐条状态清单（裁剪到列表预算）。 */
  entries: string[]
}

export type GitCommandRunner = (args: string[], cwd: string) => Promise<string>

export interface WorkspaceProbe {
  probe(repoRoot: string): Promise<SuperAgentWorkspaceStatus>
}

/** git 不可用时的固定占位说明；不含原始异常，避免把英文错误直接带进消息。 */
export const WORKSPACE_UNAVAILABLE_TEXT = '工作区状态不可用（git 未安装或目录不是仓库）'

function parsePorcelain(stdout: string): SuperAgentWorkspaceStatus {
  const lines = stdout.split('\n').filter((line) => line.trim() !== '')
  const branchLine = lines[0]?.startsWith('##') ? lines[0] : null
  const entryLines = (branchLine ? lines.slice(1) : lines).slice(
    0,
    SUPER_AGENT_CONTEXT_BUDGETS.listDefault,
  )
  const totalEntries = (branchLine ? lines.slice(1) : lines).length

  const statusText =
    totalEntries > entryLines.length
      ? `${entryLines.join('\n')}\n…（共 ${totalEntries} 项，超出部分见 git status）`
      : entryLines.join('\n')

  return {
    dirty: totalEntries > 0,
    statusText,
    head: branchLine ? branchLine.slice(3).split('...')[0].trim() : null,
    entries: entryLines,
  }
}

export function createGitWorkspaceProbe(run: GitCommandRunner): WorkspaceProbe {
  return {
    async probe(repoRoot) {
      try {
        const stdout = await run(['status', '--porcelain=v1', '-b'], repoRoot)
        return parsePorcelain(stdout)
      } catch {
        return { dirty: false, statusText: WORKSPACE_UNAVAILABLE_TEXT, head: null, entries: [] }
      }
    },
  }
}

/** 真实执行环境用的 git runner；测试注入 fake。 */
export function createExecFileGitRunner(): GitCommandRunner {
  const run = promisify(execFile)
  return async (args, cwd) => {
    const { stdout } = await run('git', args, { cwd, windowsHide: true })
    return stdout
  }
}

export const defaultWorkspaceProbe: WorkspaceProbe = createGitWorkspaceProbe(
  createExecFileGitRunner(),
)
