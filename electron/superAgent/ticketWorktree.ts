/**
 * per-ticket worktree（T12 #82）：并行策略下每个 ticket 的 Worker 在独立工作树执行。
 * 复用 Factory 的幂等 prepareWorktree 基建：重试复用同一目录；分支命名空间
 * （agent/superagent-<ticketId>）与工厂的 agent/task-* 区分，互不冲突。
 * 基点取当前 HEAD —— 共享目录的半成品内容不进并行通道。
 */
import {
  prepareWorktree,
  type PrepareWorktreeResult,
  type WorktreeDeps,
} from '../factory/worktree'

/** ticketId（ticket-<uuid>）本身满足 Factory 的 TASK_ID_PATTERN。 */
export function ticketWorktreeBranch(ticketId: string): string {
  return `agent/superagent-${ticketId}`
}

export interface TicketWorktreePreparer {
  prepare(repoRoot: string, ticketId: string): Promise<PrepareWorktreeResult>
}

export function createTicketWorktreePreparer(deps: WorktreeDeps = {}): TicketWorktreePreparer {
  return {
    async prepare(repoRoot, ticketId) {
      return prepareWorktree(
        {
          repoRoot,
          taskId: ticketId,
          branch: ticketWorktreeBranch(ticketId),
          baseBranch: 'HEAD',
        },
        deps,
      )
    },
  }
}
