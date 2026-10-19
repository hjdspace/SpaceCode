/**
 * 会话文件改动 store —— 回答"本会话写过哪些文件"。
 *
 * 与 sessionContext 的 gitAdditions/gitDeletions 是两套语义：后者是整个仓库的
 * 未提交改动（commit 对话框要用），前者只包含本会话工具事件写过的文件。归属
 * 只能来自工具事件 —— git 状态是仓库级的，并行会话与用户手改都会混进来。
 *
 * 按 sessionId 键控：ChatPanel 会被多个 pane 同时实例化，单例 ref 会让一个 pane
 * 切会话时清掉另一个 pane 的数据。
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Message } from '@/types'
import {
  collectSessionFileChanges,
  lastChangeTurn,
  filesOfTurn,
  type SessionFileChange,
} from '@/lib/sessionFileChanges'
import { useScmStore } from './scm'
import { useAppStore } from './app'
import { useFileWriteLedgerStore } from './fileWriteLedger'

export interface SessionChangeRow extends SessionFileChange {
  insertions: number
  deletions: number
  /** git 未提交集合里还查得到这个文件；为 false 时没有 diff 可看 */
  stillDirty: boolean
  /** 账本显示别的会话在我之后写过它 —— 当前内容已经不完全是我的改动了 */
  external: boolean
}

export interface SessionChangeSummary {
  files: SessionChangeRow[]
  /** 本会话累计（所有轮次） */
  sessionCount: number
  sessionAdditions: number
  sessionDeletions: number
  /** 最近一次改动落在哪一轮，以及该轮的文件数 —— 悬浮条显示的是这个数 */
  turn: number
  turnCount: number
  turnAdditions: number
  turnDeletions: number
}

const EMPTY_SUMMARY: SessionChangeSummary = {
  files: [],
  sessionCount: 0,
  sessionAdditions: 0,
  sessionDeletions: 0,
  turn: 0,
  turnCount: 0,
  turnAdditions: 0,
  turnDeletions: 0,
}

export const useSessionFileChangesStore = defineStore('sessionFileChanges', () => {
  const changesBySession = ref(new Map<string, SessionFileChange[]>())

  function syncSession(
    sessionId: string,
    messages: Message[],
    context: { projectRoot?: string; workingDirectory?: string },
  ): void {
    if (!sessionId) return
    const files = collectSessionFileChanges(messages, context)
    if (files.length > 0) {
      changesBySession.value.set(sessionId, files)
    } else {
      changesBySession.value.delete(sessionId)
    }
  }

  function clearSession(sessionId: string): void {
    changesBySession.value.delete(sessionId)
  }

  function filesFor(sessionId: string): SessionFileChange[] {
    return changesBySession.value.get(sessionId) || []
  }

  /**
   * +/- 来自 git numstat（scm.fileStats 随 git 状态防抖刷新），不拿工具入参手算 ——
   * Edit 的 old/new 字符串行数只是请求量，不是落盘结果。
   *
   * 账本只用来剔除"回合窗口观测 + 别人是最后写入者"的行：窗口判据在同仓库并行时
   * 天然分不清，而账本对自己派发的 Write/Edit 是权威的。终端里跑的会话不在账本里，
   * 那种只能靠窗口判据，宁可多列也不漏 —— 所以 direct 行一律保留，只打标记。
   */
  function rowsFor(sessionId: string): SessionChangeRow[] {
    const scm = useScmStore()
    const app = useAppStore()
    const ledger = useFileWriteLedgerStore()
    const projectRoot = app.projectRoot

    const rows: SessionChangeRow[] = []
    for (const file of filesFor(sessionId)) {
      const owner = ledger.lastWriter(projectRoot, file.path)
      const overwritten = Boolean(owner && owner.sessionId !== sessionId && owner.at > file.lastAt)
      if (file.origin === 'command' && overwritten) continue

      const stats = scm.fileStats[file.path]
      rows.push({
        ...file,
        insertions: stats?.additions ?? 0,
        deletions: stats?.deletions ?? 0,
        stillDirty: Boolean(stats),
        external: overwritten,
      })
    }
    return rows
  }

  function summaryFor(sessionId: string): SessionChangeSummary {
    const rows = rowsFor(sessionId)
    if (rows.length === 0) return EMPTY_SUMMARY

    const turn = lastChangeTurn(rows)
    const turnRows = turn > 0 ? rows.filter(row => row.turns.includes(turn)) : []

    const sum = (list: SessionChangeRow[]) => list.reduce(
      (acc, row) => ({ additions: acc.additions + row.insertions, deletions: acc.deletions + row.deletions }),
      { additions: 0, deletions: 0 },
    )
    const sessionTotal = sum(rows)
    const turnTotal = sum(turnRows)

    return {
      files: rows,
      sessionCount: rows.length,
      sessionAdditions: sessionTotal.additions,
      sessionDeletions: sessionTotal.deletions,
      turn,
      turnCount: turnRows.length,
      turnAdditions: turnTotal.additions,
      turnDeletions: turnTotal.deletions,
    }
  }

  /** 悬浮条的分段：本轮一组、更早轮次一组。 */
  function groupedFor(sessionId: string): { current: SessionChangeRow[]; earlier: SessionChangeRow[] } {
    const summary = summaryFor(sessionId)
    if (summary.turn === 0) return { current: [], earlier: [] }
    const current = new Set(filesOfTurn(summary.files, summary.turn).map(f => f.path))
    return {
      current: summary.files.filter(row => current.has(row.path)),
      earlier: summary.files.filter(row => !current.has(row.path)),
    }
  }

  return {
    changesBySession,
    syncSession,
    clearSession,
    filesFor,
    rowsFor,
    summaryFor,
    groupedFor,
  }
})
