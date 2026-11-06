/**
 * Super Agent 拥有的引擎会话 id 清单（侧边栏可见性的事实来源）。
 *
 * Router 与 Worker 的引擎会话 id 由项目根与 ticketId 稳定派生（见 sessionId.ts），
 * 所以「哪些 id 属于 Super Agent」不需要另建登记表 —— 磁盘上的项目状态里已经有
 * repoRoot 与全部 ticketId，重算一遍就是权威答案。
 *
 * 侧边栏的会话行有两条来路：实时推送与 JSONL 历史恢复。后者在每次桌面启动时扫描
 * `~/.claude/projects`，那里同样躺着 Router/Worker 的转录；不认出来就会被当成普通
 * 聊天重新建一行。恢复用的 `listAllSessions` 因此按这份清单贴标签。
 *
 * 读盘失败一律降级成空清单：宁可让某条会话暂时出现在列表里，也不要在启动路径上抛穿。
 */
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { SuperAgentSessionKind } from '@/shared/channels/superAgent'
import { SUPER_AGENT_PROJECTS_DIR } from './store'
import { superAgentRouterEngineSessionId, superAgentWorkerEngineSessionId } from './sessionId'

function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

/** state.json 的 tickets 键集合，即全部 ticketId（只读快照，不重放 WAL）。 */
function ticketIdsOf(raw: unknown): string[] {
  const state = (raw as { state?: { tickets?: Record<string, unknown> } } | null)?.state
  const tickets = state?.tickets
  return tickets && typeof tickets === 'object' ? Object.keys(tickets) : []
}

function repoRootOf(raw: unknown): string | null {
  const root = (raw as { repoRoot?: unknown } | null)?.repoRoot
  return typeof root === 'string' && root.trim() !== '' ? root : null
}

/**
 * 列出磁盘上全部 Super Agent 项目的引擎会话 id 及其种类。
 *
 * 入参是 `<userData>` 根目录而不是拼好的路径：调用方（IPC 适配层）才知道自己从哪个
 * userData 起的服务，这里只负责按同一布局读。
 */
export function listSuperAgentSessionTypes(
  userDataDir: string,
): Map<string, SuperAgentSessionKind> {
  const types = new Map<string, SuperAgentSessionKind>()
  const projectsDir = join(userDataDir, ...SUPER_AGENT_PROJECTS_DIR.split('/'))
  if (!userDataDir || !existsSync(projectsDir)) return types

  let projectKeys: string[]
  try {
    projectKeys = readdirSync(projectsDir)
  } catch {
    return types
  }

  for (const projectKey of projectKeys) {
    const dir = join(projectsDir, projectKey)
    const repoRoot = repoRootOf(readJson(join(dir, 'project.json')))
    if (repoRoot) types.set(superAgentRouterEngineSessionId(repoRoot), 'superAgent')
    for (const ticketId of ticketIdsOf(readJson(join(dir, 'state.json')))) {
      types.set(superAgentWorkerEngineSessionId(ticketId), 'superAgentWorker')
    }
  }
  return types
}
